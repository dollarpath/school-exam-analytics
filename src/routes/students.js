/**
 * /api/students — list (by class), create, import (CSV), delete.
 */
const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const router = express.Router();
const pool = require('../db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// list students for a class (or all when /api/students?classId=)
router.get('/by-class/:classId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.adm, s.full_name, s.class_id, c.display_name AS class
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.class_id = $1
       ORDER BY s.adm`,
      [req.params.classId]
    );
    return res.json({ students: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load students', detail: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.adm, s.full_name, s.class_id, c.display_name AS class
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
       ORDER BY c.display_name, s.adm`
    );
    return res.json({ students: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load students', detail: err.message });
  }
});

router.post('/', async (req, res) => {
  const { adm, name, class_id } = req.body || {};
  if (!adm || !name) return res.status(400).json({ error: 'ADM and name are required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO students (adm, full_name, class_id) VALUES ($1,$2,$3) RETURNING *',
      [adm.trim(), name.trim(), class_id || null]
    );
    return res.status(201).json({ student: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'ADM number already exists' });
    return res.status(500).json({ error: 'Failed to add student', detail: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { adm, name, class_id } = req.body || {};
  try {
    const { rows } = await pool.query(
      'UPDATE students SET adm=COALESCE($1,adm), full_name=COALESCE($2,full_name), class_id=$3 WHERE id=$4 RETURNING *',
      [adm ? adm.trim() : null, name ? name.trim() : null,
       class_id !== undefined ? (class_id || null) : null, req.params.id]
    );
    return res.json({ student: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'ADM number already exists' });
    return res.status(500).json({ error: 'Failed to update student', detail: err.message });
  }
});

// CSV bulk import. Columns: ADM, Name, Class (class by display name e.g. "Grade 7 East").
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });
  try {
    const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''); // strip BOM
    const records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });

    if (!records.length) return res.status(400).json({ error: 'CSV is empty or has no data rows' });

    // Build class lookup by display name
    const classRes = await pool.query('SELECT id, display_name FROM classes');
    const classByName = {};
    for (const c of classRes.rows) classByName[c.display_name] = c.id;

    let added = 0, updated = 0, skipped = 0;
    const errors = [];
    for (const rec of records) {
      const adm = (rec.ADM || rec.adm || '').trim();
      const name = (rec.Name || rec.name || '').trim();
      const cls = (rec.Class || rec.class || '').trim();
      if (!adm || !name) { skipped++; continue; }
      const classId = classByName[cls];
      try {
        const existing = await pool.query('SELECT id FROM students WHERE adm=$1', [adm]);
        if (existing.rows[0]) {
          await pool.query('UPDATE students SET full_name=$1, class_id=$2 WHERE adm=$3', [name, classId || null, adm]);
          updated++;
        } else {
          await pool.query('INSERT INTO students (adm, full_name, class_id) VALUES ($1,$2,$3)', [adm, name, classId || null]);
          added++;
        }
      } catch (e) {
        errors.push(`${adm}: ${e.message}`);
      }
    }
    return res.json({ ok: true, added, updated, skipped, errors });
  } catch (err) {
    return res.status(400).json({ error: 'Could not parse CSV', detail: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM students WHERE id=$1', [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete student', detail: err.message });
  }
});

module.exports = router;
