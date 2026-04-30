require("dotenv").config();
const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL;
console.log("Testing connection to:", REDIS_URL.split('@')[1]); // Don't log password

const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    tls: REDIS_URL.startsWith('rediss://') ? {} : undefined,
});

redis.on("connect", () => {
    console.log("✅ Successfully connected to Redis!");
    redis.set("test-key", "working-" + Date.now()).then(() => {
        return redis.get("test-key");
    }).then((val) => {
        console.log("✅ Set/Get test passed. Value:", val);
        process.exit(0);
    }).catch((err) => {
        console.error("❌ Redis operation failed:", err);
        process.exit(1);
    });
});

redis.on("error", (err) => {
    console.error("❌ Redis connection error:", err);
    process.exit(1);
});

// Timeout after 10 seconds
setTimeout(() => {
    console.error("❌ Connection timeout after 10s");
    process.exit(1);
}, 10000);
