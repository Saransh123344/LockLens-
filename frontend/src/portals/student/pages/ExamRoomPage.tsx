// frontend/src/portals/student/pages/ExamRoomPage.tsx
import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import * as faceapi from 'face-api.js';
import { examApi, sessionApi } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useSocket } from '../../../contexts/SocketContext';
import { decodeExamId } from '../../../utils/examId';
import { useProctoringEngine } from '../../../hooks/useProctoringEngine';
import type { Question, FeatureFlags, ViolationType } from '../../../types';
import PreflightCheck from '../components/PreflightCheck';

type Phase = 'preflight' | 'verification' | 'exam' | 'paused' | 'submitted' | 'terminated';
// Add 'OBJECT_DETECTED' to the list of things that can pause the exam
type AIViolation = 'NO_FACE' | 'MULTIPLE_FACES' | 'MISMATCH_FACE' | 'OBJECT_DETECTED' | null;

const IS_ELECTRON = !!window.electronAPI?.isElectron;

export default function ExamRoomPage() {
  const { studentSessionId } = useParams<{ studentSessionId: string }>();
  const location   = useLocation();
  const navigate   = useNavigate();
  const { user }   = useAuth();
  const { socket } = useSocket();

  // --- Core States ---
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
  const [fsCountdown, setFsCountdown] = useState<number | null>(null);

  // --- AI Proctoring States ---
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [baseDescriptor, setBaseDescriptor] = useState<Float32Array | null>(null);
  const [aiViolation, setAiViolation] = useState<AIViolation>(null);

  // --- Refs ---
  const videoRef      = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameIntRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const warnTimeout   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiMonitorRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const handleSubmitRef = useRef<() => void>(() => {});

  // ── 1. Load AI Models on Mount ─────────────────────────────────────────────
  useEffect(() => {
    const loadModels = async () => {
      try {
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceRecognitionNet.loadFromUri('/models')
        ]);
        setModelsLoaded(true);
      } catch (err) {
        console.error('Failed to load AI models', err);
      }
    };
    loadModels();
  }, []);

  // ── 2. Load exam data ──────────────────────────────────────────────────────
  useEffect(() => {
    const ssState = location.state as any;
    if (!ssState?.sessionId) { navigate('/student'); return; }
    const examCode = ssState?.examCode;
    if (!examCode)           { navigate('/student'); return; }

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
  }, [location.state, navigate]);

  const showWarning = useCallback((msg: string) => {
    setWarningMsg(msg);
    if (warnTimeout.current) clearTimeout(warnTimeout.current);
    warnTimeout.current = setTimeout(() => setWarningMsg(''), 6000);
  }, []);

  const handleViolation = useCallback((_type: ViolationType | string) => {
    // 1. Keep the existing logging (saves the last 20 violations)
    setViolations(prev => [{ type: _type, time: new Date() }, ...prev.slice(0, 19)]);

    // 2. NEW: Pause the exam if a banned object is detected
    if (_type === 'OBJECT_DETECTED') {
      setAiViolation('OBJECT_DETECTED'); // Tell the UI why it paused
      setPhase('paused');                // Trigger the lockdown screen
    }
  }, []); // Note: Depending on your ESLint rules, you may need to add setAiViolation and setPhase into this dependency array.

  // ── 3. Fullscreen & Window Tracking ────────────────────────────────────────
  const handleFullscreenLost = useCallback(() => {
    if (IS_ELECTRON) return;
    const el = document.documentElement;
    const req = el.requestFullscreen?.bind(el) || (el as any).webkitRequestFullscreen?.bind(el);
    req?.({ navigationUI: 'hide' }).then(() => setFsCountdown(null)).catch(() => setFsCountdown(3));
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
    onViolation: handleViolation as any,
    onWarning: showWarning,
    onFullscreenLost: handleFullscreenLost,
  });

  // ── 4. Socket events from examiner ─────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const onWarningMsg = (data: { message: string }) => showWarning(`⚠️ Examiner: ${data.message}`);
    const onTerminated = () => {
      showWarning('Your session has been terminated by the examiner.');
      setTimeout(() => {
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

  // ── 5. Preflight Pass -> Verification Phase ────────────────────────────────
  const handlePreflightPass = useCallback((stream: MediaStream) => {
    streamRef.current = stream;
    setPhase('verification');
    
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      if (videoRef.current && canvasRef.current) {
        attachStream(stream, videoRef.current, canvasRef.current);
      }
    }, 100);
  }, [attachStream]);

  // ── 6. AI Identity Capture & Exam Start ────────────────────────────────────
  const captureBasePhotoAndStart = async () => {
    if (!videoRef.current) return;
    const detections = await faceapi.detectAllFaces(videoRef.current).withFaceLandmarks().withFaceDescriptors();

    if (detections.length === 0) return alert("No face detected. Please look directly at the camera.");
    if (detections.length > 1) return alert("Multiple faces detected. Ensure you are alone.");

    setBaseDescriptor(detections[0].descriptor);

    // ACTIVATE OS-LEVEL LOCKDOWN (Electron)
    if (IS_ELECTRON) {
      window.electronAPI!.lockDown();
      console.log('[LockLens] OS-level lockdown activated for exam.');
    }

    setPhase('exam');
    const ssState = location.state as any;
    if (ssState?.sessionId) {
      socket?.emit('student:join', { sessionId: ssState.sessionId, studentSessionId });
    }
  };

  // ── 7. AI Background Monitor Loop ──────────────────────────────────────────
  const triggerPause = useCallback((reason: AIViolation) => {
    if (phase === 'paused') return;
    setAiViolation(reason);
    setPhase('paused');
    handleViolation(`AI_VIOLATION: ${reason}`);
    
    const ssState = location.state as any;
    socket?.emit('student:violation', { 
      sessionId: ssState?.sessionId,
      studentSessionId, 
      type: reason 
    });
  }, [handleViolation, socket, studentSessionId, location.state, phase]);

  useEffect(() => {
    if (phase === 'exam' && baseDescriptor && modelsLoaded) {
      aiMonitorRef.current = setInterval(async () => {
        if (!videoRef.current) return;
        const detections = await faceapi.detectAllFaces(videoRef.current).withFaceLandmarks().withFaceDescriptors();

        if (detections.length === 0) {
          triggerPause('NO_FACE');
        } else if (detections.length > 1) {
          triggerPause('MULTIPLE_FACES');
        } else {
          const distance = faceapi.euclideanDistance(baseDescriptor, detections[0].descriptor);
          if (distance > 0.6) triggerPause('MISMATCH_FACE');
        }
      }, 2500);
    } else {
      if (aiMonitorRef.current) clearInterval(aiMonitorRef.current);
    }
    return () => { if (aiMonitorRef.current) clearInterval(aiMonitorRef.current); };
  }, [phase, baseDescriptor, modelsLoaded, triggerPause]);

  const attemptResume = async () => {
    if (!videoRef.current || !baseDescriptor) return;
    const detections = await faceapi.detectAllFaces(videoRef.current).withFaceLandmarks().withFaceDescriptors();

    if (detections.length === 1) {
      const distance = faceapi.euclideanDistance(baseDescriptor, detections[0].descriptor);
      if (distance <= 0.6) {
        setAiViolation(null);
        setPhase('exam');
        return;
      }
    }
    alert("Verification failed. Please ensure your face is clearly visible and matches the original photo.");
  };

  // ── 8. Countdown Timer (Runs during Exam AND Paused) ───────────────────────
  useEffect(() => {
    if ((phase !== 'exam' && phase !== 'paused') || timeLeft <= 0) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { handleSubmitRef.current(); return 0; }
        if (t === 300) showWarning('⏱️ 5 minutes remaining!');
        if (t === 60)  showWarning('⏱️ 1 minute remaining!');
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, timeLeft, showWarning]);

  // ── 9. Webcam Frames -> Examiner (Runs during Exam AND Paused) ─────────────
  useEffect(() => {
    if (phase !== 'exam' && phase !== 'paused') return;
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
  }, [phase, socket, studentSessionId, location.state]);

  // ── 10. Answer Progress -> Examiner ────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'exam') return;
    const ssState = location.state as any;
    socket?.emit('student:answer_update', {
      sessionId: ssState?.sessionId,
      studentSessionId,
      questionCount: questions.length,
      answeredCount: Object.keys(answers).length,
    });
  }, [answers, phase, questions.length, socket, studentSessionId, location.state]);

  // ── 11. Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    if (timerRef.current)      clearInterval(timerRef.current);
    if (frameIntRef.current)   clearInterval(frameIntRef.current);
    if (aiMonitorRef.current)  clearInterval(aiMonitorRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());

    // RELEASE LOCKDOWN
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

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const answered = Object.keys(answers).length;

  // ===========================================================================
  // RENDER BLOCKS
  // ===========================================================================

  if (phase === 'preflight') {
    if (!flags) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading exam…</div>;
    return <PreflightCheck flags={flags} onPass={handlePreflightPass} onFail={() => navigate('/student')} />;
  }

  const q = questions[currentQ];

  return (
    <div className="exam-locked-mode min-h-screen bg-gray-950 flex flex-col select-none relative">
      {/* Hidden Media Elements needed for canvas drawing & AI */}
      <video ref={videoRef} className="hidden" muted playsInline autoPlay />
      <canvas ref={canvasRef} className="hidden" />

      {/* --- PHASE: VERIFICATION --- */}
      {phase === 'verification' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-6">
          <h2 className="text-3xl font-bold text-white">Identity Verification Required</h2>
          <p className="text-gray-400 max-w-md">
            Please look directly into the camera. We must capture your base identity to verify you during the exam.
          </p>
          <div className="relative w-[400px] h-[300px] bg-black rounded-xl overflow-hidden border-2 border-indigo-500 shadow-2xl shadow-indigo-500/20">
            <video
              ref={el => { if (el && streamRef.current) el.srcObject = streamRef.current; }}
              muted playsInline autoPlay
              className="w-full h-full object-cover transform scale-x-[-1]"
            />
          </div>
          <button
            onClick={captureBasePhotoAndStart}
            disabled={!modelsLoaded}
            className={`px-8 py-3 text-lg font-bold rounded-lg transition-colors ${
              modelsLoaded ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'bg-gray-700 text-gray-400 cursor-not-allowed'
            }`}
          >
            {modelsLoaded ? 'Scan Face & Start Exam' : 'Loading AI Models...'}
          </button>
        </div>
      )}

      {/* --- PHASE: EXAM PAUSED (VIOLATION OVERLAY) --- */}
      {phase === 'paused' && (
        <div className="fixed inset-0 z-[99999] bg-red-900/95 flex flex-col items-center justify-center p-6 text-center space-y-6 backdrop-blur-md">
          <div className="text-8xl">🛑</div>
          <h1 className="text-5xl font-bold text-white tracking-wider">EXAM PAUSED</h1>
          <h2 className="text-2xl font-semibold text-red-200">
            {aiViolation === 'NO_FACE' && "No face detected in frame."}
            {aiViolation === 'MULTIPLE_FACES' && "Multiple faces detected. Ensure you are alone."}
            {aiViolation === 'MISMATCH_FACE' && "Identity mismatch detected."}
          </h2>
          <p className="text-white text-lg max-w-lg bg-red-950/50 p-4 rounded-lg">
            Your questions are hidden but your timer is still running. Please look directly at the camera to resume.
          </p>
          <div className="relative w-[320px] h-[240px] bg-black rounded-xl overflow-hidden shadow-2xl mt-4 border-2 border-red-500">
            <video
              ref={el => { if (el && streamRef.current) el.srcObject = streamRef.current; }}
              muted playsInline autoPlay
              className="w-full h-full object-cover transform scale-x-[-1]"
            />
          </div>
          <button 
            onClick={attemptResume}
            className="mt-8 px-8 py-4 text-xl font-bold bg-white text-red-600 rounded-xl hover:bg-gray-200 transition-transform hover:scale-105 shadow-2xl"
          >
            Scan Face to Resume
          </button>
        </div>
      )}

      {/* --- PHASE: SUBMITTED --- */}
      {phase === 'submitted' && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="card p-10 max-w-md w-full text-center space-y-4 bg-gray-900 rounded-2xl border border-gray-800">
            <div className="text-5xl">🎉</div>
            <h2 className="text-2xl font-bold text-white">Exam Submitted!</h2>
            {score ? (
              <>
                <p className="text-gray-400">Your Score</p>
                <p className={`text-6xl font-bold ${score.percentage >= 80 ? 'text-green-400' : score.percentage >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {score.percentage}%
                </p>
                <p className="text-gray-300 text-lg">{score.score} / {score.total} points</p>
              </>
            ) : (
              <p className="text-gray-400">Your answers have been recorded.</p>
            )}
            <div className="flex flex-col gap-3 pt-4 border-t border-gray-800">
              <button onClick={() => navigate(`/student/result/${studentSessionId}`)} className="btn-primary w-full">📊 View Results</button>
              <button onClick={() => { window.close(); setTimeout(() => navigate('/student'), 300); }} className="btn-ghost w-full">✕ Close Tab</button>
            </div>
          </div>
        </div>
      )}

      {/* --- PHASE: TERMINATED --- */}
      {phase === 'terminated' && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="card p-10 max-w-md w-full text-center space-y-4 bg-gray-900 rounded-2xl border border-red-900/50">
            <div className="text-5xl">🚫</div>
            <h2 className="text-2xl font-bold text-red-400">Session Terminated</h2>
            <p className="text-gray-400">Your exam session was terminated by the examiner.</p>
            <button onClick={() => { window.close(); setTimeout(() => navigate('/student'), 300); }} className="btn-ghost w-full">✕ Close</button>
          </div>
        </div>
      )}

      {/* --- PHASE: EXAM ACTIVE --- */}
      {phase === 'exam' && (
        <>
          {/* Fullscreen-lost overlay (browser mode only) */}
          {!IS_ELECTRON && fsCountdown !== null && flags?.fullscreen_enforcement && (
            <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center">
              <div className="text-center space-y-5 max-w-sm px-6">
                <div className="text-8xl font-bold text-red-400 tabular-nums animate-pulse">{fsCountdown}</div>
                <h2 className="text-xl font-bold text-red-400">Returning to Fullscreen…</h2>
                <button autoFocus className="btn-primary w-full py-4 text-lg" onClick={() => {
                  const el = document.documentElement;
                  const req = el.requestFullscreen?.bind(el) || (el as any).webkitRequestFullscreen?.bind(el);
                  req?.({ navigationUI: 'hide' }).then(() => setFsCountdown(null)).catch(() => {});
                }}>🔒 Return to Fullscreen</button>
              </div>
            </div>
          )}

          {warningMsg && (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-yellow-500 text-black font-bold px-6 py-3 rounded-xl shadow-xl text-sm max-w-lg text-center">
              {warningMsg}
            </div>
          )}

          {IS_ELECTRON && (
            <div className="fixed bottom-3 right-3 z-40 flex items-center gap-1.5 bg-red-600/20 border border-red-600/40 text-red-400 text-xs px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" /> OS Lockdown Active
            </div>
          )}

          <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between shrink-0">
            <div>
              <p className="font-semibold text-white text-sm">{exam?.title}</p>
              <p className="text-xs text-gray-400">{user?.name}</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-16 h-12 bg-black rounded overflow-hidden border border-gray-700">
                <video ref={el => { if (el && streamRef.current) el.srcObject = streamRef.current; }} className="w-full h-full object-cover transform scale-x-[-1]" muted playsInline autoPlay />
              </div>
              <div className={`font-mono text-lg font-bold px-3 py-1 rounded-lg ${timeLeft < 300 ? 'text-red-400 bg-red-500/10 border border-red-500/30' : 'text-white bg-gray-800'}`}>
                {fmt(timeLeft)}
              </div>
              {violations.length > 0 && <span className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 px-2 py-1 rounded-full font-medium">{violations.length} ⚠</span>}
            </div>
          </header>

          <div className="flex flex-1 overflow-hidden">
            <div className="w-52 bg-gray-900 border-r border-gray-800 p-4 overflow-y-auto">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">{answered}/{questions.length} answered</p>
              <div className="grid grid-cols-5 gap-1.5">
                {questions.map((qItem, i) => (
                  <button
                    key={qItem.id} onClick={() => setCurrentQ(i)}
                    className={`w-full aspect-square rounded text-xs font-semibold transition-colors ${
                      i === currentQ ? 'bg-indigo-600 text-white' : answers[qItem.id] ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >{i + 1}</button>
                ))}
              </div>
              {violations.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Violations</p>
                  <div className="space-y-1">
                    {violations.slice(0, 5).map((v, i) => (
                      <div key={i} className="text-[10px] leading-tight text-red-400 bg-red-500/5 rounded px-2 py-1">{v.type.replace(/_/g, ' ')}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-8">
              {questions.length === 0 ? <div className="flex items-center justify-center h-full text-gray-500">Loading questions…</div> : !q ? <div className="flex items-center justify-center h-full text-gray-500">No question selected.</div> : (
                <div className="max-w-2xl mx-auto">
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-indigo-400 font-semibold">Question {currentQ + 1} of {questions.length}</span>
                    <span className="text-gray-400 text-sm">{q.points} pt{q.points !== 1 ? 's' : ''}</span>
                  </div>
                  <p className="text-white text-lg font-medium mb-8 leading-relaxed">{q.question}</p>
                  <div className="space-y-3">
                    {q.options && Object.entries(typeof q.options === 'string' ? JSON.parse(q.options) : q.options).map(([opt, text]) => (
                      <button
                        key={opt} onClick={() => setAnswers(a => ({ ...a, [q.id]: opt }))}
                        className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all ${
                          answers[q.id] === opt ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200' : 'bg-gray-800/50 border-gray-700 text-gray-300 hover:border-gray-500 hover:bg-gray-800'
                        }`}
                      >
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${answers[q.id] === opt ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400'}`}>{opt}</span>
                        <span>{text as string}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between mt-8">
                    <button onClick={() => setCurrentQ(i => Math.max(0, i - 1))} disabled={currentQ === 0} className="btn-ghost disabled:opacity-30">← Previous</button>
                    {currentQ < questions.length - 1 ? (
                      <button onClick={() => setCurrentQ(i => i + 1)} className="btn-primary">Next →</button>
                    ) : (
                      <button
                        onClick={() => {
                          const unanswered = questions.length - answered;
                          if (confirm(unanswered > 0 ? `You have ${unanswered} unanswered question(s). Submit anyway?` : 'Submit exam? You cannot change your answers.')) handleSubmit();
                        }}
                        disabled={submitting} className="btn-primary bg-green-600 hover:bg-green-500"
                      >
                        {submitting ? 'Submitting…' : '✓ Submit Exam'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}