/**
 * Resizes raster images so the longest side is at most MAX_PX (default 500).
 * Targets: public/assets/main/landing, public/assets/main/pricing
 */
import { readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'public', 'assets', 'main');

const MAX_PX = Number(process.env.MAX_IMAGE_PX || 500);
const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const DIRS = [path.join(ROOT, 'landing'), path.join(ROOT, 'pricing')];

function formatOptions(ext) {
  switch (ext) {
    case '.png':
      return { format: 'png', options: { compressionLevel: 9, effort: 7 } };
    case '.webp':
      return { format: 'webp', options: { quality: 82, effort: 5 } };
    default:
      return { format: 'jpeg', options: { quality: 82, mozjpeg: true } };
  }
}

async function processFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!EXT.has(ext)) return;

  const meta = await sharp(filePath).metadata();
  if (!meta.width || !meta.height) return;

  const maxSide = Math.max(meta.width, meta.height);
  if (maxSide <= MAX_PX) {
    console.log(`OK (already ≤${MAX_PX}px): ${path.relative(ROOT, filePath)}`);
    return;
  }

  const { format, options } = formatOptions(ext);
  const buf = await sharp(filePath)
    .resize(MAX_PX, MAX_PX, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toFormat(format, options)
    .toBuffer();

  await writeFile(filePath, buf);

  const after = await sharp(filePath).metadata();
  console.log(
    `Resized: ${path.relative(ROOT, filePath)} ${meta.width}×${meta.height} → ${after.width}×${after.height}`,
  );
}

async function main() {
  let rasterCount = 0;
  for (const dir of DIRS) {
    if (!existsSync(dir)) {
      console.warn(`Skip (folder missing): ${dir}`);
      continue;
    }
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!EXT.has(ext)) continue;
      rasterCount++;
      await processFile(path.join(dir, e.name));
    }
  }
  if (rasterCount === 0) {
    console.log('No raster images found. Put .webp/.jpg/.png in public/assets/main/landing or pricing.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
