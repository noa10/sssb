const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const { createProvider, requiresHandoff, filterAnswer, HANDOFF, UNKNOWN } = require('./ai');
const { indexChunks, extractPdf, searchKnowledge } = require('./knowledge');
const { createCustomerService, customerProfile, validProfile } = require('./customer');
const { RETENTION_DAYS } = require('./retention');
const { isOneTypo } = require('./text');
const { addProductReferences } = require('./product-references');
const { addApprovedLinks } = require('./approved-links');
const { listAdminProducts, getAdminProduct, createProduct, updateProduct, deleteProduct, publicCatalogue } = require('./catalogue-products');
const { storeProductImage, deleteProductImage, PRODUCT_IMAGE, mediaType, productImageDir } = require('./images');
const catalogueMeta = require('./catalogue-meta');
const { digest, token, cookies, cookieOptions, clearCookie, csrfFor, issueCsrf, staffAuth, consumeLimit, verifyPassword, COOKIE_SESSION, COOKIE_VISITOR } = require('./security');

const ROOT = path.resolve(__dirname, '..');
const ALLOWED_PAGES = new Set(['index.html', 'about.html', 'contact.html', 'diving-equipments.html', 'inflatable-boats.html', 'other-tradings.html', 'our-policy.html', 'parachute-systems.html', 'products.html', 'fxc.html', 'jfd.html', 'safe-at-sea.html', 'seacraft.html', 'zodiac-nautic.html']);
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN_STATUSES = new Set(['new', 'in_progress', 'closed']);
const KNOWLEDGE_STATUSES = new Set(['draft', 'published', 'retired']);
const GREETING = /^(?:(?:hi|hello|hey|good (?:morning|afternoon|evening)|selamat (?:pagi|tengah hari|petang|malam))[\s!.,?]*(?:there)?[\s!.,?]*)+$/i;
const THANKS = /^(?:(?:thanks|thank you|thx|terima kasih)[\s!.,?]*)+$/i;
const SMALLTALK = /^(?:how (?:are|r) (?:you|u)|how(?:'s| is) (?:it|things) going)[\s!.,?]*$/i;
const HELP = /^(?:help|help me|what can you do|what do you do)[\s!.,?]*$/i;
const WELCOME_REPLY = 'Hello! I’m the Semenanjung Selatan product assistant. I can help with our products and specifications. What would you like to know?';
const GREETING_REPLY = 'Hello! How can I help you with our products today?';
const THANKS_REPLY = 'You’re welcome. If you have another product question, I’m here to help.';
const CONVERSATION_REPLIES = {
  GREETING: GREETING_REPLY,
  THANKS: THANKS_REPLY,
  HELP: 'I can help you explore our products and their published specifications. What would you like to know?',
  SMALLTALK: 'I’m here and happy to help! What would you like to know about our products?'
};

function greetingReply(message) {
  if (GREETING.test(message)) return GREETING_REPLY;
  if (THANKS.test(message)) return THANKS_REPLY;
  if (SMALLTALK.test(message)) return CONVERSATION_REPLIES.SMALLTALK;
  if (HELP.test(message)) return CONVERSATION_REPLIES.HELP;
  const word = message.toLowerCase().replace(/^[\s!.,?]+|[\s!.,?]+$/g, '');
  return /^[a-z]{4,6}$/.test(word) && isOneTypo(word, 'hello') ? GREETING_REPLY : null;
}
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
function productPayload(body) {
  if (body && typeof body.payload === 'string') {
    try { return JSON.parse(body.payload); } catch {
      const error = new Error('The product details are invalid.');
      error.status = 400;
      error.publicMessage = error.message;
      throw error;
    }
  }
  return body && typeof body === 'object' ? body : {};
}
const publicConversation = (row) => ({ id: row.id, name: row.name, email: row.email, phone: row.phone, company: row.company, createdAt: row.created_at });
const staffConversation = (row) => ({ ...publicConversation(row), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, messageCount: Number(row.message_count || 0), messagesExpired: Boolean(Number(row.messages_expired || 0)) });
const publicMessage = (row) => ({ id: String(row.id), role: row.role, content: row.content, status: row.status, createdAt: row.created_at });
const knowledgeItem = (row) => ({ id: String(row.id), title: row.title, kind: row.kind, content: row.content, sourceName: row.source_name, status: row.status, managedProductId: row.catalogue_product_id == null ? null : String(row.catalogue_product_id), createdAt: row.created_at, updatedAt: row.updated_at });

function config(env) {
  const production = env.NODE_ENV === 'production';
  if (production && (!env.APP_ORIGIN || new URL(env.APP_ORIGIN).protocol !== 'https:')) throw new Error('APP_ORIGIN must be an HTTPS origin in production');
  const uploadDir = path.resolve(env.UPLOAD_DIR || path.join(ROOT, 'uploads'));
  const publicDir = path.resolve(ROOT, 'public');
  if (uploadDir === publicDir || uploadDir.startsWith(publicDir + path.sep)) throw new Error('UPLOAD_DIR must be outside public');
  let whatsappUrl = null;
  if (env.WHATSAPP_NUMBER && /^\d{8,15}$/.test(env.WHATSAPP_NUMBER)) whatsappUrl = `https://wa.me/${env.WHATSAPP_NUMBER}`;
  return { production, uploadDir, publicDir, whatsappUrl, contactEmail: env.CONTACT_EMAIL && EMAIL.test(env.CONTACT_EMAIL) ? env.CONTACT_EMAIL : 'info@semenanjungselatan.com' };
}

function createApp({ pool, provider = createProvider(), env = process.env }) {
  if (!pool) throw new Error('Database pool required');
  const settings = config(env);
  const csrf = csrfFor(env);
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '64kb', strict: true }));
  const protectedStaff = staffAuth(pool);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 4, fieldSize: 1024 } });
  const productUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2, fieldSize: 96 * 1024 } });
  const limit = async (key, count, seconds) => {
    if (!await consumeLimit(pool, key, count, seconds)) {
      const error = new Error('Too many requests. Please try again later.');
      error.status = 429;
      throw error;
    }
  };
  const customers = createCustomerService(pool);
  const visitor = async (req) => customers.conversation(req, await customers.customer(req));
  const messagesFor = async (id) => {
    const [rows] = await pool.execute(
      `SELECT m.id,m.role,m.content,m.status,m.created_at FROM messages m
       JOIN conversations c ON c.id=m.conversation_id
       WHERE m.conversation_id=? AND c.created_at>DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
       ORDER BY m.id ASC`, [id]
    );
    return rows.map(publicMessage);
  };

  app.get('/api/csrf', issueCsrf);
  customers.mount(app, csrf, limit);
  app.get('/api/public/config', (req, res) => res.json({ contactEmail: settings.contactEmail, whatsappUrl: settings.whatsappUrl }));
  app.get('/api/catalogue', asyncRoute(async (req, res) => {
    try {
      res.json(await publicCatalogue(pool));
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') return res.status(503).json({ error: 'The catalogue is not available yet.' });
      throw error;
    }
  }));
  app.get('/api/chat/current', asyncRoute(async (req, res) => {
    const account = await customers.customer(req);
    const row = await customers.conversation(req, account);
    const customer = account ? customers.publicCustomer(account) : null;
    if (!row) return res.json({ active: false, customer });
    if (!account) {
      if (row.created_at) {
        const lifetime = RETENTION_DAYS * 86400 * 1000;
        const remaining = Math.min(lifetime, new Date(row.created_at).getTime() + lifetime - Date.now());
        if (Number.isFinite(remaining) && remaining > 0) {
          res.cookie(COOKIE_VISITOR, cookies(req)[COOKIE_VISITOR], cookieOptions(remaining));
        }
      }
      return res.json({ active: false, customer: null, guestConversation: publicConversation(row) });
    }
    await pool.execute("UPDATE messages SET status='failed' WHERE conversation_id=? AND status='pending' AND created_at<DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE)", [row.id]);
    const messages = await addApprovedLinks(pool, await addProductReferences(pool, await messagesFor(row.id)));
    res.json({ active: true, customer, conversation: publicConversation(row), messages });
  }));
  app.post('/api/chat/start', csrf, asyncRoute(async (req, res) => {
    const account = await customers.customer(req);
    if (!account) return res.status(401).json({ error: 'Sign in or create an account to start a chat.' });
    if (req.body?.consent !== true) return res.status(400).json({ error: 'Please agree to the notice before starting a chat.' });
    await limit(`start:${req.ip}`, 12, 3600);
    if (await customers.activeForCustomer(account.id)) return res.status(409).json({ error: 'An active conversation already exists.' });
    const id = crypto.randomUUID();
    const secret = token();
    const insert = `INSERT INTO conversations (id,visitor_token_hash,visitor_expires_at,name,email,phone,company,consent_version)
                    VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 DAY),?,?,?,?,?)`;
    const conn = await pool.getConnection();
    let welcomeId;
    let details;
    try {
      await conn.beginTransaction();
      const [locked] = await conn.execute(
        'SELECT id,email,name,phone,company FROM customer_accounts WHERE id=? AND disabled=0 FOR UPDATE', [account.id]
      );
      if (!locked.length) { await conn.commit(); return res.status(401).json({ error: 'Sign in again.' }); }
      if (await customers.activeForCustomer(account.id, conn)) {
        await conn.commit();
        return res.status(409).json({ error: 'An active conversation already exists.' });
      }
      const profile = customerProfile(locked[0]);
      if (!validProfile(profile)) {
        await conn.commit();
        return res.status(409).json({ error: 'Complete your account details before starting a chat.', code: 'PROFILE_INCOMPLETE' });
      }
      details = { email: locked[0].email, ...profile };
      await conn.execute(insert, [id, digest(secret), details.name, details.email, details.phone, details.company, '2026-11-02']);
      await conn.execute('INSERT INTO customer_conversations (conversation_id,customer_id) VALUES (?,?)', [id, account.id]);
      const [welcome] = await conn.execute("INSERT INTO messages (conversation_id,role,content,status) VALUES (?,'assistant',?,'answered')", [id, WELCOME_REPLY]);
      welcomeId = welcome.insertId;
      await conn.commit();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
    res.status(201).json({
      active: true,
      customer: details,
      conversation: { id, ...details },
      messages: [{ id: String(welcomeId), role: 'assistant', content: WELCOME_REPLY, status: 'answered' }]
    });
  }));
  app.post('/api/chat/close', csrf, asyncRoute(async (req, res) => {
    const row = await visitor(req);
    if (row) await pool.execute('UPDATE conversations SET visitor_closed_at=UTC_TIMESTAMP(3) WHERE id=?', [row.id]);
    clearCookie(res, COOKIE_VISITOR);
    res.json({ ok: true });
  }));
  app.post('/api/chat/messages', csrf, asyncRoute(async (req, res) => {
    const account = await customers.customer(req);
    if (!account) return res.status(401).json({ error: 'Sign in to continue your chat.' });
    const row = await customers.activeForCustomer(account.id);
    if (!row) return res.status(401).json({ error: 'Start a conversation first.' });
    const { message, requestId } = req.body || {};
    const normalizedMessage = typeof message === 'string' ? message.trim() : '';
    if (!normalizedMessage || message.length > 4000 || typeof requestId !== 'string' || !UUID.test(requestId)) {
      return res.status(400).json({ error: 'Enter a message of up to 4,000 characters.' });
    }
    await limit(`message:ip:${req.ip}`, 100, 3600);
    await limit(`message:conversation:${row.id}`, 30, 3600);
    await limit('message:global', Number(env.AI_HOURLY_LIMIT || 250), 3600);
    const conn = await pool.getConnection();
    let messageId;
    try {
      await conn.beginTransaction();
      const [active] = await conn.execute(
        `SELECT id FROM conversations WHERE id=? AND visitor_closed_at IS NULL
         AND created_at>DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY) FOR UPDATE`, [row.id]
      );
      if (!active.length) { await conn.commit(); return res.status(410).json({ error: 'This conversation has expired or ended.' }); }
      const [duplicate] = await conn.execute('SELECT status,content FROM messages WHERE conversation_id=? AND request_id=?', [row.id, requestId]);
      if (duplicate.length) {
        await conn.commit();
        if (duplicate[0].content !== normalizedMessage) return res.status(409).json({ error: 'This request ID belongs to a different message.' });
        return res.json({ ok: true, status: duplicate[0].status });
      }
      await conn.execute(`UPDATE messages SET status='failed' WHERE conversation_id=? AND status='pending' AND created_at<DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE)`, [row.id]);
      const [pending] = await conn.execute("SELECT id FROM messages WHERE conversation_id=? AND status='pending' LIMIT 1", [row.id]);
      if (pending.length) { await conn.commit(); return res.status(409).json({ error: 'Please wait for the previous response.' }); }
      const [count] = await conn.execute("SELECT COUNT(*) AS total FROM messages WHERE conversation_id=? AND role='user'", [row.id]);
      if (Number(count[0].total) >= 250) { await conn.commit(); return res.status(400).json({ error: 'This conversation is full. Please end it and start a new one.' }); }
      const [saved] = await conn.execute("INSERT INTO messages (conversation_id,request_id,role,content,status) VALUES (?,?,'user',?,'pending')", [row.id, requestId, normalizedMessage]);
      messageId = saved.insertId;
      await conn.execute('UPDATE conversations SET updated_at=UTC_TIMESTAMP(3) WHERE id=?', [row.id]);
      await conn.commit();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
    try {
      let answer;
      if (requiresHandoff(message)) answer = HANDOFF;
      else if (greetingReply(normalizedMessage)) answer = greetingReply(normalizedMessage);
      else {
        const [history] = await pool.execute(
          `SELECT role,content FROM (
             SELECT m.id,m.role,m.content,m.status FROM messages m
             JOIN conversations c ON c.id=m.conversation_id
             WHERE m.conversation_id=? AND c.visitor_closed_at IS NULL
               AND c.created_at>DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
               AND (m.status='answered' OR m.id=?)
             ORDER BY m.id DESC LIMIT 10
           ) recent ORDER BY id ASC`, [row.id, messageId]
        );
        const context = history.filter((entry) => entry.role === 'user').map((entry) => entry.content).join(' ').slice(-12000);
        const sources = await searchKnowledge(pool, context);
        if (!sources.length && typeof provider.classifyConversation !== 'function') answer = UNKNOWN;
        else {
          const [active] = await pool.execute(
            `SELECT id FROM conversations WHERE id=? AND visitor_closed_at IS NULL
             AND created_at>DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)`, [row.id]
          );
          if (!active.length) {
            const error = new Error('Conversation expired or ended');
            error.conversationExpired = true;
            throw error;
          }
          if (sources.length) answer = await provider.answer({ messages: history, sources });
          else {
            let intent;
            try { intent = await provider.classifyConversation({ message: normalizedMessage }); }
            catch { intent = 'OTHER'; }
            answer = Object.hasOwn(CONVERSATION_REPLIES, intent) ? CONVERSATION_REPLIES[intent] : UNKNOWN;
          }
        }
      }
      answer = filterAnswer(answer);
      const resultConn = await pool.getConnection();
      try {
        await resultConn.beginTransaction();
        const [active] = await resultConn.execute(
          `SELECT id FROM conversations WHERE id=? AND visitor_closed_at IS NULL
           AND created_at>DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY) FOR UPDATE`, [row.id]
        );
        if (!active.length) {
          const error = new Error('Conversation expired or ended');
          error.conversationExpired = true;
          throw error;
        }
        const [updated] = await resultConn.execute("UPDATE messages SET status='answered' WHERE id=? AND status='pending'", [messageId]);
        if (updated.affectedRows !== 1) throw new Error('Response expired');
        await resultConn.execute("INSERT INTO messages (conversation_id,role,content,status) VALUES (?,'assistant',?,'answered')", [row.id, answer]);
        await resultConn.execute('UPDATE conversations SET updated_at=UTC_TIMESTAMP(3) WHERE id=?', [row.id]);
        await resultConn.commit();
      } catch (error) { await resultConn.rollback(); throw error; } finally { resultConn.release(); }
      res.json({ ok: true, status: 'answered' });
    } catch (error) {
      await pool.execute("UPDATE messages SET status='failed' WHERE id=? AND status='pending'", [messageId]);
      if (error.conversationExpired) return res.status(410).json({ error: 'This conversation has expired or ended.' });
      res.status(503).json({ error: 'Your message was saved, but the assistant could not respond. Please contact our team.', saved: true });
    }
  }));

  app.get('/api/admin/session', (req, res, next) => protectedStaff(req, res, () => res.json({ authenticated: true, user: { email: req.staff.email } })));
  app.post('/api/admin/login', csrf, asyncRoute(async (req, res) => {
    const email = clean(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    await limit(`login:ip:${req.ip}`, 20, 900);
    await limit(`login:account:${email}`, 8, 900);
    if (!EMAIL.test(email) || !password || password.length > 1024) return res.status(401).json({ error: 'Invalid email or password.' });
    const [rows] = await pool.execute('SELECT id,email,password_hash,disabled FROM staff_users WHERE email=? LIMIT 1', [email]);
    if (!rows.length || rows[0].disabled || !await verifyPassword(rows[0].password_hash, password)) return res.status(401).json({ error: 'Invalid email or password.' });
    const old = cookies(req)[COOKIE_SESSION];
    if (old) await pool.execute('DELETE FROM staff_sessions WHERE token_hash=?', [digest(old)]);
    const secret = token();
    await pool.execute('INSERT INTO staff_sessions (token_hash,staff_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 8 HOUR))', [digest(secret), rows[0].id]);
    res.cookie(COOKIE_SESSION, secret, cookieOptions(8 * 3600 * 1000));
    res.json({ authenticated: true, user: { email: rows[0].email } });
  }));
  app.post('/api/admin/logout', csrf, protectedStaff, asyncRoute(async (req, res) => {
    await pool.execute('DELETE FROM staff_sessions WHERE token_hash=?', [digest(cookies(req)[COOKIE_SESSION])]);
    clearCookie(res, COOKIE_SESSION);
    res.json({ ok: true });
  }));
  app.get('/api/admin/conversations', protectedStaff, asyncRoute(async (req, res) => {
    const rawPage = Number(req.query.page || 1);
    const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100000) : 1;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : '';
    const status = typeof req.query.status === 'string' && ADMIN_STATUSES.has(req.query.status) ? req.query.status : 'all';
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const conditions = [];
    const params = [];
    if (search) {
      conditions.push("(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.company LIKE ?)");
      params.push(pattern, pattern, pattern, pattern);
    }
    if (status !== 'all') { conditions.push('c.status=?'); params.push(status); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [counts] = await pool.execute(`SELECT COUNT(*) AS total FROM conversations c ${where}`, params);
    const [rows] = await pool.execute(`SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND c.created_at>DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)) AS message_count FROM conversations c ${where} ORDER BY c.updated_at DESC LIMIT 50 OFFSET ${((page - 1) * 50)}`, params);
    res.json({ conversations: rows.map(staffConversation), total: Number(counts[0].total), page, pageSize: 50 });
  }));
  app.get('/api/admin/conversations/:id', protectedStaff, asyncRoute(async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Enquiry not found.' });
    const [rows] = await pool.execute(
      'SELECT *, created_at<=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY) AS messages_expired FROM conversations WHERE id=?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Enquiry not found.' });
    res.json({ conversation: staffConversation(rows[0]), messages: await messagesFor(rows[0].id) });
  }));
  app.patch('/api/admin/conversations/:id', csrf, protectedStaff, asyncRoute(async (req, res) => {
    if (!UUID.test(req.params.id) || !ADMIN_STATUSES.has(req.body?.status)) return res.status(400).json({ error: 'Invalid enquiry status.' });
    const [result] = await pool.execute('UPDATE conversations SET status=? WHERE id=?', [req.body.status, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Enquiry not found.' });
    res.json({ ok: true });
  }));
  app.get('/api/admin/knowledge', protectedStaff, asyncRoute(async (req, res) => {
    // Product records own their linked knowledge; staff edit those in Products.
    const [counts] = await pool.execute('SELECT COUNT(*) AS total FROM knowledge_items k LEFT JOIN catalogue_products p ON p.knowledge_id=k.id WHERE p.id IS NULL');
    const [rows] = await pool.execute('SELECT k.id,k.title,k.kind,k.source_name,k.status,k.created_at,k.updated_at,p.id AS catalogue_product_id FROM knowledge_items k LEFT JOIN catalogue_products p ON p.knowledge_id=k.id WHERE p.id IS NULL ORDER BY k.updated_at DESC LIMIT 500');
    const total = Number(counts[0].total);
    res.json({ items: rows.map(knowledgeItem), total, truncated: total > 500 });
  }));
  app.get('/api/admin/knowledge/:id', protectedStaff, asyncRoute(async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Knowledge item not found.' });
    const [rows] = await pool.execute('SELECT k.id,k.title,k.kind,k.content,k.source_name,k.status,k.created_at,k.updated_at,p.id AS catalogue_product_id FROM knowledge_items k LEFT JOIN catalogue_products p ON p.knowledge_id=k.id WHERE k.id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Knowledge item not found.' });
    res.json({ item: knowledgeItem(rows[0]) });
  }));
  app.post('/api/admin/knowledge', csrf, protectedStaff, asyncRoute(async (req, res) => {
    const { title, kind, content, sourceName, status } = req.body || {};
    if (kind === 'product') return res.status(400).json({ error: 'Add and edit products in the Products section.' });
    if (!clean(title, 200) || !['company','product'].includes(kind) || typeof content !== 'string' || !content.trim() || content.length > 30000 || !KNOWLEDGE_STATUSES.has(status)) return res.status(400).json({ error: 'Complete the knowledge fields.' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute('INSERT INTO knowledge_items (title,kind,content,source_name,status) VALUES (?,?,?,?,?)', [clean(title,200),kind,content.trim(),clean(sourceName,255),status]);
      await indexChunks(conn, result.insertId, `${title}\n${content}`);
      await conn.commit();
      res.status(201).json({ ok: true, id: String(result.insertId) });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  }));
  app.patch('/api/admin/knowledge/:id', csrf, protectedStaff, asyncRoute(async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Knowledge item not found.' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute('SELECT * FROM knowledge_items WHERE id=? FOR UPDATE', [req.params.id]);
      if (!rows.length) { await conn.rollback(); return res.status(404).json({ error: 'Knowledge item not found.' }); }
      const old = rows[0];
      if (old.kind === 'product') {
        const [managed] = await conn.execute('SELECT id FROM catalogue_products WHERE knowledge_id=? LIMIT 1', [old.id]);
        if (managed.length) { await conn.rollback(); return res.status(409).json({ error: 'Edit this product in the Products section.' }); }
      }
      const title = clean(req.body?.title ?? old.title, 200);
      const sourceName = clean(req.body?.sourceName ?? old.source_name, 255);
      const status = req.body?.status ?? old.status;
      const content = old.kind === 'document' ? old.content : (req.body?.content ?? old.content);
      if (!title || !KNOWLEDGE_STATUSES.has(status) || typeof content !== 'string' || !content.trim() || (old.kind !== 'document' && content.length > 30000)) { await conn.rollback(); return res.status(400).json({ error: 'Complete the knowledge fields.' }); }
      await conn.execute('UPDATE knowledge_items SET title=?,source_name=?,status=?,content=? WHERE id=?', [title,sourceName,status,content.trim(),old.id]);
      await indexChunks(conn, old.id, `${title}\n${content}`);
      await conn.commit();
      res.json({ ok: true });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  }));
  app.get('/api/admin/products', protectedStaff, asyncRoute(async (req, res) => {
    const items = await listAdminProducts(pool);
    res.json({ items, total: items.length, companies: catalogueMeta.companies.map((company) => ({ id: company.id, name: company.name, page: company.page })) });
  }));
  app.get('/api/admin/products/:id', protectedStaff, asyncRoute(async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Product not found.' });
    const product = await getAdminProduct(pool, req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product });
  }));
  app.post('/api/admin/products', csrf, protectedStaff, productUpload.single('image'), asyncRoute(async (req, res) => {
    let stored = null;
    try {
      if (req.file) {
        await limit(`upload:product:${req.staff.id}`, 30, 3600);
        stored = await storeProductImage(req.file.buffer, settings.uploadDir);
      }
      const result = await createProduct(pool, productPayload(req.body), stored
        ? { imageName: stored.filename, imageSource: 'upload' }
        : { imageName: '', imageSource: 'asset' });
      res.status(201).json({ ok: true, ...result });
    } catch (error) {
      if (stored) await deleteProductImage(stored.filename, settings.uploadDir).catch(() => {});
      throw error;
    }
  }));
  app.patch('/api/admin/products/:id', csrf, protectedStaff, productUpload.single('image'), asyncRoute(async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Product not found.' });
    let stored = null;
    try {
      if (req.file) {
        await limit(`upload:product:${req.staff.id}`, 30, 3600);
        stored = await storeProductImage(req.file.buffer, settings.uploadDir);
      }
      const result = await updateProduct(pool, req.params.id, productPayload(req.body), stored
        ? { imageName: stored.filename, imageSource: 'upload' }
        : {});
      if (!result) {
        if (stored) await deleteProductImage(stored.filename, settings.uploadDir).catch(() => {});
        return res.status(404).json({ error: 'Product not found.' });
      }
      if (stored && result.previousImageSource === 'upload' && result.previousImage !== stored.filename) {
        await deleteProductImage(result.previousImage, settings.uploadDir).catch(() => {});
      }
      res.json({ ok: true, id: result.id, knowledgeId: result.knowledgeId, slug: result.slug });
    } catch (error) {
      if (stored) await deleteProductImage(stored.filename, settings.uploadDir).catch(() => {});
      throw error;
    }
  }));
  app.delete('/api/admin/products/:id', csrf, protectedStaff, asyncRoute(async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Product not found.' });
    const result = await deleteProduct(pool, req.params.id);
    if (!result) return res.status(404).json({ error: 'Product not found.' });
    if (result.previousImageSource === 'upload') {
      await deleteProductImage(result.previousImage, settings.uploadDir).catch(() => {});
    }
    res.json({ ok: true });
  }));
  app.post('/api/admin/documents', csrf, protectedStaff, upload.single('file'), asyncRoute(async (req, res) => {
    const title = clean(req.body?.title, 200);
    const sourceName = clean(req.body?.sourceName, 255);
    const status = req.body?.status || 'draft';
    if (!title || !req.file || !KNOWLEDGE_STATUSES.has(status)) return res.status(400).json({ error: 'Choose a PDF and enter a title.' });
    await limit(`upload:staff:${req.staff.id}`, 20, 3600);
    let document;
    try { document = await extractPdf(req.file.buffer, settings.uploadDir); }
    catch (error) { return res.status(400).json({ error: error.message || 'Could not read this PDF.' }); }
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [result] = await conn.execute('INSERT INTO knowledge_items (title,kind,content,source_name,status,storage_name,original_filename) VALUES (?,\'document\',?,?,?,?,?)', [title,document.text,sourceName,status,document.filename,clean(req.file.originalname,255)]);
      await indexChunks(conn, result.insertId, `${title}\n${document.text}`);
      await conn.commit();
      res.status(201).json({ ok: true, id: String(result.insertId) });
    } catch (error) {
      if (conn) await conn.rollback().catch(() => {});
      await fs.unlink(path.join(settings.uploadDir, document.filename)).catch(() => {});
      throw error;
    } finally { if (conn) conn.release(); }
  }));

  app.get('/media/products/:file', (req, res, next) => {
    if (!PRODUCT_IMAGE.test(req.params.file)) return next();
    const type = mediaType(req.params.file);
    if (!type) return next();
    res.set({
      'Content-Type': type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin'
    });
    res.sendFile(path.join(productImageDir(settings.uploadDir), req.params.file), (error) => {
      if (!error) return;
      if (res.headersSent) return;
      if (error.code === 'ENOENT') return res.status(404).json({ error: 'Not found.' });
      next(error);
    });
  });

  app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(ROOT, 'admin', 'index.html')));
  app.get('/admin/vendor/quill.js', (req, res) => res.sendFile(path.join(ROOT, 'node_modules', 'quill', 'dist', 'quill.js')));
  app.get('/admin/vendor/quill.snow.css', (req, res) => res.sendFile(path.join(ROOT, 'node_modules', 'quill', 'dist', 'quill.snow.css')));
  app.get('/admin/admin.js', (req, res) => res.sendFile(path.join(ROOT, 'admin', 'admin.js')));
  app.get('/admin/admin.css', (req, res) => res.sendFile(path.join(ROOT, 'admin', 'admin.css')));
  // Serve the same document root locally and on Plesk.
  const siteRoot = settings.publicDir;
  app.use('/assets', express.static(path.join(siteRoot, 'assets'), { dotfiles: 'deny', index: false, fallthrough: false }));
  app.get('/', (req, res) => res.sendFile(path.join(siteRoot, 'index.html')));
  app.get('/:page', (req, res, next) => {
    if (!req.params.page.endsWith('.html') || !/^[a-z0-9-]+\.html$/.test(req.params.page)) return next();
    if (!settings.production && !ALLOWED_PAGES.has(req.params.page)) return next();
    res.sendFile(path.join(siteRoot, req.params.page));
  });
  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The file is too large.' : 'The upload is invalid.' });
    if (error.status === 429) return res.status(429).json({ error: error.message });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'Invalid request.' });
    if (typeof error.publicMessage === 'string' && error.status >= 400 && error.status < 500) return res.status(error.status).json({ error: error.publicMessage });
    console.error('Request failed:', error.code || error.name || 'error');
    res.status(error.status >= 400 && error.status < 500 ? error.status : 500).json({ error: 'The service is unavailable. Please try again or contact the team.' });
  });
  return app;
}

module.exports = { createApp, config };
