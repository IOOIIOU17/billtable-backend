// ============================================================
// matchingRoutes.js
// API endpoint สำหรับจับคู่ร้าน+เมนู กับ requirements ลูกค้า
// ============================================================

const express = require('express');
const router = express.Router();
const { findMatches } = require('../services/matchingService');
const { authenticateToken } = require('../middleware/auth');
const { matchingLimiter } = require('../middleware/rateLimit');

// ============================================================
// POST /api/matching/find
// รับ requirements ของลูกค้า → คืนร้าน+เมนูที่ match (top 5)
// ============================================================
router.post('/find', authenticateToken, matchingLimiter, async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      cuisine_type,
      allergies,
      avoid_spicy,
      budget,
      guest_count,
    } = req.body;

    // --- ตรวจสอบ input ที่จำเป็น ---
    if (latitude == null || longitude == null) {
      return res.status(400).json({
        success: false,
        error: 'ต้องระบุ latitude และ longitude (ตำแหน่งจัดส่ง)',
      });
    }

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'latitude และ longitude ต้องเป็นตัวเลข',
      });
    }

    // --- เรียก matching service ---
    const result = await findMatches({
      latitude,
      longitude,
      cuisine_type: cuisine_type || null,
      allergies: allergies || [],
      avoid_spicy: avoid_spicy || false,
      budget: budget || null,
      guest_count: guest_count || 1,
    });

    // --- ถ้าไม่เจอร้านที่ match เลย ---
    if (result.count === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        matches: [],
        message: 'ไม่พบร้านที่ตรงเงื่อนไข ลองปรับ budget หรือขยายพื้นที่',
      });
    }

    // --- คืนผลลัพธ์ ---
    return res.status(200).json(result);

  } catch (err) {
    console.error('Matching error:', err);
    return res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการจับคู่ร้าน',
    });
  }
});

module.exports = router;
