const express = require("express");
const http = require("http");
const cors = require("cors");
const { initializeSocket } = require("./socketHandler");
const prisma = require("./prismaClient");
require("./queue"); // Start the queue monitoring
require("./workers/reservationWorker"); // Start the reservation worker
require("./workers/expiryWorker"); // Start the expiry worker

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
initializeSocket(server);

app.get("/health", async (req, res) => {
  try {
    // Check DB
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", message: "Real-time server is healthy and connected to DB." });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Real-time Server running on port ${PORT}`);
});
