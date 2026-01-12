/** @format */

import { Router, Request, Response } from "express";
import axios from "axios";
import { authService, TokenPayload } from "../services/auth";
import { Pool } from "pg";
import { createHash } from "crypto";
import * as ed25519 from "@noble/ed25519";

const router = Router();

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "trade_bot",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
});

const KODIAK_API_BASE =
  process.env.KODIAK_API_URL || "https://api.orderly.org/v1";
const WS_BASE =
  process.env.KODIAK_WS_URL || "wss://ws-evm.orderly.org/ws/stream";

interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: () => void
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ success: false, error: "No token provided" });
  }

  const payload = await authService.validateToken(token);
  if (!payload) {
    return res.status(403).json({ success: false, error: "Invalid token" });
  }

  req.user = payload;
  next();
};

// Helper to get Kodiak credentials for user
async function getKodiakCredentials(userId: string) {
  const result = await pool.query(
    "SELECT account_id, api_key_encrypted, secret_key_encrypted FROM kodiak_credentials WHERE user_id = $1",
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const { encryptionService } = await import("../services/encryption.js");

  return {
    accountId: result.rows[0].account_id,
    apiKey: encryptionService.decryptApiKey(result.rows[0].api_key_encrypted),
    secretKey: encryptionService.decryptSecretKey(
      result.rows[0].secret_key_encrypted
    ),
  };
}

// Generate Kodiak signature using Ed25519
async function generateKodiakSignature(
  timestamp: number,
  method: string,
  path: string,
  body: string,
  secretKey: string
): Promise<string> {
  const message = `${timestamp}${method}${path}${body}`;
  const privateKeyBytes = Buffer.from(secretKey, "base64");
  const messageBytes = new TextEncoder().encode(message);
  const hash = createHash("sha256").update(messageBytes).digest();
  const signature = await ed25519.sign(hash, privateKeyBytes);
  return Buffer.from(signature).toString("base64url");
}

// GET /api/market/ticker
router.get("/ticker", async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || "PERP_BTC_USDC";

    const response = await axios.get(`${KODIAK_API_BASE}/public/ticker`, {
      params: { symbol },
    });

    res.json({
      success: true,
      data: response.data.data,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error("Ticker error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch ticker" });
  }
});

// GET /api/market/tickers
router.get("/tickers", async (req: Request, res: Response) => {
  try {
    const response = await axios.get(`${KODIAK_API_BASE}/public/tickers`);

    res.json({
      success: true,
      data: response.data.data,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error("Tickers error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch tickers" });
  }
});

// GET /api/market/klines
router.get("/klines", async (req: Request, res: Response) => {
  try {
    const { symbol, interval, limit } = req.query;

    const response = await axios.get(`${KODIAK_API_BASE}/kline`, {
      params: {
        symbol: symbol || "PERP_BTC_USDC",
        interval: interval || "1h",
        limit: limit || 100,
      },
    });

    res.json({
      success: true,
      data: response.data.data,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error("Klines error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch klines" });
  }
});

// GET /api/market/orderbook
router.get("/orderbook", async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || "PERP_BTC_USDC";

    const response = await axios.get(`${KODIAK_API_BASE}/public/orderbook`, {
      params: { symbol },
    });

    res.json({
      success: true,
      data: response.data.data,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error("Orderbook error:", err.message);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch orderbook" });
  }
});

// GET /api/market/positions (requires authentication and Kodiak credentials)
router.get(
  "/positions",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const credentials = await getKodiakCredentials(req.user!.userId);

      if (!credentials) {
        return res
          .status(403)
          .json({ success: false, error: "Kodiak credentials required" });
      }

      const timestamp = Date.now();
      const path = "/v1/positions";
      const signature = await generateKodiakSignature(
        timestamp,
        "GET",
        path,
        "",
        credentials.secretKey
      );

      const response = await axios.get(`${KODIAK_API_BASE}${path}`, {
        headers: {
          "orderly-account-id": credentials.accountId,
          "orderly-key": credentials.apiKey,
          "orderly-signature": signature,
          "orderly-timestamp": timestamp.toString(),
        },
      });

      res.json({
        success: true,
        data: response.data.data,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      console.error("Positions error:", err.message);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch positions" });
    }
  }
);

// GET /api/market/balance (requires authentication and Kodiak credentials)
router.get(
  "/balance",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const credentials = await getKodiakCredentials(req.user!.userId);

      if (!credentials) {
        return res
          .status(403)
          .json({ success: false, error: "Kodiak credentials required" });
      }

      const timestamp = Date.now();
      const path = "/v1/client/info";
      const signature = await generateKodiakSignature(
        timestamp,
        "GET",
        path,
        "",
        credentials.secretKey
      );

      const response = await axios.get(`${KODIAK_API_BASE}${path}`, {
        headers: {
          "orderly-account-id": credentials.accountId,
          "orderly-key": credentials.apiKey,
          "orderly-signature": signature,
          "orderly-timestamp": timestamp.toString(),
        },
      });

      res.json({
        success: true,
        data: response.data.data,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      console.error("Balance error:", err.message);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch balance" });
    }
  }
);

// GET /api/market/ws-url
router.get(
  "/ws-url",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const credentials = await getKodiakCredentials(req.user!.userId);

      if (!credentials) {
        return res
          .status(403)
          .json({ success: false, error: "Kodiak credentials required" });
      }

      res.json({
        success: true,
        data: {
          publicWsUrl: `${WS_BASE}/${credentials.accountId}`,
          timestamp: Date.now(),
        },
      });
    } catch (err: any) {
      console.error("WS URL error:", err.message);
      res
        .status(500)
        .json({ success: false, error: "Failed to get WebSocket URL" });
    }
  }
);

// TradingView Public Endpoints (No authentication required)

// GET /api/market/tv/config
router.get("/tv/config", async (req: Request, res: Response) => {
  try {
    const response = await axios.get(`${KODIAK_API_BASE}/tv/config`);

    res.json({
      success: true,
      data: response.data,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error("TV Config error:", err.message);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch TV config" });
  }
});

// GET /api/market/tv/symbols
router.get("/tv/symbols", async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || "PERP_BTC_USDC";

    const response = await axios.get(`${KODIAK_API_BASE}/tv/symbols`, {
      params: { symbol },
    });

    res.json({
      success: true,
      data: response.data,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error("TV Symbols error:", err.message);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch TV symbols" });
  }
});

// GET /api/market/tv/history
router.get("/tv/history", async (req: Request, res: Response) => {
  try {
    const { symbol, resolution, from, to } = req.query;

    const response = await axios.get(`${KODIAK_API_BASE}/tv/history`, {
      params: {
        symbol: symbol || "PERP_BTC_USDC",
        resolution: resolution || "1",
        from: from || Math.floor(Date.now() / 1000) - 86400, // 24 hours ago
        to: to || Math.floor(Date.now() / 1000),
      },
    });

    res.json({
      success: true,
      data: response.data,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error("TV History error:", err.message);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch TV history" });
  }
});

export { router as marketRoutes };
