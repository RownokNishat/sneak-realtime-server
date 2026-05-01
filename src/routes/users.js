const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// Create user (handles both / and /register)
router.post(['/', '/register'], async (req, res) => {
    const { username, email } = req.body;
    
    if (!username) {
        return res.status(400).json({ error: "Username is required" });
    }

    try {
        // Upsert user: find by username, update nothing, or create new
        const user = await prisma.user.upsert({
            where: { username },
            update: {}, // No updates if user exists
            create: {
                username,
                email: email || `${username}@example.com`
            }
        });
        res.status(201).json(user);
    } catch (error) {
        console.error("User registration error:", error);
        res.status(400).json({ error: error.message });
    }
});

// Get user by username
router.get('/:username', async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { username: req.params.username }
        });
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
