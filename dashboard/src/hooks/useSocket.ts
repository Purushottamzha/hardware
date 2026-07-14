import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

const API = import.meta.env.VITE_API_URL || 'https://localhost:3000';

export function useSocket(
  eventHandlers: Record<string, (data: any) => void>,
  deps: any[] = []
): { socket: Socket | null } {
  useEffect(() => {
    const token = sessionStorage.getItem('token');
    const socket: Socket = io(API, {
      transports: ['websocket'],
      auth: { token },
    });

    for (const [event, handler] of Object.entries(eventHandlers)) {
      socket.on(event, handler);
    }

    return () => {
      for (const [event, handler] of Object.entries(eventHandlers)) {
        socket.off(event, handler);
      }
      socket.disconnect();
    };
  }, deps);

  return { socket: null };
}
