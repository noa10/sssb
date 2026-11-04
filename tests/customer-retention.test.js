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
const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = 'A sufficiently long test password!';
const PROFILE = { name: 'Alice Example', phone: '12345678', company: 'Example Sdn Bhd' };
const REGISTERED = { email: 'alice@example.com', ...PROFILE };

function register(agent, body) {
  return agent.post('/api/customer/register', { ...PROFILE, password: PASSWORD, ...body });
}

function guestMetadata(row) {
  return { id: row.id, name: row.name, email: row.email, phone: row.phone, company: row.company, createdAt: row.created_at };
}

// Only these SQL operations are simulated. Unknown statements fail rather than
// falling through to a real database. Transactions restore state on rollback.
function fakeDatabase() {
  const data = { accounts: [], sessions: [], staffSessions: [], conversations: [], links: [], messages: [], quotations: [], knowledge: [], catalogueProducts: [], knowledgeLinks: [] };
  const accountLocks = [];
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
      const account = { id: data.accounts.length + 1, email: params[0], password_hash: params[1], name: params[2], phone: params[3], company: params[4], disabled: 0 };
      data.accounts.push(account);
      return [{ insertId: account.id }];
    }
    if (query.startsWith('SELECT id,email,name,phone,company,password_hash,disabled FROM customer_accounts')) {
      return [data.accounts.filter((account) => account.email === params[0])];
    }
    if (query.startsWith('UPDATE customer_accounts SET name=?,phone=?,company=? WHERE id=?')) {
      const account = data.accounts.find((entry) => entry.id === params[3]);
      if (account) Object.assign(account, { name: params[0], phone: params[1], company: params[2] });
      return [{ affectedRows: Number(Boolean(account)) }];
    }
    if (query === 'SELECT id,email,name,phone,company FROM customer_accounts WHERE id=? AND disabled=0 FOR UPDATE') {
      accountLocks.push({ type: 'profile', id: params[0] });
      return [data.accounts.filter((account) => account.id === params[0] && !account.disabled)
        .map(({ id, email, name, phone, company }) => ({ id, email, name, phone, company }))];
    }
    if (query.startsWith('SELECT id FROM customer_accounts')) {
      assert.match(query, /disabled=0 FOR UPDATE/);
      accountLocks.push({ type: 'login', id: params[0] });
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
    if (query.startsWith('SELECT u.id,u.email,u.name,u.phone,u.company FROM customer_sessions')) {
      assert.match(query, /s\.token_hash=\? AND s\.expires_at>UTC_TIMESTAMP\(3\) AND u\.disabled=0/);
      const session = data.sessions.find((entry) => entry.token_hash === params[0] && entry.expires_at > now);
      const account = session && data.accounts.find((entry) => entry.id === session.customer_id && !entry.disabled);
      return [account ? [{ id: account.id, email: account.email, name: account.name, phone: account.phone, company: account.company }] : []];
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
    if (query.startsWith('SELECT c.id,c.status,c.created_at,c.visitor_closed_at,c.name')) {
      const link = data.links.find((entry) => entry.customer_id === params[0] && entry.conversation_id === params[1]);
      return [link ? data.conversations.filter((entry) => entry.id === params[1]).map((entry) => ({
        ...entry,
        messages_expired: Number(entry.created_at <= now - 30 * DAY)
      })) : []];
    }
    if (query.startsWith('SELECT c.id,c.status,c.created_at,c.visitor_closed_at,')) {
      assert.match(query, /c\.created_at>DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 30 DAY\)/);
      const owned = data.links.filter((link) => link.customer_id === params[0]).map((link) => link.conversation_id);
      const rows = data.conversations.filter((entry) => owned.includes(entry.id))
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 20)
        .map((entry) => {
          const expired = entry.created_at <= now - 30 * DAY;
          const messages = expired ? [] : data.messages
            .filter((message) => message.conversation_id === entry.id)
            .sort((a, b) => Number(a.id) - Number(b.id));
          const last = messages[messages.length - 1];
          return {
            ...entry,
            message_count: data.messages.filter((message) => message.conversation_id === entry.id).length,
            last_message: last ? last.content : null,
            last_role: last ? last.role : null,
            messages_expired: Number(expired)
          };
        });
      return [rows];
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
      return [conversation ? data.messages.filter((message) => message.conversation_id === conversation.id && (message.status === 'answered' || message.id === params[1])).slice(-40) : []];
    }
    if (query.startsWith('SELECT k.id,k.title,k.source_name,c.content FROM knowledge_chunks')) {
      assert.match(query, /k\.status='published'/);
      return [data.knowledge];
    }
    if (query.startsWith('SELECT k.content FROM knowledge_items k WHERE')) {
      assert.match(query, /k\.status='published'/);
      return [data.knowledgeLinks.filter((entry) => entry.status === 'published' && params.some((url) => entry.content.includes(url)))];
    }
    if (query.startsWith('SELECT p.company_id,p.slug,p.name,p.product_type,p.image_name,p.image_source,p.manufacturer_source')) {
      assert.match(query, /FROM catalogue_products p JOIN knowledge_items k ON k\.id=p\.knowledge_id/);
      assert.match(query, /p\.status='published' AND k\.status='published'/);
      return [data.catalogueProducts.filter((entry) => entry.status === 'published')];
    }
    if (query.startsWith('SELECT m.id,m.role,m.content,m.status,m.created_at FROM messages m')) {
      assert.match(query, /c\.created_at>DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 30 DAY\)/);
      const conversation = data.conversations.find((entry) => entry.id === params[0] && entry.created_at > now - 30 * DAY);
      return [conversation ? data.messages.filter((message) => message.conversation_id === conversation.id) : []];
    }
    if (query.startsWith('SELECT * FROM quotation_requests WHERE conversation_id=')) {
      assert.match(query, /ORDER BY created_at DESC,id DESC/);
      assert.doesNotMatch(query, /DATE_SUB/);
      return [data.quotations.filter((entry) => entry.conversation_id === params[0]).slice().reverse()];
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
    accountLocks,
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
  assert.equal((await request(app).post('/api/customer/register').send(REGISTERED)).status, 403);
  assert.equal((await register(device, { email: 'invalid' })).status, 400);
  assert.equal((await register(device, { email: 'alice@example.com', password: 'short' })).status, 400);
  assert.equal((await register(device, { email: 'missing@example.com', name: '   ' })).status, 400);
  assert.equal((await register(device, { email: 'missing@example.com', phone: '' })).status, 400);
  assert.equal((await register(device, { email: 'missing@example.com', company: ' ' })).status, 400);
  assert.equal(pool.data.accounts.length, 0);

  const registered = await register(device, { email: ' Alice@Example.COM ' });
  assert.equal(registered.status, 201);
  assert.deepEqual(registered.body, { authenticated: true, customer: REGISTERED, linked: false });
  assert.doesNotMatch(JSON.stringify(registered.body), /password|hash/i);
  const account = pool.data.accounts[0];
  assert.equal(account.name, PROFILE.name);
  assert.equal(account.phone, PROFILE.phone);
  assert.equal(account.company, PROFILE.company);
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
  assert.deepEqual((await device.get('/api/customer/session')).body, { authenticated: true, customer: REGISTERED });

  const duplicate = await register(browser(app), { email: 'ALICE@example.com' });
  assert.equal(duplicate.status, 409);
  assert.equal(pool.data.accounts.length, 1);
  assert.equal(pool.data.sessions.length, 1);
});

