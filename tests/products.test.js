'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../server/app');
const { sanitizeRichText, richTextToPlain } = require('../server/rich-text');
const { normaliseProduct, knowledgeContent, slugify, createProduct, updateProduct, deleteProduct, publicCatalogue } = require('../server/catalogue-products');
const { sniffImage, storeProductImage } = require('../server/images');

function fakePool() {
  const state = { products: [], knowledge: [], chunks: [], nextProduct: 1, nextKnowledge: 1, nextChunk: 1 };

  function knowledgeFor(id) {
    return state.knowledge.find((entry) => String(entry.id) === String(id));
  }

  function execute(sql, params = []) {
    if (sql.startsWith('SELECT id FROM catalogue_products WHERE company_id=? AND slug=?')) {
      return [state.products.filter((row) => row.company_id === params[0] && row.slug === params[1]).map((row) => ({ id: row.id }))];
    }
    if (sql.startsWith('SELECT COALESCE(MAX(sort_order),0)+1 AS next_order FROM catalogue_products WHERE company_id=?')) {
      const orders = state.products.filter((row) => row.company_id === params[0]).map((row) => Number(row.sort_order) || 0);
      return [[{ next_order: Math.max(0, ...orders) + 1 }]];
    }
    if (sql.startsWith('INSERT INTO knowledge_items')) {
      const id = state.nextKnowledge++;
      state.knowledge.push({ id: String(id), title: params[0], kind: 'product', content: params[1], source_name: params[2], status: params[3] });
      return [{ insertId: id }];
    }
    if (sql.startsWith('DELETE FROM knowledge_chunks')) {
      state.chunks = state.chunks.filter((chunk) => String(chunk.knowledge_id) !== String(params[0]));
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT INTO knowledge_chunks')) {
      state.chunks.push({ id: String(state.nextChunk++), knowledge_id: String(params[0]), chunk_index: params[1], content: params[2] });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT INTO catalogue_products')) {
      const id = state.nextProduct++;
      const row = {
        id: String(id), knowledge_id: String(params[0]), company_id: params[1], slug: params[2], name: params[3],
        product_type: params[4], summary: params[5], description_html: params[6], specs: params[7], spec_note: params[8],
        features: params[9], image_name: params[10], image_source: params[11], photo: params[12],
        manufacturer_source: params[13], status: params[14], sort_order: params[15],
        created_at: '2026-11-03T00:00:00.000Z', updated_at: '2026-11-03T00:00:00.000Z'
      };
      state.products.push(row);
      return [{ insertId: id }];
    }
    if (sql.startsWith('SELECT * FROM catalogue_products WHERE id=? FOR UPDATE')) {
      return [state.products.filter((row) => String(row.id) === String(params[0]))];
    }
    if (sql.startsWith('DELETE FROM catalogue_products WHERE id=?')) {
      const before = state.products.length;
      state.products = state.products.filter((row) => String(row.id) !== String(params[0]));
      return [{ affectedRows: before - state.products.length }];
    }
    if (sql.startsWith('SELECT kind FROM knowledge_items WHERE id=? FOR UPDATE')) {
      const item = knowledgeFor(params[0]);
      return [item ? [{ kind: item.kind }] : []];
    }
    if (sql.startsWith("DELETE FROM knowledge_items WHERE id=? AND kind='product'")) {
      const before = state.knowledge.length;
      state.knowledge = state.knowledge.filter((entry) => !(String(entry.id) === String(params[0]) && entry.kind === 'product'));
      return [{ affectedRows: before - state.knowledge.length }];
    }
    if (sql.startsWith('SELECT id FROM knowledge_items WHERE id=? FOR UPDATE')) {
      const item = knowledgeFor(params[0]);
      return [item ? [{ id: item.id }] : []];
    }
    if (sql.startsWith('UPDATE knowledge_items SET')) {
      const item = knowledgeFor(params[4]);
      if (!item) return [{ affectedRows: 0 }];
      Object.assign(item, { title: params[0], kind: 'product', content: params[1], source_name: params[2], status: params[3] });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE catalogue_products SET knowledge_id=?')) {
      const row = state.products.find((entry) => String(entry.id) === String(params[14]));
      if (!row) return [{ affectedRows: 0 }];
      Object.assign(row, {
        knowledge_id: String(params[0]), name: params[1], product_type: params[2], summary: params[3],
        description_html: params[4], specs: params[5], spec_note: params[6], features: params[7],
        image_name: params[8], image_source: params[9], photo: params[10], manufacturer_source: params[11],
        status: params[12], sort_order: params[13], updated_at: '2026-11-03T01:00:00.000Z'
      });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT p.*,k.status AS knowledge_status FROM catalogue_products p')) {
      const rows = sql.includes('WHERE p.id=?')
        ? state.products.filter((row) => String(row.id) === String(params[0]))
        : state.products;
      return [rows.map((row) => ({ ...row, knowledge_status: knowledgeFor(row.knowledge_id)?.status || null }))];
    }
    if (sql.startsWith('SELECT p.* FROM catalogue_products p')) {
      return [state.products.filter((row) => row.status === 'published' && knowledgeFor(row.knowledge_id)?.status === 'published')];
    }
    throw new Error(`Unexpected simulated query: ${sql}`);
  }

  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(...args) { return execute(...args); }
  };
  return {
    state,
    async execute(...args) { return execute(...args); },
    async getConnection() { return conn; }
  };
}

