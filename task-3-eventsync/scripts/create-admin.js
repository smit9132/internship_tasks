require('dotenv').config();
const readline = require('node:readline');
const mongoose = require('mongoose');
const User = require('../models/User');
const { connectDatabase } = require('../config/database');

async function hiddenPrompt(label) {
  if (!process.stdin.isTTY) throw new Error('Run this command from an interactive terminal so the password can be entered securely.');
  return new Promise((resolve) => {
    process.stdout.write(label);
    let value = '';
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (key) => {
      if (key.toString() === '\u0003') process.exit(130);
      if (key.toString() === '\r' || key.toString() === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (key.toString() === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += key.toString();
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: npm run admin:create -- admin@example.com');
  const name = (await hiddenPrompt('Admin display name: ')).trim();
  const password = await hiddenPrompt('Admin password (10+ characters): ');
  if (name.length < 2 || name.length > 80 || password.length < 10 || password.length > 128) throw new Error('Name or password does not meet the required length.');
  await connectDatabase();
  const existing = await User.findOne({ email });
  if (existing) throw new Error('An account already exists for this email. Use the protected admin role management interface instead.');
  const user = await User.create({ name, email, password, role: 'admin' });
  console.log(`Administrator created for ${user.email}. Keep these credentials private.`);
}

main().catch((error) => {
  console.error(`Admin setup failed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
