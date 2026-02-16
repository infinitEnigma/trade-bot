const WebSocket = require('ws');

// Configuration
const CONFIG = {
    // Mainnet URL with account ID
    wsUrl: 'wss://ws-evm.orderly.org/ws/stream/0xc833b32e207c0b7bfcd602fbaf0e480e6fbbe545dab6eff440e190a037f5b5fb',
    symbols: ['PERP_ETH_USDC', 'PERP_BTC_USDC'],
    topics: ['markprice', 'kline_1m'],
    connectionTimeout: 5000,
    messageTimeout: 30000
};

console.log('=== Kodiak WebSocket Debug Tool ===');
console.log('');
console.log('Configuration:');
console.log(`- WebSocket URL: ${CONFIG.wsUrl}`);
console.log(`- Symbols: ${CONFIG.symbols.join(', ')}`);
console.log(`- Topics: ${CONFIG.topics.join(', ')}`);
console.log('');

// Test WebSocket connection
console.log('1. Connecting to WebSocket...');
const ws = new WebSocket(CONFIG.wsUrl);

let connectionTimeout;
let messageTimeout;

// Connection timeout
connectionTimeout = setTimeout(() => {
    console.error('❌ Connection timeout: Could not connect to WebSocket');
    process.exit(1);
}, CONFIG.connectionTimeout);

// Message timeout
messageTimeout = setTimeout(() => {
    console.error('❌ Message timeout: No data received within 30 seconds');
    process.exit(1);
}, CONFIG.messageTimeout);

ws.on('open', () => {
    clearTimeout(connectionTimeout);
    console.log('✅ Connected successfully');
    console.log('');

    // Subscribe to topics
    console.log('2. Subscribing to topics...');
    CONFIG.symbols.forEach(symbol => {
        CONFIG.topics.forEach(topic => {
            const fullTopic = `${symbol}@${topic}`;
            const subscribeMsg = {
                id: `sub_${fullTopic}_${Date.now()}`,
                event: 'subscribe',
                topic: fullTopic
            };

            ws.send(JSON.stringify(subscribeMsg));
            console.log(`   Subscribed to: ${fullTopic}`);
        });
    });

    console.log('');
    console.log('3. Waiting for data...');
    console.log('');
});

ws.on('message', (data) => {
    clearTimeout(messageTimeout);
    
    try {
        const message = JSON.parse(data.toString());
        
        // Check if this is a subscription confirmation
        if (message.event && ['subscribe', 'unsubscribe'].includes(message.event)) {
            if (message.success) {
                console.log(`✅ Subscription successful: ${message.event} ${message.topic}`);
            } else {
                console.error(`❌ Subscription failed: ${message.event} ${message.topic} - ${message.errorMsg}`);
            }
        } 
        // Check if this is market data
        else if (message.topic && message.data) {
            console.log('📊 Market data received:');
            console.log(`   Topic: ${message.topic}`);
            console.log(`   Data: ${JSON.stringify(message.data, null, 2)}`);
            console.log(`   Timestamp: ${message.ts}`);
            console.log('');
        }
        // Other messages
        else {
            console.log('📨 Other message:');
            console.log(JSON.stringify(message, null, 2));
            console.log('');
        }
    } catch (error) {
        console.error('❌ Error parsing message:', error);
        console.log('Raw data:', data.toString());
        console.log('');
    }

    // Reset message timeout
    clearTimeout(messageTimeout);
    messageTimeout = setTimeout(() => {
        console.error('❌ Message timeout: No data received within 30 seconds');
        process.exit(1);
    }, CONFIG.messageTimeout);
});

ws.on('error', (error) => {
    clearTimeout(connectionTimeout);
    clearTimeout(messageTimeout);
    console.error('❌ WebSocket error:', error);
    process.exit(1);
});

ws.on('close', (code, reason) => {
    clearTimeout(connectionTimeout);
    clearTimeout(messageTimeout);
    console.log('');
    console.log('🔌 Connection closed');
    console.log(`   Code: ${code}`);
    if (reason) {
        console.log(`   Reason: ${reason}`);
    }
    process.exit(0);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('');
    console.log('');
    console.log('⏹️  Interrupted by user');
    ws.close();
});