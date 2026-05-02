/**
 * preload.js — Electron Context Bridge
 *
 * This file runs in a privileged context BEFORE the React app loads.
 * It safely exposes a limited set of IPC methods to the renderer
 * via window.electronAPI, without giving the renderer full Node.js access.
 *
 * The renderer (React) can:
 *   window.electronAPI.isElectron    → true (lets React know it's inside Electron)
 *   window.electronAPI.lockDown()    → tells main process to activate exam lockdown
 *   window.electronAPI.unlock()      → tells main process to release lockdown
 *   window.electronAPI.onViolation() → subscribe to OS-level violation events
 *   window.electronAPI.removeViolationListener() → cleanup on unmount
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Identity — React checks this to know it's running inside LockLens Desktop
  isElectron: true,

  // Activate full OS-level lockdown (C++ hook + kiosk + kill shell)
  // Called when student clicks "Start Exam" after passing preflight
  lockDown: () => {
    ipcRenderer.send('exam:lockdown');
  },

  // Release lockdown — called on exam submit or session termination
  unlock: () => {
    ipcRenderer.send('exam:unlock');
  },

  // Listen for OS-level violations reported by main process
  // (focus loss at OS level, window close attempt, blocked global shortcuts)
  onViolation: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('electron:violation', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('electron:violation', handler);
  },
});
