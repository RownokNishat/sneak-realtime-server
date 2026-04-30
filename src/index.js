require("dotenv").config();

const http = require("http");
const Redis = require("ioredis");
const { initializeSocket, getIO } = require("./socketHandler");

// Load workers (they auto-start)
require("./workers/reservationWorker");
require("./workers/expiryWorker");

// Create HTTP server
const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "realtime-server",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      }),
    );
    return;
  }

  // Default response
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Sneaker Drop Real-time Server");
});

// Initialize Socket.io
initializeSocket(server);

// Subscribe to new-drop events published by the backend
const dropSubscriber = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
dropSubscriber.subscribe("drops:new", (err) => {
  if (err) console.error("❌ Failed to subscribe to drops:new:", err);
  else console.log("✅ Subscribed to drops:new channel");
});
dropSubscriber.on("message", (channel, message) => {
  if (channel === "drops:new") {
    try {
      const drop = JSON.parse(message);
      getIO().emit("new-drop", drop);
      console.log(`📦 Broadcasted new drop: ${drop.id}`);
    } catch (err) {
      console.error("Failed to broadcast new drop:", err);
    }
  }
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`🚀 Real-time server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🔄 Queue workers active`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", async () => {
  console.log("SIGINT received. Shutting down gracefully...");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});
