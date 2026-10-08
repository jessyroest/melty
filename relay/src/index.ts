import { parseOffer } from "./offer";
import { type ErrorCode, WS_PATH } from "./protocol";
import { CREATE_HEADER, INTERNAL_PREFIX, OWNER_HEADER, REJECT_HEADER } from "./ws";

export { Limiter } from "./limiter";
export { Room } from "./room";

const LIMITER_SHARDS = 16;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== WS_PATH) return plain(404);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return plain(426);
    if (!originAllowed(request.headers.get("Origin"), env.ALLOWED_ORIGINS)) return plain(403);
    // nothing about a room may travel in the URL
    if (url.search !== "") return plain(400);

    const offer = parseOffer(request.headers.get("Sec-WebSocket-Protocol"));
    // no room to answer through, or not our client: a plain refusal
    if (!offer) return plain(400);

    const room = env.ROOM.get(env.ROOM.idFromName(offer.roomId));
    // internal headers are ours alone; never pass one through from the client
    const headers = new Headers();
    for (const [k, v] of request.headers) {
      if (!k.toLowerCase().startsWith(INTERNAL_PREFIX) && k.toLowerCase() !== "sec-websocket-protocol") headers.set(k, v);
    }
    const forward = () => room.fetch(new Request(request, { headers }));
    const refuse = (code: ErrorCode) => {
      headers.set(REJECT_HEADER, code);
      return forward();
    };

    // every attempt counts, before the room is touched
    const ip = request.headers.get("CF-Connecting-IP") ?? "";
    const creating = offer.ok && offer.create !== undefined;
    const verdict = await limiterFor(env, ip).then((l) => l.admit(ip, creating));
    if (verdict !== "ok") return refuse(verdict);
    if (!offer.ok) return refuse("bad");

    if (offer.create !== undefined) headers.set(CREATE_HEADER, String(offer.create));
    if (offer.owner !== undefined) headers.set(OWNER_HEADER, offer.owner);
    return forward();
  },
} satisfies ExportedHandler<Env>;

function originAllowed(origin: string | null, allowed: string): boolean {
  if (!origin) return false;
  return allowed.split(",").some((o) => o.trim() === origin);
}

/** Spread load over a few limiter objects; a shard number says nothing useful about an address. */
async function limiterFor(env: Env, ip: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip)));
  return env.LIMITER.get(env.LIMITER.idFromName(`limiter-${digest[0]! % LIMITER_SHARDS}`));
}

function plain(status: number): Response {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
