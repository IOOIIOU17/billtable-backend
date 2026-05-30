// ============================================================
// upload.js - Multer Middleware
// รับไฟล์ CSV และรูปอาหารจาก request
// ============================================================

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ============================================================
// 1) CSV Upload — เก็บใน RAM (ไม่บันทึก disk)
// ============================================================

const csvStorage = multer.memoryStorage();

const csvFileFilter = (req, file, cb) => {
  // อนุญาตเฉพาะไฟล์ .csv
  if (file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.toLowerCase().endsWith('.csv')) {
    cb(null, true);
  } else {
    cb(new Error('รับเฉพาะไฟล์ CSV (.csv) เท่านั้น'), false);
  }
};

const uploadCsv = multer({
  storage: csvStorage,
  fileFilter: csvFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
});

// ============================================================
// 2) Image Upload — เก็บลง folder uploads/menus/
// ============================================================

const uploadsDir = path.join(__dirname, '..', 'uploads', 'menus');

// สร้าง folder ถ้ายังไม่มี
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // ตั้งชื่อไฟล์: timestamp-randomnumber.extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'menu-' + uniqueSuffix + ext);
  },
});

const imageFileFilter = (req, file, cb) => {
  // อนุญาตเฉพาะรูป jpg, jpeg, png, webp
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('รับเฉพาะรูปภาพ (jpg, jpeg, png, webp) เท่านั้น'), false);
  }
};

const uploadImage = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
});

// ============================================================
// 3) Error Handler — แปลง Multer error เป็น JSON
// ============================================================

const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'ไฟล์ใหญ่เกินไป (max 5 MB)',
      });
    }
    return res.status(400).json({
      success: false,
      error: 'อัพโหลดไฟล์ผิดพลาด: ' + err.message,
    });
  }

  if (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }

  next();
};

module.exports = {
  uploadCsv,
  uploadImage,
  handleUploadError,
};