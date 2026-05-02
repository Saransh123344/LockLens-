/**
 * LockLens Desktop — Electron Main Process
 *
 * LOCKDOWN PHASES:
 *   Phase 1 (launch → exam start):
 *     - Frameless fullscreen window, always on top
 *     - OS window buttons hidden (frame: false)
 *     - Electron-level shortcuts blocked (Ctrl+W, Alt+F4, etc.)
 *     - C++ blocker NOT yet active — student can still use keyboard normally
 *
 *   Phase 2 (exam:lockdown IPC received — student clicked "Start Exam"):
 *     - kiosk: true  → browser chrome vanishes, can't resize/minimise
 *     - C++ LowLevelKeyboardHook → blocks Alt+Tab, Win key, Ctrl+Esc, gestures
 *     - explorer.exe killed → disables taskbar + trackpad gestures (Windows only)
 *     - alwaysOnTop escalated to 'screen-saver' level
 *
 *   Phase 3 (exam:unlock IPC — submit / terminate):
 *     - kiosk: false
 *     - C++ hook released
 *     - explorer.exe restored
 *     - Student sees submission screen normally
 *
 *  EMERGENCY EXIT: Ctrl + Shift + F12
 *    → releases ALL hooks, restores explorer, quits app immediately
 */

'use strict';

const { app, BrowserWindow, globalShortcut, ipcMain, session } = require('electron');
const { exec } = require('child_process');
const path = require('path');

// ── Native C++ keyboard blocker ───────────────────────────────────────────────
let blocker;
try {
  blocker = require('./build/Release/keyboard_blocker.node');
  console.log('[LockLens] C++ keyboard blocker loaded successfully.');
} catch (err) {
  console.error('[LockLens] WARNING: Could not load C++ blocker:', err.message);
  // Graceful fallback — app still works, just without OS-level key blocking
  blocker = { start: () => false, stop: () => false };
}

let mainWindow;
let examLocked = false;

// ─────────────────────────────────────────────────────────────────────────────
// Shell management (Windows only)
// ─────────────────────────────────────────────────────────────────────────────
function killWindowsShell() {
  if (process.platform !== 'win32') return;
  exec('taskkill /f /im explorer.exe', (err) => {
    if (err) console.log('[LockLens] Explorer was already dead or access denied.');
    else console.log('[LockLens] Windows Shell killed — gestures/taskbar disabled.');
  });
}

