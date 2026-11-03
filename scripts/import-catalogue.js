'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { buildCatalogue } = require('../server/catalogue');
const { inspectImport, importCatalogue } = require('../server/catalogue-import');
const { createPool, databaseConfig } = require('../server/db');

function printInspection(result) {
  console.log(`Mapped: ${result.mapped}; new: ${result.added.length}; changed at source: ${result.changed.length}; untracked staff items: ${result.unmapped.length}.`);
  if (result.changed.length) console.log(`Changed source keys for staff review: ${result.changed.map((item) => item.key).join(', ')}`);
  if (result.missing.length) console.log(`Previously imported keys missing from the catalogue: ${result.missing.join(', ')}`);
  if (result.conflicts.length) console.log(`Existing staff titles that match catalogue entries: ${result.conflicts.map((item) => item.key).join(', ')}`);
  if (result.unmapped.length) console.log('Review existing untracked company/product entries before importing.');
}

async function main() {
  const args = process.argv.slice(2);
  const modes = args.filter((value) => ['--dry-run', '--check', '--apply'].includes(value));
  if (modes.length > 1 || args.some((value) => !['--dry-run', '--check', '--apply', '--acknowledge-unmapped'].includes(value)) ||
      (args.includes('--acknowledge-unmapped') && !args.includes('--apply'))) {
    throw new Error('Usage: node scripts/import-catalogue.js [--dry-run|--check|--apply] [--acknowledge-unmapped]');
  }
  const catalogue = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'public', 'assets', 'data', 'products.json'), 'utf8'));
  const entries = buildCatalogue(catalogue);
  console.log(`Catalogue: ${entries.filter((entry) => entry.kind === 'product').length} products, ${entries.filter((entry) => entry.kind === 'company').length} company profiles.`);
  if (!modes.length || modes[0] === '--dry-run') {
    for (const entry of entries) console.log(`${entry.key} — ${entry.title}`);
    console.log('Offline preview only; no database was accessed.');
    return;
  }
  const db = databaseConfig();
  console.log(`Database target: ${db.host}:${db.port}/${db.database}`);
  const pool = createPool();
  try {
    if (modes[0] === '--check') {
      printInspection(await inspectImport(pool, entries));
      console.log('Database preview only; no records were changed.');
      return;
    }
    const result = await importCatalogue(pool, entries, { acknowledgeUnmapped: args.includes('--acknowledge-unmapped') });
    printInspection(result);
    console.log(`Imported: ${result.inserted}; already imported concurrently: ${result.concurrent}. Existing staff content and publication status were preserved.`);
  } finally { await pool.end(); }
}

main().catch((error) => { console.error('Catalogue import failed:', error.code || error.message); process.exitCode = 1; });
