'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCatalogue } = require('../server/catalogue');
const { inspectImport, importCatalogue } = require('../server/catalogue-import');
const catalogue = require('../public/assets/data/products.json');

function fakePool() {
  const state = { items: [], chunks: [], mappings: [], nextId: 1, failChunk: false };
  const locks = new Map();
  const columnNames = {
    knowledge_items: ['id', 'title', 'kind', 'content', 'source_name', 'status'],
    knowledge_chunks: ['id', 'knowledge_id', 'chunk_index', 'content'],
    knowledge_catalogue_imports: ['source_key', 'knowledge_id', 'source_hash', 'imported_at']
  };
  const columns = Object.entries(columnNames).flatMap(([table, names]) => names.map((name) => ({
    TABLE_NAME: table, COLUMN_NAME: name,
    COLUMN_TYPE: name === 'source_key' ? 'varchar(160)' : name === 'source_hash' ? 'char(64)' : name === 'knowledge_id' ? 'bigint(20) unsigned' : '',
    COLLATION_NAME: name === 'source_key' ? 'ascii_bin' : null
  })));
  async function execute(sql, params = []) {
    if (sql.includes('information_schema.TABLES')) return [Object.keys(columnNames).map((name) => ({ TABLE_NAME: name, ENGINE: 'InnoDB' }))];
    if (sql.includes('information_schema.COLUMNS')) return [columns];
    if (sql.includes('information_schema.STATISTICS')) return [[
      { INDEX_NAME: 'PRIMARY', NON_UNIQUE: 0, COLUMN_NAME: 'source_key' },
      { INDEX_NAME: 'knowledge_id', NON_UNIQUE: 0, COLUMN_NAME: 'knowledge_id' }
    ]];
    if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return [[{ COLUMN_NAME: 'knowledge_id', REFERENCED_TABLE_NAME: 'knowledge_items', REFERENCED_COLUMN_NAME: 'id' }]];
    if (sql.startsWith('SELECT source_key,knowledge_id,source_hash')) return [[...state.mappings]];
    if (sql.startsWith('SELECT k.id,k.title,k.kind')) return [[...state.items.filter((item) => !state.mappings.some((mapping) => mapping.knowledge_id === item.id))]];
    if (sql.startsWith('SELECT knowledge_id FROM knowledge_catalogue_imports')) return [[...state.mappings.filter((mapping) => mapping.source_key === params[0])]];
    throw new Error(`Unexpected test query: ${sql}`);
  }
  return {
    state, execute,
    async getConnection() {
      const pending = { items: [], chunks: [], mappings: [], keys: [] };
      function releaseLocks() {
        for (const key of pending.keys) {
          const release = locks.get(key);
          locks.delete(key);
          release();
        }
        pending.keys = [];
      }
      return {
        async beginTransaction() {},
        async execute(sql, params = []) {
          if (sql.startsWith('INSERT INTO knowledge_items')) {
            const item = { id: state.nextId++, title: params[0], kind: params[1], content: params[2], source_name: params[3], status: 'published' };
            pending.items.push(item);
            return [{ insertId: item.id }];
          }
          if (sql.startsWith('DELETE FROM knowledge_chunks')) return [{ affectedRows: 0 }];
          if (sql.startsWith('INSERT INTO knowledge_chunks')) {
            if (state.failChunk) throw new Error('Simulated indexing failure');
            pending.chunks.push({ knowledge_id: params[0], chunk_index: params[1], content: params[2] });
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith('INSERT INTO knowledge_catalogue_imports')) {
            while (locks.has(params[0])) await new Promise((resolve) => {
              const previous = locks.get(params[0]);
              locks.set(params[0], () => { previous(); resolve(); });
            });
            if (state.mappings.some((mapping) => mapping.source_key === params[0])) {
              const error = new Error('Duplicate key');
              error.code = 'ER_DUP_ENTRY';
              throw error;
            }
            locks.set(params[0], () => {});
            pending.keys.push(params[0]);
            pending.mappings.push({ source_key: params[0], knowledge_id: params[1], source_hash: params[2] });
            return [{ affectedRows: 1 }];
          }
          return execute(sql, params);
        },
        async commit() {
          state.items.push(...pending.items);
          state.chunks.push(...pending.chunks);
          state.mappings.push(...pending.mappings);
          releaseLocks();
        },
        async rollback() { releaseLocks(); },
        release() {}
      };
    }
  };
}

