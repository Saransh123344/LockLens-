// frontend/src/portals/student/pages/StudentDashboard.tsx
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { examApi, sessionApi } from '../../../services/api';
import { validateExamCode } from '../../../utils/examId';
import { FEATURE_LABELS } from '../../../types';
import type { FeatureFlags } from '../../../types';
import { decodeExamId } from '../../../utils/examId';
import { useAuth } from '../../../contexts/AuthContext';

type Phase = 'enter_code' | 'request_permissions' | 'joining';

interface ExamInfo {
  title: string;
  description: string;
  duration_minutes: number;
  feature_bitmask: number;
  session_status: string;
  sessionId: string;
  examId: string;
}

export default function StudentDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('enter_code');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [examInfo, setExamInfo] = useState<ExamInfo | null>(null);
  const [permError, setPermError] = useState('');
  const [grantingPerms, setGrantingPerms] = useState(false);
  const [lockedMsg, setLockedMsg] = useState('');

  // ── Step 1: Validate exam code ────────────────────────────────────────────
  const handleValidate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!validateExamCode(trimmed)) {
      setError('Invalid format. Example: LL-AB1C2D3E-0001-03C');
      return;
    }
    setLoading(true);
    setError('');
    setLockedMsg('');
    try {
      // Validate student eligibility via the dedicated endpoint
      const info = await examApi.validateStudent(trimmed);
      setExamInfo(info);

      if (info.session_status === 'locked') {
        setLockedMsg('The exam is locked. Your examiner has not started the session yet. Wait and try again.');
        setLoading(false);
        return;
      }

      // Move to permission request phase
      setPhase('request_permissions');
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Could not validate exam code.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Request permissions & join ────────────────────────────────────
  const handleGrantPermissions = useCallback(async () => {
    if (!examInfo) return;
    setGrantingPerms(true);
    setPermError('');

    const flags = decodeExamId(code.trim().toUpperCase())?.featureFlags;
    const needsVideo = true; // always need webcam for any proctored exam
    const needsAudio = flags?.audio_monitoring;

    try {
      // Request browser permissions
      const constraints: MediaStreamConstraints = {
        video: needsVideo ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false,
        audio: needsAudio ? true : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      // Stop stream immediately — we'll re-request in the exam room
      stream.getTracks().forEach(t => t.stop());

      // Now actually join the session
      setPhase('joining');
      const res = await sessionApi.joinByCode(code.trim().toUpperCase());
      navigate(`/student/exam/${res.studentSessionId}`, {
        state: { sessionId: res.sessionId, examCode: code.trim().toUpperCase() }
      });
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setPermError('Camera permission was denied. Please allow camera access in your browser settings and try again.');
      } else if (err.name === 'NotFoundError') {
        setPermError('No camera found. Please connect a webcam and try again.');
      } else {
        const msg = err.response?.data?.error || err.message || 'Failed to join exam.';
        setPermError(msg);
      }
      setGrantingPerms(false);
      if (phase === 'joining') setPhase('request_permissions');
    }
  }, [examInfo, code, navigate, phase]);

  const featureFlags = examInfo ? decodeExamId(code.trim().toUpperCase())?.featureFlags : null;

  const requiredPerms = featureFlags ? [
    { label: 'Camera Access', icon: '📷', reason: 'Required for identity verification and proctoring', required: true },
    { label: 'Microphone Access', icon: '🎤', reason: 'Required for audio monitoring', required: !!featureFlags.audio_monitoring },
  ].filter(p => p.required) : [];

  // ── Phase: Enter Code ─────────────────────────────────────────────────────
  if (phase === 'enter_code') {
    return (
      <div className="mt-12">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">Join an Exam</h1>
          <p className="text-gray-400 mt-2">Enter the Exam Code given by your examiner</p>
          {user && <p className="text-xs text-gray-600 mt-1">Logged in as: {user.email}</p>}
        </div>

        <div className="card p-8">
          <form onSubmit={handleValidate} className="space-y-4">
            <div>
              <label className="label text-center block">Exam Code</label>
              <input
                className="input text-center font-mono text-lg tracking-widest uppercase"
                placeholder="LL-XXXXXXXX-XXXX-XXX"
                value={code}
                onChange={e => { setCode(e.target.value.toUpperCase()); setError(''); setLockedMsg(''); }}
                maxLength={22}
                required
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm text-center">
                {error}
              </div>
            )}
            {lockedMsg && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 rounded-lg px-4 py-3 text-sm text-center">
                🔒 {lockedMsg}
              </div>
            )}

            <button type="submit" className="btn-primary w-full text-lg py-3" disabled={loading}>
              {loading ? 'Verifying…' : 'Verify Code →'}
            </button>
          </form>
        </div>

        <div className="mt-4 card p-4 text-sm text-gray-500 text-center">
          <p>Make sure you have a working webcam before joining.</p>
          <p className="mt-1">The exam will lock your browser once you enter.</p>
        </div>
      </div>
    );
  }

  // ── Phase: Request Permissions ────────────────────────────────────────────
  if (phase === 'request_permissions' && examInfo) {
    const activeFeatures = FEATURE_LABELS.filter(f => examInfo.feature_bitmask & (1 << f.bit));
    return (
      <div className="mt-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white">Exam Found</h1>
          <p className="text-gray-400 mt-1">Review requirements before entering</p>
        </div>

        {/* Exam info */}
        <div className="card p-6 mb-4">
          <h2 className="font-bold text-white text-xl">{examInfo.title}</h2>
          {examInfo.description && <p className="text-gray-400 text-sm mt-1">{examInfo.description}</p>}
          <div className="flex gap-3 mt-3">
            <span className="badge-info">⏱ {examInfo.duration_minutes} minutes</span>
            <span className="badge-info">🛡 {activeFeatures.length} protections active</span>
          </div>
        </div>

        {/* Permissions Required */}
        <div className="card p-6 mb-4">
          <h3 className="font-semibold text-white mb-4">Permissions Required</h3>
          <div className="space-y-3">
            {requiredPerms.map(p => (
              <div key={p.label} className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg">
                <span className="text-2xl">{p.icon}</span>
                <div>
                  <p className="text-white font-medium text-sm">{p.label}</p>
                  <p className="text-gray-400 text-xs">{p.reason}</p>
                </div>
                <span className="ml-auto text-xs text-red-400 bg-red-500/10 border border-red-500/30 px-2 py-1 rounded-full">Required</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Your browser will ask for permission when you click "Grant Access & Enter Exam" below.
          </p>
        </div>

        {/* Active proctoring features */}
        {activeFeatures.length > 0 && (
          <div className="card p-6 mb-4">
            <h3 className="font-semibold text-white mb-3">Active Proctoring</h3>
            <div className="flex flex-wrap gap-2">
              {activeFeatures.map(f => (
                <span key={f.key} className={`text-xs px-2 py-1 rounded border ${f.category==='basic' ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
                  {f.label}
                </span>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Any violations will be logged and reported to your examiner in real time.
            </p>
          </div>
        )}

        {/* Exam rules reminder */}
        <div className="card p-4 mb-6 bg-amber-500/5 border-amber-500/20">
          <p className="text-amber-300 text-sm font-medium mb-1">⚠️ Before you begin</p>
          <ul className="text-gray-400 text-xs space-y-1 list-disc list-inside">
            <li>Do not switch tabs or windows during the exam</li>
            <li>Stay in fullscreen mode at all times</li>
            <li>No phones, books, or additional screens allowed</li>
            <li>Your webcam feed will be visible to the examiner</li>
          </ul>
        </div>

        {permError && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm mb-4">
            {permError}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={() => { setPhase('enter_code'); setPermError(''); }} className="btn-ghost flex-shrink-0">
            ← Back
          </button>
          <button onClick={handleGrantPermissions} disabled={grantingPerms} className="btn-primary flex-1 text-lg py-3">
            {grantingPerms ? 'Requesting permissions…' : '🎥 Grant Access & Enter Exam'}
          </button>
        </div>
      </div>
    );
  }

  // ── Phase: Joining ────────────────────────────────────────────────────────
  return (
    <div className="mt-20 text-center">
      <div className="text-4xl mb-4">⏳</div>
      <p className="text-gray-300">Entering exam…</p>
    </div>
  );
}
