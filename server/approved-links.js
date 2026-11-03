'use strict';

// Match only complete HTTPS destinations; other schemes are never made clickable.
const URL_PATTERN = /https:\/\/[^\s<>"'`()[\]{}]+/gi;

function urlsIn(text) {
  const urls = [];
  for (const match of String(text || '').matchAll(URL_PATTERN)) {
    const raw = match[0].replace(/[.,!?;:]+$/, '');
    if (raw.length > 2048) continue;
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' && !url.username && !url.password) urls.push({ raw, href: url.href });
    } catch { /* Invalid destinations remain plain text. */ }
  }
  return urls;
}

async function addApprovedLinks(pool, messages) {
  const candidates = new Map();
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') continue;
    for (const url of urlsIn(message.content)) {
      if (!candidates.has(url.href)) candidates.set(url.href, url.raw);
      if (candidates.size >= 200) break;
    }
    if (candidates.size >= 200) break;
  }
  if (!candidates.size) return messages;

  const allowed = new Set();
  const values = [...candidates.values()];
  for (let index = 0; index < values.length; index += 50) {
    const batch = values.slice(index, index + 50);
    const where = batch.map(() => 'LOCATE(?,k.content)>0').join(' OR ');
    const [rows] = await pool.execute(
      `SELECT k.content FROM knowledge_items k WHERE k.status='published' AND (${where})`, batch
    );
    for (const row of rows) {
      for (const url of urlsIn(row.content)) {
        if (candidates.has(url.href)) allowed.add(url.href);
      }
    }
  }
  return messages.map((message) => {
    if (message.role !== 'assistant') return message;
    const links = [...new Set(urlsIn(message.content).map((url) => url.href).filter((url) => allowed.has(url)))];
    return links.length ? { ...message, approvedLinks: links } : message;
  });
}

module.exports = { addApprovedLinks };