test('catalogue conversion preserves product details and source attribution', () => {
  const entries = buildCatalogue(catalogue);
  assert.equal(entries.filter((entry) => entry.kind === 'product').length, 20);
  assert.equal(entries.filter((entry) => entry.kind === 'company').length, 5);
  assert.equal(new Set(entries.map((entry) => entry.key)).size, 25);
  const model = entries.find((entry) => entry.key === 'product:seacraft/future-1000');
  assert.match(model.content, /15\.9 kg/);
  assert.match(model.content, /Specification note:/);
  assert.match(model.content, /Manufacturer source: https:\/\//);
  assert.match(model.content, /\/seacraft\.html#future-1000/);
  assert.match(model.content, /2026-11-01/);
  assert.match(entries.find((entry) => entry.key === 'product:fxc/model-12000').content, /12000-25/);
});

test('catalogue conversion rejects malformed or duplicate product IDs', () => {
  const invalid = structuredClone(catalogue);
  invalid.companies.jfd[1].id = invalid.companies.jfd[0].id;
  assert.throws(() => buildCatalogue(invalid), /Duplicate product ID/);
  invalid.companies.jfd[1].id = 'bad id';
  assert.throws(() => buildCatalogue(invalid), /Invalid product ID/);
  invalid.companies.jfd[1].id = 'enforcer';
  invalid.companies.jfd[1].source = 'javascript:alert(1)';
  assert.throws(() => buildCatalogue(invalid), /Invalid manufacturer source/);
});

test('repeat imports preserve staff edits, status, and changed source records', async () => {
  const pool = fakePool();
  const entries = buildCatalogue(catalogue).slice(0, 2);
  assert.equal((await importCatalogue(pool, entries)).inserted, 2);
  assert.equal(pool.state.chunks.length, 2);
  pool.state.items[0].content = 'Staff-edited content';
  pool.state.items[0].status = 'retired';
  const changed = entries.map((entry, index) => index ? entry : { ...entry, hash: 'f'.repeat(64) });
  const inspection = await inspectImport(pool, changed);
  assert.equal(inspection.changed.length, 1);
  assert.equal((await importCatalogue(pool, changed)).inserted, 0);
  assert.equal(pool.state.items.length, 2);
  assert.equal(pool.state.items[0].content, 'Staff-edited content');
  assert.equal(pool.state.items[0].status, 'retired');
});

test('import rejects missing source keys and matching untracked staff records', async () => {
  const entries = buildCatalogue(catalogue).slice(0, 2);
  const pool = fakePool();
  await importCatalogue(pool, entries);
  await assert.rejects(importCatalogue(pool, entries.slice(0, 1)), /keys are missing/);
  const other = fakePool();
  other.state.items.push({ id: 100, kind: entries[0].kind, title: entries[0].title });
  await assert.rejects(importCatalogue(other, entries, { acknowledgeUnmapped: true }), /match catalogue titles/);
  assert.equal(other.state.mappings.length, 0);
});

test('indexing failures roll back the entire item', async () => {
  const pool = fakePool();
  pool.state.failChunk = true;
  await assert.rejects(importCatalogue(pool, buildCatalogue(catalogue).slice(0, 1)), /Simulated indexing failure/);
  assert.equal(pool.state.items.length, 0);
  assert.equal(pool.state.chunks.length, 0);
  assert.equal(pool.state.mappings.length, 0);
});

test('concurrent imports keep one item for each source key', async () => {
  const pool = fakePool();
  const entries = buildCatalogue(catalogue).slice(0, 1);
  const results = await Promise.all([importCatalogue(pool, entries), importCatalogue(pool, entries)]);
  assert.equal(results.reduce((sum, result) => sum + result.inserted, 0), 1);
  assert.equal(pool.state.items.length, 1);
  assert.equal(pool.state.chunks.length, 1);
  assert.equal(pool.state.mappings.length, 1);
});
