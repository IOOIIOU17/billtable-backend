// ============================================================
// csvParser.js
// อ่านไฟล์ CSV ของเมนูร้าน แปลงเป็น JavaScript Object Array
// ============================================================

const { parse } = require('csv-parse/sync');

/**
 * แปลงไฟล์ CSV เป็น array ของเมนูอาหาร
 * @param {Buffer} fileBuffer - ไฟล์ CSV ที่อัพโหลด
 * @returns {Object} - { success, data, errors }
 */
function parseMenuCsv(fileBuffer) {
  const errors = [];
  const validMenus = [];

  try {
    // อ่าน CSV เป็น array of objects (ใช้บรรทัดแรกเป็น header)
    const records = parse(fileBuffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    // ตรวจสอบแต่ละบรรทัด
    records.forEach((row, index) => {
      const rowNumber = index + 2; // บรรทัด 1 คือ header, ข้อมูลเริ่มที่ 2
      const rowErrors = [];

      // 1) เช็คว่ามีชื่อเมนู
      if (!row.name || row.name.trim() === '') {
        rowErrors.push('ชื่อเมนูว่าง');
      }

      // 2) เช็คราคา (ต้องเป็นตัวเลข > 0)
      const price = parseFloat(row.price);
      if (isNaN(price) || price <= 0) {
        rowErrors.push('ราคาไม่ถูกต้อง (ต้องเป็นตัวเลข > 0)');
      }

      // 3) เช็ค cuisine type
      if (!row.cuisine || row.cuisine.trim() === '') {
        rowErrors.push('cuisine ว่าง');
      }

      // 4) เช็ค spicy level (1-5)
      const spicy = parseInt(row.spicy_level || row.spicy || '1');
      if (isNaN(spicy) || spicy < 1 || spicy > 5) {
        rowErrors.push('spicy_level ต้องอยู่ระหว่าง 1-5');
      }

      // ถ้ามี error → เก็บไว้
      if (rowErrors.length > 0) {
        errors.push({
          row: rowNumber,
          name: row.name || '(ไม่มีชื่อ)',
          errors: rowErrors,
        });
        return;
      }

      // ถ้าผ่านทุกการตรวจสอบ → เพิ่มลง validMenus
      validMenus.push({
        name: row.name.trim(),
        description: (row.description || '').trim(),
        price: price,
        cuisine_type: row.cuisine.trim(),
        spicy_level: spicy,
        allergies: row.allergies
          ? row.allergies.split(',').map(a => a.trim()).filter(a => a)
          : [],
        image_url: (row.image_url || '').trim(),
        is_available: true,
      });
    });

    return {
      success: errors.length === 0,
      data: validMenus,
      errors: errors,
      total: records.length,
      valid: validMenus.length,
      invalid: errors.length,
    };

  } catch (err) {
    return {
      success: false,
      data: [],
      errors: [{ row: 0, error: 'ไฟล์ CSV เสียหายหรือ format ผิด: ' + err.message }],
      total: 0,
      valid: 0,
      invalid: 0,
    };
  }
}

module.exports = { parseMenuCsv };
