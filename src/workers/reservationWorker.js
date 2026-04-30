const { reservationQueue, expiryQueue } = require("../queue");
const prisma = require("../prismaClient");
const { getIO } = require("../socketHandler");

const RESERVATION_WINDOW_MS = 60000;

// HIGH CONCURRENCY: Handle many users simultaneously
reservationQueue.process("reserve", 50, async (job) => {
  const { dropId, userId, timestamp } = job.data;
  const io = getIO();

  try {
    // 1. First Check (Fast, Non-blocking)
    const existing = await prisma.reservation.findFirst({
      where: { userId, dropId, status: "ACTIVE", expiresAt: { gt: new Date() } }
    });
    if (existing) {
        if (io) io.to(`user:${userId}`).emit("reservation-success", { userId, dropId, reservation: existing });
        return { status: "already_reserved" };
    }

    // 2. ATOMIC STOCK DECREMENT (High-Performance Industry Pattern)
    // This single query handles the race condition perfectly without deadlocks.
    const updateResult = await prisma.drop.updateMany({
      where: {
        id: dropId,
        stock: { gt: 0 } // ONLY if stock is available
      },
      data: {
        stock: { decrement: 1 }
      }
    });

    // 3. Check if we won the race
    if (updateResult.count === 0) {
      // Logic for waitlist/sold out
      const activeReservations = await prisma.reservation.count({
        where: { dropId, status: "ACTIVE", expiresAt: { gt: new Date() } }
      });
      if (activeReservations > 0) {
        if (io) io.to(`user:${userId}`).emit("reservation-waiting", { userId, dropId });
        throw new Error("WAITING_FOR_STOCK");
      }
      throw new Error("OUT_OF_STOCK");
    }

    // 4. Create the reservation now that we've secured the stock
    const reservation = await prisma.reservation.create({
      data: {
        userId,
        dropId,
        expiresAt: new Date(Date.now() + RESERVATION_WINDOW_MS),
        status: "ACTIVE",
      },
      include: { drop: true }
    });

    // 5. Schedule Expiry
    await expiryQueue.add("check-expiry", {
        reservationId: reservation.id,
        dropId,
        userId,
    }, {
        delay: RESERVATION_WINDOW_MS,
        removeOnComplete: true,
    });

    // 6. Broadcast New Stock
    const updatedDrop = await prisma.drop.findUnique({ where: { id: dropId }, select: { stock: true } });
    if (io) {
        io.to(`user:${userId}`).emit("reservation-success", { 
            userId, dropId, reservation: { id: reservation.id, expiresAt: reservation.expiresAt }
        });
        io.to(`drop:${dropId}`).emit("stock-update", { dropId, stock: updatedDrop.stock });
        io.emit("global-stock-update", { dropId, stock: updatedDrop.stock });
    }

    console.log(`🚀 High-speed reservation success for ${userId}`);
    return reservation;

  } catch (error) {
    if (error.message === "WAITING_FOR_STOCK") throw error; // Bull will retry
    
    console.error(`💥 [ERROR] ${userId}:`, error.message);
    if (io) io.to(`user:${userId}`).emit("reservation-failed", { userId, dropId, message: error.message });
    throw error;
  }
});

console.log("⚡ High-Speed Reservation Worker is ACTIVE (Concurrency: 50)");
