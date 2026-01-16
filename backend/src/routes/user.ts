/** @format */

import { Router, Request, Response } from "express";
import Joi from "joi";
import { authService } from "../services/auth";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { encryptionService } from "../services/encryption";
import { redisService } from "../services/redis";
import { query } from "../database/pool";
import logger from "../services/logger";

// Configure @noble/ed25519 hash functions BEFORE any usage
import { createHash } from "crypto";
import * as ed25519 from "@noble/ed25519";

const sha512Hash = (message: Uint8Array) => {
  const hash = createHash("sha512");
  hash.update(message);
  return new Uint8Array(hash.digest());
};

// Prioritize direct hashes.sha512 access since that's what the library uses internally
if ((ed25519 as any).hashes) {
  logger.debug("Using direct hashes access: ed25519.hashes.sha512");
  (ed25519 as any).hashes.sha512 = sha512Hash;
} else if ((ed25519 as any).etc && typeof (ed25519 as any).etc.sha512Sync !== "undefined") {
  logger.debug("Using v3 API: ed25519.etc.sha512Sync");
  (ed25519 as any).etc.sha512Sync = sha512Hash;
} else if ((ed25519 as any).utils) {
  logger.debug("Using v2 API: ed25519.utils.sha512Sync");
  (ed25519 as any).utils.sha512Sync = sha512Hash;
} else {
  logger.warn("Could not set SHA-512 hash function for @noble/ed25519");
}

const router = Router();

const kodiakConnectionSchema = Joi.object({
  accountId: Joi.string().required(),
  apiKey: Joi.string().required(),
  secretKey: Joi.string().required(),
  walletSignature: Joi.string().optional(),
});

// Handler functions
async function getProfile(req: AuthenticatedRequest, res: Response) {
  try {
    const user = await authService.getUserById(req.user!.userId);

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const credentialsResult = await query(
      "SELECT account_id, verified FROM kodiak_credentials WHERE user_id = $1",
      [user.id]
    );

    const hasKodiak = credentialsResult.rows.length > 0;
    const kodiakStatus = hasKodiak
      ? {
          accountId: credentialsResult.rows[0].account_id,
          verified: credentialsResult.rows[0].verified,
        }
      : null;

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        userLevel: user.userLevel,
        hasKodiak,
        kodiakStatus,
      },
    });
    logger.info("Authentication successful for user", { userId: user.id, hasKodiak });
  } catch (err) {
    logger.error("Get profile error", { error: err instanceof Error ? err.message : String(err), userId: req.user!.userId });
    res.status(500).json({ success: false, error: "Failed to get profile" });
  }
}

// GET /api/user/profile
router.get("/profile", authMiddleware, getProfile);

// Helper function to generate Kodiak signature
async function generateKodiakSignature(
  timestamp: number,
  method: string,
  path: string,
  body: string,
  secretKey: string
): Promise<string> {
  const bs58 = await import("bs58");
  const message = `${timestamp}${method}${path}${body}`;

  const privateKey = bs58.default.decode(secretKey);
  const messageBytes = new TextEncoder().encode(message);

  const signature = await ed25519.sign(messageBytes, privateKey);
  return Buffer.from(signature).toString("base64url");
}

