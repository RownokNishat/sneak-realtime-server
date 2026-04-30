const { reservationQueue, expiryQueue } = require("../queue");
const { getIO } = require("../socketHandler");
const prisma = require("../prismaClient");

const RESERVATION_WINDOW_MS = 60000;

// Process reservations - High concurrency for massive drops
reservationQueue.process("reserve", 100, async (job) => {
  const { dropId, userId, timestamp } = job.data;

  // 1. Check if the job itself is too old (e.g., if the user gave up)
  const waitedMs = Date.now() - timestamp;
  if (waitedMs > 180000) { // 3 minutes max wait time
    return { status: "stale" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const drop = await tx.drop.findUnique({
        where: { id: dropId },
        select: { id: true, stock: true, isActive: true, name: true, price: true },
      });

      if (!drop || !drop.isActive) throw new Error("DROP_UNAVAILABLE");

      // LOGIC: If stock is 0, check if we should wait
      if (drop.stock <= 0) {
        const activeReservations = await tx.reservation.count({
          where: { dropId, status: "ACTIVE", expiresAt: { gt: new Date() } }
        });

        if (activeReservations > 0) {
          // Notify user they are in a waitlist
          const io = getIO();
          io.emit("reservation-waiting", { 
            userId, 
            dropId, 
            message: "Stock is currently held by others. Waiting for a spot to open..." 
          });
          
          // People are still holding items! Signal to Bull to retry LATER.
          throw new Error("WAITING_FOR_STOCK_RECOVERY");
        }
        throw new Error("OUT_OF_STOCK");
      }

      // Check for existing active reservation
      const existing = await tx.reservation.findFirst({
        where: { userId, dropId, status: "ACTIVE", expiresAt: { gt: new Date() } },
      });
      if (existing) {
        return { status: "already_reserved", reservation: existing };
      }

      // Atomic decrement
      const updated = await tx.drop.updateMany({
        where: { id: dropId, stock: { gt: 0 } },
        data: { stock: { decrement: 1 } },
      });

      if (updated.count === 0) throw new Error("WAITING_FOR_STOCK_RECOVERY");

      return await tx.reservation.create({
        data: {
          userId,
          dropId,
          status: "ACTIVE",
          expiresAt: new Date(Date.now() + 60000),
        },
        include: { drop: { select: { name: true, price: true } } },
      });
    }, { isolationLevel: "RepeatableRead" });

    // Success logic
    const io = getIO();
    
    // Get latest stock for broadcast
    const updatedStock = await prisma.drop.findUnique({
      where: { id: dropId },
      select: { stock: true },
    });

    if (result.status !== "already_reserved") {
      await expiryQueue.add("check-expiry", {
        reservationId: result.id,
        dropId: result.dropId,
        userId: result.userId,
      }, { delay: 60000 });
      
      console.log(`✅ New reservation created for user ${userId} on drop ${dropId}`);
    } else {
      console.log(`ℹ️ User ${userId} already had an active reservation for drop ${dropId}`);
    }

    const reservationData = result.status === "already_reserved" ? result.reservation : result;

    // 1. Notify the specific user
    io.emit("reservation-success", { 
        userId, 
        dropId, 
        reservation: {
            id: reservationData.id,
            expiresAt: reservationData.expiresAt,
            dropName: reservationData.drop?.name || "Sneaker Drop",
            price: reservationData.drop?.price || 0
        },
        message: "Reservation successful! Proceed to checkout."
    });

    // 2. Broadcast stock update to the specific drop room
    io.to(`drop:${dropId}`).emit("stock-update", {
      dropId,
      stock: updatedStock.stock,
      event: "reserved",
    });

    // 3. Global broadcast for the dashboard
    io.emit("global-stock-update", {
      dropId,
      stock: updatedStock.stock,
    });
    
    return result;

  } catch (error) {
    if (error.message === "WAITING_FOR_STOCK_RECOVERY") {
      // Throwing this will make Bull retry based on its backoff settings
      // This is non-blocking! The worker moves to the next job immediately.
      throw error;
    }
    
    const io = getIO();
    io.emit("reservation-failed", { userId, dropId, message: error.message });
    throw error;
  }
});

// Job completion event
reservationQueue.on("completed", (job, result) => {
  console.log(`📦 Job ${job.id} completed: reservation=${result?.id}`);
});

// Job failure event
reservationQueue.on("failed", (job, err) => {
  console.error(
    `❌ Job ${job.id} failed after ${job.attemptsMade} attempts: ${err.message}`,
  );
});

console.log("🔄 Reservation worker started");
