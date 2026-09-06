/**
 * db:init — applies database/schema.sql to the configured PostgreSQL
 * database. Safe to run more than once (uses IF NOT EXISTS).
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
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query(sql);
    console.log('✅ Schema applied successfully.');
  } catch (err) {
    console.error('❌ Failed to apply schema:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
