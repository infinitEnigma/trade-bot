/** @format */

import { Router, Request, Response } from "express";
import Joi from "joi";
import { authService } from "../services/auth";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { encryptionService } from "../services/encryption";
import { redisService } from "../services/redis";
import { Pool } from "pg";

// Configure @noble/ed25519 hash functions BEFORE any usage
import { createHash } from "crypto";
import * as ed25519 from "@noble/ed25519";

// Set SHA-512 hash function for @noble/ed25519 (using Node.js crypto)
const sha512Hash = (message: Uint8Array) => {
  const hash = createHash("sha512");
  hash.update(message);
  return new Uint8Array(hash.digest());
};

// Try different ways to set the hash function for @noble/ed25519
/*console.log("Setting up @noble/ed25519 hash function...");
console.log("ed25519 object keys:", Object.keys(ed25519));
console.log("ed25519.etc exists:", !!(ed25519 as any).etc);
if ((ed25519 as any).etc) {
  console.log("ed25519.etc keys:", Object.keys((ed25519 as any).etc));
}
if ((ed25519 as any).utils) {
  console.log("ed25519.utils keys:", Object.keys((ed25519 as any).utils));
}
if ((ed25519 as any).hashes) {
  console.log("ed25519.hashes keys:", Object.keys((ed25519 as any).hashes));
}*/

// Prioritize direct hashes.sha512 access since that's what the library uses internally
if ((ed25519 as any).hashes) {
  console.log("Using direct hashes access: ed25519.hashes.sha512");
  (ed25519 as any).hashes.sha512 = sha512Hash;
}
// Try v3 API
else if (
  (ed25519 as any).etc &&
  typeof (ed25519 as any).etc.sha512Sync !== "undefined"
) {
  console.log("Using v3 API: ed25519.etc.sha512Sync");
  (ed25519 as any).etc.sha512Sync = sha512Hash;
}
// Try v2 API
else if ((ed25519 as any).utils) {
  console.log("Using v2 API: ed25519.utils.sha512Sync");
  (ed25519 as any).utils.sha512Sync = sha512Hash;
} else {
  console.warn("Could not set SHA-512 hash function for @noble/ed25519");
}