test('registration enforces the eight-character password minimum', async () => {
  const { pool, app } = setup();
  assert.equal((await register(browser(app), { email: 'seven@example.com', password: '1234567' })).status, 400);
  const registered = await register(browser(app), { email: 'eight@example.com', password: '12345678' });
  assert.equal(registered.status, 201);
  assert.equal(pool.data.accounts.length, 1);
  assert.equal(await argon2.verify(pool.data.accounts[0].password_hash, '12345678'), true);
});

test('legacy guest cookies expose only their own metadata and cannot authorize chat mutations', async () => {
  const { pool, app } = setup();
  const firstGuest = pool.guest('first@example.com');
  const secondGuest = pool.guest('second@example.com');
  pool.data.messages.push({ id: 1, conversation_id: firstGuest.row.id, role: 'user', content: 'Private legacy message', status: 'answered', created_at: pool.now });
  const first = browser(app, { sss_visitor: firstGuest.secret, sss_customer: 'A'.repeat(43) });
  const second = browser(app, { sss_visitor: secondGuest.secret });
  const stranger = browser(app);
  const message = { message: 'Bypass attempt', requestId: crypto.randomUUID() };
  const oldStart = { name: 'Spoofed', email: 'first@example.com', phone: '12345678', company: 'Spoofed', consent: true };

  assert.deepEqual((await first.get('/api/chat/current')).body, { active: false, customer: null, guestConversation: guestMetadata(firstGuest.row) });
  assert.deepEqual((await second.get('/api/chat/current')).body, { active: false, customer: null, guestConversation: guestMetadata(secondGuest.row) });
  assert.deepEqual((await stranger.get('/api/chat/current')).body, { active: false, customer: null });
  for (const device of [first, stranger]) {
    assert.equal((await device.post('/api/chat/start', oldStart)).status, 401);
    assert.equal((await device.post('/api/chat/messages', message)).status, 401);
  }
  assert.equal(pool.data.conversations.length, 2);
  assert.deepEqual(pool.data.messages.map((entry) => entry.content), ['Private legacy message']);
  assert.equal(pool.data.links.length, 0);

  assert.equal((await first.post('/api/chat/close')).status, 200);
  assert.equal(first.jar.has('sss_visitor'), false);
  assert.ok(pool.data.conversations.find((row) => row.id === firstGuest.row.id).visitor_closed_at);
  assert.deepEqual((await first.get('/api/chat/current')).body, { active: false, customer: null });
  assert.deepEqual((await second.get('/api/chat/current')).body, { active: false, customer: null, guestConversation: guestMetadata(secondGuest.row) });
});

