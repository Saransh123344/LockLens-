// SocketContext.tsx — connects per-tab (uses sessionStorage token), supports cross-device
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextType>({ socket: null, connected: false });

// Same configurable URL as api.ts — empty string = use vite proxy (localhost)
const SOCKET_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
      return;
    }

    // Disconnect any previous socket before creating a new one (handles re-login)
    socketRef.current?.disconnect();

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
      // For cross-device (non-proxy) connections, path must match
      path: SOCKET_URL === '/' ? '/socket.io' : '/socket.io',
    });

    socket.on('connect',       () => setConnected(true));
    socket.on('disconnect',    () => setConnected(false));
    socket.on('connect_error', (err) => console.warn('[WS] Error:', err.message));

    socketRef.current = socket;
    // Force re-render so consumers get the new socket reference immediately
    setConnected(false);

    return () => { socket.disconnect(); };
  }, [isAuthenticated, token]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() { return useContext(SocketContext); }
