'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { createPool, databaseConfig } = require('../server/db');
const meta = require('../server/catalogue-meta');

function normalTitle(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function productRows(catalogue) {
  return meta.companies.flatMap((company) => {
    const items = catalogue.companies[company.id] || [];
    return items.map((item, index) => ({
      company,
      sourceKey: `product:${company.id}/${item.id}`,
      title: `${company.name} ${item.name}`,
      slug: item.id,
      name: item.name,
      productType: item.type,
      summary: item.summary,
      specs: item.specs,
      specNote: item.spec_note || '',
      features: item.features,
      imageName: item.image || '',
      photo: item.photo === true ? 1 : 0,
      manufacturerSource: item.source,
      sortOrder: index + 1
    }));
  });
}

async function mappings(pool) {
  const mapped = new Map();
  try {
    const [rows] = await pool.execute('SELECT source_key,knowledge_id FROM knowledge_catalogue_imports');
    for (const row of rows) mapped.set(row.source_key, String(row.knowledge_id));
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
  }
  return mapped;
}

async function knowledgeByTitle(pool) {
  const [rows] = await pool.execute("SELECT id,title FROM knowledge_items WHERE kind='product'");
  const titles = new Map();
  for (const row of rows) {
    const key = normalTitle(row.title);
    if (!titles.has(key)) titles.set(key, String(row.id));
  }
  return titles;
}

async function existingRows(pool) {
  const [rows] = await pool.execute('SELECT company_id,slug,knowledge_id FROM catalogue_products');
  return new Map(rows.map((row) => [`${row.company_id}/${row.slug}`, row]));
}

async function main() {
  const args = process.argv.slice(2);
  const modes = args.filter((value) => ['--dry-run', '--check', '--apply'].includes(value));
  if (modes.length > 1 || args.some((value) => !['--dry-run', '--check', '--apply'].includes(value))) {
    throw new Error('Usage: node scripts/backfill-product-catalogue.js [--dry-run|--check|--apply]');
  }
  const catalogue = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'public', 'assets', 'data', 'products.json'), 'utf8'));
  const rows = productRows(catalogue);
  console.log(`Catalogue seed: ${rows.length} products across ${meta.companies.length} companies.`);
  if (!modes.length || modes[0] === '--dry-run') {
    for (const row of rows) console.log(`${row.company.id}/${row.slug} — ${row.name}`);
    console.log('Offline preview only; no database was accessed.');
    return;
  }

  const db = databaseConfig();
  console.log(`Database target: ${db.host}:${db.port}/${db.database}`);
  const pool = createPool();
  try {
    let existing;
    try {
      existing = await existingRows(pool);
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') throw new Error('Missing catalogue_products; run migration 005 first.');
      throw error;
    }
    const mapped = await mappings(pool);
    const titles = await knowledgeByTitle(pool);
    const missingKnowledge = [];
    let linked = 0;
    let linkedByTitle = 0;
    let already = 0;
    let inserted = 0;

    for (const row of rows) {
      const key = `${row.company.id}/${row.slug}`;
      if (existing.has(key)) { already += 1; continue; }
      let knowledgeId = mapped.get(row.sourceKey);
      if (knowledgeId) linked += 1;
      else {
        knowledgeId = titles.get(normalTitle(row.title));
        if (knowledgeId) linkedByTitle += 1;
      }
      if (!knowledgeId) { missingKnowledge.push(row.sourceKey); continue; }
      if (modes[0] === '--check') continue;
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute(
          `INSERT INTO catalogue_products
           (knowledge_id,company_id,slug,name,product_type,summary,description_html,specs,spec_note,features,image_name,image_source,photo,manufacturer_source,status,sort_order)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'published',?)`,
          [knowledgeId, row.company.id, row.slug, row.name, row.productType, row.summary, '',
            JSON.stringify(row.specs.map((pair) => ({ label: pair[0], value: pair[1] }))), row.specNote,
            JSON.stringify(row.features), row.imageName, 'asset', row.photo, row.manufacturerSource, row.sortOrder]
        );
        await conn.commit();
        inserted += 1;
        console.log(`Linked: ${row.sourceKey}`);
      } catch (error) {
        await conn.rollback();
        if (error.code === 'ER_DUP_ENTRY') { already += 1; continue; }
        throw error;
      } finally { conn.release(); }
    }

    console.log(`Existing product rows: ${already}; knowledge links from import mapping: ${linked}; from title: ${linkedByTitle}; inserted: ${inserted}.`);
    if (missingKnowledge.length) {
      console.log(`No imported product knowledge found for: ${missingKnowledge.join(', ')}`);
      console.log('Run npm run catalogue -- --apply first, then re-run this command.');
      process.exitCode = 1;
    }
    if (modes[0] === '--check') console.log('Database preview only; no records were changed.');
    else console.log('Backfill complete. Re-run to confirm it is idempotent.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Product catalogue backfill failed:', error.code || error.message);
  process.exitCode = 1;
});
