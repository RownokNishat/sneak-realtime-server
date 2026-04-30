const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  log: ["error", "warn"],
});

prisma
  .$connect()
  .then(() => console.log("✅ Prisma connected to database"))
  .catch((err) => console.error("❌ Prisma connection error:", err));

module.exports = prisma;
