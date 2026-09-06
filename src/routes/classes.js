/**
 * /api/classes — list, create, delete classes.
 * Class GETs are scoped to the active academic year from config.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { getConfig } = require('../utils/school');

async function activeYearId() {
  const cfg = await getConfig();
  const year = cfg.academic_year ? Number(cfg.academic_year) : new Date().getFullYear();
  const { rows } = await pool.query('SELECT id FROM academic_years WHERE year=$1', [year]);
  return rows[0] ? rows[0].id : null;
}

// list all classes (optionally ?year=)
router.get('/', async (req, res) => {
  try {
    if (pool.isLocalFallback) {
      const { rows } = await pool.query(
        `SELECT c.*, ay.year
         FROM classes c JOIN academic_years ay ON ay.id = c.year_id
         ORDER BY ay.year DESC, c.name, c.stream`
      );
      return res.json({ classes: rows.map((row) => ({
        ...row,
        display_name: row.stream ? `${row.name} ${row.stream}` : row.name,
        student_count: 0,
      })) });
    }
    const { rows } = await pool.query(
      `SELECT c.*, ay.year,
              (SELECT COUNT(*)::int FROM students s WHERE s.class_id = c.id) AS student_count
       FROM classes c
       JOIN academic_years ay ON ay.id = c.year_id
       ORDER BY ay.year DESC, c.name, c.stream`
    );
    return res.json({ classes: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load classes', detail: err.message });
  }
});

router.post('/', async (req, res) => {
  const { name, stream, year_id } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Class name is required' });
  try {
    let yid = year_id || (await activeYearId());
    if (!yid) {
      const year = new Date().getFullYear();
      const yr = await pool.query('INSERT INTO academic_years (year) VALUES ($1) RETURNING id', [year]);
      yid = yr.rows[0].id;
    }
    const { rows } = await pool.query(
      'INSERT INTO classes (year_id, name, stream) VALUES ($1,$2,$3) RETURNING *',
      [yid, name.trim(), (stream || '').trim() || null]
    );
    return res.status(201).json({ class: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That class already exists for this year' });
    return res.status(500).json({ error: 'Failed to create class', detail: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Clear dependent records explicitly so deletion works on existing databases
    // whose foreign keys were created without the intended cascade behavior.
    await client.query('DELETE FROM teacher_classes WHERE class_id=$1', [req.params.id]);
    await client.query('DELETE FROM timetable_slots WHERE class_id=$1', [req.params.id]);
    await client.query('UPDATE students SET class_id=NULL WHERE class_id=$1', [req.params.id]);
    await client.query('DELETE FROM classes WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Failed to delete class', detail: err.message });
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  const { name, stream } = req.body || {};
  try {
    const { rows } = await pool.query(
      'UPDATE classes SET name=COALESCE($1,name), stream=COALESCE($2,stream) WHERE id=$3 RETURNING *',
      [name ? name.trim() : null, stream ? stream.trim() : null, req.params.id]
    );
    return res.json({ class: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update class', detail: err.message });
  }
});

module.exports = router;
