/**
 * Optimizes marketing rasters: hero, about, pricing.
 * Hero: WebP + JPEG fallback (PNG is too heavy for LCP).
 * Pricing / About: WebP siblings + recompressed originals.
 */
import { readdir, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public', 'assets');
const MAIN = path.join(PUBLIC, 'main');

async function safeWrite(filePath, buf) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  await writeFile(tmp, buf);
  try {
    if (existsSync(filePath)) {
      await unlink(filePath);
    }
  } catch {
    // Windows file lock — overwrite via rename when possible
  }
  await writeFile(filePath, buf);
  try {
    await unlink(tmp);
  } catch {
    // ignore
  }
}

async function optimizeHero() {
  const pngPath = path.join(MAIN, 'georgia-logistics.png');
  const jpgPath = path.join(MAIN, 'georgia-logistics.jpg');
  const webpPath = path.join(MAIN, 'georgia-logistics.webp');
  const source = existsSync(pngPath) ? pngPath : jpgPath;
  if (!existsSync(source)) {
    console.warn('Hero source missing');
    return;
  }

  const base = sharp(source).resize({ width: 1400, withoutEnlargement: true });
  const webpBuf = await base.clone().webp({ quality: 74, effort: 6 }).toBuffer();
  const jpgBuf = await base.clone().jpeg({ quality: 78, mozjpeg: true }).toBuffer();

  await safeWrite(webpPath, webpBuf);
  await safeWrite(jpgPath, jpgBuf);

  // Drop heavy PNG fallback if JPEG exists
  if (existsSync(pngPath)) {
    try {
      await unlink(pngPath);
      console.log('Removed georgia-logistics.png (use .jpg fallback)');
    } catch (err) {
      console.warn('Could not remove PNG (locked?):', err.message);
    }
  }

  console.log(
    `Hero: webp ${(webpBuf.length / 1024).toFixed(1)}KB, jpg ${(jpgBuf.length / 1024).toFixed(1)}KB`,
  );
}

async function optimizeAbout() {
  const pngPath = path.join(PUBLIC, 'Picture1.png');
  if (!existsSync(pngPath)) return;

  const base = sharp(pngPath).resize({ width: 1200, withoutEnlargement: true });
  const webpBuf = await base.clone().webp({ quality: 76, effort: 5 }).toBuffer();
  const jpgBuf = await base.clone().jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  const jpgPath = path.join(PUBLIC, 'Picture1.jpg');

  await safeWrite(path.join(PUBLIC, 'Picture1.webp'), webpBuf);
  await safeWrite(jpgPath, jpgBuf);
  try {
    await unlink(pngPath);
  } catch {
    // keep png if locked
  }
  console.log(
    `About: webp ${(webpBuf.length / 1024).toFixed(1)}KB, jpg ${(jpgBuf.length / 1024).toFixed(1)}KB`,
  );
}

async function optimizePricing() {
  const pricingDir = path.join(MAIN, 'pricing');
  if (!existsSync(pricingDir)) return;

  const entries = await readdir(pricingDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!['.jpg', '.jpeg', '.png'].includes(ext)) continue;

    const inputPath = path.join(pricingDir, e.name);
    const baseName = e.name.slice(0, -ext.length);
    const base = sharp(inputPath).resize({ width: 720, withoutEnlargement: true });
    const webpBuf = await base.clone().webp({ quality: 78, effort: 5 }).toBuffer();
    const jpgBuf = await base.clone().jpeg({ quality: 80, mozjpeg: true }).toBuffer();

    await safeWrite(path.join(pricingDir, `${baseName}.webp`), webpBuf);
    await safeWrite(path.join(pricingDir, `${baseName}.jpg`), jpgBuf);
    if (ext === '.png' || ext === '.jpeg') {
      try {
        await unlink(inputPath);
      } catch {
        // ignore
      }
    }
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
