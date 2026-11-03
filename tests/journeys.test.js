const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const argon2 = require('argon2');
const request = require('supertest');
const { createApp } = require('../server/app');
const { digest } = require('../server/security');
const { HANDOFF, UNKNOWN } = require('../server/ai');
const { CONFIRMATION } = require('../server/quotations');

// This exercises the HTTP contracts with a simulated database. MariaDB still needs its own integration test.
function fakeDatabase(passwordHash) {
  const data = { conversations: [], messages: [], quotations: [], catalogueProducts: [], knowledge: [], chunks: [], sessions: [], accounts: [], customerSessions: [], links: [], quotationTableMissing: false, failQuotationList: false, failQuotationConfirmation: false, rejectQuotationLock: false, rateLimitExceeded: false };
  let transactionQueue = Promise.resolve();
  const staff = { id: '1', email: 'staff@example.com', password_hash: passwordHash, disabled: 0 };
  const execute = async (sql, params = []) => {
    const query = sql.replace(/\s+/g, ' ').trim();
    if (query.startsWith('INSERT INTO rate_limits') || query.startsWith('UPDATE rate_limits')) return [{ affectedRows: 1 }];
    if (query.startsWith('SELECT hits, window_start')) return [[{ hits: data.rateLimitExceeded ? 10000 : 0, expired: 0 }]];
    if (query.startsWith('SELECT id,email,password_hash,disabled FROM staff_users')) return [[...(params[0] === staff.email ? [staff] : [])]];
    if (query.startsWith('INSERT INTO staff_sessions')) { data.sessions.push({ hash: params[0], staffId: params[1] }); return [{ affectedRows: 1 }]; }
    if (query.startsWith('SELECT s.staff_id, u.email FROM staff_sessions')) {
      const session = data.sessions.find((entry) => entry.hash === params[0]);
      return [[...(session ? [{ staff_id: staff.id, email: staff.email }] : [])]];
    }
    if (query.startsWith('UPDATE staff_sessions SET last_seen_at')) return [{ affectedRows: 1 }];
    if (query.startsWith('DELETE FROM staff_sessions')) { data.sessions = data.sessions.filter((entry) => entry.hash !== params[0]); return [{ affectedRows: 1 }]; }
    if (query.startsWith('INSERT INTO customer_accounts')) {
      if (data.accounts.some((account) => account.email === params[0])) {
        const error = new Error('duplicate email');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      const [email, password_hash, name, phone, company] = params;
      const account = { id: data.accounts.length + 1, email, password_hash, name, phone, company, disabled: 0 };
      data.accounts.push(account);
      return [{ insertId: account.id }];
    }
    if (query.startsWith('SELECT id,email,name,phone,company,password_hash,disabled FROM customer_accounts')) {
      return [data.accounts.filter((account) => account.email === params[0])];
    }
    if (query === 'SELECT id,email,name,phone,company FROM customer_accounts WHERE id=? AND disabled=0 FOR UPDATE') {
      return [data.accounts.filter((account) => account.id === params[0] && !account.disabled)
        .map(({ id, email, name, phone, company }) => ({ id, email, name, phone, company }))];
    }
    if (query.startsWith('UPDATE customer_accounts SET name=?,phone=?,company=? WHERE id=?')) {
      const account = data.accounts.find((entry) => entry.id === params[3]);
      if (account) Object.assign(account, { name: params[0], phone: params[1], company: params[2] });
      return [{ affectedRows: Number(Boolean(account)) }];
    }
    if (query === 'SELECT id FROM customer_accounts WHERE id=? AND disabled=0 FOR UPDATE') {
      return [data.accounts.filter((account) => account.id === params[0] && !account.disabled).map(({ id }) => ({ id }))];
    }
    if (query.startsWith('INSERT INTO customer_sessions')) {
      data.customerSessions.push({ hash: params[0], customerId: params[1] });
      return [{ affectedRows: 1 }];
    }
    if (query.startsWith('DELETE FROM customer_sessions')) {
      data.customerSessions = data.customerSessions.filter((session) => session.hash !== params[0]);
      return [{ affectedRows: 1 }];
    }
    if (query.startsWith('SELECT u.id,u.email,u.name,u.phone,u.company FROM customer_sessions')) {
      const session = data.customerSessions.find((entry) => entry.hash === params[0]);
      const account = session && data.accounts.find((entry) => entry.id === session.customerId && !entry.disabled);
      return [account ? [{ id: account.id, email: account.email, name: account.name, phone: account.phone, company: account.company }] : []];
    }
    if (query.startsWith('SELECT * FROM conversations WHERE visitor_token_hash=')) return [[...data.conversations.filter((entry) => entry.visitor_token_hash === params[0] && !entry.closed && !data.links.some((link) => link.conversation_id === entry.id))]];
    if (query.startsWith('SELECT c.* FROM customer_conversations')) {
      const owned = data.links.filter((link) => link.customer_id === params[0]).map((link) => link.conversation_id);
      return [data.conversations.filter((entry) => owned.includes(entry.id) && !entry.closed && new Date(entry.created_at).getTime() > Date.now() - 30 * 86400000).slice(-1)];
    }
    if (query.startsWith('SELECT c.id FROM conversations c JOIN customer_conversations cc')) {
      assert.match(query, /cc\.customer_id=\?/);
      assert.match(query, /visitor_closed_at IS NULL/);
      assert.match(query, /created_at>DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 30 DAY\) FOR UPDATE/);
      const owned = data.links.some((link) => link.customer_id === params[1] && link.conversation_id === params[0]);
      const row = data.conversations.find((entry) => entry.id === params[0] && !entry.closed && new Date(entry.created_at).getTime() > Date.now() - 30 * 86400000);
      return [owned && row && !data.rejectQuotationLock ? [{ id: row.id }] : []];
    }
    if (query.startsWith('INSERT INTO customer_conversations')) {
      data.links.push({ conversation_id: params[0], customer_id: params[1] });
      return [{ affectedRows: 1 }];
    }
    if (query.startsWith('INSERT INTO conversations')) {
      const [id, visitor_token_hash, name, email, phone, company] = params;
      data.conversations.push({ id, visitor_token_hash, name, email, phone, company, status: 'new', created_at: new Date(), updated_at: new Date() });
      return [{ affectedRows: 1 }];
    }
    if (query.startsWith('SELECT id FROM conversations WHERE id=')) return [[...data.conversations.filter((entry) => entry.id === params[0])]];
    if (query.startsWith('UPDATE conversations SET updated_at=')) {
      const row = data.conversations.find((entry) => entry.id === params[0]);
      if (row) row.updated_at = new Date();
      return [{ affectedRows: Number(Boolean(row)) }];
    }
    if (query.startsWith('DELETE FROM conversations WHERE id=')) {
      const before = data.conversations.length;
      data.conversations = data.conversations.filter((entry) => entry.id !== params[0]);
      data.messages = data.messages.filter((entry) => entry.conversation_id !== params[0]);
      data.quotations = data.quotations.filter((entry) => entry.conversation_id !== params[0]);
      data.links = data.links.filter((entry) => entry.conversation_id !== params[0]);
      return [{ affectedRows: before - data.conversations.length }];
    }
    if (query.startsWith('UPDATE conversations SET visitor_closed_at=')) {
      const conversation = data.conversations.find((entry) => entry.id === params[0]);
      if (conversation) conversation.closed = true;
      return [{ affectedRows: Number(Boolean(conversation)) }];
    }
    if (query.startsWith('UPDATE conversations SET status=')) {
      const conversation = data.conversations.find((entry) => entry.id === params[1]);
      if (conversation) conversation.status = params[0];
      return [{ affectedRows: Number(Boolean(conversation)) }];
    }
    if (query.startsWith('SELECT COUNT(*) AS total FROM conversations')) return [[{ total: data.conversations.length }]];
    if (query.startsWith('SELECT c.*, (SELECT COUNT(*) FROM messages')) return [[...data.conversations.map((entry) => ({ ...entry, message_count: data.messages.filter((message) => message.conversation_id === entry.id).length }))]];
    if (query.startsWith('SELECT *, created_at<=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY) AS messages_expired FROM conversations WHERE id=')) return [[...data.conversations.filter((entry) => entry.id === params[0]).map((entry) => ({ ...entry, messages_expired: 0 }))]];
    if (query.startsWith('SELECT m.id,m.role,m.content,m.status,m.created_at FROM messages m')) return [[...data.messages.filter((entry) => entry.conversation_id === params[0])]];
    if (query.startsWith('SELECT status,content FROM messages WHERE conversation_id=')) return [[...data.messages.filter((entry) => entry.conversation_id === params[0] && entry.request_id === params[1])]];
    if (query.startsWith("UPDATE messages SET status='failed' WHERE conversation_id=")) return [{ affectedRows: 0 }];
    if (query.startsWith("SELECT id FROM messages WHERE conversation_id=? AND status='pending'")) return [[...data.messages.filter((entry) => entry.conversation_id === params[0] && entry.status === 'pending')]];
    if (query.startsWith("SELECT COUNT(*) AS total FROM messages WHERE conversation_id=? AND role='user'")) return [[{ total: data.messages.filter((entry) => entry.conversation_id === params[0] && entry.role === 'user').length }]];
    if (query === 'SELECT id FROM catalogue_products WHERE company_id=? AND slug=?') {
      if (data.failCatalogueRead) throw new Error('catalogue unavailable');
      return [data.catalogueProducts.filter((entry) => entry.company_id === params[0] && entry.slug === params[1]).map(({ id }) => ({ id }))];
    }
    if (query === 'SELECT id,company_id,slug,name,status,knowledge_id FROM catalogue_products WHERE id=? FOR UPDATE') {
      return [data.catalogueProducts.filter((entry) => String(entry.id) === String(params[0]))];
    }
    if (query === 'SELECT status FROM knowledge_items WHERE id=? FOR UPDATE') {
      return [data.knowledge.filter((entry) => String(entry.id) === String(params[0])).map(({ status }) => ({ status }))];
    }
    if (query.startsWith('SELECT DISTINCT conversation_id FROM quotation_requests WHERE conversation_id IN')) {
      if (data.quotationTableMissing) {
        const error = new Error('quotation table missing');
        error.code = 'ER_NO_SUCH_TABLE';
        throw error;
      }
      if (data.failQuotationList) throw new Error('quotation lookup failed');
      const ids = new Set(data.quotations.filter((entry) => params.includes(entry.conversation_id)).map((entry) => entry.conversation_id));
      return [[...ids].map((conversation_id) => ({ conversation_id }))];
    }
    if (query.startsWith('SELECT * FROM quotation_requests') || query.startsWith('INSERT INTO quotation_requests')) {
      if (data.quotationTableMissing) {
        const error = new Error('quotation table missing');
        error.code = 'ER_NO_SUCH_TABLE';
        throw error;
      }
      if (query.startsWith('SELECT * FROM quotation_requests')) {
        const rows = data.quotations.filter((entry) => entry.conversation_id === params[0] && (params.length < 2 || entry.request_id === params[1]));
        return [params.length < 2 ? rows.slice().reverse() : rows];
      }
      const columns = query.match(/INSERT INTO quotation_requests \(([^)]+)\) VALUES/)[1].split(',').map((column) => column.trim());
      const row = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
      if (data.quotations.some((entry) => entry.conversation_id === row.conversation_id && entry.request_id === row.request_id)) {
        const error = new Error('duplicate quotation');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      Object.assign(row, { id: data.quotations.length + 1, created_at: new Date() });
      data.quotations.push(row);
      return [{ insertId: row.id }];
    }
    if (query.startsWith('INSERT INTO messages')) {
      if (data.failQuotationConfirmation && params[1] === CONFIRMATION) throw new Error('confirmation insert failed');
      const user = query.includes("'user'");
      const entry = { id: data.messages.length + 1, conversation_id: params[0], request_id: user ? params[1] : null, role: user ? 'user' : 'assistant', content: user ? params[2] : params[1], status: user ? 'pending' : 'answered', created_at: new Date() };
      data.messages.push(entry);
      return [{ insertId: entry.id }];
    }
    if (query.startsWith('SELECT role,content FROM (')) return [[...data.messages.filter((entry) => entry.conversation_id === params[0] && (entry.status === 'answered' || entry.id === params[1])).slice(-40)]];
    if (query.startsWith("UPDATE messages SET status='answered'")) {
      const entry = data.messages.find((message) => message.id === params[0] && message.status === 'pending');
      if (entry) entry.status = 'answered';
      return [{ affectedRows: Number(Boolean(entry)) }];
    }
    if (query.startsWith("UPDATE messages SET status='failed' WHERE id=")) {
      const entry = data.messages.find((message) => message.id === params[0] && message.status === 'pending');
      if (entry) entry.status = 'failed';
      return [{ affectedRows: Number(Boolean(entry)) }];
    }
    if (query.startsWith('INSERT INTO knowledge_items (title,kind,content,source_name,status)')) {
      const entry = { id: String(data.knowledge.length + 1), title: params[0], kind: params[1], content: params[2], source_name: params[3], status: params[4], created_at: new Date(), updated_at: new Date() };
      data.knowledge.push(entry);
      return [{ insertId: entry.id }];
    }
    if (query.startsWith('SELECT * FROM knowledge_items WHERE id=')) return [[...data.knowledge.filter((entry) => entry.id === String(params[0]))]];
    if (query.startsWith('UPDATE knowledge_items SET')) {
      const entry = data.knowledge.find((item) => item.id === String(params[4]));
      if (entry) Object.assign(entry, { title: params[0], source_name: params[1], status: params[2], content: params[3] });
      return [{ affectedRows: Number(Boolean(entry)) }];
    }
    if (query.startsWith('DELETE FROM knowledge_chunks')) { data.chunks = data.chunks.filter((entry) => entry.knowledge_id !== String(params[0])); return [{ affectedRows: 1 }]; }
    if (query.startsWith('INSERT INTO knowledge_chunks')) { data.chunks.push({ knowledge_id: String(params[0]), content: params[2] }); return [{ affectedRows: 1 }]; }
    if (query.startsWith("SELECT DISTINCT title FROM knowledge_items WHERE status='published'")) return [[...data.knowledge.filter((entry) => entry.status === 'published').map(({ title }) => ({ title }))]];
    if (query.startsWith('SELECT k.id,k.title,k.source_name,c.content FROM knowledge_chunks')) {
      return [[...data.chunks.map((chunk) => {
        const item = data.knowledge.find((entry) => entry.id === chunk.knowledge_id);
        return item && item.status === 'published' ? { ...item, content: chunk.content } : null;
      }).filter(Boolean)]];
    }
    if (query.startsWith('SELECT p.company_id,p.slug,p.name,p.product_type,p.image_name,p.image_source,p.manufacturer_source')) return [[]];
    if (query.startsWith('SELECT k.content FROM knowledge_items k WHERE')) return [[]];
    if (query.startsWith('SELECT COUNT(*) AS total FROM knowledge_items k LEFT JOIN catalogue_products p')) return [[{ total: data.knowledge.length }]];
    if (query.startsWith('SELECT k.id,k.title,k.kind,k.source_name,k.status,k.created_at,k.updated_at,p.id AS catalogue_product_id FROM knowledge_items k')) return [[...data.knowledge.map(({ content, ...entry }) => ({ ...entry, catalogue_product_id: null }))]];
    if (query.startsWith('SELECT k.id,k.title,k.kind,k.content,k.source_name,k.status,k.created_at,k.updated_at,p.id AS catalogue_product_id FROM knowledge_items k')) return [[...data.knowledge.filter((entry) => entry.id === String(params[0])).map((entry) => ({ ...entry, catalogue_product_id: null }))]];
    throw new Error(`Unexpected simulated query: ${query}`);
  };
  return {
    data,
    async execute(...args) { return execute(...args); },
    async getConnection() {
      let snapshot;
      let unlock;
      const releaseLock = () => { if (unlock) { unlock(); unlock = null; } };
      return {
        execute,
        async beginTransaction() {
          const previous = transactionQueue;
          transactionQueue = new Promise((resolve) => { unlock = resolve; });
          await previous;
          snapshot = structuredClone(data);
        },
        async commit() { snapshot = undefined; releaseLock(); },
        async rollback() { if (snapshot) Object.assign(data, snapshot); releaseLock(); },
        release() { releaseLock(); }
      };
    }
  };
}