const router = Router();

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "trade_bot",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
});

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

    // Check if user has Kodiak credentials
    const credentialsResult = await pool.query(
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
    console.log("Authentication successful for user:", user.id, hasKodiak);
  } catch (err) {
    console.error("Get profile error:", err);
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

  // Decode the bs58 secret key to get raw private key bytes
  const privateKey = bs58.default.decode(secretKey);
  const messageBytes = new TextEncoder().encode(message);

  // Use proper Ed25519 signing
  const signature = await ed25519.sign(messageBytes, privateKey);

  // Convert to base64url format
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

  // For signature, use the full path including /v1/
  const signaturePath = path.startsWith("/v1/") ? path : `/v1${path}`;
  const signature = await generateKodiakSignature(
    timestamp,
    method.toUpperCase(), // Use uppercase method like working example
    signaturePath,
    bodyStr,
    secretKey
  );

  const baseUrl = process.env.KODIAK_API_URL || "https://api.orderly.org/v1";

  // Log detailed request information for debugging
  /*console.log("=== KODIAK API REQUEST DEBUG ===");
  console.log("URL:", `${baseUrl}${path}`);
  console.log("Method:", method);
  console.log("Timestamp:", timestamp);
  console.log("Body:", bodyStr || "(empty)");
  console.log(
    "Message for signature:",
    `${timestamp}${method}${signaturePath}${bodyStr}`
  );
  console.log("API Key:", apiKey);
  console.log("Signature:", signature);
  console.log("Headers:");
  console.log("  Content-Type: application/json");
  console.log("  orderly-account-id:", accountId);
  console.log("  orderly-key:", apiKey);
  console.log("  orderly-signature:", signature);
  console.log("  orderly-timestamp:", timestamp.toString());
  console.log("  orderly-chain-id: 80094");
  console.log("=================================");*/

  // Prepare headers - use correct Content-Type for GET requests
  // Keep the "ed25519:" prefix in the API key as required by the API
  const headers: Record<string, string> = {
    "Content-Type":
      method === "GET"
        ? "application/x-www-form-urlencoded"
        : "application/json",
    "orderly-account-id": accountId,
    "orderly-key": apiKey,
    "orderly-signature": signature,
    "orderly-timestamp": timestamp.toString(),
  };

  console.log(`Request path: "${path}"`);

  const requestOptions: RequestInit = {
    method,
    headers,
  };

  // Only include body for non-GET requests
  if (method !== "GET" && bodyStr) {
    requestOptions.body = bodyStr;
  }

  const response = await fetch(`${baseUrl}${path}`, requestOptions);

  console.log(`API Response status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Kodiak API error ${response.status}:`, errorText);
    throw new Error(
      `Kodiak API error: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  const responseData = await response.json();
  //console.log(`API Response data:`, JSON.stringify(responseData, null, 2));
  return responseData;
}

async function connectKodiak(req: AuthenticatedRequest, res: Response) {
  try {
    const { error, value } = kodiakConnectionSchema.validate(req.body);
    if (error) {
      return res
        .status(400)
        .json({ success: false, error: error.details[0].message });
    }
    const userId = req.user!.userId;
    let isVerified = false;

    // Encrypt credentials
    const encryptedApiKey = encryptionService.encryptApiKey(value.apiKey);
    const encryptedSecretKey = encryptionService.encryptSecretKey(
      value.secretKey
    );

    // Store credentials initially as unverified
    await pool.query(
      `INSERT INTO kodiak_credentials (user_id, account_id, api_key_encrypted, secret_key_encrypted, wallet_signature, verified)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       api_key_encrypted = EXCLUDED.api_key_encrypted,
       secret_key_encrypted = EXCLUDED.secret_key_encrypted,
       wallet_signature = EXCLUDED.wallet_signature,
       verified = EXCLUDED.verified,
       updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        value.accountId,
        encryptedApiKey,
        encryptedSecretKey,
        value.walletSignature || null,
        false,
      ]
    );

    try {
      // First test the public endpoint to verify API connectivity
      console.log("Testing API connectivity with public endpoint...");
      let walletAddress = null;
      try {
        const publicResponse = await fetch(
          `https://api.orderly.org/v1/public/account?account_id=${value.accountId}`
        );
        const publicData = await publicResponse.json();
        console.log("Public API test response:", publicData);

        if ((publicData as any).success && (publicData as any).data?.address) {
          walletAddress = (publicData as any).data.address;
          console.log("Wallet address found:", walletAddress);

          // Store wallet address in credentials
          await pool.query(
            "UPDATE kodiak_credentials SET wallet_address = $1 WHERE user_id = $2",
            [walletAddress, userId]
          );
        }
      } catch (publicError) {
        console.warn("Public API test failed:", publicError);
      }

      // Test get_all_accounts endpoint
      console.log("Testing get_all_accounts endpoint...");
      try {
        const accountsResponse = await fetch(
          `https://api.orderly.org/v1/get_all_accounts?address=${
            walletAddress || value.accountId
          }&broker_id=kodiak&chain_type=EVM`
        );
        const accountsData = await accountsResponse.json();
        console.log(
          "Get all accounts response:",
          JSON.stringify(accountsData, null, 2)
        );
      } catch (accountsError) {
        console.warn("Get all accounts test failed:", accountsError);
      }

      // Verify credentials by making API call to get account info
      console.log("Verifying credentials for account:", value.accountId);
      const accountInfo = await makeKodiakRequest(
        "GET",
        "/client/info",
        value.accountId,
        value.apiKey,
        value.secretKey
      );
      console.log("Account info response:", accountInfo);

      if (accountInfo.success) {
        isVerified = true;

        // Store account information
        await pool.query(
          `INSERT INTO kodiak_accounts (
            user_id, account_id, email, account_mode, max_leverage,
            taker_fee_rate, maker_fee_rate, futures_taker_fee_rate, futures_maker_fee_rate,
            imr_factor, max_notional
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (user_id) DO UPDATE SET
            account_id = EXCLUDED.account_id,
            email = EXCLUDED.email,
            account_mode = EXCLUDED.account_mode,
            max_leverage = EXCLUDED.max_leverage,
            taker_fee_rate = EXCLUDED.taker_fee_rate,
            maker_fee_rate = EXCLUDED.maker_fee_rate,
            futures_taker_fee_rate = EXCLUDED.futures_taker_fee_rate,
            futures_maker_fee_rate = EXCLUDED.futures_maker_fee_rate,
            imr_factor = EXCLUDED.imr_factor,
            max_notional = EXCLUDED.max_notional,
            updated_at = CURRENT_TIMESTAMP`,
          [
            userId,
            value.accountId,
            accountInfo.data.email,
            accountInfo.data.account_mode,
            accountInfo.data.max_leverage,
            accountInfo.data.taker_fee_rate || 0,
            accountInfo.data.maker_fee_rate || 0,
            accountInfo.data.futures_taker_fee_rate || 0,
            accountInfo.data.futures_maker_fee_rate || 0,
            JSON.stringify(accountInfo.data.imr_factor || {}),
            JSON.stringify(accountInfo.data.max_notional || {}),
          ]
        );

        // Fetch and store positions
        try {
          const positionsData = await makeKodiakRequest(
            "GET",
            "/positions",
            value.accountId,
            value.apiKey,
            value.secretKey
          );

          if (positionsData.success && positionsData.data.rows) {
            for (const position of positionsData.data.rows) {
              await pool.query(
                `INSERT INTO kodiak_positions (
                  user_id, symbol, position_qty, cost_position, average_open_price,
                  mark_price, unsettled_pnl, pnl_24_h, leverage, imr, mmr, est_liq_price
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (user_id, symbol) DO UPDATE SET
                  position_qty = EXCLUDED.position_qty,
                  cost_position = EXCLUDED.cost_position,
                  average_open_price = EXCLUDED.average_open_price,
                  mark_price = EXCLUDED.mark_price,
                  unsettled_pnl = EXCLUDED.unsettled_pnl,
                  pnl_24_h = EXCLUDED.pnl_24_h,
                  leverage = EXCLUDED.leverage,
                  imr = EXCLUDED.imr,
                  mmr = EXCLUDED.mmr,
                  est_liq_price = EXCLUDED.est_liq_price,
                  updated_at = CURRENT_TIMESTAMP`,
                [
                  userId,
                  position.symbol,
                  position.position_qty || 0,
                  position.cost_position || 0,
                  position.average_open_price || 0,
                  position.mark_price || 0,
                  position.unsettled_pnl || 0,
                  position.pnl_24_h || 0,
                  position.leverage || 1,
                  position.imr || 0.1,
                  position.mmr || 0.05,
                  position.est_liq_price || 0,
                ]
              );
            }
          }
        } catch (error) {
          console.warn("Failed to fetch positions:", error);
        }

        // Fetch and store statistics
        try {
          const statsData = await makeKodiakRequest(
            "GET",
            "/client/statistics",
            value.accountId,
            value.apiKey,
            value.secretKey
          );

          if (statsData.success) {
            await pool.query(
              `INSERT INTO kodiak_statistics (
                user_id, days_since_registration, fees_paid_last_30_days,
                perp_fees_paid_last_30_days, perp_trading_volume_last_24_hours,
                perp_trading_volume_last_30_days, perp_trading_volume_ytd,
                trading_volume_last_24_hours, trading_volume_last_30_days,
                trading_volume_ytd, perp_trading_volume_last_7_days, perp_trading_volume_ltd
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              ON CONFLICT (user_id) DO UPDATE SET
                days_since_registration = EXCLUDED.days_since_registration,
                fees_paid_last_30_days = EXCLUDED.fees_paid_last_30_days,
                perp_fees_paid_last_30_days = EXCLUDED.perp_fees_paid_last_30_days,
                perp_trading_volume_last_24_hours = EXCLUDED.perp_trading_volume_last_24_hours,
                perp_trading_volume_last_30_days = EXCLUDED.perp_trading_volume_last_30_days,
                perp_trading_volume_ytd = EXCLUDED.perp_trading_volume_ytd,
                trading_volume_last_24_hours = EXCLUDED.trading_volume_last_24_hours,
                trading_volume_last_30_days = EXCLUDED.trading_volume_last_30_days,
                trading_volume_ytd = EXCLUDED.trading_volume_ytd,
                perp_trading_volume_last_7_days = EXCLUDED.perp_trading_volume_last_7_days,
                perp_trading_volume_ltd = EXCLUDED.perp_trading_volume_ltd,
                updated_at = CURRENT_TIMESTAMP`,
              [
                userId,
                statsData.data.days_since_registration || 0,
                statsData.data.fees_paid_last_30_days || 0,
                statsData.data.perp_fees_paid_last_30_days || 0,
                statsData.data.perp_trading_volume_last_24_hours || 0,
                statsData.data.perp_trading_volume_last_30_days || 0,
                statsData.data.perp_trading_volume_ytd || 0,
                statsData.data.trading_volume_last_24_hours || 0,
                statsData.data.trading_volume_last_30_days || 0,
                statsData.data.trading_volume_ytd || 0,
                statsData.data.perp_trading_volume_last_7_days || 0,
                statsData.data.perp_trading_volume_ltd || 0,
              ]
            );
          }
        } catch (error) {
          console.warn("Failed to fetch statistics:", error);
        }
      }
    } catch (verificationError) {
      console.warn("Credential verification failed:", verificationError);
      isVerified = false;
    }

    // Update verification status
    await pool.query(
      "UPDATE kodiak_credentials SET verified = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2",
      [isVerified, userId]
    );

    // Update user level to REGISTERED if verified, or keep as BASIC if not
    if (isVerified) {
      console.log("Updating user level to REGISTERED for user:", userId);
      const updateResult = await authService.updateUserLevel(
        userId,
        "REGISTERED" as any
      );
      console.log("User level update result:", updateResult);
    } else {
      console.log("User verification failed, keeping BASIC level");
    }

    // Log the action
    await pool.query(
      "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
      [
        userId,
        "KODIAK_CONNECTED",
        {
          accountId: value.accountId,
          verified: isVerified,
        },
      ]
    );

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
    console.error("Kodiak connect error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to connect Kodiak credentials",
    });
  }
}

