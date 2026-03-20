import type { Server } from "socket.io";

let io: Server | null = null;

export function setIO(server: Server) {
  io = server;
}

export function getIO(): Server {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}

export function emitSocketEvent(event: string, data: unknown): void {
  if (!io) {
    return;
  }
  io.emit(event, data);
}
