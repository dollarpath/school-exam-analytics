/**
 * GET /api/broadsheet/:classId/:examId — pivot broadsheet for class+exam.
 */
const express = require('express');
const router = express.Router();
const { broadsheetForExam } = require('../utils/broadsheet');

router.get('/:classId/:examId', async (req, res) => {
  try {
    const data = await broadsheetForExam({ classId: req.params.classId, examId: req.params.examId });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load broadsheet', detail: err.message });
  }
});

module.exports = router;
