// frontend/src/hooks/useProctoringEngine.ts
// Real blocking proctoring engine.
// In Electron: OS-level locking is handled by main.js + C++ blocker.
//              This hook still blocks copy/paste/right-click in the renderer,
//              and listens for OS-level violation events from the main process.
// In Browser:  Full capture-phase blocking + requestFullscreen enforcement.

import { useEffect, useRef, useCallback } from 'react';
import type { FeatureFlags, ViolationType } from '../types';
import { violationApi } from '../services/api';

interface ProctoringOptions {
  studentSessionId: string;
  flags: FeatureFlags;
  onViolation: (type: ViolationType, details?: string) => void;
  onWarning: (msg: string) => void;
  onFullscreenLost?: () => void;
}

const IS_ELECTRON = !!window.electronAPI?.isElectron;

const shouldBlockKey = (e: KeyboardEvent): boolean => {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (key === 'f12') return true;
  if (ctrl && e.shiftKey && ['i', 'j', 'c', 'k'].includes(key)) return true;
  if (ctrl && key === 'u') return true;
  if (ctrl && key === 'p') return true;
  if (e.key === 'F5' || (ctrl && key === 'r')) return true;
  if (ctrl && key === 'w') return true;
  if (ctrl && key === 't') return true;
  if (ctrl && key === 'n') return true;
  if (e.altKey && e.key === 'F4') return true;
  if (e.key === 'F11') return true;
  return false;
};

