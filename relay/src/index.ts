import { type ErrorCode, TTL_OPTIONS } from "./protocol";
import { REJECT_HEADER } from "./ws";

export { Limiter } from "./limiter";
export { Room } from "./room";

const ROUTE = /^\/rooms\/([A-Za-z0-9_-]{43})\/ws$/;
const LIMITER_SHARDS = 16;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = ROUTE.exec(url.pathname);
    if (!match) return plain(404);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return plain(426);
    if (!originAllowed(request.headers.get("Origin"), env.ALLOWED_ORIGINS)) return plain(403);

    const room = env.ROOM.get(env.ROOM.idFromName(match[1]!));
    // the reject header is ours alone; never pass one through from the client
    const headers = new Headers(request.headers);
    headers.delete(REJECT_HEADER);
    const refuse = (code: ErrorCode) => {
      headers.set(REJECT_HEADER, code);
      return room.fetch(new Request(request, { headers }));
    };

    const create = url.searchParams.get("create");
    if (create !== null) {
      if (!(TTL_OPTIONS as readonly number[]).includes(Number(create))) return refuse("bad");
      const ip = request.headers.get("CF-Connecting-IP") ?? "";
      if (!(await limiterFor(env, ip).then((l) => l.hit(ip)))) return refuse("limit");
    }
    return room.fetch(new Request(request, { headers }));
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
