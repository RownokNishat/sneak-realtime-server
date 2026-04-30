const { reservationQueue, expiryQueue } = require("../queue");
const prisma = require("../prismaClient");
const { getIO } = require("../socketHandler");

const RESERVATION_WINDOW_MS = 60000;

// Process reservations - Stable concurrency for Render free tier
reservationQueue.process("reserve", 10, async (job) => {
  const { dropId, userId, timestamp } = job.data;
  console.log(`🚀 Processing reservation for user ${userId} on drop ${dropId}`);

  // Fetch IO instance INSIDE the worker to avoid race conditions
  const io = getIO();

  // 1. Check if the job itself is too old (e.g., if the user gave up)
  const waitedMs = Date.now() - timestamp;
  if (waitedMs > 180000) { // 3 minutes max wait time
    console.log(`⚠️ Job for user ${userId} is too stale (${waitedMs}ms). Discarding.`);
    return { status: "stale" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 2. Check stock first
      const drop = await tx.drop.findUnique({
        where: { id: dropId },
        select: { id: true, stock: true },
      });

      if (!drop) throw new Error("DROP_NOT_FOUND");

      if (drop.stock <= 0) {
        const activeReservations = await tx.reservation.count({
          where: { dropId, status: "ACTIVE", expiresAt: { gt: new Date() } },
        });

        if (activeReservations > 0) {
          // Notify user they are in a waitlist
          if (io) {
            io.to(`user:${userId}`).emit("reservation-waiting", { 
              userId, dropId, message: "Waiting for a spot to open..." 
            });
          }
          throw new Error("WAITING_FOR_STOCK_RECOVERY");
        }
        throw new Error("OUT_OF_STOCK");
      }

      // 3. Check for existing active reservation for THIS user
      const existing = await tx.reservation.findFirst({
        where: { userId, dropId, status: "ACTIVE", expiresAt: { gt: new Date() } },
        include: { drop: true }
      });

      if (existing) {
        return { status: "already_reserved", reservation: existing };
      }

      // 4. Atomically decrement stock
      const updated = await tx.drop.updateMany({
        where: { id: dropId, stock: { gt: 0 } },
        data: { stock: { decrement: 1 } },
      });

      if (updated.count === 0) throw new Error("WAITING_FOR_STOCK_RECOVERY");

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
      isolationLevel: "Serializable", // Strictest isolation to prevent overselling
    });

    // 6. If successful, schedule the expiry job
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
        console.log(`✅ New reservation created for user ${userId} on drop ${dropId}`);
    }

    // 7. Get final stock for broadcast
    const updatedStock = await prisma.drop.findUnique({
      where: { id: dropId },
      select: { stock: true }
    });

    // 8. Notify the specific user
    if (io) {
        io.to(`user:${userId}`).emit("reservation-success", { 
            userId, 
            dropId, 
            reservation: {
                id: reservationData.id,
                expiresAt: reservationData.expiresAt,
            }
        });

        // 9. Broadcast stock update
        io.to(`drop:${dropId}`).emit("stock-update", {
          dropId,
          stock: updatedStock.stock,
          event: "reserved",
        });

        // 10. Global broadcast
        io.emit("global-stock-update", {
          dropId,
          stock: updatedStock.stock,
        });
    }

    return result;
  } catch (error) {
    console.error(`❌ Reservation failed for user ${userId}:`, error.message);
    
    if (error.message === "WAITING_FOR_STOCK_RECOVERY") {
      throw error; // Let Bull retry
    }

    const io = getIO();
    if (io) {
      io.to(`user:${userId}`).emit("reservation-failed", { userId, dropId, message: error.message });
    }
    throw error;
  }
});

console.log("🔄 Reservation worker started with concurrency 10");
