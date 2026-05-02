// backend/src/routes/exams.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { generateExamId, decodeExamId } = require('../utils/examId');

const router = express.Router();

// =============================================================================
// Named / specific routes BEFORE parameterised /:id routes
// =============================================================================

// GET /api/exams  — admin sees own exams, examiner sees assigned
router.get('/', authMiddleware(['admin','examiner']), (req, res) => {
  const db = getDb();
  let exams;
  if (req.user.role === 'admin') {
    exams = db.prepare(`
      SELECT e.*, u.name as creator_name
      FROM exams e JOIN users u ON e.created_by = u.id
      WHERE e.created_by = ? ORDER BY e.created_at DESC
    `).all(req.user.id);
  } else {
    exams = db.prepare(`
      SELECT e.*, u.name as creator_name
      FROM exams e
      JOIN exam_assignments ea ON e.id = ea.exam_id
      JOIN users u ON e.created_by = u.id
      WHERE ea.examiner_id = ? ORDER BY e.created_at DESC
    `).all(req.user.id);
  }
  exams = exams.map(e => ({
    ...e,
    questions: JSON.parse(e.questions || '[]'),
    allowed_count: db.prepare('SELECT COUNT(*) as c FROM allowed_students WHERE exam_id=?').get(e.id)?.c || 0
  }));
  res.json(exams);
});

// GET /api/exams/decode/:code  — public, called by student to validate code
router.get('/decode/:code', (req, res) => {
  const code = req.params.code.toUpperCase().trim();
  const decoded = decodeExamId(code);
  if (!decoded) return res.status(400).json({ error: 'Invalid exam code format. Expected: LL-XXXXXXXX-XXXX-XXX' });

  const db = getDb();
  const exam = db.prepare(
    'SELECT id, title, description, duration_minutes, feature_bitmask, questions FROM exams WHERE exam_code = ?'
  ).get(code);
  if (!exam) return res.status(404).json({ error: 'Exam not found. Check the code and try again.' });

  // Parse questions JSON and sanitize (strip correct_answer so student can't cheat via devtools)
  let questions = [];
  try {
    questions = JSON.parse(exam.questions || '[]').map(q => ({
      id: q.id,
      question: q.question,
      options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
      points: q.points,
      // Deliberately omit correct_answer
    }));
  } catch { questions = []; }

  res.json({ ...exam, questions, decoded });
});

// POST /api/exams/validate-student  — student checks if they're allowed before joining
router.post('/validate-student', authMiddleware(['student']), (req, res) => {
  const { exam_code } = req.body;
  if (!exam_code) return res.status(400).json({ error: 'exam_code required' });

  const db = getDb();
  const code = exam_code.toUpperCase().trim();
  const exam = db.prepare('SELECT * FROM exams WHERE exam_code = ?').get(code);
  if (!exam) return res.status(404).json({ error: 'Invalid exam code.' });

  // Check if this exam has an allowed list
  const allowedCount = db.prepare('SELECT COUNT(*) as c FROM allowed_students WHERE exam_id=?').get(exam.id).c;
  if (allowedCount > 0) {
    const allowed = db.prepare('SELECT id FROM allowed_students WHERE exam_id=? AND LOWER(email)=LOWER(?)').get(exam.id, req.user.email);
    if (!allowed) {
      return res.status(403).json({ error: `You (${req.user.email}) are not on the allowed list for this exam. Contact your examiner.` });
    }
  }

  // Find the session
  const session = db.prepare("SELECT * FROM sessions WHERE exam_id=? AND status != 'ended' ORDER BY created_at DESC LIMIT 1").get(exam.id);
  if (!session) return res.status(404).json({ error: 'No session found for this exam.' });

  res.json({
    examId: exam.id,
    sessionId: session.id,
    title: exam.title,
    description: exam.description,
    duration_minutes: exam.duration_minutes,
    feature_bitmask: exam.feature_bitmask,
    session_status: session.status,
    open_to_all: allowedCount === 0
  });
});

