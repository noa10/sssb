const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../server/app');
const { createProvider, requiresHandoff, HANDOFF } = require('../server/ai');
const { chunkText } = require('../server/knowledge');
const { databaseConfig } = require('../server/db');

const env = { NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000' };
const offline = { async execute() { throw new Error('database unavailable'); }, async getConnection() { throw new Error('database unavailable'); } };
const fake = { async answer() { return 'Example response'; } };

test('database configuration accepts an explicitly empty local password', () => {
  const names = ['DB_HOST', 'DB_USER', 'DB_NAME', 'DB_PASSWORD'];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, { DB_HOST: 'localhost', DB_USER: 'test', DB_NAME: 'test', DB_PASSWORD: '' });
    assert.equal(databaseConfig().password, '');
    delete process.env.DB_PASSWORD;
    assert.throws(() => databaseConfig(), /DB_PASSWORD must be configured/);
  } finally {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
});

test('handoff identifies commercial enquiries', () => {
  for (const question of ['How much is it?', 'Do you have stock?', 'What is the lead time?', 'Can I have a quotation?']) {
    assert.equal(requiresHandoff(question), true, question);
  }
  assert.match(HANDOFF, /manufacturer/);
  assert.equal(requiresHandoff('What is this product used for?'), false);
});

test('disabled provider refuses to pretend it answered', async () => {
  await assert.rejects(createProvider({ AI_PROVIDER: 'disabled' }).answer({}), /not configured/);
  assert.throws(() => createProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'production' }), /Unsupported/);
});

test('AI provider allows HTTP only for local development', () => {
  const providerEnv = { AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'test-key', AI_MODEL: 'test-model' };
  for (const url of ['http://localhost:3425/v1', 'http://127.0.0.1:3425/v1', 'http://[::1]:3425/v1']) {
    assert.equal(typeof createProvider({ ...providerEnv, NODE_ENV: 'development', AI_BASE_URL: url }).answer, 'function');
    assert.throws(() => createProvider({ ...providerEnv, NODE_ENV: 'production', AI_BASE_URL: url }), /must use HTTPS/);
    assert.throws(() => createProvider({ ...providerEnv, AI_BASE_URL: url }), /must use HTTPS/);
  }
  assert.throws(() => createProvider({ ...providerEnv, NODE_ENV: 'development', AI_BASE_URL: 'http://example.com/v1' }), /must use HTTPS/);
  assert.equal(typeof createProvider({ ...providerEnv, NODE_ENV: 'production', AI_BASE_URL: 'https://example.com/v1' }).answer, 'function');
});

test('AI provider preserves assistant roles and greets without sources', async () => {
  const http = require('node:http');
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const call = JSON.parse(body);
      calls.push(call);
      const classification = call.messages[0].content.startsWith('Classify the visitor message');
      const content = classification
        ? (call.messages[1].content === 'how r u' ? 'SMALLTALK' : 'An unsupported factual answer')
        : 'Hello! How can I help with our products?';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const provider = createProvider({
      AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'test-key', AI_MODEL: 'test-model', NODE_ENV: 'development',
      AI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`
    });
    const messages = [{ role: 'user', content: 'What is the MC-4?' }, { role: 'assistant', content: 'It is a parachute system.' }, { role: 'user', content: 'Tell me more.' }];
    const sources = [{ title: 'MC-4 catalogue', sourceName: 'Product catalogue', content: 'The MC-4 is a parachute system.' }];
    assert.match(await provider.answer({ messages, sources }), /^Hello/);
    assert.deepEqual(calls[0].messages.slice(1).map((entry) => entry.role), ['user', 'assistant', 'user']);
    assert.equal(calls[0].messages[0].role, 'system');
    assert.match(calls[0].messages[0].content, /MC-4 catalogue/);
    assert.match(await provider.answer({ messages: [{ role: 'user', content: 'Hello' }], sources: [] }), /^Hello/);
    assert.equal(calls[1].messages[0].role, 'system');
    assert.equal(await provider.classifyConversation({ message: 'how r u' }), 'SMALLTALK');
    assert.equal(await provider.classifyConversation({ message: 'What is this product?' }), 'OTHER');
    assert.equal(calls[2].messages[1].content, 'how r u');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('document indexing splits overlapping chunks', () => {
  const chunks = chunkText('a'.repeat(3200));
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 1600));
  assert.deepEqual(chunkText('  '), []);
});

test('public pages and assets work while private paths stay hidden', async () => {
  for (const mode of ['test', 'production']) {
    const app = createApp({ pool: offline, provider: fake, env: { ...env, NODE_ENV: mode, APP_ORIGIN: mode === 'production' ? 'https://example.com' : env.APP_ORIGIN } });
    for (const target of ['/.env', '/package.json', '/server/app.js', '/migrations/001_initial.sql', '/DESIGN-HANDOFF.md', '/uploads/example.pdf']) {
      const response = await request(app).get(target);
      assert.notEqual(response.status, 200, `${mode}: ${target}`);
    }
    for (const target of ['/', '/index.html', '/contact.html', '/products.html', '/assets/css/styles.css', '/assets/js/site.js', '/assets/js/chat-content.js', '/assets/img/sssb-logo.png']) {
      assert.equal((await request(app).get(target)).status, 200, `${mode}: ${target}`);
    }
  }
});

test('staff endpoints reject unauthenticated visitors', async () => {
  const app = createApp({ pool: offline, provider: fake, env });
  const result = await request(app).get('/api/admin/conversations');
  assert.equal(result.status, 401);
  assert.match(result.headers['cache-control'], /no-store/);
});

test('mutations require CSRF and reject cross-origin requests', async () => {
  const app = createApp({ pool: offline, provider: fake, env });
  assert.equal((await request(app).post('/api/chat/start').send({})).status, 403);
  const session = request.agent(app);
  const csrf = await session.get('/api/csrf');
  const blocked = await session.post('/api/chat/start').set('Origin', 'https://example.org').set('X-CSRF-Token', csrf.body.csrfToken).send({});
  assert.equal(blocked.status, 403);
  const allowed = await session.post('/api/chat/start').set('Origin', 'http://localhost:3000').set('X-CSRF-Token', csrf.body.csrfToken).send({});
  assert.equal(allowed.status, 401); // Origin and CSRF accepted; no customer is signed in.
});

test('database failures do not create a false enquiry success', async () => {
  const app = createApp({ pool: offline, provider: fake, env });
  const session = request.agent(app);
  const csrf = await session.get('/api/csrf');
  const response = await session.post('/api/chat/start')
    .set('Cookie', `sss_csrf=${csrf.body.csrfToken}; sss_customer=${'A'.repeat(43)}`)
    .set('X-CSRF-Token', csrf.body.csrfToken).send({ consent: true });
  assert.equal(response.status, 500);
  assert.doesNotMatch(JSON.stringify(response.body), /database unavailable/);
});
