const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const prisma = require('./lib/prisma');
const { startStockRecovery } = require('./services/stockService');
const { requestLogger } = require('./middlewares/logger');
const { errorHandler, notFound } = require('./middlewares/errorHandler');

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
app.use(requestLogger);

app.use((req, res, next) => {
    req.io = io;
    next();
});

app.use('/api/drops', require('./routes/drops'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/users', require('./routes/users'));

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.json({ 
        message: 'Sneaker Drop API', 
        version: '1.0.0'
    });
});

app.use(notFound);
app.use(errorHandler);

prisma.$connect()
    .then(() => console.log('Database connected'))
    .catch((err) => {
        console.error('Database connection failed:', err);
        process.exit(1);
    });

startStockRecovery(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
