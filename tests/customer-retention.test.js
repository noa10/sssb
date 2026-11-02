'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const argon2 = require('argon2');
const request = require('supertest');
const { createApp } = require('../server/app');
const { digest } = require('../server/security');
const { SESSION_MS } = require('../server/customer');
const { purgeExpiredMessages, RETENTION_DAYS } = require('../server/retention');
const { buildCatalogue } = require('../server/catalogue');
const catalogue = require('../public/assets/data/products.json');

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = 'A sufficiently long test password!';

// Only these SQL operations are simulated. Unknown statements fail rather than
// falling through to a real database. Transactions restore state on rollback.
function fakeDatabase() {
  const data = { accounts: [], sessions: [], staffSessions: [], conversations: [], links: [], messages: [], knowledge: [], catalogueMappings: [], knowledgeLinks: [] };
  let now = Date.parse('2026-04-01T12:00:00.000Z');
  const active = (conversation) => !conversation.visitor_closed_at && conversation.created_at > now - 30 * DAY;

  async function execute(sql, params = []) {
    const query = sql.replace(/\s+/g, ' ').trim();
    if (query.startsWith('INSERT INTO rate_limits') || query.startsWith('UPDATE rate_limits')) return [{ affectedRows: 1 }];
    if (query.startsWith('SELECT hits, window_start')) return [[{ hits: 0, expired: 0 }]];
    if (query.startsWith('SELECT s.staff_id, u.email FROM staff_sessions')) {
      const staff = data.staffSessions.find((entry) => entry.token_hash === params[0] && entry.expires_at > now && entry.last_seen_at > now - 30 * 60 * 1000 && !entry.disabled);
      return [staff ? [{ staff_id: staff.staff_id, email: staff.email }] : []];
    }
    if (query.startsWith('UPDATE staff_sessions SET last_seen_at=')) {
      const staff = data.staffSessions.find((entry) => entry.token_hash === params[0]);
      if (staff) staff.last_seen_at = now;
      return [{ affectedRows: Number(Boolean(staff)) }];
    }

    if (query.startsWith('INSERT INTO customer_accounts')) {
      if (data.accounts.some((account) => account.email === params[0])) {
        const error = new Error('duplicate email');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      const account = { id: data.accounts.length + 1, email: params[0], password_hash: params[1], disabled: 0 };
      data.accounts.push(account);
      return [{ insertId: account.id }];
    }
    if (query.startsWith('SELECT id,email,password_hash,disabled FROM customer_accounts')) {
      return [data.accounts.filter((account) => account.email === params[0])];
    }
    if (query.startsWith('SELECT id FROM customer_accounts')) {
      assert.match(query, /disabled=0 FOR UPDATE/);
      return [data.accounts.filter((account) => account.id === params[0] && !account.disabled).map(({ id }) => ({ id }))];
    }
    if (query.startsWith('INSERT INTO customer_sessions')) {
      assert.match(query, /DATE_ADD\(UTC_TIMESTAMP\(3\), INTERVAL 30 DAY\)/);
      data.sessions.push({ token_hash: params[0], customer_id: params[1], expires_at: now + 30 * DAY });
      return [{ affectedRows: 1 }];
    }
    if (query.startsWith('DELETE FROM customer_sessions')) {
      const oldLength = data.sessions.length;
      data.sessions = data.sessions.filter((session) => session.token_hash !== params[0]);
      return [{ affectedRows: oldLength - data.sessions.length }];
    }
    if (query.startsWith('SELECT u.id,u.email FROM customer_sessions')) {
      assert.match(query, /s\.token_hash=\? AND s\.expires_at>UTC_TIMESTAMP\(3\) AND u\.disabled=0/);
      const session = data.sessions.find((entry) => entry.token_hash === params[0] && entry.expires_at > now);
      const account = session && data.accounts.find((entry) => entry.id === session.customer_id && !entry.disabled);
      return [account ? [{ id: account.id, email: account.email }] : []];
    }
    if (query.startsWith('INSERT INTO conversations')) {
      assert.match(query, /DATE_ADD\(UTC_TIMESTAMP\(3\),\s*INTERVAL 30 DAY\)/);
      const [id, visitor_token_hash, name, email, phone, company, consent_version] = params;
      data.conversations.push({ id, visitor_token_hash, visitor_expires_at: now + 30 * DAY, name, email, phone, company, consent_version, visitor_closed_at: null, created_at: now, updated_at: now, status: 'new' });
      return [{ affectedRows: 1 }];
    }
    if (query.startsWith('SELECT id FROM conversations WHERE id=')) {
      assert.match(query, /visitor_closed_at IS NULL/);
      assert.match(query, /created_at>DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 30 DAY\)/);
      return [data.conversations.filter((entry) => entry.id === params[0] && active(entry)).map(({ id }) => ({ id }))];
    }
    if (query.startsWith('SELECT *, created_at<=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY) AS messages_expired FROM conversations WHERE id=')) {
      return [data.conversations.filter((entry) => entry.id === params[0]).map((entry) => ({ ...entry, messages_expired: Number(entry.created_at <= now - 30 * DAY) }))];
    }
    if (query.startsWith('SELECT * FROM conversations WHERE visitor_token_hash=')) {
      assert.match(query, /visitor_closed_at IS NULL/);
      assert.match(query, /created_at>DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 30 DAY\)/);
      assert.match(query, /NOT EXISTS \(SELECT 1 FROM customer_conversations cc WHERE cc\.conversation_id=conversations\.id\)/);
      const conversation = data.conversations.find((entry) => entry.visitor_token_hash === params[0] && active(entry) && !data.links.some((link) => link.conversation_id === entry.id));
      return [conversation ? [conversation] : []];
    }
    if (query.startsWith('SELECT c.* FROM customer_conversations')) {
      assert.match(query, /cc\.customer_id=\? AND c\.visitor_closed_at IS NULL/);
      assert.match(query, /c\.created_at>DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 30 DAY\)/);
      const owned = data.links.filter((link) => link.customer_id === params[0]).map((link) => link.conversation_id);
      const rows = data.conversations.filter((entry) => owned.includes(entry.id) && active(entry)).sort((a, b) => b.created_at - a.created_at);
      return [rows.slice(0, 1)];
    }
    if (query.startsWith('INSERT INTO customer_conversations')) {
      if (data.links.some((link) => link.conversation_id === params[0])) throw new Error('duplicate conversation link');
      data.links.push({ conversation_id: params[0], customer_id: params[1] });
      return [{ affectedRows: 1 }];
    }
    if (query.startsWith('UPDATE conversations SET visitor_closed_at=')) {
      const conversation = data.conversations.find((entry) => entry.id === params[0]);
      if (conversation) conversation.visitor_closed_at = now;
      return [{ affectedRows: Number(Boolean(conversation)) }];
    }
    if (query.startsWith("UPDATE messages SET status='failed' WHERE conversation_id=")) return [{ affectedRows: 0 }];
    if (query.startsWith('SELECT status,content FROM messages WHERE conversation_id=')) {
      return [data.messages.filter((message) => message.conversation_id === params[0] && message.request_id === params[1])];
    }
    if (query.startsWith("SELECT id FROM messages WHERE conversation_id=? AND status='pending'")) {
      return [data.messages.filter((message) => message.conversation_id === params[0] && message.status === 'pending')];
    }
    if (query.startsWith("SELECT COUNT(*) AS total FROM messages WHERE conversation_id=? AND role='user'")) {
      return [[{ total: data.messages.filter((message) => message.conversation_id === params[0] && message.role === 'user').length }]];
    }
    if (query.startsWith("INSERT INTO messages (conversation_id,request_id,role,content,status)")) {
      const [conversation_id, request_id, content] = params;
      const message = { id: data.messages.length + 1, conversation_id, request_id, role: 'user', content, status: 'pending', created_at: now };
      data.messages.push(message);
      return [{ insertId: message.id }];
    }
    if (query.startsWith("INSERT INTO messages (conversation_id,role,content,status)")) {
      const [conversation_id, content] = params;
      const message = { id: data.messages.length + 1, conversation_id, role: 'assistant', content, status: 'answered', created_at: now };
      data.messages.push(message);
      return [{ insertId: message.id }];
    }
    if (query.startsWith("UPDATE messages SET status='answered' WHERE id=") || query.startsWith("UPDATE messages SET status='failed' WHERE id=")) {
      const message = data.messages.find((entry) => entry.id === params[0] && entry.status === 'pending');
      if (message) message.status = query.includes("SET status='answered'") ? 'answered' : 'failed';
      return [{ affectedRows: Number(Boolean(message)) }];
    }
    if (query.startsWith('UPDATE conversations SET updated_at=')) {
      const conversation = data.conversations.find((entry) => entry.id === params[0]);
      if (conversation) conversation.updated_at = now;
      return [{ affectedRows: Number(Boolean(conversation)) }];
    }
    if (query.startsWith('SELECT role,content FROM (')) {
      assert.match(query, /c\.created_at>DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 30 DAY\)/);
      const conversation = data.conversations.find((entry) => entry.id === params[0] && active(entry));
      return [conversation ? data.messages.filter((message) => message.conversation_id === conversation.id && (message.status === 'answered' || message.id === params[1])).slice(-10) : []];
    }
    if (query.startsWith('SELECT k.id,k.title,k.source_name,c.content FROM knowledge_chunks')) {
      assert.match(query, /k\.status='published'/);
      return [data.knowledge];
    }
    if (query.startsWith('SELECT k.content FROM knowledge_items k WHERE')) {
      assert.match(query, /k\.status='published'/);
      return [data.knowledgeLinks.filter((entry) => entry.status === 'published' && params.some((url) => entry.content.includes(url)))];
    }
    if (query.startsWith('SELECT i.source_key,i.source_hash,k.content FROM knowledge_catalogue_imports i')) {
      assert.match(query, /k\.status='published' AND k\.kind='product'/);
      return [data.catalogueMappings.filter((entry) => entry.status === 'published' && entry.kind === 'product')];
    }
    if (query.startsWith('SELECT m.id,m.role,m.content,m.status,m.created_at FROM messages m')) {
      assert.match(query, /c\.created_at>DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 30 DAY\)/);
      const conversation = data.conversations.find((entry) => entry.id === params[0] && entry.created_at > now - 30 * DAY);
      return [conversation ? data.messages.filter((message) => message.conversation_id === conversation.id) : []];
    }
    if (query.startsWith('DELETE m FROM messages m JOIN conversations c')) {
      assert.match(query, /c\.id=m\.conversation_id/);
      assert.match(query, /c\.created_at<=DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 30 DAY\)/);
      const expired = new Set(data.conversations.filter((entry) => entry.created_at <= now - 30 * DAY).map((entry) => entry.id));
      const oldLength = data.messages.length;
      data.messages = data.messages.filter((message) => !expired.has(message.conversation_id));
      return [{ affectedRows: oldLength - data.messages.length }];
    }
    throw new Error(`Unexpected simulated query: ${query}`);
  }

  return {
    data,
    execute,
    get now() { return now; },
    set now(value) { now = value; },
    async getConnection() {
      let snapshot;
      return {
        execute,
        async beginTransaction() { snapshot = structuredClone(data); },
        async commit() { snapshot = undefined; },
        async rollback() { if (snapshot) Object.assign(data, snapshot); },
        release() {}
      };
    },
    staff() {
      const secret = crypto.randomBytes(32).toString('base64url');
      data.staffSessions.push({ token_hash: digest(secret), staff_id: 1, email: 'staff@example.com', disabled: 0, last_seen_at: now, expires_at: now + 8 * 60 * 60 * 1000 });
      return secret;
    },
    guest(email, createdAt = now) {
      const secret = crypto.randomBytes(32).toString('base64url');
      const row = {
        id: crypto.randomUUID(), visitor_token_hash: digest(secret), visitor_closed_at: null,
        created_at: createdAt, name: 'Example', email, phone: '12345678', company: 'Example Co'
      };
      data.conversations.push(row);
      return { secret, row };
    }
  };
}

