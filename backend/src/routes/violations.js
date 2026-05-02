// backend/src/routes/violations.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/violations - log a violation
router.post('/', authMiddleware(['student']), (req, res) => {
  const { student_session_id, type, details, screenshot_url } = req.body;
  if (!student_session_id || !type) return res.status(400).json({ error: 'student_session_id and type required' });

  const db = getDb();
  const ss = db.prepare('SELECT * FROM student_sessions WHERE id = ? AND student_id = ?').get(student_session_id, req.user.id);
  if (!ss) return res.status(404).json({ error: 'Student session not found' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO violations (id, student_session_id, session_id, student_id, type, details, screenshot_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, student_session_id, ss.session_id, req.user.id, type, details || '', screenshot_url || null);

  // Increment violation count
  db.prepare('UPDATE student_sessions SET violation_count = violation_count + 1, flagged = 1 WHERE id = ?').run(student_session_id);

  const violation = db.prepare('SELECT * FROM violations WHERE id = ?').get(id);

  // Emit to examiner's room in real time
  req.app.get('io').to(`session:${ss.session_id}`).emit('violation:new', {
    ...violation,
    student_name: req.user.name,
    student_email: req.user.email
  });

  res.status(201).json(violation);
});

// GET /api/violations/session/:sessionId - get all violations for a session
router.get('/session/:sessionId', authMiddleware(['examiner', 'admin']), (req, res) => {
  const db = getDb();
  const violations = db.prepare(`
    SELECT v.*, u.name as student_name, u.email as student_email
    FROM violations v
    JOIN users u ON v.student_id = u.id
    WHERE v.session_id = ?
    ORDER BY v.timestamp DESC
  `).all(req.params.sessionId);
  res.json(violations);
});

// GET /api/violations/student/:ssId - get violations for a student session
router.get('/student/:ssId', authMiddleware(['examiner', 'admin', 'student']), (req, res) => {
  const db = getDb();
  const violations = db.prepare('SELECT * FROM violations WHERE student_session_id = ? ORDER BY timestamp DESC').all(req.params.ssId);
  res.json(violations);
});

module.exports = router;
