# 🔒 LockLens — AI-Powered Secure Online Examination Platform

## Overview
LockLens is a full-stack proctored examination system with three portals:
- **Admin** — Create exams, configure 14 proctoring features, assign examiners
- **Examiner** — Unlock sessions, monitor live webcam feeds, review violations & results
- **Student** — Join exam by code, take locked-down MCQ exam with real-time proctoring

---

## Phase 1 Features (Delivered)
### Browser-Level Proctoring (7 features)
- ✅ Tab Switch Detection
- ✅ Focus Loss Detection
- ✅ Copy/Paste Blocking (keyboard + clipboard)
- ✅ Screen Share Blocking (API interception)
- ✅ Screenshot Blocking (PrintScreen key detection)
- ✅ Right-Click Disable
- ✅ Fullscreen Enforcement

### AI-Powered Proctoring (7 features)
- ✅ Object Detection via TensorFlow.js COCO-SSD (phones, books, etc.)
- ✅ Multiple Person Detection
- ✅ AI Tool Detection (DOM mutation + fetch interception)
- ✅ Eye Tracking via face-api.js landmarks
- ✅ Audio Monitoring via Web Audio API
- ✅ Face Absence Detection
- ⬜ Double Camera Angle (Phase 2 — requires WebRTC room)
- ⬜ Periodic Face Verification with ID matching (Phase 2 — requires reference photo upload)

### Architecture
- ✅ Encoded Exam ID (LL-XXXXXXXX-FFFF-DDD format)
- ✅ Real-time WebSocket violation streaming
- ✅ Live webcam frame forwarding to examiner
- ✅ Answer auto-save + server scoring
- ✅ Examiner warn/terminate student controls

---

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Backend | Node.js + Express + Socket.IO |
| Database | SQLite via better-sqlite3 |
| AI/ML | TensorFlow.js + COCO-SSD + face-api.js |
| Real-time | Socket.IO WebSockets |
| Auth | JWT (24h expiry) |

---

## ⚠️ Setup Instructions (What You Must Change)

### 1. Install prerequisites
```bash
node --version   # Requires Node.js 18+
npm --version    # Requires npm 9+
```

### 2. Backend Setup
```bash
cd backend
cp .env.example .env
# ⚠️ EDIT .env — change JWT_SECRET to a strong random string!

npm install
npm run seed     # Creates default users in SQLite DB
npm run dev      # Starts on http://localhost:4000
```

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev      # Starts on http://localhost:5173
```

### 4. Face-api.js Models (required for Eye Tracking feature)
Download model weights and place in `frontend/public/models/`:
```bash
cd frontend/public
mkdir models
# Download from: https://github.com/justadudewhohacks/face-api.js/tree/master/weights
# Required files:
#   tiny_face_detector_model-weights_manifest.json
#   tiny_face_detector_model-shard1
#   face_landmark_68_tiny_model-weights_manifest.json
#   face_landmark_68_tiny_model-shard1
```

---

## Default Credentials (after seeding)
| Role | Email | Password |
|------|-------|----------|
| Admin | admin@locklens.com | admin123 |
| Examiner | examiner@locklens.com | examiner123 |
| Student | student@locklens.com | student123 |

---

## Workflow
1. **Admin** logs in → Creates exam (title, duration, enable features) → Adds MCQ questions → Gets Exam Code
2. **Admin** assigns examiner to exam in Exam Library
3. **Examiner** logs in → Sees assigned session → Clicks "Unlock Exam"
4. **Student** logs in → Enters Exam Code → Passes preflight checks → Takes locked exam
5. **Examiner** monitors live webcam grid + violation feed in real time
6. Student submits → Auto-scored → Results available to both examiner and student

---

## Folder Structure
```
locklens/
├── backend/
│   ├── src/
│   │   ├── config/       # Database init + seed
│   │   ├── middleware/   # JWT auth
│   │   ├── routes/       # REST endpoints
│   │   ├── sockets/      # WebSocket handlers
│   │   ├── utils/        # Exam ID encoder/decoder
│   │   └── index.js      # Entry point
│   ├── .env.example      # ⚠️ Copy to .env and edit
│   └── package.json
└── frontend/
    ├── public/
    │   └── models/       # ⚠️ Place face-api.js model files here
    ├── src/
    │   ├── contexts/     # Auth + Socket providers
    │   ├── hooks/        # useProctoringEngine (core)
    │   ├── portals/
    │   │   ├── admin/    # Admin pages + layout
    │   │   ├── examiner/ # Examiner pages + layout
    │   │   ├── shared/   # Login + Register
    │   │   └── student/  # Student pages + preflight
    │   ├── services/     # Axios API layer
    │   ├── types/        # TypeScript types
    │   └── utils/        # Exam ID client-side decoder
    └── package.json
```

---

## Phase 2 Roadmap
- [ ] Double camera angle (secondary phone camera WebRTC)
- [ ] Face verification with reference photo upload + matching
- [ ] Admin exam edit/update
- [ ] Examiner session broadcast messages
- [ ] Time extension by examiner
- [ ] Violation screenshot capture
- [ ] Export results as CSV/PDF
- [ ] Email notifications

---

## Known Limitations (Phase 1)
- SQLite is used for simplicity; replace with PostgreSQL for production
- AI models run client-side (requires webcam permission)
- Screenshot blocking is best-effort on most OS/browsers (detection only, not full prevention)
- Face-api.js models must be manually downloaded (see Setup section)