function restoreWindowsShell() {
  if (process.platform !== 'win32') return;
  // Use cmd /c so it detaches from our process properly
  exec('cmd /c start explorer.exe', (err) => {
    if (err) console.log('[LockLens] Failed to restart explorer.exe:', err.message);
    else console.log('[LockLens] Windows Shell restored.');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Emergency kill switch — Ctrl + Shift + F12
// ─────────────────────────────────────────────────────────────────────────────
function registerEmergencyExit() {
  globalShortcut.register('CommandOrControl+Shift+F12', () => {
    console.log('[LockLens] EMERGENCY EXIT ACTIVATED — restoring system and quitting.');
    examUnlock();
    setTimeout(() => app.quit(), 1200);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Exam lockdown / unlock helpers
// ─────────────────────────────────────────────────────────────────────────────
function examLockdown() {
  if (examLocked) return;
  examLocked = true;
  console.log('[LockLens] EXAM LOCKDOWN ACTIVATED');

  // Escalate always-on-top to highest level
  if (mainWindow) {
    mainWindow.setKiosk(true);
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    mainWindow.focus();
  }

  // Start OS-level key hook
  const ok = blocker.start();
  console.log('[LockLens] C++ blocker started:', ok);

  // Kill shell (disables taskbar + trackpad gestures on Windows)
  killWindowsShell();
}

function examUnlock() {
  examLocked = false;
  console.log('[LockLens] Exam unlocked — restoring system.');

  if (mainWindow) {
    mainWindow.setKiosk(false);
    mainWindow.setAlwaysOnTop(true, 'floating'); // keep on top but not modal-level
  }

  blocker.stop();
  restoreWindowsShell();
}

// ─────────────────────────────────────────────────────────────────────────────
// Window creation
// ─────────────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: true,       // Fullscreen from launch
    alwaysOnTop: true,      // Can't be hidden under other windows
    skipTaskbar: true,      // Doesn't appear in Alt+Tab list (phase 1 best-effort)
    frame: false,           // No OS window chrome — no close/minimise/maximise buttons
    kiosk: false,           // Kiosk OFF until exam starts (student needs keyboard for login)
    backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: false,                      // Blocks F12 / Inspect
      preload: path.join(__dirname, 'preload.js'),
      // Prevent renderer from navigating away
      navigateOnDragDrop: false,
    },
  });

  // ── Prevent navigation away from the app ─────────────────────────────────
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('http://localhost:5173') ||
                    url.startsWith('http://localhost:4000') ||
                    url.startsWith('http://127.0.0.1');
    if (!allowed) {
      console.log('[LockLens] Blocked navigation to:', url);
      event.preventDefault();
    }
  });

  // Block new windows / popups
  mainWindow.webContents.setWindowOpenHandler(() => {
    console.log('[LockLens] Blocked popup attempt');
    return { action: 'deny' };
  });

  // ── Electron-level shortcut blocking (active from launch) ────────────────
  mainWindow.on('focus', () => {
    // These are registered at Electron level regardless of kiosk state
    const blocked = [
      'CommandOrControl+W',
      'CommandOrControl+T',
      'CommandOrControl+N',
      'CommandOrControl+R',
      'CommandOrControl+Shift+I',   // DevTools
      'CommandOrControl+Shift+J',   // DevTools
      'CommandOrControl+U',         // View Source
      'CommandOrControl+P',         // Print
      'Alt+F4',
      'F5',
      'F11',
    ];
    blocked.forEach(shortcut => {
      try {
        globalShortcut.register(shortcut, () => {
          console.log(`[LockLens] Blocked: ${shortcut}`);
          // Report to renderer as a violation if exam is active
          if (examLocked && mainWindow) {
            mainWindow.webContents.send('electron:violation', {
              type: 'KEYBOARD_SHORTCUT',
              details: `Blocked global shortcut: ${shortcut}`,
            });
          }
        });
      } catch (_) { /* shortcut may already be registered */ }
    });

    // Emergency exit — always registered
    registerEmergencyExit();
  });

  mainWindow.on('blur', () => {
    // Re-focus aggressively during exam
    if (examLocked && mainWindow) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.focus();
          mainWindow.webContents.send('electron:violation', {
            type: 'FOCUS_LOSS',
            details: 'Window lost focus during exam (OS level)',
          });
        }
      }, 100);
    }
  });

  // Prevent close during exam
  mainWindow.on('close', (event) => {
    if (examLocked) {
      event.preventDefault();
      console.log('[LockLens] Close attempt blocked during exam.');
      if (mainWindow) {
        mainWindow.focus();
        mainWindow.webContents.send('electron:violation', {
          type: 'CLOSE_ATTEMPT',
          details: 'Attempted to close exam window',
        });
      }
    }
  });

  // ── Load the React frontend ───────────────────────────────────────────────
  // Dev: loads Vite dev server. Production: load from built dist/
  const isDev = process.argv.includes('--dev') ||
                process.env.NODE_ENV === 'development' ||
                !app.isPackaged;

  const FRONTEND_URL = process.env.LOCKLENS_FRONTEND_URL || 'http://localhost:5173';

  if (isDev) {
    console.log(`[LockLens] Loading dev frontend: ${FRONTEND_URL}`);
    // Retry until Vite is ready
    loadWithRetry(FRONTEND_URL);
  } else {
    // Production: load built React app served by backend or from dist/
    const prodUrl = process.env.LOCKLENS_FRONTEND_URL || 'http://localhost:5173';
    console.log(`[LockLens] Loading production frontend: ${prodUrl}`);
    loadWithRetry(prodUrl);
  }
}

// Retry loading until the frontend dev server is up
function loadWithRetry(url, attempts = 0) {
  mainWindow.loadURL(url).catch(() => {
    if (attempts < 20) {
      console.log(`[LockLens] Frontend not ready yet, retrying in 1s... (${attempts + 1}/20)`);
      setTimeout(() => loadWithRetry(url, attempts + 1), 1000);
    } else {
      console.error('[LockLens] Could not connect to frontend after 20 attempts.');
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC handlers — React renderer communicates here
// ─────────────────────────────────────────────────────────────────────────────

// Student entered exam room and preflight passed → LOCK DOWN
ipcMain.on('exam:lockdown', () => {
  console.log('[LockLens] IPC: exam:lockdown received');
  examLockdown();
});

// Student submitted or was terminated → UNLOCK
ipcMain.on('exam:unlock', () => {
  console.log('[LockLens] IPC: exam:unlock received');
  examUnlock();
});

// Renderer wants to know if we're in Electron
ipcMain.handle('exam:isElectron', () => true);

// ─────────────────────────────────────────────────────────────────────────────
// App lifecycle
// ─────────────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Prevent any other page from running in the renderer
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // Relax CSP enough for localhost dev but block everything else
        'Content-Security-Policy': [
          "default-src 'self' http://localhost:* ws://localhost:* 'unsafe-inline' 'unsafe-eval' data: blob:",
        ],
      },
    });
  });

  createWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  blocker.stop();
  restoreWindowsShell();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    blocker.stop();
    restoreWindowsShell();
    app.quit();
  }
});
