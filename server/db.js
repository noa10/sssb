const mysql = require('mysql2/promise');

function databaseConfig() {
  const required = ['DB_HOST', 'DB_USER', 'DB_NAME'];
  for (const name of required) {
    if (!process.env[name]) throw new Error(`${name} must be configured`);
  }
  if (process.env.DB_PASSWORD === undefined) throw new Error('DB_PASSWORD must be configured');
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    timezone: 'Z',
    connectionLimit: 8,
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
  };
}

function createPool() {
  const pool = mysql.createPool(databaseConfig());
  const getConnection = pool.getConnection.bind(pool);
  pool.getConnection = async () => {
    const conn = await getConnection();
    try {
      await conn.query("SET time_zone = '+00:00'");
      return conn;
    } catch (error) {
      conn.release();
      throw error;
    }
  };
  // Pool-level helpers otherwise bypass the wrapped getConnection.
  pool.execute = async (...args) => {
    const conn = await pool.getConnection();
    try { return await conn.execute(...args); } finally { conn.release(); }
  };
  pool.query = async (...args) => {
    const conn = await pool.getConnection();
    try { return await conn.query(...args); } finally { conn.release(); }
  };
  return pool;
}

module.exports = { createPool, databaseConfig };
