/**
 * Broadsheet computation utilities.
 *
 * A "broadsheet" is a pivot of the marks table: rows = students, columns =
 * subjects, each cell = percentage score. Totals (TT MKS), sum of rubric
 * points (POINTS), the average (AVG) and rank are computed server-side.
 *
 * Position (POS) uses the spec tiebreak:
 *   position = 1 + COUNT(points > mine) + COUNT(points = mine AND total > mine)
 */
const pool = require('../db');
const { normaliseRubric, gradeForScore, assignPositions, average } = require('./grading');

/**
 * Load the active rubric for a subject/global combo.
 */
async function rubricForSubject(subjectId) {
  const subj = await pool.query('SELECT rubric FROM subjects WHERE id=$1', [subjectId]);
  if (subj.rows[0] && subj.rows[0].rubric) return normaliseRubric(subj.rows[0].rubric);
  const g = await pool.query(`SELECT value FROM system_config WHERE key='rubric_global'`);
  return normaliseRubric(g.rows[0] ? g.rows[0].value : null);
}

/**
 * Compute a single-exam broadsheet for a class + exam.
 * @returns {Promise<{class, exam, term, subjects, rows, summary}>
 *   rows: [{ student_id, adm, name, subjectScores:{code:percent}, ttmks, points, avg, position }]
 *   summary: { subjectStats: [{subject_id, code, full_name, count, avg, max, min}] }
 */
async function broadsheetForExam({ classId, examId }) {
  const classRes = await pool.query('SELECT * FROM classes WHERE id=$1', [classId]);
  const klass = classRes.rows[0] || null;
  const examRes = await pool.query('SELECT * FROM exams WHERE id=$1', [examId]);
  const exam = examRes.rows[0];
  if (!exam) throw new Error('Exam not found');

  const termRes = await pool.query('SELECT * FROM terms WHERE id=$1', [exam.term_id]);
  const term = termRes.rows[0] || null;

  // subjects for the academic year (all subjects)
  const subjRes = await pool.query('SELECT * FROM subjects ORDER BY sort_order, code');
  const subjects = subjRes.rows;

  // marks for this exam
  const marksRes = await pool.query(
    `SELECT m.student_id, m.subject_id, m.score
     FROM marks m WHERE m.exam_id=$1`,
    [examId]
  );
  const marksByStudentSubject = {};
  for (const m of marksRes.rows) {
    if (!marksByStudentSubject[m.student_id]) marksByStudentSubject[m.student_id] = {};
    marksByStudentSubject[m.student_id][m.subject_id] = m.score;
  }

  // students in class
  const studRes = await pool.query('SELECT id, adm, full_name FROM students WHERE class_id=$1 ORDER BY adm', [classId]);
  const students = studRes.rows;

  // Prepare per-subject rubric + stat collectors
  const subjectMeta = [];
  const subjectStats = [];
  for (const s of subjects) {
    const rubric = await rubricForSubject(s.id);
    subjectMeta[s.id] = rubric;
    subjectStats.push({ subject_id: s.id, code: s.code, full_name: s.full_name, scores: [] });
  }

  const rows = students.map((st) => {
    const subjectScores = {};
    let ttmks = 0;
    let points = 0;
    let counted = 0;
    for (const s of subjects) {
      const score = marksByStudentSubject[st.id] && marksByStudentSubject[st.id][s.id];
      subjectScores[s.code] = score === undefined ? null : score;
      if (score !== undefined && score !== null) {
        const g = gradeForScore(score, subjectMeta[s.id]);
        ttmks += score;
        points += g.points;
        counted++;
        // feed stats
        const stat = subjectStats.find((x) => x.subject_id === s.id);
        stat.scores.push(score);
      }
    }
    const avg = counted ? Math.round((ttmks / counted) * 100) / 100 : null;
    return { student_id: st.id, adm: st.adm, name: st.full_name, subjectScores, ttmks, points, avg, counted };
  });

  const ranked = assignPositions(rows);

  const summary = subjectStats.map((x) => {
    const scores = x.scores;
    const avgv = average(scores);
    return {
      subject_id: x.subject_id,
      code: x.code,
      full_name: x.full_name,
      count: scores.length,
      avg: avgv,
      max: scores.length ? Math.max(...scores) : null,
      min: scores.length ? Math.min(...scores) : null,
    };
  });

  return { class: klass, exam, term, subjects, rows: ranked, summary };
}

module.exports = { broadsheetForExam, rubricForSubject };
