// backend/src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'All fields required' });
  if (!['admin', 'examiner', 'student'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const hash = bcrypt.hashSync(password, 10);
  const id = uuidv4();
  db.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, email.toLowerCase().trim(), hash, role);

  const token = jwt.sign(
    { id, email: email.toLowerCase().trim(), name, role },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.status(201).json({ token, user: { id, name, email: email.toLowerCase().trim(), role } });
});

// GET /api/auth/me
router.get('/me', authMiddleware(), (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// GET /api/auth/users - admin only, list all users
router.get('/users', authMiddleware(['admin']), (req, res) => {
  const db = getDb();
  const { role } = req.query;
  let query = 'SELECT id, name, email, role, created_at FROM users';
  const params = [];
  if (role) { query += ' WHERE role = ?'; params.push(role); }
  query += ' ORDER BY created_at DESC';
  const users = db.prepare(query).all(...params);
  res.json(users);
});

module.exports = router;

// GET /api/auth/whoami  — debug: returns logged-in user's role
router.get('/whoami', authMiddleware(), (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role });
});
