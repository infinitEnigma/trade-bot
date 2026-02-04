/** @format */

import { WalletQualificationService, createWalletQualificationService, WalletQualificationServiceDependencies, QualificationResult } from '../../src/core/wallet/wallet-qualification.service.pure';

describe('WalletQualificationService', () => {
    // Create mock dependencies for the WalletQualificationService
    const createMockDependencies = (): WalletQualificationServiceDependencies => {
        return {
            userRepository: {
                findByEmail: jest.fn(),
                findByEmailWithPassword: jest.fn(),
                findById: jest.fn(),
                create: jest.fn(),
                updateUserLevel: jest.fn(),
                updateProfile: jest.fn(),
                getAuthenticatedUserData: jest.fn(),
                getWalletAddress: jest.fn(),
            },
            externalApi: {
                validateWalletChain: jest.fn(),
                checkNFTOwnership: jest.fn(),
                checkTokenBalance: jest.fn(),
                getBalance: jest.fn(),
                getPositions: jest.fn(),
                getTrades: jest.fn(),
                getAccountInfo: jest.fn(),
                testConnectivity: jest.fn(),
                invalidateUserCache: jest.fn(),
            },
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                child: jest.fn(),
            },
        };
    };

    describe('Constructor', () => {
        it('should create an instance of WalletQualificationService', () => {
            const deps = createMockDependencies();
            const walletQualificationService = new WalletQualificationService(deps);
            expect(walletQualificationService).toBeInstanceOf(WalletQualificationService);
        });

        it('should create an instance using the factory function', () => {
            const deps = createMockDependencies();
            const walletQualificationService = createWalletQualificationService(deps);
            expect(walletQualificationService).toBeInstanceOf(WalletQualificationService);
        });
    });

    describe('checkAlphaQualification', () => {
        it('should return disqualified when user has no wallet address', async () => {
            const deps = createMockDependencies();
            const walletQualificationService = new WalletQualificationService(deps);
            const testUserId = 'user-123';

            (deps.userRepository.getWalletAddress as jest.Mock).mockResolvedValue(null);

            const result = await walletQualificationService.checkAlphaQualification(testUserId);

            expect(result.qualified).toBe(false);
            expect(result.walletConnected).toBe(false);
            expect(result.chainValid).toBe(false);
            expect(result.criteria.nft).toBe(false);
            expect(result.criteria.tokens).toEqual([]);
            expect(result.reasons).toEqual(["No verified Kodiak credentials found"]);
            expect(deps.userRepository.getWalletAddress).toHaveBeenCalledWith(testUserId);
        });

        it('should return disqualified when wallet is on incorrect chain', async () => {
            const deps = createMockDependencies();
            const walletQualificationService = new WalletQualificationService(deps);
            const testUserId = 'user-123';
            const testWalletAddress = '0x1234567890123456789012345678901234567890';

            (deps.userRepository.getWalletAddress as jest.Mock).mockResolvedValue(testWalletAddress);
            (deps.externalApi.validateWalletChain as jest.Mock).mockResolvedValue(false);

            const result = await walletQualificationService.checkAlphaQualification(testUserId);

            expect(result.qualified).toBe(false);
            expect(result.walletConnected).toBe(true);
            expect(result.chainValid).toBe(false);
            expect(result.criteria.nft).toBe(false);
            expect(result.criteria.tokens).toEqual([]);
            expect(result.reasons).toEqual(expect.arrayContaining(["Wallet not connected to required chain (Base/8453)"]));
            expect(deps.externalApi.validateWalletChain).toHaveBeenCalled();
        });

        it('should return qualified when user owns the required NFT', async () => {
            const deps = createMockDependencies();
            const walletQualificationService = new WalletQualificationService(deps);
            const testUserId = 'user-123';
            const testWalletAddress = '0x1234567890123456789012345678901234567890';

            (deps.userRepository.getWalletAddress as jest.Mock).mockResolvedValue(testWalletAddress);
            (deps.externalApi.validateWalletChain as jest.Mock).mockResolvedValue(true);
            (deps.externalApi.checkNFTOwnership as jest.Mock).mockResolvedValue(true);
            (deps.externalApi.checkTokenBalance as jest.Mock).mockResolvedValue(false);

            const result = await walletQualificationService.checkAlphaQualification(testUserId);

            expect(result.qualified).toBe(true);
            expect(result.walletConnected).toBe(true);
            expect(result.chainValid).toBe(true);
            expect(result.criteria.nft).toBe(true);
            expect(result.criteria.tokens).toEqual([false]);
            expect(result.reasons).toEqual([]);
            expect(deps.externalApi.checkNFTOwnership).toHaveBeenCalled();
            expect(deps.externalApi.checkTokenBalance).toHaveBeenCalled();
        });

        it('should return qualified when user has minimum token balance', async () => {
            const deps = createMockDependencies();
            const walletQualificationService = new WalletQualificationService(deps);
            const testUserId = 'user-123';
            const testWalletAddress = '0x1234567890123456789012345678901234567890';

            (deps.userRepository.getWalletAddress as jest.Mock).mockResolvedValue(testWalletAddress);
            (deps.externalApi.validateWalletChain as jest.Mock).mockResolvedValue(true);
            (deps.externalApi.checkNFTOwnership as jest.Mock).mockResolvedValue(false);
            (deps.externalApi.checkTokenBalance as jest.Mock).mockResolvedValue(true);

            const result = await walletQualificationService.checkAlphaQualification(testUserId);

            expect(result.qualified).toBe(true);
            expect(result.walletConnected).toBe(true);
            expect(result.chainValid).toBe(true);
            expect(result.criteria.nft).toBe(false);
            expect(result.criteria.tokens).toEqual([true]);
            expect(result.reasons).toEqual([]);
            expect(deps.externalApi.checkNFTOwnership).toHaveBeenCalled();
            expect(deps.externalApi.checkTokenBalance).toHaveBeenCalled();
        });

        it('should return qualified when user has both NFT and tokens', async () => {
            const deps = createMockDependencies();
            const walletQualificationService = new WalletQualificationService(deps);
            const testUserId = 'user-123';
            const testWalletAddress = '0x1234567890123456789012345678901234567890';

            (deps.userRepository.getWalletAddress as jest.Mock).mockResolvedValue(testWalletAddress);
            (deps.externalApi.validateWalletChain as jest.Mock).mockResolvedValue(true);
            (deps.externalApi.checkNFTOwnership as jest.Mock).mockResolvedValue(true);
            (deps.externalApi.checkTokenBalance as jest.Mock).mockResolvedValue(true);

            const result = await walletQualificationService.checkAlphaQualification(testUserId);

            expect(result.qualified).toBe(true);
            expect(result.walletConnected).toBe(true);
            expect(result.chainValid).toBe(true);
            expect(result.criteria.nft).toBe(true);
            expect(result.criteria.tokens).toEqual([true]);
            expect(result.reasons).toEqual([]);
        });

        it('should return disqualified when user has neither NFT nor tokens', async () => {
            const deps = createMockDependencies();
            const walletQualificationService = new WalletQualificationService(deps);
            const testUserId = 'user-123';
            const testWalletAddress = '0x1234567890123456789012345678901234567890';

            (deps.userRepository.getWalletAddress as jest.Mock).mockResolvedValue(testWalletAddress);
            (deps.externalApi.validateWalletChain as jest.Mock).mockResolvedValue(true);
            (deps.externalApi.checkNFTOwnership as jest.Mock).mockResolvedValue(false);
            (deps.externalApi.checkTokenBalance as jest.Mock).mockResolvedValue(false);

            const result = await walletQualificationService.checkAlphaQualification(testUserId);

            expect(result.qualified).toBe(false);
            expect(result.walletConnected).toBe(true);
            expect(result.chainValid).toBe(true);
            expect(result.criteria.nft).toBe(false);
            expect(result.criteria.tokens).toEqual([false]);
            expect(result.reasons).toEqual(expect.arrayContaining(["Must own Alpha Tester NFT or hold minimum test tokens"]));
        });

        it('should handle errors gracefully', async () => {
            const deps = createMockDependencies();
            const walletQualificationService = new WalletQualificationService(deps);
            const testUserId = 'user-123';
            const testWalletAddress = '0x1234567890123456789012345678901234567890';

            (deps.userRepository.getWalletAddress as jest.Mock).mockResolvedValue(testWalletAddress);
            (deps.externalApi.validateWalletChain as jest.Mock).mockRejectedValue(new Error('API Error'));

            const result = await walletQualificationService.checkAlphaQualification(testUserId);

            expect(result.qualified).toBe(false);
            expect(result.walletConnected).toBe(true);
            expect(result.chainValid).toBe(false);
            expect(result.criteria.nft).toBe(false);
            expect(result.criteria.tokens).toEqual([]);
            expect(result.reasons).toEqual(["Qualification check failed due to system error"]);
            expect(deps.logger.error).toHaveBeenCalled();
        });

        it('should use AND logic when configuration is set to AND', async () => {
            // Save original configuration
            const originalLogic = (await import('../../src/core/wallet/wallet-qualification.service.pure')).ALPHA_QUALIFICATION_CONFIG.logic;
            (await import('../../src/core/wallet/wallet-qualification.service.pure')).ALPHA_QUALIFICATION_CONFIG.logic = 'AND';

            const deps = createMockDependencies();
            const walletQualificationService = new WalletQualificationService(deps);
            const testUserId = 'user-123';
            const testWalletAddress = '0x1234567890123456789012345678901234567890';

            (deps.userRepository.getWalletAddress as jest.Mock).mockResolvedValue(testWalletAddress);
            (deps.externalApi.validateWalletChain as jest.Mock).mockResolvedValue(true);
            (deps.externalApi.checkNFTOwnership as jest.Mock).mockResolvedValue(true);
            (deps.externalApi.checkTokenBalance as jest.Mock).mockResolvedValue(false);

            const result = await walletQualificationService.checkAlphaQualification(testUserId);

            expect(result.qualified).toBe(false);
            expect(result.reasons).toEqual(expect.arrayContaining(["Must own Alpha Tester NFT AND hold minimum test tokens"]));

            // Restore original configuration
            (await import('../../src/core/wallet/wallet-qualification.service.pure')).ALPHA_QUALIFICATION_CONFIG.logic = originalLogic;
        });
    });

    describe('getQualificationConfig', () => {
        it('should return the correct qualification configuration', () => {
            const deps = createMockDependencies();
            const walletQualificationService = new WalletQualificationService(deps);

            const config = walletQualificationService.getQualificationConfig();

            expect(config).toHaveProperty('chainId');
            expect(typeof config.chainId).toBe('number');
            expect(config).toHaveProperty('requirements');
            expect(Array.isArray(config.requirements)).toBe(true);
            expect(config.requirements.length).toBeGreaterThan(0);
            expect(config).toHaveProperty('logic');
            expect(['AND', 'OR']).toEqual(expect.arrayContaining([config.logic]));

            // Check each requirement has necessary properties
            config.requirements.forEach((req: any) => {
                expect(['nft', 'token']).toEqual(expect.arrayContaining([req.type]));
                expect(typeof req.name).toBe('string');
                expect(typeof req.contractAddress).toBe('string');
                if (req.type === 'token') {
                    expect(typeof req.minAmount).toBe('string');
                }
            });
        });

        it('should return configuration with correct contract addresses', () => {
            const deps = createMockDependencies();
            const walletQualificationService = new WalletQualificationService(deps);

            const config = walletQualificationService.getQualificationConfig();

            // Check NFT requirement contract address is valid
            const nftRequirement = config.requirements.find((req: any) => req.type === 'nft');
            expect(nftRequirement).toBeDefined();
            if (nftRequirement) {
                expect(nftRequirement.contractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
            }

            // Check token requirement contract address is valid
            const tokenRequirement = config.requirements.find((req: any) => req.type === 'token');
            expect(tokenRequirement).toBeDefined();
            if (tokenRequirement) {
                expect(tokenRequirement.contractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
            }
        });
    });
});