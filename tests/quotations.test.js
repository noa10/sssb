'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { normaliseQuotation, quotation, submitQuotation, listQuotations, quotationConversationIds, ENQUIRY_TYPES, CONFIRMATION } = require('../server/quotations');
const { HANDOFF } = require('../server/ai');

const requestId = crypto.randomUUID();
const base = { requestId, companyId: null, productName: 'General enquiry' };

function invalid(input, pattern) {
  assert.throws(() => normaliseQuotation({ ...base, ...input }), (error) => error.status === 400 && pattern.test(error.message));
}

test('normalises common quotation fields and validates whole numbers and calendar dates', () => {
  const quote = normaliseQuotation({ ...base, requestId: requestId.toUpperCase(), productName: '  Product  ', quantity: 100000,
    requiredBy: '2028-02-29', deliveryLocation: ' Johor ', procurementRoute: 'direct', message: ' Hello ' });
  assert.equal(quote.requestId, requestId);
  assert.equal(quote.productName, 'Product');
  assert.equal(quote.quantity, 100000);
  assert.equal(quote.requiredBy, '2028-02-29');
  assert.equal(quote.deliveryLocation, 'Johor');
  assert.equal(quote.message, 'Hello');
  assert.equal(normaliseQuotation(base).procurementRoute, 'unsure');
  assert.equal(normaliseQuotation({ ...base, quantity: null, requiredBy: '' }).quantity, null);
  assert.equal(normaliseQuotation({ ...base, productName: 'x'.repeat(200) }).productName.length, 200);
  for (const quantity of [0, -1, 1.5, 100001, '3', true]) invalid({ quantity }, /quantity/i);
  for (const requiredBy of ['2027-02-29', '2026-04-31', '0000-01-01', '2026-13-01', '02/01/2026']) invalid({ requiredBy }, /date/i);
  invalid({ requestId: 'invalid' }, /request id/i);
  invalid({ productName: ' ' }, /product or enquiry/i);
  invalid({ productName: 'x'.repeat(201) }, /200/);
  invalid({ companyId: 'unknown' }, /manufacturer/i);
  invalid({ companyId: 'fxc', productKey: '../unsafe', message: 'Please quote' }, /product key/i);
  invalid({ productKey: 'product' }, /product key/i);
  invalid({ procurementRoute: 'other' }, /procurement route/i);
  invalid({ deliveryLocation: 'x'.repeat(201) }, /delivery location/i);
  invalid({ message: 'x'.repeat(4001) }, /message/i);
});

test('requires the fields relevant to each manufacturer and discards stale fields', () => {
  assert.deepEqual(ENQUIRY_TYPES, {
    'commercial-diving': 'Commercial diving and hyperbaric equipment',
    'defence-diving': 'Defence diving',
    'safety-systems': 'Safety critical systems & communications',
    'service-maintenance': 'Service, inspection, maintenance and training',
    'submarine-rescue': 'Submarine escape and rescue',
    'submarine-platforms': 'Submarine platforms',
    'tactical-delivery': 'Tactical delivery vehicles'
  });
  for (const type of Object.keys(ENQUIRY_TYPES)) {
    const input = { ...base, companyId: 'jfd', message: 'Inquiry', enquiryType: type, country: { stale: true }, city: 'Old' };
    const quote = normaliseQuotation(input);
    assert.equal(quote.enquiryType, type);
    assert.equal(quote.country, '');
    assert.equal(quote.city, '');
  }
  invalid({ companyId: 'jfd', enquiryType: 'defence-diving' }, /message/i);
  invalid({ companyId: 'jfd', message: 'Inquiry' }, /enquiry type/i);
  invalid({ companyId: 'jfd', message: 'Inquiry', enquiryType: 'invented' }, /enquiry type/i);
  invalid({ companyId: 'fxc' }, /message/i);
  invalid({ companyId: 'safe-at-sea', message: 'Inquiry' }, /country/i);
  invalid({ companyId: 'safe-at-sea', country: 'Malaysia' }, /message/i);
  const safe = normaliseQuotation({ ...base, companyId: 'safe-at-sea', message: 'Inquiry', country: ' Malaysia ', city: ['stale'] });
  assert.equal(safe.country, 'Malaysia');
  assert.equal(safe.city, '');

  const zodiac = { companyId: 'zodiac-nautic', country: 'France', city: 'Paris', postalCode: '75001', navigationArea: 'Coastal' };
  for (const field of ['country', 'city', 'postalCode', 'navigationArea']) invalid({ ...zodiac, [field]: '' }, /required/i);
  assert.equal(normaliseQuotation({ ...base, ...zodiac, region: ' Paris ', enquiryType: 'stale' }).region, 'Paris');
  assert.equal(normaliseQuotation({ ...base, ...zodiac }).message, '');
  assert.equal(normaliseQuotation({ ...base, companyId: 'seacraft', enquiryType: {}, country: 'stale' }).message, '');
  assert.equal(normaliseQuotation({ ...base, country: 'stale', region: {} }).country, '');
});