function sampleInput(overrides = {}) {
  return {
    companyId: 'jfd',
    name: 'Test Rebreather',
    productType: 'Test rebreather type',
    summary: 'A test product summary.',
    descriptionHtml: '<p>Rich <strong>description</strong>.</p><script>alert(1)</script>',
    specs: [{ label: 'System', value: 'Test system' }],
    specNote: '',
    features: ['First feature'],
    manufacturerSource: 'https://example.com/product',
    status: 'draft',
    ...overrides
  };
}

test('rich text is sanitised for storage and converted to clean knowledge text', () => {
  const html = sanitizeRichText('<p class="x" style="color:red">Hello <b>bold</b> <a href="https://example.com" onclick="alert(1)">link</a></p><img src=x onerror=alert(1)><script>alert(1)</script>');
  assert.equal(html, '<p>Hello <strong>bold</strong> <a href="https://example.com">link</a></p>');
  assert.equal(sanitizeRichText('<p><br></p>'), '');
  assert.equal(sanitizeRichText('<p><a href="javascript:alert(1)">bad</a></p>'), '<p><a>bad</a></p>');
  assert.equal(sanitizeRichText('<ol><li data-list="bullet">One</li></ol>'), '<ol><li data-list="bullet">One</li></ol>');
  assert.equal(richTextToPlain('<ul><li>One</li><li>Two</li></ul>'), '- One\n- Two');
  assert.equal(richTextToPlain('<p>One</p><p>Two<br>Three</p>'), 'One\nTwo\nThree');
});

