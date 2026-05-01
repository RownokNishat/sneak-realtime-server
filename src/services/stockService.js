const prisma = require('../lib/prisma');

const EXPIRY_CHECK_INTERVAL = 5000; // 5 seconds

function startStockRecovery(io) {
    console.log('🔄 Stock recovery service started');
    
    setInterval(async () => {
        try {
            const now = new Date();
            
            // 1. Process EVERYTHING in one atomic transaction to prevent "missing" a drop
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

                // Group by dropId to handle multiple different products at once
                const dropIds = [...new Set(expiredReservations.map(r => r.dropId))];

                for (const dropId of dropIds) {
                    const resIdsForThisDrop = expiredReservations
                        .filter(r => r.dropId === dropId)
                        .map(r => r.id);

                    // Mark as EXPIRED atomically within this drop's scope
                    const updateRes = await tx.reservation.updateMany({
                        where: {
                            id: { in: resIdsForThisDrop },
                            status: 'ACTIVE'
                        },
                        data: { status: 'EXPIRED' }
                    });

                    // If we successfully expired some, restore the stock for THIS drop
                    if (updateRes.count > 0) {
                        const updatedDrop = await tx.drop.update({
                            where: { id: dropId },
                            data: { availableStock: { increment: updateRes.count } }
                        });

                        console.log(`✅ [RESTORED] ${updateRes.count} units to ${updatedDrop.name}. New Stock: ${updatedDrop.availableStock}`);

                        // Broadcast update to all clients
                        io.emit('stockUpdate', {
                            dropId: dropId,
                            availableStock: updatedDrop.availableStock,
                        });
                    }
                }
            }, {
                // Serializable isolation prevents any other process from reading these rows while we update them
                isolationLevel: 'Serializable'
            });

        } catch (error) {
            // P2034 is a database write conflict error. This is normal and safe in a distributed system
            // as it means another tick or another process already handled the restoration.
            if (error.code !== 'P2034') {
                console.error('❌ Stock recovery service error:', error);
            }
        }
    }, EXPIRY_CHECK_INTERVAL);
}

module.exports = { startStockRecovery };
