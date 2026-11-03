import sharp from "sharp";
import fs from "fs";
import path from "path";

const outDir = path.resolve("android/app/playstore/feature-graphics");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const WIDTH = 1024;
const HEIGHT = 500;

async function createGraphic1() {
  console.log("Generating Feature Graphic 1: Hero Ira & Brand...");

  // Portrait of Ira (F01) on the right side
  const portraitWidth = 520;
  const portraitF01 = await sharp("public/assets/reveal/F01.jpg")
    .resize(portraitWidth, HEIGHT, { fit: "cover", position: "north" })
    .toBuffer();

  // Seam gradient that blends portrait into background
  const seamGradient = Buffer.from(`
    <svg width="240" height="${HEIGHT}" viewBox="0 0 240 ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="seam" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#0a0910" stop-opacity="1"/>
          <stop offset="60%" stop-color="#0a0910" stop-opacity="0.8"/>
          <stop offset="100%" stop-color="#0a0910" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="240" height="${HEIGHT}" fill="url(#seam)"/>
    </svg>
  `);

  // Left text and glow overlay
  const textOverlay = Buffer.from(`
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glow" cx="15%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#B03A48" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="#0a0910" stop-opacity="0"/>
        </radialGradient>
      </defs>

      <!-- Soft glow behind title -->
      <rect x="0" y="0" width="600" height="${HEIGHT}" fill="url(#glow)"/>

      <!-- App Logo / Wordmark -->
      <g transform="translate(64, 110)">
        <text x="0" y="56" font-family="Georgia, serif" font-size="68" font-weight="400" fill="#f4efe6" letter-spacing="-1.5">Ally</text>
        <text x="148" y="52" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="700" fill="#B03A48" letter-spacing="3.5">AI COMPANIONS</text>
        
        <text x="0" y="125" font-family="Georgia, serif" font-size="30" font-style="italic" fill="#d6d0c7" letter-spacing="-0.3">Someone to talk to.</text>
        <text x="0" y="166" font-family="Georgia, serif" font-size="30" fill="#f4efe6" letter-spacing="-0.3">Not a chatbot pretending.</text>

        <!-- Feature chips -->
        <g transform="translate(0, 222)">
          <rect x="0" y="0" width="150" height="36" rx="18" fill="#151220" stroke="#2c2638" stroke-width="1.2"/>
          <text x="75" y="22" font-family="-apple-system, sans-serif" font-size="12.5" font-weight="500" fill="#f4efe6" text-anchor="middle">Personal Connection</text>

          <rect x="162" y="0" width="120" height="36" rx="18" fill="#151220" stroke="#2c2638" stroke-width="1.2"/>
          <text x="222" y="22" font-family="-apple-system, sans-serif" font-size="12.5" font-weight="500" fill="#f4efe6" text-anchor="middle">Real Memory</text>

          <rect x="294" y="0" width="130" height="36" rx="18" fill="#151220" stroke="#2c2638" stroke-width="1.2"/>
          <text x="359" y="22" font-family="-apple-system, sans-serif" font-size="12.5" font-weight="500" fill="#f4efe6" text-anchor="middle">They Text Back</text>
        </g>
      </g>
    </svg>
  `);

  await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 3,
      background: { r: 10, g: 9, b: 16 },
    },
  })
    .composite([
      { input: portraitF01, left: WIDTH - portraitWidth, top: 0 },
      { input: seamGradient, left: WIDTH - portraitWidth, top: 0 },
      { input: textOverlay, left: 0, top: 0 },
    ])
    .png()
    .toFile(path.join(outDir, "feature-graphic-1-hero-ira.png"));

  console.log("Saved: feature-graphic-1-hero-ira.png");
}