test('staff mapping serializes DATE values and preserves the contact snapshot', () => {
  const mapped = quotation({
    id: 17, company_id: 'jfd', company_name: 'JFD', product_key: 'shadow', product_name: 'Shadow', quantity: '2',
    required_by: new Date('2028-02-29T00:00:00.000Z'), delivery_location: 'Johor', procurement_route: 'government',
    message: 'Please quote', enquiry_type: 'safety-systems', country: '', city: '', postal_code: '', navigation_area: '', region: '',
    contact_name: 'Alice', contact_email: 'alice@example.com', contact_phone: '123', contact_company: 'Company', created_at: '2026-01-02T00:00:00Z'
  });
  assert.deepEqual(mapped, {
    id: '17', companyId: 'jfd', companyName: 'JFD', productKey: 'shadow', productUrl: '/jfd.html#shadow', productName: 'Shadow',
    quantity: 2, requiredBy: '2028-02-29', deliveryLocation: 'Johor', procurementRoute: 'government', procurementRouteLabel: 'Government procurement',
    message: 'Please quote', enquiryType: 'safety-systems', enquiryTypeLabel: 'Safety critical systems & communications',
    country: '', city: '', postalCode: '', navigationArea: '', region: '',
    contact: { name: 'Alice', email: 'alice@example.com', phone: '123', company: 'Company' }, createdAt: '2026-01-02T00:00:00Z'
  });
  assert.match(HANDOFF, /request quotation/i);
  assert.match(HANDOFF, /email or WhatsApp/i);
  assert.match(CONFIRMATION, /quotation request/i);
});

test('handles a competing unique-key insert with a current read and no extra confirmation', async () => {
  const payload = normaliseQuotation({ ...base, message: 'Requested' });
  const row = {
    id: 1, company_id: null, company_name: 'Other', product_key: null, product_name: payload.productName,
    quantity: null, required_by: null, delivery_location: '', procurement_route: 'unsure', message: 'Requested',
    enquiry_type: '', country: '', city: '', postal_code: '', navigation_area: '', region: '',
    contact_name: 'Alice', contact_email: 'alice@example.com', contact_phone: '123', contact_company: 'Company', created_at: new Date()
  };
  let reads = 0;
  let committed = false;
  let released = false;
  const conn = {
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() {},
    release() { released = true; },
    async execute(sql) {
      if (sql.startsWith('SELECT id,email')) return [[{ id: 1, name: 'Alice', email: 'alice@example.com', phone: '123', company: 'Company' }]];
      if (sql.startsWith('SELECT c.id')) return [[{ id: 'conversation' }]];
      if (sql.startsWith('SELECT * FROM quotation_requests')) {
        assert.match(sql, /FOR UPDATE/);
        return [reads++ ? [row] : []];
      }
      if (sql.startsWith('INSERT INTO quotation_requests')) {
        const error = new Error('duplicate');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const result = await submitQuotation({ async getConnection() { return conn; } }, 1, 'conversation', payload);
  assert.equal(result.duplicate, true);
  assert.equal(result.quotation.message, 'Requested');
  assert.equal(reads, 2);
  assert.equal(committed, true);
  assert.equal(released, true);
  reads = 0;
  committed = false;
  released = false;
  await assert.rejects(submitQuotation({ async getConnection() { return conn; } }, 1, 'conversation', { ...payload, message: 'Changed' }),
    (error) => error.status === 409);
  assert.equal(committed, false);
  assert.equal(released, true);
});

test('rechecks a selected product after discovering it', async () => {
  const payload = normaliseQuotation({ ...base, companyId: 'jfd', productKey: 'shadow', productName: 'JFD Shadow', message: 'Please quote', enquiryType: 'defence-diving' });
  const queries = [];
  let rolledBack = false;
  const conn = {
    async beginTransaction() {},
    async commit() { throw new Error('Unexpected commit'); },
    async rollback() { rolledBack = true; },
    release() {},
    async execute(sql) {
      queries.push(sql);
      if (sql.startsWith('SELECT id,email')) return [[{ id: 1, name: 'Alice', email: 'alice@example.com', phone: '123', company: 'Company' }]];
      if (sql.startsWith('SELECT c.id')) return [[{ id: 'conversation' }]];
      if (sql.startsWith('SELECT * FROM quotation_requests')) return [[]];
      if (sql === 'SELECT id FROM catalogue_products WHERE company_id=? AND slug=?') return [[{ id: 1 }]];
      if (sql === 'SELECT id,company_id,slug,name,status,knowledge_id FROM catalogue_products WHERE id=? FOR UPDATE') {
        return [[{ id: 1, company_id: 'jfd', slug: 'shadow', name: 'Shadow renamed', status: 'published', knowledge_id: 2 }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  await assert.rejects(submitQuotation({ async getConnection() { return conn; } }, 1, 'conversation', payload),
    (error) => error.status === 409 && error.code === 'PRODUCT_CHANGED');
  assert.equal(rolledBack, true);
  assert.match(queries.at(-1), /WHERE id=\? FOR UPDATE$/);
  assert.equal(queries.some((sql) => sql.startsWith('INSERT')), false);
});

test('admin quotation lookup ignores only a missing table', async () => {
  const pool = { async execute() { const error = new Error('unavailable'); error.code = 'ER_NO_SUCH_TABLE'; throw error; } };
  assert.deepEqual(await listQuotations(pool, 'conversation'), []);
  assert.deepEqual(await quotationConversationIds(pool, ['conversation']), new Set());
  const other = { async execute() { throw new Error('other database failure'); } };
  assert.deepEqual(await quotationConversationIds(other, []), new Set());
  await assert.rejects(listQuotations(other, 'conversation'), /other database failure/);
  await assert.rejects(quotationConversationIds(other, ['conversation']), /other database failure/);
});
