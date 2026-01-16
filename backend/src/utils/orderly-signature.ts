/** @format */

/**
 * Generates an Ed25519 signature for Kodiak/Orderly API requests
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - API endpoint path (e.g., "/v1/client/info")
 * @param body - Request body as string (empty string for GET requests)
 * @param secretKey - Base64-encoded Ed25519 private key
 * @returns Base64URL-encoded signature
 */

export async function generateOrderlySignature(
  timestamp: number,
  method: string,
  path: string,
  body: string,
  secretKey: string
): Promise<string> {
  return generateKodiakSignature(timestamp, method, path, body, secretKey);
}

/**
 * Generate Kodiak signature using Ed25519
*/ 
export async function generateKodiakSignature(
  timestamp: number,
  method: string,
  path: string,
  body: string,
  secretKey: string
): Promise<string> {
  try {
    const bs58 = await import("bs58");
    const ed25519 = await import("@noble/ed25519");

    const message = `${timestamp}${method}${path}${body}`;

    const privateKey = bs58.default.decode(secretKey);
    const messageBytes = new TextEncoder().encode(message);

    const signature = await ed25519.sign(messageBytes, privateKey);
    return Buffer.from(signature).toString("base64url");
}
  catch (error) {
    throw new Error(
      `Failed to generate Kodiak signature: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