function setup(provider = { async answer() { throw new Error('Provider must not be called by these tests'); } }) {
  const pool = fakeDatabase();
  const app = createApp({ pool, provider, env: { NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000' } });
  return { pool, app };
}

// A small cookie jar keeps each simulated browser independent and can replay a
// saved token after logout or hand a guest token to a different browser.
function browser(app, initialCookies = {}) {
  const jar = new Map(Object.entries(initialCookies));
  async function send(method, url, body) {
    let call = request(app)[method](url);
    if (jar.size) call = call.set('Cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
    if (method !== 'get') call = call.set('X-CSRF-Token', jar.get('sss_csrf') || '');
    if (body !== undefined) call = call.send(body);
    const response = await call;
    for (const header of response.headers['set-cookie'] || []) {
      const [pair] = header.split(';');
      const at = pair.indexOf('=');
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    return response;
  }
  return {
    jar,
    get: (url) => send('get', url),
    async post(url, body = {}) {
      await send('get', '/api/csrf');
      return send('post', url, body);
    }
  };
}

test('registration validates input, hashes passwords and creates a 30-day session', async () => {
  const { pool, app } = setup();
  const device = browser(app);
  assert.equal((await request(app).post('/api/customer/register').send({ email: 'alice@example.com', password: PASSWORD })).status, 403);
  assert.equal((await device.post('/api/customer/register', { email: 'invalid', password: PASSWORD })).status, 400);
  assert.equal((await device.post('/api/customer/register', { email: 'alice@example.com', password: 'short' })).status, 400);
  assert.equal(pool.data.accounts.length, 0);

  const registered = await device.post('/api/customer/register', { email: ' Alice@Example.COM ', password: PASSWORD });
  assert.equal(registered.status, 201);
  assert.deepEqual(registered.body, { authenticated: true, customer: { email: 'alice@example.com' }, linked: false });
  assert.doesNotMatch(JSON.stringify(registered.body), /password|hash/i);
  const account = pool.data.accounts[0];
  assert.match(account.password_hash, /^\$argon2id\$/);
  assert.notEqual(account.password_hash, PASSWORD);
  assert.equal(await argon2.verify(account.password_hash, PASSWORD), true);
  const secret = device.jar.get('sss_customer');
  assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(pool.data.sessions[0], { token_hash: digest(secret), customer_id: account.id, expires_at: pool.now + 30 * DAY });
  assert.equal(SESSION_MS, 30 * DAY);
  const cookie = registered.headers['set-cookie'].find((header) => header.startsWith('sss_customer='));
  assert.match(cookie, /Max-Age=2592000/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.deepEqual((await device.get('/api/customer/session')).body, { authenticated: true, customer: { email: 'alice@example.com' } });

  const duplicate = await browser(app).post('/api/customer/register', { email: 'ALICE@example.com', password: PASSWORD });
  assert.equal(duplicate.status, 409);
  assert.equal(pool.data.accounts.length, 1);
  assert.equal(pool.data.sessions.length, 1);
});

test('returning guest cookies are renewed only for the remaining conversation lifetime', async () => {
  const { pool, app } = setup();
  pool.now = Date.now();
  const guest = pool.guest('guest@example.com', pool.now - 6 * DAY);
  const device = browser(app, { sss_visitor: guest.secret });
  const response = await device.get('/api/chat/current');
  assert.equal(response.body.conversation.id, guest.row.id);
  const cookie = response.headers['set-cookie'].find((header) => header.startsWith('sss_visitor='));
  assert.ok(cookie);
  assert.equal(device.jar.get('sss_visitor'), guest.secret);
  const seconds = Number(/Max-Age=(\d+)/.exec(cookie)[1]);
  assert.ok(seconds <= 24 * DAY / 1000 && seconds > 24 * DAY / 1000 - 10);
  pool.now += 24 * DAY;
  assert.equal((await device.get('/api/chat/current')).body.active, false);
});

test('guest ownership transfers on registration and survives login on another device', async () => {
  const { pool, app } = setup();
  const guest = pool.guest(' Alice@Example.com ');
  pool.data.messages.push({ id: 1, conversation_id: guest.row.id, role: 'user', content: 'Saved example', status: 'answered', created_at: pool.now });
  pool.data.messages.push({ id: 2, conversation_id: guest.row.id, role: 'assistant', content: 'The FXC MC-4 is a parachute system. https://www.fxcguardian.com/product/mc-4-parachute-system/', status: 'answered', created_at: pool.now });
  const product = buildCatalogue(catalogue).find((entry) => entry.key === 'product:fxc/mc4');
  pool.data.catalogueMappings.push({ source_key: product.key, source_hash: product.hash, content: product.content, kind: 'product', status: 'published' });
  pool.data.knowledgeLinks.push({ content: product.content, status: 'published' });
  const first = browser(app, { sss_visitor: guest.secret });
  const stranger = browser(app);
  assert.equal((await stranger.get('/api/chat/current')).body.active, false);
  assert.equal((await browser(app, { sss_visitor: crypto.randomBytes(32).toString('base64url') }).get('/api/chat/current')).body.active, false);
  assert.equal((await stranger.post('/api/chat/close')).status, 200);
  assert.equal((await first.get('/api/chat/current')).body.conversation.id, guest.row.id);

  const registration = await first.post('/api/customer/register', { email: 'alice@example.com', password: PASSWORD });
  assert.equal(registration.status, 201);
  assert.equal(registration.body.linked, true);
  assert.equal(first.jar.has('sss_visitor'), false);
  assert.deepEqual(pool.data.links, [{ conversation_id: guest.row.id, customer_id: pool.data.accounts[0].id }]);
  assert.equal((await browser(app, { sss_visitor: guest.secret }).get('/api/chat/current')).body.active, false);
  const current = await first.get('/api/chat/current');
  assert.equal(current.body.conversation.id, guest.row.id);
  assert.equal(current.body.messages[0].content, 'Saved example');
  assert.equal(current.body.messages[1].products[0].url, '/fxc.html#mc4');

  const second = browser(app);
  assert.equal((await second.post('/api/customer/login', { email: 'ALICE@example.com', password: 'wrong password' })).status, 401);
  const login = await second.post('/api/customer/login', { email: ' ALICE@example.com ', password: PASSWORD });
  assert.equal(login.status, 200);
  assert.equal(login.body.linked, false);
  assert.notEqual(first.jar.get('sss_customer'), second.jar.get('sss_customer'));
  const secondCurrent = await second.get('/api/chat/current');
  assert.equal(secondCurrent.body.conversation.id, guest.row.id);
  assert.deepEqual(secondCurrent.body.messages[1].products, current.body.messages[1].products);
  assert.deepEqual(secondCurrent.body.messages[1].approvedLinks, ['https://www.fxcguardian.com/product/mc-4-parachute-system/']);
  pool.data.catalogueMappings[0].status = 'retired';
  pool.data.knowledgeLinks[0].status = 'retired';
  const retired = (await second.get('/api/chat/current')).body.messages[1];
  assert.equal(retired.products, undefined);
  assert.equal(retired.approvedLinks, undefined);
  assert.equal((await stranger.get('/api/chat/current')).body.active, false);

  // A different signed-in customer cannot claim or read the linked chat,
  // even when they present its former guest token.
  const unrelated = browser(app, { sss_visitor: guest.secret });
  const unrelatedRegistration = await unrelated.post('/api/customer/register', { email: 'other@example.com', password: PASSWORD });
  assert.equal(unrelatedRegistration.status, 201);
  assert.equal(unrelatedRegistration.body.linked, false);
  assert.equal((await unrelated.get('/api/chat/current')).body.active, false);
  assert.equal((await unrelated.post('/api/chat/close')).status, 200);
  assert.equal((await first.get('/api/chat/current')).body.conversation.id, guest.row.id);

  const originalToken = first.jar.get('sss_customer');
  assert.equal((await first.post('/api/customer/login', { email: 'alice@example.com', password: PASSWORD })).status, 200);
  assert.notEqual(first.jar.get('sss_customer'), originalToken);
  assert.equal((await browser(app, { sss_customer: originalToken }).get('/api/customer/session')).body.authenticated, false);
  const logoutToken = first.jar.get('sss_customer');
  assert.equal((await first.post('/api/customer/logout')).status, 200);
  assert.equal(first.jar.has('sss_customer'), false);
  assert.equal((await browser(app, { sss_customer: logoutToken }).get('/api/customer/session')).body.authenticated, false);
  assert.equal((await first.get('/api/chat/current')).body.active, false);
  assert.equal((await second.get('/api/chat/current')).body.conversation.id, guest.row.id);
  assert.equal((await second.post('/api/chat/close')).status, 200);
  assert.equal((await second.get('/api/chat/current')).body.active, false);
  assert.equal((await first.post('/api/customer/login', { email: 'alice@example.com', password: PASSWORD })).status, 200);
  assert.equal((await first.get('/api/chat/current')).body.active, false);
});

test('conflicting guest links roll back registration or login without stealing a chat', async () => {
  const { pool, app } = setup();
  const existingGuest = pool.guest('guest@example.com');
  const visitor = browser(app, { sss_visitor: existingGuest.secret });
  const rejected = await visitor.post('/api/customer/register', { email: 'other@example.com', password: PASSWORD });
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /different email/i);
  assert.equal(pool.data.accounts.length, 0);
  assert.equal(pool.data.sessions.length, 0);
  assert.equal(pool.data.links.length, 0);
  assert.equal((await visitor.get('/api/chat/current')).body.conversation.id, existingGuest.row.id);

  assert.equal((await visitor.post('/api/customer/register', { email: 'guest@example.com', password: PASSWORD })).status, 201);
  const anotherGuest = pool.guest('guest@example.com');
  const otherDevice = browser(app, { sss_visitor: anotherGuest.secret });
  const conflict = await otherDevice.post('/api/customer/login', { email: 'guest@example.com', password: PASSWORD });
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /already has an active chat/i);
  assert.equal(pool.data.links.length, 1);
  assert.equal(pool.data.sessions.length, 1);
  assert.equal((await otherDevice.get('/api/chat/current')).body.conversation.id, anotherGuest.row.id);
  assert.equal((await visitor.get('/api/chat/current')).body.conversation.id, existingGuest.row.id);
});

test('disabled accounts cannot log in or use an existing session', async () => {
  const { pool, app } = setup();
  const device = browser(app);
  assert.equal((await device.post('/api/customer/register', { email: 'disabled@example.com', password: PASSWORD })).status, 201);
  pool.data.accounts[0].disabled = 1;
  assert.equal((await device.get('/api/customer/session')).body.authenticated, false);
  assert.equal((await browser(app).post('/api/customer/login', { email: 'disabled@example.com', password: PASSWORD })).status, 401);
});

test('customer sessions and both guest and linked chats expire at 30 days', async () => {
  const { pool, app } = setup();
  const linkedGuest = pool.guest('alice@example.com');
  const unlinkedGuest = pool.guest('guest@example.com');
  const customer = browser(app, { sss_visitor: linkedGuest.secret });
  const guest = browser(app, { sss_visitor: unlinkedGuest.secret });
  assert.equal((await customer.post('/api/customer/register', { email: 'alice@example.com', password: PASSWORD })).status, 201);

  pool.now += 30 * DAY - 1;
  assert.equal((await customer.get('/api/customer/session')).body.authenticated, true);
  assert.equal((await customer.get('/api/chat/current')).body.conversation.id, linkedGuest.row.id);
  assert.equal((await guest.get('/api/chat/current')).body.conversation.id, unlinkedGuest.row.id);
  pool.now += 1;
  assert.equal((await customer.get('/api/customer/session')).body.authenticated, false);
  assert.equal((await guest.get('/api/chat/current')).body.active, false);
  assert.equal((await customer.post('/api/customer/login', { email: 'alice@example.com', password: PASSWORD })).status, 200);
  assert.equal((await customer.get('/api/chat/current')).body.active, false);
});

test('a failed welcome message rolls back a new guest conversation', async () => {
  const { pool, app } = setup();
  const connect = pool.getConnection.bind(pool);
  pool.getConnection = async () => {
    const conn = await connect();
    const execute = conn.execute;
    conn.execute = async (sql, params) => {
      if (sql.startsWith('INSERT INTO messages (conversation_id,role,content,status)')) throw new Error('Simulated welcome failure');
      return execute(sql, params);
    };
    return conn;
  };
  const device = browser(app);
  const response = await device.post('/api/chat/start', { name: 'Visitor', email: 'visitor@example.com', phone: '12345678', company: 'Example Co', consent: true });
  assert.equal(response.status, 500);
  assert.equal(pool.data.conversations.length, 0);
  assert.equal(pool.data.messages.length, 0);
  assert.equal(device.jar.has('sss_visitor'), false);
});

test('an account creates one owned chat and cannot start another on a second device', async () => {
  const { pool, app } = setup();
  const first = browser(app);
  const second = browser(app);
  assert.equal((await first.post('/api/customer/register', { email: 'owner@example.com', password: PASSWORD })).status, 201);
  assert.equal((await second.post('/api/customer/login', { email: 'owner@example.com', password: PASSWORD })).status, 200);
  const details = { name: 'Example Owner', email: 'OWNER@example.com', phone: '12345678', company: 'Example Co', consent: true };
  assert.equal((await first.post('/api/chat/start', { ...details, email: 'someone-else@example.com' })).status, 400);
  assert.equal(pool.data.conversations.length, 0);

  const started = await first.post('/api/chat/start', details);
  assert.equal(started.status, 201);
  assert.equal(started.body.messages[0].role, 'assistant');
  assert.match(started.body.messages[0].content, /what would you like to know/i);
  assert.equal(first.jar.has('sss_visitor'), false);
  assert.equal(pool.data.conversations.length, 1);
  assert.deepEqual(pool.data.links, [{ conversation_id: started.body.conversation.id, customer_id: pool.data.accounts[0].id }]);
  const resumed = await second.get('/api/chat/current');
  assert.equal(resumed.body.conversation.id, started.body.conversation.id);
  assert.equal(resumed.body.messages[0].content, started.body.messages[0].content);
  assert.equal((await second.post('/api/chat/start', details)).status, 409);
  assert.equal(pool.data.conversations.length, 1);
  assert.equal(pool.data.links.length, 1);

  assert.equal((await first.post('/api/chat/close')).status, 200);
  const replacement = await second.post('/api/chat/start', details);
  assert.equal(replacement.status, 201);
  assert.notEqual(replacement.body.conversation.id, started.body.conversation.id);
  assert.equal((await first.get('/api/chat/current')).body.conversation.id, replacement.body.conversation.id);
  assert.equal(pool.data.conversations.length, 2);
  assert.equal(pool.data.links.length, 2);
});

test('staff detail hides expired messages but keeps contact information', async () => {
  const { pool, app } = setup();
  const expired = pool.guest('expired@example.com', pool.now - 30 * DAY);
  const recent = pool.guest('recent@example.com', pool.now - 30 * DAY + 1);
  Object.assign(expired.row, { name: 'Example Contact', phone: '0123456789', company: 'Example Company', status: 'in_progress' });
  pool.data.messages.push(
    { id: 1, conversation_id: expired.row.id, role: 'user', content: 'Expired private message', status: 'answered', created_at: pool.now },
    { id: 2, conversation_id: recent.row.id, role: 'user', content: 'Retained private message', status: 'answered', created_at: pool.now }
  );
  assert.equal((await browser(app).get(`/api/admin/conversations/${expired.row.id}`)).status, 401);
  const staff = browser(app, { sss_staff: pool.staff() });
  const detail = await staff.get(`/api/admin/conversations/${expired.row.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.conversation.messagesExpired, true);
  assert.deepEqual(detail.body.messages, []);
  assert.equal(detail.body.conversation.id, expired.row.id);
  assert.equal(detail.body.conversation.name, 'Example Contact');
  assert.equal(detail.body.conversation.email, 'expired@example.com');
  assert.equal(detail.body.conversation.phone, '0123456789');
  assert.equal(detail.body.conversation.company, 'Example Company');
  assert.equal(detail.body.conversation.status, 'in_progress');
  assert.equal(pool.data.messages.length, 2); // Read-time protection applies before cleanup runs.

  const retained = await staff.get(`/api/admin/conversations/${recent.row.id}`);
  assert.equal(retained.status, 200);
  assert.equal(retained.body.conversation.messagesExpired, false);
  assert.deepEqual(retained.body.messages.map((message) => message.content), ['Retained private message']);
});

test('an in-memory provider response finishing at the cutoff is not stored', async () => {
  let releaseProvider;
  let signalEntered;
  const entered = new Promise((resolve) => { signalEntered = resolve; });
  const waitForRelease = new Promise((resolve) => { releaseProvider = resolve; });
  const calls = [];
  const provider = { async answer(input) { calls.push(input); signalEntered(); await waitForRelease; return 'A simulated approved answer.'; } };
  const { pool, app } = setup(provider);
  const guest = pool.guest('visitor@example.com', pool.now - 30 * DAY + 1000);
  pool.data.knowledge.push({ id: 1, title: 'Sample equipment', source_name: 'Fixture', content: 'Sample equipment description.' });
  const device = browser(app, { sss_visitor: guest.secret });
  const inFlight = device.post('/api/chat/messages', { message: 'Describe sample equipment', requestId: crypto.randomUUID() });
  let timer;
  try {
    const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('The simulated provider was not called')), 5000); });
    await Promise.race([entered, timeout]);
    clearTimeout(timer);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].messages.at(-1).content, 'Describe sample equipment');
    assert.equal(calls[0].sources[0].title, 'Sample equipment');
    assert.deepEqual(pool.data.messages.map((message) => [message.role, message.status]), [['user', 'pending']]);

    pool.now += 1000;
    releaseProvider();
    const response = await inFlight;
    assert.equal(response.status, 410);
    assert.match(response.body.error, /expired|ended/i);
    assert.deepEqual(pool.data.messages.map((message) => [message.role, message.status]), [['user', 'failed']]);
    assert.equal(pool.data.messages.some((message) => message.content === 'A simulated approved answer.'), false);
    assert.equal((await device.get('/api/chat/current')).body.active, false);
  } finally {
    clearTimeout(timer);
    releaseProvider();
    await inFlight.catch(() => {});
  }
});

test('retention removes messages at the 30-day conversation boundary and keeps enquiry records', async () => {
  const { pool } = setup();
  assert.equal(RETENTION_DAYS, 30);
  const expired = pool.guest('expired@example.com', pool.now - 31 * DAY);
  const boundary = pool.guest('boundary@example.com', pool.now - 30 * DAY);
  const recent = pool.guest('recent@example.com', pool.now - 30 * DAY + 1);
  pool.data.messages.push(
    { id: 1, conversation_id: expired.row.id, content: 'old' },
    { id: 2, conversation_id: boundary.row.id, content: 'recent message in an old conversation', created_at: pool.now },
    { id: 3, conversation_id: recent.row.id, content: 'still retained' }
  );
  assert.equal(await purgeExpiredMessages(pool), 2);
  assert.deepEqual(pool.data.messages.map((message) => message.id), [3]);
  assert.deepEqual(pool.data.conversations.map((conversation) => conversation.id), [expired.row.id, boundary.row.id, recent.row.id]);
  assert.equal(await purgeExpiredMessages(pool), 0);
});
