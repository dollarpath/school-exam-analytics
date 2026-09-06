/**
 * /api/teachers — list, create, update, delete teachers + assignments.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const pool = require('../db');

// list teachers with their subject + class assignments
router.get('/', async (req, res) => {
  try {
    if (pool.isLocalFallback) {
      const { rows } = await pool.query('SELECT * FROM teachers ORDER BY full_name');
      return res.json({ teachers: rows.map((row) => ({ ...row, subjects: [], classes: [] })) });
    }
    const { rows } = await pool.query(`
      SELECT t.*,
        COALESCE(
          (SELECT json_agg(json_build_object('id', ts.subject_id, 'code', s.code, 'full_name', s.full_name))
           FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id
           WHERE ts.teacher_id = t.id),
          '[]'
        ) AS subjects,
        COALESCE(
          (SELECT json_agg(json_build_object('id', tc.class_id, 'name', c.display_name, 'is_class_teacher', tc.is_class_teacher))
           FROM teacher_classes tc JOIN classes c ON c.id = tc.class_id
           WHERE tc.teacher_id = t.id),
          '[]'
        ) AS classes
      FROM teachers t
      ORDER BY t.full_name
    `);
    return res.json({ teachers: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load teachers', detail: err.message });
  }
});

router.post('/', async (req, res) => {
  const { full_name, username, password, max_periods, is_hoi, subjects, classes } = req.body || {};
  if (!full_name || !username || !password)
    return res.status(400).json({ error: 'Name, username and password are required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash(password, 10);
    const ins = await client.query(
      `INSERT INTO teachers (full_name, username, password_hash, max_periods, is_hoi)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [full_name.trim(), username.trim(), hash, Number(max_periods || 30), !!is_hoi]
    );
    const teacherId = ins.rows[0].id;

    for (const sid of subjects || []) {
      await client.query('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [teacherId, sid]);
    }
    for (const c of classes || []) {
      const isClassTeacher = !!(c && c.is_class_teacher);
      await client.query('INSERT INTO teacher_classes (teacher_id, class_id, is_class_teacher) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [teacherId, c.id, isClassTeacher]);
    }
    await client.query('COMMIT');
    return res.status(201).json({ teacher: ins.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    return res.status(500).json({ error: 'Failed to create teacher', detail: err.message });
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  const { full_name, username, password, max_periods, is_hoi, subjects, classes } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let passwordHash;
    if (password) passwordHash = await bcrypt.hash(password, 10);
    await client.query(
      `UPDATE teachers SET
         full_name=COALESCE($1,full_name),
         username=COALESCE($2,username),
         password_hash=COALESCE($3,password_hash),
         max_periods=COALESCE($4,max_periods),
         is_hoi=COALESCE($5,is_hoi)
       WHERE id=$6`,
      [full_name ? full_name.trim() : null, username ? username.trim() : null,
       passwordHash || null, max_periods !== undefined ? Number(max_periods) : null,
       is_hoi !== undefined ? !!is_hoi : null, req.params.id]
    );

    if (subjects !== undefined) {
      await client.query('DELETE FROM teacher_subjects WHERE teacher_id=$1', [req.params.id]);
      for (const sid of subjects) {
        await client.query('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, sid]);
      }
    }
    if (classes !== undefined) {
      await client.query('DELETE FROM teacher_classes WHERE teacher_id=$1', [req.params.id]);
      for (const c of classes) {
        await client.query('INSERT INTO teacher_classes (teacher_id, class_id, is_class_teacher) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.params.id, c.id, !!(c && c.is_class_teacher)]);
      }
    }
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    return res.status(500).json({ error: 'Failed to update teacher', detail: err.message });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM teachers WHERE id=$1', [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete teacher', detail: err.message });
  }
});

module.exports = router;
