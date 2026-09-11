/**
 * Password Worker Thread Script
 * 
 * This file is used by the password worker pool to handle
 * password hashing and comparison operations in worker threads.
 */

const { parentPort } = require('worker_threads');
const bcrypt = require('bcryptjs');

// Worker state tracking
let isHealthy = true;
let lastActivity = Date.now();
let isShuttingDown = false;

// Health check mechanism with improved timeout handling
const healthCheckInterval = setInterval(() => {
  if (isShuttingDown) return;
  
  const now = Date.now();
  const idleTime = now - lastActivity;
  
  if (idleTime > 60000) { // No activity for 1 minute
    console.warn('Worker: No activity for 60 seconds, sending heartbeat');
    try {
      parentPort.postMessage({
        type: 'heartbeat',
        timestamp: now,
        idleTime
      });
    } catch (error) {
      console.error('Worker: Failed to send heartbeat', error);
    }
  }
  
  // Force garbage collection if available to prevent memory leaks
  if (idleTime > 120000 && global.gc) { // 2 minutes
    try {
      global.gc();
    } catch (error) {
      console.warn('Worker: GC not available or failed', error);
    }
  }
}, 30000); // Check every 30 seconds

parentPort.on('message', async (message) => {
  if (isShuttingDown) {
    console.warn('Worker: Received message while shutting down, ignoring');
    return;
  }

  const { id, action, data } = message;
  lastActivity = Date.now();

  try {
    switch (action) {
      case 'hash': {
        const { password, rounds } = data;
        
        // Validate input with enhanced validation
        if (!password || typeof password !== 'string' || password.length === 0) {
          throw new Error('Invalid password: must be a non-empty string');
        }
        if (!rounds || typeof rounds !== 'number' || rounds < 4 || rounds > 20) {
          throw new Error('Invalid rounds: must be a number between 4 and 20');
        }

        // Enhanced timeout protection for bcrypt operations
        const hashPromise = bcrypt.hash(password, rounds);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Hash operation timeout')), 25000); // Reduced to 25s for better responsiveness
        });

        const hash = await Promise.race([hashPromise, timeoutPromise]);
        
        // Validate result
        if (!hash || typeof hash !== 'string' || hash.length < 50) {
          throw new Error('Invalid hash result from bcrypt');
        }
        
        parentPort.postMessage({ 
          id, 
          success: true, 
          result: hash,
          timestamp: Date.now(),
          duration: Date.now() - lastActivity
        });
        break;
      }

      case 'compare': {
        const { password: comparePassword, hash } = data;
        
        // Validate input with enhanced validation
        if (!comparePassword || typeof comparePassword !== 'string' || comparePassword.length === 0) {
          throw new Error('Invalid password: must be a non-empty string');
        }
        if (!hash || typeof hash !== 'string' || hash.length < 50) {
          throw new Error('Invalid hash: must be a non-empty string with minimum length');
        }

        // Enhanced timeout protection for bcrypt operations
        const comparePromise = bcrypt.compare(comparePassword, hash);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Compare operation timeout')), 25000); // Reduced to 25s for better responsiveness
        });

        const isValid = await Promise.race([comparePromise, timeoutPromise]);
        
        // Validate result
        if (typeof isValid !== 'boolean') {
          throw new Error('Invalid comparison result from bcrypt');
        }
        
        parentPort.postMessage({ 
          id, 
          success: true, 
          result: isValid,
          timestamp: Date.now(),
          duration: Date.now() - lastActivity
        });
        break;
      }

      case 'healthCheck': {
        parentPort.postMessage({
          id,
          success: true,
          result: {
            healthy: isHealthy,
            lastActivity,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            isShuttingDown
          },
          timestamp: Date.now()
        });
        break;
      }

      case 'shutdown': {
        // Graceful shutdown request
        isShuttingDown = true;
        parentPort.postMessage({
          id,
          success: true,
          result: 'Worker shutting down gracefully',
          timestamp: Date.now()
        });
        break;
      }

      default:
        parentPort.postMessage({
          id,
          success: false,
          error: 'Unknown action: ' + action,
          timestamp: Date.now()
        });
    }
  } catch (error) {
    console.error('Worker error:', error);
    parentPort.postMessage({
      id,
      success: false,
      error: error.message || 'Unknown error',
      stack: error.stack,
      timestamp: Date.now()
    });
  }
});

// Handle uncaught errors to prevent worker crashes
process.on('uncaughtException', (error) => {
  console.error('Worker uncaught exception:', error);
  isHealthy = false;
  
  try {
    parentPort.postMessage({
      type: 'uncaughtException',
      error: error.message,
      stack: error.stack,
      timestamp: Date.now()
    });
  } catch (postError) {
    console.error('Worker: Failed to post uncaught exception message:', postError);
  }
  
  // Don't exit the worker immediately, let main thread handle replacement
  // This allows for better error recovery
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Worker unhandled promise rejection:', reason);
  isHealthy = false;
  
  try {
    parentPort.postMessage({
      type: 'unhandledRejection',
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      timestamp: Date.now()
    });
  } catch (postError) {
    console.error('Worker: Failed to post unhandled rejection message:', postError);
  }
  
  // Don't exit the worker immediately, let main thread handle replacement
  // This allows for better error recovery
});

// Handle worker termination gracefully
process.on('SIGTERM', () => {
  console.log('Worker: Received SIGTERM, shutting down gracefully');
  isShuttingDown = true;
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Worker: Received SIGINT, shutting down gracefully');
  isShuttingDown = true;
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  process.exit(0);
});

// Handle worker initialization with enhanced error handling
try {
  parentPort.postMessage({
    type: 'initialized',
    timestamp: Date.now(),
    pid: process.pid,
    uptime: process.uptime()
  });
} catch (error) {
  console.error('Worker: Failed to send initialization message:', error);
  process.exit(1);
}
