const { Server } = require("socket.io");
const prisma = require("./prismaClient");

let io;

function initializeSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ["websocket", "polling"],
  });

  io.on("connection", async (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Join drop-specific room
    socket.on("join-drop", (dropId) => {
      if (dropId) {
        socket.join(`drop:${dropId}`);
        console.log(`Client ${socket.id} joined drop:${dropId}`);
      }
    });

    // Leave drop room
    socket.on("leave-drop", (dropId) => {
      if (dropId) {
        socket.leave(`drop:${dropId}`);
        console.log(`Client ${socket.id} left drop:${dropId}`);
      }
    });

    // Join all active drops (for dashboard)
    socket.on("join-all-drops", async () => {
      try {
        const drops = await prisma.drop.findMany({
          where: { isActive: true },
          select: { id: true },
        });

        drops.forEach((drop) => {
          socket.join(`drop:${drop.id}`);
        });

        console.log(`Client ${socket.id} joined all ${drops.length} drops`);
      } catch (error) {
        console.error("Error joining all drops:", error);
      }
    });

    // Client requesting current stock
    socket.on("request-stock", async (dropId) => {
      try {
        const drop = await prisma.drop.findUnique({
          where: { id: dropId },
          select: { id: true, stock: true, name: true },
        });

        if (drop) {
          socket.emit("stock-update", {
            dropId: drop.id,
            stock: drop.stock,
            event: "requested",
          });
        }
      } catch (error) {
        console.error("Error fetching stock:", error);
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(`🔌 Client disconnected: ${socket.id}, reason: ${reason}`);
    });

    socket.on("error", (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });
  });

  console.log("✅ Socket.io initialized");
  return io;
}

function getIO() {
  if (!io) {
    throw new Error("Socket.io not initialized! Call initializeSocket first.");
  }
  return io;
}

module.exports = { initializeSocket, getIO };