test('login links a matching legacy guest and resumes its messages', async () => {
  const { pool, app } = setup();
  assert.equal((await register(browser(app), { email: 'alice@example.com' })).status, 201);
  const guest = pool.guest(' ALICE@example.com ');
  pool.data.messages.push({ id: 1, conversation_id: guest.row.id, role: 'user', content: 'Saved before login', status: 'answered', created_at: pool.now });
  const device = browser(app, { sss_visitor: guest.secret });
  assert.deepEqual((await device.get('/api/chat/current')).body, { active: false, customer: null, guestConversation: guestMetadata(guest.row) });

  const login = await device.post('/api/customer/login', { email: 'alice@example.com', password: PASSWORD });
  assert.equal(login.status, 200);
  assert.equal(login.body.linked, true);
  assert.equal(device.jar.has('sss_visitor'), false);
  assert.deepEqual(pool.data.links, [{ conversation_id: guest.row.id, customer_id: pool.data.accounts[0].id }]);
  const current = await device.get('/api/chat/current');
  assert.equal(current.body.active, true);
  assert.equal(current.body.conversation.id, guest.row.id);
  assert.deepEqual(current.body.messages.map((entry) => entry.content), ['Saved before login']);
  assert.deepEqual((await browser(app, { sss_visitor: guest.secret }).get('/api/chat/current')).body, { active: false, customer: null });
});

