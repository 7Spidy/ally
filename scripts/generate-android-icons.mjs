import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const sourceLogo = path.resolve('public/assets/logo/ally-logo.png');
const highResLogo = path.resolve('public/assets/logo/logo 2.png');
const androidRes = path.resolve('android/app/src/main/res');

const densities = [
  { name: 'mdpi', size: 48, fgSize: 108 },
  { name: 'hdpi', size: 72, fgSize: 162 },
  { name: 'xhdpi', size: 96, fgSize: 216 },
  { name: 'xxhdpi', size: 144, fgSize: 324 },
  { name: 'xxxhdpi', size: 192, fgSize: 432 },
];

async function generateIcons() {
  console.log('Generating Android icons...');

  // 1. Update background color to dark #0a0910
  const bgColorXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0a0910</color>
</resources>
`;
  fs.writeFileSync(path.join(androidRes, 'values/ic_launcher_background.xml'), bgColorXml);

  // 2. Generate Play Store 512x512 icon
  const playStoreDir = path.resolve('android/app/playstore');
  if (!fs.existsSync(playStoreDir)) {
    fs.mkdirSync(playStoreDir, { recursive: true });
  }
  await sharp(sourceLogo)
    .resize(512, 512, { fit: 'contain', background: { r: 10, g: 9, b: 16, alpha: 1 } })
    .png()
    .toFile(path.join(playStoreDir, 'playstore-icon-512.png'));
  console.log('Created Play Store 512x512 icon');

  // 3. Generate launcher icons for each density
  for (const { name, size, fgSize } of densities) {
    const dir = path.join(androidRes, `mipmap-${name}`);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Standard square launcher
    await sharp(sourceLogo)
      .resize(size, size, { fit: 'contain', background: { r: 10, g: 9, b: 16, alpha: 1 } })
      .png()
      .toFile(path.join(dir, 'ic_launcher.png'));

    // Round launcher
    const circleSvg = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#0a0910"/></svg>`
    );
    const roundContent = await sharp(sourceLogo)
      .resize(Math.round(size * 0.85), Math.round(size * 0.85), { fit: 'contain' })
      .toBuffer();

    await sharp(circleSvg)
      .composite([{ input: roundContent, gravity: 'center' }])
      .png()
      .toFile(path.join(dir, 'ic_launcher_round.png'));

    // Foreground icon for adaptive icons (padded so it doesn't get clipped by Android mask)
    const paddedSize = Math.round(fgSize * 0.65);
    const innerFg = await sharp(sourceLogo)
      .resize(paddedSize, paddedSize, { fit: 'contain' })
      .toBuffer();

    await sharp({
      create: {
        width: fgSize,
        height: fgSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: innerFg, gravity: 'center' }])
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));

    console.log(`Generated icons for mipmap-${name}`);
  }

  console.log('All Android icons generated successfully!');
}

generateIcons().catch((err) => {
  console.error(err);
  process.exit(1);
});
