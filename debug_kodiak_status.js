// Debug script to test Kodiak status API
// Run with node debug_kodiak_status.js

const axios = require('axios');

async function testKodiakStatus() {
    try {
        console.log('Testing Kodiak status API...');
        
        // Make sure to run the server first
        const url = 'http://localhost:3000/api/user/kodiak/status';
        
        // Add cookies (you need to get valid cookies from your browser)
        const cookies = 'accessToken=...; refreshToken=...; csrfSecret=...; csrfToken=...';
        
        const response = await axios.get(url, {
            headers: {
                'Cookie': cookies,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            withCredentials: true
        });
        
        console.log('Response status:', response.status);
        console.log('Response data:', JSON.stringify(response.data, null, 2));
        
        // Check if data has the expected properties
        if (response.data.success && response.data.data) {
            console.log('\nStatus object:');
            console.log('connected:', response.data.data.connected);
            console.log('accountId:', response.data.data.accountId);
            console.log('verified:', response.data.data.verified);
            console.log('connectedAt:', response.data.data.connectedAt);
        }
    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
    }
}

testKodiakStatus();