// POST /api/user/kodiak/connect
router.post("/kodiak/connect", authMiddleware, connectKodiak);

async function disconnectKodiak(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user!.userId;

    await pool.query("DELETE FROM kodiak_credentials WHERE user_id = $1", [
      userId,
    ]);

    await pool.query(
      "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
      [userId, "KODIAK_DISCONNECTED", {}]
    );

    res.json({ success: true, message: "Kodiak credentials disconnected" });
  } catch (err) {
    console.error("Kodiak disconnect error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to disconnect Kodiak credentials",
    });
  }
}

// DELETE /api/user/kodiak/disconnect
router.delete("/kodiak/disconnect", authMiddleware, disconnectKodiak);

async function getKodiakStatus(req: AuthenticatedRequest, res: Response) {
  try {
    const result = await pool.query(
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
    console.error("Get Kodiak status error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to get Kodiak status" });
  }
}

// GET /api/user/kodiak/status
router.get("/kodiak/status", authMiddleware, getKodiakStatus);

async function getKodiakPositions(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const cacheKey = `kodiak:positions:${userId}`;

    // Try to get cached data first
    const cachedData = await redisService.get(cacheKey);
    if (cachedData) {
      console.log("Returning cached positions data for user:", userId);
      return res.json(JSON.parse(cachedData));
    }

    const result = await pool.query(
      "SELECT account_id, api_key_encrypted, secret_key_encrypted, verified FROM kodiak_credentials WHERE user_id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No Kodiak credentials found" });
    }

    if (!result.rows[0].verified) {
      return res
        .status(400)
        .json({ success: false, error: "Kodiak credentials not verified. Please reconnect." });
    }

    const accountId = result.rows[0].account_id;
    const apiKey = encryptionService.decryptApiKey(
      result.rows[0].api_key_encrypted
    );
    const secretKey = encryptionService.decryptSecretKey(
      result.rows[0].secret_key_encrypted
    );

    console.log("Making Kodiak API call for positions - user:", userId, "account:", accountId);

    // Get positions from Kodiak API
    const positionsData = await makeKodiakRequest(
      "GET",
      "/positions",
      accountId,
      apiKey,
      secretKey
    );

    console.log("Kodiak positions response:", positionsData?.success, positionsData?.data?.rows?.length || 0);

    if (positionsData.success && positionsData.data) {
      const responseData = { success: true, data: positionsData.data };

      // Cache the response for 5 seconds (matches BOT_POLL_INTERVAL)
      await redisService.setex(cacheKey, 5, JSON.stringify(responseData));

      res.json(responseData);
    } else {
      console.error("Kodiak positions API failed:", positionsData);
      res
        .status(400)
        .json({ success: false, error: "Failed to fetch positions from Kodiak API" });
    }
  } catch (err) {
    console.error("Get Kodiak positions error:", err);
    // Don't return 401 on Kodiak API failures - return 500 instead
    res
      .status(500)
      .json({ success: false, error: "Failed to get Kodiak positions" });
  }
}

