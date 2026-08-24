import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { stringToPaths } from "hershey";
export const GRAVITY_WIDTH = 600;
export const GRAVITY_HEIGHT = 200;
export const GRAVITY_GLYPH_MAX_ROTATION_DEGREES = 15;
export const GRAVITY_GLYPH_MAX_FIELD_SWIRL_DEGREES = 20;
const VISUAL_THEMES = [
    {
        background: [244, 243, 238], backgroundVariation: 6,
        glyphColors: [[28, 28, 34, 255], [69, 43, 79, 255], [37, 51, 61, 255], [74, 58, 89, 255]],
        innerColors: [[238, 238, 233, 255], [241, 235, 242, 255], [235, 239, 239, 255], [240, 236, 242, 255]],
        paleLine: [73, 79, 88, 48],
        foregroundColors: [[32, 35, 41, 130], [91, 61, 104, 122], [53, 67, 76, 118]],
        noiseColor: [48, 50, 56, 78]
    },
    {
        background: [228, 232, 230], backgroundVariation: 12,
        glyphColors: [[13, 15, 17, 255], [46, 47, 49, 255], [25, 28, 31, 255], [57, 48, 61, 255]],
        innerColors: [[220, 224, 222, 255], [226, 228, 226, 255], [218, 223, 222, 255], [225, 222, 226, 255]],
        paleLine: [35, 38, 41, 52],
        foregroundColors: [[11, 13, 15, 135], [64, 64, 66, 120], [35, 40, 43, 124]],
        noiseColor: [24, 26, 28, 95]
    },
    {
        background: [237, 229, 245], backgroundVariation: 7,
        glyphColors: [[67, 31, 93, 255], [112, 52, 142, 255], [42, 35, 62, 255], [91, 45, 121, 255]],
        innerColors: [[232, 223, 240, 255], [235, 220, 242, 255], [230, 226, 237, 255], [234, 221, 241, 255]],
        paleLine: [106, 76, 126, 54],
        foregroundColors: [[84, 43, 111, 132], [133, 73, 161, 120], [54, 46, 76, 118]],
        noiseColor: [91, 52, 111, 82]
    },
    {
        background: [242, 247, 249], backgroundVariation: 5,
        glyphColors: [[24, 54, 77, 255], [53, 82, 112, 255], [38, 61, 89, 255], [76, 63, 112, 255]],
        innerColors: [[235, 243, 246, 255], [237, 243, 247, 255], [235, 242, 246, 255], [239, 238, 247, 255]],
        paleLine: [83, 121, 148, 45],
        foregroundColors: [[31, 76, 108, 125], [75, 105, 135, 116], [78, 61, 119, 112]],
        noiseColor: [44, 82, 110, 76],
        gridColor: [73, 126, 157, 34]
    },
    {
        background: [244, 237, 215], backgroundVariation: 9,
        glyphColors: [[64, 52, 30, 255], [93, 65, 36, 255], [55, 66, 43, 255], [82, 47, 73, 255]],
        innerColors: [[238, 230, 207, 255], [240, 229, 207, 255], [235, 230, 210, 255], [240, 226, 216, 255]],
        paleLine: [105, 89, 57, 48],
        foregroundColors: [[82, 64, 34, 128], [111, 77, 42, 116], [75, 58, 76, 112]],
        noiseColor: [78, 65, 42, 84]
    },
    {
        background: [5, 3, 10], backgroundVariation: 4,
        glyphColors: [[177, 105, 255, 255], [211, 139, 255, 255], [143, 91, 232, 255], [229, 167, 255, 255]],
        innerColors: [[13, 7, 22, 255], [17, 8, 27, 255], [11, 6, 20, 255], [18, 9, 28, 255]],
        paleLine: [161, 111, 224, 66],
        foregroundColors: [[126, 72, 202, 145], [196, 119, 255, 138], [103, 74, 170, 132], [224, 155, 255, 126]],
        noiseColor: [173, 112, 230, 82]
    }
];
const CRC_TABLE = Array.from({ length: 256 }, (_value, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
});
function createPrng(seedBytes) {
    let state = new DataView(seedBytes.buffer, seedBytes.byteOffset, seedBytes.byteLength).getUint32(0, true) || 0x9e3779b9;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x1_0000_0000;
    };
}
function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
    const typeBytes = Buffer.from(type, "ascii");
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    typeBytes.copy(chunk, 4);
    Buffer.from(data).copy(chunk, 8);
    const checksum = crc32(Buffer.concat([typeBytes, Buffer.from(data)]));
    chunk.writeUInt32BE(checksum, 8 + data.length);
    return chunk;
}
function encodePng(pixels, width, height) {
    const rowLength = width * 4;
    const scanlines = Buffer.alloc((rowLength + 1) * height);
    for (let y = 0; y < height; y += 1) {
        const target = y * (rowLength + 1);
        scanlines[target] = 0;
        Buffer.from(pixels.buffer, pixels.byteOffset + y * rowLength, rowLength).copy(scanlines, target + 1);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    header[10] = 0;
    header[11] = 0;
    header[12] = 0;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", deflateSync(scanlines, { level: 7 })),
        pngChunk("IEND", Buffer.alloc(0))
    ]);
}
function blendPixel(pixels, x, y, color) {
    if (x < 0 || y < 0 || x >= GRAVITY_WIDTH || y >= GRAVITY_HEIGHT)
        return;
    const index = (Math.floor(y) * GRAVITY_WIDTH + Math.floor(x)) * 4;
    const alpha = color[3] / 255;
    pixels[index] = Math.round((pixels[index] ?? 0) * (1 - alpha) + color[0] * alpha);
    pixels[index + 1] = Math.round((pixels[index + 1] ?? 0) * (1 - alpha) + color[1] * alpha);
    pixels[index + 2] = Math.round((pixels[index + 2] ?? 0) * (1 - alpha) + color[2] * alpha);
    pixels[index + 3] = 255;
}
function drawDisc(pixels, centerX, centerY, radius, color) {
    const left = Math.floor(centerX - radius);
    const right = Math.ceil(centerX + radius);
    const top = Math.floor(centerY - radius);
    const bottom = Math.ceil(centerY + radius);
    const radiusSquared = radius * radius;
    for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
            const dx = x + 0.5 - centerX;
            const dy = y + 0.5 - centerY;
            if (dx * dx + dy * dy <= radiusSquared) {
                blendPixel(pixels, x, y, color);
            }
        }
    }
}
function drawLine(pixels, from, to, thickness, color) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 1.5));
    for (let step = 0; step <= steps; step += 1) {
        const progress = step / steps;
        drawDisc(pixels, from[0] + dx * progress, from[1] + dy * progress, thickness, color);
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
        const rotatedX = relativeX * cosine - relativeY * sine;
        const rotatedY = relativeX * sine + relativeY * cosine;
        x = well.x + rotatedX * radialScale;
        y = well.y + rotatedY * radialScale;
    }
    // Keep the strong vortex while fitting its displaced coordinates back into
    // the PNG. This avoids solving readability problems by weakening gravity.
    return [
        GRAVITY_WIDTH / 2 + (x - GRAVITY_WIDTH / 2) * 0.9,
        GRAVITY_HEIGHT / 2 + (y - GRAVITY_HEIGHT / 2) * 0.76
    ];
}
function drawGravityBezier(pixels, points, thickness, color, wells) {
    let previous = applyGravityField(points[0], wells);
    for (let step = 1; step <= 180; step += 1) {
        const t = step / 180;
        const inverse = 1 - t;
        const source = [
            inverse ** 3 * points[0][0] +
                3 * inverse ** 2 * t * points[1][0] +
                3 * inverse * t ** 2 * points[2][0] +
                t ** 3 * points[3][0],
            inverse ** 3 * points[0][1] +
                3 * inverse ** 2 * t * points[1][1] +
                3 * inverse * t ** 2 * points[2][1] +
                t ** 3 * points[3][1]
        ];
        const current = applyGravityField(source, wells);
        drawLine(pixels, previous, current, thickness, color);
        previous = current;
    }
}
function transformGlyphPoint(point, bounds, centerX, centerY, rotation, shear, scaleX, scaleY, wells, warpedCenter, glyphFieldSwirlLimit) {
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const normalizedX = (point[0] - (bounds.minX + bounds.maxX) / 2) / width;
    const normalizedY = (point[1] - (bounds.minY + bounds.maxY) / 2) / height;
    const localX = normalizedX * 88 * scaleX + normalizedY * shear * 24;
    const localY = -normalizedY * 118 * scaleY;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const rotatedX = localX * cosine - localY * sine;
    const rotatedY = localX * sine + localY * cosine;
    const warpedPoint = applyGravityField([centerX + rotatedX, centerY + rotatedY], wells, glyphFieldSwirlLimit);
    // Apply the field differentially around the glyph center. This keeps reading
    // order stable while allowing the strokes themselves to bend sharply around
    // nearby wells instead of moving the whole character into another column.
    return [
        centerX + warpedPoint[0] - warpedCenter[0],
        centerY + warpedPoint[1] - warpedCenter[1]
    ];
}
function transformGlyphPath(path, transform) {
    const transformed = [];
    for (let index = 1; index < path.length; index += 1) {
        const from = path[index - 1];
        const to = path[index];
        if (!from || !to)
            continue;
        const steps = Math.max(5, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1])));
        for (let step = index === 1 ? 0 : 1; step <= steps; step += 1) {
            const progress = step / steps;
            transformed.push(transform([
                from[0] + (to[0] - from[0]) * progress,
                from[1] + (to[1] - from[1]) * progress
            ]));
        }
    }
    return transformed;
}
function drawGlyphPaths(pixels, paths, thickness, color, phase, offsetX = 0, offsetY = 0) {
    paths.forEach((path) => {
        for (let pointIndex = 1; pointIndex < path.length; pointIndex += 1) {
            const previous = path[pointIndex - 1];
            const current = path[pointIndex];
            if (!previous || !current)
                continue;
            const segmentWeight = 0.92 + Math.sin(pointIndex * 1.7 + phase) * 0.08;
            drawLine(pixels, [previous[0] + offsetX, previous[1] + offsetY], [current[0] + offsetX, current[1] + offsetY], thickness * segmentWeight, color);
        }
    });
}
function clampChannel(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
}
function fillBackground(pixels, random, theme) {
    for (let y = 0; y < GRAVITY_HEIGHT; y += 1) {
        for (let x = 0; x < GRAVITY_WIDTH; x += 1) {
            const index = (y * GRAVITY_WIDTH + x) * 4;
            const wave = Math.sin(x * 0.022 + y * 0.035) * 1.5;
            const noise = (random() - 0.5) * theme.backgroundVariation;
            pixels[index] = clampChannel(theme.background[0] + wave + noise);
            pixels[index + 1] = clampChannel(theme.background[1] + wave * 0.6 + noise * 0.7);
            pixels[index + 2] = clampChannel(theme.background[2] + wave + noise);
            pixels[index + 3] = 255;
        }
    }
}
function drawOptionalGrid(pixels, random, theme) {
    if (!theme.gridColor)
        return;
    const spacing = 18 + Math.floor(random() * 11);
    const offsetX = Math.floor(random() * spacing);
    const offsetY = Math.floor(random() * spacing);
    for (let x = offsetX; x < GRAVITY_WIDTH; x += spacing) {
        drawLine(pixels, [x, 0], [x, GRAVITY_HEIGHT], 0.55, theme.gridColor);
    }
    for (let y = offsetY; y < GRAVITY_HEIGHT; y += spacing) {
        drawLine(pixels, [0, y], [GRAVITY_WIDTH, y], 0.55, theme.gridColor);
    }
}
export function renderGravityImage(answer) {
    const random = createPrng(randomBytes(4));
    const pixels = new Uint8Array(GRAVITY_WIDTH * GRAVITY_HEIGHT * 4);
    const theme = VISUAL_THEMES[Math.floor(random() * VISUAL_THEMES.length)];
    fillBackground(pixels, random, theme);
    drawOptionalGrid(pixels, random, theme);
    // Place the primary well inside the text band. The previous edge-biased well
    // mostly rotated the complete word as one unit; an interior well creates the
    // visibly non-linear lensing expected from Gravity while keeping every stroke
    // continuous.
    const primaryWell = {
        x: 105 + random() * 390,
        y: 34 + random() * (GRAVITY_HEIGHT - 68),
        radius: 145 + random() * 75,
        pull: 0.12 + random() * 0.09,
        swirl: (random() < 0.5 ? -1 : 1) * (0.82 + random() * 0.52)
    };
    const gravityWells = [primaryWell];
    if (random() < 0.62) {
        gravityWells.push({
            x: Math.max(70, Math.min(GRAVITY_WIDTH - 70, GRAVITY_WIDTH - primaryWell.x + (random() - 0.5) * 90)),
            y: Math.max(28, Math.min(GRAVITY_HEIGHT - 28, GRAVITY_HEIGHT - primaryWell.y + (random() - 0.5) * 54)),
            radius: 120 + random() * 70,
            pull: 0.055 + random() * 0.065,
            swirl: (random() < 0.5 ? -1 : 1) * (0.34 + random() * 0.42)
        });
    }
    const paleLineCount = 1 + Math.floor(random() * 4);
    for (let index = 0; index < paleLineCount; index += 1) {
        const startY = 35 + random() * 130;
        const endY = 35 + random() * 130;
        drawGravityBezier(pixels, [
            [-24, startY],
            [150 + random() * 100, -15 + random() * 225],
            [360 + random() * 120, -10 + random() * 220],
            [GRAVITY_WIDTH + 24, endY]
        ], 1.2 + random() * 1.1, theme.paleLine, gravityWells);
    }
    const glyphCenters = [105, 235, 365, 495];
    const paletteOffset = Math.floor(random() * theme.glyphColors.length);
    answer.split("").forEach((character, index) => {
        const glyph = stringToPaths(character);
        const centerX = glyphCenters[index] + (random() - 0.5) * 18;
        const centerY = GRAVITY_HEIGHT / 2 + (random() - 0.5) * 16;
        const rotation = ((random() * 2 - 1) * GRAVITY_GLYPH_MAX_ROTATION_DEGREES * Math.PI) / 180;
        // Keep the complete glyph upright enough to preserve identity. Decorative
        // lines retain the full vortex, while glyph strokes receive at most 20° of
        // cumulative field rotation on top of their at-most 15° rigid rotation.
        const glyphFieldSwirlLimit = (GRAVITY_GLYPH_MAX_FIELD_SWIRL_DEGREES * Math.PI) / 180;
        const shear = random() * 0.24 - 0.12;
        const scaleX = 0.92 + random() * 0.16;
        const scaleY = 0.93 + random() * 0.14;
        const wavePhase = random() * Math.PI * 2;
        const strokeStyle = random();
        const thickness = strokeStyle < 0.42
            ? 3.3 + random() * 2.3
            : 5 + random() * 2.2;
        const paletteIndex = (index + paletteOffset) % theme.glyphColors.length;
        const color = theme.glyphColors[paletteIndex];
        const innerColor = theme.innerColors[paletteIndex % theme.innerColors.length];
        const warpedCenter = applyGravityField([centerX, centerY], gravityWells, glyphFieldSwirlLimit);
        const transformedPaths = glyph.paths.map((glyphPath) => transformGlyphPath(glyphPath, (point) => transformGlyphPoint(point, glyph.bounds, centerX, centerY, rotation, shear, scaleX, scaleY, gravityWells, warpedCenter, glyphFieldSwirlLimit)));
        if (strokeStyle > 0.82) {
            const ghostColor = theme.foregroundColors[(index + 1) % theme.foregroundColors.length];
            drawGlyphPaths(pixels, transformedPaths, thickness * 0.78, ghostColor, wavePhase, 3 + random() * 3, random() * 4 - 2);
        }
        drawGlyphPaths(pixels, transformedPaths, thickness, color, wavePhase);
        if (strokeStyle >= 0.42 && strokeStyle <= 0.82) {
            drawGlyphPaths(pixels, transformedPaths, thickness * 0.42, innerColor, wavePhase);
        }
    });
    const foregroundLineCount = 1 + Math.floor(random() * 4);
    for (let index = 0; index < foregroundLineCount; index += 1) {
        const color = theme.foregroundColors[index % theme.foregroundColors.length];
        const baseY = 48 + random() * 104;
        drawGravityBezier(pixels, [
            [-16, baseY],
            [120 + random() * 110, baseY + (random() - 0.5) * 120],
            [380 + random() * 90, baseY + (random() - 0.5) * 120],
            [GRAVITY_WIDTH + 16, 45 + random() * 110]
        ], 1.4 + random() * 1.4, color, gravityWells);
    }
    const noiseMarkCount = 18 + Math.floor(random() * 55);
    for (let index = 0; index < noiseMarkCount; index += 1) {
        const x = 20 + random() * (GRAVITY_WIDTH - 40);
        const y = 18 + random() * (GRAVITY_HEIGHT - 36);
        if (random() < 0.55) {
            drawDisc(pixels, x, y, 0.8 + random() * 1.4, theme.noiseColor);
        }
        else {
            const length = 4 + random() * 10;
            const angle = random() * Math.PI * 2;
            drawLine(pixels, [x, y], [x + Math.cos(angle) * length, y + Math.sin(angle) * length], 0.8 + random() * 0.7, theme.noiseColor);
        }
    }
    return encodePng(pixels, GRAVITY_WIDTH, GRAVITY_HEIGHT);
}
//# sourceMappingURL=gravity-renderer.js.map