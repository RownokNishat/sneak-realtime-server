const Bull = require("bull");
const Redis = require("ioredis");

// Get Redis URL from environment
const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error("❌ REDIS_URL is required!");
  process.exit(1);
}

console.log("🔌 Connecting to Redis...");

// Create Redis client for Bull

const client = new Redis(REDIS_URL, {
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  tls: {
    // Upstash requires TLS
    rejectUnauthorized: false,
  },
});

const subscriber = new Redis(REDIS_URL, {
  tls: {
    rejectUnauthorized: false,
  },
});

// Create Bull queues using Upstash Redis
const reservationQueue = new Bull("reservation-queue", {
  createClient: (type) => {
    switch (type) {
      case "client":
        return client;
      case "subscriber":
        return subscriber;
      default:
        return new Redis(REDIS_URL, {
          tls: { rejectUnauthorized: false },
        });
    }
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

const expiryQueue = new Bull("expiry-queue", {
  createClient: (type) => {
    switch (type) {
      case "client":
        return client;
      case "subscriber":
        return subscriber;
      default:
        return new Redis(REDIS_URL, {
          maxRetriesPerRequest: null,
          tls: { rejectUnauthorized: false },
        });
    }
  },
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
  },
});

// Connection events
client.on("connect", () => console.log("✅ Redis client connected"));
client.on("error", (err) => console.error("❌ Redis client error:", err));
subscriber.on("connect", () => console.log("✅ Redis subscriber connected"));

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

// Wait for Redis to be ready before cleaning
setTimeout(cleanOldJobs, 5000);

module.exports = { reservationQueue, expiryQueue };
