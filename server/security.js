const crypto = require('node:crypto');
const argon2 = require('argon2');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const COOKIE_SESSION = 'sss_staff';
const COOKIE_VISITOR = 'sss_visitor';
const COOKIE_CSRF = 'sss_csrf';

function cookies(req) {
  const result = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    if (!result[name]) result[name] = part.slice(at + 1).trim();
  }
  return result;
}

function cookieOptions(maxAge) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge };
}

function clearCookie(res, name) {
  res.clearCookie(name, cookieOptions(0));
}

function csrfFor(env = process.env) {
  return function csrf(req, res, next) {
    const supplied = req.get('X-CSRF-Token') || '';
    const stored = cookies(req)[COOKIE_CSRF] || '';
    const origin = req.get('Origin');
    if (origin && (!env.APP_ORIGIN || origin !== env.APP_ORIGIN)) {
      return res.status(403).json({ error: 'Request origin not allowed.' });
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(supplied) || stored !== supplied) {
      return res.status(403).json({ error: 'Session verification failed. Refresh and try again.' });
    }
    next();
  };
}

function issueCsrf(req, res) {
  let value = cookies(req)[COOKIE_CSRF];
  if (!/^[A-Za-z0-9_-]{43}$/.test(value || '')) value = token();
  res.cookie(COOKIE_CSRF, value, cookieOptions(8 * 60 * 60 * 1000));
  res.set('Cache-Control', 'no-store').json({ csrfToken: value });
}

function staffAuth(pool) {
  return async (req, res, next) => {
    const value = cookies(req)[COOKIE_SESSION];
    if (!/^[A-Za-z0-9_-]{43}$/.test(value || '')) return res.status(401).json({ error: 'Sign in required.' });
    try {
      const [rows] = await pool.execute(
        `SELECT s.staff_id, u.email FROM staff_sessions s JOIN staff_users u ON u.id=s.staff_id
         WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3)
           AND s.last_seen_at>DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE) AND u.disabled=0`,
        [digest(value)]
      );
      if (!rows.length) return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
      await pool.execute('UPDATE staff_sessions SET last_seen_at=UTC_TIMESTAMP(3) WHERE token_hash=?', [digest(value)]);
      req.staff = { id: rows[0].staff_id, email: rows[0].email };
      next();
    } catch (error) { next(error); }
  };
}

async function consumeLimit(pool, key, maxHits, windowSeconds) {
  const hash = digest(key);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO rate_limits (bucket_hash,window_start,hits) VALUES (?,UTC_TIMESTAMP(3),0)
       ON DUPLICATE KEY UPDATE bucket_hash=bucket_hash`, [hash]
    );
    const [rows] = await conn.execute(
      'SELECT hits, window_start < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? SECOND) AS expired FROM rate_limits WHERE bucket_hash=? FOR UPDATE',
      [windowSeconds, hash]
    );
    const hits = rows[0].expired ? 1 : Number(rows[0].hits) + 1;
    await conn.execute(
      `UPDATE rate_limits SET hits=?, window_start=IF(?=1,UTC_TIMESTAMP(3),window_start) WHERE bucket_hash=?`,
      [hits, rows[0].expired ? 1 : 0, hash]
    );
    await conn.commit();
    return hits <= maxHits;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }
}

async function verifyPassword(hash, password) {
  try { return await argon2.verify(hash, password); } catch { return false; }
}

module.exports = { digest, token, cookies, cookieOptions, clearCookie, csrfFor, issueCsrf, staffAuth, consumeLimit, verifyPassword, COOKIE_SESSION, COOKIE_VISITOR, COOKIE_CSRF };
