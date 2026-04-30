const Bull = require("bull");

// Get Redis URL from environment
const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error("❌ REDIS_URL is required!");
  process.exit(1);
}

console.log("🔌 Connecting to Redis...");

// Create Bull queues - let Bull manage Redis connections
// DO NOT use createClient or pre-create Redis instances
const reservationQueue = new Bull("reservation-queue", REDIS_URL, {
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

const expiryQueue = new Bull("expiry-queue", REDIS_URL, {
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
reservationQueue.on("connected", () =>
  console.log("✅ Reservation queue connected"),
);
reservationQueue.on("error", (err) =>
  console.error("❌ Reservation queue error:", err),
);
expiryQueue.on("connected", () => console.log("✅ Expiry queue connected"));
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
