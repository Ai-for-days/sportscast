/**
 * process-icons.js
 * Processes glossy 3D weather icon PNGs → flat navy icons on transparent background.
 *
 * Algorithm:
 *  1. Flood-fill from image edges through all light pixels (brightness >= 140).
 *     The dark circular button border acts as a natural barrier, so the white
 *     weather symbols inside the circle are NOT reached.
 *  2. Anything reached by flood-fill → transparent (outer background + bezel).
 *  3. Inside the circle: dark pixels (< 160 brightness) → transparent (button bg).
 *  4. Remaining bright pixels = the weather symbol → recolored to navy #041E42.
 *  5. Anti-aliasing: transition zone (160-220 brightness) gets graduated alpha.
 *  6. Output resized to 128x128 for web.
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_DIR = path.join(__dirname, '..', 'Weather muse', 'Weather condition icons');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'icons', 'weather');

const NAVY = { r: 4, g: 30, b: 66 }; // #041E42
const OUTPUT_SIZE = 128;

// Skip large reference/mockup images
const SKIP_FILES = new Set([
  '24012668_weather-simply-icons_041E42.png',
  '24012670_weather-simply-icons_041E42.png',
  '24012672_weather-simply-icons_041E42.png',
  'ChatGPT Image Feb 24, 2026, 02_19_11 PM.png',
]);

async function processIcon(inputPath, outputPath) {
  const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const output = Buffer.alloc(width * height * 4); // RGBA

  const getIdx = (x, y) => (y * width + x) * channels;
  const getBrightness = (x, y) => {
    const idx = getIdx(x, y);
    return (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
  };

  // --- Step 1: Flood fill from edges to mark background ---
  const isBackground = new Uint8Array(width * height); // 0=unknown, 1=background
  const BG_THRESHOLD = 140;

  // BFS queue (flat array of x,y pairs)
  const queue = [];
  let qHead = 0;

  // Seed all edge pixels
  for (let x = 0; x < width; x++) {
    queue.push(x, 0);
    queue.push(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    queue.push(0, y);
    queue.push(width - 1, y);
  }

  while (qHead < queue.length) {
    const x = queue[qHead++];
    const y = queue[qHead++];

    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const flatIdx = y * width + x;
    if (isBackground[flatIdx]) continue;

    const brightness = getBrightness(x, y);
    if (brightness < BG_THRESHOLD) continue;

    isBackground[flatIdx] = 1;
    queue.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  // --- Step 2: Process each pixel ---
  const DARK_CUTOFF = 160;  // Below this = dark button bg -> transparent
  const FULL_CUTOFF = 220;  // Above this = full opacity symbol

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const flatIdx = y * width + x;
      const dstIdx = flatIdx * 4;
      const brightness = getBrightness(x, y);

      if (isBackground[flatIdx]) {
        // Outer background / bezel -> transparent
        output[dstIdx] = 0;
        output[dstIdx + 1] = 0;
        output[dstIdx + 2] = 0;
        output[dstIdx + 3] = 0;
      } else if (brightness < DARK_CUTOFF) {
        // Dark button background -> transparent
        output[dstIdx] = 0;
        output[dstIdx + 1] = 0;
        output[dstIdx + 2] = 0;
        output[dstIdx + 3] = 0;
      } else if (brightness >= FULL_CUTOFF) {
        // Symbol core -> full navy
        output[dstIdx] = NAVY.r;
        output[dstIdx + 1] = NAVY.g;
        output[dstIdx + 2] = NAVY.b;
        output[dstIdx + 3] = 255;
      } else {
        // Transition zone (anti-aliasing) -> graduated alpha
        const alpha = Math.round(((brightness - DARK_CUTOFF) / (FULL_CUTOFF - DARK_CUTOFF)) * 255);
        output[dstIdx] = NAVY.r;
        output[dstIdx + 1] = NAVY.g;
        output[dstIdx + 2] = NAVY.b;
        output[dstIdx + 3] = alpha;
      }
    }
  }

  // Write processed image, resized to 128x128
  await sharp(output, { raw: { width, height, channels: 4 } })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = fs.readdirSync(INPUT_DIR).filter(f =>
    f.endsWith('.png') && !SKIP_FILES.has(f)
  );

  console.log(`Found ${files.length} icons to process`);

  let success = 0;
  let failed = 0;

  for (const file of files) {
    const inputPath = path.join(INPUT_DIR, file);
    const outputPath = path.join(OUTPUT_DIR, file);
    try {
      await processIcon(inputPath, outputPath);
      success++;
      console.log(`  OK ${file}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${file}: ${err.message}`);
    }
  }

  console.log(`\nDone: ${success} processed, ${failed} failed`);
  console.log(`Output: ${OUTPUT_DIR}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
