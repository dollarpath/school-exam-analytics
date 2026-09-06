/**
 * Session + role middleware.
 *
 * Session shape:
 *   req.session.user = { id, username, full_name, is_admin, is_hoi }
 *
 * Teacher logins get a normal session; admin logins additionally set
 * is_admin so requireAdmin passes.
 */

// Detect API calls using the original (un-mount-stripped) URL, because
// inside `app.use('/api/...')` the middleware sees req.path === '/'.
function isApi(req) {
  return req.originalUrl.startsWith('/api/');
}

function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  // For API calls, return JSON; for page requests, redirect to /login
  if (isApi(req)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    if (isApi(req)) return res.status(401).json({ error: 'Not authenticated' });
    return res.redirect('/login');
  }
  if (!req.session.user.is_admin) {
    if (isApi(req)) return res.status(403).json({ error: 'Admin access required' });
    return res.status(403).send('Forbidden: admin access required');
  }
  return next();
}

/**
 * Attach the logged-in user to req.user for convenience in routes.
 * (req.session.user is the source of truth.)
 */
function attachUser(req, res, next) {
  req.user = req.session ? req.session.user : null;
  next();
}

module.exports = { requireLogin, requireAdmin, attachUser };
