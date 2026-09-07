import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const buildDirectory = path.join(projectDirectory, "build");
const sourcePath = path.join(buildDirectory, "icon-source.png");
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

function createIco(images) {
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let imageOffset = headerSize;
  images.forEach(({ size, buffer }, index) => {
    const entryOffset = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entryOffset);
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(buffer.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += buffer.length;
  });

  return Buffer.concat([header, ...images.map(({ buffer }) => buffer)]);
}

await mkdir(buildDirectory, { recursive: true });
const source = await readFile(sourcePath);
const icoImages = [];

for (const size of icoSizes) {
  const buffer = await sharp(source)
    .resize(size, size, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(path.join(buildDirectory, `icon-${size}.png`), buffer);
  icoImages.push({ size, buffer });
}

const appIcon = await sharp(source)
  .resize(1024, 1024, { fit: "cover" })
  .png({ compressionLevel: 9 })
  .toBuffer();

await Promise.all([
  writeFile(path.join(buildDirectory, "icon.png"), appIcon),
  writeFile(path.join(buildDirectory, "icon.ico"), createIco(icoImages)),
]);

if (process.platform === "darwin") {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "douyin-icons-"));
  const iconsetDirectory = path.join(temporaryDirectory, "app.iconset");
  try {
    await mkdir(iconsetDirectory);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const filename = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
        await sharp(source)
          .resize(size * scale, size * scale, { fit: "cover" })
          .png({ compressionLevel: 9 })
          .toFile(path.join(iconsetDirectory, filename));
      }
    }
    execFileSync("/usr/bin/iconutil", [
      "--convert", "icns", "--output", path.join(buildDirectory, "icon.icns"), iconsetDirectory,
    ]);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

console.log(`Generated app icon assets from ${sourcePath}`);
