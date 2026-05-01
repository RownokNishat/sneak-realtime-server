const prisma = require('../lib/prisma');

exports.registerUser = async (req, res, next) => {
    const { username, email } = req.body;
    
    if (!username) {
        return res.status(400).json({ error: "Username is required" });
    }

    try {
        const user = await prisma.user.upsert({
            where: { username },
            update: {}, 
            create: {
                username,
                email: email || `${username}@example.com`
            }
        });
        res.status(201).json(user);
    } catch (error) {
        next(error);
    }
};

exports.getUserByUsername = async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { username: req.params.username }
        });
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json(user);
    } catch (error) {
        next(error);
    }
};
