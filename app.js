const { createPool } = require('./server/db');
const { createApp } = require('./server/app');
const { startRetention } = require('./server/retention');

const pool = createPool();
const app = createApp({ pool });
const stopRetention = startRetention(pool);
const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log('SSS application is listening.'));

async function shutdown() {
  stopRetention();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