// Helper function to make authenticated Kodiak API request
async function makeKodiakRequest(
  method: string,
  path: string,
  accountId: string,
  apiKey: string,
  secretKey: string,
  body?: any
): Promise<any> {
  const timestamp = Date.now();
  const bodyStr = body ? JSON.stringify(body) : "";

  const signaturePath = path.startsWith("/v1/") ? path : `/v1${path}`;
  const signature = await generateKodiakSignature(
    timestamp,
    method.toUpperCase(),
    signaturePath,
    bodyStr,
    secretKey
  );

  const baseUrl = process.env.KODIAK_API_URL || "https://api.orderly.org/v1";

  const headers: Record<string, string> = {
    "Content-Type": method === "GET" ? "application/x-www-form-urlencoded" : "application/json",
    "orderly-account-id": accountId,
    "orderly-key": apiKey,
    "orderly-signature": signature,
    "orderly-timestamp": timestamp.toString(),
  };

  logger.debug("Kodiak API request", { path, method });

  const requestOptions: RequestInit = {
    method,
    headers,
  };

  if (method !== "GET" && bodyStr) {
    requestOptions.body = bodyStr;
  }

  const response = await fetch(`${baseUrl}${path}`, requestOptions);

  logger.debug("Kodiak API response", { status: response.status, statusText: response.statusText });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("Kodiak API error", { status: response.status, statusText: response.statusText, error: errorText });
    throw new Error(`Kodiak API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const responseData = await response.json();
  return responseData;
}

async function connectKodiak(req: AuthenticatedRequest, res: Response) {
  try {
    const { error, value } = kodiakConnectionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const userId = req.user!.userId;
    let isVerified = false;

    const encryptedApiKey = encryptionService.encryptApiKey(value.apiKey);
    const encryptedSecretKey = encryptionService.encryptSecretKey(value.secretKey);

    await query(
      `INSERT INTO kodiak_credentials (user_id, account_id, api_key_encrypted, secret_key_encrypted, wallet_signature, verified)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       api_key_encrypted = EXCLUDED.api_key_encrypted,
       secret_key_encrypted = EXCLUDED.secret_key_encrypted,
       wallet_signature = EXCLUDED.wallet_signature,
       verified = EXCLUDED.verified,
       updated_at = CURRENT_TIMESTAMP`,
      [userId, value.accountId, encryptedApiKey, encryptedSecretKey, value.walletSignature || null, false]
    );

    try {
      logger.debug("Testing Kodiak API connectivity", { accountId: value.accountId });
      let walletAddress = null;

      try {
        const publicResponse = await fetch(`https://api.orderly.org/v1/public/account?account_id=${value.accountId}`);
        const publicData = await publicResponse.json();

        if (publicData && typeof publicData === 'object' && 'success' in publicData && publicData.success && 'data' in publicData && publicData.data && typeof publicData.data === 'object' && 'address' in publicData.data) {
          walletAddress = publicData.data.address;
          logger.info("Wallet address discovered", { walletAddress });

          await query("UPDATE kodiak_credentials SET wallet_address = $1 WHERE user_id = $2", [walletAddress, userId]);
        }
        logger.debug("Public API test response received", { success: publicData && typeof publicData === 'object' && 'success' in publicData ? publicData.success : false });
      } catch (publicError) {
        logger.warn("Public API test failed", { error: (publicError as Error).message });
      }

      try {
        const accountsResponse = await fetch(
          `https://api.orderly.org/v1/get_all_accounts?address=${walletAddress || value.accountId}&broker_id=kodiak&chain_type=EVM`
        );
        const accountsData = await accountsResponse.json();
        logger.debug("Get all accounts response received", { success: accountsData && typeof accountsData === 'object' && 'success' in accountsData ? accountsData.success : false });
      } catch (accountsError) {
        logger.warn("Get all accounts test failed", { error: (accountsError as Error).message });
      }

      logger.debug("Verifying Kodiak credentials", { accountId: value.accountId });
      const accountInfo = await makeKodiakRequest("GET", "/client/info", value.accountId, value.apiKey, value.secretKey);
      logger.debug("Account info retrieved", { success: accountInfo.success });

      if (accountInfo.success) {
        isVerified = true;
        // Account verification logic would go here
      }
    } catch (verificationError) {
      logger.warn("Credential verification failed", { error: verificationError instanceof Error ? verificationError.message : String(verificationError), userId });
      isVerified = false;
    }

    await query("UPDATE kodiak_credentials SET verified = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2", [isVerified, userId]);

    if (isVerified) {
      logger.info("Updating user level to REGISTERED", { userId });
      await authService.updateUserLevel(userId, "REGISTERED" as any);
    } else {
      logger.info("User verification failed, keeping BASIC level", { userId });
    }

    await query("INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)", [
      userId,
      "KODIAK_CONNECTED",
      { accountId: value.accountId, verified: isVerified },
    ]);

    res.json({
      success: true,
      message: isVerified
        ? "Kodiak credentials connected and verified successfully"
        : "Kodiak credentials stored but verification failed. Please check your credentials.",
      data: {
        accountId: value.accountId,
        verified: isVerified,
        userLevel: isVerified ? "REGISTERED" : "BASIC",
      },
    });
  } catch (err) {
    logger.error("Kodiak connect error", { error: err instanceof Error ? err.message : String(err), userId: req.user!.userId });
    res.status(500).json({ success: false, error: "Failed to connect Kodiak credentials" });
  }
}

// POST /api/user/kodiak/connect
router.post("/kodiak/connect", authMiddleware, connectKodiak);

