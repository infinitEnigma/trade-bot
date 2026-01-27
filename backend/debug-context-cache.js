const { ContextAwareLogger } = require('./src/core/logging/context-aware-logger.service');
const { setRequestContext } = require('./src/shared/utils/context');

async function debugContextCache() {
    console.log('=== Context Cache Debug ===');

    const logger = new ContextAwareLogger("debug-component");

    console.log('1. Setting initial context...');
    setRequestContext({
        correlationId: "initial-correlation-id",
        userId: "user1",
        userLevel: "BASIC",
        requestId: "request1",
        startTime: Date.now(),
    });

    console.log('2. First log call...');
    logger.info("Message with initial context");
    console.log('Cache after first call:', logger.contextCache);

    console.log('3. Setting new context...');
    setRequestContext({
        correlationId: "new-correlation-id",
        userId: "user2",
        userLevel: "VERIFIED",
        requestId: "request2",
        startTime: Date.now(),
    });

    console.log('4. Current context correlation ID:', logger.getCorrelationId ? logger.getCorrelationId() : 'N/A');
    console.log('5. Cache before second call:', logger.contextCache);

    console.log('6. Second log call...');
    logger.info("Message with new context");
    console.log('7. Cache after second call:', logger.contextCache);
}

debugContextCache().catch(console.error);