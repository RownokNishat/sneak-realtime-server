const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// Get all drops with top 3 recent purchasers
router.get('/', async (req, res) => {
    try {
        const drops = await prisma.drop.findMany({
            where: { isActive: true },
            orderBy: { createdAt: 'desc' },
        });

        const dropsWithPurchasers = await Promise.all(
            drops.map(async (drop) => {
                const recentPurchases = await prisma.purchase.findMany({
                    where: { dropId: drop.id },
                    orderBy: { createdAt: 'desc' },
                    take: 3,
                    include: { user: { select: { username: true } } },
                });
                return {
                    ...drop,
                    recentPurchasers: recentPurchases.map((p) => p.user.username),
                };
            })
        );

        res.json(dropsWithPurchasers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create a new drop (Admin API)
router.post('/', async (req, res) => {
    try {
        const { name, description, price, totalStock, startsAt, imageUrl } = req.body;
        const drop = await prisma.drop.create({
            data: {
                name,
                description,
                price: parseFloat(price),
                totalStock: parseInt(totalStock),
                availableStock: parseInt(totalStock),
                startsAt: startsAt ? new Date(startsAt) : new Date(),
                imageUrl
            },
        });
        res.status(201).json(drop);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
