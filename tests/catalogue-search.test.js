'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPool } = require('../server/db');
const { searchKnowledge } = require('../server/knowledge');
const { buildCatalogue } = require('../server/catalogue');
const { addProductReferences } = require('../server/product-references');
const { addApprovedLinks } = require('../server/approved-links');
const catalogue = require('../public/assets/data/products.json');

// This opt-in test reads the configured database without changing its records.
test('published catalogue searches prioritize named products', { skip: process.env.RUN_CATALOGUE_DB_TESTS !== '1' }, async () => {
  const pool = createPool();
  try {
    const [rows] = await pool.execute(
      "SELECT i.source_key,i.source_hash,k.title FROM knowledge_catalogue_imports i JOIN knowledge_items k ON k.id=i.knowledge_id WHERE k.kind='product' AND k.status='published'"
    );
    const published = new Map(rows.map((row) => [row.source_key, row.title]));
    const products = buildCatalogue(catalogue).filter((entry) => entry.kind === 'product' && published.get(entry.key) === entry.title);
    assert.ok(products.length, 'No unchanged, published catalogue products were found');
    const unchanged = products.find((product) => rows.some((row) => row.source_key === product.key && row.source_hash === product.hash));
    assert.ok(unchanged, 'No published catalogue mappings match the current source');
    const [message] = await addProductReferences(pool, [{ role: 'assistant', status: 'answered', content: unchanged.title }]);
    assert.ok(message.products?.length, 'The published product should have a card');
    assert.equal(message.products[0].name, unchanged.title);
    const sourceUrl = /Manufacturer source: (https:\/\/\S+)/.exec(unchanged.content)[1];
    const [linked] = await addApprovedLinks(pool, [{ role: 'assistant', content: sourceUrl }]);
    assert.deepEqual(linked.approvedLinks, [new URL(sourceUrl).href]);
    for (const product of products) {
      for (const question of [`${product.title} specifications`, `tell me about ${product.title}`, `features of ${product.title}`]) {
        const hits = await searchKnowledge(pool, question);
        assert.equal(hits[0]?.title, product.title, question);
      }
    }
  } finally {
    await pool.end();
  }
});
