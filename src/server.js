const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

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

// Start Stock Recovery
startStockRecovery(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 Real-time Server running on port ${PORT}`);
});
