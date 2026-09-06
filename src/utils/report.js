/**
 * Multi-exam report generator (server-side).
 *
 * Modes:
 *   - single   : one score column per subject (a chosen exam)
 *   - term_avg : MID + END + AVERAGE columns per subject
 *   - year_end : T1 avg + T2 avg + T3 avg + YEAR average columns per subject
 *
 * Points and position are ALWAYS derived from the final/average score. The
 * position is computed server-side using the spec tie-break:
 *   1 + COUNT(points > mine) + COUNT(points = mine AND ttmks > mine)
 */
const pool = require('../db');
const { normaliseRubric, gradeForScore, average } = require('./grading');
const { rubricForSubject } = require('./broadsheet');
const { getSchool } = require('./school');

/**
 * Compute a per-subject markset for one student under a given mode.
 * Returns { rows, totalAvg, totalPoints, graded }
 * @param {number} studentId
 * @param {object} ctx { mode, exam_id, term_number, year, subjects, examByTermType, rubricCache }
 */
async function computeStudentSet(studentId, ctx) {
  const { mode, subjects, examByTermType, rubricCache } = ctx;
  const markRes = await pool.query('SELECT subject_id, exam_id, score FROM marks WHERE student_id=$1', [studentId]);
  const m = {};
  for (const r of markRes.rows) {
    if (!m[r.subject_id]) m[r.subject_id] = {};
    m[r.subject_id][r.exam_id] = r.score;
  }

  const scoreFor = (subjectId, termNumber, type) => {
    const ex = examByTermType[termNumber] && examByTermType[termNumber][type];
    if (!ex) return null;
    const s = m[subjectId] && m[subjectId][ex.id];
    return s === undefined ? null : s;
  };
  const termScores = (subjectId, termNumber) => {
    const mid = scoreFor(subjectId, termNumber, 'MID');
    const end = scoreFor(subjectId, termNumber, 'END');
    return { mid, end, avg: average([mid, end]) };
  };

  const rows = [];
  for (const subj of subjects) {
    const row = { subject_id: subj.id, code: subj.code, full_name: subj.full_name,
                  periods: subj.periods_per_week, columns: {}, final: null, points: 0, grade: '' };
    if (mode === 'single') {
      const v = m[subj.id] ? m[subj.id][Number(ctx.exam_id)] : undefined;
      row.columns = { score: v === undefined ? null : v };
      row.final = v === undefined ? null : v;
    } else if (mode === 'term_avg') {
      const tn = Number(ctx.term_number);
      const { mid, end, avg } = termScores(subj.id, tn);
      row.columns = { mid, end, avg };
      row.final = avg;
    } else { // year_end
      const t1 = termScores(subj.id, 1).avg;
      const t2 = termScores(subj.id, 2).avg;
      const t3 = termScores(subj.id, 3).avg;
      row.columns = { term1: t1, term2: t2, term3: t3, year: average([t1, t2, t3]) };
      row.final = row.columns.year;
    }
    if (row.final !== null) {
      const g = gradeForScore(Math.round(row.final), rubricCache[subj.id]);
      row.points = g.points;
      row.grade = g.label;
      row.band = g.band;
    }
    rows.push(row);
  }

  const graded = rows.filter((r) => r.final !== null).length;
  const finals = rows.map((r) => r.final).filter((v) => v !== null);
  const totalAvg = average(finals);
  const totalMarks = finals.reduce((a, b) => a + Number(b), 0);
  const totalPoints = rows.reduce((a, r) => a + (r.points || 0), 0);
  return { rows, totalAvg, totalMarks, totalPoints, graded };
}