async function disconnectKodiak(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user!.userId;

    await query("DELETE FROM kodiak_credentials WHERE user_id = $1", [userId]);
    await query("INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)", [userId, "KODIAK_DISCONNECTED", {}]);

    res.json({ success: true, message: "Kodiak credentials disconnected" });
  } catch (err) {
    logger.error("Kodiak disconnect error", { error: err instanceof Error ? err.message : String(err), userId: req.user!.userId });
    res.status(500).json({ success: false, error: "Failed to disconnect Kodiak credentials" });
  }
}

// DELETE /api/user/kodiak/disconnect
router.delete("/kodiak/disconnect", authMiddleware, disconnectKodiak);

async function getKodiakStatus(req: AuthenticatedRequest, res: Response) {
  try {
    const result = await query(
      "SELECT account_id, verified, created_at FROM kodiak_credentials WHERE user_id = $1",
      [req.user!.userId]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, data: { connected: false } });
    }

    res.json({
      success: true,
      data: {
        connected: true,
        accountId: result.rows[0].account_id,
        verified: result.rows[0].verified,
        connectedAt: result.rows[0].created_at,
      },
    });
  } catch (err) {
    logger.error("Get Kodiak status error", { error: err instanceof Error ? err.message : String(err), userId: req.user!.userId });
    res.status(500).json({ success: false, error: "Failed to get Kodiak status" });
  }
}

// GET /api/user/kodiak/status
router.get("/kodiak/status", authMiddleware, getKodiakStatus);

async function getKodiakPositions(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const cacheKey = `kodiak:positions:${userId}`;

    const cacheResult = await redisService.get(cacheKey);
    if (cacheResult.success && cacheResult.data) {
      logger.debug("Returning cached positions data", { userId });
      return res.json(JSON.parse(cacheResult.data));
    } else if (!cacheResult.success) {
      logger.warn("Positions cache read failed", {
        userId,
        error: cacheResult.error
      });
    }

    const result = await query(
      "SELECT account_id, api_key_encrypted, secret_key_encrypted, verified FROM kodiak_credentials WHERE user_id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: "No Kodiak credentials found" });
    }

    if (!result.rows[0].verified) {
      return res.status(400).json({ success: false, error: "Kodiak credentials not verified. Please reconnect." });
    }

    const accountId = result.rows[0].account_id;
    const apiKey = encryptionService.decryptApiKey(result.rows[0].api_key_encrypted);
    const secretKey = encryptionService.decryptSecretKey(result.rows[0].secret_key_encrypted);

    logger.debug("Fetching Kodiak positions", { userId, accountId });

    const positionsData = await makeKodiakRequest("GET", "/positions", accountId, apiKey, secretKey);

    logger.debug("Kodiak positions response", {
      success: positionsData?.success,
      rowCount: positionsData?.data?.rows?.length || 0
    });

    if (positionsData.success && positionsData.data) {
      const responseData = { success: true, data: positionsData.data };
      await redisService.setex(cacheKey, 5, JSON.stringify(responseData));
      res.json(responseData);
    } else {
      logger.error("Kodiak positions API failed", { response: positionsData });
      res.status(400).json({ success: false, error: "Failed to fetch positions from Kodiak API" });
    }
  } catch (err) {
    logger.error("Get Kodiak positions error", { error: err instanceof Error ? err.message : String(err), userId: req.user!.userId });
    res.status(500).json({ success: false, error: "Failed to get Kodiak positions" });
  }
}

// GET /api/user/kodiak/positions
router.get("/kodiak/positions", authMiddleware, getKodiakPositions);

async function getKodiakTrades(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const cacheKey = `kodiak:trades:${userId}`;

    const cacheResult = await redisService.get(cacheKey);
    if (cacheResult.success && cacheResult.data) {
      logger.debug("Returning cached trades data", { userId });
      return res.json(JSON.parse(cacheResult.data));
    } else if (!cacheResult.success) {
      logger.warn("Trades cache read failed", {
        userId,
        error: cacheResult.error
      });
    }

    const result = await query(
      "SELECT account_id, api_key_encrypted, secret_key_encrypted FROM kodiak_credentials WHERE user_id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: "No Kodiak credentials found" });
    }

    const accountId = result.rows[0].account_id;
    const apiKey = encryptionService.decryptApiKey(result.rows[0].api_key_encrypted);
    const secretKey = encryptionService.decryptSecretKey(result.rows[0].secret_key_encrypted);

    const tradesData = await makeKodiakRequest("GET", "/position_history?limit=50", accountId, apiKey, secretKey);

    if (tradesData.success && tradesData.data) {
      const responseData = { success: true, data: tradesData.data };
      await redisService.setex(cacheKey, 5, JSON.stringify(responseData));
      res.json(responseData);
    } else {
      res.status(400).json({ success: false, error: "Failed to fetch trades" });
    }
  } catch (err) {
    logger.error("Get Kodiak trades error", { error: err instanceof Error ? err.message : String(err), userId: req.user!.userId });
    res.status(500).json({ success: false, error: "Failed to get Kodiak trades" });
  }
}

