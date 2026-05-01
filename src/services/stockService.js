const prisma = require('../lib/prisma');

const EXPIRY_CHECK_INTERVAL = 3000;

function startStockRecovery(io) {
    console.log('Stock recovery service started');
    
    setInterval(async () => {
        try {
            const now = new Date();
            const updatesToBroadcast = [];

            await prisma.$transaction(async (tx) => {
                const expiredReservations = await tx.reservation.findMany({
                    where: {
                        status: 'ACTIVE',
                        expiresAt: { lt: now },
                    }
                });

                if (expiredReservations.length === 0) return;

                console.log(`Recovery: ${expiredReservations.length} expired`);

                const dropIds = [...new Set(expiredReservations.map(r => r.dropId))];

                for (const dropId of dropIds) {
                    const resIdsForThisDrop = expiredReservations
                        .filter(r => r.dropId === dropId)
                        .map(r => r.id);

                    const updateRes = await tx.reservation.updateMany({
                        where: {
                            id: { in: resIdsForThisDrop },
                            status: 'ACTIVE'
                        },
                        data: { status: 'EXPIRED' }
                    });

                    if (updateRes.count > 0) {
                        const updatedDrop = await tx.drop.update({
                            where: { id: dropId },
                            data: { availableStock: { increment: updateRes.count } }
                        });

                        updatesToBroadcast.push({
                            dropId,
                            availableStock: updatedDrop.availableStock
                        });
                    }
                }
            }, {
                isolationLevel: 'ReadCommitted'
            });

            updatesToBroadcast.forEach(update => {
                io.emit('stockUpdate', update);
            });

        } catch (error) {
            if (error.code !== 'P2034') {
                console.error('Stock recovery error:', error.message);
            }
        }
    }, EXPIRY_CHECK_INTERVAL);
}

module.exports = { startStockRecovery };
