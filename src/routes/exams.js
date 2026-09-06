/**
 * /api/exams — list all exams (with term info), get active exam,
 * update exam state (activate, open/close entry, publish/unpublish).
 */
const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const router = express.Router();
const pool = require('../db');
const cache = require('../cache');
const { requireAdmin } = require('../middleware/auth');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// all exams with term + year info
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, t.number AS term_number, t.label AS term_label, t.year_id,
              ay.year
       FROM exams e
       JOIN terms t ON t.id = e.term_id
       JOIN academic_years ay ON ay.id = t.year_id
       ORDER BY ay.year DESC, t.number, e.type`
    );
    const terms = await pool.query(
      `SELECT t.id, t.number, t.label, ay.year
       FROM terms t JOIN academic_years ay ON ay.id=t.year_id
       ORDER BY ay.year DESC, t.number`
    );
    return res.json({ exams: rows, terms: terms.rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load exams', detail: err.message });
  }
});

// Upload or create exam setup rows. CSV columns: term,type,label.
router.post('/import', requireAdmin, upload.single('exam_file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a CSV exam file' });
    const records = parse(req.file.buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
    if (!records.length) return res.status(400).json({ error: 'The CSV file has no exam rows' });
    const terms = await pool.query('SELECT id, number FROM terms');
    const termByNumber = new Map(terms.rows.map((term) => [String(term.number), term.id]));
    const client = await pool.connect();
    let added = 0;
    try {
      await client.query('BEGIN');
      for (const row of records) {
        const termId = termByNumber.get(String(row.term || '').trim());
        const type = String(row.type || '').trim().toUpperCase();
        if (!termId || !['MID', 'END'].includes(type)) continue;
        await client.query(
          'INSERT INTO exams (term_id, type, label) VALUES ($1,$2,$3)',
          [termId, type, String(row.label || `${type} exam`).trim()]
        );
        added += 1;
      }
      if (!added) throw new Error('No valid rows found. Use term,type,label with MID or END.');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    cache.del('init');
    return res.json({ ok: true, added });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to import exams' });
  }
});

// currently active exam (single active at a time)
router.get('/active', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, t.number AS term_number, t.label AS term_label, ay.year
       FROM exams e
       JOIN terms t ON t.id = e.term_id
       JOIN academic_years ay ON ay.id = t.year_id
       WHERE e.is_active = TRUE
       LIMIT 1`
    );
    return res.json({ exam: rows[0] || null });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load active exam', detail: err.message });
  }
});

// update exam state — supports { is_active, entry_open, published, label }
router.put('/:id', requireAdmin, async (req, res) => {
  const { is_active, entry_open, published, label } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_active !== undefined && is_active === true) {
      // only one active at a time
      await client.query('UPDATE exams SET is_active=FALSE');
    }
    await client.query(
      `UPDATE exams SET
         is_active=COALESCE($1,is_active),
         entry_open=COALESCE($2,entry_open),
         published=COALESCE($3,published),
         label=COALESCE($4,label)
       WHERE id=$5`,
      [is_active !== undefined ? !!is_active : null,
       entry_open !== undefined ? !!entry_open : null,
       published !== undefined ? !!published : null,
       label || null, req.params.id]
    );
    await client.query('COMMIT');
    cache.del('init');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Failed to update exam', detail: err.message });
  } finally {
    client.release();
  }
});

// create a new exam (admin)
router.post('/', requireAdmin, async (req, res) => {
  const { term_id, type, label } = req.body || {};
  if (!term_id || !type) return res.status(400).json({ error: 'Term and type are required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO exams (term_id, type, label, is_active) VALUES ($1,$2,$3,FALSE) RETURNING *',
      [term_id, type, label || `${type} exam`]
    );
    return res.status(201).json({ exam: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create exam', detail: err.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM exams WHERE id=$1', [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete exam', detail: err.message });
  }
});

module.exports = router;
