// backend/src/sockets/index.js
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/database');

function initSockets(io) {
  // JWT middleware for socket auth
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = user;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const { id, name, role } = socket.user;
    console.log(`[WS] ${role} connected: ${name} (${id})`);

    // ----- EXAMINER: join session room to receive events -----
    socket.on('examiner:join', ({ sessionId }) => {
      if (socket.user.role !== 'examiner' && socket.user.role !== 'admin') return;
      socket.join(`session:${sessionId}`);
      console.log(`[WS] Examiner ${name} joined session room: ${sessionId}`);

      // Send current student list
      const db = getDb();
      const students = db.prepare(`
        SELECT ss.*, u.name as student_name, u.email as student_email
        FROM student_sessions ss JOIN users u ON ss.student_id = u.id
        WHERE ss.session_id = ?
      `).all(sessionId);
      socket.emit('session:students', students);
    });

    // ----- STUDENT: join session -----
    socket.on('student:join', ({ sessionId, studentSessionId }) => {
      if (socket.user.role !== 'student') return;
      socket.join(`session:${sessionId}`);
      socket.join(`student:${studentSessionId}`);

      // Notify examiner room
      io.to(`session:${sessionId}`).emit('student:online', {
        studentId: id,
        studentName: name,
        studentSessionId,
        timestamp: Date.now()
      });
      console.log(`[WS] Student ${name} joined session: ${sessionId}`);
    });

    // ----- STUDENT: heartbeat (live webcam frame as base64) -----
    socket.on('student:webcam_frame', ({ sessionId, studentSessionId, frame, timestamp }) => {
      if (socket.user.role !== 'student') return;
      // Forward frame to examiners in the session room
      socket.to(`session:${sessionId}`).emit('student:webcam_frame', {
        studentId: id,
        studentName: name,
        studentSessionId,
        frame,
        timestamp
      });
    });

    // ----- STUDENT: answer update (for live progress tracking) -----
    socket.on('student:answer_update', ({ sessionId, studentSessionId, questionCount, answeredCount }) => {
      if (socket.user.role !== 'student') return;
      io.to(`session:${sessionId}`).emit('student:progress', {
        studentId: id,
        studentSessionId,
        questionCount,
        answeredCount,
        timestamp: Date.now()
      });
    });

    // ----- EXAMINER: send warning to specific student -----
    socket.on('examiner:warn_student', ({ studentSessionId, message }) => {
      if (socket.user.role !== 'examiner' && socket.user.role !== 'admin') return;
      io.to(`student:${studentSessionId}`).emit('examiner:warning', {
        message,
        timestamp: Date.now()
      });
    });

    // ----- EXAMINER: terminate student session -----
    socket.on('examiner:terminate_student', ({ studentSessionId, sessionId }) => {
      if (socket.user.role !== 'examiner' && socket.user.role !== 'admin') return;
      const db = getDb();
      db.prepare("UPDATE student_sessions SET status = 'terminated', submitted_at = unixepoch() WHERE id = ?").run(studentSessionId);
      io.to(`student:${studentSessionId}`).emit('session:terminated', {
        reason: 'Terminated by examiner',
        timestamp: Date.now()
      });
    });

    // ----- STUDENT: time warning (forwarded from client) -----
    socket.on('student:time_warning', ({ sessionId, studentSessionId, timeLeft }) => {
      if (socket.user.role !== 'student') return;
      io.to(`session:${sessionId}`).emit('student:time_warning', {
        studentId: id, studentSessionId, timeLeft
      });
    });

    socket.on('disconnect', () => {
      console.log(`[WS] ${role} disconnected: ${name}`);
      // If student, notify examiners
      if (role === 'student') {
        // Rooms are auto-cleaned, but notify examiners
        for (const room of socket.rooms) {
          if (room.startsWith('session:')) {
            io.to(room).emit('student:offline', { studentId: id, studentName: name, timestamp: Date.now() });
          }
        }
      }
    });
  });
}

module.exports = { initSockets };
