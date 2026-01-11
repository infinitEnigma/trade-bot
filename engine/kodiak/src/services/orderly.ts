/** @format */

import axios, { AxiosInstance } from "axios";
import { OrderRequest, OrderResponse } from "../types/strategy";
import { createHash } from "crypto";
import * as ed25519 from "@noble/ed25519";

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
    const message = `${timestamp}${method}${path}${body || ""}`;
    const privateKeyBytes = Buffer.from(this.config.orderlySecret, "base64");
    const messageBytes = new TextEncoder().encode(message);
    const hash = createHash("sha256").update(messageBytes).digest();
    const signature = await ed25519.sign(hash, privateKeyBytes);
    return Buffer.from(signature).toString("base64url");
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

  async createOrder(request: OrderRequest): Promise<OrderResponse> {
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

  async getPositions(): Promise<any[]> {
    const path = "/v1/positions";
    const headers = await this.signRequest("GET", path);

    const response = await this.client.get(path, { headers });
    return response.data.data.rows || [];
  }

  async getAccountInfo(): Promise<any> {
    const path = "/v1/client/info";
    const headers = await this.signRequest("GET", path);

    const response = await this.client.get(path, { headers });
    return response.data.data;
  }

  async getTicker(symbol: string): Promise<any> {
    const path = `/v1/public/ticker?symbol=${symbol}`;
    const response = await this.client.get(path);
    return response.data.data;
  }

  async getKlines(
    symbol: string,
    interval: string = "1m",
    limit: number = 100
  ): Promise<any[]> {
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
