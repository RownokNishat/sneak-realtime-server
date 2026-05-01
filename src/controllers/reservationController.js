const prisma = require('../lib/prisma');

const MAX_RETRIES = 3;

exports.createReservation = async (req, res, next) => {
    const { userId, dropId } = req.body;

    if (!userId || !dropId) {
        return res.status(400).json({ error: "userId and dropId are required" });
    }

    let attempts = 0;
    
    const executeReservation = async () => {
        return await prisma.$transaction(async (tx) => {
            const existing = await tx.reservation.findFirst({
                where: {
                    userId,
                    dropId,
                    status: 'ACTIVE',
                    expiresAt: { gt: new Date() }
                }
            });

            if (existing) return { reservation: existing, reused: true };

            const dropUpdate = await tx.drop.updateMany({
                where: {
                    id: dropId,
                    availableStock: { gt: 0 },
                    startsAt: { lte: new Date() },
                    isActive: true
                },
                data: { availableStock: { decrement: 1 } },
            });

            if (dropUpdate.count === 0) throw new Error('OUT_OF_STOCK');

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
                await new Promise(resolve => setTimeout(resolve, attempts * 50));
            }
        }

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
        next(error);
    }
};
