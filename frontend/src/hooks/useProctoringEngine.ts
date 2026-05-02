// frontend/src/hooks/useProctoringEngine.ts
// Real blocking proctoring engine — uses capture-phase event hooks to intercept
// BEFORE the browser processes them, plus Fullscreen API enforcement.
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

// Keys that must be blocked unconditionally during exam
const shouldBlockKey = (e: KeyboardEvent): boolean => {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (key === 'f12') return true;
  if (ctrl && e.shiftKey && ['i','j','c','k'].includes(key)) return true;
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<any>(null);
  const gazeIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureCleanupRef = useRef<Array<() => void>>([]);
  const violationCooldown = useRef<Map<string, number>>(new Map());
  const fsRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const logViolation = useCallback(async (type: ViolationType, details?: string) => {
    const now = Date.now();
    const last = violationCooldown.current.get(type) || 0;
    if (now - last < 5000) return;
    violationCooldown.current.set(type, now);
    onViolation(type, details);
    try {
      await violationApi.log({ student_session_id: studentSessionId, type, details });
    } catch { /* silent */ }
  }, [studentSessionId, onViolation]);

  const addCapture = useCallback((
    target: EventTarget,
    event: string,
    fn: EventListener,
    passive = false
  ) => {
    target.addEventListener(event, fn, { capture: true, passive });
    captureCleanupRef.current.push(() =>
      target.removeEventListener(event, fn, { capture: true })
    );
  }, []);

  // ── KEYBOARD HUB (capture phase — fires before browser default) ──────────
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
        if (ctrl && ['c','v','x','a'].includes(e.key.toLowerCase())) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          logViolation('COPY_PASTE', `Ctrl+${e.key.toUpperCase()} blocked`);
          onWarning('Copy/Paste is disabled during this exam.');
          return;
        }
      }
      if (flags.screenshot_blocking) {
        if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          logViolation('SCREENSHOT', 'Print Screen key detected');
          onWarning('Screenshots are not allowed during this exam.');
          document.body.style.filter = 'blur(20px)';
          setTimeout(() => { document.body.style.filter = ''; }, 1500);
          return;
        }
        if (e.key === 'S' && e.shiftKey && e.metaKey) {
          e.preventDefault();
          e.stopImmediatePropagation();
          logViolation('SCREENSHOT', 'Snipping Tool shortcut detected');
        }
      }
    };
    window.addEventListener('keydown', blockKeys, { capture: true });
    document.addEventListener('keydown', blockKeys, { capture: true });
    captureCleanupRef.current.push(
      () => window.removeEventListener('keydown', blockKeys, { capture: true }),
      () => document.removeEventListener('keydown', blockKeys, { capture: true }),
    );
  }, [flags.copy_paste_blocking, flags.screenshot_blocking, logViolation, onWarning]);

  // ── COPY / PASTE (clipboard events) ─────────────────────────────────────
  useEffect(() => {
    if (!flags.copy_paste_blocking) return;
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      logViolation('COPY_PASTE', `${e.type} blocked`);
      onWarning('Copy/Paste is disabled during this exam.');
    };
    addCapture(document, 'copy', block as EventListener);
    addCapture(document, 'cut', block as EventListener);
    addCapture(document, 'paste', block as EventListener);
  }, [flags.copy_paste_blocking, logViolation, addCapture, onWarning]);

  // ── TEXT SELECTION BLOCKING ──────────────────────────────────────────────
  useEffect(() => {
    if (!flags.copy_paste_blocking) return;
    const block = (e: Event) => { e.preventDefault(); };
    addCapture(document, 'selectstart', block as EventListener);
    document.documentElement.style.userSelect = 'none';
    (document.documentElement.style as any).webkitUserSelect = 'none';
    return () => {
      document.documentElement.style.userSelect = '';
      (document.documentElement.style as any).webkitUserSelect = '';
    };
  }, [flags.copy_paste_blocking, addCapture]);

  // ── RIGHT-CLICK BLOCKING ─────────────────────────────────────────────────
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

  // ── FULLSCREEN ENFORCEMENT ───────────────────────────────────────────────
  useEffect(() => {
    if (!flags.fullscreen_enforcement) return;

    const isFS = () =>
      !!(document.fullscreenElement || (document as any).webkitFullscreenElement);

    const requestFS = () => {
      if (isFS()) return;
      const el = document.documentElement;
      const req = el.requestFullscreen?.bind(el) || (el as any).webkitRequestFullscreen?.bind(el);
      if (req) {
        req({ navigationUI: 'hide' }).catch(() => {
          if (fsRetryRef.current) clearTimeout(fsRetryRef.current);
          fsRetryRef.current = setTimeout(requestFS, 800);
        });
      }
    };

    const onFSChange = () => {
      if (!isFS()) {
        logViolation('FULLSCREEN_EXIT', 'Student exited fullscreen mode');
        onWarning('⚠️ Fullscreen exited — returning you to fullscreen…');
        onFullscreenLost?.();
        // Attempt SYNCHRONOUS re-entry from within the event handler.
        // Browsers allow requestFullscreen from fullscreenchange callbacks.
        requestFS();
        // Also schedule a retry in case the sync call was rejected
        if (fsRetryRef.current) clearTimeout(fsRetryRef.current);
        fsRetryRef.current = setTimeout(requestFS, 500);
      }
    };

    document.addEventListener('fullscreenchange', onFSChange, { capture: true });
    document.addEventListener('webkitfullscreenchange', onFSChange, { capture: true });
    captureCleanupRef.current.push(
      () => document.removeEventListener('fullscreenchange', onFSChange, { capture: true }),
      () => document.removeEventListener('webkitfullscreenchange', onFSChange, { capture: true }),
    );

    // Initial request — works if called from a click handler in ExamRoom
    requestFS();

    return () => { if (fsRetryRef.current) clearTimeout(fsRetryRef.current); };
  }, [flags.fullscreen_enforcement, logViolation, onWarning, onFullscreenLost]);

  // ── TAB SWITCH DETECTION ─────────────────────────────────────────────────
  useEffect(() => {
    if (!flags.tab_switch_detection) return;
    const fn = () => {
      if (document.hidden) {
        logViolation('TAB_SWITCH', 'Student switched to another tab');
        onWarning('⚠️ Tab switching detected!');
      }
    };
    document.addEventListener('visibilitychange', fn, { capture: true });
    captureCleanupRef.current.push(() =>
      document.removeEventListener('visibilitychange', fn, { capture: true })
    );
  }, [flags.tab_switch_detection, logViolation, onWarning]);

  // ── FOCUS LOSS DETECTION + AGGRESSIVE REFOCUS ────────────────────────────
  useEffect(() => {
    if (!flags.focus_loss_detection) return;
    const onBlur = () => {
      logViolation('FOCUS_LOSS', 'Browser window lost focus');
      onWarning('⚠️ Window focus lost. Return to the exam immediately.');
      // Attempt to steal focus back up to 3 times
      [100, 400, 900].forEach(d => setTimeout(() => { try { window.focus(); } catch {} }, d));
    };
    window.addEventListener('blur', onBlur, { capture: true });
    captureCleanupRef.current.push(() =>
      window.removeEventListener('blur', onBlur, { capture: true })
    );
  }, [flags.focus_loss_detection, logViolation, onWarning]);

  // ── SCREEN SHARE BLOCKING ────────────────────────────────────────────────
  useEffect(() => {
    if (!flags.screen_share_blocking) return;
    const orig = navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices);
    if (!orig) return;
    (navigator.mediaDevices as any).getDisplayMedia = async (...args: any[]) => {
      logViolation('SCREEN_SHARE', 'Attempted to start screen sharing');
      onWarning('Screen sharing is not allowed during this exam.');
      throw new DOMException('Blocked by LockLens', 'NotAllowedError');
    };
    return () => { (navigator.mediaDevices as any).getDisplayMedia = orig; };
  }, [flags.screen_share_blocking, logViolation, onWarning]);

  // ── AI TOOL DETECTION ────────────────────────────────────────────────────
  useEffect(() => {
    if (!flags.ai_tool_detection) return;
    const PATTERNS = ['parakeet', 'gptoverlay', 'copilot-exam', 'examai'];
    const observer = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) {
            const s = `${node.id} ${node.className} ${(node as HTMLScriptElement).src || ''}`.toLowerCase();
            if (PATTERNS.some(p => s.includes(p)))
              logViolation('AI_TOOL_DETECTED', `Suspicious DOM: ${node.tagName}#${node.id}`);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const origFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (/api\.openai\.com|anthropic\.com|generativelanguage\.googleapis|cohere\.ai/i.test(url))
        logViolation('AI_TOOL_DETECTED', `AI API request: ${url.split('?')[0]}`);
      return origFetch(input, init);
    };
    return () => { observer.disconnect(); window.fetch = origFetch; };
  }, [flags.ai_tool_detection, logViolation]);

  // ── EYE TRACKING ─────────────────────────────────────────────────────────
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
          if (running) gazeIntervalRef.current = setTimeout(tick, 3000);
        };
        tick();
      } catch (err) { console.warn('[EyeTracking]', err); }
    };
    load();
    return () => {
      running = false;
      if (gazeIntervalRef.current) clearTimeout(gazeIntervalRef.current);
    };
  }, [flags.eye_tracking, logViolation]);

  // ── AUDIO MONITORING ─────────────────────────────────────────────────────
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
      const check = setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        if (avg > 20) { frames++; if (frames >= 3) { logViolation('AUDIO_DETECTED', `Level: ${Math.round(avg)}`); frames = 0; } }
        else frames = 0;
      }, 1000);
      return () => { clearInterval(check); ctx.close(); };
    } catch { /* ignore */ }
  }, [flags.audio_monitoring, logViolation]);

  // ── OBJECT / MULTI-PERSON DETECTION ──────────────────────────────────────
  const startObjectDetection = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      const tf = await import('@tensorflow/tfjs');
      await tf.ready();
      const cocossd = await import('@tensorflow-models/coco-ssd');
      const model = await cocossd.load({ base: 'lite_mobilenet_v2' });
      modelRef.current = model;
      const BANNED = ['cell phone', 'book', 'laptop', 'remote', 'keyboard'];
      const interval = setInterval(async () => {
        if (!videoRef.current) return;
        try {
          const preds = await model.detect(videoRef.current);
          const persons = preds.filter(p => p.class === 'person' && p.score > 0.6);
          const banned = preds.filter(p => BANNED.includes(p.class) && p.score > 0.6);
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
    videoRef.current = video;
    canvasRef.current = canvas;
    if (flags.object_detection_ai || flags.multiple_person_detection) startObjectDetection();
  }, [flags.object_detection_ai, flags.multiple_person_detection, startObjectDetection]);

  // Global cleanup
  useEffect(() => {
    return () => {
      for (const fn of captureCleanupRef.current) fn();
      captureCleanupRef.current = [];
      if (gazeIntervalRef.current) clearTimeout(gazeIntervalRef.current);
      if (fsRetryRef.current) clearTimeout(fsRetryRef.current);
      document.documentElement.style.userSelect = '';
    };
  }, []);

  return { attachStream };
}
