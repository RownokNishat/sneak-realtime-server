const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// Create user (for demo)
router.post('/register', async (req, res) => {
    const { username, email } = req.body;
    try {
        const user = await prisma.user.create({
            data: { username, email }
        });
        res.status(201).json(user);
    } catch (error) {
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
