/**
 * db:reset — drops all application tables and re-applies schema.sql.
 * USEFUL FOR DEVELOPMENT ONLY. Destroys all data.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and edit it.');
  process.exit(1);
}

const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    console.log('⚠️  Dropping all tables...');
    await pool.query(`
      DROP TABLE IF EXISTS
        timetable_slots,
        period_config,
        marks,
        students,
        teacher_classes,
        teacher_subjects,
        teachers,
        subjects,
        classes,
        exams,
        terms,
        academic_years,
        school,
        system_config
      CASCADE;
    `);
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
    console.log('✅ Database reset and re-initialised.');
  } catch (err) {
    console.error('❌ Reset failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
