const express = require("express");
const http = require("http");
const cors = require("cors");
require("dotenv").config();

const { initializeSocket } = require("./socketHandler");
const prisma = require("./prismaClient");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// 1. INITIALIZE SOCKET FIRST
initializeSocket(server);

// 2. NOW START WORKERS & QUEUES
require("./queue"); 
require("./workers/reservationWorker");
require("./workers/expiryWorker");

const { reservationQueue, expiryQueue } = require("./queue");

// GLOBAL MONITORING (This will show in your logs NO MATTER WHAT)
reservationQueue.on('active', (job) => {
  console.log(`🔥 QUEUE ACTIVE: Job ${job.id} is being picked up!`);
});

reservationQueue.on('failed', (job, err) => {
  console.error(`💥 QUEUE FAILED: Job ${job.id} failed with error: ${err.message}`);
});

// --- API ROUTES ---
app.get("/api/drops", async (req, res) => {
  try {
    const drops = await prisma.drop.findMany({
      where: { isActive: true },
      include: {
        purchases: { take: 3, orderBy: { createdAt: "desc" }, include: { user: { select: { username: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(drops);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/drops/:id/stock", async (req, res) => {
  try {
    const drop = await prisma.drop.findUnique({
      where: { id: req.params.id },
      select: { stock: true, name: true },
    });
    if (!drop) return res.status(404).json({ error: "Drop not found" });
    res.json(drop);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const { reservationQueue } = require("./queue");
app.post("/api/drops/:dropId/reserve", async (req, res) => {
  try {
    const { dropId } = req.params;
    const userId = req.headers["x-user-id"];
    const job = await reservationQueue.add("reserve", 
      { dropId, userId, timestamp: Date.now() },
      { jobId: `reserve-${dropId}-${userId}-${Date.now()}`, removeOnComplete: true }
    );
    res.json({ status: "queued", jobId: job.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/users/:userId/reservations", async (req, res) => {
  try {
    const resv = await prisma.reservation.findMany({
      where: { userId: req.params.userId, status: "ACTIVE", expiresAt: { gt: new Date() } },
      include: { drop: true }
    });
    res.json(resv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/drops/:dropId/purchase", async (req, res) => {
  try {
    const { reservationId, userId } = req.body;
    const result = await prisma.$transaction(async (tx) => {
      await tx.reservation.update({ where: { id: reservationId }, data: { status: "COMPLETED" } });
      const purchase = await tx.purchase.create({
        data: { userId, dropId: req.params.dropId, reservationId },
        include: { user: { select: { username: true } }, drop: true }
      });
      return purchase;
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/health", (req, res) => res.json({ status: "ok", mode: "monolith" }));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 MONOLITH SERVER RUNNING ON PORT ${PORT}`);
});
