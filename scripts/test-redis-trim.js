const { createClient } = require('redis');

async function testTrim() {
    const client = createClient();
    
    try {
        await client.connect();
        console.log('Connected to Redis');

        const testStream = 'test:stream:direct';
        
        // Clean up any existing test stream
        await client.del(testStream);
        
        // Add 50 messages to the stream
        for (let i = 0; i < 50; i++) {
            await client.xAdd(testStream, '*', {
                data: `Test message ${i}`
            });
        }
        
        // Get stream length before trim
        const infoBefore = await client.xInfoStream(testStream);
        console.log('Stream length before trim:', infoBefore.length);
        
        // Try to trim with MAXLEN ~ 10
        console.log('Trimming with XTRIM', testStream, 'MAXLEN ~', 10);
        const trimResult = await client.xTrim(testStream, 'MAXLEN', 10, { strategyModifier: '~' });
        console.log('xTrim returned:', trimResult);
        const trimResultAprox = await client.xTrim(testStream, 'MAXLEN', '10', '~');
        console.log('xTrim returned:', trimResultAprox);
        // Get stream length after trim
        const infoAfter = await client.xInfoStream(testStream);
        console.log('Stream length after trim:', infoAfter.length);
        
        // Also try with raw command
        const testStream2 = 'test:stream:raw';
        await client.del(testStream2);
        for (let i = 0; i < 50; i++) {
            await client.xAdd(testStream2, '*', {
                data: `Test message ${i}`
            });
        }
        const infoBefore2 = await client.xInfoStream(testStream2);
        console.log('Stream length before raw trim:', infoBefore2.length);
        console.log('Trimming with raw command');
        const rawResult = await client.sendCommand(['XTRIM', testStream2, 'MAXLEN', '~', '10']);
        console.log('Raw command returned:', rawResult);
        const infoAfter2 = await client.xInfoStream(testStream2);
        console.log('Stream length after raw trim:', infoAfter2.length);
        
        // Clean up
        await client.del(testStream);
        await client.del(testStream2);
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.quit();
    }
}

testTrim();