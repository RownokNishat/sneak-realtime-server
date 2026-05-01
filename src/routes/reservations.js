const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// Atomic Reservation System
router.post('/', async (req, res) => {
    const { userId, dropId } = req.body;

    if (!userId || !dropId) {
        return res.status(400).json({ error: "userId and dropId are required" });
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            // 1. PREVENT DOUBLE RESERVATION: Check if user already has an active reservation
            // This prevents a user from taking multiple stock units for the same item.
            const existing = await tx.reservation.findFirst({
                where: {
                    userId,
                    dropId,
                    status: 'ACTIVE',
                    expiresAt: { gt: new Date() }
                }
            });

            if (existing) {
                console.log(`♻️ User ${userId} already has an active reservation for ${dropId}. Reusing.`);
                return { reservation: existing, dropId, reused: true };
            }

            // 2. Atomically decrement availableStock only if > 0
            const dropUpdate = await tx.drop.updateMany({
                where: {
                    id: dropId,
                    availableStock: { gt: 0 },
                    startsAt: { lte: new Date() },
                    isActive: true
                },
                data: {
                    availableStock: { decrement: 1 },
                },
            });

            if (dropUpdate.count === 0) {
                const drop = await tx.drop.findUnique({ where: { id: dropId } });
                if (!drop) throw new Error('DROP_NOT_FOUND');
                if (drop.availableStock <= 0) throw new Error('OUT_OF_STOCK');
                throw new Error('RESERVATION_FAILED');
            }

            // 3. Create the reservation (60-second window)
            const reservation = await tx.reservation.create({
                data: {
                    userId,
                    dropId,
                    expiresAt: new Date(Date.now() + 60_000), // 60 seconds
                    status: 'ACTIVE',
                },
            });

            return { reservation, dropId, reused: false };
        }, {
            isolationLevel: 'Serializable'
        });

        // 4. Notify all clients via WebSockets if stock actually changed
        if (!result.reused) {
            const updatedDrop = await prisma.drop.findUnique({ where: { id: dropId } });
            req.io.emit('stockUpdate', { 
                dropId: dropId, 
                availableStock: updatedDrop.availableStock 
            });
        }

        res.status(201).json(result.reservation);
    } catch (error) {
        console.error("Reservation Error:", error.message);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
