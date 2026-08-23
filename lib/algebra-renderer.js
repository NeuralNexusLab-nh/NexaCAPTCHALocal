import { randomBytes, randomInt } from "node:crypto";
import { deflateSync } from "node:zlib";
import { stringToPaths } from "hershey";
import { VISUAL_THEMES } from "./visual-themes.js";
export const ALGEBRA_WIDTH = 840;
export const ALGEBRA_HEIGHT = 260;
const CRC_TABLE = Array.from({ length: 256 }, (_value, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
});
function createPrng(seed) {
    let state = new DataView(seed.buffer, seed.byteOffset, seed.byteLength).getUint32(0, true)
        || 0x9e3779b9;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x1_0000_0000;
    };
}
function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data)
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
    const typeBytes = Buffer.from(type, "ascii");
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    typeBytes.copy(chunk, 4);
    Buffer.from(data).copy(chunk, 8);
    chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.length);
    return chunk;
}
function encodePng(pixels) {
    const rowLength = ALGEBRA_WIDTH * 4;
    const scanlines = Buffer.alloc((rowLength + 1) * ALGEBRA_HEIGHT);
    for (let y = 0; y < ALGEBRA_HEIGHT; y += 1) {
        const target = y * (rowLength + 1);
        scanlines[target] = 0;
        Buffer.from(pixels.buffer, pixels.byteOffset + y * rowLength, rowLength).copy(scanlines, target + 1);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(ALGEBRA_WIDTH, 0);
    header.writeUInt32BE(ALGEBRA_HEIGHT, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", deflateSync(scanlines, { level: 7 })),
        pngChunk("IEND", Buffer.alloc(0))
    ]);
}
function blendPixel(pixels, x, y, color) {
    if (x < 0 || y < 0 || x >= ALGEBRA_WIDTH || y >= ALGEBRA_HEIGHT)
        return;
    const index = (Math.floor(y) * ALGEBRA_WIDTH + Math.floor(x)) * 4;
    const alpha = color[3] / 255;
    pixels[index] = Math.round((pixels[index] ?? 0) * (1 - alpha) + color[0] * alpha);
    pixels[index + 1] = Math.round((pixels[index + 1] ?? 0) * (1 - alpha) + color[1] * alpha);
    pixels[index + 2] = Math.round((pixels[index + 2] ?? 0) * (1 - alpha) + color[2] * alpha);
    pixels[index + 3] = 255;
}
function drawDisc(pixels, centerX, centerY, radius, color) {
    const radiusSquared = radius * radius;
    for (let y = Math.floor(centerY - radius); y <= Math.ceil(centerY + radius); y += 1) {
        for (let x = Math.floor(centerX - radius); x <= Math.ceil(centerX + radius); x += 1) {
            const dx = x + 0.5 - centerX;
            const dy = y + 0.5 - centerY;
            if (dx * dx + dy * dy <= radiusSquared)
                blendPixel(pixels, x, y, color);
        }
    }
}
function drawLine(pixels, from, to, thickness, color) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 1.25));
    for (let step = 0; step <= steps; step += 1) {
        const progress = step / steps;
        drawDisc(pixels, from[0] + dx * progress, from[1] + dy * progress, thickness, color);
    }
}
function nonZero(randomInteger, magnitude = 8) {
    const value = randomInteger(magnitude) + 1;
    return randomInteger(2) === 0 ? -value : value;
}
function signed(value) {
    return value < 0 ? `-${Math.abs(value)}` : `+${value}`;
}
function group(x, y, constant) {
    return `${x}x${signed(y)}y${signed(constant)}`;
}
function outerTerm(multiplier, expression, first = false) {
    const absolute = Math.abs(multiplier);
    if (first)
        return `${multiplier < 0 ? "-" : ""}${absolute}(${expression})`;
    return `${multiplier < 0 ? "-" : "+"}${absolute}(${expression})`;
}
function createEquation(answerX, answerY, randomInteger) {
    const leftFirst = [
        nonZero(randomInteger, 5),
        nonZero(randomInteger),
        nonZero(randomInteger),
        randomInteger(25) - 12
    ];
    const leftSecond = [
        nonZero(randomInteger, 5),
        nonZero(randomInteger),
        nonZero(randomInteger),
        randomInteger(25) - 12
    ];
    const right = [
        nonZero(randomInteger, 5),
        nonZero(randomInteger),
        nonZero(randomInteger),
        randomInteger(25) - 12
    ];
    const canonicalX = leftFirst[0] * leftFirst[1]
        + leftSecond[0] * leftSecond[1]
        - right[0] * right[1];
    const canonicalY = leftFirst[0] * leftFirst[2]
        + leftSecond[0] * leftSecond[2]
        - right[0] * right[2];
    const leftValue = leftFirst[0]
        * (leftFirst[1] * answerX + leftFirst[2] * answerY + leftFirst[3])
        + leftSecond[0]
            * (leftSecond[1] * answerX + leftSecond[2] * answerY + leftSecond[3]);
    const rightGroupValue = right[0]
        * (right[1] * answerX + right[2] * answerY + right[3]);
    const rightOffset = leftValue - rightGroupValue;
    const text = `${outerTerm(leftFirst[0], group(leftFirst[1], leftFirst[2], leftFirst[3]), true)}`
        + `${outerTerm(leftSecond[0], group(leftSecond[1], leftSecond[2], leftSecond[3]))}`
        + `=${outerTerm(right[0], group(right[1], right[2], right[3]), true)}${signed(rightOffset)}`;
    return {
        text,
        shape: { leftFirst, leftSecond, right, rightOffset, canonicalX, canonicalY }
    };
}
export function generateAlgebraProblem(randomInteger = randomInt) {
    const answerX = randomInteger(101) - 50;
    const answerY = randomInteger(101) - 50;
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const first = createEquation(answerX, answerY, randomInteger);
        const second = createEquation(answerX, answerY, randomInteger);
        const determinant = first.shape.canonicalX * second.shape.canonicalY
            - second.shape.canonicalX * first.shape.canonicalY;
        if (determinant === 0)
            continue;
        if (Math.max(first.text.length, second.text.length) > 74)
            continue;
        return { answerX, answerY, equations: [first.text, second.text] };
    }
    throw new Error("Unable to generate a non-degenerate Algebra problem.");
}
function clampChannel(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
}
function fillBackground(pixels, random, theme) {
    for (let y = 0; y < ALGEBRA_HEIGHT; y += 1) {
        for (let x = 0; x < ALGEBRA_WIDTH; x += 1) {
            const index = (y * ALGEBRA_WIDTH + x) * 4;
            const wave = Math.sin(x * 0.022 + y * 0.035) * 1.5;
            const noise = (random() - 0.5) * theme.backgroundVariation;
            pixels[index] = clampChannel(theme.background[0] + wave + noise);
            pixels[index + 1] = clampChannel(theme.background[1] + wave * 0.6 + noise * 0.7);
            pixels[index + 2] = clampChannel(theme.background[2] + wave + noise);
            pixels[index + 3] = 255;
        }
    }
}
function applyGravityField(point, wells, maxCumulativeSwirl = Number.POSITIVE_INFINITY) {
    let x = point[0];
    let y = point[1];
    let remainingSwirl = maxCumulativeSwirl;
    for (const well of wells) {
        const relativeX = x - well.x;
        const relativeY = y - well.y;
        const distance = Math.max(18, Math.hypot(relativeX, relativeY));
        const influence = Math.exp(-0.9 * (distance / well.radius) ** 2);
        const coreEase = Math.min(1, distance / 44);
        const requestedAngle = well.swirl * influence * coreEase;
        const angle = Math.max(-remainingSwirl, Math.min(remainingSwirl, requestedAngle));
        remainingSwirl = Math.max(0, remainingSwirl - Math.abs(angle));
        const radialScale = 1 - well.pull * influence * coreEase;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        x = well.x + (relativeX * cosine - relativeY * sine) * radialScale;
        y = well.y + (relativeX * sine + relativeY * cosine) * radialScale;
    }
    return [
        ALGEBRA_WIDTH / 2 + (x - ALGEBRA_WIDTH / 2) * 0.94,
        ALGEBRA_HEIGHT / 2 + (y - ALGEBRA_HEIGHT / 2) * 0.8
    ];
}
function drawGravityBezier(pixels, points, thickness, color, wells) {
    let previous = applyGravityField(points[0], wells);
    for (let step = 1; step <= 180; step += 1) {
        const t = step / 180;
        const inverse = 1 - t;
        const source = [
            inverse ** 3 * points[0][0] + 3 * inverse ** 2 * t * points[1][0]
                + 3 * inverse * t ** 2 * points[2][0] + t ** 3 * points[3][0],
            inverse ** 3 * points[0][1] + 3 * inverse ** 2 * t * points[1][1]
                + 3 * inverse * t ** 2 * points[2][1] + t ** 3 * points[3][1]
        ];
        const current = applyGravityField(source, wells);
        drawLine(pixels, previous, current, thickness, color);
        previous = current;
    }
}
function drawOptionalGrid(pixels, random, theme) {
    if (!theme.gridColor)
        return;
    const spacing = 18 + Math.floor(random() * 11);
    const offsetX = Math.floor(random() * spacing);
    const offsetY = Math.floor(random() * spacing);
    for (let x = offsetX; x < ALGEBRA_WIDTH; x += spacing) {
        drawLine(pixels, [x, 0], [x, ALGEBRA_HEIGHT], 0.55, theme.gridColor);
    }
    for (let y = offsetY; y < ALGEBRA_HEIGHT; y += spacing) {
        drawLine(pixels, [0, y], [ALGEBRA_WIDTH, y], 0.55, theme.gridColor);
    }
}
function renderEquation(pixels, text, centerY, random, color, innerColor, ghostColor, wells) {
    const glyph = stringToPaths(text);
    const sourceWidth = Math.max(1, glyph.bounds.maxX - glyph.bounds.minX);
    const sourceHeight = Math.max(1, glyph.bounds.maxY - glyph.bounds.minY);
    const scale = Math.min(745 / sourceWidth, 70 / sourceHeight);
    const left = (ALGEBRA_WIDTH - sourceWidth * scale) / 2;
    const phase = random() * Math.PI * 2;
    const shear = (random() - 0.5) * 0.1;
    const gravityLimit = 15 * Math.PI / 180;
    const transform = (point) => {
        const rawX = left + (point[0] - glyph.bounds.minX) * scale;
        const normalizedY = (point[1] - (glyph.bounds.minY + glyph.bounds.maxY) / 2) * scale;
        const wave = Math.sin(rawX * 0.018 + phase) * 3
            + Math.sin(rawX * 0.007 - phase * 0.6) * 1.8;
        const source = [
            rawX + normalizedY * shear,
            centerY - normalizedY + wave
        ];
        // Use a continuously moving local anchor. Quantized anchors create a new
        // coordinate frame every few pixels and can throw a connected stroke away
        // from the rest of its character at a boundary.
        const anchor = [rawX, centerY + wave];
        const warpedSource = applyGravityField(source, wells, gravityLimit);
        const warpedAnchor = applyGravityField(anchor, wells, gravityLimit);
        return [
            anchor[0] + warpedSource[0] - warpedAnchor[0],
            anchor[1] + warpedSource[1] - warpedAnchor[1]
        ];
    };
    const transformedPaths = [];
    for (const path of glyph.paths) {
        const transformed = [];
        for (let index = 1; index < path.length; index += 1) {
            const from = path[index - 1];
            const to = path[index];
            if (!from || !to)
                continue;
            const steps = Math.max(4, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1])));
            for (let step = index === 1 ? 0 : 1; step <= steps; step += 1) {
                const progress = step / steps;
                transformed.push(transform([
                    from[0] + (to[0] - from[0]) * progress,
                    from[1] + (to[1] - from[1]) * progress
                ]));
            }
        }
        if (transformed.length > 1)
            transformedPaths.push(transformed);
    }
    const strokeStyle = random();
    const thickness = strokeStyle < 0.42 ? 0.85 + random() * 0.4 : 1.1 + random() * 0.45;
    const drawPaths = (lineWidth, lineColor, offsetX = 0, offsetY = 0) => {
        for (const path of transformedPaths) {
            for (let index = 1; index < path.length; index += 1) {
                drawLine(pixels, [path[index - 1][0] + offsetX, path[index - 1][1] + offsetY], [path[index][0] + offsetX, path[index][1] + offsetY], lineWidth * (0.92 + Math.sin(index * 1.7 + phase) * 0.08), lineColor);
            }
        }
    };
    if (strokeStyle > 0.82)
        drawPaths(thickness * 0.72, ghostColor, 2 + random() * 3, random() * 3 - 1.5);
    drawPaths(thickness, color);
    // Keep outlined equations uncommon. Frequent hollow strokes reduce human
    // readability after the image is scaled inside the widget.
    if (strokeStyle >= 0.72 && strokeStyle <= 0.8) {
        drawPaths(thickness * 0.4, innerColor);
    }
}
export function renderAlgebraImage(problem) {
    const random = createPrng(randomBytes(4));
    const pixels = new Uint8Array(ALGEBRA_WIDTH * ALGEBRA_HEIGHT * 4);
    const theme = VISUAL_THEMES[Math.floor(random() * VISUAL_THEMES.length)];
    fillBackground(pixels, random, theme);
    drawOptionalGrid(pixels, random, theme);
    const primaryWell = {
        x: 150 + random() * 540,
        y: 42 + random() * 176,
        radius: 185 + random() * 90,
        pull: 0.12 + random() * 0.09,
        swirl: (random() < 0.5 ? -1 : 1) * (0.82 + random() * 0.52)
    };
    const wells = [primaryWell];
    if (random() < 0.62) {
        wells.push({
            x: Math.max(85, Math.min(ALGEBRA_WIDTH - 85, ALGEBRA_WIDTH - primaryWell.x + (random() - 0.5) * 120)),
            y: Math.max(32, Math.min(ALGEBRA_HEIGHT - 32, ALGEBRA_HEIGHT - primaryWell.y + (random() - 0.5) * 70)),
            radius: 145 + random() * 85,
            pull: 0.055 + random() * 0.065,
            swirl: (random() < 0.5 ? -1 : 1) * (0.34 + random() * 0.42)
        });
    }
    const paleLineCount = 1 + Math.floor(random() * 4);
    for (let index = 0; index < paleLineCount; index += 1) {
        const base = 45 + random() * 170;
        drawGravityBezier(pixels, [
            [-20, base],
            [220 + random() * 120, base + (random() - 0.5) * 115],
            [620 + random() * 120, base + (random() - 0.5) * 115],
            [ALGEBRA_WIDTH + 20, 45 + random() * 170]
        ], 1.2 + random() * 1.1, theme.paleLine, wells);
    }
    // Foreground-strength lines are placed before the equations. They retain
    // Gravity's crossings and thickness variation without erasing a minus sign
    // or turning a plus sign into a vertical bar.
    const foregroundLineCount = 1 + Math.floor(random() * 4);
    for (let index = 0; index < foregroundLineCount; index += 1) {
        const base = 46 + random() * 168;
        drawGravityBezier(pixels, [
            [-16, base],
            [260 + random() * 100, base + (random() - 0.5) * 92],
            [610 + random() * 100, base + (random() - 0.5) * 92],
            [ALGEBRA_WIDTH + 16, 45 + random() * 170]
        ], 1.4 + random() * 1.4, theme.foregroundColors[index % theme.foregroundColors.length], wells);
    }
    const noiseMarkCount = 18 + Math.floor(random() * 55);
    for (let index = 0; index < noiseMarkCount; index += 1) {
        drawDisc(pixels, 18 + random() * (ALGEBRA_WIDTH - 36), 15 + random() * (ALGEBRA_HEIGHT - 30), 0.8 + random() * 1.4, theme.noiseColor);
    }
    const paletteOffset = Math.floor(random() * theme.glyphColors.length);
    renderEquation(pixels, problem.equations[0], 80, random, theme.glyphColors[paletteOffset], theme.innerColors[paletteOffset % theme.innerColors.length], theme.foregroundColors[(paletteOffset + 1) % theme.foregroundColors.length], wells);
    const secondIndex = (paletteOffset + 1) % theme.glyphColors.length;
    renderEquation(pixels, problem.equations[1], 180, random, theme.glyphColors[secondIndex], theme.innerColors[secondIndex % theme.innerColors.length], theme.foregroundColors[(secondIndex + 1) % theme.foregroundColors.length], wells);
    return encodePng(pixels);
}
//# sourceMappingURL=algebra-renderer.js.map