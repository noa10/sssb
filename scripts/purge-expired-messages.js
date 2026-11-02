'use strict';

const { createPool } = require('../server/db');
const { purgeExpiredMessages } = require('../server/retention');

async function main() {
  const pool = createPool();
  try {
    const count = await purgeExpiredMessages(pool);
    console.log(`Deleted ${count} expired chat messages.`);
  } finally { await pool.end(); }
}

main().catch((error) => { console.error('Message cleanup failed:', error.code || error.message); process.exitCode = 1; });
