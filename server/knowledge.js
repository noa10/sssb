const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { isOneTypo } = require('./text');

function chunkText(text) {
  const clean = String(text || '').replace(/\r/g, '').replace(/[\t ]+/g, ' ').trim();
  const result = [];
  for (let offset = 0; offset < clean.length; offset += 1400) {
    result.push(clean.slice(offset, offset + 1600));
    if (result.length >= 2000) throw new Error('Document text is too long');
  }
  return result;
}

async function indexChunks(conn, id, text) {
  await conn.execute('DELETE FROM knowledge_chunks WHERE knowledge_id=?', [id]);
  const chunks = chunkText(text);
  for (let i = 0; i < chunks.length; i++) {
    await conn.execute('INSERT INTO knowledge_chunks (knowledge_id,chunk_index,content) VALUES (?,?,?)', [id, i, chunks[i]]);
  }
}

async function extractPdf(buffer, uploadDir) {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Choose a valid PDF file.');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: true });
  let text = '';
  let extractedLength = 0;
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 150) throw new Error('This PDF exceeds the document limit.');
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      const pageText = content.items.map((item) => item.str || '').join(' ').trim();
      extractedLength += pageText.length;
      if (pageText) text += `\n[Page ${page}]\n${pageText}`;
      if (text.length > 1000000) throw new Error('This PDF exceeds the document limit.');
    }
  } finally { await task.destroy(); }
  text = text.trim();
  if (extractedLength < 25) throw new Error('No readable text was found in this PDF.');
  await fs.mkdir(uploadDir, { recursive: true, mode: 0o700 });
  const filename = crypto.randomUUID() + '.pdf';
  await fs.writeFile(path.join(uploadDir, filename), buffer, { mode: 0o600, flag: 'wx' });
  return { filename, text };
}

async function searchKnowledge(pool, message, correctTypos = true) {
  const terms = [...new Set((message.toLowerCase().match(/[\p{L}\p{N}]+(?:[-.][\p{L}\p{N}]+)*/gu) || []).filter((word) => (word.length >= 2 || /\d/.test(word)) && !['the','and','for','with','what','how','are','can','you','tell','about','please','your','does','have','this','that','from','which','product','is','of','me','feature','features','spec','specs','specification','specifications'].includes(word)))].slice(-12).reverse();
  if (!terms.length) return [];
  // Escape LIKE wildcards and require an exact substring for short model codes such as MC-4.
  const where = terms.map(() => '(c.content LIKE ? OR k.title LIKE ?)').join(' OR ');
  const params = terms.flatMap((word) => {
    const pattern = `%${word.replace(/[\\%_]/g, '\\$&')}%`;
    return [pattern, pattern];
  });
  // Product names in titles are more specific than mentions in company profiles.
  const score = terms.map(() => '(CASE WHEN k.title LIKE ? THEN 3 ELSE 0 END + CASE WHEN c.content LIKE ? THEN 1 ELSE 0 END)').join(' + ');
  const [rows] = await pool.execute(
    `SELECT k.id,k.title,k.source_name,c.content FROM knowledge_chunks c
     JOIN knowledge_items k ON k.id=c.knowledge_id
     WHERE k.status='published' AND (${where})
     ORDER BY (${score}) DESC,k.updated_at DESC,c.chunk_index ASC LIMIT 6`, [...params, ...params]
  );
  if (rows.length) return rows.map((r) => ({ title: r.title, sourceName: r.source_name, content: r.content }));

  // Retry only unambiguous one-character mistakes in published title words.
  // Product codes and numbers remain exact, so different models cannot be conflated.
  const words = terms.filter((term) => /^[a-z]{5,32}$/.test(term));
  if (!correctTypos || !words.length) return [];
  const [titles] = await pool.execute("SELECT DISTINCT title FROM knowledge_items WHERE status='published' ORDER BY title LIMIT 500");
  const titleWords = new Set(titles.flatMap((row) => (row.title.toLowerCase().match(/[a-z]{5,32}/g) || [])));
  const corrections = words.flatMap((word) => {
    if (titleWords.has(word)) return [];
    const matches = [...titleWords].filter((candidate) => isOneTypo(word, candidate));
    return matches.length === 1 ? matches : [];
  });
  return corrections.length ? searchKnowledge(pool, `${message} ${corrections.join(' ')}`, false) : [];
}

module.exports = { chunkText, indexChunks, extractPdf, searchKnowledge };
