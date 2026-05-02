// frontend/src/portals/student/pages/ExamRoomPage.tsx
import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { examApi, sessionApi } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useSocket } from '../../../contexts/SocketContext';
import { decodeExamId } from '../../../utils/examId';
import { useProctoringEngine } from '../../../hooks/useProctoringEngine';
import type { Question, FeatureFlags, ViolationType } from '../../../types';
import PreflightCheck from '../components/PreflightCheck';

type Phase = 'preflight' | 'exam' | 'submitted' | 'terminated';

const IS_ELECTRON = !!window.electronAPI?.isElectron;

export default function ExamRoomPage() {
  const { studentSessionId } = useParams<{ studentSessionId: string }>();
  const location   = useLocation();
  const navigate   = useNavigate();
  const { user }   = useAuth();
  const { socket } = useSocket();

  const [phase, setPhase]       = useState<Phase>('preflight');
  const [exam, setExam]         = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [flags, setFlags]       = useState<FeatureFlags | null>(null);
  const [answers, setAnswers]   = useState<Record<string, string>>({});
  const [currentQ, setCurrentQ] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [violations, setViolations] = useState<{ type: string; time: Date }[]>([]);
  const [warningMsg, setWarningMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [score, setScore]       = useState<{ score: number; total: number; percentage: number } | null>(null);
  // Fullscreen-lost countdown (browser mode only)
  const [fsCountdown, setFsCountdown] = useState<number | null>(null);

  const videoRef      = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameIntRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const warnTimeout   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSubmitRef = useRef<() => void>(() => {});

  // ── Load exam data ─────────────────────────────────────────────────────────
  useEffect(() => {
    const ssState = location.state as any;
    if (!ssState?.sessionId) { navigate('/student'); return; }
    const examCode = ssState?.examCode;
    if (!examCode)            { navigate('/student'); return; }

    examApi.decode(examCode).then((data: any) => {
      const decoded = decodeExamId(examCode);
      if (!decoded) return navigate('/student');
      setExam(data);
      const qs = (data.questions || []).map((q: any) => ({
        ...q,
        options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
      }));
      setQuestions(qs);
      setFlags(decoded.featureFlags);
      setTimeLeft(decoded.durationMinutes * 60);
    }).catch(() => navigate('/student'));
  }, []);

  const showWarning = useCallback((msg: string) => {
    setWarningMsg(msg);
    if (warnTimeout.current) clearTimeout(warnTimeout.current);
    warnTimeout.current = setTimeout(() => setWarningMsg(''), 6000);
  }, []);

  const handleViolation = useCallback((_type: ViolationType) => {
    setViolations(prev => [{ type: _type, time: new Date() }, ...prev.slice(0, 19)]);
  }, []);

  // ── Fullscreen lost (browser mode only) ───────────────────────────────────
  const handleFullscreenLost = useCallback(() => {
    if (IS_ELECTRON) return; // Electron kiosk prevents this from ever happening
    const el = document.documentElement;
    const req = el.requestFullscreen?.bind(el) || (el as any).webkitRequestFullscreen?.bind(el);
    req?.({ navigationUI: 'hide' })
      .then(() => setFsCountdown(null))
      .catch(() => setFsCountdown(3));
  }, []);

  useEffect(() => {
    if (fsCountdown === null || IS_ELECTRON) return;
    if (fsCountdown <= 0) {
      const el = document.documentElement;
      const req = el.requestFullscreen?.bind(el) || (el as any).webkitRequestFullscreen?.bind(el);
      req?.({ navigationUI: 'hide' }).catch(() => {});
      setFsCountdown(null);
      return;
    }
    const el = document.documentElement;
    const req = el.requestFullscreen?.bind(el) || (el as any).webkitRequestFullscreen?.bind(el);
    req?.({ navigationUI: 'hide' }).then(() => setFsCountdown(null)).catch(() => {});
    const id = setTimeout(() => setFsCountdown(n => n !== null ? n - 1 : null), 1000);
    return () => clearTimeout(id);
  }, [fsCountdown]);

  useEffect(() => {
    const onFSChange = () => {
      const isFS = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      if (isFS) setFsCountdown(null);
    };
    document.addEventListener('fullscreenchange', onFSChange);
    document.addEventListener('webkitfullscreenchange', onFSChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFSChange);
      document.removeEventListener('webkitfullscreenchange', onFSChange);
    };
  }, []);

  const { attachStream } = useProctoringEngine({
    studentSessionId: studentSessionId!,
    flags: flags || {} as FeatureFlags,
    onViolation: handleViolation,
    onWarning: showWarning,
    onFullscreenLost: handleFullscreenLost,
  });

  // ── Socket events from examiner ────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const onWarningMsg = (data: { message: string }) => showWarning(`⚠️ Examiner: ${data.message}`);
    const onTerminated = () => {
      showWarning('Your session has been terminated by the examiner.');
      setTimeout(() => {
        // Unlock before showing terminated screen
        if (IS_ELECTRON) window.electronAPI!.unlock();
        setPhase('terminated');
      }, 2000);
    };
    const onEnded = () => {
      showWarning('Exam ended by examiner — submitting…');
      setTimeout(() => handleSubmitRef.current(), 2000);
    };
    socket.on('examiner:warning',   onWarningMsg);
    socket.on('session:terminated', onTerminated);
    socket.on('session:ended',      onEnded);
    return () => {
      socket.off('examiner:warning',   onWarningMsg);
      socket.off('session:terminated', onTerminated);
      socket.off('session:ended',      onEnded);
    };
  }, [socket, showWarning]);

  // ── Preflight passed → activate lockdown + start exam ─────────────────────
  const handlePreflightPass = useCallback((stream: MediaStream) => {
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    setTimeout(() => {
      if (videoRef.current && canvasRef.current)
        attachStream(stream, videoRef.current, canvasRef.current);
    }, 1000);

    // ── ACTIVATE OS-LEVEL LOCKDOWN (Electron) ────────────────────────────
    // This is the critical moment: C++ hook starts, kiosk activates, explorer dies
    if (IS_ELECTRON) {
      window.electronAPI!.lockDown();
      console.log('[LockLens] OS-level lockdown activated for exam.');
    }

    setPhase('exam');
    const ssState = location.state as any;
    if (ssState?.sessionId)
      socket?.emit('student:join', { sessionId: ssState.sessionId, studentSessionId });
  }, [attachStream, socket, studentSessionId, location.state]);

  // ── Countdown timer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'exam' || timeLeft <= 0) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { handleSubmitRef.current(); return 0; }
        if (t === 300) showWarning('⏱️ 5 minutes remaining!');
        if (t === 60)  showWarning('⏱️ 1 minute remaining!');
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, showWarning]);

  // ── Webcam frames → examiner ───────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'exam') return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d');
    frameIntRef.current = setInterval(() => {
      if (!ctx || !video.videoWidth) return;
      canvas.width = 320; canvas.height = 240;
      ctx.drawImage(video, 0, 0, 320, 240);
      const frame = canvas.toDataURL('image/jpeg', 0.4).split(',')[1];
      const ssState = location.state as any;
      socket?.emit('student:webcam_frame', {
        sessionId: ssState?.sessionId,
        studentSessionId,
        frame,
        timestamp: Date.now(),
      });
    }, 2000);
    return () => { if (frameIntRef.current) clearInterval(frameIntRef.current); };
  }, [phase, socket, studentSessionId]);

  // ── Answer progress → examiner ─────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'exam') return;
    const ssState = location.state as any;
    socket?.emit('student:answer_update', {
      sessionId: ssState?.sessionId,
      studentSessionId,
      questionCount: questions.length,
      answeredCount: Object.keys(answers).length,
    });
  }, [answers, phase]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    if (timerRef.current)    clearInterval(timerRef.current);
    if (frameIntRef.current) clearInterval(frameIntRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());

    // ── RELEASE LOCKDOWN ─────────────────────────────────────────────────
    if (IS_ELECTRON) {
      window.electronAPI!.unlock();
      console.log('[LockLens] OS-level lockdown released after submission.');
    } else {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }

    try {
      const result = await sessionApi.submit(studentSessionId!, answers);
      setScore(result);
      setPhase('submitted');
    } catch {
      setPhase('submitted');
    }
  }, [submitting, studentSessionId, answers]);

  useEffect(() => { handleSubmitRef.current = handleSubmit; }, [handleSubmit]);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const answered = Object.keys(answers).length;

  // ── PREFLIGHT ──────────────────────────────────────────────────────────────
  if (phase === 'preflight') {
    if (!flags) return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">Loading exam…</div>
    );
    return <PreflightCheck flags={flags} onPass={handlePreflightPass} onFail={() => navigate('/student')} />;
  }

  // ── SUBMITTED ─────────────────────────────────────────────────────────────
  if (phase === 'submitted') {
    const pct = score?.percentage ?? 0;
    const scoreColor = pct >= 80 ? 'text-green-400' : pct >= 60 ? 'text-yellow-400' : 'text-red-400';
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="card p-10 max-w-md w-full text-center space-y-4">
          <div className="text-5xl">🎉</div>
          <h2 className="text-2xl font-bold text-white">Exam Submitted!</h2>
          {score ? (
            <>
              <p className="text-gray-400">Your Score</p>
              <p className={`text-6xl font-bold ${scoreColor}`}>{score.percentage}%</p>
              <p className="text-gray-300 text-lg">{score.score} / {score.total} points</p>
              <p className={`text-sm font-medium ${scoreColor}`}>
                {pct >= 80 ? '🏆 Excellent!' : pct >= 60 ? '👍 Good effort!' : '📚 Keep studying!'}
              </p>
            </>
          ) : (
            <p className="text-gray-400">Your answers have been recorded.</p>
          )}
          <div className="flex flex-col gap-3 pt-4 border-t border-gray-800">
            <button
              onClick={() => navigate(`/student/result/${studentSessionId}`)}
              className="btn-primary w-full"
            >
              📊 View Detailed Results
            </button>
            <button
              onClick={() => { window.close(); setTimeout(() => navigate('/student'), 300); }}
              className="btn-ghost w-full"
            >
              ✕ Close Tab
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── TERMINATED ────────────────────────────────────────────────────────────
  if (phase === 'terminated') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="card p-10 max-w-md w-full text-center space-y-4">
          <div className="text-5xl">🚫</div>
          <h2 className="text-2xl font-bold text-red-400">Session Terminated</h2>
          <p className="text-gray-400">Your exam session was terminated by the examiner.</p>
          <button
            onClick={() => { window.close(); setTimeout(() => navigate('/student'), 300); }}
            className="btn-ghost w-full"
          >
            ✕ Close
          </button>
        </div>
      </div>
    );
  }

  // ── EXAM ──────────────────────────────────────────────────────────────────
  const q = questions[currentQ];

  return (
    <div className="exam-locked-mode min-h-screen bg-gray-950 flex flex-col select-none">
      <video ref={videoRef} className="hidden" muted playsInline autoPlay />
      <canvas ref={canvasRef} className="hidden" />

      {/* Fullscreen-lost overlay (browser mode only) */}
      {!IS_ELECTRON && fsCountdown !== null && flags?.fullscreen_enforcement && (
        <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center">
          <div className="text-center space-y-5 max-w-sm px-6">
            <div className="text-8xl font-bold text-red-400 tabular-nums animate-pulse">{fsCountdown}</div>
            <h2 className="text-xl font-bold text-red-400">Returning to Fullscreen…</h2>
            <p className="text-gray-400 text-sm">Fullscreen exit recorded as violation.</p>
            <button
              autoFocus
              className="btn-primary w-full py-4 text-lg"
              onClick={() => {
                const el = document.documentElement;
                const req = el.requestFullscreen?.bind(el) || (el as any).webkitRequestFullscreen?.bind(el);
                req?.({ navigationUI: 'hide' }).then(() => setFsCountdown(null)).catch(() => {});
              }}
            >
              🔒 Return to Fullscreen
            </button>
          </div>
        </div>
      )}

      {/* Warning toast */}
      {warningMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-yellow-500 text-black font-bold px-6 py-3 rounded-xl shadow-xl text-sm max-w-lg text-center">
          {warningMsg}
        </div>
      )}

      {/* Electron lockdown badge */}
      {IS_ELECTRON && (
        <div className="fixed bottom-3 right-3 z-40 flex items-center gap-1.5 bg-red-600/20 border border-red-600/40 text-red-400 text-xs px-3 py-1.5 rounded-full">
          <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
          OS Lockdown Active
        </div>
      )}

      {/* Top bar */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <p className="font-semibold text-white text-sm">{exam?.title}</p>
          <p className="text-xs text-gray-400">{user?.name}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-16 h-12 bg-gray-800 rounded overflow-hidden border border-gray-700">
            <video
              ref={el => { if (el && streamRef.current) el.srcObject = streamRef.current; }}
              className="w-full h-full object-cover"
              muted playsInline autoPlay
            />
          </div>
          <div className={`font-mono text-lg font-bold px-3 py-1 rounded-lg ${
            timeLeft < 300 ? 'text-red-400 bg-red-500/10 border border-red-500/30' : 'text-white bg-gray-800'
          }`}>
            {fmt(timeLeft)}
          </div>
          {violations.length > 0 && (
            <span className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 px-2 py-1 rounded-full font-medium">
              {violations.length} ⚠
            </span>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-52 bg-gray-900 border-r border-gray-800 p-4 overflow-y-auto">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
            {answered}/{questions.length} answered
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {questions.map((qItem, i) => (
              <button
                key={qItem.id}
                onClick={() => setCurrentQ(i)}
                className={`w-full aspect-square rounded text-xs font-semibold transition-colors ${
                  i === currentQ
                    ? 'bg-indigo-600 text-white'
                    : answers[qItem.id]
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          {violations.length > 0 && (
            <div className="mt-6">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Violations</p>
              <div className="space-y-1">
                {violations.slice(0, 5).map((v, i) => (
                  <div key={i} className="text-xs text-red-400 bg-red-500/5 rounded px-2 py-1">
                    {v.type.replace(/_/g, ' ')}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Question area */}
        <div className="flex-1 overflow-y-auto p-8">
          {questions.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">Loading questions…</div>
          ) : !q ? (
            <div className="flex items-center justify-center h-full text-gray-500">No question selected.</div>
          ) : (
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <span className="text-indigo-400 font-semibold">
                  Question {currentQ + 1} of {questions.length}
                </span>
                <span className="text-gray-400 text-sm">{q.points} pt{q.points !== 1 ? 's' : ''}</span>
              </div>
              <p className="text-white text-lg font-medium mb-8 leading-relaxed">{q.question}</p>
              <div className="space-y-3">
                {q.options && Object.entries(
                  typeof q.options === 'string' ? JSON.parse(q.options) : q.options
                ).map(([opt, text]) => (
                  <button
                    key={opt}
                    onClick={() => setAnswers(a => ({ ...a, [q.id]: opt }))}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all ${
                      answers[q.id] === opt
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                        : 'bg-gray-800/50 border-gray-700 text-gray-300 hover:border-gray-500 hover:bg-gray-800'
                    }`}
                  >
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      answers[q.id] === opt ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400'
                    }`}>{opt}</span>
                    <span>{text as string}</span>
                  </button>
                ))}
              </div>
              <div className="flex justify-between mt-8">
                <button
                  onClick={() => setCurrentQ(i => Math.max(0, i - 1))}
                  disabled={currentQ === 0}
                  className="btn-ghost disabled:opacity-30"
                >
                  ← Previous
                </button>
                {currentQ < questions.length - 1 ? (
                  <button onClick={() => setCurrentQ(i => i + 1)} className="btn-primary">Next →</button>
                ) : (
                  <button
                    onClick={() => {
                      const unanswered = questions.length - answered;
                      const msg = unanswered > 0
                        ? `You have ${unanswered} unanswered question(s). Submit anyway?`
                        : 'Submit exam? You cannot change your answers after submission.';
                      if (confirm(msg)) handleSubmit();
                    }}
                    disabled={submitting}
                    className="btn-primary bg-green-600 hover:bg-green-500"
                  >
                    {submitting ? 'Submitting…' : '✓ Submit Exam'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