test('returning guest cookies are renewed only for the remaining conversation lifetime', async () => {
  const { pool, app } = setup();
  pool.now = Date.now();
  const guest = pool.guest('guest@example.com', pool.now - 6 * DAY);
  const device = browser(app, { sss_visitor: guest.secret });
  const response = await device.get('/api/chat/current');
  assert.deepEqual(response.body, { active: false, customer: null, guestConversation: guestMetadata(guest.row) });
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
  pool.data.catalogueProducts.push({
    company_id: 'fxc', slug: 'mc4', name: 'MC-4', product_type: 'Ram-air personnel parachute system',
    image_name: 'fxc-mc4.jpg', image_source: 'asset',
    manufacturer_source: 'https://www.fxcguardian.com/product/mc-4-parachute-system/', status: 'published'
  });
  pool.data.knowledgeLinks.push({ content: 'https://www.fxcguardian.com/product/mc-4-parachute-system/', status: 'published' });
  const first = browser(app, { sss_visitor: guest.secret });
  const stranger = browser(app);
  assert.deepEqual((await stranger.get('/api/chat/current')).body, { active: false, customer: null });
  assert.deepEqual((await browser(app, { sss_visitor: crypto.randomBytes(32).toString('base64url') }).get('/api/chat/current')).body, { active: false, customer: null });
  assert.equal((await stranger.post('/api/chat/close')).status, 200);
  assert.deepEqual((await first.get('/api/chat/current')).body, { active: false, customer: null, guestConversation: guestMetadata(guest.row) });

  const registration = await register(first, { email: 'alice@example.com' });
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
  assert.deepEqual(login.body.customer, REGISTERED);
  assert.notEqual(first.jar.get('sss_customer'), second.jar.get('sss_customer'));
  const secondCurrent = await second.get('/api/chat/current');
  assert.equal(secondCurrent.body.conversation.id, guest.row.id);
  assert.deepEqual(secondCurrent.body.customer, REGISTERED);
  assert.deepEqual(secondCurrent.body.messages[1].products, current.body.messages[1].products);
  assert.deepEqual(secondCurrent.body.messages[1].approvedLinks, ['https://www.fxcguardian.com/product/mc-4-parachute-system/']);
  pool.data.catalogueProducts[0].status = 'retired';
  pool.data.knowledgeLinks[0].status = 'retired';
  const retired = (await second.get('/api/chat/current')).body.messages[1];
  assert.equal(retired.products, undefined);
  assert.equal(retired.approvedLinks, undefined);
  assert.equal((await stranger.get('/api/chat/current')).body.active, false);

  // A different signed-in customer cannot claim or read the linked chat,
  // even when they present its former guest token.
  const unrelated = browser(app, { sss_visitor: guest.secret });
  const unrelatedRegistration = await register(unrelated, { email: 'other@example.com' });
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
  const rejected = await register(visitor, { email: 'other@example.com' });
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /different email/i);
  assert.equal(pool.data.accounts.length, 0);
  assert.equal(pool.data.sessions.length, 0);
  assert.equal(pool.data.links.length, 0);
  assert.deepEqual((await visitor.get('/api/chat/current')).body, { active: false, customer: null, guestConversation: guestMetadata(existingGuest.row) });

  assert.equal((await register(visitor, { email: 'guest@example.com' })).status, 201);
  const anotherGuest = pool.guest('guest@example.com');
  const otherDevice = browser(app, { sss_visitor: anotherGuest.secret });
  const conflict = await otherDevice.post('/api/customer/login', { email: 'guest@example.com', password: PASSWORD });
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /already has an active chat/i);
  assert.equal(pool.data.links.length, 1);
  assert.equal(pool.data.sessions.length, 1);
  assert.deepEqual((await otherDevice.get('/api/chat/current')).body, { active: false, customer: null, guestConversation: guestMetadata(anotherGuest.row) });
  assert.equal((await visitor.get('/api/chat/current')).body.conversation.id, existingGuest.row.id);
});

test('disabled accounts cannot log in or use an existing session', async () => {
  const { pool, app } = setup();
  const device = browser(app);
  assert.equal((await register(device, { email: 'disabled@example.com' })).status, 201);
  pool.data.accounts[0].disabled = 1;
  assert.equal((await device.get('/api/customer/session')).body.authenticated, false);
  assert.equal((await device.post('/api/chat/start', { consent: true })).status, 401);
  assert.equal((await device.post('/api/customer/profile', PROFILE)).status, 401);
  assert.equal((await browser(app).post('/api/customer/login', { email: 'disabled@example.com', password: PASSWORD })).status, 401);
});

