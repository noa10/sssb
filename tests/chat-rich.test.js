'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { addProductReferences } = require('../server/product-references');
const { addApprovedLinks } = require('../server/approved-links');
const { render, safeUrl } = require('../public/assets/js/chat-content');

function cataloguePool(rows) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async execute(sql) {
      calls += 1;
      assert.match(sql, /FROM catalogue_products p JOIN knowledge_items k ON k\.id=p\.knowledge_id/);
      assert.match(sql, /p\.status='published' AND k\.status='published'/);
      return [rows.filter((row) => row.status === 'published')];
    }
  };
}

function product(companyId, slug, name, type, overrides = {}) {
  return {
    company_id: companyId,
    slug,
    name,
    product_type: type,
    image_name: `${companyId}-${slug}.jpg`,
    image_source: 'asset',
    manufacturer_source: 'https://example.com/product/',
    status: 'published',
    ...overrides
  };
}

function answer(content) { return { id: '1', role: 'assistant', status: 'answered', content }; }

test('product cards use current published catalogue rows and survive reloads', async () => {
  const pool = cataloguePool([
    product('fxc', 'mc4', 'MC-4', 'Ram-air personnel parachute system', {
      image_name: 'fxc-mc4.jpg',
      manufacturer_source: 'https://www.fxcguardian.com/product/mc-4-parachute-system/'
    }),
    product('jfd', 'shadow', 'Shadow', 'Tactical diving rebreather', { status: 'draft' })
  ]);
  const messages = [answer('The FXC MC-4 and JFD Shadow have different roles.')];
  const first = await addProductReferences(pool, messages);
  const second = await addProductReferences(pool, messages);
  assert.deepEqual(first, second);
  assert.equal(first[0].products.length, 1);
  assert.deepEqual(first[0].products[0], {
    name: 'FXC MC-4', type: 'Ram-air personnel parachute system', url: '/fxc.html#mc4',
    image: '/assets/img/products/fxc-mc4.jpg',
    manufacturerUrl: 'https://www.fxcguardian.com/product/mc-4-parachute-system/'
  });
  assert.equal(messages[0].products, undefined);
});

test('retired and unrelated products do not produce cards', async () => {
  const pool = cataloguePool([
    product('fxc', 'mc4', 'MC-4', 'Ram-air personnel parachute system', { status: 'retired' }),
    product('jfd', 'shadow', 'Shadow', 'Tactical diving rebreather', { status: 'draft' }),
    product('zodiac-nautic', 'open-55', 'OPEN 5.5', 'Multi-activity rigid inflatable boat'),
    product('seacraft', 'go', 'GO!', 'Compact diver propulsion vehicle')
  ]);
  const input = [answer('The MC-4 and Shadow are mentioned. You can go to the team.')];
  assert.equal((await addProductReferences(pool, input))[0].products, undefined);
  assert.equal((await addProductReferences(pool, [answer('Consider the OPEN 5.5.')]))[0].products[0].url, '/zodiac-nautic.html#open-55');
  assert.equal((await addProductReferences(pool, [answer('Consider Seacraft GO!')]))[0].products[0].url, '/seacraft.html#go');
  assert.equal((await addProductReferences(pool, [answer('The OPEN 5.50 is a different model.')]))[0].products, undefined);
  const before = pool.calls;
  await addProductReferences(pool, [{ role: 'user', status: 'answered', content: 'MC-4' }]);
  assert.equal(pool.calls, before);
});

test('staff edits can remove a manufacturer link or retire a product', async () => {
  const record = product('fxc', 'mc4', 'MC-4', 'Ram-air personnel parachute system', {
    image_name: 'fxc-mc4.jpg',
    manufacturer_source: 'https://www.fxcguardian.com/product/mc-4-parachute-system/'
  });
  const pool = cataloguePool([record]);
  const messages = [answer('The FXC MC-4 is a parachute system.')];
  record.manufacturer_source = '';
  assert.equal((await addProductReferences(pool, messages))[0].products[0].manufacturerUrl, null);
  record.status = 'retired';
  assert.equal((await addProductReferences(pool, messages))[0].products, undefined);
});

test('uploaded product images use the media route', async () => {
  const pool = cataloguePool([
    product('fxc', 'mc4', 'MC-4', 'Ram-air personnel parachute system', {
      image_name: '01234567-89ab-4cde-8f01-23456789abcd.webp',
      image_source: 'upload'
    })
  ]);
  const [result] = await addProductReferences(pool, [answer('The FXC MC-4 is a parachute system.')]);
  assert.equal(result.products[0].image, '/media/products/01234567-89ab-4cde-8f01-23456789abcd.webp');
});

test('every product named in an answer gets a card', async () => {
  const pool = cataloguePool([
    product('jfd', 'shadow', 'Shadow', 'Tactical diving rebreather'),
    product('jfd', 'enforcer', 'Enforcer', 'Compact tactical rebreather'),
    product('jfd', 'stealth-multi-role', 'Stealth Multi-Role', 'Modular life-support system'),
    product('jfd', 'stealth-sc', 'Stealth SC', 'Semi-closed mixed-gas rebreather')
  ]);
  const [result] = await addProductReferences(pool, [
    answer('The catalogue lists the JFD Shadow, JFD Enforcer, JFD Stealth Multi-Role and JFD Stealth SC.')
  ]);
  assert.equal(result.products.length, 4);
});