// GET /api/user/kodiak/trades
router.get("/kodiak/trades", authMiddleware, getKodiakTrades);

async function getKodiakBalance(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const cacheKey = `kodiak:balance:${userId}`;

    const cacheResult = await redisService.get(cacheKey);
    if (cacheResult.success && cacheResult.data) {
      logger.debug("Returning cached balance data", { userId });
      return res.json(JSON.parse(cacheResult.data));
    } else if (!cacheResult.success) {
      logger.warn("Balance cache read failed", {
        userId,
        error: cacheResult.error
      });
    }

    const result = await query(
      "SELECT account_id, api_key_encrypted, secret_key_encrypted FROM kodiak_credentials WHERE user_id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: "No Kodiak credentials found" });
    }

    const accountId = result.rows[0].account_id;
    const apiKey = encryptionService.decryptApiKey(result.rows[0].api_key_encrypted);
    const secretKey = encryptionService.decryptSecretKey(result.rows[0].secret_key_encrypted);

    const holdingsData = await makeKodiakRequest("GET", "/client/holding?all=true", accountId, apiKey, secretKey);

    if (holdingsData.success && holdingsData.data) {
      const holdings = Array.isArray(holdingsData.data) ? holdingsData.data : holdingsData.data.holding || [];
      const totalBalance = holdings.reduce((sum: number, holding: any) => {
        const holdingBalance = parseFloat(holding.holding || holding.balance || "0");
        const price = parseFloat(holding.price || "0");
        return sum + holdingBalance * price;
      }, 0);

      let accountInfo = null;
      try {
        accountInfo = await makeKodiakRequest("GET", "/client/info", accountId, apiKey, secretKey);
      } catch (infoError) {
        logger.warn("Could not fetch account info", { error: infoError instanceof Error ? infoError.message : String(infoError), userId });
      }

      const responseData = {
        success: true,
        data: {
          totalBalance: totalBalance,
          holdings: holdings,
          accountInfo: accountInfo?.success ? accountInfo.data : null,
          total_pnl_24_h: accountInfo?.data?.total_pnl_24_h || "0",
          trading_volume_last_24_hours: accountInfo?.data?.trading_volume_last_24_hours || "0",
        },
      };

      await redisService.setex(cacheKey, 5, JSON.stringify(responseData));
      res.json(responseData);
    } else {
      res.status(400).json({ success: false, error: "Failed to fetch balance" });
    }
  } catch (err) {
    logger.error("Get Kodiak balance error", { error: err instanceof Error ? err.message : String(err), userId: req.user!.userId });
    res.status(500).json({ success: false, error: "Failed to get Kodiak balance" });
  }
}

// GET /api/user/kodiak/balance
router.get("/kodiak/balance", authMiddleware, getKodiakBalance);

// POST /api/user/verify-wallet
async function verifyWallet(req: AuthenticatedRequest, res: Response) {
  try {
    const { walletAddress, signature, message } = req.body;

    if (!walletAddress || !signature || !message) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: walletAddress, signature, message",
      });
    }

    const userId = req.user!.userId;
    const result = await authService.verifyWalletOwnership(userId, walletAddress, signature, message);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.message });
    }

    res.json({
      success: true,
      message: "Wallet verified successfully. User level updated to VERIFIED.",
    });
  } catch (err) {
    logger.error("Wallet verification error", { error: err instanceof Error ? err.message : String(err), userId: req.user!.userId });
    res.status(500).json({ success: false, error: "Failed to verify wallet" });
  }
}

// POST /api/user/verify-wallet
router.post("/verify-wallet", authMiddleware, verifyWallet);

export { router as userRoutes };
