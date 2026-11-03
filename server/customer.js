'use strict';

const argon2 = require('argon2');
const { digest, token, cookies, cookieOptions, clearCookie, verifyPassword, COOKIE_VISITOR } = require('./security');

const COOKIE_CUSTOMER = 'sss_customer';
const SESSION_MS = 30 * 86400 * 1000;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$tKy1M8C9yGdCVIHXxg28pw$PJzmbL5y+LDetyis0KnARZKqzNUpCeyYLulHI+6eHuM';
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function publicError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  return error;
}

function publicCustomer(account) {
  return {
    email: account.email,
    name: account.name || '',
    phone: account.phone || '',
    company: account.company || ''
  };
}

function customerProfile(input) {
  return {
    name: typeof input?.name === 'string' ? input.name.trim() : '',
    phone: typeof input?.phone === 'string' ? input.phone.trim() : '',
    company: typeof input?.company === 'string' ? input.company.trim() : ''
  };
}

function validProfile(profile) {
  return !!profile.name && profile.name.length <= 120 &&
    !!profile.phone && profile.phone.length <= 50 &&
    !!profile.company && profile.company.length <= 160;
}

function createCustomerService(pool) {
  async function customer(req) {
    const value = cookies(req)[COOKIE_CUSTOMER];
    if (!TOKEN.test(value || '')) return null;
    const [rows] = await pool.execute(
      `SELECT u.id,u.email,u.name,u.phone,u.company FROM customer_sessions s JOIN customer_accounts u ON u.id=s.customer_id
       WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3) AND u.disabled=0`, [digest(value)]
    );
    return rows[0] || null;
  }

  async function guest(req, conn = pool, lock = false) {
    const value = cookies(req)[COOKIE_VISITOR];
    if (!TOKEN.test(value || '')) return null;
    const [rows] = await conn.execute(
      `SELECT * FROM conversations WHERE visitor_token_hash=? AND visitor_closed_at IS NULL
       AND created_at>DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
       AND NOT EXISTS (SELECT 1 FROM customer_conversations cc WHERE cc.conversation_id=conversations.id)
       LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [digest(value)]
    );
    return rows[0] || null;
  }

  async function activeForCustomer(customerId, conn = pool) {
    const [rows] = await conn.execute(
      `SELECT c.* FROM customer_conversations cc JOIN conversations c ON c.id=cc.conversation_id
       WHERE cc.customer_id=? AND c.visitor_closed_at IS NULL
       AND c.created_at>DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
       ORDER BY c.created_at DESC LIMIT 1`, [customerId]
    );
    return rows[0] || null;
  }

  async function conversation(req, account) {
    return account ? activeForCustomer(account.id) : guest(req);
  }

  async function linkGuest(req, account, conn) {
    const existing = await guest(req, conn, true);
    if (!existing) return false;
    if (existing.email.trim().toLowerCase() !== account.email) {
      throw publicError(409, 'This browser has an open chat with a different email. End that chat or use its email to sign in.');
    }
    if (await activeForCustomer(account.id, conn)) {
      throw publicError(409, 'Your account already has an active chat. End the guest chat before signing in.');
    }
    await conn.execute('INSERT INTO customer_conversations (conversation_id,customer_id) VALUES (?,?)', [existing.id, account.id]);
    return true;
  }

  async function newSession(req, account, conn) {
    const old = cookies(req)[COOKIE_CUSTOMER];
    if (TOKEN.test(old || '')) await conn.execute('DELETE FROM customer_sessions WHERE token_hash=?', [digest(old)]);
    const secret = token();
    await conn.execute(
      'INSERT INTO customer_sessions (token_hash,customer_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 DAY))',
      [digest(secret), account.id]
    );
    return secret;
  }

  function mount(app, csrf, limit) {
    app.get('/api/customer/session', asyncRoute(async (req, res) => {
      const account = await customer(req);
      res.json(account ? { authenticated: true, customer: publicCustomer(account) } : { authenticated: false });
    }));

    app.post('/api/customer/register', csrf, asyncRoute(async (req, res) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const { name, phone, company } = customerProfile(req.body);
      if (!EMAIL.test(email) || email.length > 254 ||
          !validProfile({ name, phone, company }) ||
          password.length < 8 || password.length > 1024) {
        return res.status(400).json({ error: 'Enter your name, a valid email, phone, company and a password of at least 8 characters.' });
      }
      await limit(`customer:register:ip:${req.ip}`, 12, 3600);
      await limit(`customer:register:email:${email}`, 6, 3600);
      const hash = await argon2.hash(password, { type: argon2.argon2id });
      const conn = await pool.getConnection();
      let secret;
      let linked;
      try {
        await conn.beginTransaction();
        const [saved] = await conn.execute(
          'INSERT INTO customer_accounts (email,password_hash,name,phone,company) VALUES (?,?,?,?,?)',
          [email, hash, name, phone, company]
        );
        const account = { id: saved.insertId, email, name, phone, company };
        linked = await linkGuest(req, account, conn);
        secret = await newSession(req, account, conn);
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
        throw error;
      } finally { conn.release(); }
      if (linked) clearCookie(res, COOKIE_VISITOR);
      res.cookie(COOKIE_CUSTOMER, secret, cookieOptions(SESSION_MS));
      res.status(201).json({ authenticated: true, customer: publicCustomer({ email, name, phone, company }), linked });
    }));

    app.post('/api/customer/login', csrf, asyncRoute(async (req, res) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!EMAIL.test(email) || email.length > 254 || !password || password.length > 1024) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      await limit(`customer:login:ip:${req.ip}`, 20, 900);
      await limit(`customer:login:email:${email}`, 8, 900);
      const [rows] = await pool.execute('SELECT id,email,name,phone,company,password_hash,disabled FROM customer_accounts WHERE email=?', [email]);
      const valid = await verifyPassword(rows[0]?.password_hash || DUMMY_PASSWORD_HASH, password);
      if (!rows.length || rows[0].disabled || !valid) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      const account = rows[0];
      const conn = await pool.getConnection();
      let secret;
      let linked;
      try {
        await conn.beginTransaction();
        const [locked] = await conn.execute('SELECT id FROM customer_accounts WHERE id=? AND disabled=0 FOR UPDATE', [account.id]);
        if (!locked.length) throw publicError(401, 'Invalid email or password.');
        linked = await linkGuest(req, account, conn);
        secret = await newSession(req, account, conn);
        await conn.commit();
      } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
      if (linked) clearCookie(res, COOKIE_VISITOR);
      res.cookie(COOKIE_CUSTOMER, secret, cookieOptions(SESSION_MS));
      res.json({ authenticated: true, customer: publicCustomer(account), linked });
    }));

    app.post('/api/customer/profile', csrf, asyncRoute(async (req, res) => {
      const account = await customer(req);
      if (!account) return res.status(401).json({ error: 'Sign in to update your account.' });
      const profile = customerProfile(req.body);
      if (!validProfile(profile)) {
        return res.status(400).json({ error: 'Enter your name, phone number and company.' });
      }
      await limit(`customer:profile:${account.id}`, 30, 3600);
      const conn = await pool.getConnection();
      let updated;
      try {
        await conn.beginTransaction();
        const [rows] = await conn.execute(
          'SELECT id,email,name,phone,company FROM customer_accounts WHERE id=? AND disabled=0 FOR UPDATE', [account.id]
        );
        if (!rows.length) {
          await conn.commit();
          return res.status(401).json({ error: 'Sign in again.' });
        }
        await conn.execute('UPDATE customer_accounts SET name=?,phone=?,company=? WHERE id=?',
          [profile.name, profile.phone, profile.company, account.id]);
        updated = { ...rows[0], ...profile };
        await conn.commit();
      } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
      res.json({ authenticated: true, customer: publicCustomer(updated) });
    }));

    app.post('/api/customer/logout', csrf, asyncRoute(async (req, res) => {
      const value = cookies(req)[COOKIE_CUSTOMER];
      if (TOKEN.test(value || '')) await pool.execute('DELETE FROM customer_sessions WHERE token_hash=?', [digest(value)]);
      clearCookie(res, COOKIE_CUSTOMER);
      clearCookie(res, COOKIE_VISITOR);
      res.json({ ok: true });
    }));
  }

  return { customer, guest, activeForCustomer, conversation, publicCustomer, mount };
}

module.exports = { createCustomerService, customerProfile, validProfile, COOKIE_CUSTOMER, SESSION_MS };