// GET /api/user/kodiak/positions
router.get("/kodiak/positions", authMiddleware, getKodiakPositions);

async function getKodiakTrades(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const cacheKey = `kodiak:trades:${userId}`;

    // Try to get cached data first
    const cachedData = await redisService.get(cacheKey);
    if (cachedData) {
      console.log("Returning cached trades data for user:", userId);
      return res.json(JSON.parse(cachedData));
    }

    const result = await pool.query(
      "SELECT account_id, api_key_encrypted, secret_key_encrypted FROM kodiak_credentials WHERE user_id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No Kodiak credentials found" });
    }

    const accountId = result.rows[0].account_id;
    const apiKey = encryptionService.decryptApiKey(
      result.rows[0].api_key_encrypted
    );
    const secretKey = encryptionService.decryptSecretKey(
      result.rows[0].secret_key_encrypted
    );

    // Get trade history from Kodiak API
    const tradesData = await makeKodiakRequest(
      "GET",
      "/position_history?limit=50",
      accountId,
      apiKey,
      secretKey
    );

    if (tradesData.success && tradesData.data) {
      const responseData = { success: true, data: tradesData.data };

      // Cache the response for 5 seconds (matches BOT_POLL_INTERVAL)
      await redisService.setex(cacheKey, 5, JSON.stringify(responseData));

      res.json(responseData);
    } else {
      res.status(400).json({ success: false, error: "Failed to fetch trades" });
    }
  } catch (err) {
    console.error("Get Kodiak trades error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to get Kodiak trades" });
  }
}

