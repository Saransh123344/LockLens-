// frontend/src/portals/student/components/PreflightCheck.tsx
// Runs system checks before the exam.
// In Electron: skips requestFullscreen (Electron's kiosk mode handles it).
// In Browser: requests fullscreen on the Start button click (user gesture).

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

const IS_ELECTRON = !!window.electronAPI?.isElectron;

export default function PreflightCheck({ flags, onPass, onFail }: Props) {
  const [checks, setChecks] = useState<Check[]>([
    { id: 'browser',    label: 'Environment check',    status: 'pending' },
    { id: 'webcam',     label: 'Webcam access',         status: 'pending' },
    { id: 'microphone', label: 'Microphone access',     status: flags.audio_monitoring ? 'pending' : 'skip' },
    { id: 'fullscreen', label: 'Fullscreen / Lockdown', status: flags.fullscreen_enforcement ? 'pending' : 'skip' },
    { id: 'connection', label: 'Server connection',     status: 'pending' },
  ]);
  const [allDone, setAllDone]   = useState(false);
  const [anyFail, setAnyFail]   = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const streamRef = useRef<MediaStream | null>(null);

  const setCheck = (id: string, status: Check['status'], detail?: string) =>
    setChecks(prev => prev.map(c => c.id === id ? { ...c, status, detail } : c));

  useEffect(() => {
    const run = async () => {
      // 1. Environment check
      setCheck('browser', 'checking');
      await sleep(300);
      if (IS_ELECTRON) {
        setCheck('browser', 'pass', 'LockLens Desktop — maximum security mode');
      } else {
        const ok = /Chrome|Firefox/i.test(navigator.userAgent);
        setCheck('browser', ok ? 'pass' : 'fail', ok ? 'Supported browser' : 'Use Chrome or Firefox for best results');
      }

      // 2. Webcam + microphone
      setCheck('webcam', 'checking');
      if (flags.audio_monitoring) setCheck('microphone', 'checking');
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: !!flags.audio_monitoring,
        });
        streamRef.current = s;
        setCheck('webcam', 'pass', 'Camera ready');
        if (flags.audio_monitoring) setCheck('microphone', 'pass', 'Microphone ready');
      } catch (err: any) {
        const msg = err.name === 'NotAllowedError'
          ? 'Permission denied — click Allow in your browser bar'
          : 'No camera detected. Please connect a webcam.';
        setCheck('webcam', 'fail', msg);
        if (flags.audio_monitoring) setCheck('microphone', 'fail', 'Microphone unavailable');
      }

      // 3. Fullscreen check
      if (flags.fullscreen_enforcement) {
        setCheck('fullscreen', 'checking');
        await sleep(200);
        if (IS_ELECTRON) {
          // Electron is already fullscreen + kiosk activates on exam start
          setCheck('fullscreen', 'pass', 'Kiosk lockdown will activate on exam start');
        } else {
          const supported = !!document.documentElement.requestFullscreen ||
            !!(document.documentElement as any).webkitRequestFullscreen;
          setCheck('fullscreen', supported ? 'pass' : 'fail',
            supported ? 'Fullscreen supported — activates on Start' : 'Browser does not support fullscreen');
        }
      }

      // 4. Server connection
      setCheck('connection', 'checking');
      try {
        const res = await fetch('/api/health');
        setCheck('connection', res.ok ? 'pass' : 'fail',
          res.ok ? 'Backend reachable' : `Server error ${res.status}`);
      } catch {
        setCheck('connection', 'fail', 'Cannot reach server — check your network');
      }

      setAllDone(true);
    };
    run();
  }, [flags]);

  useEffect(() => {
    if (allDone) setAnyFail(checks.some(c => c.status === 'fail'));
  }, [allDone, checks]);

  // Start button — runs inside user gesture so browser fullscreen is allowed
  const handleStart = async () => {
    if (!streamRef.current) return;
    setStarting(true);
    setStartError('');

    if (!IS_ELECTRON && flags.fullscreen_enforcement) {
      // Browser path: request fullscreen NOW (requires user gesture — this click)
      const el = document.documentElement;
      const req = el.requestFullscreen?.bind(el) || (el as any).webkitRequestFullscreen?.bind(el);
      if (req) {
        try {
          await req({ navigationUI: 'hide' });
        } catch {
          setStartError('Fullscreen permission denied. Please allow fullscreen when prompted, then try again.');
          setStarting(false);
          return;
        }
      }
    }
    // Electron path: fullscreen already active from launch.
    // OS lockdown (kiosk + C++ hook) will be activated by ExamRoomPage after this.

    onPass(streamRef.current);
  };

  const icon = (s: Check['status']) => {
    if (s === 'pass')     return <span className="text-green-400 text-lg">✓</span>;
    if (s === 'fail')     return <span className="text-red-400 text-lg">✗</span>;
    if (s === 'checking') return <span className="text-yellow-400 animate-spin inline-block text-lg">⟳</span>;
    if (s === 'skip')     return <span className="text-gray-600 text-lg">—</span>;
    return <span className="text-gray-600 text-lg">·</span>;
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="card p-8 w-full max-w-md">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="text-3xl">{IS_ELECTRON ? '🖥️' : '🌐'}</div>
          <div>
            <h2 className="text-xl font-bold text-white">System Preflight Check</h2>
            <p className="text-gray-400 text-xs mt-0.5">
              {IS_ELECTRON ? 'LockLens Desktop — OS-level security active' : 'Browser mode — web security active'}
            </p>
          </div>
        </div>

        {/* Checks */}
        <div className="space-y-3">
          {checks.map(c => (
            <div key={c.id} className={`flex items-center gap-3 p-3 rounded-lg border ${
              c.status === 'pass' ? 'bg-green-500/5 border-green-500/20' :
              c.status === 'fail' ? 'bg-red-500/5 border-red-500/20' :
              c.status === 'skip' ? 'bg-gray-800/30 border-gray-700/20 opacity-50' :
              'bg-gray-800/50 border-gray-700'
            }`}>
              <span className="w-6 text-center shrink-0">{icon(c.status)}</span>
              <div>
                <p className="text-white text-sm font-medium">{c.label}</p>
                {c.detail && (
                  <p className={`text-xs mt-0.5 ${c.status === 'fail' ? 'text-red-400' : 'text-gray-400'}`}>
                    {c.detail}
                  </p>
                )}
                {c.status === 'skip' && <p className="text-xs text-gray-600 mt-0.5">Not required for this exam</p>}
              </div>
            </div>
          ))}
        </div>

        {/* Rules notice */}
        {allDone && !anyFail && (
          <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <p className="text-amber-300 text-xs font-semibold mb-2">
              {IS_ELECTRON ? '🔒 Desktop Lockdown Rules' : '⚠️ Browser Security Rules'}
            </p>
            <ul className="text-xs text-gray-400 space-y-1 list-disc list-inside">
              {IS_ELECTRON ? (
                <>
                  <li>Alt+Tab, Win key, and trackpad gestures will be <strong className="text-white">blocked at OS level</strong></li>
                  <li>The taskbar and Start Menu will be <strong className="text-white">disabled</strong></li>
                  <li>Emergency exit: <strong className="text-white">Ctrl+Shift+F12</strong> (for administrators only)</li>
                </>
              ) : (
                <>
                  {flags.fullscreen_enforcement && <li>Exam opens in <strong className="text-white">fullscreen</strong> — do not exit</li>}
                  {flags.copy_paste_blocking && <li>Copy, paste &amp; right-click are <strong className="text-white">disabled</strong></li>}
                  {flags.tab_switch_detection && <li>Tab switching is <strong className="text-white">monitored</strong></li>}
                </>
              )}
              <li>All violations are reported to your examiner <strong className="text-white">in real time</strong></li>
            </ul>
          </div>
        )}

        {startError && (
          <p className="mt-3 text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            {startError}
          </p>
        )}

        {allDone && (
          <div className="mt-5">
            {anyFail ? (
              <div className="text-center space-y-3">
                <p className="text-red-400 text-sm">Please fix the issues above before continuing.</p>
                <button onClick={() => window.location.reload()} className="btn-ghost w-full">
                  ↺ Retry Checks
                </button>
              </div>
            ) : (
              <button
                onClick={handleStart}
                disabled={starting}
                className="btn-primary w-full text-lg py-3 disabled:opacity-60"
              >
                {starting ? 'Activating lockdown…' : IS_ELECTRON
                  ? '🔒 Activate Lockdown & Start Exam →'
                  : '🔒 Lock Screen & Start Exam →'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