async function mutate(agent, method, url, body) {
  const csrf = await agent.get('/api/csrf').expect(200);
  return agent[method](url).set('X-CSRF-Token', csrf.body.csrfToken).send(body);
}

test('the assistant receives more than the latest ten messages', async () => {
  const pool = fakeDatabase(await argon2.hash('A long test password!', { type: argon2.argon2id }));
  const calls = [];
  const provider = { async answer(input) { calls.push(input); return 'The MC-4 is described in the approved catalogue.'; } };
  const app = createApp({ pool, provider, env: { NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000' } });
  const visitor = request.agent(app);
  const account = { name: 'Memory Visitor', email: 'memory@example.com', phone: '12345678', company: 'Example Company' };
  assert.equal((await mutate(visitor, 'post', '/api/customer/register', { ...account, password: 'A long customer password!' })).status, 201);
  pool.data.knowledge.push({
    id: '1', title: 'MC-4 catalogue', kind: 'company', content: 'The MC-4 is a parachute system.',
    source_name: 'Product catalogue', status: 'published', created_at: new Date(), updated_at: new Date()
  });
  pool.data.chunks.push({ knowledge_id: '1', content: 'The MC-4 is a parachute system.' });
  const start = await mutate(visitor, 'post', '/api/chat/start', { consent: true });
  assert.equal(start.status, 201);
  const conversationId = start.body.conversation.id;
  for (let index = 0; index < 12; index += 1) {
    pool.data.messages.push({
      id: 100 + index, conversation_id: conversationId, role: index % 2 ? 'assistant' : 'user',
      content: `Earlier message ${index}`, status: 'answered', created_at: new Date()
    });
  }

  const sent = await mutate(visitor, 'post', '/api/chat/messages', { message: 'What is the MC-4?', requestId: crypto.randomUUID() });
  assert.equal(sent.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages.length, 14);
  assert.match(calls[0].messages[0].content, /what would you like to know/i);
  assert.ok(calls[0].messages.some((entry) => entry.content === 'Earlier message 0'));
  assert.equal(calls[0].messages.at(-1).content, 'What is the MC-4?');
});

test('visitor and staff journeys respect publication and conversation ownership', async () => {
  const pool = fakeDatabase(await argon2.hash('A long test password!', { type: argon2.argon2id }));
  const calls = [];
  const provider = { async answer(input) { calls.push(input); return 'The MC-4 is described in the approved catalogue.'; } };
  const app = createApp({ pool, provider, env: { NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000' } });
  const visitor = request.agent(app);
  const staff = request.agent(app);
  const other = request.agent(app);
  const account = { name: 'Visitor Name', email: 'visitor@example.com', phone: '12345678', company: 'Example Company' };
  const registered = await mutate(visitor, 'post', '/api/customer/register', { ...account, password: 'A long customer password!' });
  assert.equal(registered.status, 201);
  assert.deepEqual(registered.body.customer, account);
  assert.equal((await mutate(other, 'post', '/api/chat/start', { consent: true })).status, 401);
  assert.equal((await mutate(other, 'post', '/api/chat/messages', { message: 'Hello', requestId: crypto.randomUUID() })).status, 401);
  const start = await mutate(visitor, 'post', '/api/chat/start', { consent: true });
  assert.equal(start.status, 201);
  assert.deepEqual(start.body.customer, account);
  assert.equal(start.body.messages.length, 1);
  assert.equal(start.body.messages[0].role, 'assistant');
  assert.match(start.body.messages[0].content, /what would you like to know/i);
  assert.deepEqual((await visitor.get('/api/chat/current')).body.messages.map(({ role, content }) => ({ role, content })),
    start.body.messages.map(({ role, content }) => ({ role, content })));
  assert.equal(calls.length, 0);
  const conversationId = start.body.conversation.id;
  assert.equal((await other.get('/api/chat/current')).body.active, false);
  assert.equal((await other.get(`/api/admin/conversations/${conversationId}`)).status, 401);

  const login = await mutate(staff, 'post', '/api/admin/login', { email: 'staff@example.com', password: 'A long test password!' });
  assert.equal(login.status, 200);
  const created = await mutate(staff, 'post', '/api/admin/knowledge', { title: 'MC-4 catalogue', kind: 'company', content: 'The MC-4 is a parachute system.', sourceName: 'Product catalogue', status: 'draft' });
  assert.equal(created.status, 201);
  const id = created.body.id;
  const summary = await staff.get('/api/admin/knowledge').expect(200);
  assert.equal(summary.body.items[0].content, undefined);
  assert.equal((await staff.get(`/api/admin/knowledge/${id}`).expect(200)).body.item.content, 'The MC-4 is a parachute system.');

  const firstId = crypto.randomUUID();
  assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message: 'What is the MC-4?', requestId: firstId })).status, 200);
  assert.equal(calls.length, 0);
  assert.equal(pool.data.messages.at(-1).content, UNKNOWN);
  assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message: 'What is the MC-4?', requestId: firstId })).body.status, 'answered');
  assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message: 'A different question', requestId: firstId })).status, 409);
  assert.equal(pool.data.messages.length, 3);

  assert.equal((await mutate(staff, 'patch', `/api/admin/knowledge/${id}`, { status: 'published' })).status, 200);
  assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message: 'Explain the MC-4.', requestId: crypto.randomUUID() })).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sources[0].title, 'MC-4 catalogue');
  assert.doesNotMatch(JSON.stringify(calls[0]), /Visitor Name|visitor@example\.com|12345678|Example Company/);
  assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message: 'Hi', requestId: crypto.randomUUID() })).status, 200);
  assert.match(pool.data.messages.at(-1).content, /how can i help/i);
  assert.equal(calls.length, 1);
  assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message: 'Thank you', requestId: crypto.randomUUID() })).status, 200);
  assert.match(pool.data.messages.at(-1).content, /welcome/);
  assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message: 'Hi, what is the MC-4?', requestId: crypto.randomUUID() })).status, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].messages.map((entry) => entry.role), ['assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user']);
  assert.deepEqual(calls[1].messages.filter((entry) => entry.role === 'user').map((entry) => entry.content), ['What is the MC-4?', 'Explain the MC-4.', 'Hi', 'Thank you', 'Hi, what is the MC-4?']);

  assert.equal((await mutate(staff, 'patch', `/api/admin/knowledge/${id}`, { status: 'retired' })).status, 200);
  assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message: 'Tell me about the MC-4.', requestId: crypto.randomUUID() })).status, 200);
  assert.equal(calls.length, 2);
  assert.equal(pool.data.messages.at(-1).content, UNKNOWN);
  assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message: 'Can I have a quotation?', requestId: crypto.randomUUID() })).status, 200);
  assert.equal(pool.data.messages.at(-1).content, HANDOFF);

  const list = await staff.get('/api/admin/conversations').expect(200);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.conversations[0].hasQuotation, false);
  const detail = await staff.get(`/api/admin/conversations/${conversationId}`).expect(200);
  assert.equal(detail.body.conversation.email, 'visitor@example.com');
  assert.equal(detail.body.messages.length, 15);
  assert.equal((await mutate(staff, 'patch', `/api/admin/conversations/${conversationId}`, { status: 'in_progress' })).status, 200);
  assert.equal((await staff.get(`/api/admin/conversations/${conversationId}`).expect(200)).body.conversation.status, 'in_progress');
  assert.equal((await mutate(visitor, 'post', '/api/chat/close', {})).status, 200);
  assert.equal((await visitor.get('/api/chat/current')).body.active, false);
});

