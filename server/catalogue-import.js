'use strict';

const { indexChunks } = require('./knowledge');

const TABLES = ['knowledge_items', 'knowledge_chunks', 'knowledge_catalogue_imports'];
const REQUIRED_COLUMNS = {
  knowledge_items: ['id', 'title', 'kind', 'content', 'source_name', 'status'],
  knowledge_chunks: ['id', 'knowledge_id', 'chunk_index', 'content'],
  knowledge_catalogue_imports: ['source_key', 'knowledge_id', 'source_hash', 'imported_at']
};

async function validateSchema(pool) {
  const [tables] = await pool.execute(
    'SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?)', TABLES
  );
  for (const name of TABLES) {
    const row = tables.find((table) => table.TABLE_NAME === name);
    if (!row || String(row.ENGINE).toLowerCase() !== 'innodb') throw new Error(`Missing InnoDB table ${name}; run the catalogue migration first.`);
  }
  const [columns] = await pool.execute(
    'SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?)', TABLES
  );
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    for (const name of required) {
      if (!columns.some((column) => column.TABLE_NAME === table && column.COLUMN_NAME === name)) throw new Error(`Missing column ${table}.${name}.`);
    }
  }
  const key = columns.find((column) => column.TABLE_NAME === 'knowledge_catalogue_imports' && column.COLUMN_NAME === 'source_key');
  const hash = columns.find((column) => column.TABLE_NAME === 'knowledge_catalogue_imports' && column.COLUMN_NAME === 'source_hash');
  const id = columns.find((column) => column.TABLE_NAME === 'knowledge_catalogue_imports' && column.COLUMN_NAME === 'knowledge_id');
  if (String(key.COLLATION_NAME).toLowerCase() !== 'ascii_bin' || !/^varchar\(160\)$/i.test(key.COLUMN_TYPE) ||
      !/^char\(64\)$/i.test(hash.COLUMN_TYPE) || !/^bigint(?:\(\d+\))? unsigned$/i.test(id.COLUMN_TYPE)) {
    throw new Error('The catalogue provenance table has incompatible column definitions.');
  }
  const [indexes] = await pool.execute(
    'SELECT INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
    ['knowledge_catalogue_imports']
  );
  const uniqueColumns = new Map();
  for (const index of indexes) {
    if (Number(index.NON_UNIQUE) !== 0) continue;
    if (!uniqueColumns.has(index.INDEX_NAME)) uniqueColumns.set(index.INDEX_NAME, []);
    uniqueColumns.get(index.INDEX_NAME).push(index.COLUMN_NAME);
  }
  for (const name of ['source_key', 'knowledge_id']) {
    if (![...uniqueColumns.values()].some((parts) => parts.length === 1 && parts[0] === name)) throw new Error(`The catalogue provenance table needs a unique ${name} index.`);
  }
  const [foreignKeys] = await pool.execute(
    'SELECT COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND REFERENCED_TABLE_SCHEMA=DATABASE()',
    ['knowledge_catalogue_imports']
  );
  if (!foreignKeys.some((fk) => fk.COLUMN_NAME === 'knowledge_id' && fk.REFERENCED_TABLE_NAME === 'knowledge_items' && fk.REFERENCED_COLUMN_NAME === 'id')) {
    throw new Error('The catalogue provenance table needs a knowledge_items foreign key.');
  }
}

function normalTitle(title) { return String(title || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

async function inspectImport(pool, entries) {
  await validateSchema(pool);
  const [mappings] = await pool.execute('SELECT source_key,knowledge_id,source_hash FROM knowledge_catalogue_imports');
  const [unmapped] = await pool.execute(
    "SELECT k.id,k.title,k.kind FROM knowledge_items k LEFT JOIN knowledge_catalogue_imports i ON i.knowledge_id=k.id WHERE i.knowledge_id IS NULL AND k.kind IN ('product','company')"
  );
  const known = new Map(mappings.map((row) => [row.source_key, row]));
  const candidates = new Set(entries.map((entry) => entry.key));
  const missing = mappings.filter((row) => !candidates.has(row.source_key)).map((row) => row.source_key);
  const changed = entries.filter((entry) => known.has(entry.key) && known.get(entry.key).source_hash !== entry.hash);
  const added = entries.filter((entry) => !known.has(entry.key));
  const conflicts = added.filter((entry) => unmapped.some((row) => row.kind === entry.kind && normalTitle(row.title) === normalTitle(entry.title)));
  return { mapped: mappings.length, unmapped, missing, changed, added, conflicts };
}

async function importCatalogue(pool, entries, options = {}) {
  const inspection = await inspectImport(pool, entries);
  if (inspection.missing.length) throw new Error('Previously imported catalogue keys are missing. Reconcile renamed or removed entries before importing.');
  if (inspection.conflicts.length) throw new Error('Existing staff items match catalogue titles. Reconcile them before importing.');
  if (inspection.unmapped.length && !options.acknowledgeUnmapped) throw new Error('Existing untracked staff items require review before importing.');
  let inserted = 0;
  let concurrent = 0;
  for (const entry of inspection.added) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [saved] = await conn.execute(
        "INSERT INTO knowledge_items (title,kind,content,source_name,status) VALUES (?,?,?,?,'published')",
        [entry.title, entry.kind, entry.content, entry.sourceName]
      );
      await indexChunks(conn, saved.insertId, `${entry.title}\n${entry.content}`);
      await conn.execute('INSERT INTO knowledge_catalogue_imports (source_key,knowledge_id,source_hash) VALUES (?,?,?)', [entry.key, saved.insertId, entry.hash]);
      await conn.commit();
      inserted += 1;
    } catch (error) {
      await conn.rollback();
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      const [winner] = await conn.execute('SELECT knowledge_id FROM knowledge_catalogue_imports WHERE source_key=?', [entry.key]);
      if (!winner.length) throw error;
      concurrent += 1;
    } finally { conn.release(); }
  }
  return { ...inspection, inserted, concurrent };
}

module.exports = { validateSchema, inspectImport, importCatalogue };
