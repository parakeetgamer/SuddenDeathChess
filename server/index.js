const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');

const db = require('./db');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const { handleConnection } = require('./game/matchmaker');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// ── Middleware ──
app.use(cors());
// Stripe webhook needs the RAW body for signature verification -- mount BEFORE express.json()
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), require('./routes/payments').webhook);
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/public')));

// ── REST API routes ──
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/payments', require('./routes/payments').router);

// Health check for Railway/Render
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Serve frontend for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/index.html'));
});

// ── WebSocket: real-time game ──
wss.on('connection', (ws, req) => {
  handleConnection(ws, req);
});

// ── Start ──
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🔴 Sudden Death Chess running on port ${PORT}`);
  console.log(`   http://localhost:${PORT}\n`);
});