test('quotation journey snapshots account details and safely handles simultaneous retries', async () => {
  const pool = fakeDatabase(await argon2.hash('A long test password!', { type: argon2.argon2id }));
  const app = createApp({ pool, provider: { async answer() {} }, env: { NODE_ENV: 'test' } });
  const customer = request.agent(app);
  const other = request.agent(app);
  const staff = request.agent(app);
  const details = { name: 'Original Name', email: 'quote@example.com', phone: '12345678', company: 'Original Co', password: 'A long customer password!' };
  assert.equal((await request(app).post('/api/chat/quotation').send({})).status, 403);
  assert.equal((await mutate(other, 'post', '/api/chat/quotation', {})).status, 401);
  assert.equal((await mutate(customer, 'post', '/api/customer/register', details)).status, 201);
  const started = await mutate(customer, 'post', '/api/chat/start', { consent: true });
  assert.equal(started.status, 201);
  const conversationId = started.body.conversation.id;
  assert.equal((await mutate(other, 'post', '/api/customer/register', { ...details, email: 'other@example.com' })).status, 201);
  assert.equal((await mutate(other, 'post', '/api/chat/quotation', { conversationId, requestId: crypto.randomUUID() })).status, 401);
  const otherConversationId = (await mutate(other, 'post', '/api/chat/start', { consent: true })).body.conversation.id;
  assert.equal((await mutate(staff, 'post', '/api/admin/login', { email: 'staff@example.com', password: 'A long test password!' })).status, 200);
  const before = await staff.get('/api/admin/conversations').expect(200);
  assert.equal(before.body.conversations.find((entry) => entry.id === conversationId).hasQuotation, false);
  assert.equal(before.body.conversations.find((entry) => entry.id === otherConversationId).hasQuotation, false);

  const profile = { name: 'Updated Name', phone: '87654321', company: 'Updated Co' };
  assert.equal((await mutate(customer, 'post', '/api/customer/profile', profile)).status, 200);
  pool.data.conversations[0].updated_at = new Date('2020-01-01T00:00:00Z');
  pool.data.knowledge.push({ id: '1', status: 'published' });
  pool.data.catalogueProducts.push({ id: '1', company_id: 'jfd', slug: 'shadow', name: 'Shadow', status: 'published', knowledge_id: '1' });
  const payload = {
    conversationId, requestId: crypto.randomUUID(), companyId: 'jfd', productKey: 'shadow', productName: ' JFD Shadow ',
    quantity: 2, requiredBy: '2028-02-29', deliveryLocation: ' Johor ', procurementRoute: 'government',
    message: ' Please quote ', enquiryType: 'defence-diving', country: { stale: true },
    contact: { name: 'Injected', email: 'attacker@example.com' }
  };
  const results = await Promise.all([
    mutate(customer, 'post', '/api/chat/quotation', payload),
    mutate(customer, 'post', '/api/chat/quotation', { ...payload, requestId: payload.requestId.toUpperCase(), productName: 'JFD Shadow', message: 'Please quote' })
  ]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 201]);
  const created = results.find((response) => response.status === 201).body.quotation;
  const duplicate = results.find((response) => response.status === 200).body;
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.quotation, created);
  assert.equal(created.productUrl, '/jfd.html#shadow');
  assert.equal(created.productName, 'JFD Shadow');
  assert.equal(created.requiredBy, '2028-02-29');
  assert.equal(created.enquiryTypeLabel, 'Defence diving');
  assert.equal(created.country, '');
  assert.deepEqual(created.contact, { ...profile, email: details.email });
  assert.equal(pool.data.quotations.length, 1);
  assert.equal(pool.data.messages.filter((message) => message.content === CONFIRMATION).length, 1);
  assert.ok(pool.data.conversations[0].updated_at > new Date('2020-01-01T00:00:00Z'));

  assert.equal((await mutate(customer, 'post', '/api/customer/profile', { ...profile, name: 'Changed Again' })).status, 200);
  const retry = await mutate(customer, 'post', '/api/chat/quotation', payload);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body.quotation.contact, created.contact);
  assert.equal((await mutate(customer, 'post', '/api/chat/quotation', { ...payload, quantity: 3 })).status, 409);
  assert.equal(pool.data.messages.filter((message) => message.content === CONFIRMATION).length, 1);

  const zodiac = await mutate(customer, 'post', '/api/chat/quotation', {
    conversationId, requestId: crypto.randomUUID(), companyId: 'zodiac-nautic', productName: 'Open 6.5',
    country: 'France', city: 'Paris', postalCode: '75001', navigationArea: 'Coastal', region: 'Paris'
  });
  assert.equal(zodiac.status, 201);
  assert.equal(zodiac.body.quotation.procurementRoute, 'unsure');
  assert.equal(zodiac.body.quotation.region, 'Paris');
  const marked = await staff.get('/api/admin/conversations').expect(200);
  assert.equal(marked.body.conversations.find((entry) => entry.id === conversationId).hasQuotation, true);
  assert.equal(marked.body.conversations.find((entry) => entry.id === otherConversationId).hasQuotation, false);
  const detail = await staff.get(`/api/admin/conversations/${conversationId}`).expect(200);
  assert.deepEqual(detail.body.quotations.map((entry) => entry.id), [zodiac.body.quotation.id, created.id]);
  assert.deepEqual(detail.body.quotations[1], created);
  pool.data.messages = pool.data.messages.filter((message) => message.conversation_id !== conversationId);
  const retained = await staff.get('/api/admin/conversations').expect(200);
  assert.equal(retained.body.conversations.find((entry) => entry.id === conversationId).hasQuotation, true);
  assert.equal((await mutate(staff, 'delete', `/api/admin/conversations/${conversationId}`, {})).status, 200);
  assert.equal(pool.data.quotations.length, 0);
  const remaining = await staff.get('/api/admin/conversations').expect(200);
  assert.equal(remaining.body.conversations.length, 1);
  assert.equal(remaining.body.conversations[0].hasQuotation, false);
});

