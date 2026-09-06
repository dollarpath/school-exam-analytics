/**
 * db:seed — inserts sample data so the system can be demoed immediately.
 * Assumes the schema has been applied (npm run db:init).
 *
 * Demo credentials:
 *   Admin username: admin  password: admin123
 *   Teacher usernames: teacher1..teacher4  password: teach123
 *   Site access password for teachers: teach123
 */
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and edit it.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
  const existing = await pool.query('SELECT COUNT(*)::int AS c FROM school');
  if (existing.rows[0].c > 0) {
    console.log('ℹ️  School record already exists. Use `npm run db:reset` for a clean reseed.');
    await pool.end();
    return;
  }

  const adminHash = await bcrypt.hash('admin123', 10);
  const teacherHash = await bcrypt.hash('teach123', 10);

  // School ------------------------------------------------------
  await pool.query(
    `INSERT INTO school (name, motto, address, primary_color, secondary_color, setup_complete)
     VALUES ($1,$2,$3,$4,$5,TRUE)`,
    ['Kibuye Junior Secondary School',
     'Striving for Excellence',
     'P.O. Box 123-20100, Nakuru',
     '#1a3a6b', '#1e7a3a']
  );

  const sitePassHash = await bcrypt.hash('teach123', 10);
  const cfg = [
    ['teacher_site_password', sitePassHash],
    ['academic_year', '2026'],
    ['no_of_terms', '3'],
    ['exams_per_term', 'BOTH'],
    ['term3_mid_optional', 'true'],
  ];
  for (const [k, v] of cfg) {
    await pool.query('INSERT INTO system_config (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, v]);
  }

  // Year + terms ------------------------------------------------
  const yearRes = await pool.query('INSERT INTO academic_years (year) VALUES (2026) RETURNING id');
  const yearId = yearRes.rows[0].id;
  const termIds = {};
  for (const n of [1, 2, 3]) {
    const r = await pool.query(
      'INSERT INTO terms (year_id, number, label) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',
      [yearId, n, `Term ${n}`]
    );
    if (r.rowCount) termIds[n] = r.rows[0].id;
  }
  // Re-fetch term ids (they may pre-exist)
  const terms = await pool.query('SELECT id, number FROM terms WHERE year_id=$1', [yearId]);
  for (const t of terms.rows) termIds[t.number] = t.id;

  // Exams -------------------------------------------------------
  const examData = [
    [1, 'MID', 'Term 1 Mid Term'], [1, 'END', 'Term 1 End Term'],
    [2, 'MID', 'Term 2 Mid Term'], [2, 'END', 'Term 2 End Term'],
    [3, 'MID', 'Term 3 Mid Term'], [3, 'END', 'Term 3 End Term'],
  ];
  const examIds = {};
  for (const [n, type, label] of examData) {
    const r = await pool.query(
      'INSERT INTO exams (term_id, type, label) VALUES ($1,$2,$3) RETURNING id',
      [termIds[n], type, label]
    );
    examIds[`${n}_${type}`] = r.rows[0].id;
  }

  // Subjects ----------------------------------------------------
  const subjectDefs = [
    ['ENG', 'English', 5],
    ['KIS', 'Kiswahili', 5],
    ['MATHS', 'Mathematics', 6],
    ['IS', 'Integrated Science', 5],
    ['P/T', 'Pre-Technical Studies', 4],
    ['AGRIC', 'Agriculture', 4],
    ['SST', 'Social Studies', 5],
    ['CRE', 'Christian Religious Education', 3],
    ['CAS', 'Creative Arts & Sports', 4],
  ];
  const subjectIds = {};
  for (let i = 0; i < subjectDefs.length; i++) {
    const [code, full, ppw] = subjectDefs[i];
    const r = await pool.query(
      'INSERT INTO subjects (code, full_name, periods_per_week, sort_order) VALUES ($1,$2,$3,$4) RETURNING id',
      [code, full, ppw, i]
    );
    subjectIds[code] = r.rows[0].id;
  }

  // Classes -----------------------------------------------------
  const classDefs = [
    ['Grade 7', 'East'], ['Grade 7', 'West'],
    ['Grade 8', 'East'], ['Grade 8', 'West'],
    ['Grade 9', 'East'],
  ];
  const classIds = {};
  for (const [name, stream] of classDefs) {
    const r = await pool.query(
      'INSERT INTO classes (year_id, name, stream) VALUES ($1,$2,$3) RETURNING id',
      [yearId, name, stream]
    );
    classIds[`${name} ${stream}`] = r.rows[0].id;
  }

  // Teachers ----------------------------------------------------
  const teachers = [
    { name: 'System Administrator', username: 'admin', hash: adminHash, max: 30, hoi: true, admin: true },
    { name: 'John Otieno', username: 'teacher1', hash: teacherHash, max: 28, hoi: false, admin: false },
    { name: 'Grace Wanjiku', username: 'teacher2', hash: teacherHash, max: 26, hoi: false, admin: false },
    { name: 'Peter Kamau', username: 'teacher3', hash: teacherHash, max: 30, hoi: false, admin: false },
    { name: 'Alice Chebet', username: 'teacher4', hash: teacherHash, max: 24, hoi: false, admin: false },
  ];
  const teacherIds = {};
  for (const t of teachers) {
    const r = await pool.query(
      `INSERT INTO teachers (full_name, username, password_hash, max_periods, is_hoi, is_admin)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [t.name, t.username, t.hash, t.max, t.hoi, t.admin]
    );
    teacherIds[t.username] = r.rows[0].id;
  }

  // Teacher → subject + teacher → class assignments -------------
  const ts = [
    ['admin', ['ENG', 'KIS', 'MATHS', 'IS', 'P/T', 'AGRIC', 'SST', 'CRE', 'CAS']],
    ['teacher1', ['MATHS', 'ENG']],
    ['teacher2', ['KIS', 'SST']],
    ['teacher3', ['IS', 'AGRIC']],
    ['teacher4', ['CRE', 'CAS']],
  ];
  for (const [uname, codes] of ts) {
    for (const code of codes) {
      await pool.query('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [teacherIds[uname], subjectIds[code]]);
    }
  }
  const tc = [
    ['teacher1', 'Grade 7 East', true], ['teacher2', 'Grade 7 West', true],
    ['teacher3', 'Grade 8 East', true], ['teacher4', 'Grade 8 West', true],
    ['admin', 'Grade 9 East', false],
  ];
  for (const [uname, cn, ct] of tc) {
    await pool.query('INSERT INTO teacher_classes (teacher_id, class_id, is_class_teacher) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [teacherIds[uname], classIds[cn], ct]);
  }

  // Students ----------------------------------------------------
  const firstNames = ['Amina','Brian','Cynthia','David','Esther','Felix','Grace','Henry','Ivy','James','Kendi','Lennel','Mercy','Noah','Olivia','Peter','Queen','Ruth','Samuel','Teresa'];
  const lastNames = ['Ali','Bett','Chepkemoi','Doe','Ekal','Fwamba','Gitau','Hassan','Ireri','Kamau','Lengai','Mole','Njeri','Ochieng','Pesa','Rotich','Sang','Tarus','Wafula','Yego'];
  const classesOrder = Object.keys(classIds);
  let admCounter = 1000;
  const studentIds = [];
  for (const cn of classesOrder) {
    const classId = classIds[cn];
    const count = 6 + (Math.abs(cn.length) % 3); // 6-8 per class
    for (let s = 0; s < count; s++) {
      const name = `${firstNames[(admCounter + s) % firstNames.length]} ${lastNames[(admCounter + s) % lastNames.length]}`;
      const adm = `ADM${++admCounter}`;
      const r = await pool.query('INSERT INTO students (adm, full_name, class_id) VALUES ($1,$2,$3) RETURNING id', [adm, name, classId]);
      studentIds.push(r.rows[0].id);
    }
  }

  // Sample marks for the first exam (Term 1 Mid) -----------------
  const sampleExamIds = [examIds['1_MID'], examIds['1_END'], examIds['2_MID'], examIds['2_END'], examIds['3_MID']];
  const codes = subjectDefs.map(([c]) => c);
  for (const examId of sampleExamIds) {
    for (const studentId of studentIds) {
      for (const code of codes) {
        const score = Math.round(28 + Math.random() * 68); // between ~28 and 96
        await pool.query(
          `INSERT INTO marks (student_id, subject_id, exam_id, score, raw_out_of, entered_by)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (student_id, subject_id, exam_id) DO UPDATE SET score=EXCLUDED.score`,
          [studentId, subjectIds[code], examId, score, 100, teacherIds['admin']]
        );
      }
    }
  }

  // Period config (the school day) ------------------------------
  const periodDefs = [
    [1, '08:00', '08:40', 'Short break', 10],
    [2, '08:40', '09:20', null, null],
    [3, '09:20', '10:00', null, null],
    [4, '10:00', '10:40', 'Long break', 25],
    [5, '10:40', '11:20', null, null],
    [6, '11:20', '12:00', null, null],
    [7, '12:00', '12:40', 'Lunch break', 45],
    [8, '12:40', '13:20', null, null],
  ];
  for (const [p, st, et, lab, mins] of periodDefs) {
    await pool.query(
      `INSERT INTO period_config (period, start_time, end_time, break_after_label, break_after_minutes)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (period) DO NOTHING`,
      [p, st, et, lab, mins]
    );
  }

  console.log('✅ Sample data seeded successfully.');
  console.log('   Admin  → username: admin   password: admin123');
  console.log('   Teacher→ username: teacher1..teacher4  password: teach123');
  await pool.end();
}

main().catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); });
