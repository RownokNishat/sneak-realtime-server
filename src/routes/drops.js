const express = require('express');
const router = express.Router();
const dropController = require('../controllers/dropController');

router.get('/', dropController.getAllDrops);
router.post('/', dropController.createDrop);

module.exports = router;
