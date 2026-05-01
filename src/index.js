const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const prisma = require('./lib/prisma');
const { startStockRecovery } = require('./services/stockService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// Detailed Request Logging
app.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.path}`);
  next();
});

// Pass io to request object
app.use((req, res, next) => {
    req.io = io;
    next();
});

// Routes
app.use('/api/drops', require('./routes/drops'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/users', require('./routes/users'));

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Database Connection Check
prisma.$connect()
    .then(() => console.log('✅ Database connected successfully'))
    .catch((err) => console.error('❌ Database connection failed:', err));

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('💥 SERVER ERROR:', err.stack);
    res.status(500).json({ 
        error: 'Internal Server Error', 
        details: err.message 
    });
});

// Start Stock Recovery
startStockRecovery(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 Real-time Server running on port ${PORT}`);
    console.log(`✅ Socket.io initialized`);
});
