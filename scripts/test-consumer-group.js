const { createClient } = require('redis');

async function testConsumerGroup() {
    const client = createClient();
    
    try {
        await client.connect();
        console.log('Connected to Redis');

        const testStream = 'test:consumer-group-stream';
        
        // Clean up any existing test stream and consumer group
        try {
            await client.del(testStream);
            await client.xGroupDestroy(testStream, 'test-group');
        } catch (error) {
            // Ignore errors if stream or group doesn't exist
        }
        
        // Publish a message to the stream
        const publishResult = await client.xAdd(testStream, '*', {
            data: 'Test message'
        });
        console.log('Published message with id:', publishResult);
        
        // Check stream information and messages
        const infoBeforeGroup = await client.xInfoStream(testStream);
        console.log('Stream length before creating group:', infoBeforeGroup.length);
        
        const messagesBeforeGroup = await client.xRange(testStream, '-', '+');
        console.log('Messages before creating group:', messagesBeforeGroup.map(m => m.id));
        
        // Create consumer group with start id 0
        console.log('Creating consumer group...');
        await client.xGroupCreate(testStream, 'test-group', '0');
        
        // Try to read messages from consumer group
        console.log('Reading from consumer group with id="0" (autoAck: false)...');
        const readResult = await client.xReadGroup(
            'test-group',
            'test-consumer',
            { key: testStream, id: '0' },
            {
                BLOCK: 0,
                COUNT: 10
            }
        );
        
        console.log('xReadGroup result:', readResult);
        
        if (readResult) {
            const messages = readResult.flatMap(group =>
                group.messages.map(msg => ({
                    id: msg.id,
                    data: msg.message
                }))
            );
            console.log('Messages received:', messages);
            
            if (messages.length > 0) {
                console.log('Acking message:', messages[0].id);
                const ackResult = await client.xAck(testStream, 'test-group', [messages[0].id]);
                console.log('xAck result:', ackResult);
            }
        }
        
        // Clean up
        await client.xGroupDestroy(testStream, 'test-group');
        await client.del(testStream);
        
    } catch (error) {
        console.error('Error:', error);
        console.error('Stack:', error.stack);
    } finally {
        await client.quit();
    }
}

testConsumerGroup();