test('an incomplete account must complete its own profile before starting a chat', async () => {
  const { pool, app } = setup();
  const device = browser(app);
  const other = browser(app);
  assert.equal((await register(device, { email: 'alice@example.com' })).status, 201);
  assert.equal((await register(other, { email: 'other@example.com', name: 'Other Owner' })).status, 201);
  const account = pool.data.accounts[0];
  const otherAccount = { ...pool.data.accounts[1] };
  const locksBefore = pool.accountLocks.length;
  for (const field of ['name', 'phone', 'company']) {
    account[field] = '   ';
    assert.equal((await device.post('/api/chat/start', { consent: true, ...PROFILE })).status, 409, field);
    account[field] = PROFILE[field];
  }
  Object.assign(account, { name: null, phone: null, company: null });
  assert.equal((await device.post('/api/chat/start', { consent: true, ...PROFILE })).status, 409);
  assert.equal(pool.data.conversations.length, 0);
  assert.equal(pool.data.links.length, 0);
  assert.equal(pool.data.messages.length, 0);
  assert.equal(pool.accountLocks.slice(locksBefore).filter((entry) => entry.type === 'profile').length, 4);

  assert.equal((await browser(app).post('/api/customer/profile', PROFILE)).status, 401);
  assert.equal((await request(app).post('/api/customer/profile')
    .set('Cookie', `sss_customer=${device.jar.get('sss_customer')}`).send(PROFILE)).status, 403);
  for (const invalid of [
    { name: ' ', phone: '12345678', company: 'Example' },
    { name: 'Name', phone: '', company: 'Example' },
    { name: 'Name', phone: '12345678', company: null },
    { name: 'N'.repeat(121), phone: '12345678', company: 'Example' },
    { name: 'Name', phone: '1'.repeat(51), company: 'Example' },
    { name: 'Name', phone: '12345678', company: 'C'.repeat(161) }
  ]) {
    assert.equal((await device.post('/api/customer/profile', invalid)).status, 400);
  }
  assert.deepEqual({ name: account.name, phone: account.phone, company: account.company }, { name: null, phone: null, company: null });
  const beforeUpdate = pool.accountLocks.length;
  const updated = await device.post('/api/customer/profile', {
    name: '  Completed Name  ', phone: '  0123456789  ', company: '  Completed Company  ',
    email: 'other@example.com', id: otherAccount.id
  });
  const expected = { email: 'alice@example.com', name: 'Completed Name', phone: '0123456789', company: 'Completed Company' };
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body, { authenticated: true, customer: expected });
  assert.deepEqual(pool.accountLocks.slice(beforeUpdate), [{ type: 'profile', id: account.id }]);
  assert.deepEqual(pool.data.accounts[1], otherAccount);
  assert.deepEqual((await device.get('/api/customer/session')).body, { authenticated: true, customer: expected });

  const beforeStart = pool.accountLocks.length;
  const started = await device.post('/api/chat/start', { consent: true });
  assert.equal(started.status, 201);
  assert.deepEqual(started.body.customer, expected);
  assert.deepEqual(pool.accountLocks.slice(beforeStart), [{ type: 'profile', id: account.id }]);
  assert.deepEqual(
    (({ email, name, phone, company }) => ({ email, name, phone, company }))(pool.data.conversations[0]),
    expected
  );
});

test('customer sessions and both guest and linked chats expire at 30 days', async () => {
  const { pool, app } = setup();
  const linkedGuest = pool.guest('alice@example.com');
  const unlinkedGuest = pool.guest('guest@example.com');
  const customer = browser(app, { sss_visitor: linkedGuest.secret });
  const guest = browser(app, { sss_visitor: unlinkedGuest.secret });
  assert.equal((await register(customer, { email: 'alice@example.com' })).status, 201);

  pool.now += 30 * DAY - 1;
  assert.equal((await customer.get('/api/customer/session')).body.authenticated, true);
  assert.equal((await customer.get('/api/chat/current')).body.conversation.id, linkedGuest.row.id);
  assert.deepEqual((await guest.get('/api/chat/current')).body, { active: false, customer: null, guestConversation: guestMetadata(unlinkedGuest.row) });
  pool.now += 1;
  assert.equal((await customer.get('/api/customer/session')).body.authenticated, false);
  assert.equal((await guest.get('/api/chat/current')).body.active, false);
  assert.equal((await customer.post('/api/customer/login', { email: 'alice@example.com', password: PASSWORD })).status, 200);
  assert.equal((await customer.get('/api/chat/current')).body.active, false);
});

