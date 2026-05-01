const prisma = require('../lib/prisma');

const EXPIRY_CHECK_INTERVAL = 5000; // 5 seconds

function startStockRecovery(io) {
    console.log('🔄 Stock recovery service started');
    
    setInterval(async () => {
        try {
            const now = new Date();
            
            // Find all active reservations that have expired
            const expiredReservations = await prisma.reservation.findMany({
                where: {
                    status: 'ACTIVE',
                    expiresAt: { lt: now },
                },
            });

            if (expiredReservations.length === 0) return;

            console.log(`⏰ Found ${expiredReservations.length} expired reservations`);

            for (const res of expiredReservations) {
                // Use a transaction to mark expired and restore stock atomically
                await prisma.$transaction(async (tx) => {
                    // Mark this specific reservation as EXPIRED only if still ACTIVE
                    const updateRes = await tx.reservation.updateMany({
                        where: { id: res.id, status: 'ACTIVE' },
                        data: { status: 'EXPIRED' },
                    });

                    if (updateRes.count > 0) {
                        // Restore the stock
                        const updatedDrop = await tx.drop.update({
                            where: { id: res.dropId },
                            data: { availableStock: { increment: 1 } },
                        });

                        console.log(`✅ Restored 1 unit to Drop: ${res.dropId}. New stock: ${updatedDrop.availableStock}`);

                        // Notify all clients about the stock change
                        io.emit('stockUpdate', {
                            dropId: res.dropId,
                            availableStock: updatedDrop.availableStock,
                        });
                    }
                });
            }
        } catch (error) {
            console.error('❌ Error in stock recovery service:', error);
        }
    }, EXPIRY_CHECK_INTERVAL);
}

module.exports = { startStockRecovery };
