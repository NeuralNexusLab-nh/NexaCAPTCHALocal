import { readFileSync } from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { Mp3Encoder } from "@breezystack/lamejs";
const SAMPLE_RATE = 16_000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const sourceCache = new Map();
function randomBetween(minimum, maximum) {
    return minimum + (maximum - minimum) * (randomInt(1_000_000) / 1_000_000);
}
function readPcm(character) {
    const cached = sourceCache.get(character);
    if (cached)
        return cached;
    const wave = readFileSync(path.resolve("audio-assets", "gravity", `${character}.wav`));
    let offset = 12;
    let pcmOffset = -1;
    let pcmLength = 0;
    while (offset + 8 <= wave.length) {
        const chunk = wave.toString("ascii", offset, offset + 4);
        const length = wave.readUInt32LE(offset + 4);
        if (chunk === "data") {
            pcmOffset = offset + 8;
            pcmLength = length;
            break;
        }
        offset += 8 + length + (length % 2);
    }
    if (pcmOffset < 0)
        throw new Error(`Invalid speech asset for ${character}.`);
    const samples = new Float32Array(Math.floor(pcmLength / 2));
    for (let index = 0; index < samples.length; index += 1) {
        samples[index] = wave.readInt16LE(pcmOffset + index * 2) / 32_768;
    }
    let start = 0;
    let end = samples.length;
    const threshold = 0.012;
    while (start < end && Math.abs(samples[start] ?? 0) < threshold)
        start += 1;
    while (end > start && Math.abs(samples[end - 1] ?? 0) < threshold)
        end -= 1;
    const padding = Math.round(SAMPLE_RATE * 0.045);
    const trimmed = samples.slice(Math.max(0, start - padding), Math.min(samples.length, end + padding));
    sourceCache.set(character, trimmed);
    return trimmed;
}
function addSpeech(destination, character, startSeconds, amplitude, rate) {
    const source = readPcm(character);
    const start = Math.round(startSeconds * SAMPLE_RATE);
    const length = Math.floor(source.length / rate);
    for (let index = 0; index < length && start + index < destination.length; index += 1) {
        const sourcePosition = index * rate;
        const lower = Math.floor(sourcePosition);
        const fraction = sourcePosition - lower;
        const sample = (source[lower] ?? 0) * (1 - fraction) + (source[lower + 1] ?? 0) * fraction;
        const fade = Math.min(1, index / 160, (length - index) / 160);
        destination[start + index] = (destination[start + index] ?? 0) + sample * amplitude * fade;
    }
}
function addCue(destination, startSeconds, frequency) {
    const start = Math.max(0, Math.round(startSeconds * SAMPLE_RATE));
    const length = Math.round(SAMPLE_RATE * 0.085);
    for (let index = 0; index < length && start + index < destination.length; index += 1) {
        const envelope = Math.sin(Math.PI * index / length);
        destination[start + index] = (destination[start + index] ?? 0) +
            Math.sin(2 * Math.PI * frequency * index / SAMPLE_RATE) * 0.16 * envelope;
    }
}
/** Builds a replayable spoken alternative from reusable character recordings.
 *  Target speech is marked by short cues; quieter, offset speech prevents a
 *  clean speech-to-text transcript without burying the accessible channel.
 */
export function renderGravityAudio(answer) {
    const spacing = randomBetween(1.25, 1.48);
    const duration = 1.1 + spacing * answer.length + randomBetween(0.55, 0.95);
    const mix = new Float32Array(Math.ceil(duration * SAMPLE_RATE));
    const targetStarts = [];
    for (let index = 0; index < answer.length; index += 1) {
        const start = 0.68 + index * spacing + randomBetween(-0.055, 0.055);
        targetStarts.push(start);
        addCue(mix, start - 0.18, 690 + index * 55);
        addSpeech(mix, answer[index], start, randomBetween(0.78, 0.9), randomBetween(0.95, 1.055));
    }
    const decoyCount = randomInt(4, 7);
    for (let index = 0; index < decoyCount; index += 1) {
        const targetIndex = randomInt(answer.length);
        let decoy = ALPHABET[randomInt(ALPHABET.length)];
        while (answer.includes(decoy))
            decoy = ALPHABET[randomInt(ALPHABET.length)];
        addSpeech(mix, decoy, Math.max(0.24, targetStarts[targetIndex] + randomBetween(-0.5, 0.52)), randomBetween(0.12, 0.21), randomBetween(0.91, 1.09));
    }
    let peak = 0;
    for (let index = 0; index < mix.length; index += 1) {
        mix[index] = (mix[index] ?? 0) + randomBetween(-0.0022, 0.0022);
        peak = Math.max(peak, Math.abs(mix[index] ?? 0));
    }
    const scale = peak > 0.96 ? 0.96 / peak : 1;
    const pcm = new Int16Array(mix.length);
    for (let index = 0; index < mix.length; index += 1) {
        pcm[index] = Math.round(Math.max(-1, Math.min(1, (mix[index] ?? 0) * scale)) * 32_767);
    }
    const encoder = new Mp3Encoder(1, SAMPLE_RATE, 64);
    const chunks = [];
    for (let offset = 0; offset < pcm.length; offset += 1_152) {
        const encoded = encoder.encodeBuffer(pcm.subarray(offset, offset + 1_152));
        if (encoded.length > 0)
            chunks.push(Buffer.from(encoded));
    }
    const final = encoder.flush();
    if (final.length > 0)
        chunks.push(Buffer.from(final));
    return Buffer.concat(chunks);
}
//# sourceMappingURL=gravity-audio-renderer.js.map