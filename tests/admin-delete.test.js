'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../server/app');

const ENQUIRY_ID = '123e4567-e89b-42d3-a456-426614174000';

function staffPool(execute) {
  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params = []) { return execute(sql, params); }
  };
  return {
    async execute(sql, params = []) {
      if (sql.includes('FROM staff_sessions')) return [[{ staff_id: '1', email: 'staff@example.com' }]];
      if (sql.startsWith('UPDATE staff_sessions SET last_seen_at')) return [{ affectedRows: 1 }];
      return execute(sql, params);
    },
    async getConnection() { return conn; }
  };
}

async function staffDelete(app, path) {
  const agent = request.agent(app);
  const csrf = await agent.get('/api/csrf').expect(200);
  const tokenValue = csrf.body.csrfToken;
  return agent.delete(path)
    .set('Cookie', `sss_staff=${'A'.repeat(43)}; sss_csrf=${tokenValue}`)
    .set('X-CSRF-Token', tokenValue);
}

function testApp(pool, env = {}) {
  return createApp({ pool, env: { NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000', ...env } });
}

test('staff can delete an enquiry and unknown enquiries return 404', async () => {
  const deleted = [];
  const pool = staffPool(async (sql, params) => {
    if (sql.startsWith('DELETE FROM conversations WHERE id=?')) {
      deleted.push(params[0]);
      return [{ affectedRows: params[0] === ENQUIRY_ID ? 1 : 0 }];
    }
    throw new Error(`Unexpected simulated query: ${sql}`);
  });
  const app = testApp(pool);
  const response = await staffDelete(app, `/api/admin/conversations/${ENQUIRY_ID}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
  assert.deepEqual(deleted, [ENQUIRY_ID]);
  assert.equal((await staffDelete(app, '/api/admin/conversations/123e4567-e89b-42d3-a456-426614174999')).status, 404);
  assert.equal((await staffDelete(app, '/api/admin/conversations/not-a-uuid')).status, 404);
});

test('staff can delete company knowledge and its search chunks', async () => {
  const deleted = [];
  const pool = staffPool(async (sql, params) => {
    if (sql.startsWith('SELECT * FROM knowledge_items WHERE id=? FOR UPDATE')) {
      return [[{ id: '7', kind: 'company', storage_name: null }]];
    }
    if (sql.startsWith('DELETE FROM knowledge_chunks WHERE knowledge_id=?')) {
      deleted.push(['chunks', params[0]]);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('DELETE FROM knowledge_items WHERE id=?')) {
      deleted.push(['item', params[0]]);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected simulated query: ${sql}`);
  });
  const app = testApp(pool);
  assert.equal((await staffDelete(app, '/api/admin/knowledge/7')).status, 200);
  assert.deepEqual(deleted, [['chunks', '7'], ['item', '7']]);
});

test('knowledge linked to a product cannot be deleted from the Knowledge section', async () => {
  const pool = staffPool(async (sql) => {
    if (sql.startsWith('SELECT * FROM knowledge_items WHERE id=? FOR UPDATE')) {
      return [[{ id: '9', kind: 'product', storage_name: null }]];
    }
    if (sql.startsWith('SELECT id FROM catalogue_products WHERE knowledge_id=? LIMIT 1')) return [[{ id: '3' }]];
    throw new Error(`Unexpected simulated query: ${sql}`);
  });
  const app = testApp(pool);
  const response = await staffDelete(app, '/api/admin/knowledge/9');
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'Delete this product in the Products section.');
});

test('deleting a PDF knowledge item removes its stored file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sssb-delete-knowledge-'));
  try {
    const filename = `${crypto.randomUUID()}.pdf`;
    await fs.writeFile(path.join(directory, filename), Buffer.from('%PDF-1.4 test'));
    const pool = staffPool(async (sql, params) => {
      if (sql.startsWith('SELECT * FROM knowledge_items WHERE id=? FOR UPDATE')) {
        return [[{ id: '11', kind: 'document', storage_name: filename }]];
      }
      if (sql.startsWith('DELETE FROM knowledge_chunks WHERE knowledge_id=?')) return [{ affectedRows: 1 }];
      if (sql.startsWith('DELETE FROM knowledge_items WHERE id=?')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected simulated query: ${sql}`);
    });
    const app = testApp(pool, { UPLOAD_DIR: directory });
    assert.equal((await staffDelete(app, '/api/admin/knowledge/11')).status, 200);
    await assert.rejects(fs.access(path.join(directory, filename)), /ENOENT/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('unknown knowledge items return 404', async () => {
  const pool = staffPool(async (sql) => {
    if (sql.startsWith('SELECT * FROM knowledge_items WHERE id=? FOR UPDATE')) return [[]];
    throw new Error(`Unexpected simulated query: ${sql}`);
  });
  const app = testApp(pool);
  assert.equal((await staffDelete(app, '/api/admin/knowledge/404')).status, 404);
  assert.equal((await staffDelete(app, '/api/admin/knowledge/not-a-number')).status, 404);
});
