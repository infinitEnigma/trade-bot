const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Minimal Socket.IO server
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  allowEIO3: true,
  transports: ['websocket', 'polling'],
  connectionStateRecovery: false
});

console.log('Socket.IO server initialized with:', {
  version: require('socket.io/package.json').version,
  allowEIO3: true,
  connectionStateRecovery: false
});

io.engine.on('connection', (socket) => {
  console.log('Engine connection:', socket.id);
  socket.on('error', (err) => {
    console.error('Engine socket error:', socket.id, err);
  });
});

io.engine.on('connection_error', (err) => {
  console.error('Engine connection error:', err);
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id, {
    transport: socket.conn.transport?.name,
    protocol: socket.conn.protocol,
    userId: socket.request?._query?.userId || 'unknown'
  });

  // Check connection state
  try {
    console.log('Connection properties:', {
      conn: !!socket.conn,
      transport: socket.conn?.transport?.name,
      protocol: socket.conn?.protocol,
      request: !!socket.request,
      handshake: !!socket.handshake
    });
  } catch (e) {
    console.error('Error checking connection properties:', e);
  }

  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', socket.id, reason);
  });

  socket.on('error', (err) => {
    console.error('Socket error:', socket.id, err);
  });
});

// Simple test endpoint
app.get('/test', (req, res) => {
  res.send('Socket.IO server is running');
});

server.listen(3001, () => {
  console.log('Debug server listening on port 3001');
  console.log('Test with: curl http://localhost:3001/test');
  console.log('Connect with Socket.IO client at: http://localhost:3001');
});