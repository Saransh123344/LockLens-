// backend/src/config/seed.js
// Run this once with: node src/config/seed.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');

const db = getDb();

const users = [
  { name: 'Admin User', email: 'admin@locklens.com', password: 'admin123', role: 'admin' },
  { name: 'Admin User', email: 'admin1@locklens.com', password: 'admin123', role: 'admin' },
  { name: 'Test Admin User', email: '1', password: '1', role: 'admin' },
  { name: 'Dr. Smith', email: 'examiner@locklens.com', password: 'examiner123', role: 'examiner' },
  { name: 'Dr. James', email: 'examiner1@locklens.com', password: 'examiner123', role: 'examiner' },
  { name: 'Alice Student', email: 'alice@locklens.com', password: 'student123', role: 'student' },
  { name: 'Bob Student', email: 'bob@locklens.com', password: 'student123', role: 'student' },
  { name: 'Candy Student', email: 'candy@locklens.com', password: 'student123', role: 'student' },
];

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (id, name, email, password_hash, role)
  VALUES (?, ?, ?, ?, ?)
`);

for (const u of users) {
  const hash = bcrypt.hashSync(u.password, 10);
  insertUser.run(uuidv4(), u.name, u.email, hash, u.role);
  console.log(`[Seed] Created ${u.role}: ${u.email} / ${u.password}`);
}

console.log('\n✅ Seed complete. Use the credentials above to log in.');
process.exit(0);
