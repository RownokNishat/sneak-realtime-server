const Bull = require("bull");
const Redis = require("ioredis");

// Get Redis URL from environment
const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error("❌ REDIS_URL is required!");
  process.exit(1);
}

console.log("🔌 Connecting to Redis...");

// Redis connection options for Upstash/TLS support
const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  enableOfflineQueue: true,
  keepAlive: 10000, // Keep the connection "warm" to prevent ECONNRESET
  tls: REDIS_URL.startsWith("rediss://") ? {} : undefined,
  retryStrategy: (times) => Math.min(times * 50, 2000),
};

const createClient = (type) => {
  switch (type) {
    case "client":
      return new Redis(REDIS_URL, redisOptions);
    case "subscriber":
      return new Redis(REDIS_URL, redisOptions);
    case "bclient":
      return new Redis(REDIS_URL, {
        ...redisOptions,
        maxRetriesPerRequest: null,
      });
    default:
      return new Redis(REDIS_URL, redisOptions);
  }
};

const reservationQueue = new Bull("reservation-queue", {
  createClient,
  settings: {
    lockDuration: 60000, // 1 minute
    lockRenewTime: 15000, // Renew every 15s
    stalledInterval: 15000, 
    maxStalledCount: 3,
  },
  defaultJobOptions: {
    removeOnComplete: true,
    attempts: 10,
    backoff: { type: "fixed", delay: 3000 },
  },
});

const expiryQueue = new Bull("expiry-queue", {
  createClient,
  defaultJobOptions: { removeOnComplete: true },
});

// Connection logging
reservationQueue.on("error", (err) => console.error("❌ Redis Queue Error:", err));
reservationQueue.on("ready", () => console.log("✅ Successfully connected to Redis & Queue is Ready!"));

// Heartbeat to keep the connection alive on Render
setInterval(() => {
    if (reservationQueue.client.status === "ready") {
        console.log("💓 Worker Heartbeat: I am alive and listening to Redis...");
    }
}, 15000);
expiryQueue.on("ready", () => console.log("✅ Expiry queue ready"));
expiryQueue.on("error", (err) => console.error("❌ Expiry queue error:", err));

// Clean old jobs on startup
async function cleanOldJobs() {
  try {
    await reservationQueue.clean(3600000, "completed"); // 1 hour old
    await reservationQueue.clean(3600000, "failed");
    console.log("✅ Cleaned old jobs");
  } catch (error) {
    console.error("Error cleaning jobs:", error);
  }
}

// Proactive Stale Job Cleanup (Every 60 seconds)
// This removes jobs from the "waiting" state if they are older than 5 minutes
async function cleanStaleWaitingJobs() {
  try {
    const waitingJobs = await reservationQueue.getWaiting();
    const now = Date.now();
    let count = 0;

    for (const job of waitingJobs) {
      // If job is older than 5 minutes, remove it
      if (job.data.timestamp && (now - job.data.timestamp > 300000)) {
        await job.remove();
        count++;
      }
    }
    
    if (count > 0) {
      console.log(`🧹 Garbage Collector: Removed ${count} stale waiting jobs from Redis.`);
    }

    // Also clean completed/failed jobs older than 1 hour
    await reservationQueue.clean(3600000, "completed");
    await reservationQueue.clean(3600000, "failed");
  } catch (error) {
    console.error("🧹 Cleanup Error:", error);
  }
}

// Start the garbage collector
setInterval(cleanStaleWaitingJobs, 60000);

module.exports = { reservationQueue, expiryQueue };
