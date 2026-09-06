/**
 * Helpers to read the school record + system configuration.
 */
const pool = require('../db');
const { normaliseRubric } = require('./grading');

/** Return the single school row (or null). */
async function getSchool() {
  const { rows } = await pool.query('SELECT * FROM school ORDER BY id ASC LIMIT 1');
  return rows[0] || null;
}

/** Return all system_config as a plain object. */
async function getConfig() {
  const { rows } = await pool.query('SELECT key, value FROM system_config');
  const cfg = {};
  for (const r of rows) cfg[r.key] = r.value;
  return cfg;
}

/**
 * Build the /api/init payload: school info + parsed config.
 * `omitSecret` strips the teacher site password when appropriate.
 */
async function buildInitPayload({ withSecret = false } = {}) {
  const school = await getSchool();
  const cfg = await getConfig();
  // The teacher site password is stored as a bcrypt hash and is never sent
  // back to the client. Admins set/rotate it via PUT /api/school.
  delete cfg.teacher_site_password;

  const parsed = {
    ...cfg,
    no_of_terms: cfg.no_of_terms ? Number(cfg.no_of_terms) : 3,
    exams_per_term: cfg.exams_per_term || 'BOTH',
    term3_mid_optional: cfg.term3_mid_optional === 'true',
    academic_year: cfg.academic_year ? Number(cfg.academic_year) : new Date().getFullYear(),
    rubric_global: cfg.rubric_global ? normaliseRubric(cfg.rubric_global) : undefined,
  };

  const payload = {
    setup_complete: !!(school && school.setup_complete),
    school: school
      ? {
          name: school.name,
          motto: school.motto,
          address: school.address,
          logo_path: school.logo_path,
          primary_color: school.primary_color,
          secondary_color: school.secondary_color,
        }
      : null,
    default_rubric: parsed.rubric_global,
    config: {
      academic_year: parsed.academic_year,
      no_of_terms: parsed.no_of_terms,
      exams_per_term: parsed.exams_per_term,
      term3_mid_optional: parsed.term3_mid_optional,
    },
  };

  if (withSecret) payload.teacher_site_password = cfg.teacher_site_password || null;

  // Track whether a teacher site password is configured (boolean only)
  payload.teacher_site_password_set = !!(cfg.teacher_site_password);

  return payload;
}

module.exports = { getSchool, getConfig, buildInitPayload };