export function useProctoringEngine(opts: ProctoringOptions) {
  const { flags, studentSessionId, onViolation, onWarning, onFullscreenLost } = opts;

  const videoRef    = useRef<HTMLVideoElement | null>(null);
  const canvasRef   = useRef<HTMLCanvasElement | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const gazeTimeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureCleanups = useRef<Array<() => void>>([]);
  const cooldown    = useRef<Map<string, number>>(new Map());
  const fsRetryRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Throttled violation logger (5s cooldown per type)
  const logViolation = useCallback(async (type: ViolationType, details?: string) => {
    const now  = Date.now();
    const last = cooldown.current.get(type) || 0;
    if (now - last < 5000) return;
    cooldown.current.set(type, now);
    onViolation(type, details);
    try { await violationApi.log({ student_session_id: studentSessionId, type, details }); }
    catch { /* silent */ }
  }, [studentSessionId, onViolation]);

  const addCapture = useCallback((target: EventTarget, event: string, fn: EventListener) => {
    target.addEventListener(event, fn, { capture: true });
    captureCleanups.current.push(() => target.removeEventListener(event, fn, { capture: true }));
  }, []);

  // ── OS-level violation events from Electron main process ─────────────────
  useEffect(() => {
    if (!IS_ELECTRON) return;
    const cleanup = window.electronAPI!.onViolation((data) => {
      logViolation(data.type as ViolationType, data.details);
      if (data.type === 'FOCUS_LOSS') onWarning('⚠️ Window focus lost — stay on this screen!');
      if (data.type === 'CLOSE_ATTEMPT') onWarning('⚠️ Closing the exam window is not allowed!');
      if (data.type === 'KEYBOARD_SHORTCUT') onWarning('⚠️ That keyboard shortcut is blocked during the exam.');
    });
    return cleanup;
  }, [logViolation, onWarning]);

  // ── Keyboard blocking (renderer-level, works in both Electron + browser) ──
  useEffect(() => {
    const blockKeys = (e: KeyboardEvent) => {
      if (shouldBlockKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      if (flags.copy_paste_blocking) {
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && ['c', 'v', 'x', 'a'].includes(e.key.toLowerCase())) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          logViolation('COPY_PASTE', `Ctrl+${e.key.toUpperCase()} blocked`);
          onWarning('Copy/Paste is disabled during this exam.');
        }
      }
      if (flags.screenshot_blocking && (e.key === 'PrintScreen' || e.code === 'PrintScreen')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        logViolation('SCREENSHOT', 'Print Screen key detected');
        onWarning('Screenshots are not allowed during this exam.');
        document.body.style.filter = 'blur(20px)';
        setTimeout(() => { document.body.style.filter = ''; }, 1500);
      }
    };
    window.addEventListener('keydown', blockKeys, { capture: true });
    document.addEventListener('keydown', blockKeys, { capture: true });
    captureCleanups.current.push(
      () => window.removeEventListener('keydown', blockKeys, { capture: true }),
      () => document.removeEventListener('keydown', blockKeys, { capture: true }),
    );
  }, [flags.copy_paste_blocking, flags.screenshot_blocking, logViolation, onWarning]);

  // ── Copy / Paste clipboard events ─────────────────────────────────────────
  useEffect(() => {
    if (!flags.copy_paste_blocking) return;
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      logViolation('COPY_PASTE', `${e.type} blocked`);
      onWarning('Copy/Paste is disabled during this exam.');
    };
    addCapture(document, 'copy',  block as EventListener);
    addCapture(document, 'cut',   block as EventListener);
    addCapture(document, 'paste', block as EventListener);
  }, [flags.copy_paste_blocking, logViolation, addCapture, onWarning]);

  // ── Text selection ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!flags.copy_paste_blocking) return;
    const block = (e: Event) => e.preventDefault();
    addCapture(document, 'selectstart', block as EventListener);
    document.documentElement.style.userSelect = 'none';
    (document.documentElement.style as any).webkitUserSelect = 'none';
    return () => {
      document.documentElement.style.userSelect = '';
      (document.documentElement.style as any).webkitUserSelect = '';
    };
  }, [flags.copy_paste_blocking, addCapture]);

  // ── Right-click ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!flags.right_click_disable) return;
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      logViolation('RIGHT_CLICK', 'Right-click attempted');
    };
    addCapture(document, 'contextmenu', block as EventListener);
  }, [flags.right_click_disable, logViolation, addCapture]);

  // ── Fullscreen enforcement (BROWSER ONLY — Electron uses kiosk mode) ──────
  useEffect(() => {
    if (!flags.fullscreen_enforcement) return;
    if (IS_ELECTRON) return; // Electron's kiosk mode + C++ blocker handles this

    const isFS = () =>
      !!(document.fullscreenElement || (document as any).webkitFullscreenElement);

    const requestFS = () => {
      if (isFS()) return;
      const el = document.documentElement;
      const req = el.requestFullscreen?.bind(el) || (el as any).webkitRequestFullscreen?.bind(el);
      req?.({ navigationUI: 'hide' }).catch(() => {
        if (fsRetryRef.current) clearTimeout(fsRetryRef.current);
        fsRetryRef.current = setTimeout(requestFS, 800);
      });
    };

    const onFSChange = () => {
      if (!isFS()) {
        logViolation('FULLSCREEN_EXIT', 'Student exited fullscreen mode');
        onWarning('⚠️ Fullscreen exited — returning you to fullscreen…');
        onFullscreenLost?.();
        // Attempt synchronous re-entry from within the event handler
        requestFS();
        if (fsRetryRef.current) clearTimeout(fsRetryRef.current);
        fsRetryRef.current = setTimeout(requestFS, 500);
      }
    };

    document.addEventListener('fullscreenchange', onFSChange, { capture: true });
    document.addEventListener('webkitfullscreenchange', onFSChange, { capture: true });
    captureCleanups.current.push(
      () => document.removeEventListener('fullscreenchange', onFSChange, { capture: true }),
      () => document.removeEventListener('webkitfullscreenchange', onFSChange, { capture: true }),
    );

    requestFS();
    return () => { if (fsRetryRef.current) clearTimeout(fsRetryRef.current); };
  }, [flags.fullscreen_enforcement, logViolation, onWarning, onFullscreenLost]);

  // ── Tab switch detection ──────────────────────────────────────────────────
  useEffect(() => {
    if (!flags.tab_switch_detection) return;
    const fn = () => {
      if (document.hidden) {
        logViolation('TAB_SWITCH', 'Student switched away from exam');
        onWarning('⚠️ Tab switching detected!');
      }
    };
    document.addEventListener('visibilitychange', fn, { capture: true });
    captureCleanups.current.push(() =>
      document.removeEventListener('visibilitychange', fn, { capture: true })
    );
  }, [flags.tab_switch_detection, logViolation, onWarning]);

  // ── Focus loss detection ──────────────────────────────────────────────────
  useEffect(() => {
    if (!flags.focus_loss_detection) return;
    if (IS_ELECTRON) return; // Handled by main.js blur event + violation IPC
    const onBlur = () => {
      logViolation('FOCUS_LOSS', 'Browser window lost focus');
      onWarning('⚠️ Window focus lost. Return to the exam immediately.');
      [100, 400, 900].forEach(d => setTimeout(() => { try { window.focus(); } catch {} }, d));
    };
    window.addEventListener('blur', onBlur, { capture: true });
    captureCleanups.current.push(() =>
      window.removeEventListener('blur', onBlur, { capture: true })
    );
  }, [flags.focus_loss_detection, logViolation, onWarning]);

  // ── Screen share blocking ─────────────────────────────────────────────────
  useEffect(() => {
    if (!flags.screen_share_blocking) return;
    const orig = navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices);
    if (!orig) return;
    (navigator.mediaDevices as any).getDisplayMedia = async () => {
      logViolation('SCREEN_SHARE', 'Attempted to start screen sharing');
      onWarning('Screen sharing is not allowed during this exam.');
      throw new DOMException('Blocked by LockLens', 'NotAllowedError');
    };
    return () => { (navigator.mediaDevices as any).getDisplayMedia = orig; };
  }, [flags.screen_share_blocking, logViolation, onWarning]);

  // ── AI tool detection ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!flags.ai_tool_detection) return;
    const PATTERNS = ['parakeet', 'gptoverlay', 'copilot-exam', 'examai'];
    const observer = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) {
            const s = `${node.id} ${node.className}`.toLowerCase();
            if (PATTERNS.some(p => s.includes(p)))
              logViolation('AI_TOOL_DETECTED', `Suspicious DOM: ${node.tagName}#${node.id}`);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const origFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input
        : input instanceof URL ? input.href : (input as Request).url;
      if (/api\.openai\.com|anthropic\.com|generativelanguage\.googleapis|cohere\.ai/i.test(url))
        logViolation('AI_TOOL_DETECTED', `AI API request: ${url.split('?')[0]}`);
      return origFetch(input, init);
    };
    return () => { observer.disconnect(); window.fetch = origFetch; };
  }, [flags.ai_tool_detection, logViolation]);

  // ── Eye tracking (browser only — Electron doesn't restrict this) ──────────
  useEffect(() => {
    if (!flags.eye_tracking || !videoRef.current) return;
    let running = true;
    const load = async () => {
      try {
        const fa = await import('face-api.js');
        await Promise.all([
          fa.nets.tinyFaceDetector.loadFromUri('/models'),
          fa.nets.faceLandmark68TinyNet.loadFromUri('/models'),
        ]);
        const tick = async () => {
          if (!running || !videoRef.current) return;
          const dets = await fa
            .detectAllFaces(videoRef.current, new fa.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
            .withFaceLandmarks(true);
          if (dets.length === 0) logViolation('FACE_ABSENT', 'No face detected');
          else {
            const lm = dets[0].landmarks;
            const eyeMidX = (lm.getLeftEye()[0].x + lm.getRightEye()[3].x) / 2;
            const gazeOff = Math.abs(lm.getNose()[3].x - eyeMidX);
            if (gazeOff / dets[0].detection.box.width > 0.35)
              logViolation('GAZE_AWAY', `Gaze deviation: ${Math.round(gazeOff)}px`);
          }
          if (running) gazeTimeRef.current = setTimeout(tick, 3000);
        };
        tick();
      } catch (err) { console.warn('[EyeTracking]', err); }
    };
    load();
    return () => {
      running = false;
      if (gazeTimeRef.current) clearTimeout(gazeTimeRef.current);
    };
  }, [flags.eye_tracking, logViolation]);

  // ── Audio monitoring ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!flags.audio_monitoring || !streamRef.current) return;
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(streamRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let frames = 0;
      const interval = setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        if (avg > 20) { frames++; if (frames >= 3) { logViolation('AUDIO_DETECTED', `Level: ${Math.round(avg)}`); frames = 0; } }
        else frames = 0;
      }, 1000);
      return () => { clearInterval(interval); ctx.close(); };
    } catch { /* ignore */ }
  }, [flags.audio_monitoring, logViolation]);

  // ── Object / multi-person detection ──────────────────────────────────────
  const startObjectDetection = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      const tf = await import('@tensorflow/tfjs');
      await tf.ready();
      const cocossd = await import('@tensorflow-models/coco-ssd');
      const model = await cocossd.load({ base: 'lite_mobilenet_v2' });
      const BANNED = ['cell phone', 'book', 'laptop', 'remote', 'keyboard'];
      const interval = setInterval(async () => {
        if (!videoRef.current) return;
        try {
          const preds = await model.detect(videoRef.current);
          const persons = preds.filter(p => p.class === 'person' && p.score > 0.6);
          const banned  = preds.filter(p => BANNED.includes(p.class) && p.score > 0.6);
          if (flags.multiple_person_detection && persons.length > 1)
            logViolation('MULTIPLE_PERSONS', `${persons.length} persons detected`);
          if (flags.object_detection_ai && banned.length > 0)
            logViolation('OBJECT_DETECTED', `Banned: ${banned.map(b => b.class).join(', ')}`);
        } catch { /* ignore frame error */ }
      }, 3000);
      return () => clearInterval(interval);
    } catch (err) { console.warn('[ObjectDetection]', err); }
  }, [flags.multiple_person_detection, flags.object_detection_ai, logViolation]);

  const attachStream = useCallback((stream: MediaStream, video: HTMLVideoElement, canvas: HTMLCanvasElement) => {
    streamRef.current = stream;
    videoRef.current  = video;
    canvasRef.current = canvas;
    if (flags.object_detection_ai || flags.multiple_person_detection) startObjectDetection();
  }, [flags.object_detection_ai, flags.multiple_person_detection, startObjectDetection]);

  // Cleanup all capture listeners on unmount
  useEffect(() => {
    return () => {
      for (const fn of captureCleanups.current) fn();
      captureCleanups.current = [];
      if (gazeTimeRef.current) clearTimeout(gazeTimeRef.current);
      if (fsRetryRef.current) clearTimeout(fsRetryRef.current);
      document.documentElement.style.userSelect = '';
    };
  }, []);

  return { attachStream };
}
