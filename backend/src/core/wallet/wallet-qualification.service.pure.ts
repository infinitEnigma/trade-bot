/**
 * Pure Wallet Qualification Service - Clean Architecture Implementation
 *
 * Business logic for wallet qualification with complete infrastructure abstraction.
 * This service contains pure business logic and depends only on interfaces from shared.
 *
 * Dependencies (injected):
 * - IUserRepository: User data access abstraction
 * - IExternalApiService: External API abstraction for wallet validation
 * - ILogger: Logging abstraction
 *
 * @format
 */

import { IUserRepository, IExternalApiService, ILogger } from '@trade-bot/shared';

// Qualification criteria configuration
export const ALPHA_QUALIFICATION_CONFIG = {
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

export type QualificationStatus = 'pending' | 'qualified' | 'disqualified' | 'expired';

export interface WalletRequirements {
    chainId: number;
    requirements: Array<{
        type: 'nft' | 'token';
        contractAddress: string;
        name: string;
        minAmount?: bigint;
    }>;
    logic: 'AND' | 'OR';
}

export interface WalletQualificationServiceDependencies {
    userRepository: IUserRepository;
    externalApi: IExternalApiService;
    logger: ILogger;
}

/**
 * Pure Wallet Qualification Service
 *
 * Implements wallet qualification business logic using dependency injection.
 * No direct dependencies on databases, external APIs, or blockchain clients.
 */
export class WalletQualificationService {
    constructor(private deps: WalletQualificationServiceDependencies) { }

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
            // Get user's wallet address from repository (injected dependency)
            const walletAddress = await this.deps.userRepository.getWalletAddress(userId);

            if (!walletAddress) {
                result.reasons.push("No verified Kodiak credentials found");
                return result;
            }

            result.walletConnected = true;
            this.deps.logger.info("Checking alpha qualification", { userId, walletAddress });

            // Validate wallet is on correct chain using external API (injected dependency)
            const chainValid = await this.deps.externalApi.validateWalletChain(walletAddress, ALPHA_QUALIFICATION_CONFIG.chainId);
            result.chainValid = chainValid;

            if (!chainValid) {
                result.reasons.push(`Wallet not connected to required chain (Base/${ALPHA_QUALIFICATION_CONFIG.chainId})`);
                return result;
            }

            // Check qualification criteria
            const nftQualified = await this.deps.externalApi.checkNFTOwnership(walletAddress, ALPHA_QUALIFICATION_CONFIG.requirements[0].contractAddress);
            result.criteria.nft = nftQualified;

            const tokenRequirement = ALPHA_QUALIFICATION_CONFIG.requirements[1];
            const tokenQualified = tokenRequirement.type === 'token' && tokenRequirement.minAmount
                ? await this.deps.externalApi.checkTokenBalance(walletAddress, tokenRequirement.contractAddress, tokenRequirement.minAmount)
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

            this.deps.logger.info("Alpha qualification check completed", {
                userId,
                walletAddress,
                qualified: result.qualified,
                criteria: result.criteria,
                reasons: result.reasons
            });

            return result;

        } catch (error) {
            this.deps.logger.error("Alpha qualification check failed", {
                userId,
                error: (error as Error).message
            });
            result.reasons.push("Qualification check failed due to system error");
            return result;
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

// Export factory function for creating service instances
export function createWalletQualificationService(deps: WalletQualificationServiceDependencies): WalletQualificationService {
    return new WalletQualificationService(deps);
}