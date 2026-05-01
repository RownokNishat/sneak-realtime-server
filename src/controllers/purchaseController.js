const prisma = require('../lib/prisma');

exports.createPurchase = async (req, res, next) => {
    const { userId, dropId, reservationId } = req.body;

    if (!userId || !dropId || !reservationId) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const purchase = await prisma.$transaction(async (tx) => {
            const reservation = await tx.reservation.findUnique({
                where: { 
                    id: reservationId,
                    userId,
                    dropId,
                    status: 'ACTIVE',
                    expiresAt: { gt: new Date(Date.now() - 2000) } 
                },
            });

            if (!reservation) {
                throw new Error('RESERVATION_EXPIRED_OR_INVALID');
            }

            await tx.reservation.update({
                where: { id: reservationId },
                data: { status: 'COMPLETED' },
            });

            const newPurchase = await tx.purchase.create({
                data: { userId, dropId, reservationId },
                include: { user: { select: { username: true } } }
            });

            return newPurchase;
        });

        req.io.emit('purchaseCompleted', { 
            dropId, 
            username: purchase.user.username 
        });

        res.status(201).json(purchase);
    } catch (error) {
        if (error.message === 'RESERVATION_EXPIRED_OR_INVALID') {
            return res.status(410).json({ error: error.message });
        }
        next(error);
    }
};
