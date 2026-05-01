const prisma = require('../lib/prisma');

const EXPIRY_CHECK_INTERVAL = 5000; // 5 seconds

function startStockRecovery(io) {
    console.log('🔄 Stock recovery service started');
    
    setInterval(async () => {
        try {
            const now = new Date();
            
            // Find all active reservations that have passed their expiry time
            const expiredReservations = await prisma.reservation.findMany({
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

                try {
                    // Standard transaction (No Serializable to prevent conflicts with user reservations)
                    await prisma.$transaction(async (tx) => {
                        // Mark as EXPIRED atomically
                        const updateRes = await tx.reservation.updateMany({
                            where: {
                                id: { in: resIdsForThisDrop },
                                status: 'ACTIVE'
                            },
                            data: { status: 'EXPIRED' }
                        });

                        // If we successfully expired some, restore the stock
                        if (updateRes.count > 0) {
                            const updatedDrop = await tx.drop.update({
                                where: { id: dropId },
                                data: { availableStock: { increment: updateRes.count } }
                            });

                            console.log(`✅ [RESTORED] ${updateRes.count} units to ${updatedDrop.name}. New Stock: ${updatedDrop.availableStock}`);

                            // Broadcast update
                            io.emit('stockUpdate', {
                                dropId: dropId,
                                availableStock: updatedDrop.availableStock,
                            });
                        }
                    });
                } catch (txError) {
                    // Conflict or deadlock - standard in high concurrency, skip and let next interval handle it
                    if (txError.code !== 'P2034') {
                        console.error(`❌ Recovery failed for drop ${dropId}:`, txError.message);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Error in stock recovery service:', error);
        }
    }, EXPIRY_CHECK_INTERVAL);
}

module.exports = { startStockRecovery };
