const fs = require('node:fs/promises');
const path = require('node:path');
const { createPool } = require('../server/db');

async function main() {
  const pool = createPool();
  try {
    const directory = path.join(__dirname, '..', 'migrations');
    const available = (await fs.readdir(directory)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
    const requested = process.argv.slice(2);
    if (requested.length > 1 || (requested.length && !available.includes(requested[0]))) throw new Error('Choose an existing migration file.');
    const files = requested.length ? requested : available;
    for (const file of files) {
      const sql = await fs.readFile(path.join(directory, file), 'utf8');
      const statements = sql.replace(/^--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
      for (const statement of statements) await pool.query(statement);
      console.log(`Applied ${file}.`);
    }
    console.log('Database tables are ready. Existing tables were not dropped.');
  } finally { await pool.end(); }
}
main().catch((error) => { console.error('Migration failed:', error.message); process.exitCode = 1; });
