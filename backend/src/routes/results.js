// backend/src/routes/results.js
const express = require('express');
const { getDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/results/session/:sessionId - all results for a session
router.get('/session/:sessionId', authMiddleware(['examiner', 'admin']), (req, res) => {
  const db = getDb();
  const results = db.prepare(`
    SELECT ss.*, u.name as student_name, u.email as student_email,
           (SELECT COUNT(*) FROM violations WHERE student_session_id = ss.id) as violation_count
    FROM student_sessions ss
    JOIN users u ON ss.student_id = u.id
    WHERE ss.session_id = ?
    ORDER BY ss.score DESC NULLS LAST
  `).all(req.params.sessionId);

  res.json(results.map(r => ({ ...r, answers: JSON.parse(r.answers || '{}') })));
});

// GET /api/results/student/:ssId - student's own result
router.get('/student/:ssId', authMiddleware(['student', 'examiner', 'admin']), (req, res) => {
  const db = getDb();
  const ss = db.prepare('SELECT * FROM student_sessions WHERE id = ?').get(req.params.ssId);
  if (!ss) return res.status(404).json({ error: 'Not found' });

  if (req.user.role === 'student' && ss.student_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(ss.session_id);
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(session.exam_id);
  const violations = db.prepare('SELECT * FROM violations WHERE student_session_id = ? ORDER BY timestamp ASC').all(req.params.ssId);
  const questions = JSON.parse(exam.questions || '[]');
  const answers = JSON.parse(ss.answers || '{}');

  // Build question results
  const questionResults = questions.map(q => ({
    id: q.id,
    question: q.question,
    options: q.options,
    points: q.points || 1,
    student_answer: answers[q.id] || null,
    correct_answer: q.correct_answer,
    is_correct: answers[q.id] === q.correct_answer
  }));

  res.json({
    student_session: { ...ss, answers },
    exam: { id: exam.id, title: exam.title, description: exam.description },
    question_results: questionResults,
    violations,
    score: ss.score,
    total_points: ss.total_points,
    percentage: ss.total_points > 0 ? Math.round((ss.score / ss.total_points) * 100) : 0
  });
});

module.exports = router;
