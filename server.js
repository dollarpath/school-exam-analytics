/**
 * School Exam Analytics System
 * Express server — session auth, static pages, JSON API.
 *
 * Environment variables (see .env.example):
 *   PORT, DATABASE_URL, SESSION_SECRET, NODE_ENV, INIT_CACHE_TTL
 */
require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const PUBLIC_DIR = path.join(__dirname, 'public');

// ─────────────────────────────────────────────────────────────
// Session middleware
// ─────────────────────────────────────────────────────────────
app.use(
  session({
    name: 'examsession',
    secret: process.env.SESSION_SECRET || 'insecure-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 12, // 12 hours
      secure: false, // set true behind HTTPS in production
    },
  })
);

// ─────────────────────────────────────────────────────────────
// Body parsers
// ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// ─────────────────────────────────────────────────────────────
// Static assets. Served at root and under /public so both
// /uploads/logo.png and /public/uploads/logo.png work.
// ─────────────────────────────────────────────────────────────
app.use('/public', express.static(PUBLIC_DIR));
app.use(express.static(PUBLIC_DIR));
// legacy alias used by some templates
app.use('/uploads', express.static(path.join(PUBLIC_DIR, 'uploads')));

// ─────────────────────────────────────────────────────────────
// API routes
// ─────────────────────────────────────────────────────────────
const attachUser = require('./src/middleware/auth').attachUser;
const requireLogin = require('./src/middleware/auth').requireLogin;
const requireAdmin = require('./src/middleware/auth').requireAdmin;

app.use(attachUser);

app.use('/api/init', require('./src/routes/init'));
app.use('/api/setup', require('./src/routes/setup'));
app.use('/api/upload', require('./src/routes/upload'));
app.use('/api/auth', require('./src/routes/auth'));

// Everything below requires a logged-in user
app.use('/api/school', requireLogin, require('./src/routes/school'));
app.use('/api/classes', requireLogin, require('./src/routes/classes'));
app.use('/api/subjects', requireLogin, require('./src/routes/subjects'));
app.use('/api/teachers', requireLogin, require('./src/routes/teachers'));
app.use('/api/students', requireLogin, require('./src/routes/students'));
app.use('/api/exams', requireLogin, require('./src/routes/exams'));
app.use('/api/marks', requireLogin, require('./src/routes/marks'));
app.use('/api/broadsheet', requireLogin, require('./src/routes/broadsheet'));
app.use('/api/report', requireLogin, require('./src/routes/report'));
app.use('/api/timetable', requireLogin, require('./src/routes/timetable'));
app.use('/api/periods', requireLogin, require('./src/routes/periods'));

function sendPage(page) {
  return (req, res) => {
    const file = path.join(PUBLIC_DIR, page);
    res.sendFile(file);
  };
}

// Public pages (no login required)
app.get('/login', sendPage('login.html'));
app.get('/setup', sendPage('setup.html'));

// Protected pages
const PROTECTED_PAGES = [
  'index.html',
  'admin.html',
  'marks.html',
  'broadsheet.html',
  'report.html',
  'data.html',
  'timetable.html',
  'timetable-view.html',
];
for (const page of PROTECTED_PAGES) {
  app.get(`/${page.replace('.html', '')}`, requireLogin, sendPage(page));
}

// ─────────────────────────────────────────────────────────────
// Root redirect
// ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  return res.redirect('/index');
});

// 404 handler
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.status(404).send('404 — Page not found');
});

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 School Exam Analytics System running`);
  console.log(`   → http://localhost:${PORT}  (env: ${NODE_ENV})`);
});

module.exports = app;
