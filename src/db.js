/**
 * Shared PostgreSQL connection pool.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;

let pool;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
  });
} else {
  // Keep local development usable when PostgreSQL is not installed.
  const { newDb } = require('pg-mem');
  const bcrypt = require('bcryptjs');
  const localDb = newDb();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8')
    .replace(
      "display_name TEXT GENERATED ALWAYS AS\n    (CASE WHEN stream IS NOT NULL AND stream <> '' THEN name || ' ' || stream ELSE name END) STORED,",
      'display_name TEXT,'
    )
    .replace(`-- Backfill the current placement for existing students without changing marks.
INSERT INTO student_enrollments (student_id, class_id, year_id, status)
SELECT s.id, s.class_id, c.year_id, CASE WHEN s.status='graduated' THEN 'graduated' ELSE 'active' END
FROM students s JOIN classes c ON c.id=s.class_id
WHERE NOT EXISTS (
  SELECT 1 FROM student_enrollments e WHERE e.student_id=s.id AND e.year_id=c.year_id
);
`, '');
  localDb.public.none(schema);
  localDb.public.none(`
    INSERT INTO school (name, motto, setup_complete)
    VALUES ('School Exam Analytics', 'Striving for Excellence', TRUE);
    INSERT INTO system_config (key, value) VALUES
      ('teacher_site_password', '${bcrypt.hashSync('teach123', 10)}'),
      ('academic_year', '2026'),
      ('no_of_terms', '3'),
      ('exams_per_term', 'BOTH');
    INSERT INTO academic_years (year) VALUES (2026);
    INSERT INTO terms (year_id, number, label)
    SELECT id, 1, 'Term 1' FROM academic_years WHERE year=2026;
    INSERT INTO terms (year_id, number, label)
    SELECT id, 2, 'Term 2' FROM academic_years WHERE year=2026;
    INSERT INTO terms (year_id, number, label)
    SELECT id, 3, 'Term 3' FROM academic_years WHERE year=2026;
    INSERT INTO teachers (full_name, username, password_hash, is_hoi, is_admin)
    VALUES ('System Administrator', 'admin', '${bcrypt.hashSync('admin123', 10)}', TRUE, TRUE);
  `);
  const { Pool: LocalPool } = localDb.adapters.createPg();
  pool = new LocalPool();
  console.warn('DATABASE_URL is not set. Using an in-memory development database.');
}

pool.isLocalFallback = !DATABASE_URL;

if (typeof pool.on === 'function') {
  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err.message);
  });
}

module.exports = pool;
