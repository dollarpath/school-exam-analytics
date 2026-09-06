/**
 * /api/timetable — class timetable get/save, auto-generate.
 * Timetables are stored per class per term. A slot is (class, day, period, subject, teacher).
 *
 * Also provides period_config defaults and generates teacher/block views on the fly.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
const PERIODS = 8;

async function getPeriodConfig() {
  const { rows } = await pool.query('SELECT * FROM period_config ORDER BY period');
  return rows;
}

// GET /api/timetable/:classId/:termId
router.get('/:classId/:termId', async (req, res) => {
  try {
    const { classId, termId } = req.params;
    const classRes = await pool.query('SELECT * FROM classes WHERE id=$1', [classId]);
    const klass = classRes.rows[0] || null;
    const termRes = await pool.query('SELECT t.*, ay.year FROM terms t JOIN academic_years ay ON ay.id=t.year_id WHERE t.id=$1', [termId]);
    const term = termRes.rows[0] || null;

    const { rows: slots } = await pool.query(
      `SELECT ts.*, s.code AS subject_code, s.full_name AS subject_name, s.color AS subject_color,
              t.full_name AS teacher_name, t.id AS teacher_id
       FROM timetable_slots ts
       LEFT JOIN subjects s ON s.id=ts.subject_id
       LEFT JOIN teachers t ON t.id=ts.teacher_id
       WHERE ts.class_id=$1 AND ts.term_id=$2
       ORDER BY ts.day, ts.period`,
      [classId, termId]
    );

    const periodConfig = await getPeriodConfig();

    return res.json({ class: klass, term, slots, periodConfig, days: DAYS, periodCount: PERIODS });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load timetable', detail: err.message });
  }
});

// POST /api/timetable/:classId/:termId — manual save (replace all slots)
router.post('/:classId/:termId', async (req, res) => {
  const { classId, termId } = req.params;
  const { slots } = req.body || {};
  if (!Array.isArray(slots)) return res.status(400).json({ error: 'slots array required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM timetable_slots WHERE class_id=$1 AND term_id=$2', [classId, termId]);
    for (const s of slots) {
      if (!s.day || !s.period) continue;
      await client.query(
        `INSERT INTO timetable_slots (class_id, term_id, day, period, subject_id, teacher_id)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (class_id,day,period,term_id) DO UPDATE SET subject_id=EXCLUDED.subject_id, teacher_id=EXCLUDED.teacher_id`,
        [classId, termId, s.day, Number(s.period), s.subject_id || null, s.teacher_id || null]
      );
    }
    await client.query('COMMIT');
    return res.json({ ok: true, saved: slots.length });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Failed to save timetable', detail: err.message });
  } finally {
    client.release();
  }
});

// GET /api/timetable/teacher/:teacherId/:termId — grouped by day for a teacher
router.get('/teacher/:teacherId/:termId', async (req, res) => {
  try {
    const { teacherId, termId } = req.params;
    const { rows } = await pool.query(
      `SELECT ts.*, c.display_name AS class_name, s.code AS subject_code, s.full_name AS subject_name
       FROM timetable_slots ts
       JOIN classes c ON c.id=ts.class_id
       LEFT JOIN subjects s ON s.id=ts.subject_id
       WHERE ts.teacher_id=$1 AND ts.term_id=$2
       ORDER BY ts.day, ts.period`, [teacherId, termId]);
    return res.json({ slots: rows, days: DAYS, periodCount: PERIODS });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load teacher timetable', detail: err.message });
  }
});

// POST /api/timetable/generate — auto-generate timetables for all classes
// in a given term. Body: { term_id }
router.post('/generate', async (req, res) => {
  const { term_id } = req.body || {};
  if (!term_id) return res.status(400).json({ error: 'term_id required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const classesRes = await client.query('SELECT * FROM classes');
    const subjectsRes = await client.query('SELECT * FROM subjects ORDER BY sort_order, code');
    const subjects = subjectsRes.rows;
    // teacher -> subject mapping
    const tsRes = await client.query('SELECT teacher_id, subject_id FROM teacher_subjects');
    const teachersBySubject = {};
    for (const t of tsRes.rows) {
      if (!teachersBySubject[t.subject_id]) teachersBySubject[t.subject_id] = [];
      teachersBySubject[t.subject_id].push(t.teacher_id);
    }
    // teacher -> classes
    const tcRes = await client.query('SELECT teacher_id, class_id FROM teacher_classes');
    const classesByTeacher = {};
    for (const t of tcRes.rows) {
      if (!classesByTeacher[t.teacher_id]) classesByTeacher[t.teacher_id] = [];
      classesByTeacher[t.teacher_id].push(t.class_id);
    }
    // subject -> classes (which classes take this subject = those taught by a subject-teacher OR all classes)
    const classNames = classesRes.rows;

    let generatedClasses = 0;
    for (const klass of classNames) {
      await client.query('DELETE FROM timetable_slots WHERE class_id=$1 AND term_id=$2', [klass.id, term_id]);

      // Determine subjects for this class: all subjects
      const subjectPlan = subjects.map((s) => ({ subject: s, periods_needed: s.periods_per_week || 5 }));
      const totalNeeded = subjectPlan.reduce((a, x) => a + x.periods_needed, 0);
      const available = DAYS.length * PERIODS; // 40
      // if needs exceed capacity, scale down
      if (totalNeeded > available) {
        const scale = available / totalNeeded;
        for (const sp of subjectPlan) sp.periods_needed = Math.max(1, Math.round(sp.periods_needed * scale));
      }

      const grid = {}; // classId-day-period -> slot
      const teacherBusy = {}; // teacherId-day-period -> true

      // Greedy: iterate subjects, place blocks in random day/period
      for (const sp of subjectPlan) {
        let placed = 0;
        let attempts = 0;
        while (placed < sp.periods_needed && attempts < 500) {
          attempts++;
          const day = DAYS[Math.floor(Math.random() * DAYS.length)];
          const period = 1 + Math.floor(Math.random() * PERIODS);
          const key = `${day}|${period}`;
          if (grid[`class|${klass.id}|${key}`]) continue;

          // Choose a teacher for this subject who is free
          const eligible = teachersBySubject[sp.subject.id] || [];
          // Prefer a teacher who also teaches this class
          const pref = eligible.find((tid) => (classesByTeacher[tid] || []).includes(klass.id)) || eligible[0];
          let teacherId = null;
          if (pref) {
            if (!teacherBusy[pref + '|' + key]) teacherId = pref;
          }
          // If no eligible/free teacher, still place with subject (teacher null)
          grid[`class|${klass.id}|${key}`] = { subject_id: sp.subject.id, teacher_id: teacherId };
          if (teacherId) teacherBusy[teacherId + '|' + key] = true;
          placed++;
        }
      }

      // Insert slots
      const days = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5 };
      for (const [keystr, slot] of Object.entries(grid)) {
        const [, , day, period] = keystr.split('|');
        await client.query(
          `INSERT INTO timetable_slots (class_id, term_id, day, period, subject_id, teacher_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [klass.id, term_id, day, Number(period), slot.subject_id, slot.teacher_id]
        );
      }
      generatedClasses++;
    }

    await client.query('COMMIT');
    return res.json({ ok: true, generatedClasses });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Failed to generate timetable', detail: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
