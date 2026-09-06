/**
 * GET /api/school — school details
 * PUT /api/school — update school details (+ optional teacher site password)
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const pool = require('../db');
const cache = require('../cache');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM school ORDER BY id ASC LIMIT 1');
    return res.json({ school: rows[0] || null });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load school', detail: err.message });
  }
});

router.put('/', async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query('SELECT id FROM school ORDER BY id ASC LIMIT 1');
    let id = rows[0] && rows[0].id;

    if (id) {
      await pool.query(
        `UPDATE school SET
           name=COALESCE($1,name),
           motto=COALESCE($2,motto),
           address=COALESCE($3,address),
           primary_color=COALESCE($4,primary_color),
           secondary_color=COALESCE($5,secondary_color),
           logo_path=COALESCE($6,logo_path),
           updated_at=NOW()
         WHERE id=$7`,
        [b.name, b.motto, b.address, b.primary_color, b.secondary_color, b.logo_path, id]
      );
    } else {
      const ins = await pool.query(
        `INSERT INTO school (name, motto, address, primary_color, secondary_color, logo_path, setup_complete)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING id`,
        [b.name || 'School', b.motto, b.address,
         b.primary_color || '#1a3a6b', b.secondary_color || '#1e7a3a', b.logo_path || null]
      );
      id = ins.rows[0].id;
    }

    // Config updates
    const cfgUpdates = {};
    if (b.academic_year !== undefined) cfgUpdates.academic_year = String(b.academic_year);
    if (b.no_of_terms !== undefined) cfgUpdates.no_of_terms = String(b.no_of_terms);
    if (b.exams_per_term !== undefined) cfgUpdates.exams_per_term = b.exams_per_term;
    if (b.term3_mid_optional !== undefined) cfgUpdates.term3_mid_optional = b.term3_mid_optional ? 'true' : 'false';
    if (b.rubric_global !== undefined) cfgUpdates.rubric_global = typeof b.rubric_global === 'string' ? b.rubric_global : JSON.stringify(b.rubric_global);
    if (b.teacher_site_password) cfgUpdates.teacher_site_password = await bcrypt.hash(b.teacher_site_password, 10);

    for (const [k, v] of Object.entries(cfgUpdates)) {
      if (v === undefined) continue;
      await pool.query(
        'INSERT INTO system_config (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
        [k, v]
      );
    }

    cache.del('init');
    return res.json({ ok: true, id });
  } catch (err) {
    console.error('school update error:', err);
    return res.status(500).json({ error: 'Update failed', detail: err.message });
  }
});

module.exports = router;
