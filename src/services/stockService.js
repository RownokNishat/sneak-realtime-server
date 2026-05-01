const prisma = require('../lib/prisma');

const EXPIRY_CHECK_INTERVAL = 5000; // 5 seconds

function startStockRecovery(io) {
    console.log('🔄 Stock recovery service started');
    
    setInterval(async () => {
        try {
            const now = new Date();
            
            // 1. Find all active reservations that have passed their expiry time
            const expiredReservations = await prisma.reservation.findMany({
                where: {
                    status: 'ACTIVE',
                    expiresAt: { lt: now },
                },
                select: { id: true, dropId: true }
            });

            if (expiredReservations.length === 0) return;

            console.log(`⏰ Found ${expiredReservations.length} expired reservations. Recovering stock...`);

            // 2. Group by dropId to minimize database calls and broadcast accurately
            const dropsToUpdate = [...new Set(expiredReservations.map(r => r.dropId))];

            for (const dropId of dropsToUpdate) {
                // Get all reservation IDs for THIS drop that need expiring
                const resIds = expiredReservations
                    .filter(r => r.dropId === dropId)
                    .map(r => r.id);

                try {
                    await prisma.$transaction(async (tx) => {
                        // Mark them as EXPIRED atomically
                        const updateRes = await tx.reservation.updateMany({
                            where: {
                                id: { in: resIds },
                                status: 'ACTIVE'
                            },
                            data: { status: 'EXPIRED' }
                        });

                        // Only restore stock for the number of reservations successfully marked as EXPIRED
                        if (updateRes.count > 0) {
                            const updatedDrop = await tx.drop.update({
                                where: { id: dropId },
                                data: { 
                                    availableStock: { increment: updateRes.count } 
                                }
                            });

                            console.log(`✅ Restored ${updateRes.count} units to Drop: ${dropId}. New stock: ${updatedDrop.availableStock}`);

                            // Broadcast the new "Truth" to all clients
                            io.emit('stockUpdate', {
                                dropId,
                                availableStock: updatedDrop.availableStock,
                            });
                        }
                    });
                } catch (txError) {
                    console.error(`❌ Transaction failed for drop ${dropId}:`, txError);
                }
            }
        } catch (error) {
            console.error('❌ Error in stock recovery service:', error);
        }
    }, EXPIRY_CHECK_INTERVAL);
}

module.exports = { startStockRecovery };