test('quotation requests use current published products and retain saved retries', async () => {
  const pool = fakeDatabase('unused');
  const app = createApp({ pool, provider: { async answer() {} }, env: { NODE_ENV: 'test' } });
  const customer = request.agent(app);
  await mutate(customer, 'post', '/api/customer/register', { name: 'User', email: 'catalogue@example.com', phone: '12345678', company: 'Company', password: 'A long customer password!' });
  const started = await mutate(customer, 'post', '/api/chat/start', { consent: true });
  const product = { id: '1', company_id: 'jfd', slug: 'shadow', name: 'Shadow', status: 'published', knowledge_id: '1' };
  const knowledge = { id: '1', status: 'published' };
  const payload = { conversationId: started.body.conversation.id, requestId: crypto.randomUUID(), companyId: 'jfd', productKey: 'shadow', productName: 'JFD Shadow', enquiryType: 'defence-diving', message: 'Please quote' };
  pool.data.catalogueProducts = [{ ...product }];
  pool.data.knowledge = [{ ...knowledge }];
  const saved = await mutate(customer, 'post', '/api/chat/quotation', payload);
  assert.equal(saved.status, 201);

  const cases = [
    { name: 'deleted', products: [], knowledge: [{ ...knowledge }] },
    { name: 'different manufacturer', products: [{ ...product, company_id: 'fxc' }], knowledge: [{ ...knowledge }] },
    { name: 'renamed', products: [{ ...product, name: 'Shadow New' }], knowledge: [{ ...knowledge }] },
    { name: 'case changed', products: [{ ...product, name: 'shadow' }], knowledge: [{ ...knowledge }] },
    { name: 'draft product', products: [{ ...product, status: 'draft' }], knowledge: [{ ...knowledge }] },
    { name: 'retired product', products: [{ ...product, status: 'retired' }], knowledge: [{ ...knowledge }] },
    { name: 'missing link', products: [{ ...product, knowledge_id: null }], knowledge: [{ ...knowledge }] },
    { name: 'missing knowledge', products: [{ ...product }], knowledge: [] },
    { name: 'unpublished knowledge', products: [{ ...product }], knowledge: [{ ...knowledge, status: 'draft' }] }
  ];
  for (const scenario of cases) {
    pool.data.catalogueProducts = scenario.products;
    pool.data.knowledge = scenario.knowledge;
    const before = pool.data.conversations[0].updated_at.getTime();
    const response = await mutate(customer, 'post', '/api/chat/quotation', { ...payload, requestId: crypto.randomUUID() });
    assert.equal(response.status, 409, scenario.name);
    assert.equal(response.body.code, 'PRODUCT_CHANGED', scenario.name);
    assert.equal(pool.data.quotations.length, 1, scenario.name);
    assert.equal(pool.data.messages.filter((entry) => entry.content === CONFIRMATION).length, 1, scenario.name);
    assert.equal(pool.data.conversations[0].updated_at.getTime(), before, scenario.name);
    const retry = await mutate(customer, 'post', '/api/chat/quotation', payload);
    assert.equal(retry.status, 200, scenario.name);
    assert.deepEqual(retry.body.quotation, saved.body.quotation, scenario.name);
  }

  pool.data.catalogueProducts = [{ ...product, name: 'Shadow New' }];
  pool.data.knowledge = [{ ...knowledge }];
  const renamed = await mutate(customer, 'post', '/api/chat/quotation', { ...payload, requestId: crypto.randomUUID(), productName: 'JFD Shadow New' });
  assert.equal(renamed.status, 201);
  pool.data.failCatalogueRead = true;
  assert.equal((await mutate(customer, 'post', '/api/chat/quotation', payload)).status, 200);
  assert.equal((await mutate(customer, 'post', '/api/chat/quotation', { ...payload, quantity: 2 })).status, 409);
  assert.equal((await mutate(customer, 'post', '/api/chat/quotation', { ...payload, requestId: crypto.randomUUID(), productKey: null, productName: 'JFD products' })).status, 201);
  assert.equal((await mutate(customer, 'post', '/api/chat/quotation', { conversationId: payload.conversationId, requestId: crypto.randomUUID(), productName: 'Other equipment' })).status, 201);
});

