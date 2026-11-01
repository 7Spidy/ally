import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const sourceLogo = path.resolve('public/assets/logo/ally-logo.png');
const androidRes = path.resolve('android/app/src/main/res');

const splashConfigs = [
  { folder: 'drawable', width: 480, height: 320, logoSize: 100 },
  { folder: 'drawable-port-mdpi', width: 320, height: 480, logoSize: 100 },
  { folder: 'drawable-port-hdpi', width: 480, height: 800, logoSize: 150 },
  { folder: 'drawable-port-xhdpi', width: 720, height: 1280, logoSize: 220 },
  { folder: 'drawable-port-xxhdpi', width: 960, height: 1600, logoSize: 300 },
  { folder: 'drawable-port-xxxhdpi', width: 1280, height: 1920, logoSize: 380 },
  { folder: 'drawable-land-mdpi', width: 480, height: 320, logoSize: 100 },
  { folder: 'drawable-land-hdpi', width: 800, height: 480, logoSize: 150 },
  { folder: 'drawable-land-xhdpi', width: 1280, height: 720, logoSize: 220 },
  { folder: 'drawable-land-xxhdpi', width: 1600, height: 960, logoSize: 300 },
  { folder: 'drawable-land-xxxhdpi', width: 1920, height: 1280, logoSize: 380 },
];

async function generateSplashes() {
  console.log('Generating Android splash screens...');

  for (const { folder, width, height, logoSize } of splashConfigs) {
    const dir = path.join(androidRes, folder);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const resizedLogo = await sharp(sourceLogo)
      .resize(logoSize, logoSize, { fit: 'contain' })
      .toBuffer();

    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 10, g: 9, b: 16 }, // #0a0910
      },
    })
      .composite([{ input: resizedLogo, gravity: 'center' }])
      .png()
      .toFile(path.join(dir, 'splash.png'));

    console.log(`Generated splash for ${folder}`);
  }

  console.log('All splash screens generated successfully!');
}

generateSplashes().catch((err) => {
  console.error(err);
  process.exit(1);
});
