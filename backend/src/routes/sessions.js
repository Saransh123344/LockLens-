// backend/src/routes/sessions.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// =============================================================================
// CRITICAL: Named/specific routes MUST come before /:id parameterised routes.
// Express matches top-to-bottom. Without this order, "join-by-code" and
// "student" are treated as :id values and hit the examiner-only /:id route.
// =============================================================================

// GET /api/sessions
router.get('/', authMiddleware(['examiner', 'admin']), (req, res) => {
  const db = getDb();
  let sessions;
  if (req.user.role === 'examiner') {
    sessions = db.prepare(`
      SELECT s.*, e.title as exam_title, e.exam_code, e.duration_minutes, e.feature_bitmask
      FROM sessions s JOIN exams e ON s.exam_id = e.id
      WHERE s.examiner_id = ? ORDER BY s.created_at DESC
    `).all(req.user.id);
  } else {
    sessions = db.prepare(`
      SELECT s.*, e.title as exam_title, e.exam_code, e.duration_minutes, e.feature_bitmask
      FROM sessions s JOIN exams e ON s.exam_id = e.id
      WHERE e.created_by = ? ORDER BY s.created_at DESC
    `).all(req.user.id);
  }
  sessions = sessions.map(s => {
    const sc = db.prepare('SELECT COUNT(*) as cnt FROM student_sessions WHERE session_id = ?').get(s.id);
    const vc = db.prepare('SELECT COUNT(*) as cnt FROM violations WHERE session_id = ?').get(s.id);
    return { ...s, student_count: sc.cnt, total_violations: vc.cnt };
  });
  res.json(sessions);
});

// ── POST /api/sessions/join-by-code  (student) ───────────────────────────────
router.post('/join-by-code', authMiddleware(['student']), (req, res) => {
  const { exam_code } = req.body;
  if (!exam_code) return res.status(400).json({ error: 'exam_code required' });

  const db = getDb();
  const exam = db.prepare('SELECT * FROM exams WHERE exam_code = ?').get(exam_code.toUpperCase().trim());
  if (!exam) return res.status(404).json({ error: 'Invalid exam code. Please check and try again.' });

  const session = db.prepare(
    "SELECT * FROM sessions WHERE exam_id = ? AND status != 'ended' ORDER BY created_at DESC LIMIT 1"
  ).get(exam.id);
  if (!session) return res.status(404).json({ error: 'No active session found for this exam code.' });

  if (session.status === 'locked') {
    return res.status(403).json({
      error: 'Exam is locked. Wait for your examiner to start the session.',
      sessionStatus: 'locked',
      sessionId: session.id
    });
  }

  const existing = db.prepare(
    'SELECT * FROM student_sessions WHERE session_id = ? AND student_id = ?'
  ).get(session.id, req.user.id);

  if (existing) {
    if (existing.status === 'submitted' || existing.status === 'terminated') {
      return res.status(403).json({ error: 'You have already submitted this exam.' });
    }
    return res.json({ studentSessionId: existing.id, sessionId: session.id, examId: exam.id, resuming: true });
  }

  const ssId = uuidv4();
  db.prepare('INSERT INTO student_sessions (id, session_id, student_id) VALUES (?, ?, ?)').run(ssId, session.id, req.user.id);

  req.app.get('io').to(`session:${session.id}`).emit('student:joined', {
    studentSessionId: ssId,
    studentId: req.user.id,
    studentName: req.user.name,
    sessionId: session.id
  });

  res.json({ studentSessionId: ssId, sessionId: session.id, examId: exam.id, resuming: false });
});

// ── GET /api/sessions/student/:ssId/status  (student) ────────────────────────
router.get('/student/:ssId/status', authMiddleware(['student']), (req, res) => {
  const db = getDb();
  const ss = db.prepare('SELECT * FROM student_sessions WHERE id = ? AND student_id = ?').get(req.params.ssId, req.user.id);
  if (!ss) return res.status(404).json({ error: 'Student session not found' });
  const session = db.prepare('SELECT status FROM sessions WHERE id = ?').get(ss.session_id);
  res.json({ ...ss, session_status: session?.status });
});

// ── POST /api/sessions/student/:ssId/submit  (student) ───────────────────────
router.post('/student/:ssId/submit', authMiddleware(['student']), (req, res) => {
  const { answers } = req.body;
  const db = getDb();

  const ss = db.prepare('SELECT * FROM student_sessions WHERE id = ? AND student_id = ?').get(req.params.ssId, req.user.id);
  if (!ss) return res.status(404).json({ error: 'Student session not found' });
  if (ss.status !== 'in_progress') return res.status(400).json({ error: 'Exam already submitted' });

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(ss.session_id);
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(session.exam_id);
  const questions = JSON.parse(exam.questions || '[]');

  let score = 0, total = 0;
  for (const q of questions) {
    total += q.points || 1;
    if (answers && answers[q.id] === q.correct_answer) score += q.points || 1;
  }

  db.prepare(`
    UPDATE student_sessions
    SET status='submitted', answers=?, score=?, total_points=?, submitted_at=unixepoch()
    WHERE id=?
  `).run(JSON.stringify(answers || {}), score, total, req.params.ssId);

  req.app.get('io').to(`session:${ss.session_id}`).emit('student:submitted', {
    studentSessionId: req.params.ssId,
    studentId: req.user.id,
    score, total
  });

  res.json({ score, total, percentage: total > 0 ? Math.round((score / total) * 100) : 0 });
});

// =============================================================================
// Parameterised /:id routes — AFTER all named routes above
// =============================================================================

// GET /api/sessions/:id
router.get('/:id', authMiddleware(['examiner', 'admin']), (req, res) => {
  const db = getDb();
  const session = db.prepare(`
    SELECT s.*, e.title as exam_title, e.exam_code, e.duration_minutes, e.feature_bitmask, e.questions
    FROM sessions s JOIN exams e ON s.exam_id = e.id WHERE s.id = ?
  `).get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const students = db.prepare(`
    SELECT ss.*, u.name as student_name, u.email as student_email
    FROM student_sessions ss JOIN users u ON ss.student_id = u.id
    WHERE ss.session_id = ? ORDER BY ss.joined_at DESC
  `).all(req.params.id);

  res.json({ ...session, questions: JSON.parse(session.questions || '[]'), students });
});

// POST /api/sessions/:id/unlock
router.post('/:id/unlock', authMiddleware(['examiner', 'admin']), (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'locked') return res.status(400).json({ error: 'Session is not locked' });

  db.prepare("UPDATE sessions SET status='active', started_at=unixepoch() WHERE id=?").run(req.params.id);
  req.app.get('io').to(`session:${req.params.id}`).emit('session:unlocked', { sessionId: req.params.id });
  req.app.get('io').to(`exam:${session.exam_id}`).emit('session:unlocked', { sessionId: req.params.id, examId: session.exam_id });
  res.json({ message: 'Session unlocked', sessionId: req.params.id });
});

// POST /api/sessions/:id/end
router.post('/:id/end', authMiddleware(['examiner', 'admin']), (req, res) => {
  const db = getDb();
  db.prepare("UPDATE sessions SET status='ended', ended_at=unixepoch() WHERE id=?").run(req.params.id);
  db.prepare("UPDATE student_sessions SET status='submitted', submitted_at=unixepoch() WHERE session_id=? AND status='in_progress'").run(req.params.id);
  req.app.get('io').to(`session:${req.params.id}`).emit('session:ended', { sessionId: req.params.id });
  res.json({ message: 'Session ended' });
});

module.exports = router;
