import { config } from "./config.js";

function effectiveOrigin(request) {
  const host = request.get("host");
  if (!host) return null;
  const forwarded = request.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwarded === "https" || forwarded === "http" ? forwarded : request.protocol;
  return `${protocol}://${host}`;
}

function loopback(origin) {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

export function hostAllowed(request) {
  const origin = effectiveOrigin(request);
  return Boolean(origin && (config.hostOrigins.includes(origin) || loopback(origin)));
}

export function requireAllowedHost(request, response, next) {
  if (hostAllowed(request)) return next();
  if (request.path.startsWith("/api/")) {
    return response.status(403).json({ errorCode: "invalid-host-origin", message: "This host is not allowed by HOST_ORIGIN." });
  }
  return response.status(403).type("html").send("<!doctype html><title>403</title><h1>403 — Host not allowed</h1>");
}

export function widgetHeaders(_request, response, next) {
  const ancestors = config.siteOrigins.join(" ");
  response.setHeader("Content-Security-Policy", `default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors ${ancestors}; form-action 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'`);
  response.setHeader("Cross-Origin-Opener-Policy", "unsafe-none");
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  response.removeHeader("X-Frame-Options");
  next();
}

export function readAllowedParent(request) {
  const value = typeof request.query.parentOrigin === "string" ? request.query.parentOrigin : "";
  try {
    const origin = new URL(value).origin;
    return config.siteOrigins.includes(origin) && value === origin ? origin : null;
  } catch {
    return null;
  }
}

export function sameOriginApi(request, response, next) {
  const origin = request.get("origin");
  if (!origin) return next();
  const expected = effectiveOrigin(request);
  if (origin !== expected) return response.status(403).json({
    errorCode: "cross-origin-request-denied",
    message: "Browser API requests must originate from the NexaCAPTCHA Local host."
  });
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  next();
}

export function apiPreflight(request, response) {
  const origin = request.get("origin");
  const expected = effectiveOrigin(request);
  const method = request.get("access-control-request-method")?.toUpperCase();
  const headers = (request.get("access-control-request-headers") || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (!origin || origin !== expected || !["GET", "POST"].includes(method || "") || headers.some((h) => h !== "content-type")) return response.status(403).end();
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Vary", "Origin, Access-Control-Request-Headers");
  response.status(204).end();
}
