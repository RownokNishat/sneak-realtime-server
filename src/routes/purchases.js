const express = require('express');
const router = require('express').Router();
const prisma = require('../lib/prisma');

// Complete Purchase Flow with Grace Period
router.post('/', async (req, res) => {
    const { userId, dropId, reservationId } = req.body;

    if (!userId || !dropId || !reservationId) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const purchase = await prisma.$transaction(async (tx) => {
            // 1. Verify reservation with a 2-second grace period
            // This handles network latency and prevents "failed at the last millisecond" errors
            const reservation = await tx.reservation.findUnique({
                where: { 
                    id: reservationId,
                    userId,
                    dropId,
                    status: 'ACTIVE',
                    expiresAt: { gt: new Date(Date.now() - 2000) } // 2s Grace Period
                },
            });

            if (!reservation) {
                throw new Error('RESERVATION_EXPIRED_OR_INVALID');
            }

            // 2. Mark reservation completed
            await tx.reservation.update({
                where: { id: reservationId },
                data: { status: 'COMPLETED' },
            });

            // 3. Record purchase
            const newPurchase = await tx.purchase.create({
                data: { 
                    userId, 
                    dropId, 
                    reservationId 
                },
                include: { 
                    user: { select: { username: true } } 
                }
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
        
        // If it was an expiration, we want the frontend to know specifically
        const statusCode = error.message === 'RESERVATION_EXPIRED_OR_INVALID' ? 410 : 400;
        res.status(statusCode).json({ error: error.message });
    }
});

module.exports = router;