test('quotation requests remain attached to the chat shown to the customer', async () => {
  const pool = fakeDatabase('unused');
  const app = createApp({ pool, provider: { async answer() {} }, env: { NODE_ENV: 'test' } });
  const customer = request.agent(app);
  const other = request.agent(app);
  const profile = { name: 'User', phone: '12345678', company: 'Company', password: 'A long customer password!' };
  await mutate(customer, 'post', '/api/customer/register', { ...profile, email: 'user@example.com' });
  const original = await mutate(customer, 'post', '/api/chat/start', { consent: true });
  await mutate(other, 'post', '/api/customer/register', { ...profile, email: 'other@example.com' });
  const otherChat = await mutate(other, 'post', '/api/chat/start', { consent: true });
  const payload = { conversationId: original.body.conversation.id, requestId: crypto.randomUUID(), productName: 'General enquiry' };

  assert.equal((await mutate(customer, 'post', '/api/chat/quotation', { ...payload, conversationId: 'invalid' })).status, 400);
  assert.equal((await mutate(customer, 'post', '/api/chat/quotation', { ...payload, conversationId: otherChat.body.conversation.id })).status, 410);
  await mutate(customer, 'post', '/api/chat/close', {});
  const current = await mutate(customer, 'post', '/api/chat/start', { consent: true });
  assert.equal((await mutate(customer, 'post', '/api/chat/quotation', payload)).status, 410);
  assert.equal(pool.data.quotations.length, 0);

  const result = await mutate(customer, 'post', '/api/chat/quotation', { ...payload, conversationId: current.body.conversation.id.toUpperCase() });
  assert.equal(result.status, 201);
  assert.equal(pool.data.quotations[0].conversation_id, current.body.conversation.id);
  assert.equal(pool.data.messages.filter((message) => message.content === CONFIRMATION).length, 1);
});

