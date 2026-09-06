/**
 * /api/periods — read & update period times / breaks for the school day.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM period_config ORDER BY period');
    return res.json({ periods: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load periods', detail: err.message });
  }
});

// Replace all period rows
router.put('/', async (req, res) => {
  const { periods } = req.body || {};
  if (!Array.isArray(periods)) return res.status(400).json({ error: 'periods array required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM period_config');
    for (const p of periods) {
      if (!p.period) continue;
      await client.query(
        `INSERT INTO period_config (period, start_time, end_time, break_after_label, break_after_minutes)
         VALUES ($1,$2,$3,$4,$5)`,
        [Number(p.period), p.start_time, p.end_time, p.break_after_label || null, p.break_after_minutes || null]
      );
    }
    await client.query('COMMIT');
    return res.json({ ok: true, saved: periods.filter((p) => p.period).length });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Failed to save periods', detail: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
