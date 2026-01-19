/** @format */

import { UserRole } from "@trade-bot/shared";
import { query } from "../database/pool";
import logger from "./logger";

// Qualification criteria configuration
const ALPHA_QUALIFICATION_CONFIG = {
    chainId: 8453, // Base chain ID
    requirements: [
        // NFT ownership requirement
        {
            type: 'nft' as const,
            contractAddress: process.env.ALPHA_NFT_CONTRACT || '0x1234567890123456789012345678901234567890',
            name: 'TradeBot Alpha Tester NFT'
        },
        // Token balance requirement
        {
            type: 'token' as const,
            contractAddress: process.env.ALPHA_TOKEN_CONTRACT || '0x0987654321098765432109876543210987654321',
            minAmount: BigInt(process.env.ALPHA_MIN_TOKEN_AMOUNT || '1000000000000000000'), // 1 token in wei
            name: 'TradeBot Alpha Test Token'
        }
    ],
    // Logic: 'AND' requires all criteria, 'OR' requires any one
    logic: 'OR' as 'AND' | 'OR'
};

export interface QualificationResult {
    qualified: boolean;
    walletConnected: boolean;
    chainValid: boolean;
    criteria: {
        nft: boolean;
        tokens: boolean[];
    };
    reasons: string[];
}

export class WalletQualificationService {
    /**
     * Check if user qualifies for QUALIFIED_ALPHA role
     */
    async checkAlphaQualification(userId: string): Promise<QualificationResult> {
        const result: QualificationResult = {
            qualified: false,
            walletConnected: false,
            chainValid: false,
            criteria: { nft: false, tokens: [] },
            reasons: []
        };

        try {
            // Get user's wallet address from kodiak_credentials
            const credsResult = await query(
                "SELECT wallet_address FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
                [userId]
            );

            if (credsResult.rows.length === 0) {
                result.reasons.push("No verified Kodiak credentials found");
                return result;
            }

            const walletAddress = credsResult.rows[0].wallet_address;
            if (!walletAddress) {
                result.reasons.push("No wallet address associated with Kodiak account");
                return result;
            }

            result.walletConnected = true;
            logger.info("Checking alpha qualification", { userId, walletAddress });

            // Validate wallet is on correct chain (this would need RPC call in real implementation)
            const chainValid = await this.validateWalletChain(walletAddress);
            result.chainValid = chainValid;

            if (!chainValid) {
                result.reasons.push(`Wallet not connected to required chain (Base/${ALPHA_QUALIFICATION_CONFIG.chainId})`);
                return result;
            }

            // Check qualification criteria
            const nftQualified = await this.checkNFTOwnership(walletAddress, ALPHA_QUALIFICATION_CONFIG.requirements[0].contractAddress);
            result.criteria.nft = nftQualified;

            const tokenRequirement = ALPHA_QUALIFICATION_CONFIG.requirements[1];
            const tokenQualified = tokenRequirement.type === 'token' && tokenRequirement.minAmount
                ? await this.checkTokenBalance(walletAddress, tokenRequirement.contractAddress, tokenRequirement.minAmount)
                : false;
            result.criteria.tokens = [tokenQualified];

            // Determine qualification based on logic
            if (ALPHA_QUALIFICATION_CONFIG.logic === 'OR') {
                result.qualified = nftQualified || tokenQualified;
            } else {
                result.qualified = nftQualified && tokenQualified;
            }

            if (!result.qualified) {
                if (ALPHA_QUALIFICATION_CONFIG.logic === 'OR') {
                    result.reasons.push("Must own Alpha Tester NFT or hold minimum test tokens");
                } else {
                    result.reasons.push("Must own Alpha Tester NFT AND hold minimum test tokens");
                }
            }

            logger.info("Alpha qualification check completed", {
                userId,
                walletAddress,
                qualified: result.qualified,
                criteria: result.criteria,
                reasons: result.reasons
            });

            return result;

        } catch (error) {
            logger.error("Alpha qualification check failed", {
                userId,
                error: (error as Error).message
            });
            result.reasons.push("Qualification check failed due to system error");
            return result;
        }
    }

    /**
     * Validate wallet is connected to correct chain
     * In real implementation, this would query the blockchain RPC
     */
    private async validateWalletChain(walletAddress: string): Promise<boolean> {
        try {
            // For now, assume all wallets are on correct chain
            // In production, this would:
            // 1. Check wallet's connected chain via RPC
            // 2. Verify it's Base chain (8453)
            // 3. Return true/false based on validation

            logger.debug("Wallet chain validation", { walletAddress, requiredChain: ALPHA_QUALIFICATION_CONFIG.chainId });
            return true; // Placeholder - implement actual chain validation
        } catch (error) {
            logger.error("Wallet chain validation failed", { walletAddress, error: (error as Error).message });
            return false;
        }
    }

    /**
     * Check NFT ownership
     * In real implementation, this would query the NFT contract
     */
    private async checkNFTOwnership(walletAddress: string, contractAddress: string): Promise<boolean> {
        try {
            // Placeholder implementation
            // In production, this would:
            // 1. Use ethers.js or web3.js to query NFT contract
            // 2. Call balanceOf(walletAddress) or ownerOf(tokenId)
            // 3. Return true if wallet owns required NFT

            logger.debug("Checking NFT ownership", { walletAddress, contractAddress });
            return false; // Placeholder - implement actual NFT checking
        } catch (error) {
            logger.error("NFT ownership check failed", {
                walletAddress,
                contractAddress,
                error: (error as Error).message
            });
            return false;
        }
    }

    /**
     * Check token balance
     * In real implementation, this would query the token contract
     */
    private async checkTokenBalance(walletAddress: string, tokenAddress: string, minAmount: bigint): Promise<boolean> {
        try {
            // Placeholder implementation
            // In production, this would:
            // 1. Use ethers.js to query ERC-20 contract
            // 2. Call balanceOf(walletAddress)
            // 3. Compare with minAmount

            logger.debug("Checking token balance", { walletAddress, tokenAddress, minAmount: minAmount.toString() });
            return false; // Placeholder - implement actual token balance checking
        } catch (error) {
            logger.error("Token balance check failed", {
                walletAddress,
                tokenAddress,
                error: (error as Error).message
            });
            return false;
        }
    }

    /**
     * Get qualification configuration (for frontend display)
     */
    getQualificationConfig() {
        return {
            chainId: ALPHA_QUALIFICATION_CONFIG.chainId,
            requirements: ALPHA_QUALIFICATION_CONFIG.requirements.map(req => ({
                type: req.type,
                name: req.name,
                contractAddress: req.contractAddress,
                minAmount: req.type === 'token' ? req.minAmount.toString() : undefined
            })),
            logic: ALPHA_QUALIFICATION_CONFIG.logic
        };
    }
}

// Export singleton instance
export const walletQualificationService = new WalletQualificationService();