test('customer chat history lists only owned chats and hides expired transcripts', async () => {
  const { pool, app } = setup();
  const device = browser(app);
  assert.equal((await register(device, { email: 'alice@example.com' })).status, 201);
  const account = pool.data.accounts[0];
  const recent = pool.guest('alice@example.com', pool.now - 2 * DAY);
  const old = pool.guest('alice@example.com', pool.now - 31 * DAY);
  const foreign = pool.guest('other@example.com', pool.now - DAY);
  recent.row.status = 'new';
  old.row.status = 'answered';
  foreign.row.status = 'new';
  pool.data.links.push(
    { customer_id: account.id, conversation_id: recent.row.id },
    { customer_id: account.id, conversation_id: old.row.id },
    { customer_id: account.id + 1000, conversation_id: foreign.row.id }
  );
  pool.data.messages.push(
    { id: 1, conversation_id: recent.row.id, role: 'user', content: 'Recent question', status: 'answered', created_at: pool.now - DAY },
    { id: 2, conversation_id: recent.row.id, role: 'assistant', content: 'Recent answer', status: 'answered', created_at: pool.now - DAY + 1000 },
    { id: 3, conversation_id: old.row.id, role: 'user', content: 'Old question', status: 'answered', created_at: old.row.created_at },
    { id: 4, conversation_id: foreign.row.id, role: 'user', content: 'Private question', status: 'answered', created_at: pool.now }
  );

  assert.equal((await request(app).get('/api/customer/conversations')).status, 401);
  assert.equal((await request(app).get(`/api/customer/conversations/${recent.row.id}`)).status, 401);

  const list = await device.get('/api/customer/conversations');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.conversations, [
    { id: recent.row.id, status: 'new', createdAt: recent.row.created_at, endedAt: null, messageCount: 2, lastMessage: 'Recent answer', lastRole: 'assistant', messagesExpired: false, active: true },
    { id: old.row.id, status: 'answered', createdAt: old.row.created_at, endedAt: null, messageCount: 1, lastMessage: null, lastRole: null, messagesExpired: true, active: false }
  ]);

  const chat = await device.get(`/api/customer/conversations/${recent.row.id}`);
  assert.equal(chat.status, 200);
  assert.equal(chat.body.conversation.email, 'alice@example.com');
  assert.equal(chat.body.messagesExpired, false);
  assert.equal(chat.body.endedAt, null);
  assert.deepEqual(chat.body.messages.map((entry) => entry.content), ['Recent question', 'Recent answer']);

  const expired = await device.get(`/api/customer/conversations/${old.row.id}`);
  assert.equal(expired.status, 200);
  assert.equal(expired.body.messagesExpired, true);
  assert.deepEqual(expired.body.messages, []);

  assert.equal((await device.get(`/api/customer/conversations/${foreign.row.id}`)).status, 404);
  assert.equal((await device.get('/api/customer/conversations/not-a-uuid')).status, 404);
});

test('a failed welcome message rolls back a new owned conversation and link', async () => {
  const { pool, app } = setup();
  const device = browser(app);
  assert.equal((await register(device, { email: 'visitor@example.com' })).status, 201);
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
  const response = await device.post('/api/chat/start', { consent: true });
  assert.equal(response.status, 500);
  assert.equal(pool.data.conversations.length, 0);
  assert.equal(pool.data.links.length, 0);
  assert.equal(pool.data.messages.length, 0);
  assert.equal(pool.data.accounts.length, 1);
  assert.equal(pool.data.sessions.length, 1);
  assert.equal(device.jar.has('sss_visitor'), false);
});

