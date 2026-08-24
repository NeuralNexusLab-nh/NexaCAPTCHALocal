import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { PublicError } from "./errors.js";
import { MediaDeliveryQueue } from "./media-delivery-queue.js";
import { RenderQueue } from "./render-queue.js";
import { renderGravityImage } from "./gravity-renderer.js";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;
function randomBase64Url(byteLength) {
    return randomBytes(byteLength).toString("base64url");
}
function sha256Text(value) {
    return createHash("sha256").update(value).digest("base64url");
}
function safeTextEqual(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
export function normalizeAnswer(value) {
    return value.trim().toUpperCase().replaceAll(/\s+/g, "");
}
function takeRandomCharacter(characters, randomInteger) {
    return characters.splice(randomInteger(characters.length), 1)[0];
}
export function generateGravityAnswer(randomInteger = randomInt) {
    const pool = Array.from(ALPHABET);
    return Array.from({ length: 4 }, () => takeRandomCharacter(pool, randomInteger)).join("");
}
async function directorySize(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    let total = 0;
    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        total += entry.isDirectory() ? await directorySize(entryPath) : (await stat(entryPath)).size;
    }
    return total;
}
export class VerificationStore {
    renderQueue = new RenderQueue(config.maxRenderQueue, config.cpuDutyCycle);
    mediaQueue = new MediaDeliveryQueue(config.maxMediaDeliveries, config.maxMediaDeliveryQueue);
    gravityAnswerFactory;
    gravityRenderer;
    dataDirectory;
    imageDirectory;
    verificationDirectory;
    tokenDirectory;
    poolSizePerType;
    maintainPool;
    clock;
    mediaTickets = new Map();
    pendingMediaReferences = new Map();
    recordLocks = new Map();
    storageTail = Promise.resolve();
    verificationCount = 0;
    dataBytes = 0;
    cleanupTimer;
    poolTimers = [];
    refreshingPool = false;
    constructor(options = {}) {
        this.gravityAnswerFactory = options.gravityAnswerFactory ?? generateGravityAnswer;
        this.gravityRenderer = options.gravityRenderer ?? renderGravityImage;
        this.dataDirectory = options.dataDirectory ?? options.mediaDirectory ?? config.dataDirectory;
        this.imageDirectory = path.join(this.dataDirectory, "images");
        this.verificationDirectory = path.join(this.dataDirectory, "verification");
        this.tokenDirectory = path.join(this.dataDirectory, "tokens");
        this.poolSizePerType = options.poolSizePerType ?? config.poolSizePerType;
        this.maintainPool = options.startPoolMaintenance ?? true;
        this.clock = options.clock ?? Date.now;
    }
    async start() {
        await rm(path.join(this.dataDirectory, "animations"), { recursive: true, force: true });
        await Promise.all([
            mkdir(this.imageDirectory, { recursive: true }),
            mkdir(this.verificationDirectory, { recursive: true }),
            mkdir(this.tokenDirectory, { recursive: true })
        ]);
        this.dataBytes = await directorySize(this.dataDirectory);
        await this.rebuildIndexes();
        if (this.maintainPool) {
            await this.ensureAtLeastOne("gravity");
            const timer = setInterval(() => void this.refreshPool(), config.poolRefreshIntervalMs);
            timer.unref();
            this.poolTimers.push(timer);
        }
        this.cleanupTimer = setInterval(() => void this.cleanup(), config.cleanupIntervalMs);
        this.cleanupTimer.unref();
    }
    async stop() {
        for (const timer of this.poolTimers)
            clearInterval(timer);
        this.poolTimers.length = 0;
        if (this.cleanupTimer)
            clearInterval(this.cleanupTimer);
    }
    async rebuildIndexes() {
        const names = await readdir(this.verificationDirectory).catch(() => []);
        this.verificationCount = 0;
        for (const name of names) {
            if (!name.endsWith(".json"))
                continue;
            const recordPath = path.join(this.verificationDirectory, name);
            const record = await this.readJson(recordPath);
            if (!record)
                continue;
            if (record.type !== "gravity") {
                await this.removeTrackedFile(recordPath);
                await this.removeTrackedFile(path.join(this.tokenDirectory, name));
                continue;
            }
            this.verificationCount += 1;
            if (!record.mediaConsumed) {
                this.mediaTickets.set(record.mediaTicketHash, record.id);
                this.changeMediaReference(record.mediaPath, 1);
            }
        }
    }
    poolDirectory(_type) {
        return this.imageDirectory;
    }
    poolExtension(_type) {
        return ".png";
    }
    async poolFiles(type) {
        const extension = this.poolExtension(type);
        return (await readdir(this.poolDirectory(type)).catch(() => []))
            .filter((name) => name.endsWith(extension));
    }
    async ensureAtLeastOne(type) {
        if ((await this.poolFiles(type)).length === 0)
            await this.generatePoolEntry(type, false);
    }
    async refreshPool() {
        if (this.refreshingPool)
            return;
        this.refreshingPool = true;
        try {
            await this.generatePoolEntry("gravity", true);
        }
        catch (error) {
            console.error("Unable to refresh Gravity CAPTCHA pool", error);
        }
        finally {
            this.refreshingPool = false;
        }
    }
    async generatePoolEntry(type, replaceWhenFull) {
        const directory = this.poolDirectory(type);
        const extension = this.poolExtension(type);
        let answer = "";
        let target = "";
        for (let attempt = 0; attempt < 12; attempt += 1) {
            answer = this.gravityAnswerFactory();
            target = path.join(directory, `${answer}${extension}`);
            if (!(await stat(target).then(() => true).catch(() => false)))
                break;
            target = "";
        }
        if (!target)
            return;
        const media = await this.renderQueue.run(() => this.gravityRenderer(answer));
        this.assertStorageAvailable(media.byteLength);
        await this.writeMedia(target, media);
        const files = await this.poolFiles(type);
        if (replaceWhenFull && files.length > this.poolSizePerType) {
            const candidates = files.filter((name) => {
                if (name === path.basename(target))
                    return false;
                return (this.pendingMediaReferences.get(path.join(directory, name)) ?? 0) === 0;
            });
            const victim = candidates.length > 0
                ? candidates[randomInt(candidates.length)]
                : undefined;
            // If every old item is waiting to be loaded, discard the new item rather
            // than breaking a verification that has already been handed out.
            await this.removeTrackedFile(path.join(directory, victim ?? path.basename(target)));
        }
    }
    async create(captchaType = "gravity") {
        this.assertStorageAvailable(2_048);
        const files = await this.poolFiles(captchaType);
        if (files.length === 0) {
            throw new PublicError(503, "service-unavailable", "No verification media is ready.");
        }
        const selected = files[randomInt(files.length)];
        const answer = path.parse(selected).name;
        const id = randomBase64Url(9);
        const verificationId = `ver_${id}`;
        const mediaTicket = randomBase64Url(32);
        const mediaTicketHash = sha256Text(mediaTicket);
        const record = {
            id: verificationId,
            type: captchaType,
            answer,
            createdAt: this.clock(),
            expiresAt: null,
            successful: false,
            status: "pending",
            attemptsUsed: 0,
            retryAvailableAt: null,
            mediaPath: path.join(this.poolDirectory(captchaType), selected),
            mediaTicketHash,
            mediaConsumed: false
        };
        await this.writeJson(this.verificationPath(verificationId), record, true);
        this.verificationCount += 1;
        this.mediaTickets.set(mediaTicketHash, verificationId);
        this.changeMediaReference(record.mediaPath, 1);
        const mediaUrl = `/api/media/${encodeURIComponent(mediaTicket)}`;
        return {
            verificationId,
            captchaType,
            imageUrl: mediaUrl,
            expiresInMs: config.verificationLifetimeMs
        };
    }
    async claimMedia(mediaTicket) {
        const ticketHash = sha256Text(mediaTicket);
        const verificationId = this.mediaTickets.get(ticketHash);
        if (!verificationId)
            throw new PublicError(410, "media-consumed", "Media link expired.");
        const release = await this.mediaQueue.acquire();
        try {
            const result = await this.withRecordLock(verificationId, async () => {
                const record = await this.requireRecord(verificationId);
                if (record.mediaConsumed || !safeTextEqual(record.mediaTicketHash, ticketHash)) {
                    throw new PublicError(410, "media-consumed", "Media link expired.");
                }
                if (!(await stat(record.mediaPath).then(() => true).catch(() => false))) {
                    throw new PublicError(410, "media-unavailable", "Verification media is unavailable.");
                }
                record.mediaConsumed = true;
                record.expiresAt = this.clock() + config.verificationLifetimeMs;
                await this.writeJson(this.verificationPath(verificationId), record);
                this.mediaTickets.delete(ticketHash);
                this.changeMediaReference(record.mediaPath, -1);
                return { mediaPath: record.mediaPath, captchaType: record.type };
            });
            return { ...result, release };
        }
        catch (error) {
            release();
            throw error;
        }
    }
    async getPlaybackExpiry(verificationId) {
        const record = await this.getActiveRecord(verificationId);
        return new Date(record.expiresAt ?? this.clock()).toISOString();
    }
    async submitAnswer(verificationId, submittedAnswer) {
        return this.withRecordLock(verificationId, async () => {
            const record = await this.getActiveRecord(verificationId);
            if (record.status !== "pending")
                throw this.statusError(record.status);
            const now = this.clock();
            if (record.retryAvailableAt !== null && record.retryAvailableAt > now) {
                throw new PublicError(429, "answer-cooldown", "Wait before submitting another answer.");
            }
            if (normalizeAnswer(submittedAnswer) !== record.answer) {
                record.attemptsUsed += 1;
                const attemptsRemaining = config.maxAttempts - record.attemptsUsed;
                if (attemptsRemaining <= 0) {
                    record.status = "expired";
                    await this.writeJson(this.verificationPath(verificationId), record);
                    return { success: false, status: "verification_failed", attemptsRemaining: 0 };
                }
                record.retryAvailableAt = now + config.retryCooldownMs;
                await this.writeJson(this.verificationPath(verificationId), record);
                return {
                    success: false,
                    status: "incorrect",
                    attemptsRemaining,
                    retryAfterSeconds: config.retryCooldownMs / 1000
                };
            }
            const responseToken = randomBase64Url(48);
            const responseExpiresAt = now + config.responseLifetimeMs;
            record.status = "completed";
            record.successful = true;
            await this.writeJson(this.verificationPath(verificationId), record);
            await this.writeJson(this.tokenPath(verificationId), {
                id: verificationId,
                token: responseToken,
                expiresAt: responseExpiresAt
            }, true);
            return {
                success: true,
                status: "completed",
                verificationId,
                responseToken,
                expiresAt: new Date(responseExpiresAt).toISOString()
            };
        });
    }
    async verify(verificationId, responseToken) {
        return this.withRecordLock(verificationId, async () => {
            const tokenPath = this.tokenPath(verificationId);
            const token = await this.readJson(tokenPath);
            const now = this.clock();
            if (!token ||
                token.expiresAt <= now ||
                !safeTextEqual(token.token, responseToken)) {
                if (token?.expiresAt !== undefined && token.expiresAt <= now)
                    await this.removeTrackedFile(tokenPath);
                return { success: false, errorCode: "invalid-or-expired-verification" };
            }
            await this.removeTrackedFile(tokenPath);
            const record = await this.readRecord(verificationId);
            if (record) {
                record.status = "consumed";
                await this.writeJson(this.verificationPath(verificationId), record);
            }
            return { success: true, verifiedAt: new Date(now).toISOString() };
        });
    }
    getStats() {
        return {
            activeVerifications: this.verificationCount,
            renderQueueDepth: this.renderQueue.depth,
            mediaQueueDepth: this.mediaQueue.depth,
            dataBytes: this.dataBytes
        };
    }
    async cleanup() {
        const now = this.clock();
        const verificationNames = await readdir(this.verificationDirectory).catch(() => []);
        for (const name of verificationNames) {
            if (!name.endsWith(".json"))
                continue;
            const filePath = path.join(this.verificationDirectory, name);
            const record = await this.readJson(filePath);
            if (!record)
                continue;
            const terminal = record.status !== "pending";
            const expired = record.expiresAt !== null
                ? record.expiresAt <= now
                : now - record.createdAt >= config.verificationLifetimeMs;
            if (expired || (terminal && now - record.createdAt >= config.responseLifetimeMs)) {
                this.mediaTickets.delete(record.mediaTicketHash);
                if (!record.mediaConsumed)
                    this.changeMediaReference(record.mediaPath, -1);
                await this.removeTrackedFile(filePath);
                this.verificationCount = Math.max(0, this.verificationCount - 1);
            }
        }
        const tokenNames = await readdir(this.tokenDirectory).catch(() => []);
        for (const name of tokenNames) {
            if (!name.endsWith(".json"))
                continue;
            const filePath = path.join(this.tokenDirectory, name);
            const token = await this.readJson(filePath);
            if (!token || token.expiresAt <= now)
                await this.removeTrackedFile(filePath);
        }
    }
    verificationPath(verificationId) {
        const id = verificationId.startsWith("ver_") ? verificationId.slice(4) : verificationId;
        if (!ID_PATTERN.test(id))
            throw new PublicError(404, "verification-not-found", "Verification not found.");
        return path.join(this.verificationDirectory, `${id}.json`);
    }
    tokenPath(verificationId) {
        const id = verificationId.startsWith("ver_") ? verificationId.slice(4) : verificationId;
        if (!ID_PATTERN.test(id))
            throw new PublicError(404, "verification-not-found", "Verification not found.");
        return path.join(this.tokenDirectory, `${id}.json`);
    }
    async readRecord(verificationId) {
        return this.readJson(this.verificationPath(verificationId));
    }
    async requireRecord(verificationId) {
        const record = await this.readRecord(verificationId);
        if (!record)
            throw new PublicError(404, "verification-not-found", "Verification not found.");
        return record;
    }
    async getActiveRecord(verificationId) {
        const record = await this.requireRecord(verificationId);
        if (record.expiresAt === null) {
            throw new PublicError(409, "verification-not-started", "The verification media has not started.");
        }
        if (record.expiresAt <= this.clock() && record.status === "pending") {
            record.status = "expired";
            await this.writeJson(this.verificationPath(verificationId), record);
        }
        if (record.status === "expired")
            throw this.statusError(record.status);
        return record;
    }
    statusError(status) {
        if (status === "expired")
            return new PublicError(410, "verification-expired", "The verification expired.");
        return new PublicError(409, "verification-completed", "The verification is no longer pending.");
    }
    async withRecordLock(verificationId, task) {
        const previous = this.recordLocks.get(verificationId) ?? Promise.resolve();
        let release;
        const current = new Promise((resolve) => { release = resolve; });
        const chain = previous.then(() => current);
        this.recordLocks.set(verificationId, chain);
        await previous;
        try {
            return await task();
        }
        finally {
            release();
            if (this.recordLocks.get(verificationId) === chain)
                this.recordLocks.delete(verificationId);
        }
    }
    assertStorageAvailable(additionalBytes) {
        if (this.dataBytes + additionalBytes > config.maxDataBytes) {
            throw new PublicError(507, "storage-limit-reached", "Verification storage is full.");
        }
    }
    changeMediaReference(mediaPath, delta) {
        const next = Math.max(0, (this.pendingMediaReferences.get(mediaPath) ?? 0) + delta);
        if (next === 0)
            this.pendingMediaReferences.delete(mediaPath);
        else
            this.pendingMediaReferences.set(mediaPath, next);
    }
    async withStorageLock(task) {
        const previous = this.storageTail;
        let release;
        const current = new Promise((resolve) => { release = resolve; });
        this.storageTail = previous.then(() => current);
        await previous;
        try {
            return await task();
        }
        finally {
            release();
        }
    }
    async readJson(filePath) {
        try {
            return JSON.parse(await readFile(filePath, "utf8"));
        }
        catch (error) {
            const code = error.code;
            if (code === "ENOENT")
                return null;
            throw error;
        }
    }
    async writeJson(filePath, value, exclusive = false) {
        await this.withStorageLock(async () => {
            const serialized = `${JSON.stringify(value)}\n`;
            const oldSize = await stat(filePath).then((details) => details.size).catch(() => 0);
            const newSize = Buffer.byteLength(serialized);
            if (exclusive && oldSize > 0)
                throw new PublicError(409, "record-exists", "Record already exists.");
            // Account for the temporary file as well as the existing destination so
            // atomic writes never exceed the ten-gigabyte ceiling, even briefly.
            this.assertStorageAvailable(newSize);
            this.dataBytes += newSize;
            const temporary = `${filePath}.${randomBase64Url(6)}.tmp`;
            try {
                await writeFile(temporary, serialized, { flag: "wx" });
                await rename(temporary, filePath);
                this.dataBytes -= oldSize;
            }
            catch (error) {
                this.dataBytes -= newSize;
                throw error;
            }
            finally {
                await rm(temporary, { force: true });
            }
        });
    }
    async writeMedia(filePath, media) {
        await this.withStorageLock(async () => {
            this.assertStorageAvailable(media.byteLength);
            this.dataBytes += media.byteLength;
            try {
                await writeFile(filePath, media, { flag: "wx" });
            }
            catch (error) {
                this.dataBytes -= media.byteLength;
                throw error;
            }
        });
    }
    async removeTrackedFile(filePath) {
        await this.withStorageLock(async () => {
            const size = await stat(filePath).then((details) => details.size).catch(() => 0);
            await rm(filePath, { force: true });
            this.dataBytes = Math.max(0, this.dataBytes - size);
        });
    }
}
//# sourceMappingURL=store.js.map
