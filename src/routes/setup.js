/**
 * POST /api/setup — complete first-run setup in one transaction.
 * The wizard runs on the client and POSTs everything together.
 *
 * Payload:
 * {
 *   school: { name, motto, address, primary_color, secondary_color },
 *   admin:  { username, password },
 *   site_password: '...',            // teachers' shared site password
 *   academic_year: 2026,
 *   no_of_terms: 2|3,
 *   exams_per_term: 'MID'|'END'|'BOTH',
 *   term3_mid_optional: true|false,
 *   classes: [{ name, stream }],
 *   subjects: [{ code, full_name, periods_per_week }],
 *   teachers: [{ full_name, username, password, max_periods, subject_codes:[], class_names:[], is_class_teacher_of:'', is_hoi }],
 *   students: [{ adm, name, class }]   // optional; CSV import covers bulk
 * }
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const pool = require('../db');
const cache = require('../cache');
const { DEFAULT_RUBRIC } = require('../utils/grading');

router.post('/', async (req, res) => {
  const body = req.body || {};
  const school = body.school || {};
  const admin = body.admin || {};

  // ── Validation ─────────────────────────────────────────────
  if (!school.name) return res.status(400).json({ error: 'School name is required' });
  if (admin.username && !admin.password) return res.status(400).json({ error: 'Admin password is required' });
  if (admin.password && admin.password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  // ── Build classes referencing names→ids, subjects codes→ids ─
  const classes = Array.isArray(body.classes) ? body.classes : [];
  const subjects = Array.isArray(body.subjects) ? body.subjects : [];
  const teachers = Array.isArray(body.teachers) ? body.teachers : [];
  const students = Array.isArray(body.students) ? body.students : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // School -------------------------------------------------
    const schoolRes = await client.query(
      `INSERT INTO school (name, motto, address, primary_color, secondary_color, logo_path, setup_complete, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,NOW(),NOW())
       RETURNING id`,
      [
        school.name,
        school.motto || null,
        school.address || null,
        school.primary_color || '#1a3a6b',
        school.secondary_color || '#1e7a3a',
        school.logo_path || null,
      ]
    );
    const schoolId = schoolRes.rows[0].id;
    const schoolRow = schoolRes.rows[0];

    // System config ------------------------------------------
    const cfg = {
      teacher_site_password: body.site_password ? await bcrypt.hash(body.site_password, 10) : null,
      academic_year: String(body.academic_year || new Date().getFullYear()),
      no_of_terms: String(body.no_of_terms || 3),
      exams_per_term: body.exams_per_term || 'BOTH',
      term3_mid_optional: body.term3_mid_optional ? 'true' : 'false',
      rubric_global: JSON.stringify(DEFAULT_RUBRIC),
    };
    for (const [k, v] of Object.entries(cfg)) {
      await client.query(
        'INSERT INTO system_config (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
        [k, v]
      );
    }

    // Academic year + terms ----------------------------------
    let yearId;
    const yres = await client.query('SELECT id FROM academic_years WHERE year=$1', [body.academic_year || new Date().getFullYear()]);
    if (yres.rows[0]) {
      yearId = yres.rows[0].id;
    } else {
      const yr = await client.query('INSERT INTO academic_years (year) VALUES ($1) RETURNING id', [body.academic_year || new Date().getFullYear()]);
      yearId = yr.rows[0].id;
    }

    const noOfTerms = Number(body.no_of_terms || 3);
    const termIds = {};
    for (let n = 1; n <= noOfTerms; n++) {
      const tr = await client.query(
        'INSERT INTO terms (year_id, number, label) VALUES ($1,$2,$3) RETURNING id',
        [yearId, n, `Term ${n}`]
      );
      termIds[n] = tr.rows[0].id;
    }

    // Exams --------------------------------------------------
    const examPerTerm = body.exams_per_term || 'BOTH';
    const examTypes = examPerTerm === 'MID' ? ['MID'] : examPerTerm === 'END' ? ['END'] : ['MID', 'END'];
    const examIds = {}; // key `${n}_${type}`
    for (let n = 1; n <= noOfTerms; n++) {
      for (const type of examTypes) {
        const label = `Term ${n} ${type === 'MID' ? 'Mid Term' : 'End Term'}`;
        const er = await client.query(
          'INSERT INTO exams (term_id, type, label) VALUES ($1,$2,$3) RETURNING id',
          [termIds[n], type, label]
        );
        examIds[`${n}_${type}`] = er.rows[0].id;
      }
      // Mark Term 3 MID as optional per configuration
      if (n === 3 && noOfTerms === 3 && body.term3_mid_optional) {
        // Nothing extra needed at setup — the flag drives the UI.
      }
    }

    // Classes ------------------------------------------------
    const classIdByName = {};
    for (const c of classes) {
      const name = (c.name || '').trim();
      const stream = (c.stream || '').trim();
      if (!name) continue;
      const cr = await client.query(
        'INSERT INTO classes (year_id, name, stream) VALUES ($1,$2,$3) RETURNING id',
        [yearId, name, stream || null]
      );
      const key = `${name}${stream ? ' ' + stream : ''}`;
      classIdByName[key] = cr.rows[0].id;
    }

    // Subjects ----------------------------------------------
    const subjectIdByCode = {};
    let sort = 0;
    for (const s of subjects) {
      const code = (s.code || '').trim().toUpperCase();
      const full = (s.full_name || '').trim();
      if (!code || !full) continue;
      const sr = await client.query(
        'INSERT INTO subjects (code, full_name, periods_per_week, sort_order) VALUES ($1,$2,$3,$4) RETURNING id',
        [code, full, Number(s.periods_per_week || 5), sort++]
      );
      subjectIdByCode[code] = sr.rows[0].id;
    }

    // Teachers ----------------------------------------------
    const adminHash = await bcrypt.hash(admin.password, 10);
    // Create the admin as a teacher record (is_admin = TRUE)
    let adminTeacherId = null;
    if (admin.username) {
      const ar = await client.query(
        `INSERT INTO teachers (full_name, username, password_hash, max_periods, is_hoi, is_admin)
         VALUES ($1,$2,$3,$4,TRUE,TRUE) RETURNING id`,
        [admin.full_name || 'Administrator', admin.username.trim(), adminHash, 30]
      );
      adminTeacherId = ar.rows[0].id;
    }

    const teacherIdByUsername = {};
    for (const t of teachers) {
      const uname = (t.username || '').trim();
      if (!uname) continue;
      const hash = await bcrypt.hash(t.password, 10);
      const tr = await client.query(
        `INSERT INTO teachers (full_name, username, password_hash, max_periods, is_hoi)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [t.full_name || uname, uname, hash, Number(t.max_periods || 30), !!t.is_hoi]
      );
      teacherIdByUsername[uname] = tr.rows[0].id;
    }

    // Teacher → subject assignments --------------------------
    async function assignTeacherSubjects(teacherId, codes) {
      for (const code of codes) {
        const sid = subjectIdByCode[String(code).trim().toUpperCase()];
        if (!sid) continue;
        await client.query(
          'INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [teacherId, sid]
        );
      }
    }
    async function assignTeacherClasses(teacherId, names, isClassTeacherKey) {
      for (const name of names) {
        const cid = classIdByName[name];
        if (!cid) continue;
        const isCt = isClassTeacherKey === name;
        await client.query(
          'INSERT INTO teacher_classes (teacher_id, class_id, is_class_teacher) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [teacherId, cid, isCt]
        );
      }
    }

    // Assign admin to all subjects + HOI
    if (adminTeacherId) {
      await assignTeacherSubjects(adminTeacherId, Object.keys(subjectIdByCode));
    }
    for (const t of teachers) {
      const uname = (t.username || '').trim();
      if (!teacherIdByUsername[uname]) continue;
      await assignTeacherSubjects(teacherIdByUsername[uname], t.subject_codes || []);
      await assignTeacherClasses(teacherIdByUsername[uname], t.class_names || [], t.class_teacher_of);
    }

    // Students ------------------------------------------------
    const seenAdm = new Set();
    for (const st of students) {
      const adm = (st.adm || '').trim();
      const name = (st.name || '').trim();
      const cls = (st.class || '').trim();
      if (!adm || !name) continue;
      if (seenAdm.has(adm)) {
        // update existing instead
        const cid = classIdByName[cls] || null;
        await client.query('UPDATE students SET full_name=$1, class_id=$2 WHERE adm=$3', [name, cid, adm]);
        continue;
      }
      seenAdm.add(adm);
      const cid = classIdByName[cls] || null;
      await client.query('INSERT INTO students (adm, full_name, class_id) VALUES ($1,$2,$3)', [adm, name, cid]);
    }

    // Period config default (if empty) ------------------------
    const pc = await client.query('SELECT COUNT(*)::int AS c FROM period_config');
    if (pc.rows[0].c === 0) {
      const periodDefs = [
        [1, '07:30', '08:10', 'Short break', 10],
        [2, '08:10', '08:50', null, null],
        [3, '08:50', '09:30', null, null],
        [4, '09:30', '10:10', 'Long break', 25],
        [5, '10:10', '10:50', null, null],
        [6, '10:50', '11:30', null, null],
        [7, '11:30', '12:10', 'Lunch break', 40],
        [8, '12:10', '12:50', null, null],
      ];
      for (const [p, st, et, lab, mins] of periodDefs) {
        await client.query(
          'INSERT INTO period_config (period, start_time, end_time, break_after_label, break_after_minutes) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (period) DO NOTHING',
          [p, st, et, lab, mins]
        );
      }
    }

    await client.query('COMMIT');
    cache.del('init');

    return res.json({
      ok: true,
      school_id: schoolId,
      message: 'Setup complete',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('setup error:', err);
    return res.status(500).json({ error: 'Setup failed', detail: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
