import { createServer } from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import compression from "compression";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { config } from "./lib/config.js";
import { PublicError } from "./lib/errors.js";
import { apiPreflight, readAllowedParent, requireAllowedHost, sameOriginApi, widgetHeaders } from "./lib/security.js";
import { VerificationStore } from "./lib/store.js";

const store = new VerificationStore();
await store.start();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginOpenerPolicy: false, crossOriginResourcePolicy: false, frameguard: false }));
app.use(compression({ threshold: 1024 }));

app.get("/health/live", (_request, response) => response.set("Cache-Control", "no-store").json({ status: "ok" }));
app.get("/health/ready", (_request, response) => response.set("Cache-Control", "no-store").json({ status: "ready", ...store.getStats(), rssBytes: process.memoryUsage().rss }));
app.use(requireAllowedHost);

const readmeRoutes = ["/", "/README.md", "/README", "/readme.md", "/readme"];
app.get(readmeRoutes, async (_request, response, next) => {
  try {
    response.type("text/markdown; charset=utf-8").send(await readFile(path.resolve("README.md"), "utf8"));
  } catch (error) { next(error); }
});

app.options(/^\/api\//, apiPreflight);
app.use("/api", sameOriginApi, express.json({ limit: "4kb", strict: true }));
const limiter = rateLimit({ windowMs: 60000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false, message: { errorCode: "rate-limited", message: "Too many requests. Please retry later." } });
app.use("/api", limiter);

function rejectForMemory() {
  if (process.memoryUsage().rss > config.ramLimitBytes) throw new PublicError(503, "memory-limit-reached", "The service is temporarily at its configured memory limit.");
}

app.post("/api/verifications", async (request, response, next) => {
  try {
    rejectForMemory();
    if (request.body && Object.keys(request.body).some((key) => key !== "captchaType")) throw new PublicError(400, "invalid-request", "The request body is invalid.");
    if (request.body?.captchaType && request.body.captchaType !== "gravity") throw new PublicError(400, "invalid-request", "Only Gravity is available.");
    response.status(201).set("Cache-Control", "no-store").json(await store.create("gravity"));
  } catch (error) { next(error); }
});

app.get("/api/media/:mediaTicket", async (request, response, next) => {
  try {
    const media = await store.claimMedia(request.params.mediaTicket || "");
    response.set({ "Cache-Control": "no-store, max-age=0", "Content-Type": "image/png", "Cross-Origin-Resource-Policy": "same-origin" });
    response.sendFile(media.mediaPath, (error) => { media.release(); if (error) next(error); });
  } catch (error) { next(error); }
});

app.get("/api/audio/:audioTicket", async (request, response, next) => {
  try {
    const audio = await store.claimAudio(request.params.audioTicket || "");
    response.set({ "Cache-Control": "no-store, max-age=0", "Content-Type": "audio/mpeg", "Cross-Origin-Resource-Policy": "same-origin" });
    response.sendFile(audio.audioPath, (error) => { audio.release(); if (error) next(error); });
  } catch (error) { next(error); }
});

app.get("/api/verifications/:verificationId/status", async (request, response, next) => {
  try { response.set("Cache-Control", "no-store").json({ expiresAt: await store.getPlaybackExpiry(request.params.verificationId) }); }
  catch (error) { next(error); }
});

app.post("/api/verifications/:verificationId/answer", async (request, response, next) => {
  try {
    if (!request.body || typeof request.body.answer !== "string" || request.body.answer.length < 1 || request.body.answer.length > 12 || Object.keys(request.body).length !== 1) throw new PublicError(400, "invalid-request", "The request body is invalid.");
    response.set("Cache-Control", "no-store").json(await store.submitAnswer(request.params.verificationId, request.body.answer));
  } catch (error) { next(error); }
});

app.post("/api/siteverify", async (request, response, next) => {
  try {
    if (!request.body || !/^ver_[A-Za-z0-9_-]{12}$/.test(request.body.verificationId || "") || !/^[A-Za-z0-9_-]{64}$/.test(request.body.responseToken || "") || Object.keys(request.body).length !== 2) throw new PublicError(400, "invalid-request", "The request body is invalid.");
    response.set("Cache-Control", "no-store").json(await store.verify(request.body.verificationId, request.body.responseToken));
  } catch (error) { next(error); }
});

app.get(["/captcha.js", "/captcha/gravity.js"], widgetHeaders, (_request, response) => {
  response.set({ "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" }).sendFile(path.join(config.publicDirectory, "captcha.js"));
});
app.get("/widget", widgetHeaders, (request, response) => {
  if (!readAllowedParent(request)) return response.status(403).type("html").send("<!doctype html><title>403</title><h1>Embedding origin not allowed</h1>");
  response.set("Cache-Control", "public, max-age=300").sendFile(path.join(config.publicDirectory, "widget.html"));
});
app.use("/widget-assets", widgetHeaders, express.static(path.join(config.publicDirectory, "widget"), { fallthrough: false, maxAge: "5m" }));

app.use((request, response) => {
  if (request.path.startsWith("/api/")) return response.status(404).json({ errorCode: "not-found", message: "The requested API endpoint does not exist." });
  response.status(404).type("html").send("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>404</title><style>body{font:16px system-ui;background:#07101e;color:#e9f4ff;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:36rem;padding:2rem;border:1px solid #31577f;border-radius:14px}a{color:#68baff}</style><main><h1>404</h1><p>The requested page does not exist.</p><a href=\"/\">Read the NexaCAPTCHA Local guide</a></main></html>");
});

app.use((error, _request, response, _next) => {
  if (error instanceof PublicError) return response.status(error.statusCode).json({ errorCode: error.code, message: error.message });
  if (error instanceof SyntaxError) return response.status(400).json({ errorCode: "invalid-json", message: "The request body is not valid JSON." });
  console.error(error);
  response.status(500).json({ errorCode: "internal-error", message: "The service could not complete the request." });
});

const server = createServer(app);
server.listen(config.port, () => console.log(`NexaCAPTCHA Local listening on http://localhost:${config.port}`));

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  server.close(async () => { await store.stop(); process.exit(0); });
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
