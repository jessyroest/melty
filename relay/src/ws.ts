import { CLOSE, type ErrorCode, type ServerFrame, SUBPROTOCOL } from "./protocol";

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
/** the validated room id (the object's name), for registering words */
export const ROOM_HEADER = "X-Relay-Room";
/** the validated words a create registers */
export const WORDS_HEADER = "X-Relay-Words";
/** this socket knocks (came in with 4 words): it joins the room's lobby, not the room */
export const LOBBY_HEADER = "X-Relay-Lobby";

/** tag for sockets that were only accepted to be told why they're refused */
export const REJECTED = "rejected";

/**
 * Accept the upgrade only to tell the browser why, then close: browsers can't
 * read the HTTP status of a failed upgrade. Goes through the hibernation API
 * like every other socket here; a plain `accept()`ed socket that is closed this
 * early makes the runtime report a lost connection.
 */
export function rejectSocket(ctx: DurableObjectState, code: ErrorCode): Response {
  const [client, server] = Object.values(new WebSocketPair());
  ctx.acceptWebSocket(server!, [REJECTED]);
  send(server!, { t: "error", code });
  server!.close(CLOSE[code], code);
  return upgraded(client!);
}

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
