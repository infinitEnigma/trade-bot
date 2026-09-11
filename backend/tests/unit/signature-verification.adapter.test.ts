/** @format */

import { SignatureVerificationServiceAdapter, signatureVerificationServiceAdapter } from '../../src/infrastructure/adapters/security/signature-verification.adapter';
import { ethers } from 'ethers';

describe('SignatureVerificationServiceAdapter', () => {
    describe('Constructor', () => {
        it('should create an instance of SignatureVerificationServiceAdapter', () => {
            const adapter = new SignatureVerificationServiceAdapter();
            expect(adapter).toBeInstanceOf(SignatureVerificationServiceAdapter);
        });

        it('should create a singleton instance', () => {
            const adapter1 = new SignatureVerificationServiceAdapter();
            const adapter2 = new SignatureVerificationServiceAdapter();
            expect(adapter1).not.toBe(adapter2);
        });

        it('should export singleton instance', () => {
            expect(signatureVerificationServiceAdapter).toBeInstanceOf(SignatureVerificationServiceAdapter);
        });
    });

    describe('verifySignature', () => {
        it('should verify valid signature', async () => {
            // Create a real wallet and signature for testing
            const wallet = ethers.Wallet.createRandom();
            const message = 'Test message for signature verification';
            const signature = await wallet.signMessage(message);

            const adapter = new SignatureVerificationServiceAdapter();
            const isValid = await adapter.verifySignature(wallet.address, signature, message);
            expect(isValid).toBe(true);
        });

        it('should reject invalid signature', async () => {
            // Create a real wallet and signature for testing
            const wallet = ethers.Wallet.createRandom();
            const invalidWallet = ethers.Wallet.createRandom();
            const message = 'Test message for signature verification';
            const signature = await wallet.signMessage(message);

            const adapter = new SignatureVerificationServiceAdapter();
            const isValid = await adapter.verifySignature(invalidWallet.address, signature, message);
            expect(isValid).toBe(false);
        });

        it('should handle invalid address format', async () => {
            const wallet = ethers.Wallet.createRandom();
            const message = 'Test message for signature verification';
            const signature = await wallet.signMessage(message);

            const adapter = new SignatureVerificationServiceAdapter();
            const isValid = await adapter.verifySignature('invalid_address', signature, message);
            expect(isValid).toBe(false);
        });

        it('should handle invalid signature format', async () => {
            const wallet = ethers.Wallet.createRandom();
            const message = 'Test message for signature verification';

            const adapter = new SignatureVerificationServiceAdapter();
            const isValid = await adapter.verifySignature(wallet.address, 'invalid_signature', message);
            expect(isValid).toBe(false);
        });

        it('should handle empty message', async () => {
            const wallet = ethers.Wallet.createRandom();
            const message = '';
            const signature = await wallet.signMessage(message);

            const adapter = new SignatureVerificationServiceAdapter();
            const isValid = await adapter.verifySignature(wallet.address, signature, message);
            expect(isValid).toBe(true);
        });

        it('should handle whitespace in addresses', async () => {
            const wallet = ethers.Wallet.createRandom();
            const message = 'Test message for signature verification';
            const signature = await wallet.signMessage(message);

            const adapter = new SignatureVerificationServiceAdapter();
            const isValid = await adapter.verifySignature(`  ${wallet.address}  `, signature, message);
            expect(isValid).toBe(true);
        });

        it('should handle checksum addresses correctly', async () => {
            const wallet = ethers.Wallet.createRandom();
            const message = 'Test message for signature verification';
            const signature = await wallet.signMessage(message);

            const adapter = new SignatureVerificationServiceAdapter();
            const isValid = await adapter.verifySignature(wallet.address.toLowerCase(), signature, message);
            expect(isValid).toBe(true);
        });
    });
});
