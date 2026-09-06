/**
 * Grading / rubric utilities.
 *
 * A rubric is an ordered list of bands:
 *   [{ band, label, min, max, points, grade }, ...]
 *
 * The global default is stored in system_config('rubric_global'). A subject
 * may override it via subjects.rubric (JSONB). Points are used to rank
 * students on the broadsheet and report.
 *
 * Bands are stored as in the spec:
 *   BE2=0–9, BE1=10–19, AE2=20–29, AE1=30–39, ME2=40–56,
 *   ME1=57–74, EE2=75–89, EE1=90–100
 */

const DEFAULT_RUBRIC = [
  { band: 'EE1', label: 'EE1', min: 90, max: 100, points: 12, grade: 'A' },
  { band: 'EE2', label: 'EE2', min: 75, max: 89, points: 11, grade: 'A-' },
  { band: 'ME1', label: 'ME1', min: 57, max: 74, points: 10, grade: 'B+' },
  { band: 'ME2', label: 'ME2', min: 40, max: 56, points: 9, grade: 'B' },
  { band: 'AE1', label: 'AE1', min: 30, max: 39, points: 8, grade: 'B-' },
  { band: 'AE2', label: 'AE2', min: 20, max: 29, points: 7, grade: 'C' },
  { band: 'BE1', label: 'BE1', min: 10, max: 19, points: 6, grade: 'C-' },
  { band: 'BE2', label: 'BE2', min: 0, max: 9, points: 5, grade: 'D' },
];

/**
 * Normalise a rubric (whatever source) into a sorted ascending array.
 * @returns {Array<{band,label,min,max,points,grade}>}
 */
function normaliseRubric(input) {
  if (!input) return DEFAULT_RUBRIC.slice();
  let arr = input;
  if (typeof input === 'string') {
    try { arr = JSON.parse(input); } catch { arr = null; }
  }
  if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_RUBRIC.slice();
  return arr
    .map((b) => ({
      band: b.band,
      label: b.label || b.band,
      min: Number(b.min),
      max: Number(b.max),
      points: Number(b.points),
      grade: b.grade || b.label || '',
    }))
    .sort((a, b) => a.min - b.min);
}

/** Grade a single score against a rubric. */
function gradeForScore(score, rubric) {
  const bands = rubric || DEFAULT_RUBRIC;
  if (score === null || score === undefined) {
    return { band: '—', grade: '', points: 0, label: '—' };
  }
  for (const b of bands) {
    if (score >= b.min && score <= b.max) return b;
  }
  // Fallback: clamp to nearest band
  const sorted = bands.slice().sort((a, b) => a.min - b.min);
  if (score < sorted[0].min) return sorted[0];
  return sorted[sorted.length - 1];
}

/**
 * Compute positions for rows already carrying `points` and `total`.
 * The tiebreak from the spec:
 *   position = 1 + COUNT(points > mine) + COUNT(points = mine AND total > mine)
 */
function assignPositions(rows) {
  const withPos = rows.map((r) => ({ ...r }));
  for (const row of withPos) {
    let pos = 1;
    for (const other of withPos) {
      if (other === row) continue;
      if (other.points > row.points) pos++;
      else if (other.points === row.points && other.total > row.total) pos++;
    }
    row.position = pos;
  }
  return withPos;
}

/** Average helper (ignores null/undefined). */
function average(nums) {
  const vals = (nums || []).filter((n) => n !== null && n !== undefined && !Number.isNaN(n));
  if (!vals.length) return null;
  const sum = vals.reduce((a, b) => a + Number(b), 0);
  return Math.round((sum / vals.length) * 100) / 100;
}

module.exports = { DEFAULT_RUBRIC, normaliseRubric, gradeForScore, assignPositions, average };
