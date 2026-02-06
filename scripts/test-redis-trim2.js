const { createClient } = require('redis');

async function testTrim() {
    const client = createClient();
    
    try {
        await client.connect();
        console.log('Connected to Redis');

        const testStream1 = 'test:stream:exact';
        const testStream2 = 'test:stream:approx';
        
        // Clean up any existing test streams
        await client.del(testStream1);
        await client.del(testStream2);
        
        // Add 50 messages to each stream
        for (let i = 0; i < 50; i++) {
            await client.xAdd(testStream1, '*', {
                data: `Test message ${i}`
            });
            await client.xAdd(testStream2, '*', {
                data: `Test message ${i}`
            });
        }
        
        // Test 1: Exact trimming with MAXLEN = 10
        const infoBefore1 = await client.xInfoStream(testStream1);
        console.log('Stream length before exact trim:', infoBefore1.length);
        
        console.log('Trimming with XTRIM', testStream1, 'MAXLEN =', 10);
        const trimResult1 = await client.xTrim(testStream1, 'MAXLEN', 10, { strategyModifier: '=' });
        console.log('xTrim exact returned:', trimResult1);
        
        const infoAfter1 = await client.xInfoStream(testStream1);
        console.log('Stream length after exact trim:', infoAfter1.length);
        
        // Test 2: Approximate trimming with MAXLEN ~ 10
        const infoBefore2 = await client.xInfoStream(testStream2);
        //console.log('Stream length before approximate trim:', infoBefore2.length);
        
        console.log('Trimming with XTRIM', testStream2, 'MAXLEN ~', 10);
        const trimResult2 = await client.xTrim(testStream2, 'MAXLEN', 10, { strategyModifier: '~' });
        console.log('xTrim approximate returned:', trimResult2);
        
        const infoAfter2 = await client.xInfoStream(testStream2);
        console.log('Stream length after approximate trim:', infoAfter2.length);
        
        // Test 3: Check if we can trim with different syntax
        const testStream3 = 'test:stream:different';
        await client.del(testStream3);
        for (let i = 0; i < 50; i++) {
            await client.xAdd(testStream3, '*', {
                data: `Test message ${i}`
            });
        }
        
        const infoBefore3 = await client.xInfoStream(testStream3);
        console.log('Stream length before different syntax trim:', infoBefore3.length);
        
        // Try with actual Redis command string
        const rawResult = await client.sendCommand(['XTRIM', testStream3, 'MAXLEN', '10']);
        console.log('XTRIM MAXLEN 10 returned:', rawResult);
        
        const infoAfter3 = await client.xInfoStream(testStream3);
        console.log('Stream length after different syntax trim:', infoAfter3.length);
        
        // Clean up
        await client.del(testStream1);
        await client.del(testStream2);
        await client.del(testStream3);
        
    } catch (error) {
        console.error('Error:', error);
        console.error('Stack:', error.stack);
    } finally {
        await client.quit();
    }
}

testTrim();