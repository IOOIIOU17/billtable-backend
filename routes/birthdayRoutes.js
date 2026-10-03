const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimit');
const birthdays = require('../services/birthdayService');

// /api/birthdays — the signed-in customer's own Birthday Calendar
router.get('/', authenticateToken, generalLimiter, async (req, res) => {
  try {
    return res.status(200).json({ status: 'OK', data: { birthdays: await birthdays.listBirthdays(req.user.userId) } });
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

router.post('/', authenticateToken, generalLimiter, async (req, res) => {
  try {
    const b = await birthdays.addBirthday(req.user.userId, req.body || {});
    return res.status(201).json({ status: 'OK', data: { birthday: b } });
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

router.delete('/:id', authenticateToken, generalLimiter, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ status: 'ERROR', message: 'Invalid ID' });
    await birthdays.deleteBirthday(req.user.userId, req.params.id);
    return res.status(200).json({ status: 'OK' });
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

module.exports = router;
