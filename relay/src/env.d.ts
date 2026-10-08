declare namespace Cloudflare {
  interface Env {
    ROOM: DurableObjectNamespace<import("./room").Room>;
    LIMITER: DurableObjectNamespace<import("./limiter").Limiter>;
    ALLOWED_ORIGINS: string;
  }
}
interface Env extends Cloudflare.Env {}