test('quotation failures leave no partial data and admin survives a missing migration', async () => {
  const pool = fakeDatabase(await argon2.hash('A long test password!', { type: argon2.argon2id }));
  const app = createApp({ pool, provider: { async answer() {} }, env: { NODE_ENV: 'test' } });
  const customer = request.agent(app);
  const staff = request.agent(app);
  await mutate(customer, 'post', '/api/customer/register', { name: 'User', email: 'user@example.com', phone: '12345678', company: 'Company', password: 'A long customer password!' });
  const started = await mutate(customer, 'post', '/api/chat/start', { consent: true });
  const conversationId = started.body.conversation.id;
  const payload = { conversationId, requestId: crypto.randomUUID(), companyId: 'safe-at-sea', productName: 'RescueRunner', country: 'Malaysia', message: 'Please contact me.' };

  pool.data.accounts[0].phone = '';
  const incomplete = await mutate(customer, 'post', '/api/chat/quotation', payload);
  assert.equal(incomplete.status, 409);
  assert.equal(incomplete.body.code, 'PROFILE_INCOMPLETE');
  pool.data.accounts[0].phone = '12345678';
  pool.data.rateLimitExceeded = true;
  assert.equal((await mutate(customer, 'post', '/api/chat/quotation', payload)).status, 429);
  pool.data.rateLimitExceeded = false;
  pool.data.rejectQuotationLock = true;
  assert.equal((await mutate(customer, 'post', '/api/chat/quotation', payload)).status, 410);
  pool.data.rejectQuotationLock = false;

  pool.data.quotationTableMissing = true;
  const missing = await mutate(customer, 'post', '/api/chat/quotation', payload);
  assert.equal(missing.status, 503);
  assert.match(missing.body.error, /not available/i);
  await mutate(staff, 'post', '/api/admin/login', { email: 'staff@example.com', password: 'A long test password!' });
  const staffDetail = await staff.get(`/api/admin/conversations/${conversationId}`).expect(200);
  assert.deepEqual(staffDetail.body.quotations, []);
  const staffList = await staff.get('/api/admin/conversations').expect(200);
  assert.equal(staffList.body.conversations[0].hasQuotation, false);
  pool.data.quotationTableMissing = false;
  pool.data.failQuotationList = true;
  assert.equal((await staff.get('/api/admin/conversations')).status, 500);
  pool.data.failQuotationList = false;
  pool.data.failQuotationConfirmation = true;
  assert.equal((await mutate(customer, 'post', '/api/chat/quotation', payload)).status, 500);
  assert.equal(pool.data.quotations.length, 0);
  assert.equal(pool.data.messages.filter((message) => message.content === CONFIRMATION).length, 0);
  pool.data.failQuotationConfirmation = false;
  assert.equal((await mutate(customer, 'post', '/api/chat/quotation', payload)).status, 201);
  const createdAt = pool.data.conversations[0].created_at;
  pool.data.conversations[0].created_at = new Date(Date.now() - 30 * 86400000);
  assert.equal((await mutate(customer, 'post', '/api/chat/quotation', { ...payload, requestId: crypto.randomUUID() })).status, 401);
  pool.data.conversations[0].created_at = createdAt;
  await mutate(customer, 'post', '/api/chat/close', {});
  assert.equal((await mutate(customer, 'post', '/api/chat/quotation', { ...payload, requestId: crypto.randomUUID() })).status, 401);
});

