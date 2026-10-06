const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
const pool = require('../db');
const { logger } = require('../middleware/logger');

// Party photos: the host's cover photos (top of Table Home) and the shared
// Memory album. Everything is removed 24 hours after the party ends; the
// party counts as ended 6 hours after its start time.
const END_AFTER_START_HOURS = 6;
const KEEP_AFTER_END_HOURS = 24;
const MAX_COVER = 3;
const MAX_MEMORY = 300;
const DELETE_AFTER = `${END_AFTER_START_HOURS + KEEP_AFTER_END_HOURS} hours`;

async function uploadImage(buffer, orderId) {
  const form = new FormData();
  form.append('file', buffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
  form.append('upload_preset', 'billtable_menu');
  form.append('tags', `party_${orderId}`);
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const res = await axios.post(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, form, { headers: form.getHeaders() });
  return { url: res.data.secure_url, publicId: res.data.public_id };
}

// Deleting a file from Cloudinary needs a signed request, so it only works
// when CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are set on Render.
// Without them the photo disappears from BillTable but the file stays on
// Cloudinary — logged so it is noticed.
async function destroyImage(publicId) {
  if (!publicId) return false;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!key || !secret) {
    logger.warn({ publicId }, 'Cloudinary keys missing: photo file not deleted from Cloudinary');
    return false;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1').update(`public_id=${publicId}&timestamp=${timestamp}${secret}`).digest('hex');
  const form = new FormData();
  form.append('public_id', publicId);
  form.append('timestamp', String(timestamp));
  form.append('api_key', key);
  form.append('signature', signature);
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  await axios.post(`https://api.cloudinary.com/v1_1/${cloud}/image/destroy`, form, { headers: form.getHeaders() });
  return true;
}

// When this party's photos get deleted (UTC ISO), or null if no time is set.
async function deleteTimeFor(orderId) {
  const r = await pool.query(
    `SELECT ((delivery_time AT TIME ZONE 'America/Los_Angeles') + INTERVAL '${DELETE_AFTER}') AS t
       FROM orders WHERE id = $1 AND delivery_time IS NOT NULL`,
    [orderId]
  );
  return r.rows[0]?.t || null;
}

async function listPhotos(orderId) {
  const r = await pool.query(
    `SELECT id, user_id, kind, url, uploader_name, created_at FROM party_photos
      WHERE order_id = $1 AND hidden = FALSE ORDER BY kind, created_at`,
    [orderId]
  );
  return {
    cover: r.rows.filter((p) => p.kind === 'cover'),
    memory: r.rows.filter((p) => p.kind === 'memory').reverse(),
    deletesAt: await deleteTimeFor(orderId),
  };
}

async function addPhoto({ orderId, userId, kind, buffer, role }) {
  if (!['cover', 'memory'].includes(kind)) throw Object.assign(new Error('Unknown photo type'), { statusCode: 400 });
  if (kind === 'cover' && !['host', 'admin'].includes(role)) {
    throw Object.assign(new Error('Only the host can change the party photos.'), { statusCode: 403 });
  }
  if (!['host', 'member', 'admin'].includes(role)) {
    throw Object.assign(new Error('Only people at this party can add photos.'), { statusCode: 403 });
  }
  const deletesAt = await deleteTimeFor(orderId);
  if (deletesAt && new Date(deletesAt).getTime() <= Date.now()) {
    throw Object.assign(new Error('This party is over and its photos have been cleared.'), { statusCode: 400 });
  }
  const count = await pool.query('SELECT COUNT(*)::int AS c FROM party_photos WHERE order_id = $1 AND kind = $2', [orderId, kind]);
  const max = kind === 'cover' ? MAX_COVER : MAX_MEMORY;
  if (count.rows[0].c >= max) {
    throw Object.assign(new Error(kind === 'cover' ? `Up to ${MAX_COVER} party photos. Remove one first.` : 'The Memory album is full.'), { statusCode: 400 });
  }
  const who = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);
  const { url, publicId } = await uploadImage(buffer, orderId);
  const r = await pool.query(
    `INSERT INTO party_photos (order_id, user_id, kind, url, public_id, uploader_name)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, user_id, kind, url, uploader_name, created_at`,
    [orderId, userId, kind, url, publicId, (who.rows[0]?.name || '').slice(0, 80) || null]
  );
  return r.rows[0];
}

// The person who added it, or the host, can remove a photo.
async function removePhoto({ orderId, photoId, userId, role }) {
  const r = await pool.query('SELECT id, user_id, public_id FROM party_photos WHERE id = $1 AND order_id = $2', [photoId, orderId]);
  const p = r.rows[0];
  if (!p) throw Object.assign(new Error('Photo not found'), { statusCode: 404 });
  if (Number(p.user_id) !== Number(userId) && !['host', 'admin'].includes(role)) {
    throw Object.assign(new Error('Only the person who added it, or the host, can remove this photo.'), { statusCode: 403 });
  }
  await pool.query('DELETE FROM party_photos WHERE id = $1', [p.id]);
  destroyImage(p.public_id).catch((e) => logger.error({ error: e.message }, 'Cloudinary delete failed'));
}

// Report: hidden for everyone at once, then BillTable reviews it.
async function reportPhoto({ orderId, photoId, userId }) {
  const r = await pool.query(
    `UPDATE party_photos SET hidden = TRUE, reported_by = $3
      WHERE id = $1 AND order_id = $2 RETURNING id, url, user_id, uploader_name`,
    [photoId, orderId, userId]
  );
  if (!r.rows[0]) throw Object.assign(new Error('Photo not found'), { statusCode: 404 });
  return r.rows[0];
}

// Hourly: delete every photo of parties that ended more than a day ago.
async function cleanupExpiredPhotos() {
  try {
    const r = await pool.query(
      `DELETE FROM party_photos
        WHERE order_id IN (
          SELECT id FROM orders
           WHERE delivery_time IS NOT NULL
             AND (delivery_time AT TIME ZONE 'America/Los_Angeles') + INTERVAL '${DELETE_AFTER}' < NOW()
        )
        RETURNING public_id`
    );
    for (const row of r.rows) {
      await destroyImage(row.public_id).catch((e) => logger.error({ error: e.message }, 'Cloudinary delete failed'));
    }
    if (r.rowCount > 0) logger.info({ deleted: r.rowCount }, 'Expired party photos cleaned up');
  } catch (error) {
    logger.error({ error: error.message }, 'Party photo cleanup failed');
  }
}

module.exports = { listPhotos, addPhoto, removePhoto, reportPhoto, cleanupExpiredPhotos, destroyImage };
