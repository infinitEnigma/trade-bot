/** @format */

import { pool, isMockDatabase } from '../../src/database/index';
import { Pool } from 'pg';

describe('Database Index Tests', () => {
    describe('Module Exports', () => {
        it('should export pool instance', () => {
            expect(pool).toBeDefined();
            expect(pool).toBeInstanceOf(Pool);
        });

        it('should export isMockDatabase flag', () => {
            expect(isMockDatabase).toBeDefined();
            expect(typeof isMockDatabase).toBe('boolean');
        });

        it('should have correct default values for isMockDatabase', () => {
            expect(isMockDatabase).toBe(false);
        });
    });

    describe('Pool Configuration', () => {
        it('should create pool with correct configuration defaults', () => {
            // Check if pool is correctly instantiated
            expect(pool).toBeDefined();

            // Verify pool has necessary properties
            expect(typeof pool.query).toBe('function');
            expect(typeof pool.connect).toBe('function');
        });
    });
});