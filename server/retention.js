'use strict';

const RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

async function purgeExpiredMessages(pool) {
  const [result] = await pool.execute(
    `DELETE m FROM messages m JOIN conversations c ON c.id=m.conversation_id
     WHERE c.created_at<=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ${RETENTION_DAYS} DAY)`
  );
  return Number(result.affectedRows || 0);
}

function startRetention(pool) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await purgeExpiredMessages(pool); }
    catch (error) { console.error('Message retention cleanup failed:', error.code || error.message); }
    finally { running = false; }
  };
  run();
  const timer = setInterval(run, CLEANUP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { RETENTION_DAYS, CLEANUP_INTERVAL_MS, purgeExpiredMessages, startRetention };
