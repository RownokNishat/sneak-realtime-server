const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// Complete Purchase Flow
router.post('/', async (req, res) => {
    const { userId, dropId, reservationId } = req.body;

    if (!userId || !dropId || !reservationId) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const purchase = await prisma.$transaction(async (tx) => {
            // 1. Verify reservation
            const reservation = await tx.reservation.findUnique({
                where: { 
                    id: reservationId,
                    userId,
                    dropId,
                    status: 'ACTIVE',
                    expiresAt: { gt: new Date() }
                },
            });

            if (!reservation) {
                throw new Error('NO_ACTIVE_RESERVATION_OR_EXPIRED');
            }

            // 2. Mark reservation completed
            await tx.reservation.update({
                where: { id: reservationId },
                data: { status: 'COMPLETED' },
            });

            // 3. Record purchase
            const newPurchase = await tx.purchase.create({
                data: { userId, dropId, reservationId },
                include: { user: { select: { username: true } } }
            });

            return newPurchase;
        });

        // 4. Notify clients for activity feed
        req.io.emit('purchaseCompleted', { 
            dropId, 
            username: purchase.user.username 
        });

        res.status(201).json(purchase);
    } catch (error) {
        console.error("Purchase Error:", error.message);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