// POST /api/exams  — create (admin only)
router.post('/', authMiddleware(['admin']), (req, res) => {
  const { title, description, duration_minutes, feature_bitmask, questions, allowed_emails } = req.body;
  console.log(`[Exams] Create request from ${req.user.email} (${req.user.role})`);

  if (!title || !duration_minutes || feature_bitmask === undefined) {
    return res.status(400).json({ error: 'title, duration_minutes, and feature_bitmask are required' });
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'At least one question is required' });
  }

  const db = getDb();
  const id = uuidv4();
  const exam_code = generateExamId(feature_bitmask, duration_minutes);

  db.prepare(`
    INSERT INTO exams (id, exam_code, title, description, duration_minutes, feature_bitmask, questions, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, exam_code, title, description || '', duration_minutes, feature_bitmask, JSON.stringify(questions), req.user.id);

  // Insert allowed students if provided
  if (Array.isArray(allowed_emails) && allowed_emails.length > 0) {
    const insertAllowed = db.prepare('INSERT OR IGNORE INTO allowed_students (id, exam_id, email) VALUES (?,?,?)');
    for (const email of allowed_emails) {
      const e = (email || '').trim().toLowerCase();
      if (e) insertAllowed.run(uuidv4(), id, e);
    }
  }

  // Create locked session
  const sessionId = uuidv4();
  db.prepare("INSERT INTO sessions (id, exam_id, status) VALUES (?, ?, 'locked')").run(sessionId, id);

  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
  console.log(`[Exams] ✅ Created exam "${title}" with code ${exam_code}`);
  res.status(201).json({ ...exam, questions: JSON.parse(exam.questions) });
});

// =============================================================================
// Parameterised routes — AFTER named routes
// =============================================================================

// GET /api/exams/:id
router.get('/:id', authMiddleware(['admin','examiner']), (req, res) => {
  const db = getDb();
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const allowed = db.prepare('SELECT email FROM allowed_students WHERE exam_id=?').all(exam.id);
  res.json({ ...exam, questions: JSON.parse(exam.questions || '[]'), allowed_emails: allowed.map(a=>a.email) });
});

// PUT /api/exams/:id  — update exam (admin, owner only, must not be locked)
router.put('/:id', authMiddleware(['admin']), (req, res) => {
  const { title, description, duration_minutes, feature_bitmask, questions, allowed_emails } = req.body;
  const db = getDb();
  const exam = db.prepare('SELECT * FROM exams WHERE id=? AND created_by=?').get(req.params.id, req.user.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found or not yours' });
  if (exam.locked) return res.status(403).json({ error: 'Exam is locked and cannot be edited' });

  db.prepare(`
    UPDATE exams SET title=?, description=?, duration_minutes=?, feature_bitmask=?, questions=? WHERE id=?
  `).run(title, description || '', duration_minutes, feature_bitmask, JSON.stringify(questions), req.params.id);

  // Replace allowed students
  db.prepare('DELETE FROM allowed_students WHERE exam_id=?').run(req.params.id);
  if (Array.isArray(allowed_emails) && allowed_emails.length > 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO allowed_students (id, exam_id, email) VALUES (?,?,?)');
    for (const email of allowed_emails) {
      const e = (email||'').trim().toLowerCase();
      if (e) ins.run(uuidv4(), req.params.id, e);
    }
  }

  const updated = db.prepare('SELECT * FROM exams WHERE id=?').get(req.params.id);
  const allowed = db.prepare('SELECT email FROM allowed_students WHERE exam_id=?').all(req.params.id);
  res.json({ ...updated, questions: JSON.parse(updated.questions), allowed_emails: allowed.map(a=>a.email) });
});

// POST /api/exams/:id/lock  — lock exam (admin only)
router.post('/:id/lock', authMiddleware(['admin']), (req, res) => {
  const db = getDb();
  const exam = db.prepare('SELECT * FROM exams WHERE id=? AND created_by=?').get(req.params.id, req.user.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  db.prepare('UPDATE exams SET locked=1 WHERE id=?').run(req.params.id);
  res.json({ message: 'Exam locked' });
});

// POST /api/exams/:id/unlock  — unlock exam (admin only)
router.post('/:id/unlock-exam', authMiddleware(['admin']), (req, res) => {
  const db = getDb();
  const exam = db.prepare('SELECT * FROM exams WHERE id=? AND created_by=?').get(req.params.id, req.user.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  db.prepare('UPDATE exams SET locked=0 WHERE id=?').run(req.params.id);
  res.json({ message: 'Exam unlocked' });
});

// DELETE /api/exams/:id
router.delete('/:id', authMiddleware(['admin']), (req, res) => {
  const db = getDb();
  const exam = db.prepare('SELECT * FROM exams WHERE id=? AND created_by=?').get(req.params.id, req.user.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  db.prepare('DELETE FROM exams WHERE id=?').run(req.params.id);
  res.json({ message: 'Exam deleted' });
});

// POST /api/exams/:id/assign  — assign examiner
router.post('/:id/assign', authMiddleware(['admin']), (req, res) => {
  const { examiner_id } = req.body;
  if (!examiner_id) return res.status(400).json({ error: 'examiner_id required' });

  const db = getDb();
  const exam = db.prepare('SELECT * FROM exams WHERE id=? AND created_by=?').get(req.params.id, req.user.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  if (exam.locked) return res.status(403).json({ error: 'Exam is locked. Unlock it first to reassign.' });

  const examiner = db.prepare("SELECT id FROM users WHERE id=? AND role='examiner'").get(examiner_id);
  if (!examiner) return res.status(404).json({ error: 'Examiner not found' });

  const existing = db.prepare('SELECT id FROM exam_assignments WHERE exam_id=? AND examiner_id=?').get(req.params.id, examiner_id);
  if (!existing) {
    db.prepare('INSERT INTO exam_assignments (id, exam_id, examiner_id) VALUES (?,?,?)').run(uuidv4(), req.params.id, examiner_id);
  }
  db.prepare("UPDATE sessions SET examiner_id=? WHERE exam_id=? AND examiner_id IS NULL").run(examiner_id, req.params.id);
  res.json({ message: 'Examiner assigned successfully' });
});

// GET /api/exams/:id/allowed-students
router.get('/:id/allowed-students', authMiddleware(['admin','examiner']), (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT email FROM allowed_students WHERE exam_id=? ORDER BY email').all(req.params.id);
  res.json({ emails: rows.map(r=>r.email), count: rows.length });
});

module.exports = router;
