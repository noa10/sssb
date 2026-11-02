const test = require('node:test');
const assert = require('node:assert/strict');
const { requiresHandoff, filterAnswer, HANDOFF } = require('../server/ai');
const { searchKnowledge, extractPdf } = require('../server/knowledge');

// These checks do not replace an integration test against MariaDB 10.5.
test('commercial claims are routed to staff', () => {
  for (const question of ['When will it arrive?', 'How many ringgit for a Zodiac?', 'Can you get it to me by Friday?', 'Berapa harga dan stok?', 'How soon can you deliver it?']) {
    assert.equal(requiresHandoff(question), true, question);
  }
  assert.equal(requiresHandoff('How long does the battery last?'), false);
  assert.equal(requiresHandoff('What is the battery runtime?'), false);
  assert.equal(filterAnswer('The price is RM 12,000.'), HANDOFF);
  assert.equal(filterAnswer('The system supports front mounting.'), 'The system supports front mounting.');
});

test('retrieval includes short product codes and only published records', async () => {
  let statement = '';
  let params = [];
  const pool = { async execute(sql, values) { statement = sql; params = values; return [[]]; } };
  await searchKnowledge(pool, 'What is MC-4?');
  assert.match(statement, /k\.status='published'/);
  assert.match(statement, /ORDER BY \(\(CASE WHEN/);
  assert.equal(params.filter((value) => value === '%mc-4%').length, 4);
});

test('retrieval retries only unambiguous title typos and keeps model codes exact', async () => {
  const queries = [];
  const pool = {
    async execute(sql, values = []) {
      queries.push({ sql, values });
      if (sql.startsWith('SELECT DISTINCT title')) {
        assert.match(sql, /status='published'/);
        return [[{ title: 'Zodiac Nautic' }, { title: 'Shadow equipment' }, { title: 'Shade equipment' }]];
      }
      if (values.includes('%zodiac%')) return [[{ title: 'Zodiac Nautic', source_name: 'Catalogue', content: 'Approved product details.' }]];
      return [[]];
    }
  };
  assert.equal((await searchKnowledge(pool, 'zodic'))[0].title, 'Zodiac Nautic');
  assert.ok(queries.some(({ values }) => values.includes('%zodiac%')));
  queries.length = 0;
  assert.deepEqual(await searchKnowledge(pool, 'shado'), []);
  assert.equal(queries.filter(({ sql }) => sql.includes('FROM knowledge_chunks')).length, 1);
  queries.length = 0;
  assert.deepEqual(await searchKnowledge(pool, 'MC-5'), []);
  assert.equal(queries.length, 1);
});

test('PDF extraction rejects invalid files', async () => {
  await assert.rejects(extractPdf(Buffer.from('not a pdf'), 'unused'), /valid PDF/);
});

test('PDF extraction rejects empty pages despite page labels', async () => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 4 /Kids [3 0 R 4 0 R 5 0 R 6 0 R] >>',
    ...Array(4).fill('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>')
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await assert.rejects(extractPdf(Buffer.from(pdf), 'unused'), /No readable text/);
});
