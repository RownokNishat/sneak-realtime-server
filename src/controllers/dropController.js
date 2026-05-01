const prisma = require("../lib/prisma");

exports.getAllDrops = async (req, res, next) => {
    try {
        const drops = await prisma.drop.findMany({
            where: { isActive: true },
            orderBy: { createdAt: "desc" },
        });

        const dropsWithPurchasers = await Promise.all(
            drops.map(async (drop) => {
                const recentPurchases = await prisma.purchase.findMany({
                    where: { dropId: drop.id },
                    orderBy: { createdAt: "desc" },
                    take: 3,
                    include: { user: { select: { username: true } } },
                });
                return {
                    ...drop,
                    recentPurchasers: recentPurchases.map((p) => p.user.username),
                };
            }),
        );

        res.json(dropsWithPurchasers);
    } catch (error) {
        next(error);
    }
};

exports.createDrop = async (req, res, next) => {
    try {
        const { name, description, price, totalStock, startsAt, imageUrl } =
            req.body;
        const drop = await prisma.drop.create({
            data: {
                name,
                description,
                price: parseFloat(price),
                totalStock: parseInt(totalStock),
                availableStock: parseInt(totalStock),
                startsAt: startsAt ? new Date(startsAt) : new Date(),
                imageUrl,
                isActive: true,
            },
        });

        // Broadcast to all clients
        const dropWithFeed = { ...drop, recentPurchasers: [] };
        req.io.emit("newDrop", dropWithFeed);

        res.status(201).json(drop);
    } catch (error) {
        next(error);
    }
};
