const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Connection details come from the environment (same as db.js). The
// password used to be written here in plain text — it must be rotated.
// NOTE: Render's disk is wiped on every deploy, so files in ./backups do
// not survive; real backups need Render's own DB backups or an off-site copy.
const DB_HOST = process.env.DB_HOST;
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const BACKUP_DIR = path.join(__dirname, '../backups');
const RETENTION_DAYS = 365;

function runBackup() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const date = new Date().toISOString().split('T')[0];
  const filename = `backup_${date}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);

  if (!DB_HOST || !DB_NAME || !DB_USER || !process.env.DB_PASSWORD) {
    console.error('[BACKUP] Skipped: DB settings missing from the environment');
    return;
  }
  const cmd = `pg_dump -h ${DB_HOST} -U ${DB_USER} -d ${DB_NAME} -F p -f "${filepath}"`;

  exec(cmd, { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD } }, (error, stdout, stderr) => {
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
