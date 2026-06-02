const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const DB_HOST = 'dpg-d8dh52jbc2fs73ekhl30-a.oregon-postgres.render.com';
const DB_NAME = 'billtable';
const DB_USER = 'billtable_user';
const BACKUP_DIR = path.join(__dirname, '../backups');
const RETENTION_DAYS = 365;

function runBackup() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const date = new Date().toISOString().split('T')[0];
  const filename = `backup_${date}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);

  const cmd = `PGPASSWORD=bEg9K1v1xtgGIcZeMrocDG2yklSKbOQE pg_dump -h ${DB_HOST} -U ${DB_USER} -d ${DB_NAME} -F p -f "${filepath}"`;

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`[BACKUP] Failed: ${error.message}`);
      return;
    }
    console.log(`[BACKUP] Success: ${filename}`);
    cleanOldBackups();
  });
}

function cleanOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR);
  const now = Date.now();
  const maxAge = RETENTION_DAYS * 24 * 60 * 60 * 1000;

  files.forEach((file) => {
    const filepath = path.join(BACKUP_DIR, file);
    const stat = fs.statSync(filepath);
    if (now - stat.mtimeMs > maxAge) {
      fs.unlinkSync(filepath);
      console.log(`[BACKUP] Deleted old backup: ${file}`);
    }
  });
}

module.exports = { runBackup };