test('misspelled greetings and small talk receive safe conversational replies', async () => {
  const pool = fakeDatabase('unused');
  const classified = [];
  const provider = {
    async answer() { throw new Error('No product answer should be generated without sources'); },
    async classifyConversation({ message }) {
      classified.push(message);
      if (message === 'Could we chat?') throw new Error('Simulated provider outage');
      return message === 'How are you doin?' ? 'SMALLTALK' : 'Invented factual answer';
    }
  };
  const app = createApp({ pool, provider, env: { NODE_ENV: 'test' } });
  const visitor = request.agent(app);
  const registered = await mutate(visitor, 'post', '/api/customer/register', {
    name: 'Visitor', email: 'visitor@example.com', phone: '12345678', company: 'Example', password: 'A long customer password!'
  });
  assert.equal(registered.status, 201);
  assert.equal((await mutate(visitor, 'post', '/api/chat/start', { consent: true })).status, 201);
  for (const message of ['helolo', 'helo!', 'hlelo']) {
    assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message, requestId: crypto.randomUUID() })).status, 200);
    assert.match(pool.data.messages.at(-1).content, /hello.*help/i);
  }
  assert.deepEqual(classified, []);
  assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message: 'How are you?', requestId: crypto.randomUUID() })).status, 200);
  assert.match(pool.data.messages.at(-1).content, /happy to help/i);
  assert.deepEqual(classified, []);
  assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message: 'How are you doin?', requestId: crypto.randomUUID() })).status, 200);
  assert.match(pool.data.messages.at(-1).content, /happy to help/i);
  assert.deepEqual(classified, ['How are you doin?']);
  assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message: 'What is foo?', requestId: crypto.randomUUID() })).status, 200);
  assert.equal(pool.data.messages.at(-1).content, UNKNOWN);
  assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message: 'Could we chat?', requestId: crypto.randomUUID() })).status, 200);
  assert.equal(pool.data.messages.at(-1).content, UNKNOWN);
  assert.equal((await mutate(visitor, 'post', '/api/chat/messages', { message: 'helolo, how much is it?', requestId: crypto.randomUUID() })).status, 200);
  assert.equal(pool.data.messages.at(-1).content, HANDOFF);
});