async function createGraphic2() {
  console.log("Generating Feature Graphic 2: Multi-Persona Ensemble...");

  // Crop three cards: F01, F02, M01
  const cardW = 190;
  const cardH = 300;

  const cardF01 = await sharp("public/assets/reveal/F01.jpg")
    .resize(cardW, cardH, { fit: "cover", position: "north" })
    .composite([{
      input: Buffer.from(`<svg><rect x="0" y="0" width="${cardW}" height="${cardH}" rx="18" ry="18"/></svg>`),
      blend: "dest-in"
    }])
    .png()
    .toBuffer();

  const cardF02 = await sharp("public/assets/reveal/F02.jpg")
    .resize(cardW, cardH, { fit: "cover", position: "north" })
    .composite([{
      input: Buffer.from(`<svg><rect x="0" y="0" width="${cardW}" height="${cardH}" rx="18" ry="18"/></svg>`),
      blend: "dest-in"
    }])
    .png()
    .toBuffer();

  const cardM01 = await sharp("public/assets/reveal/M01.jpg")
    .resize(cardW, cardH, { fit: "cover", position: "north" })
    .composite([{
      input: Buffer.from(`<svg><rect x="0" y="0" width="${cardW}" height="${cardH}" rx="18" ry="18"/></svg>`),
      blend: "dest-in"
    }])
    .png()
    .toBuffer();

  const svgOverlay = Buffer.from(`
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="purpleGlow" cx="65%" cy="50%" r="55%">
          <stop offset="0%" stop-color="#7E5A9B" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#0a0910" stop-opacity="0"/>
        </radialGradient>
      </defs>

      <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#0a0910"/>
      <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#purpleGlow)"/>

      <!-- Left Text -->
      <g transform="translate(64, 130)">
        <text x="0" y="52" font-family="Georgia, serif" font-size="56" fill="#f4efe6" letter-spacing="-1">Meet Your Ally</text>
        <text x="0" y="98" font-family="Georgia, serif" font-size="24" fill="#9a92a6">Distinct companions tailored to who you connect with.</text>
        
        <g transform="translate(0, 150)">
          <text x="0" y="20" font-family="-apple-system, sans-serif" font-size="14.5" font-weight="500" fill="#f4efe6">✦ Slow-Burn Romantic</text>
          <text x="190" y="20" font-family="-apple-system, sans-serif" font-size="14.5" font-weight="500" fill="#f4efe6">✦ Calm Confidant</text>
          <text x="0" y="54" font-family="-apple-system, sans-serif" font-size="14.5" font-weight="500" fill="#f4efe6">✦ Best Friend</text>
          <text x="190" y="54" font-family="-apple-system, sans-serif" font-size="14.5" font-weight="500" fill="#f4efe6">✦ Tough-Love Guide</text>
        </g>
      </g>
    </svg>
  `);

  await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 3,
      background: { r: 10, g: 9, b: 16 },
    },
  })
    .composite([
      { input: svgOverlay, left: 0, top: 0 },
      { input: cardF01, left: 510, top: 75 },
      { input: cardF02, left: 680, top: 125 },
      { input: cardM01, left: 830, top: 75 },
    ])
    .png()
    .toFile(path.join(outDir, "feature-graphic-2-ensemble.png"));

  console.log("Saved: feature-graphic-2-ensemble.png");
}

async function createGraphic3() {
  console.log("Generating Feature Graphic 3: Chat & Conversation...");

  const portraitWidth = 500;
  const portraitF04 = await sharp("public/assets/reveal/F04.jpg")
    .resize(portraitWidth, HEIGHT, { fit: "cover", position: "north" })
    .toBuffer();

  const seamGradient = Buffer.from(`
    <svg width="240" height="${HEIGHT}" viewBox="0 0 240 ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="seam3" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#0a0910" stop-opacity="1"/>
          <stop offset="55%" stop-color="#0a0910" stop-opacity="0.8"/>
          <stop offset="100%" stop-color="#0a0910" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="240" height="${HEIGHT}" fill="url(#seam3)"/>
    </svg>
  `);

  const textOverlay = Buffer.from(`
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="tealGlow" cx="20%" cy="30%" r="60%">
          <stop offset="0%" stop-color="#2E7D6B" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#0a0910" stop-opacity="0"/>
        </radialGradient>
      </defs>

      <rect x="0" y="0" width="550" height="${HEIGHT}" fill="url(#tealGlow)"/>

      <!-- Mock Chat Bubbles -->
      <g transform="translate(64, 85)">
        <text x="0" y="44" font-family="Georgia, serif" font-size="50" fill="#f4efe6" letter-spacing="-1">Real Conversations</text>
        <text x="0" y="76" font-family="-apple-system, sans-serif" font-size="15" fill="#9a92a6">Companions that listen, remember, and text back.</text>

        <!-- Bubble 1 (Them) -->
        <g transform="translate(0, 115)">
          <rect x="0" y="0" width="370" height="52" rx="18" fill="#151220" stroke="#2c2638" stroke-width="1.2"/>
          <text x="18" y="32" font-family="-apple-system, sans-serif" font-size="14.5" fill="#f4efe6">hey, was thinking about what you said earlier...</text>
        </g>

        <!-- Bubble 2 (Me) -->
        <g transform="translate(70, 185)">
          <rect x="0" y="0" width="290" height="52" rx="18" fill="#f4efe6"/>
          <text x="18" y="32" font-family="-apple-system, sans-serif" font-size="14.5" font-weight="500" fill="#0a0910">I really appreciated you listening.</text>
        </g>

        <!-- Bubble 3 (Them) -->
        <g transform="translate(0, 255)">
          <rect x="0" y="0" width="320" height="52" rx="18" fill="#151220" stroke="#2c2638" stroke-width="1.2"/>
          <text x="18" y="32" font-family="-apple-system, sans-serif" font-size="14.5" fill="#f4efe6">always. did you end up finishing that project?</text>
        </g>
      </g>
    </svg>
  `);

  await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 3,
      background: { r: 10, g: 9, b: 16 },
    },
  })
    .composite([
      { input: portraitF04, left: WIDTH - portraitWidth, top: 0 },
      { input: seamGradient, left: WIDTH - portraitWidth, top: 0 },
      { input: textOverlay, left: 0, top: 0 },
    ])
    .png()
    .toFile(path.join(outDir, "feature-graphic-3-conversation.png"));

  console.log("Saved: feature-graphic-3-conversation.png");
}

async function run() {
  await createGraphic1();
  await createGraphic2();
  await createGraphic3();
  console.log("All feature graphics created in android/app/playstore/feature-graphics!");
}

run().catch(console.error);
