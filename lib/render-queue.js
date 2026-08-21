import { PublicError } from "./errors.js";
export class RenderQueue {
    maxQueued;
    targetDutyCycle;
    tail = Promise.resolve();
    queued = 0;
    constructor(maxQueued, targetDutyCycle = 0.25) {
        this.maxQueued = maxQueued;
        this.targetDutyCycle = targetDutyCycle;
    }
    get depth() {
        return this.queued;
    }
    async run(task) {
        if (this.queued >= this.maxQueued) {
            throw new PublicError(503, "service-unavailable", "The render queue is currently full. Please retry shortly.");
        }
        this.queued += 1;
        const previous = this.tail;
        let release;
        this.tail = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        const startedAt = performance.now();
        try {
            return await task();
        }
        finally {
            const workDuration = performance.now() - startedAt;
            const cooldown = Math.max(0, workDuration * (1 / this.targetDutyCycle - 1));
            if (cooldown > 1) {
                await new Promise((resolve) => setTimeout(resolve, cooldown));
            }
            this.queued -= 1;
            release();
        }
    }
}
//# sourceMappingURL=render-queue.js.map