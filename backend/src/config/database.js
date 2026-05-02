// backend/src/config/database.js
const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './locklens.db';
let db;

function getDb() {
  if (!db) {
    db = new Database(path.resolve(DB_PATH));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  // Core tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','examiner','student')),
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS exams (
      id TEXT PRIMARY KEY,
      exam_code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      duration_minutes INTEGER NOT NULL,
      feature_bitmask INTEGER NOT NULL DEFAULT 0,
      questions TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL,
      locked INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS allowed_students (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      email TEXT NOT NULL,
      UNIQUE(exam_id, email),
      FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS exam_assignments (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      examiner_id TEXT NOT NULL,
      UNIQUE(exam_id, examiner_id),
      FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
      FOREIGN KEY (examiner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      examiner_id TEXT,
      status TEXT NOT NULL DEFAULT 'locked' CHECK(status IN ('locked','active','ended')),
      started_at INTEGER,
      ended_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (exam_id) REFERENCES exams(id)
    );

    CREATE TABLE IF NOT EXISTS student_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','submitted','terminated')),
      answers TEXT NOT NULL DEFAULT '{}',
      score INTEGER,
      total_points INTEGER,
      violation_count INTEGER DEFAULT 0,
      flagged INTEGER DEFAULT 0,
      joined_at INTEGER DEFAULT (unixepoch()),
      submitted_at INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (student_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS violations (
      id TEXT PRIMARY KEY,
      student_session_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      type TEXT NOT NULL,
      details TEXT,
      screenshot_url TEXT,
      timestamp INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (student_session_id) REFERENCES student_sessions(id)
    );
  `);

  // Safe migrations for existing DBs
  const safeAlter = (sql) => { try { db.exec(sql); } catch(e) { /* column exists */ } };
  safeAlter("ALTER TABLE exams ADD COLUMN locked INTEGER DEFAULT 0");

  console.log('[DB] Schema ready');
}

module.exports = { getDb };
