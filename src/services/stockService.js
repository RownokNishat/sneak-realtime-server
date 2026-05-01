const prisma = require('../lib/prisma');

const EXPIRY_CHECK_INTERVAL = 5000; // 5 seconds

function startStockRecovery(io) {
    console.log('🔄 Stock recovery service started');
    
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

                // Group by dropId
                const dropIds = [...new Set(expiredReservations.map(r => r.dropId))];

                for (const dropId of dropIds) {
                    const resIdsForThisDrop = expiredReservations
                        .filter(r => r.dropId === dropId)
                        .map(r => r.id);

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

                        // Collect updates for broadcasting AFTER the transaction commits
                        updatesToBroadcast.push({
                            dropId,
                            availableStock: updatedDrop.availableStock
                        });
                    }
                }
            });

            // 2. ONLY broadcast after the transaction has successfully committed!
            // This prevents "Phantom Stock" where UI updates but DB rolled back.
            updatesToBroadcast.forEach(update => {
                console.log(`📡 Broadcasting stock update for ${update.dropId}: ${update.availableStock}`);
                io.emit('stockUpdate', update);
            });

        } catch (error) {
            // P2034 is a write conflict/deadlock, which is safe to ignore (handled by next interval)
            if (error.code !== 'P2034') {
                console.error('❌ Stock recovery service error:', error.message);
            }
        }
    }, EXPIRY_CHECK_INTERVAL);
}

module.exports = { startStockRecovery };