async function buildReport(studentId, opts) {
  const mode = opts.mode || 'single';
  const year = opts.year ? Number(opts.year) : new Date().getFullYear();
  const school = await getSchool();

  const studRes = await pool.query(
    `SELECT s.id, s.adm, s.full_name, s.class_id, c.display_name AS class_name
     FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.id=$1`, [studentId]);
  const student = studRes.rows[0];
  if (!student) throw new Error('Student not found');

  const yearRes = await pool.query('SELECT id FROM academic_years WHERE year=$1', [year]);
  const yearId = yearRes.rows[0] ? yearRes.rows[0].id : null;
  if (yearId) {
    const enrollmentRes = await pool.query(
      `SELECT se.class_id, c.display_name AS class_name
       FROM student_enrollments se
       LEFT JOIN classes c ON c.id=se.class_id
       WHERE se.student_id=$1 AND se.year_id=$2
       ORDER BY se.id DESC LIMIT 1`,
      [studentId, yearId]
    );
    if (enrollmentRes.rows[0]) {
      student.class_id = enrollmentRes.rows[0].class_id;
      student.class_name = enrollmentRes.rows[0].class_name;
    }
  }
  const termRes = await pool.query('SELECT * FROM terms WHERE year_id=$1 ORDER BY number', [yearId]);
  const terms = termRes.rows;

  const subjRes = await pool.query('SELECT * FROM subjects ORDER BY sort_order, code');
  const subjects = subjRes.rows;

  const examRes = await pool.query(
    `SELECT e.*, t.number AS term_number FROM exams e JOIN terms t ON t.id=e.term_id
     WHERE t.year_id=$1 ORDER BY t.number, e.type`, [yearId]);
  const examByTermType = {};
  for (const e of examRes.rows) {
    if (!examByTermType[e.term_number]) examByTermType[e.term_number] = {};
    examByTermType[e.term_number][e.type] = e;
  }

  // A current-exam report defaults to the admin-selected active exam.
  if (mode === 'single' && !opts.exam_id) {
    const active = examRes.rows.find((exam) => exam.is_active) || examRes.rows[examRes.rows.length - 1];
    if (active) opts.exam_id = active.id;
  }

  const rubricCache = {};
  for (const s of subjects) rubricCache[s.id] = await rubricForSubject(s.id);

  const ctx = { mode, exam_id: opts.exam_id, term_number: opts.term_number, year, subjects, examByTermType, rubricCache };
  const me = await computeStudentSet(studentId, ctx);

  // Positions within the class (computed the same way for every student)
  let position = null;
  let class_size = null;
  if (student.class_id) {
    const classmatesRes = await pool.query('SELECT id FROM students WHERE class_id=$1', [student.class_id]);
    class_size = classmatesRes.rowCount;
    const sets = [];
    for (const cs of classmatesRes.rows) {
      const s = await computeStudentSet(cs.id, ctx);
      sets.push({ student_id: cs.id, avg: s.totalAvg, points: s.totalPoints, ttmks: s.totalMarks });
    }
    const myAvg = me.totalAvg;
    const myPoints = me.totalPoints;
    const myTtmks = me.totalMarks;
    // Position = 1 + COUNT(points > mine) + COUNT(points = mine AND ttmks > mine)
    position = 1 + sets.filter((c) => c.points > myPoints).length
                  + sets.filter((c) => c.points === myPoints && c.ttmks > myTtmks).length;
  }

  const remarks = gradeRemarks(me.totalAvg);

  return {
    school,
    student,
    mode,
    year,
    opts,
    terms,
    subjects: me.rows,
    totals: { avg: me.totalAvg, points: me.totalPoints, graded: me.graded },
    position,
    class_size,
    remarks,
    rubric: rubricCache,
    header_context: buildHeaderContext(mode, opts, terms, examByTermType, year),
  };
}

function buildHeaderContext(mode, opts, terms, examByTermType, year) {
  if (mode === 'single') {
    const ex = Object.values(examByTermType).flatMap((t) => Object.values(t)).find((e) => e.id === Number(opts.exam_id));
    const tn = ex ? ex.term_number : null;
    const term = terms.find((t) => t.number === tn);
    return { title: ex ? ex.label : 'Exam', term_label: term ? term.label : '', term_number: tn, type: ex ? ex.type : '' };
  }
  if (mode === 'term_avg') {
    const term = terms.find((t) => t.number === Number(opts.term_number));
    return { title: `Term ${opts.term_number} Average`, term_label: term ? term.label : '', term_number: Number(opts.term_number) };
  }
  return { title: `${year} Year Average`, term_label: 'End of Year', term_number: null };
}

function gradeRemarks(avg) {
  if (avg === null || avg === undefined) return { text: 'No marks recorded.', tone: 'none' };
  if (avg >= 90) return { text: 'Outstanding performance. Keep up the excellent work!', tone: 'excellent' };
  if (avg >= 75) return { text: 'Very good performance. Excellent effort. Keep it up.', tone: 'good' };
  if (avg >= 57) return { text: 'Good performance, there is room for improvement.', tone: 'good' };
  if (avg >= 40) return { text: 'Fair performance. More effort is required in some subjects.', tone: 'fair' };
  if (avg >= 20) return { text: 'Below average. Requires serious attention and extra support.', tone: 'weak' };
  return { text: 'Poor performance. Additional remedial support is strongly recommended.', tone: 'poor' };
}

module.exports = { buildReport };
