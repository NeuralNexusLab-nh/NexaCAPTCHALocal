import path from "node:path";
import "dotenv/config";

function integer(name, fallback, minimum, maximum) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function positiveNumber(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

function originList(name) {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is required. Copy .env.example to .env and configure it.`);
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (!values.length) throw new Error(`${name} must contain at least one origin.`);
  return Object.freeze(values.map((value) => {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== value || url.username || url.password) {
      throw new Error(`${name} contains an invalid origin: ${value}`);
    }
    return url.origin;
  }));
}

const cpuText = process.env.CPU_RESOURCE_LIMIT || "250m";
if (!/^\d+m$/.test(cpuText)) throw new Error("CPU_RESOURCE_LIMIT must use millicores, for example 250m.");
const cpuMillicores = Number.parseInt(cpuText, 10);
if (cpuMillicores < 10 || cpuMillicores > 1000) throw new Error("CPU_RESOURCE_LIMIT must be from 10m to 1000m.");

const storageGb = positiveNumber("STORAGE_RESOURCE_LIMIT_GB", 10);

export const config = Object.freeze({
  port: integer("PORT", 3000, 1, 65535),
  dataDirectory: path.resolve(process.env.DATA_DIR || "./data"),
  publicDirectory: path.resolve("public"),
  siteOrigins: originList("SITE_ORIGIN"),
  hostOrigins: originList("HOST_ORIGIN"),
  cpuMillicores,
  cpuDutyCycle: cpuMillicores / 1000,
  ramLimitBytes: integer("RAM_RESOURCE_LIMIT_MB", 300, 32, 65536) * 1024 * 1024,
  maxDataBytes: Math.floor(storageGb * 1024 * 1024 * 1024),
  verificationLifetimeMs: 120000,
  responseLifetimeMs: 300000,
  retryCooldownMs: 20000,
  maxAttempts: 2,
  maxRenderQueue: 6,
  maxMediaDeliveries: 12,
  maxMediaDeliveryQueue: 2000,
  poolSizePerType: 10,
  poolRefreshIntervalMs: 6000,
  cleanupIntervalMs: 15000
});
