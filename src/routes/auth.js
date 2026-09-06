/**
 * POST /api/auth/login  — teacher/admin login (username/password)
 * POST /api/auth/login-site — teacher site-access-password login
 * GET  /api/auth/me      — current session user
 * POST /api/auth/logout  — clears the session
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const pool = require('../db');

function setSessionUser(req, user) {
  req.session.user = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    is_admin: !!user.is_admin,
    is_hoi: !!user.is_hoi,
    max_periods: user.max_periods,
  };
}

// Login with username/password (admin or named teacher accounts)
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const { rows } = await pool.query('SELECT * FROM teachers WHERE username=$1', [String(username).trim()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    setSessionUser(req, user);
    return res.json({
      ok: true,
      user: req.session.user,
      force_setup: false,
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Login failed', detail: err.message });
  }
});

// Teacher login using the shared site-access password (no personal account)
router.post('/login-site', async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Site password required' });

  try {
    const cfg = await pool.query(`SELECT value FROM system_config WHERE key='teacher_site_password'`);
    const sitePass = cfg.rows[0] ? cfg.rows[0].value : null;
    if (!sitePass) {
      return res.status(401).json({ error: 'Site access password is not configured' });
    }
    // Accept either a bcrypt hash or a legacy plaintext comparison.
    const looksLikeHash = /^\$2[aby]\$/.test(sitePass);
    const valid = looksLikeHash ? await bcrypt.compare(password, sitePass) : sitePass === password;
    if (!valid) {
      return res.status(401).json({ error: 'Invalid site access password' });
    }
    // Log the teacher in as a generic "teacher" principal
    req.session.user = {
      id: null,
      username: 'site-teacher',
      full_name: 'Teacher',
      is_admin: false,
      is_hoi: false,
      site_access: true,
    };
    return res.json({ ok: true, user: req.session.user });
  } catch (err) {
    console.error('login-site error:', err);
    return res.status(500).json({ error: 'Login failed', detail: err.message });
  }
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  return res.json({ user: req.session.user });
});

router.post('/logout', (req, res) => {
  if (req.session) req.session.destroy(() => res.json({ ok: true }));
  else res.json({ ok: true });
});

module.exports = router;
