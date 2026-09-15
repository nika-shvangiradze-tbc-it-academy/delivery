/**
 * Optimizes marketing rasters: hero (responsive + alpha), about, pricing cards.
 *
 * Critical: never flatten transparency onto black.
 * - WebP keeps alpha when the source has it
 * - JPEG fallbacks flatten onto the site's light background (#ffffff)
 */
import { readdir, readFile, unlink, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public', 'assets');
const MAIN = path.join(PUBLIC, 'main');
const SITE_BG = { r: 255, g: 255, b: 255, alpha: 1 };

async function safeWrite(filePath, buf) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  await writeFile(tmp, buf);
  try {
    if (existsSync(filePath)) {
      await unlink(filePath);
    }
  } catch {
    // Windows file lock
  }
  try {
    await writeFile(filePath, buf);
  } catch {
    await copyFile(tmp, filePath);
  }
  try {
    await unlink(tmp);
  } catch {
    // ignore
  }
}

async function firstExisting(...candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Resize preserving alpha channel when present. */
function resizePreserveAlpha(sourcePath, width) {
  return sharp(sourcePath, { failOn: 'none' })
    .ensureAlpha()
    .resize({ width, withoutEnlargement: true });
}

async function toTransparentWebp(pipeline, quality = 74) {
  return pipeline.clone().webp({ quality, effort: 6, alphaQuality: 100 }).toBuffer();
}

/** JPEG cannot keep alpha — flatten onto site white, never black. */
async function toWhiteJpeg(pipeline, quality = 78) {
  return pipeline
    .clone()
    .flatten({ background: SITE_BG })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

async function optimizeHero() {
  const jpgPath = path.join(MAIN, 'georgia-logistics.jpg');
  const webpPath = path.join(MAIN, 'georgia-logistics.webp');
  // Prefer known transparent masters (PNG / original alpha WebP), never re-encode
  // from an already-flattened opaque WebP/JPEG that baked black.
  const source = await firstExisting(
    path.join(MAIN, 'georgia-logistics-source.png'),
    path.join(MAIN, 'georgia-logistics-source.webp'),
    path.join(MAIN, 'georgia-logistics.png'),
    // Only use current webp if it still has alpha
  );

  let resolved = source;
  if (!resolved && existsSync(webpPath)) {
    const meta = await sharp(webpPath).metadata();
    if (meta.hasAlpha) {
      resolved = webpPath;
    }
  }
  if (!resolved) {
    console.warn('Hero transparent source missing — aborting hero optimize to avoid black flatten');
    return;
  }

  const srcMeta = await sharp(resolved).metadata();
  console.log(
    `Hero source: ${path.basename(resolved)} ${srcMeta.width}x${srcMeta.height} alpha=${srcMeta.hasAlpha}`,
  );

  const widths = [640, 960, 1400];
  for (const width of widths) {
    const base = resizePreserveAlpha(resolved, width);
    const webpBuf = await toTransparentWebp(base, 74);
    const jpgBuf = await toWhiteJpeg(base, 78);
    await safeWrite(path.join(MAIN, `georgia-logistics-${width}.webp`), webpBuf);
    await safeWrite(path.join(MAIN, `georgia-logistics-${width}.jpg`), jpgBuf);
    const outMeta = await sharp(webpBuf).metadata();
    console.log(
      `Hero ${width}: webp ${(webpBuf.length / 1024).toFixed(1)}KB alpha=${outMeta.hasAlpha}, jpg ${(jpgBuf.length / 1024).toFixed(1)}KB`,
    );
  }

  await safeWrite(webpPath, await readFile(path.join(MAIN, 'georgia-logistics-1400.webp')));
  await safeWrite(jpgPath, await readFile(path.join(MAIN, 'georgia-logistics-1400.jpg')));
  console.log('Hero alias 1400 synced');
}

async function optimizeAbout() {
  const jpgPath = path.join(PUBLIC, 'Picture1.jpg');
  const webpPath = path.join(PUBLIC, 'Picture1.webp');
  const source = await firstExisting(
    path.join(PUBLIC, 'Picture1-source.png'),
    path.join(PUBLIC, 'Picture1.png'),
  );

  let resolved = source;
  if (!resolved && existsSync(webpPath)) {
    const meta = await sharp(webpPath).metadata();
    if (meta.hasAlpha) {
      resolved = webpPath;
    }
  }
  if (!resolved) {
    console.warn('About transparent source missing — aborting about optimize');
    return;
  }

  const srcMeta = await sharp(resolved).metadata();
  console.log(
    `About source: ${path.basename(resolved)} ${srcMeta.width}x${srcMeta.height} alpha=${srcMeta.hasAlpha}`,
  );

  const base = resizePreserveAlpha(resolved, 960);
  const webpBuf = await toTransparentWebp(base, 76);
  const jpgBuf = await toWhiteJpeg(base, 80);
  const meta = await sharp(webpBuf).metadata();

  await safeWrite(webpPath, webpBuf);
  await safeWrite(jpgPath, jpgBuf);
  console.log(
    `About: ${meta.width}x${meta.height} webp ${(webpBuf.length / 1024).toFixed(1)}KB alpha=${meta.hasAlpha}, jpg ${(jpgBuf.length / 1024).toFixed(1)}KB`,
  );
}

async function optimizePricing() {
  const pricingDir = path.join(MAIN, 'pricing');
  if (!existsSync(pricingDir)) return;

  // Photo cards — opaque JPEGs; no transparency path needed.
  const entries = await readdir(pricingDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!['.jpg', '.jpeg', '.png'].includes(ext)) continue;

    const inputPath = path.join(pricingDir, e.name);
    const baseName = e.name.slice(0, -ext.length);
    const base = sharp(inputPath).resize({ width: 480, withoutEnlargement: true });
    const webpBuf = await base.clone().webp({ quality: 72, effort: 6 }).toBuffer();
    const jpgBuf = await base.clone().jpeg({ quality: 78, mozjpeg: true }).toBuffer();

    await safeWrite(path.join(pricingDir, `${baseName}.webp`), webpBuf);
    await safeWrite(path.join(pricingDir, `${baseName}.jpg`), jpgBuf);
    console.log(
      `Pricing ${baseName}: webp ${(webpBuf.length / 1024).toFixed(1)}KB, jpg ${(jpgBuf.length / 1024).toFixed(1)}KB`,
    );
  }
}

async function main() {
  await optimizeHero();
  await optimizeAbout();
  await optimizePricing();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
