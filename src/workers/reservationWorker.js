const { reservationQueue, expiryQueue } = require("../queue");
const { getIO } = require("../socketHandler");
const prisma = require("../prismaClient");

const RESERVATION_WINDOW_MS = 60000;

// Process reservations - ONE AT A TIME PER DROP
reservationQueue.process("reserve", async (job) => {
  const { dropId, userId, timestamp } = job.data;

  // Discard jobs that sat in the queue longer than the reservation window.
  // Return (not throw) so Bull marks it complete and does not retry.
  const waitedMs = Date.now() - timestamp;
  if (waitedMs > RESERVATION_WINDOW_MS) {
    console.log(
      `⏭ Stale reservation job discarded (waited ${waitedMs}ms): drop=${dropId}, user=${userId}`
    );
    const io = getIO();
    io.emit("reservation-failed", {
      userId,
      dropId,
      message: "Your reservation request expired in the queue. Please try again.",
    });
    return { status: "stale" };
  }

  console.log(`🔄 Processing reservation: drop=${dropId}, user=${userId}`);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Get current drop
      const drop = await tx.drop.findUnique({
        where: { id: dropId },
        select: {
          id: true,
          stock: true,
          name: true,
          price: true,
          isActive: true,
        },
      });

      if (!drop) {
        throw new Error("DROP_NOT_FOUND");
      }

      if (!drop.isActive) {
        throw new Error("DROP_INACTIVE");
      }

      if (drop.stock <= 0) {
        throw new Error("OUT_OF_STOCK");
      }

      // Check for existing active reservation (prevent double booking)
      const existingReservation = await tx.reservation.findFirst({
        where: {
          userId,
          dropId,
          status: "ACTIVE",
          expiresAt: { gt: new Date() },
        },
      });

      if (existingReservation) {
        throw new Error("ALREADY_RESERVED");
      }

      // Atomic stock decrement with safety check
      const updatedDrop = await tx.drop.updateMany({
        where: {
          id: dropId,
          stock: { gt: 0 }, // Double-check stock still available
        },
        data: {
          stock: { decrement: 1 },
        },
      });

      if (updatedDrop.count === 0) {
        throw new Error("OUT_OF_STOCK");
      }

      // Create reservation (60 seconds from now)
      const reservation = await tx.reservation.create({
        data: {
          userId,
          dropId,
          status: "ACTIVE",
          expiresAt: new Date(Date.now() + 60000),
        },
        include: {
          drop: {
            select: { name: true, price: true },
          },
        },
      });

      return { reservation, drop };
    });

    // Schedule expiry job for exactly 60 seconds from now
    await expiryQueue.add(
      "check-expiry",
      {
        reservationId: result.reservation.id,
        dropId: result.reservation.dropId,
        userId: result.reservation.userId,
      },
      {
        delay: 60000, // Execute in 60 seconds
        jobId: `expiry-${result.reservation.id}`,
        removeOnComplete: true,
      },
    );

    console.log(`✅ Reservation created: ${result.reservation.id}`);

    // Broadcast results
    const io = getIO();

    // Get updated stock
    const updatedStock = await prisma.drop.findUnique({
      where: { id: dropId },
      select: { stock: true },
    });

    // Notify specific user
    io.emit("reservation-success", {
      userId,
      dropId,
      reservation: {
        id: result.reservation.id,
        expiresAt: result.reservation.expiresAt,
        dropName: result.reservation.drop.name,
        price: result.reservation.drop.price,
      },
      message:
        "Reservation successful! You have 60 seconds to complete purchase.",
    });

    // Broadcast stock update to all clients watching this drop
    io.to(`drop:${dropId}`).emit("stock-update", {
      dropId,
      stock: updatedStock.stock,
      event: "reserved",
    });

    // Global broadcast for dashboard
    io.emit("global-stock-update", {
      dropId,
      stock: updatedStock.stock,
    });

    return result.reservation;
  } catch (error) {
    console.error(
      `❌ Reservation failed for drop=${dropId}, user=${userId}:`,
      error.message,
    );

    const io = getIO();
    let message = "Reservation failed. Please try again.";

    switch (error.message) {
      case "OUT_OF_STOCK":
        message = "Sorry, this item is sold out!";
        break;
      case "ALREADY_RESERVED":
        message = "You already have an active reservation for this item.";
        break;
      case "DROP_NOT_FOUND":
        message = "This drop no longer exists.";
        break;
      case "DROP_INACTIVE":
        message = "This drop is no longer active.";
        break;
    }

    io.emit("reservation-failed", {
      userId,
      dropId,
      message,
    });

    throw error; // Re-throw for Bull retry mechanism
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
