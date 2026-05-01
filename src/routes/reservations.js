const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// Atomic Reservation System with Retry Logic
router.post('/', async (req, res) => {
    const { userId, dropId } = req.body;

    if (!userId || !dropId) {
        return res.status(400).json({ error: "userId and dropId are required" });
    }

    let attempts = 0;
    const MAX_RETRIES = 3;

    const executeReservation = async () => {
        return await prisma.$transaction(async (tx) => {
            // 1. Check if user already has an active reservation
            const existing = await tx.reservation.findFirst({
                where: {
                    userId,
                    dropId,
                    status: 'ACTIVE',
                    expiresAt: { gt: new Date() }
                }
            });

            if (existing) {
                return { reservation: existing, reused: true };
            }

            // 2. Atomically decrement availableStock only if > 0
            // updateMany is naturally atomic in Postgres
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
                throw new Error('OUT_OF_STOCK');
            }

            // 3. Create the reservation
            const reservation = await tx.reservation.create({
                data: {
                    userId,
                    dropId,
                    expiresAt: new Date(Date.now() + 60_000),
                    status: 'ACTIVE',
                },
            });

            return { reservation, reused: false };
        });
    };

    try {
        let result;
        while (attempts < MAX_RETRIES) {
            try {
                result = await executeReservation();
                break; 
            } catch (error) {
                if (error.message === 'OUT_OF_STOCK') throw error;
                
                attempts++;
                if (attempts >= MAX_RETRIES) throw error;
                
                // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, attempts * 50));
                console.log(`🔄 Retrying reservation for user ${userId} (Attempt ${attempts + 1})`);
            }
        }

        // 4. Notify all clients via WebSockets if stock changed
        if (!result.reused) {
            const updatedDrop = await prisma.drop.findUnique({ where: { id: dropId } });
            req.io.emit('stockUpdate', { 
                dropId, 
                availableStock: updatedDrop.availableStock 
            });
        }

        res.status(201).json(result.reservation);
    } catch (error) {
        if (error.message === 'OUT_OF_STOCK') {
            return res.status(400).json({ error: 'OUT_OF_STOCK' });
        }
        console.error("Reservation Error:", error.message);
        res.status(500).json({ error: "Server conflict. Please try again." });
    }
});

module.exports = router;
