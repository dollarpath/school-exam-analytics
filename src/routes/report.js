/**
 * GET /api/report/:studentId — all marks across all exams in a chosen mode.
 * Query params:
 *   mode       = single | term_avg | year_end   (default single)
 *   exam_id    = required for single
 *   term_number= required for term_avg
 *   year       = required for year_end (default current year)
 */
const express = require('express');
const router = express.Router();
const { buildReport } = require('../utils/report');

router.get('/:studentId', async (req, res) => {
  try {
    const { mode, exam_id, term_number, year } = req.query;
    const data = await buildReport(Number(req.params.studentId), { mode, exam_id, term_number, year });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to build report', detail: err.message });
  }
});

module.exports = router;
