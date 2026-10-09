declare namespace Cloudflare {
  interface Env {
    ROOM: DurableObjectNamespace<import("./room").Room>;
    LIMITER: DurableObjectNamespace<import("./limiter").Limiter>;
    DOOR: DurableObjectNamespace<import("./door").Door>;
    ALLOWED_ORIGINS: string;
  }
}
interface Env extends Cloudflare.Env {}
