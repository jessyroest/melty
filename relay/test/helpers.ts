import { env, runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import type { ServerFrame } from "../src/protocol";

export const ORIGIN = "http://localhost:5173";

export function randomRoomId(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type Conn = {
  ws: WebSocket;
  next(): Promise<ServerFrame>;
  queue: ServerFrame[];
  closed: Promise<{ code: number }>;
  send(frame: unknown): void;
};

export async function connect(
  roomId: string,
  opts: { create?: number | string; origin?: string | null; ip?: string; headers?: Record<string, string> } = {},
): Promise<Conn> {
  const res = await rawFetch(roomId, opts);
  const ws = res.webSocket;
  if (!ws) throw new Error(`no websocket, status ${res.status}`);
  ws.accept();
  const queue: ServerFrame[] = [];
  const waiters: ((f: ServerFrame) => void)[] = [];
  ws.addEventListener("message", (e) => {
    const f = JSON.parse(e.data as string) as ServerFrame;
    const w = waiters.shift();
    if (w) w(f);
    else queue.push(f);
  });
  const closed = new Promise<{ code: number }>((r) => ws.addEventListener("close", (e) => r({ code: e.code })));
  return {
    ws,
    queue,
    closed,
    next: () => (queue.length ? Promise.resolve(queue.shift()!) : new Promise((r) => waiters.push(r))),
    send: (frame) => ws.send(typeof frame === "string" ? frame : JSON.stringify(frame)),
  };
}

export function rawFetch(
  roomId: string,
  opts: {
    create?: number | string;
    origin?: string | null;
    ip?: string;
    upgrade?: boolean;
    path?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const q = opts.create !== undefined ? `?create=${opts.create}` : "";
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.upgrade !== false) headers.Upgrade = "websocket";
  if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
  if (opts.ip) headers["CF-Connecting-IP"] = opts.ip;
  return (exports as unknown as { default: Fetcher }).default.fetch(`https://relay.test${opts.path ?? `/rooms/${roomId}/ws`}${q}`, { headers });
}

export const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

export function roomStub(roomId: string) {
  return env.ROOM.get(env.ROOM.idFromName(roomId));
}

export function storageKeys(roomId: string): Promise<string[]> {
  return runInDurableObject(roomStub(roomId), async (_i, state) => [...(await state.storage.list()).keys()]);
}

export function setStored(roomId: string, key: string, value: number): Promise<void> {
  return runInDurableObject(roomStub(roomId), (_i, state) => state.storage.put(key, value));
}

/** a well-formed frame; the relay can't tell it apart from real ciphertext */
export function fakeMsg(ctChars = 64) {
  return { t: "msg", iv: "A".repeat(16), ct: "B".repeat(ctChars) };
}
