// frontend/src/portals/student/components/PreflightCheck.tsx
// Runs system checks and — critically — requests fullscreen from the
// "Start Exam" button click so the browser treats it as a user gesture.
import { useEffect, useState, useRef } from 'react';
import type { FeatureFlags } from '../../../types';

interface Check {
  id: string;
  label: string;
  status: 'pending' | 'checking' | 'pass' | 'fail' | 'skip';
  detail?: string;
}

interface Props {
  flags: FeatureFlags;
  onPass: (stream: MediaStream) => void;
  onFail: (reason: string) => void;
}

export default function PreflightCheck({ flags, onPass, onFail }: Props) {
  const [checks, setChecks] = useState<Check[]>([
    { id: 'browser',     label: 'Browser compatibility',  status: 'pending' },
    { id: 'webcam',      label: 'Webcam access',           status: 'pending' },
    { id: 'microphone',  label: 'Microphone access',       status: flags.audio_monitoring ? 'pending' : 'skip' },
    { id: 'fullscreen',  label: 'Fullscreen permission',   status: flags.fullscreen_enforcement ? 'pending' : 'skip' },
    { id: 'connection',  label: 'Server connection',       status: 'pending' },
  ]);
  const [stream, setStream]     = useState<MediaStream | null>(null);
  const [allDone, setAllDone]   = useState(false);
  const [anyFail, setAnyFail]   = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const streamRef = useRef<MediaStream | null>(null);

  const setCheck = (id: string, status: Check['status'], detail?: string) =>
    setChecks(prev => prev.map(c => c.id === id ? { ...c, status, detail } : c));

  useEffect(() => {
    const run = async () => {
      // 1. Browser check
      setCheck('browser', 'checking');
      await sleep(300);
      const ok = !!(window as any).chrome || /Chrome|Firefox/i.test(navigator.userAgent);
      setCheck('browser', ok ? 'pass' : 'fail', ok ? 'Supported browser' : 'Use Chrome or Firefox');

      // 2. Webcam + microphone
      setCheck('webcam', 'checking');
      if (flags.audio_monitoring) setCheck('microphone', 'checking');
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: !!flags.audio_monitoring,
        });
        streamRef.current = s;
        setStream(s);
        setCheck('webcam', 'pass', 'Camera ready');
        if (flags.audio_monitoring) setCheck('microphone', 'pass', 'Microphone ready');
      } catch (err: any) {
        const msg = err.name === 'NotAllowedError'
          ? 'Permission denied — click Allow in your browser'
          : 'No camera detected';
        setCheck('webcam', 'fail', msg);
        if (flags.audio_monitoring) setCheck('microphone', 'fail', 'Microphone unavailable');
      }

      // 3. Fullscreen capability check (not actual request — that needs button click)
      if (flags.fullscreen_enforcement) {
        setCheck('fullscreen', 'checking');
        await sleep(200);
        const supported = !!document.documentElement.requestFullscreen ||
          !!(document.documentElement as any).webkitRequestFullscreen;
        setCheck('fullscreen', supported ? 'pass' : 'fail',
          supported ? 'Fullscreen supported — will activate on Start' : 'Fullscreen not supported by this browser');
      }

      // 4. Server connection
      setCheck('connection', 'checking');
      try {
        const res = await fetch('/api/health');
        setCheck('connection', res.ok ? 'pass' : 'fail',
          res.ok ? 'Server reachable' : `Server error: ${res.status}`);
      } catch {
        setCheck('connection', 'fail', 'Cannot reach server');
      }

      setAllDone(true);
    };
    run();
  }, [flags]);

  useEffect(() => {
    if (!allDone) return;
    setAnyFail(checks.some(c => c.status === 'fail'));
  }, [allDone, checks]);

  // ── Start Exam button: runs inside user gesture so fullscreen is allowed ──
  const handleStart = async () => {
    if (!streamRef.current) return;
    setStarting(true);
    setStartError('');

    // Request fullscreen if required — MUST happen inside click handler
    if (flags.fullscreen_enforcement) {
      const el = document.documentElement;
      const req = el.requestFullscreen?.bind(el) || (el as any).webkitRequestFullscreen?.bind(el);
      if (req) {
        try {
          await req({ navigationUI: 'hide' });
        } catch (err: any) {
          // User denied fullscreen
          setStartError('Fullscreen is required to start the exam. Please allow fullscreen and try again.');
          setStarting(false);
          return;
        }
      }
    }

    onPass(streamRef.current);
  };

  const icon = (s: Check['status']) => {
    if (s === 'pass')     return <span className="text-green-400">✓</span>;
    if (s === 'fail')     return <span className="text-red-400">✗</span>;
    if (s === 'checking') return <span className="text-yellow-400 animate-spin inline-block">⟳</span>;
    if (s === 'skip')     return <span className="text-gray-600">—</span>;
    return <span className="text-gray-600">·</span>;
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="card p-8 w-full max-w-md">
        <h2 className="text-xl font-bold text-white mb-1">System Preflight Check</h2>
        <p className="text-gray-400 text-sm mb-6">Verifying your system before the exam starts…</p>

        <div className="space-y-3">
          {checks.map(c => (
            <div key={c.id} className={`flex items-center gap-3 p-3 rounded-lg ${
              c.status === 'pass' ? 'bg-green-500/5 border border-green-500/20' :
              c.status === 'fail' ? 'bg-red-500/5 border border-red-500/20' :
              c.status === 'skip' ? 'bg-gray-800/30 border border-gray-700/30 opacity-50' :
              'bg-gray-800/50 border border-gray-700'
            }`}>
              <span className="text-lg w-5 text-center">{icon(c.status)}</span>
              <div>
                <p className="text-white text-sm font-medium">{c.label}</p>
                {c.detail && (
                  <p className={`text-xs mt-0.5 ${c.status === 'fail' ? 'text-red-400' : 'text-gray-400'}`}>
                    {c.detail}
                  </p>
                )}
                {c.status === 'skip' && (
                  <p className="text-xs text-gray-600 mt-0.5">Not required for this exam</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Permissions notice */}
        {allDone && !anyFail && (
          <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <p className="text-blue-300 text-xs font-medium mb-1">⚠️ Before you start:</p>
            <ul className="text-xs text-gray-400 space-y-0.5 list-disc list-inside">
              {flags.fullscreen_enforcement && <li>The exam will open in <strong className="text-white">fullscreen</strong> — do not exit</li>}
              {flags.copy_paste_blocking && <li>Copy, paste &amp; right-click are <strong className="text-white">disabled</strong></li>}
              {flags.tab_switch_detection && <li>Switching tabs is <strong className="text-white">monitored</strong></li>}
              <li>All keyboard shortcuts (F12, Ctrl+T, Ctrl+W) are <strong className="text-white">blocked</strong></li>
            </ul>
          </div>
        )}

        {startError && (
          <p className="mt-3 text-red-400 text-sm text-center">{startError}</p>
        )}

        {allDone && (
          <div className="mt-5">
            {anyFail ? (
              <div className="text-center">
                <p className="text-red-400 text-sm mb-4">Fix the issues above before proceeding.</p>
                <button onClick={() => window.location.reload()} className="btn-ghost w-full">
                  Retry Checks
                </button>
              </div>
            ) : (
              <button
                onClick={handleStart}
                disabled={starting}
                className="btn-primary w-full text-lg py-3 disabled:opacity-60"
              >
                {starting ? 'Entering exam…' : flags.fullscreen_enforcement
                  ? '🔒 Lock Screen & Start Exam →'
                  : 'All Systems Go — Start Exam →'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
