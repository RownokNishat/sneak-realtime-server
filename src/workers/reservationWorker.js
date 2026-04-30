const { reservationQueue, expiryQueue } = require("../queue");
const prisma = require("../prismaClient");
const { getIO } = require("../socketHandler");

const RESERVATION_WINDOW_MS = 60000;

// Process reservations - Stable concurrency for Render free tier
reservationQueue.process("reserve", 10, async (job) => {
  const { dropId, userId, timestamp } = job.data;
  console.log(`📥 [WORKER] Received reserve job for user: ${userId}, drop: ${dropId}`);

  const io = getIO();

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Check if drop exists
      const drop = await tx.drop.findUnique({
        where: { id: dropId },
        select: { id: true, stock: true },
      });

      if (!drop) {
        console.error(`❌ Drop ${dropId} not found`);
        throw new Error("DROP_NOT_FOUND");
      }

      // 2. Check for existing active reservation
      const existing = await tx.reservation.findFirst({
        where: { userId, dropId, status: "ACTIVE", expiresAt: { gt: new Date() } },
        include: { drop: true }
      });

      if (existing) {
        console.log(`ℹ️ User ${userId} already has an active reservation. Returning existing.`);
        return { status: "already_reserved", reservation: existing };
      }

      // 3. Check stock
      if (drop.stock <= 0) {
        console.log(`⚠️ Drop ${dropId} is out of stock`);
        const activeReservations = await tx.reservation.count({
          where: { dropId, status: "ACTIVE", expiresAt: { gt: new Date() } },
        });

        if (activeReservations > 0) {
          if (io) io.to(`user:${userId}`).emit("reservation-waiting");
          throw new Error("WAITING_FOR_STOCK_RECOVERY");
        }
        throw new Error("OUT_OF_STOCK");
      }

      // 4. Atomically decrement stock
      const updated = await tx.drop.updateMany({
        where: { id: dropId, stock: { gt: 0 } },
        data: { stock: { decrement: 1 } },
      });

      if (updated.count === 0) throw new Error("OUT_OF_STOCK");

      // 5. Create the reservation
      const reservation = await tx.reservation.create({
        data: {
          userId,
          dropId,
          expiresAt: new Date(Date.now() + RESERVATION_WINDOW_MS),
          status: "ACTIVE",
        },
        include: { drop: true }
      });

      return reservation;
    }, {
      isolationLevel: "Serializable",
    });

    const reservationData = result.status === "already_reserved" ? result.reservation : result;
    
    if (result.status !== "already_reserved") {
        await expiryQueue.add("check-expiry", {
            reservationId: result.id,
            dropId: result.dropId,
            userId: result.userId,
        }, {
            delay: RESERVATION_WINDOW_MS,
            jobId: `expiry-${result.id}`,
            removeOnComplete: true,
        });
        console.log(`✅ Success: Reservation created for ${userId}`);
    }

    // 6. Broadcast Stock
    const updatedDrop = await prisma.drop.findUnique({ where: { id: dropId }, select: { stock: true } });
    if (io) {
        io.to(`user:${userId}`).emit("reservation-success", { 
            userId, dropId, reservation: { id: reservationData.id, expiresAt: reservationData.expiresAt }
        });
        io.to(`drop:${dropId}`).emit("stock-update", { dropId, stock: updatedDrop.stock });
        io.emit("global-stock-update", { dropId, stock: updatedDrop.stock });
    }

    return result;
  } catch (error) {
    console.error(`💥 [WORKER ERROR] ${userId}:`, error.message);
    const io = getIO();
    if (io && error.message !== "WAITING_FOR_STOCK_RECOVERY") {
      io.to(`user:${userId}`).emit("reservation-failed", { userId, dropId, message: error.message });
    }
    throw error;
  }
});

console.log("🔄 Reservation worker is WAITING for jobs...");