test('a failed ownership link rolls back a new conversation', async () => {
  const { pool, app } = setup();
  const device = browser(app);
  assert.equal((await register(device, { email: 'owner@example.com' })).status, 201);
  const connect = pool.getConnection.bind(pool);
  pool.getConnection = async () => {
    const conn = await connect();
    const execute = conn.execute;
    conn.execute = async (sql, params) => {
      if (sql.startsWith('INSERT INTO customer_conversations')) throw new Error('Simulated link failure');
      return execute(sql, params);
    };
    return conn;
  };
  assert.equal((await device.post('/api/chat/start', { consent: true })).status, 500);
  assert.equal(pool.data.conversations.length, 0);
  assert.equal(pool.data.links.length, 0);
  assert.equal(pool.data.messages.length, 0);
  assert.equal(pool.data.sessions.length, 1);
});

test('chat creation uses the account row locked after session lookup', async () => {
  const { pool, app } = setup();
  const device = browser(app);
  assert.equal((await register(device, { email: 'owner@example.com' })).status, 201);
  const latestProfile = { name: 'Latest Name', phone: '87654321', company: 'Latest Company' };
  const connect = pool.getConnection.bind(pool);
  let changed = false;
  pool.getConnection = async () => {
    const conn = await connect();
    const execute = conn.execute;
    conn.execute = async (sql, params) => {
      if (!changed && sql.startsWith('SELECT id,email,name,phone,company FROM customer_accounts')) {
        Object.assign(pool.data.accounts[0], latestProfile);
        changed = true;
      }
      return execute(sql, params);
    };
    return conn;
  };
  const result = await device.post('/api/chat/start', { consent: true });
  const expected = { email: 'owner@example.com', ...latestProfile };
  assert.equal(result.status, 201);
  assert.equal(changed, true);
  assert.deepEqual(result.body.customer, expected);
  for (const field of ['name', 'email', 'phone', 'company']) {
    assert.equal(result.body.conversation[field], expected[field]);
    assert.equal(pool.data.conversations[0][field], expected[field]);
  }
});

test('profile and start reject an account disabled between session lookup and locking', async () => {
  for (const [url, body] of [
    ['/api/chat/start', { consent: true }],
    ['/api/customer/profile', { name: 'New Name', phone: '87654321', company: 'New Company' }]
  ]) {
    const { pool, app } = setup();
    const device = browser(app);
    assert.equal((await register(device, { email: 'alice@example.com' })).status, 201);
    const before = { ...pool.data.accounts[0] };
    const connect = pool.getConnection.bind(pool);
    let locked = false;
    pool.getConnection = async () => {
      const conn = await connect();
      const execute = conn.execute;
      conn.execute = async (sql, params) => {
        if (sql.startsWith('SELECT id,email,name,phone,company FROM customer_accounts')) {
          locked = true;
          return [[]];
        }
        return execute(sql, params);
      };
      return conn;
    };
    assert.equal((await device.post(url, body)).status, 401, url);
    assert.equal(locked, true, url);
    assert.deepEqual(pool.data.accounts[0], before);
    assert.equal(pool.data.conversations.length, 0);
    assert.equal(pool.data.links.length, 0);
    assert.equal(pool.data.messages.length, 0);
  }
});

