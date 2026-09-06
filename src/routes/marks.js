/**
 * /api/marks — get marks grid for a class+subject+exam, and batch save.
 * Scores are stored as percentages (0-100). The client lets teachers enter a
 * raw score and an "out of" value; the server normalises to a percentage.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { normaliseRubric, gradeForScore } = require('../utils/grading');

// GET /api/marks/:classId/:subjectId/:examId
router.get('/:classId/:subjectId/:examId', async (req, res) => {
  const { classId, subjectId, examId } = req.params;
  try {
    // exam state / entry-open check
    const examRes = await pool.query('SELECT * FROM exams WHERE id=$1', [examId]);
    const exam = examRes.rows[0];
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    // rubric for this subject
    const subjRes = await pool.query('SELECT * FROM subjects WHERE id=$1', [subjectId]);
    const subject = subjRes.rows[0];
    const gres = await pool.query(`SELECT value FROM system_config WHERE key='rubric_global'`);
    const rubric = subject && subject.rubric
      ? normaliseRubric(subject.rubric)
      : normaliseRubric(gres.rows[0] ? gres.rows[0].value : null);

    const { rows: students } = await pool.query(
      `SELECT s.id, s.adm, s.full_name,
              m.id AS mark_id, m.score, m.raw_out_of, m.entered_at, m.entered_by
       FROM students s
       LEFT JOIN marks m ON m.student_id = s.id
                        AND m.subject_id = $1
                        AND m.exam_id = $2
       WHERE s.class_id = $3
       ORDER BY s.adm`,
      [subjectId, examId, classId]
    );

    const list = students.map((s) => ({
      ...s,
      out_of: s.raw_out_of || 100,
      // Reconstruct the "raw" mark the teacher originally entered from the
      // stored percentage and the out-of value (raw = score * out_of / 100).
      raw: s.score !== null ? Math.round((s.score * (s.raw_out_of || 100)) / 100) : null,
      percent: s.score,
      grade: s.score !== null ? gradeForScore(s.score, rubric) : null,
    }));

    return res.json({
      exam,
      subject,
      rubric,
      entry_open: !!exam.entry_open,
      published: !!exam.published,
      students: list,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load marks', detail: err.message });
  }
});

// POST /api/marks — batch save
// body: { exam_id, subject_id, entries: [{ student_id, raw, out_of, score? }] }
router.post('/', async (req, res) => {
  const { exam_id, subject_id, entries } = req.body || {};
  if (!exam_id || !subject_id || !Array.isArray(entries))
    return res.status(400).json({ error: 'exam_id, subject_id and entries are required' });

  const client = await pool.connect();
  try {
    // Check entry is open for this exam
    const examRes = await client.query('SELECT entry_open, published FROM exams WHERE id=$1', [exam_id]);
    const exam = examRes.rows[0];
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    await client.query('BEGIN');

    // Validate each score
    const valid = [];
    for (const e of entries) {
      if (!e.student_id) continue;
      if (e.score === null || e.score === undefined || e.score === '') continue;
      const score = Number(e.score);
      if (Number.isNaN(score) || score < 0 || score > 100) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Score for student ${e.student_id} must be 0-100` });
      }
      valid.push({ student_id: e.student_id, score: Math.round(score), raw_out_of: e.out_of || 100 });
    }
    const enteredBy = req.session.user ? req.session.user.id : null;

    for (const v of valid) {
      await client.query(
        `INSERT INTO marks (student_id, subject_id, exam_id, score, raw_out_of, entered_by, entered_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (student_id, subject_id, exam_id)
         DO UPDATE SET score=EXCLUDED.score, raw_out_of=EXCLUDED.raw_out_of,
                       entered_by=EXCLUDED.entered_by, entered_at=NOW()`,
        [v.student_id, subject_id, exam_id, v.score, v.raw_out_of, enteredBy]
      );
    }

    await client.query('COMMIT');
    // Invalidate active/init caches
    const cache = require('../cache');
    cache.del('init');
    return res.json({ ok: true, saved: valid.length });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Failed to save marks', detail: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