// GET /api/user/kodiak/trades
router.get("/kodiak/trades", authMiddleware, getKodiakTrades);

async function getKodiakBalance(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const cacheKey = `kodiak:balance:${userId}`;

    // Try to get cached data first
    const cachedData = await redisService.get(cacheKey);
    if (cachedData) {
      console.log("Returning cached balance data for user:", userId);
      return res.json(JSON.parse(cachedData));
    }

    const result = await pool.query(
      "SELECT account_id, api_key_encrypted, secret_key_encrypted FROM kodiak_credentials WHERE user_id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No Kodiak credentials found" });
    }

    const accountId = result.rows[0].account_id;
    const apiKey = encryptionService.decryptApiKey(
      result.rows[0].api_key_encrypted
    );
    const secretKey = encryptionService.decryptSecretKey(
      result.rows[0].secret_key_encrypted
    );

    // Get holdings data which includes token balances
    const holdingsData = await makeKodiakRequest(
      "GET",
      "/client/holding?all=true",
      accountId,
      apiKey,
      secretKey
    );

    if (holdingsData.success && holdingsData.data) {
      // Calculate total balance from holdings
      const holdings = Array.isArray(holdingsData.data)
        ? holdingsData.data
        : holdingsData.data.holding || [];
      const totalBalance = holdings.reduce((sum: number, holding: any) => {
        const holdingBalance = parseFloat(
          holding.holding || holding.balance || "0"
        );
        const price = parseFloat(holding.price || "0");
        return sum + holdingBalance * price;
      }, 0);

      // Also get account info for P&L data
      let accountInfo = null;
      try {
        accountInfo = await makeKodiakRequest(
          "GET",
          "/client/info",
          accountId,
          apiKey,
          secretKey
        );
      } catch (infoError) {
        console.warn("Could not fetch account info:", infoError);
      }

      const responseData = {
        success: true,
        data: {
          totalBalance: totalBalance,
          holdings: holdings,
          accountInfo: accountInfo?.success ? accountInfo.data : null,
          total_pnl_24_h: accountInfo?.data?.total_pnl_24_h || "0",
          trading_volume_last_24_hours:
            accountInfo?.data?.trading_volume_last_24_hours || "0",
        },
      };

      // Cache the response for 5 seconds (matches BOT_POLL_INTERVAL)
      await redisService.setex(cacheKey, 5, JSON.stringify(responseData));

      res.json(responseData);
    } else {
      res
        .status(400)
        .json({ success: false, error: "Failed to fetch balance" });
    }
  } catch (err) {
    console.error("Get Kodiak balance error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to get Kodiak balance" });
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
    const result = await authService.verifyWalletOwnership(
      userId,
      walletAddress,
      signature,
      message
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.message,
      });
    }

    res.json({
      success: true,
      message: "Wallet verified successfully. User level updated to VERIFIED.",
    });
  } catch (err) {
    console.error("Wallet verification error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to verify wallet",
    });
  }
}

// POST /api/user/verify-wallet
router.post("/verify-wallet", authMiddleware, verifyWallet);

export { router as userRoutes };
