/** @format */

import axios, { AxiosInstance } from "axios";
import { OrderRequest, OrderResponse } from "../types/strategy";
import { createHash } from "crypto";
import * as ed25519 from "@noble/ed25519";
import { logger } from "../utils/logger";

interface OrderlyPosition {
  symbol: string;
  position_qty: number;
  mark_price: number;
  [key: string]: unknown;
}

interface OrderlyAccountInfo {
  total_value: number;
  max_leverage: number;
  max_notional?: Record<string, number>;
  [key: string]: unknown;
}

interface OrderlyTicker {
  price: number;
  symbol: string;
  [key: string]: unknown;
}

interface OrderlyKline {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  [key: string]: unknown;
}

interface OrderlyConfig {
  accountId: string;
  orderlyKey: string;
  orderlySecret: string;
  baseUrl: string;
}

export class OrderlyClient {
  private client: AxiosInstance;
  private config: OrderlyConfig;

  constructor(config: OrderlyConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  private async generateSignature(
    timestamp: number,
    method: string,
    path: string,
    body?: string
  ): Promise<string> {
    try {
      // Create the message string as required by Kodiak API
      const message = `${timestamp}${method}${path}${body || ""}`;

      // Decode base64 secret key to bytes
      let privateKeyBytes = Buffer.from(this.config.orderlySecret, "base64");

      // Handle different key formats - Ed25519 expects 32 bytes
      if (privateKeyBytes.length > 32) {
        // If key is longer than 32 bytes, take first 32 bytes (private key part)
        privateKeyBytes = privateKeyBytes.subarray(0, 32);
      } else if (privateKeyBytes.length < 32) {
        // If key is shorter, pad with zeros (defensive programming)
        const padded = Buffer.alloc(32);
        privateKeyBytes.copy(padded);
        privateKeyBytes = padded;
      }

      // Convert message to bytes
      const messageBytes = new TextEncoder().encode(message);

      // Hash the message with SHA256 as required by Kodiak API
      const hash = createHash("sha256").update(messageBytes).digest();

      // Sign the hash using Ed25519
      const signature = await ed25519.sign(hash, privateKeyBytes);

      // Return base64url-encoded signature
      return Buffer.from(signature).toString("base64url");
    } catch (error) {
      throw new Error(
        `Failed to generate Kodiak signature: ${error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async signRequest(
    method: string,
    path: string,
    body?: object
  ): Promise<Record<string, string>> {
    const timestamp = Date.now();
    const bodyStr = body ? JSON.stringify(body) : "";
    const signature = await this.generateSignature(
      timestamp,
      method,
      path,
      bodyStr
    );

    return {
      "orderly-account-id": this.config.accountId,
      "orderly-key": this.config.orderlyKey,
      "orderly-signature": signature,
      "orderly-timestamp": timestamp.toString(),
    };
  }

  async validatePositionSize(request: OrderRequest): Promise<void> {
    try {
      // Get account info for balance and limits
      const accountInfo = await this.getAccountInfo();
      const positions = await this.getPositions();

      // Calculate current exposure
      const currentExposure = positions.reduce((total, position) => {
        return total + Math.abs(position.position_qty * position.mark_price);
      }, 0);

      // Get current price for notional calculation
      const ticker = await this.getTicker(request.symbol);
      const currentPrice = ticker.price;

      // Calculate order notional value
      const orderNotional = request.orderQuantity * currentPrice;

      // Validation rules from docs
      const maxLeverage = accountInfo.max_leverage || 20;
      const accountBalance = accountInfo.total_value || 0; // Assuming this field exists
      const maxExposurePercent = 0.8; // 80% of account balance

      // Rule 1: Notional amount <= account_balance * max_leverage
      const maxAllowedNotional = accountBalance * maxLeverage;
      if (orderNotional > maxAllowedNotional) {
        throw new Error(
          `Order too large. Notional: ${orderNotional}, Max allowed: ${maxAllowedNotional}`
        );
      }

      // Rule 2: Total exposure <= 80% of account balance
      const newTotalExposure = currentExposure + orderNotional;
      const maxTotalExposure = accountBalance * maxExposurePercent;
      if (newTotalExposure > maxTotalExposure) {
        throw new Error(
          `Total exposure too high. New exposure: ${newTotalExposure}, Max allowed: ${maxTotalExposure}`
        );
      }

      // Rule 3: Check position limits per symbol
      const symbolPosition = positions.find(p => p.symbol === request.symbol);
      if (symbolPosition) {
        const symbolExposure = Math.abs(
          symbolPosition.position_qty * symbolPosition.mark_price
        );
        const newSymbolExposure = symbolExposure + orderNotional;
        const maxSymbolExposure = accountBalance * 0.5; // 50% per symbol limit

        if (newSymbolExposure > maxSymbolExposure) {
          throw new Error(
            `Symbol exposure too high. Symbol: ${request.symbol}, New exposure: ${newSymbolExposure}, Max allowed: ${maxSymbolExposure}`
          );
        }
      }

      // Rule 4: Validate against Orderly max_notional limits
      const maxNotionalLimits = accountInfo.max_notional || {};
      const symbolMaxNotional = maxNotionalLimits[request.symbol];
      if (symbolMaxNotional && orderNotional > symbolMaxNotional) {
        throw new Error(
          `Order exceeds Orderly max notional limit for ${request.symbol}. Order: ${orderNotional}, Limit: ${symbolMaxNotional}`
        );
      }

      logger.info("Position size validation passed", {
        orderNotional,
        symbol: request.symbol,
      });
    } catch (error) {
      logger.error("Position size validation failed", {
        error: error instanceof Error ? error.message : String(error),
        symbol: request.symbol,
      });
      throw error;
    }
  }

  async createOrder(request: OrderRequest): Promise<OrderResponse> {
    // Validate position size before placing order
    await this.validatePositionSize(request);

    const path = "/v1/order";
    const headers = await this.signRequest("POST", path, request);

    const response = await this.client.post(path, request, { headers });
    return {
      orderId: response.data.data.order_id.toString(),
      status: response.data.data.status || "SUBMITTED",
    };
  }

  async cancelOrder(
    orderId: string,
    symbol: string
  ): Promise<{ status: string }> {
    const path = `/v1/order?order_id=${orderId}&symbol=${symbol}`;
    const headers = await this.signRequest("DELETE", path);

    const response = await this.client.delete(path, { headers });
    return { status: response.data.data.status };
  }

  async getOrder(orderId: string): Promise<OrderResponse> {
    const path = `/v1/order/${orderId}`;
    const headers = await this.signRequest("GET", path);

    const response = await this.client.get(path, { headers });
    const data = response.data.data;
    return {
      orderId: data.order_id.toString(),
      status: data.status,
      executedPrice: data.average_executed_price,
      executedQuantity: data.executed_quantity,
    };
  }

  async getPositions(): Promise<OrderlyPosition[]> {
    const path = "/v1/positions";
    const headers = await this.signRequest("GET", path);

    const response = await this.client.get(path, { headers });
    return response.data.data.rows || [];
  }

  async getAccountInfo(): Promise<OrderlyAccountInfo> {
    const path = "/v1/client/info";
    const headers = await this.signRequest("GET", path);

    const response = await this.client.get(path, { headers });
    return response.data.data;
  }

  async getTicker(symbol: string): Promise<OrderlyTicker> {
    const path = `/v1/public/ticker?symbol=${symbol}`;
    const response = await this.client.get(path);
    return response.data.data;
  }

  async getKlines(
    symbol: string,
    interval: string = "1m",
    limit: number = 100
  ): Promise<OrderlyKline[]> {
    const path = `/v1/kline?symbol=${symbol}&type=${interval}&limit=${limit}`;
    const response = await this.client.get(path);
    return response.data.data.rows || [];
  }
}

export function createOrderlyClient(
  accountId: string,
  orderlyKey: string,
  orderlySecret: string,
  isTestnet: boolean = false
): OrderlyClient {
  const baseUrl = isTestnet
    ? "https://testnet-api.orderly.org"
    : "https://api.orderly.org";

  return new OrderlyClient({
    accountId,
    orderlyKey,
    orderlySecret,
    baseUrl,
  });
}
