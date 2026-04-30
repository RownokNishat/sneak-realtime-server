const { expiryQueue } = require("../queue");
const { getIO } = require("../socketHandler");
const prisma = require("../prismaClient");

// Process expired reservations
expiryQueue.process("check-expiry", async (job) => {
  const { reservationId, dropId, userId } = job.data;

  console.log(`⏰ Checking expiry for reservation ${reservationId}`);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Check if reservation is still active
      const reservation = await tx.reservation.findUnique({
        where: { id: reservationId },
      });

      if (!reservation) {
        console.log(`Reservation ${reservationId} not found`);
        return null;
      }

      if (reservation.status !== "ACTIVE") {
        console.log(
          `Reservation ${reservationId} already ${reservation.status}`,
        );
        return null;
      }

      // Recover stock
      const updatedDrop = await tx.drop.update({
        where: { id: dropId },
        data: { stock: { increment: 1 } },
        select: { id: true, stock: true, name: true },
      });

      // Mark reservation as expired
      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: "EXPIRED" },
      });

      return { drop: updatedDrop };
    });

    if (result) {
      console.log(
        `✅ Stock recovered for drop ${dropId}: now ${result.drop.stock}`,
      );

      const io = getIO();

      // Notify user
      io.emit("reservation-expired", {
        userId,
        dropId,
        reservationId,
        message:
          "Your reservation has expired. Item returned to available stock.",
      });

      // Broadcast stock recovery to drop room
      io.to(`drop:${dropId}`).emit("stock-update", {
        dropId,
        stock: result.drop.stock,
        event: "expired",
      });

      // Global broadcast
      io.emit("global-stock-update", {
        dropId,
        stock: result.drop.stock,
      });

      return result;
    }
  } catch (error) {
    console.error(
      `❌ Expiry check failed for reservation ${reservationId}:`,
      error,
    );
    throw error;
  }
});

console.log("⏰ Expiry worker started");
