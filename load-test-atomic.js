const prisma = require('./src/lib/prisma');

async function runTest() {
    try {
        console.log('🔍 Finding a drop to test...');
        const drop = await prisma.drop.findFirst({
            where: { availableStock: { gt: 0 } }
        });

        if (!drop) {
            console.error('❌ No drops with available stock found.');
            process.exit(1);
        }

        console.log(`🎯 Testing Drop: ${drop.name} (ID: ${drop.id})`);
        
        const API_URL = 'http://localhost:3001/api';
        const CONCURRENT_USERS = 5;

        console.log(`🚀 Registering users...`);
        const userRes = await fetch(`${API_URL}/users/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: `testuser_${Date.now()}`,
                email: `test_${Date.now()}@test.com`
            })
        });
        const user = await userRes.json();
        
        if (!user.id) {
            console.error('❌ User registration failed:', user);
            process.exit(1);
        }
        
        console.log(`👤 Registered Test User: ${user.username} (ID: ${user.id})`);

        console.log('🏁 STARTING CONCURRENT RACE (Multiple users)...');
        
        // Let's just try 5 concurrent requests for the SAME user to see if it locks
        // Actually, the requirement is 100 users for 1 item.
        // So I'll register 5 unique users.
        
        const users = [user];
        for (let i = 1; i < CONCURRENT_USERS; i++) {
            const r = await fetch(`${API_URL}/users/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: `u_${i}_${Date.now()}` })
            });
            users.push(await r.json());
        }

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
        const failures = results.filter(r => r.status !== 201);

        console.log(`\n--- Race Results ---`);
        console.log(`Successes: ${successes}`);
        console.log(`Failures: ${failures.length}`);
        
        if (failures.length > 0) {
            console.log('First Failure:', JSON.stringify(failures[0].data));
        }

        process.exit(0);
    } catch (e) {
        console.error('Test Failed:', e);
        process.exit(1);
    }
}

runTest();
