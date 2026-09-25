// Generates the pre-compressed first-run image set (first-run visuals spec §4.1):
//   public/assets/first-run/reveal/{ID}.webp  540x960, from assets/reveal/{ID}.jpg
//   public/assets/first-run/tile/{ID}.webp    432x540, from assets/portraits/{ID}.jpg
//   public/assets/first-run/mark.png          the logo glyph, cropped, 172px tall
// Idempotent. Exits non-zero if any source is missing. `sharp` is a
// devDependency only: the output is committed and served as-is.

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "public/assets");
const out = path.join(assets, "first-run");

const manifest = JSON.parse(readFileSync(path.join(assets, "manifest.json"), "utf8"));
const ids = manifest.templates.map((t) => t.id);

const jobs = [];
for (const id of ids) {
  jobs.push({
    src: path.join(assets, "reveal", `${id}.jpg`),
    dst: path.join(out, "reveal", `${id}.webp`),
    run: (s) => s.resize(540, 960, { fit: "cover" }).webp({ quality: 66, effort: 6 }),
  });
  jobs.push({
    src: path.join(assets, "portraits", `${id}.jpg`),
    dst: path.join(out, "tile", `${id}.webp`),
    run: (s) => s.resize(432, 540, { fit: "cover" }).webp({ quality: 68, effort: 6 }),
  });
}
jobs.push({
  src: path.join(assets, "logo", "ally-logo.png"),
  dst: path.join(out, "mark.png"),
  run: (s) => s.extract({ left: 196, top: 145, width: 389, height: 478 }).resize({ height: 172 }).png(),
});

const missing = jobs.filter((j) => !existsSync(j.src)).map((j) => path.relative(root, j.src));
if (missing.length) {
  console.error(`Missing sources:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

mkdirSync(path.join(out, "reveal"), { recursive: true });
mkdirSync(path.join(out, "tile"), { recursive: true });

let total = 0;
for (const j of jobs) {
  await j.run(sharp(j.src)).toFile(j.dst);
  total += statSync(j.dst).size;
}
console.log(`Wrote ${jobs.length} files, ${(total / 1024).toFixed(0)} KB total, to ${path.relative(root, out)}`);
