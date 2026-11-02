const readline = require('node:readline');
const argon2 = require('argon2');
const { createPool } = require('../server/db');

async function question(prompt, secret = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (secret) {
    rl._writeToOutput = function (text) { if (!rl.hidden) rl.output.write(text); };
    process.stdout.write(prompt);
    rl.hidden = true;
  }
  return new Promise((resolve) => rl.question(secret ? '' : prompt, (answer) => { rl.close(); if (secret) process.stdout.write('\n'); resolve(answer); }));
}

async function main() {
  if (!process.stdin.isTTY) throw new Error('Run this command in an interactive terminal.');
  const email = (await question('Staff email: ')).trim().toLowerCase();
  const password = await question('New password (at least 14 characters): ', true);
  const confirmation = await question('Confirm password: ', true);
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email) || email.length > 254) throw new Error('Enter a valid ASCII email address.');
  if (password.length < 14 || password.length > 1024 || password !== confirmation) throw new Error('Passwords must match and have at least 14 characters.');
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const pool = createPool();
  try {
    await pool.execute('INSERT INTO staff_users (email,password_hash) VALUES (?,?)', [email, hash]);
    console.log('Staff account created.');
  } finally { await pool.end(); }
}
main().catch((error) => { console.error('Could not create account:', error.code === 'ER_DUP_ENTRY' ? 'This account already exists.' : error.message); process.exitCode = 1; });