test('a database connection failure removes the extracted private PDF', async () => {
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sssb-upload-test-'));
  const secret = crypto.randomBytes(32).toString('base64url');
  let connections = 0;
  const pool = {
    async execute(sql, params) {
      if (sql.includes('FROM staff_sessions') && params[0] === digest(secret)) return [[{ staff_id: '1', email: 'staff@example.com' }]];
      if (sql.startsWith('UPDATE staff_sessions')) return [{ affectedRows: 1 }];
      throw new Error('Unexpected query');
    },
    async getConnection() {
      connections += 1;
      if (connections > 1) throw new Error('Database unavailable');
      return { async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}, async execute(sql) { return sql.startsWith('SELECT hits') ? [[{ hits: 0, expired: 0 }]] : [{ affectedRows: 1 }]; } };
    }
  };
  try {
    const app = createApp({ pool, provider: { async answer() {} }, env: { NODE_ENV: 'test', UPLOAD_DIR: uploadDir } });
    const csrf = await request(app).get('/api/csrf').expect(200);
    const result = await request(app).post('/api/admin/documents')
      .set('Cookie', `sss_staff=${secret}; sss_csrf=${csrf.body.csrfToken}`)
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .field('title', 'Sample brochure')
      .attach('file', path.join(__dirname, '..', 'public', 'assets', 'brochures', 'jfd-company-overview.pdf'));
    assert.equal(result.status, 500);
    assert.equal(connections, 2);
    assert.deepEqual(await fs.readdir(uploadDir), []);
  } finally {
    await fs.rm(uploadDir, { recursive: true, force: true });
  }
});
