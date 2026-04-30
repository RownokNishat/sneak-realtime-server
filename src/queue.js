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
  tls: REDIS_URL.startsWith("rediss://") ? {} : undefined,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  reconnectOnError: (err) => {
    const targetError = "READONLY";
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  },
};

// Create a function to provide Redis clients to Bull
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

// Create Bull queues with proper Redis configuration
const reservationQueue = new Bull("reservation-queue", {
  createClient,
  settings: {
    lockDuration: 30000,
    lockRenewTime: 15000,
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
  createClient,
  settings: {
    lockDuration: 30000,
    lockRenewTime: 15000,
  },
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
  },
});

// Connection events
reservationQueue.on("ready", () =>
  console.log("✅ Reservation queue ready"),
);
reservationQueue.on("error", (err) =>
  console.error("❌ Reservation queue error:", err),
);
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

// Wait for queues to be ready before cleaning
setTimeout(cleanOldJobs, 5000);

module.exports = { reservationQueue, expiryQueue };
