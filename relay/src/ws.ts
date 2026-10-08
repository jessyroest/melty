import { type ServerFrame, SUBPROTOCOL } from "./protocol";

/**
 * Internal headers: set by the worker on the request it forwards to a room object.
 * Every client-sent header with this prefix is stripped first, so a client can't
 * forge one.
 */
export const INTERNAL_PREFIX = "x-relay-";
/** have the room object refuse the socket with this error code */
export const REJECT_HEADER = "X-Relay-Reject";
/** the validated ttl (seconds) of a create request */
export const CREATE_HEADER = "X-Relay-Create";
/** the validated owner hash */
export const OWNER_HEADER = "X-Relay-Owner";

/** a 101 that selects our subprotocol; without it browsers fail the handshake */
export function upgraded(webSocket: WebSocket): Response {
  return new Response(null, { status: 101, webSocket, headers: { "Sec-WebSocket-Protocol": SUBPROTOCOL } });
}

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
