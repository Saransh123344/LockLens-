// frontend/src/types/electron.d.ts
// Tells TypeScript about window.electronAPI exposed by Electron's preload.js
// When running in a regular browser, window.electronAPI is undefined.

export {};

declare global {
  interface Window {
    electronAPI?: {
      /** true when running inside LockLens Desktop (Electron) */
      isElectron: boolean;

      /**
       * Activates full OS-level exam lockdown:
       * - C++ keyboard hook (blocks Alt+Tab, Win key, gestures)
       * - kiosk mode (no window chrome)
       * - Kills Windows shell (disables taskbar + touchpad gestures)
       * Call this when the student's exam begins (after preflight).
       */
      lockDown: () => void;

      /**
       * Releases all lockdown measures.
       * Call on exam submit, timer expiry, or examiner termination.
       */
      unlock: () => void;

      /**
       * Subscribe to OS-level violations reported by the main process.
       * Returns a cleanup function — call it in useEffect's return.
       */
      onViolation: (
        callback: (data: { type: string; details: string }) => void
      ) => () => void;
    };
  }
}