test('assistant links require an exact URL in published knowledge', async () => {
  const records = [
    { status: 'published', content: 'Manufacturer source: https://example.com/product/.' },
    { status: 'draft', content: 'https://draft.example/product' },
    { status: 'published', content: 'https://bad.example/longer-path' }
  ];
  const pool = { async execute(sql, params) {
    assert.match(sql, /k\.status='published'/);
    return [records.filter((record) => record.status === 'published' && params.some((url) => record.content.includes(url)))];
  } };
  const input = [answer('[Product](https://example.com/product/) [Draft](https://draft.example/product) [Wrong path](https://bad.example/) [Fake](https://fake.example/)')];
  const [result] = await addApprovedLinks(pool, input);
  assert.deepEqual(result.approvedLinks, ['https://example.com/product/']);
  records[0].status = 'retired';
  assert.equal((await addApprovedLinks(pool, input))[0].approvedLinks, undefined);
});

test('a missing optional catalogue table keeps plain chat available', async () => {
  const messages = [answer('The MC-4 is a parachute system.')];
  const result = await addProductReferences({ async execute() { const error = new Error(); error.code = 'ER_NO_SUCH_TABLE'; throw error; } }, messages);
  assert.deepEqual(result, messages);
});

class FakeNode {
  constructor(tag, doc, text = '') { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attributes = {}; this.value = text; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren() { this.children = []; this.value = ''; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  set textContent(value) { this.children = []; this.value = String(value); }
  get textContent() { return this.value + this.children.map((child) => child.textContent).join(''); }
}
const doc = { createElement: (tag) => new FakeNode(tag, doc), createTextNode: (text) => new FakeNode('#text', doc, text) };
function nodes(node, tag) { return [node, ...node.children.flatMap((child) => nodes(child, tag))].filter((entry) => entry.tagName === tag.toUpperCase()); }

test('rich chat renders formatting and safe links without interpreting HTML', () => {
  const body = doc.createElement('div');
  render(body, { role: 'assistant', content: '**Specs**\n- A useful feature\n- [Manufacturer](https://example.com/item)\n\n<script>alert(1)</script> [bad](javascript:alert) https://example.com/path. [fake](https://fake.example/)', approvedLinks: ['https://example.com/item', 'https://example.com/path'] }, 'https://site.example/');
  assert.equal(nodes(body, 'strong')[0].textContent, 'Specs');
  assert.equal(nodes(body, 'ul').length, 1);
  assert.equal(nodes(body, 'li').length, 2);
  assert.equal(nodes(body, 'script').length, 0);
  assert.match(body.textContent, /<script>alert\(1\)<\/script> bad/);
  const links = nodes(body, 'a');
  assert.equal(links.length, 2);
  assert.ok(links.every((link) => link.href.startsWith('https://example.com/')));
  assert.ok(links.every((link) => link.rel === 'noopener noreferrer' && link.target === '_blank'));
  assert.equal(safeUrl('javascript:alert(1)', 'https://site.example/'), null);
  assert.equal(safeUrl('//evil.example/', 'https://site.example/'), null);
  assert.equal(safeUrl('https://good.example@evil.example/', 'https://site.example/'), null);
  assert.equal(safeUrl('http://evil.example/', 'https://site.example/'), null);
});

test('all product cards render when an answer names several products', () => {
  const body = doc.createElement('div');
  render(body, {
    role: 'assistant',
    content: 'Four products',
    products: [
      { name: 'JFD Shadow', url: '/jfd.html#shadow' },
      { name: 'JFD Enforcer', url: '/jfd.html#enforcer' },
      { name: 'JFD Stealth Multi-Role', url: '/jfd.html#stealth-multi-role' },
      { name: 'JFD Stealth SC', url: '/jfd.html#stealth-sc' }
    ]
  }, 'https://site.example/');
  assert.equal(nodes(body, 'article').length, 4);
});

test('visitor text remains plain and product images use local catalogue paths', () => {
  const body = doc.createElement('div');
  render(body, { role: 'user', content: '**Hello** <img src=x onerror=alert(1)>' }, 'https://site.example/');
  assert.equal(nodes(body, 'strong').length, 0);
  assert.equal(nodes(body, 'img').length, 0);
  assert.equal(body.textContent, '**Hello** <img src=x onerror=alert(1)>');

  render(body, { role: 'assistant', content: 'A product', products: [
    { name: 'FXC MC-4', type: 'Parachute', url: '/fxc.html#mc4', image: '/assets/img/products/fxc-mc4.jpg', manufacturerUrl: 'https://example.com/product' },
    { name: 'Unsafe', url: '//evil.example/', image: 'https://evil.example/image.png' }
  ] }, 'https://site.example/');
  assert.equal(nodes(body, 'article').length, 1);
  assert.equal(nodes(body, 'img')[0].getAttribute('src'), '/assets/img/products/fxc-mc4.jpg');
  assert.equal(nodes(body, 'a')[0].href, 'https://site.example/fxc.html#mc4');
});
