/**
 * Image optimization script — generates WebP + PNG variants of logo.png
 * and an optimized favicon.ico.
 *
 * Run: node scripts/optimize-images.js
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const logoSrc = path.join(publicDir, 'logo.png');

async function run() {
  if (!existsSync(logoSrc)) {
    console.error('logo.png not found in public/');
    process.exit(1);
  }

  console.log('Optimizing images...');

  // Header logo: 80px wide for h-10 (40px) @2x
  await sharp(logoSrc)
    .resize({ width: 80 })
    .webp({ quality: 80 })
    .toFile(path.join(publicDir, 'logo-header.webp'));
  console.log('  Created logo-header.webp');

  await sharp(logoSrc)
    .resize({ width: 80 })
    .png({ compressionLevel: 9 })
    .toFile(path.join(publicDir, 'logo-header.png'));
  console.log('  Created logo-header.png');

  // Hero logo: 288px wide for h-36 (144px) @2x
  await sharp(logoSrc)
    .resize({ width: 288 })
    .webp({ quality: 80 })
    .toFile(path.join(publicDir, 'logo-hero.webp'));
  console.log('  Created logo-hero.webp');

  await sharp(logoSrc)
    .resize({ width: 288 })
    .png({ compressionLevel: 9 })
    .toFile(path.join(publicDir, 'logo-hero.png'));
  console.log('  Created logo-hero.png');

  // OG image: optimize existing og-logo.png
  const ogSrc = path.join(publicDir, 'og-logo.png');
  if (existsSync(ogSrc)) {
    await sharp(ogSrc)
      .resize({ width: 1200, height: 630, fit: 'contain', background: { r: 4, g: 30, b: 66, alpha: 1 } })
      .png({ compressionLevel: 9 })
      .toFile(path.join(publicDir, 'og-image.png'));
    console.log('  Created og-image.png (optimized OG image)');
  }

  // Favicon: generate proper 32x32 PNG (use existing favicon.svg or logo)
  const faviconSvg = path.join(publicDir, 'favicon.svg');
  const faviconSrc = existsSync(faviconSvg) ? faviconSvg : logoSrc;
  await sharp(faviconSrc)
    .resize(32, 32)
    .png()
    .toFile(path.join(publicDir, 'favicon-32-opt.png'));
  console.log('  Created favicon-32-opt.png');

  await sharp(faviconSrc)
    .resize(16, 16)
    .png()
    .toFile(path.join(publicDir, 'favicon-16-opt.png'));
  console.log('  Created favicon-16-opt.png');

  console.log('\nDone! Image optimization complete.');
  console.log('Update Header.astro and index.astro to use the new optimized images.');
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