test('an account creates owned chats from its stored profile and requires consent each time', async () => {
  const { pool, app } = setup();
  const first = browser(app);
  const second = browser(app);
  const expected = { email: 'owner@example.com', ...PROFILE };
  assert.equal((await register(first, { email: 'owner@example.com' })).status, 201);
  const locksBeforeLogin = pool.accountLocks.length;
  assert.equal((await second.post('/api/customer/login', { email: 'owner@example.com', password: PASSWORD })).status, 200);
  assert.deepEqual(pool.accountLocks.slice(locksBeforeLogin), [{ type: 'login', id: pool.data.accounts[0].id }]);
  for (const consent of [undefined, false, 'true']) {
    assert.equal((await first.post('/api/chat/start', { consent })).status, 400);
  }
  assert.equal(pool.data.conversations.length, 0);
  assert.equal(pool.data.links.length, 0);
  assert.equal(pool.data.messages.length, 0);

  const beforeStart = pool.accountLocks.length;
  const started = await first.post('/api/chat/start', {
    consent: true, name: 'Spoofed Name', email: 'attacker@example.com', phone: '99999999', company: 'Spoofed Company'
  });
  assert.equal(started.status, 201);
  assert.equal(started.body.messages.length, 1);
  assert.equal(started.body.messages[0].role, 'assistant');
  assert.match(started.body.messages[0].content, /what would you like to know/i);
  assert.deepEqual(started.body.customer, expected);
  assert.deepEqual(pool.accountLocks.slice(beforeStart), [{ type: 'profile', id: pool.data.accounts[0].id }]);
  assert.equal(first.jar.has('sss_visitor'), false);
  assert.equal(pool.data.conversations.length, 1);
  assert.deepEqual(pool.data.links, [{ conversation_id: started.body.conversation.id, customer_id: pool.data.accounts[0].id }]);
  for (const field of ['name', 'email', 'phone', 'company']) {
    assert.equal(started.body.conversation[field], expected[field]);
    assert.equal(pool.data.conversations[0][field], expected[field]);
    assert.equal(pool.data.accounts[0][field], expected[field]);
  }
  assert.equal(pool.data.messages.length, 1);
  const resumed = await second.get('/api/chat/current');
  assert.equal(resumed.body.conversation.id, started.body.conversation.id);
  assert.equal(resumed.body.messages[0].content, started.body.messages[0].content);
  assert.deepEqual(resumed.body.customer, expected);
  assert.equal((await second.post('/api/chat/start', { consent: true })).status, 409);
  assert.equal(pool.data.conversations.length, 1);
  assert.equal(pool.data.links.length, 1);

  assert.equal((await first.post('/api/chat/close')).status, 200);
  const closed = await second.get('/api/chat/current');
  assert.equal(closed.body.active, false);
  assert.deepEqual(closed.body.customer, expected);
  assert.equal((await second.post('/api/chat/start', {})).status, 400);
  assert.equal((await second.post('/api/chat/start', { consent: false })).status, 400);
  const replacement = await second.post('/api/chat/start', { consent: true });
  assert.equal(replacement.status, 201);
  assert.notEqual(replacement.body.conversation.id, started.body.conversation.id);
  assert.deepEqual(replacement.body.customer, expected);
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
  assert.equal((await register(device, { email: 'visitor@example.com' })).status, 201);
  assert.equal((await device.get('/api/chat/current')).body.conversation.id, guest.row.id);
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
  const { pool, app } = setup();
  assert.equal(RETENTION_DAYS, 30);
  const expired = pool.guest('expired@example.com', pool.now - 31 * DAY);
  const boundary = pool.guest('boundary@example.com', pool.now - 30 * DAY);
  const recent = pool.guest('recent@example.com', pool.now - 30 * DAY + 1);
  pool.data.messages.push(
    { id: 1, conversation_id: expired.row.id, content: 'old' },
    { id: 2, conversation_id: boundary.row.id, content: 'recent message in an old conversation', created_at: pool.now },
    { id: 3, conversation_id: recent.row.id, content: 'still retained' }
  );
  pool.data.quotations.push({
    id: 1, conversation_id: expired.row.id, company_id: 'fxc', company_name: 'FXC', product_key: null,
    product_name: 'General enquiry', quantity: null, required_by: null, delivery_location: '', procurement_route: 'unsure',
    message: 'Please provide a quote.', enquiry_type: '', country: '', city: '', postal_code: '', navigation_area: '', region: '',
    contact_name: 'Saved Contact', contact_email: 'expired@example.com', contact_phone: '12345678', contact_company: 'Saved Company', created_at: pool.now - 31 * DAY
  });
  assert.equal(await purgeExpiredMessages(pool), 2);
  assert.deepEqual(pool.data.messages.map((message) => message.id), [3]);
  assert.deepEqual(pool.data.conversations.map((conversation) => conversation.id), [expired.row.id, boundary.row.id, recent.row.id]);
  assert.equal(pool.data.quotations.length, 1);
  const staff = browser(app, { sss_staff: pool.staff() });
  const detail = await staff.get(`/api/admin/conversations/${expired.row.id}`);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.messages, []);
  assert.equal(detail.body.quotations[0].message, 'Please provide a quote.');
  assert.equal(detail.body.quotations[0].contact.name, 'Saved Contact');
  assert.equal(await purgeExpiredMessages(pool), 0);
});
