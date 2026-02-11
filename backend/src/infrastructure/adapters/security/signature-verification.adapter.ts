/**
 * Signature Verification Service Adapter
 *
 * Implements ISignatureVerificationService interface using ethers.js for signature verification.
 * This adapter provides a clean abstraction for verifying wallet signatures.
 *
 * @format
 */

import { ISignatureVerificationService } from '@trade-bot/shared';

/**
 * Signature Verification Service Adapter
 *
 * Uses ethers.js to verify Ethereum wallet signatures.
 */
export class SignatureVerificationServiceAdapter implements ISignatureVerificationService {
    /**
     * Verify that a signature is valid for the given wallet address and message
     * @param walletAddress - The wallet address that should have signed the message
     * @param signature - The signature to verify
     * @param message - The message that was signed
     * @returns Promise<boolean> - True if the signature is valid, false otherwise
     */
    async verifySignature(walletAddress: string, signature: string, message: string): Promise<boolean> {
        try {
            const { ethers } = await import('ethers');

            // Recover the address from the signature
            const recoveredAddress = ethers.verifyMessage(message, signature);

            // Normalize addresses for comparison (remove checksum, lowercase)
            const normalizedRecovered = recoveredAddress.toLowerCase().trim();
            const normalizedWalletAddress = walletAddress.toLowerCase().trim();

            return normalizedRecovered === normalizedWalletAddress;
        } catch (error) {
            // If verification fails for any reason (invalid signature, malformed address, etc.), return false
            console.error('Signature verification failed:', error);
            return false;
        }
    }
}

// Export singleton instance
export const signatureVerificationServiceAdapter = new SignatureVerificationServiceAdapter();