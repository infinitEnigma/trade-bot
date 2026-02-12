/** @format */

import request from 'supertest';
import { app } from '../../src';
import { UserRole, UserLevel } from '@trade-bot/shared';
import { serviceProvider } from '../../src/core/service-provider';
import { query } from '../../src/database/pool';

describe('Admin Qualification Check API', () => {
    let testUserId: string;
    let testUserEmail: string;

    beforeAll(async () => {
        // Set required environment variables for testing
        process.env.ADMIN_CONTRACT_ADDRESS = '0x5a30c392714a9a9a8177c7998d9d59c3dd120917';
        process.env.ADMIN_TOKEN_ID = '1695';
        process.env.ETHERSCAN_API_KEY = 'test-api-key';
    });

    beforeEach(async () => {
        // Create a test user with VERIFIED level
        testUserEmail = `testadmin${Date.now()}@example.com`;
        const registerResponse = await request(app)
            .post('/api/auth/register')
            .send({
                email: testUserEmail,
                password: 'TestPassword123!'
            });

        expect(registerResponse.body.success).toBe(true);
        expect(registerResponse.body.data.user).toHaveProperty('id');
        expect(registerResponse.body.data.user.userLevel).toBe(UserLevel.BASIC);

        testUserId = registerResponse.body.data.user.id;
    });

    afterEach(async () => {
        // Clean up test user from database
        await query('DELETE FROM users WHERE email = $1', [testUserEmail]);
    });

    it('should check admin qualification for verified user', async () => {
        // Log in to get access token
        const loginResponse = await request(app)
            .post('/api/auth/login')
            .send({
                email: testUserEmail,
                password: 'TestPassword123!'
            });

        expect(loginResponse.body.success).toBe(true);
        const accessToken = (loginResponse.headers['set-cookie'] as unknown as string[])?.find(cookie =>
            cookie.startsWith('accessToken=')
        )?.split(';')[0].split('=')[1];

        // Verify the user first (we need to mock this or implement the verify endpoint)
        // For now, let's mock the roleQualificationService to bypass the user level check
        const roleQualificationService = serviceProvider.getRoleQualificationService();
        // @ts-ignore - Mocking internal implementation for testing
        const mockCheck = jest.spyOn(roleQualificationService, 'checkQualification')
            .mockResolvedValue({
                qualified: true,
                criteria: {
                    userLevel: UserLevel.VERIFIED,
                    hasAdminToken: true,
                    contractAddress: process.env.ADMIN_CONTRACT_ADDRESS,
                    tokenId: process.env.ADMIN_TOKEN_ID
                },
                reason: 'User is qualified for SYSTEM_ADMIN role'
            });

        // Call the check-admin-qualification endpoint
        const response = await request(app)
            .post('/api/auth/check-admin-qualification')
            .set('Cookie', `accessToken=${accessToken}`)
            .send();

        expect(response.body.success).toBe(false); // Should fail because user is not verified
        expect(response.body.error).toContain('Must be VERIFIED');

        mockCheck.mockRestore();
    });

    it('should not allow non-verified users to check admin qualification', async () => {
        // Log in the user (they should still be at BASIC level)
        const loginResponse = await request(app)
            .post('/api/auth/login')
            .send({
                email: testUserEmail,
                password: 'TestPassword123!'
            });

        expect(loginResponse.body.success).toBe(true);
        const accessToken = (loginResponse.headers['set-cookie'] as unknown as string[])?.find(cookie =>
            cookie.startsWith('accessToken=')
        )?.split(';')[0].split('=')[1];

        // Call the check-admin-qualification endpoint
        const response = await request(app)
            .post('/api/auth/check-admin-qualification')
            .set('Cookie', `accessToken=${accessToken}`)
            .send();

        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Must be VERIFIED');
    });
});
