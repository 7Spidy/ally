// Generates the web app icons (manifest and install prompt) from the Ally logo.
// Run: node scripts/generate-web-icons.mjs
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const source = path.resolve("public/assets/logo/ally-logo.png");
const outDir = path.resolve("public/icons");
// The app's --surf, the same colour the manifest uses for its background.
const bg = { r: 21, g: 18, b: 32, alpha: 1 };

fs.mkdirSync(outDir, { recursive: true });

/** The logo on a solid square. `scale` is how much of the square the logo fills. */
async function icon(file, size, scale) {
  const inner = Math.round(size * scale);
  const logo = await sharp(source).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(path.join(outDir, file));
  console.log(`Created public/icons/${file}`);
}

await icon("icon-192.png", 192, 0.84);
await icon("icon-512.png", 512, 0.84);
// Maskable: Android may crop to a circle, so keep the logo inside the central 60%.
await icon("icon-maskable-512.png", 512, 0.6);
