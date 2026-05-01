const prisma = require('./src/lib/prisma');

async function runAtomicTest() {
    try {
        console.log('⚡ CREATING ATOMIC TEST DROP (Stock: 1)...');
        const drop = await prisma.drop.create({
            data: {
                name: `CONCURRENCY_TEST_${Date.now()}`,
                price: 999,
                totalStock: 1,
                availableStock: 1,
                isActive: true
            }
        });

        console.log(`🎯 Target Drop ID: ${drop.id}`);
        
        const API_URL = 'http://localhost:3001/api';
        const USERS_COUNT = 10;

        console.log(`🚀 Registering ${USERS_COUNT} competitors...`);
        const users = await Promise.all(
            Array.from({ length: USERS_COUNT }).map((_, i) => 
                fetch(`${API_URL}/users/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: `racer_${i}_${Date.now()}` })
                }).then(res => res.json())
            )
        );

        console.log('🏁 THE RACE IS ON! (10 users for 1 item)...');
        
        const requests = users.map(u => 
            fetch(`${API_URL}/reservations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: u.id,
                    dropId: drop.id
                })
            }).then(async r => ({ status: r.status, data: await r.json() }))
        );

        const results = await Promise.all(requests);
        
        const successes = results.filter(r => r.status === 201).length;
        const failures = results.filter(r => r.status === 400 && r.data.error === 'OUT_OF_STOCK').length;

        console.log(`\n--- Concurrency Results ---`);
        console.log(`Successful Reservations: ${successes}`);
        console.log(`Out of Stock Failures: ${failures}`);
        
        if (successes === 1) {
            console.log('✅ ATOMICITY PROVEN: Exactly 1 user succeeded!');
        } else {
            console.error(`❌ ATOMICity FAILURE: ${successes} users succeeded!`);
        }

        process.exit(0);
    } catch (e) {
        console.error('Test Failed:', e);
        process.exit(1);
    }
}

runAtomicTest();
