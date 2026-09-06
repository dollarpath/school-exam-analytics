/**
 * /api/students — list (by class), create, import (CSV), delete.
 */
const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const router = express.Router();
const pool = require('../db');
const { requireAdmin } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// list students for a class (or all when /api/students?classId=)
router.get('/by-class/:classId', async (req, res) => {
  try {
    const classLabel = pool.isLocalFallback
      ? `CASE WHEN c.stream IS NOT NULL AND c.stream <> '' THEN c.name || ' ' || c.stream ELSE c.name END`
      : 'c.display_name';
    const { rows } = await pool.query(
      `SELECT s.id, s.adm, s.full_name, s.class_id, ${classLabel} AS class
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.class_id = $1
       ORDER BY s.adm`,
      [req.params.classId]
    );
    return res.json({ students: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load students', detail: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const classLabel = pool.isLocalFallback
      ? `CASE WHEN c.stream IS NOT NULL AND c.stream <> '' THEN c.name || ' ' || c.stream ELSE c.name END`
      : 'c.display_name';
    const { rows } = await pool.query(
      `SELECT s.id, s.adm, s.full_name, s.class_id, s.status, s.graduated_at, s.graduation_year, ${classLabel} AS class
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
       ORDER BY c.display_name, s.adm`
    );
    return res.json({ students: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load students', detail: err.message });
  }
});

router.post('/', async (req, res) => {
  const { adm, name, class_id } = req.body || {};
  if (!adm || !name) return res.status(400).json({ error: 'ADM and name are required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO students (adm, full_name, class_id) VALUES ($1,$2,$3) RETURNING *',
      [adm.trim(), name.trim(), class_id || null]
    );
    await recordEnrollment(rows[0].id, class_id || null);
    return res.status(201).json({ student: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'ADM number already exists' });
    return res.status(500).json({ error: 'Failed to add student', detail: err.message });
  }
});

async function recordEnrollment(studentId, classId) {
  if (!classId) return;
  const classRes = await pool.query('SELECT year_id FROM classes WHERE id=$1', [classId]);
  const yearId = classRes.rows[0] && classRes.rows[0].year_id;
  if (!yearId) return;
  await pool.query(
    `UPDATE student_enrollments SET status='completed', ended_at=NOW()
     WHERE student_id=$1 AND year_id=$2 AND status='active'`, [studentId, yearId]
  );
  await pool.query(
    `INSERT INTO student_enrollments (student_id, class_id, year_id, status)
     VALUES ($1,$2,$3,'active')`,
    [studentId, classId, yearId]
  );
}

// Promote selected students into a new class while retaining their history.
router.post('/promote', requireAdmin, async (req, res) => {
  const { class_id, student_ids, target_class_id } = req.body || {};
  if (!target_class_id || (!class_id && (!Array.isArray(student_ids) || !student_ids.length)))
    return res.status(400).json({ error: 'Source class and target class are required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const classRes = await client.query('SELECT year_id FROM classes WHERE id=$1', [target_class_id]);
    if (!classRes.rows[0]) throw new Error('Target class not found');
    const yearId = classRes.rows[0].year_id;
    const sourceStudents = class_id
      ? await client.query("SELECT id FROM students WHERE class_id=$1 AND status='active'", [class_id])
      : { rows: student_ids.map((id) => ({ id })) };
    for (const student of sourceStudents.rows) {
      const studentId = student.id;
      await client.query(
        `UPDATE student_enrollments SET status='completed', ended_at=NOW()
         WHERE student_id=$1 AND status='active'`, [studentId]
      );
      await client.query('UPDATE students SET class_id=$1, status=\'active\', graduated_at=NULL, graduation_year=NULL WHERE id=$2', [target_class_id, studentId]);
      await client.query(
        `INSERT INTO student_enrollments (student_id, class_id, year_id, status)
         VALUES ($1,$2,$3,'active')`,
        [studentId, target_class_id, yearId]
      );
    }
    await client.query('COMMIT');
    return res.json({ ok: true, promoted: sourceStudents.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: err.message || 'Promotion failed' });
  } finally { client.release(); }
});

router.post('/graduate', requireAdmin, async (req, res) => {
  const { class_id, student_ids, graduation_year } = req.body || {};
  if (!class_id && (!Array.isArray(student_ids) || !student_ids.length))
    return res.status(400).json({ error: 'Source class is required' });
  const year = Number(graduation_year) || new Date().getFullYear();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sourceStudents = class_id
      ? await client.query("SELECT id FROM students WHERE class_id=$1 AND status='active'", [class_id])
      : { rows: student_ids.map((id) => ({ id })) };
    for (const student of sourceStudents.rows) {
      const studentId = student.id;
      await client.query(`UPDATE student_enrollments SET status='graduated', ended_at=NOW() WHERE student_id=$1 AND status='active'`, [studentId]);
      await client.query('UPDATE students SET status=\'graduated\', graduated_at=NOW(), graduation_year=$1, class_id=NULL WHERE id=$2', [year, studentId]);
    }
    await client.query('COMMIT');
    return res.json({ ok: true, graduated: sourceStudents.rows.length, graduation_year: year });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: err.message || 'Graduation failed' });
  } finally { client.release(); }
});

router.put('/:id', async (req, res) => {
  const { adm, name, class_id } = req.body || {};
  try {
    const { rows } = await pool.query(
      'UPDATE students SET adm=COALESCE($1,adm), full_name=COALESCE($2,full_name), class_id=$3 WHERE id=$4 RETURNING *',
      [adm ? adm.trim() : null, name ? name.trim() : null,
       class_id !== undefined ? (class_id || null) : null, req.params.id]
    );
    if (class_id) await recordEnrollment(rows[0].id, class_id);
    return res.json({ student: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'ADM number already exists' });
    return res.status(500).json({ error: 'Failed to update student', detail: err.message });
  }
});

// CSV bulk import. Columns: ADM, Name, Class (class by display name e.g. "Grade 7 East").
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });
  try {
    const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''); // strip BOM
    const records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });

    if (!records.length) return res.status(400).json({ error: 'CSV is empty or has no data rows' });

    // Build class lookup by display name
    const classRes = await pool.query('SELECT id, display_name FROM classes');
    const classByName = {};
    for (const c of classRes.rows) classByName[c.display_name] = c.id;

    let added = 0, updated = 0, skipped = 0;
    const errors = [];
    for (const rec of records) {
      const adm = (rec.ADM || rec.adm || '').trim();
      const name = (rec.Name || rec.name || '').trim();
      const cls = (rec.Class || rec.class || '').trim();
      if (!adm || !name) { skipped++; continue; }
      const classId = classByName[cls];
      try {
        const existing = await pool.query('SELECT id FROM students WHERE adm=$1', [adm]);
        if (existing.rows[0]) {
          await pool.query('UPDATE students SET full_name=$1, class_id=$2, status=\'active\' WHERE adm=$3', [name, classId || null, adm]);
          if (classId) await recordEnrollment(existing.rows[0].id, classId);
          updated++;
        } else {
          const inserted = await pool.query('INSERT INTO students (adm, full_name, class_id) VALUES ($1,$2,$3) RETURNING id', [adm, name, classId || null]);
          if (classId) await recordEnrollment(inserted.rows[0].id, classId);
          added++;
        }
      } catch (e) {
        errors.push(`${adm}: ${e.message}`);
      }
    }
    return res.json({ ok: true, added, updated, skipped, errors });
  } catch (err) {
    return res.status(400).json({ error: 'Could not parse CSV', detail: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM students WHERE id=$1', [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete student', detail: err.message });
  }
});

module.exports = router;
