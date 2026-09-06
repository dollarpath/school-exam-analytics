#!/usr/bin/env bash
# ============================================================
# Setup run once when the Codespace/dev container is created.
#   - installs dependencies
#   - creates .env from .env.example (if missing)
#   - waits for PostgreSQL
#   - applies schema + loads sample data
# ============================================================
set -e
cd "$(dirname "$0")/.."

echo "📦 Installing server dependencies..."
npm install

# Environment file (DATABASE_URL etc.). Real env vars from docker-compose
# already supply DATABASE_URL/PORT/SESSION_SECRET, but .env keeps things tidy.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "🧾 Created .env from .env.example"
fi

# Wait for PostgreSQL to accept connections.
echo "🗄️  Waiting for PostgreSQL..."
node <<'NODE'
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let tries = 0;
function check() {
  pool.query('SELECT 1')
    .then(() => { console.log('░  PostgreSQL is ready.'); process.exit(0); })
    .catch(() => {
      if (++tries >= 40) { console.error('✖ PostgreSQL not ready after ~60s'); process.exit(1); }
      setTimeout(check, 1500);
    });
}
check();
NODE

echo "🗄️  Applying schema (db:init)..."
npm run db:init

echo "🗄️  Loading sample data (db:seed)..."
npm run db:seed

echo ""
echo "✅  Setup complete."
echo "    🔑 Admin   → username: admin   password: admin123"
echo "    🔑 Teacher → username: teacher1..teacher4  password: teach123"
echo "    🔑 Site    → teach123"
echo ""
echo "    The app starts automatically. Open the forwarded port 3000."
