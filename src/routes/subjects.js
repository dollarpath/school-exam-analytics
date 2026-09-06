/**
 * /api/subjects — list, create, update, delete subjects.
 * Rubric override may be passed per subject (JSON array) or omitted to use
 * the global default from system_config.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { DEFAULT_RUBRIC, normaliseRubric } = require('../utils/grading');

// list subjects with default rubric merged
router.get('/', async (req, res) => {
  try {
    const gres = await pool.query(`SELECT value FROM system_config WHERE key='rubric_global'`);
    const globalRubric = normaliseRubric(gres.rows[0] ? gres.rows[0].value : DEFAULT_RUBRIC);
    const { rows } = await pool.query('SELECT * FROM subjects ORDER BY sort_order, code');
    const enriched = rows.map((s) => ({
      ...s,
      rubric: s.rubric ? normaliseRubric(s.rubric) : globalRubric,
      uses_global: !s.rubric,
    }));
    return res.json({ subjects: enriched, global_rubric: globalRubric });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load subjects', detail: err.message });
  }
});

router.post('/', async (req, res) => {
  const { code, full_name, periods_per_week, rubric } = req.body || {};
  if (!code || !full_name) return res.status(400).json({ error: 'Code and full name are required' });
  try {
    const r = await pool.query(
      'INSERT INTO subjects (code, full_name, periods_per_week, sort_order, rubric) VALUES ($1,$2,$3,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM subjects),$4) RETURNING *',
      [code.trim().toUpperCase(), full_name.trim(), Number(periods_per_week || 5),
       rubric ? JSON.stringify(rubric) : null]
    );
    return res.status(201).json({ subject: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Subject code already exists' });
    return res.status(500).json({ error: 'Failed to create subject', detail: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { full_name, periods_per_week, rubric } = req.body || {};
  try {
    const r = await pool.query(
      `UPDATE subjects SET
         full_name=COALESCE($1,full_name),
         periods_per_week=COALESCE($2,periods_per_week),
         rubric=$3
       WHERE id=$4 RETURNING *`,
      [full_name ? full_name.trim() : null,
       periods_per_week !== undefined ? Number(periods_per_week) : null,
       rubric === undefined ? null : (rubric ? JSON.stringify(rubric) : null),
       req.params.id]
    );
    return res.json({ subject: r.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update subject', detail: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM subjects WHERE id=$1', [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete subject', detail: err.message });
  }
});

module.exports = router;