test('product input validation, slugs and knowledge content use the fixed companies', () => {
  assert.equal(slugify('OPEN 5.5 — Test'), 'open-5-5-test');
  const product = normaliseProduct(sampleInput());
  assert.equal(product.slug, 'test-rebreather');
  assert.equal(product.descriptionHtml, '<p>Rich <strong>description</strong>.</p>');
  assert.equal(product.company.name, 'JFD');
  const content = knowledgeContent(product);
  assert.match(content, /Manufacturer: JFD/);
  assert.match(content, /Product: Test Rebreather/);
  assert.match(content, /SSSB product page: \/jfd\.html#test-rebreather/);
  assert.match(content, /Manufacturer source: https:\/\/example\.com\/product/);
  assert.match(content, /Confirm current specifications/);
  assert.throws(() => normaliseProduct(sampleInput({ companyId: 'unknown' })), /catalogue companies/);
  assert.throws(() => normaliseProduct(sampleInput({ name: '' })), /Product name/);
  assert.throws(() => normaliseProduct(sampleInput({ manufacturerSource: 'http://example.com' })), /HTTPS/);
  assert.throws(() => normaliseProduct(sampleInput({ specs: Array.from({ length: 21 }, () => ({ label: 'A', value: 'B' })) })), /no more than 20/);
});

test('creating and updating a product keeps the website record and knowledge record in sync', async () => {
  const pool = fakePool();
  const created = await createProduct(pool, sampleInput());
  assert.equal(created.slug, 'test-rebreather');
  assert.equal(pool.state.products.length, 1);
  assert.equal(pool.state.knowledge.length, 1);
  assert.equal(pool.state.knowledge[0].title, 'JFD Test Rebreather');
  assert.equal(pool.state.knowledge[0].status, 'draft');
  assert.ok(pool.state.chunks.length >= 1);
  assert.match(pool.state.chunks.map((chunk) => chunk.content).join('\n'), /Rich description/);
  assert.doesNotMatch(pool.state.products[0].description_html, /<script|alert\(/);

  await updateProduct(pool, created.id, {
    status: 'published',
    summary: 'Updated summary.',
    descriptionHtml: '<p>Updated description.</p>',
    features: ['Second feature'],
    manufacturerSource: 'https://example.com/updated'
  });
  assert.equal(pool.state.products[0].status, 'published');
  assert.equal(pool.state.products[0].summary, 'Updated summary.');
  assert.equal(pool.state.knowledge[0].status, 'published');
  assert.match(pool.state.knowledge[0].content, /Updated summary/);
  assert.match(pool.state.knowledge[0].content, /Updated description/);
  assert.doesNotMatch(pool.state.chunks.map((chunk) => chunk.content).join('\n'), /A test product summary/);
  assert.match(pool.state.chunks.map((chunk) => chunk.content).join('\n'), /Updated description/);
});

test('a colliding product URL is resolved before the knowledge content is built', async () => {
  const pool = fakePool();
  await createProduct(pool, sampleInput());
  const created = await createProduct(pool, sampleInput());
  assert.equal(created.slug, 'test-rebreather-2');
  const second = pool.state.knowledge.find((entry) => entry.content.includes('SSSB product page: /jfd.html#test-rebreather-2'));
  assert.ok(second, 'the knowledge item should link to the resolved product URL');
  assert.match(pool.state.chunks.find((chunk) => chunk.knowledge_id === second.id).content, /#test-rebreather-2/);
});

test('deleting a product removes its catalogue record, product knowledge and chunks', async () => {
  const pool = fakePool();
  const created = await createProduct(pool, sampleInput(), {
    imageName: '01234567-89ab-4cde-8f01-23456789abcd.png',
    imageSource: 'upload'
  });
  assert.equal(pool.state.products.length, 1);
  const result = await deleteProduct(pool, created.id);
  assert.deepEqual(result, {
    previousImage: '01234567-89ab-4cde-8f01-23456789abcd.png',
    previousImageSource: 'upload'
  });
  assert.equal(pool.state.products.length, 0);
  assert.equal(pool.state.knowledge.length, 0);
  assert.equal(pool.state.chunks.length, 0);
  assert.equal(await deleteProduct(pool, created.id), null);
});

test('deleting a product leaves unrelated linked knowledge in place', async () => {
  const pool = fakePool();
  const created = await createProduct(pool, sampleInput());
  pool.state.knowledge[0].kind = 'company';
  const result = await deleteProduct(pool, created.id);
  assert.equal(result.previousImageSource, 'asset');
  assert.equal(pool.state.products.length, 0);
  assert.equal(pool.state.knowledge.length, 1);
  assert.ok(pool.state.chunks.length >= 1);
});

test('the delete endpoint removes the product, knowledge and uploaded image', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sssb-delete-product-'));
  try {
    const filename = `${crypto.randomUUID()}.png`;
    await fs.mkdir(path.join(directory, 'products'), { recursive: true });
    await fs.writeFile(path.join(directory, 'products', filename), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const pool = fakePool();
    const created = await createProduct(pool, sampleInput(), { imageName: filename, imageSource: 'upload' });
    const appPool = {
      async execute(sql, params = []) {
        if (sql.includes('FROM staff_sessions')) return [[{ staff_id: '1', email: 'staff@example.com' }]];
        if (sql.startsWith('UPDATE staff_sessions SET last_seen_at')) return [{ affectedRows: 1 }];
        return pool.execute(sql, params);
      },
      async getConnection() { return pool.getConnection(); }
    };
    const app = createApp({ pool: appPool, env: { NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000', UPLOAD_DIR: directory } });
    const agent = request.agent(app);
    const csrf = await agent.get('/api/csrf').expect(200);
    const tokenValue = csrf.body.csrfToken;
    await agent.delete(`/api/admin/products/${created.id}`)
      .set('Cookie', `sss_staff=${'A'.repeat(43)}; sss_csrf=${tokenValue}`)
      .set('X-CSRF-Token', tokenValue)
      .expect(200);
    assert.equal(pool.state.products.length, 0);
    assert.equal(pool.state.knowledge.length, 0);
    await assert.rejects(fs.access(path.join(directory, 'products', filename)), /ENOENT/);
    await agent.delete(`/api/admin/products/${created.id}`)
      .set('Cookie', `sss_staff=${'A'.repeat(43)}; sss_csrf=${tokenValue}`)
      .set('X-CSRF-Token', tokenValue)
      .expect(404);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('the public catalogue exposes only published products and strips rich-text markup again', async () => {
  const pool = fakePool();
  await createProduct(pool, sampleInput());
  const published = await createProduct(pool, sampleInput({ name: 'Published Product', status: 'published' }));
  await updateProduct(pool, published.id, { descriptionHtml: '<p>Public <em>description</em>.</p><script>alert(1)</script>' });
  const catalogue = await publicCatalogue(pool);
  assert.equal(catalogue.totals.products, 1);
  assert.equal(catalogue.totals.companies, 5);
  assert.equal(catalogue.totals.categories, 3);
  const jfd = catalogue.companies.find((company) => company.key === 'jfd');
  assert.equal(jfd.logo, '/assets/img/companies/jfd-logo.jpg');
  assert.equal(jfd.productCount, 1);
  assert.equal(jfd.products[0].name, 'Published Product');
  assert.equal(jfd.products[0].imageUrl, '/assets/img/companies/jfd-logo.jpg');
  assert.equal(jfd.products[0].descriptionHtml, '<p>Public <em>description</em>.</p>');
  assert.equal(jfd.products[0].pageUrl, '/jfd.html#published-product');
  assert.equal(jfd.products[0].enquiryUrl, '/contact.html?company=jfd&product=published-product#enquiry');
  assert.equal(catalogue.categories.find((category) => category.id === 'diving').productCount, 1);
});

test('image uploads are identified by magic bytes and stored outside the public directory', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(12)]);
  assert.equal(sniffImage(jpeg).ext, 'jpg');
  assert.equal(sniffImage(png).ext, 'png');
  assert.equal(sniffImage(webp).ext, 'webp');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sssb-product-image-'));
  try {
    await assert.rejects(storeProductImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), directory), /JPG, PNG or WebP/);
    const stored = await storeProductImage(png, directory);
    assert.match(stored.filename, /^[0-9a-f-]{36}\.png$/);
    assert.equal(stored.url, `/media/products/${stored.filename}`);
    assert.equal((await fs.readFile(path.join(directory, 'products', stored.filename))).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('the public catalogue API requires no login and returns no-store', async () => {
  const pool = fakePool();
  await createProduct(pool, sampleInput({ name: 'API Product', status: 'published' }));
  const app = createApp({ pool, env: { NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000' } });
  const response = await request(app).get('/api/catalogue').expect(200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body.totals.products, 1);
  assert.equal(response.body.companies.find((company) => company.key === 'jfd').products[0].name, 'API Product');
  await request(app).get('/api/admin/products').expect(401);
});

test('a missing product table returns 503 so the static catalogue stays visible', async () => {
  const pool = { async execute() { const error = new Error('missing'); error.code = 'ER_NO_SUCH_TABLE'; throw error; } };
  const app = createApp({ pool, env: { NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000' } });
  await request(app).get('/api/catalogue').expect(503);
});

test('a product-linked knowledge item cannot be edited from the Knowledge section', async () => {
  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params = []) {
      if (sql.startsWith('SELECT * FROM knowledge_items WHERE id=? FOR UPDATE')) {
        return [[{ id: params[0], title: 'JFD Shadow', kind: 'product', content: 'Product facts', source_name: 'SSSB website catalogue: JFD', status: 'published' }]];
      }
      if (sql.startsWith('SELECT id FROM catalogue_products WHERE knowledge_id=? LIMIT 1')) return [[{ id: '9' }]];
      throw new Error(`Unexpected simulated query: ${sql}`);
    }
  };
  const pool = {
    async execute(sql) {
      if (sql.includes('FROM staff_sessions')) return [[{ staff_id: '1', email: 'staff@example.com' }]];
      if (sql.startsWith('UPDATE staff_sessions SET last_seen_at')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected simulated query: ${sql}`);
    },
    async getConnection() { return conn; }
  };
  const app = createApp({ pool, env: { NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000' } });
  const agent = request.agent(app);
  const csrf = await agent.get('/api/csrf').expect(200);
  const tokenValue = csrf.body.csrfToken;
  const response = await agent.patch('/api/admin/knowledge/7')
    .set('Cookie', `sss_staff=${'A'.repeat(43)}; sss_csrf=${tokenValue}`)
    .set('X-CSRF-Token', tokenValue)
    .send({ title: 'Changed title' })
    .expect(409);
  assert.equal(response.body.error, 'Edit this product in the Products section.');
  await agent.post('/api/admin/products')
    .set('Cookie', `sss_staff=${'A'.repeat(43)}; sss_csrf=${tokenValue}`)
    .send({ name: 'No CSRF' })
    .expect(403);
});

test('the knowledge list omits items linked to a product', async () => {
  const pool = {
    async execute(sql) {
      if (sql.includes('FROM staff_sessions')) return [[{ staff_id: '1', email: 'staff@example.com' }]];
      if (sql.startsWith('UPDATE staff_sessions SET last_seen_at')) return [{ affectedRows: 1 }];
      if (sql.startsWith('SELECT COUNT(*) AS total FROM knowledge_items k LEFT JOIN catalogue_products p')) {
        assert.match(sql, /WHERE p\.id IS NULL/);
        return [[{ total: 1 }]];
      }
      if (sql.startsWith('SELECT k.id,k.title,k.kind,k.source_name,k.status,k.created_at,k.updated_at,p.id AS catalogue_product_id FROM knowledge_items k')) {
        assert.match(sql, /WHERE p\.id IS NULL/);
        return [[{
          id: '2', title: 'Company profile', kind: 'company', source_name: 'SSSB', status: 'published',
          created_at: '2026-11-03T00:00:00.000Z', updated_at: '2026-11-03T00:00:00.000Z', catalogue_product_id: null
        }]];
      }
      throw new Error(`Unexpected simulated query: ${sql}`);
    }
  };
  const app = createApp({ pool, env: { NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000' } });
  const response = await request(app).get('/api/admin/knowledge')
    .set('Cookie', `sss_staff=${'A'.repeat(43)}`)
    .expect(200);
  assert.equal(response.body.total, 1);
  assert.deepEqual(response.body.items.map((item) => item.title), ['Company profile']);
});

test('uploaded product images are served from the private upload directory', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sssb-media-'));
  try {
    const filename = `${crypto.randomUUID()}.png`;
    await fs.mkdir(path.join(directory, 'products'), { recursive: true });
    await fs.writeFile(path.join(directory, 'products', filename), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const app = createApp({ pool: fakePool(), env: { NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000', UPLOAD_DIR: directory } });
    const response = await request(app).get(`/media/products/${filename}`).expect(200);
    assert.match(response.headers['content-type'], /^image\/png/);
    assert.match(response.headers['cache-control'], /immutable/);
    await request(app).get('/media/products/../secret.png').expect(404);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
