import type { ServerFrame } from "./protocol";

/** internal: set by the worker (and stripped from client requests) to have the room object refuse a socket */
export const REJECT_HEADER = "X-Relay-Reject";

export function trySend(ws: WebSocket, data: string): void {
  try {
    ws.send(data);
  } catch {
    // socket already closing; nothing to do
  }
}

export function send(ws: WebSocket, frame: ServerFrame): void {
  trySend(ws, JSON.stringify(frame));
}
