/**
 * POST /api/upload/logo — school logo upload (multipart).
 * Accepts PNG/JPG, resizes to max 300x300 via sharp, stores as
 * /public/uploads/logo.png.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const pool = require('../db');
const cache = require('../cache');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (/image\/(png|jpe?g)/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only PNG or JPG images are allowed'));
  },
});

router.post('/logo', (req, res) => {
  upload.single('logo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const outPath = path.join(UPLOAD_DIR, 'logo.png');
      await sharp(req.file.buffer)
        .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .png()
        .toFile(outPath);

      // Persist the path in the school record
      const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM school');
      const rel = '/public/uploads/logo.png';
      if (rows[0].c === 0) {
        await pool.query('INSERT INTO school (name, logo_path) VALUES ($1,$2)', ['School', rel]);
      } else {
        await pool.query('UPDATE school SET logo_path=$1, updated_at=NOW() WHERE id=(SELECT min(id) FROM school)', [rel]);
      }
      cache.del('init');
      return res.json({ ok: true, logo_path: rel });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to process logo', detail: e.message });
    }
  });
});

module.exports = router;
