import { PublicError } from "./errors.js";
export class MediaDeliveryQueue {
    maxActive;
    maxWaiting;
    active = 0;
    waiting = [];
    constructor(maxActive, maxWaiting) {
        this.maxActive = maxActive;
        this.maxWaiting = maxWaiting;
    }
    get depth() {
        return this.active + this.waiting.length;
    }
    async acquire() {
        if (this.active >= this.maxActive) {
            if (this.waiting.length >= this.maxWaiting) {
                throw new PublicError(503, "media-queue-full", "The media delivery queue is full. Please retry shortly.");
            }
            await new Promise((resolve) => this.waiting.push(resolve));
        }
        this.active += 1;
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            this.active -= 1;
            this.waiting.shift()?.();
        };
    }
}
//# sourceMappingURL=media-delivery-queue.js.map