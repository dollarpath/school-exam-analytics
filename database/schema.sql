-- ============================================================
-- School Exam Analytics System — PostgreSQL schema
-- Run via: npm run db:init
-- ============================================================

-- -----------------------------------------------------------------
-- School info (single row). setup_complete flips to TRUE after the
-- first-run setup wizard finishes.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS school (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  motto           TEXT,
  address         TEXT,
  logo_path       TEXT,
  primary_color   TEXT DEFAULT '#1a3a6b',
  secondary_color TEXT DEFAULT '#1e7a3a',
  setup_complete  BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------
-- Academic years
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academic_years (
  id    SERIAL PRIMARY KEY,
  year  INTEGER NOT NULL UNIQUE
);

-- -----------------------------------------------------------------
-- Terms (1..3 per year)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS terms (
  id        SERIAL PRIMARY KEY,
  year_id   INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  number    INTEGER NOT NULL CHECK(number IN (1,2,3)),
  label     TEXT NOT NULL,
  UNIQUE(year_id, number)
);

-- -----------------------------------------------------------------
-- Exams (MID or END within a term)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exams (
  id         SERIAL PRIMARY KEY,
  term_id    INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK(type IN ('MID','END')),
  label      TEXT NOT NULL,
  is_active  BOOLEAN DEFAULT FALSE,
  entry_open BOOLEAN DEFAULT FALSE,
  published  BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------
-- Classes / streams
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classes (
  id           SERIAL PRIMARY KEY,
  year_id      INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  stream       TEXT,
  display_name TEXT GENERATED ALWAYS AS
    (CASE WHEN stream IS NOT NULL AND stream <> '' THEN name || ' ' || stream ELSE name END) STORED,
  UNIQUE(year_id, name, stream)
);

-- -----------------------------------------------------------------
-- Subjects
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subjects (
  id               SERIAL PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  full_name        TEXT NOT NULL,
  periods_per_week INTEGER DEFAULT 5,
  sort_order       INTEGER DEFAULT 0,
  rubric           JSONB,
  color            TEXT
);

-- -----------------------------------------------------------------
-- Teachers
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teachers (
  id              SERIAL PRIMARY KEY,
  full_name       TEXT NOT NULL,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  max_periods     INTEGER DEFAULT 30,
  is_hoi          BOOLEAN DEFAULT FALSE,
  is_admin        BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------
-- Teacher → Subject assignment
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teacher_subjects (
  teacher_id  INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, subject_id)
);

-- -----------------------------------------------------------------
-- Teacher → Class assignment (responsibility / class-teacher flag)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teacher_classes (
  teacher_id       INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id         INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  is_class_teacher BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (teacher_id, class_id)
);

-- -----------------------------------------------------------------
-- Students
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  id         SERIAL PRIMARY KEY,
  adm        TEXT NOT NULL UNIQUE,
  full_name  TEXT NOT NULL,
  class_id   INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','graduated')),
  graduated_at TIMESTAMPTZ,
  graduation_year INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Additive migration for databases created before lifecycle tracking existed.
ALTER TABLE students ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE students ADD COLUMN IF NOT EXISTS graduated_at TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS graduation_year INTEGER;

-- Student placement history. Never delete these rows when a student is
-- promoted or graduated; reports for previous years use this history.
CREATE TABLE IF NOT EXISTS student_enrollments (
  id          SERIAL PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id    INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  year_id     INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','graduated')),
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  ended_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_student_enrollments_student ON student_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_year_class ON student_enrollments(year_id, class_id);
ALTER TABLE student_enrollments DROP CONSTRAINT IF EXISTS student_enrollments_student_id_year_id_key;

-- Backfill the current placement for existing students without changing marks.
INSERT INTO student_enrollments (student_id, class_id, year_id, status)
SELECT s.id, s.class_id, c.year_id, CASE WHEN s.status='graduated' THEN 'graduated' ELSE 'active' END
FROM students s JOIN classes c ON c.id=s.class_id
WHERE NOT EXISTS (
  SELECT 1 FROM student_enrollments e WHERE e.student_id=s.id AND e.year_id=c.year_id
);

-- -----------------------------------------------------------------
-- Marks (one row per student per subject per exam)
-- score is stored as a percentage (0-100).
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marks (
  id          SERIAL PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  exam_id     INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  score       INTEGER CHECK(score >= 0 AND score <= 100),
  raw_out_of  INTEGER,
  entered_by  INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  entered_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, subject_id, exam_id)
);

CREATE INDEX IF NOT EXISTS idx_marks_exam_subject ON marks(exam_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_id);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_teacher_subjects_teacher ON teacher_subjects(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_classes_teacher ON teacher_classes(teacher_id);

-- -----------------------------------------------------------------
-- Timetable slots
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timetable_slots (
  id          SERIAL PRIMARY KEY,
  class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  term_id     INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  day         TEXT NOT NULL CHECK(day IN ('MON','TUE','WED','THU','FRI')),
  period      INTEGER NOT NULL CHECK(period BETWEEN 1 AND 8),
  subject_id  INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  teacher_id  INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  UNIQUE(class_id, day, period, term_id)
);

-- -----------------------------------------------------------------
-- Period times + breaks
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS period_config (
  period              INTEGER PRIMARY KEY CHECK(period BETWEEN 1 AND 8),
  start_time          TIME NOT NULL,
  end_time            TIME NOT NULL,
  break_after_label   TEXT,
  break_after_minutes INTEGER
);

-- -----------------------------------------------------------------
-- System config key/value store. Stores e.g.:
--   teacher_site_password, rubric_global, no_of_terms, exams_per_term,
--   term3_mid_optional, academic_year ...
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_config (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- -----------------------------------------------------------------
-- Seeded default rubric (global) so the broadsheet/report can grade
-- even before a subject override is defined. Kept here so the app
-- has a sensible default on first init.
-- -----------------------------------------------------------------
INSERT INTO system_config (key, value) VALUES
  ('rubric_global', '[
    {"band":"EE1","label":"EE1","min":90,"max":100,"points":12,"grade":"A"},
    {"band":"EE2","label":"EE2","min":75,"max":89,"points":11,"grade":"A-"},
    {"band":"ME1","label":"ME1","min":57,"max":74,"points":10,"grade":"B+"},
    {"band":"ME2","label":"ME2","min":40,"max":56,"points":9,"grade":"B"},
    {"band":"AE1","label":"AE1","min":30,"max":39,"points":8,"grade":"B-"},
    {"band":"AE2","label":"AE2","min":20,"max":29,"points":7,"grade":"C"},
    {"band":"BE1","label":"BE1","min":10,"max":19,"points":6,"grade":"C-"},
    {"band":"BE2","label":"BE2","min":0,"max":9,"points":5,"grade":"D"}
  ]')
ON CONFLICT (key) DO NOTHING;
