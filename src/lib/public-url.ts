import "server-only";

/**
 * Nakhl Restaurant — public origin resolution behind a reverse proxy
 * ---------------------------------------------------------------------
 * The Docker/VPS deployment sits behind DirectAdmin's Apache reverse proxy
 * (plain HTTP on the loopback hop). Inside Next.js, `new URL(req.url).origin`
 * is derived from the inbound socket, so it says «http://…» even when the
 * real visitor is on https://your-domain.com.
 *
 * That origin feeds the ZarinPal `callback_url` and the post-payment
 * redirects, so it MUST reflect what the visitor's browser actually sees:
 *
 *   1. `X-Forwarded-Proto` / `X-Forwarded-Host` — set by the Apache vhost
 *      (docker/directadmin/nakhl-proxy.conf sets X-Forwarded-Proto https/http
 *      for the SSL / plain vhosts respectively).
 *   2. If NEITHER proxy header is present there is no reverse proxy in front
 *      (local `next dev`, direct curl) → fall back to the request URL's own
 *      origin, where the socket knows the truth.
 *
 * All header values are strictly validated (charset + length) before being
 * reflected into a URL — an attacker-controlled Host / X-Forwarded-Host can
 * never smuggle slashes, spaces or a second URL into the payment redirect.
 */

// hostname / IPv4 / IPv6-ish + optional port — no slashes, spaces, @, …
const HOST_RE = /^[a-zA-Z0-9._-]+(?::[0-9]{1,5})?$/;
const MAX_HOST_LENGTH = 253 + 6; // RFC max hostname + ":65535"

function firstForwardedValue(raw: string | null): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  return first || null;
}

/** Validated proxy protocol — only literal http/https are ever reflected. */
function forwardedProto(raw: string | null): "https" | "http" | null {
  const value = firstForwardedValue(raw)?.toLowerCase();
  if (value === "https") return "https";
  if (value === "http") return "http";
  return null;
}

/** Validated host value (charset + length) or null. */
function validHost(raw: string | null): string | null {
  const value = firstForwardedValue(raw);
  if (value && value.length <= MAX_HOST_LENGTH && HOST_RE.test(value)) {
    return value;
  }
  return null;
}

/**
 * The origin the visitor's browser is on, as `https://domain.tld`.
 * Use for payment callback URLs and absolute redirects.
 */
export function getPublicOrigin(req: Request): string {
  const proto = forwardedProto(req.headers.get("x-forwarded-proto"));
  const proxyHost = validHost(req.headers.get("x-forwarded-host"));

  // A reverse proxy is only assumed when it left POSITIVE evidence — with
  // neither header present (local dev / direct access) the socket URL wins.
  if (proto || proxyHost) {
    const host = proxyHost ?? validHost(req.headers.get("host"));
    if (host) return `${proto ?? "https"}://${host}`;
  }
  return new URL(req.url).origin;
}

/**
 * Absolute URL for a site-relative path, resolved against the public origin.
 * `path` must start with "/" (but not "//") — anything else is programmer
 * error and falls back to the plain origin, never a relative redirect.
 */
export function publicUrl(req: Request, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    return getPublicOrigin(req);
  }
  return `${getPublicOrigin(req)}${path}`;
}
