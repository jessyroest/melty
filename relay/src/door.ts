import { DurableObject } from "cloudflare:workers";
import { isErrorCode } from "./protocol";
import { REJECT_HEADER, rejectSocket } from "./ws";

/** the Door object for a set of words (canonical indices) */
export function doorName(words: string): string {
  return `door-v1:${words}`;
}

/**
 * One Durable Object per set of 4 words (named after them). It remembers which
 * room the words point to, and until when: `roomId` and `expiresAt`, nothing else.
 * At `expiresAt` an alarm deletes both, so words expire with their room.
 * The words are not a key: they only find the room. Getting in still needs
 * someone inside to let you in.
 */
export class Door extends DurableObject<Env> {
  /** Register these words for a new room. False if they point to another live room. */
  async claim(roomId: string, expiresAt: number): Promise<boolean> {
    const cur = await this.current();
    if (cur && cur.roomId !== roomId) return false;
    await this.ctx.storage.put({ roomId, expiresAt });
    await this.ctx.storage.setAlarm(expiresAt);
    return true;
  }

  /** the room these words point to, if it hasn't expired */
  async lookup(): Promise<string | null> {
    return (await this.current())?.roomId ?? null;
  }

  /** refuse a knock that can't be answered through a room (unknown words) */
  async fetch(request: Request): Promise<Response> {
    const code = request.headers.get(REJECT_HEADER);
    return rejectSocket(this.ctx, code !== null && isErrorCode(code) ? code : "not_found");
  }

  // refused sockets only; they get closed right away
  async webSocketMessage(): Promise<void> {}
  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close(1000);
    } catch {
      // already closed
    }
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  private async current(): Promise<{ roomId: string; expiresAt: number } | null> {
    const m = await this.ctx.storage.get<string | number>(["roomId", "expiresAt"]);
    const roomId = m.get("roomId");
    const expiresAt = m.get("expiresAt");
    if (typeof roomId !== "string" || typeof expiresAt !== "number") return null;
    if (Date.now() >= expiresAt) {
      await this.ctx.storage.deleteAll();
      return null;
    }
    return { roomId, expiresAt };
  }
}
