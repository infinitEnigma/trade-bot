const { createClient } = require('redis');

async function testXReadGroup() {
    const client = createClient();
    await client.connect();

    const TEST_STREAM = 'test:xreadgroup';
    const TEST_GROUP = 'test-group';

    try {
        // Cleanup
        await client.del(TEST_STREAM);
        try {
            await client.xGroupDestroy(TEST_STREAM, TEST_GROUP);
        } catch (e) {}

        // Create consumer group with start id 0
        await client.xGroupCreate(TEST_STREAM, TEST_GROUP, '0', { MKSTREAM: true });
        console.log('Consumer group created');

        // Publish a message
        const msgId = await client.xAdd(TEST_STREAM, '*', { data: 'test' });
        console.log('Message published with id:', msgId);

        // Check stream info and messages
        console.log('Stream length:', (await client.xInfoStream(TEST_STREAM)).length);
        console.log('Stream messages:', await client.xRange(TEST_STREAM, '-', '+'));

        // Try to read with id >
        console.log('\nReading with id ">":');
        let readResult = await client.xReadGroup(
            TEST_GROUP,
            'test-consumer',
            [{ key: TEST_STREAM, id: '>' }],
            { BLOCK: 1000, COUNT: 10 }
        );
        console.log('Result:', readResult);
        if (readResult) {
            console.log('Messages:', readResult[0].messages);
        }

        // Try to read with id 0
        console.log('\nReading with id "0":');
        readResult = await client.xReadGroup(
            TEST_GROUP,
            'test-consumer',
            [{ key: TEST_STREAM, id: '0' }],
            { BLOCK: 1000, COUNT: 10 }
        );
        console.log('Result:', readResult);
        if (readResult) {
            console.log('Messages:', readResult[0].messages);
        }

        // Check consumer group info
        console.log('\nConsumer group info:', await client.xInfoGroups(TEST_STREAM));
        console.log('Consumers:', await client.xInfoConsumers(TEST_STREAM, TEST_GROUP));

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.xGroupDestroy(TEST_STREAM, TEST_GROUP);
        await client.del(TEST_STREAM);
        await client.quit();
    }
}

testXReadGroup();