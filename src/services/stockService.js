const prisma = require('../lib/prisma');

const EXPIRY_CHECK_INTERVAL = 3000; // Faster recovery (3 seconds)

function startStockRecovery(io) {
    console.log('🔄 Stock recovery service started (3s interval)');
    
    setInterval(async () => {
        try {
            const now = new Date();
            const updatesToBroadcast = [];

            // 1. Process EVERYTHING in one atomic transaction
            await prisma.$transaction(async (tx) => {
                // Find all active reservations that have expired
                const expiredReservations = await tx.reservation.findMany({
                    where: {
                        status: 'ACTIVE',
                        expiresAt: { lt: now },
                    }
                });

                if (expiredReservations.length === 0) return;

                console.log(`⏰ [RECOVERY] Processing ${expiredReservations.length} total expired reservations...`);

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

                        console.log(`✅ [RESTORED] ${updateRes.count} units to ${updatedDrop.name}. New Stock: ${updatedDrop.availableStock}`);

                        updatesToBroadcast.push({
                            dropId,
                            availableStock: updatedDrop.availableStock
                        });
                    }
                }
            }, {
                isolationLevel: 'ReadCommitted' // Standard isolation for better performance
            });

            // 2. Broadcast updates AFTER commit
            updatesToBroadcast.forEach(update => {
                io.emit('stockUpdate', update);
            });

        } catch (error) {
            if (error.code !== 'P2034') {
                console.error('❌ Stock recovery service error:', error.message);
            }
        }
    }, EXPIRY_CHECK_INTERVAL);
}

module.exports = { startStockRecovery };
