import sharp from "sharp";
import fs from "fs";
import path from "path";

const outDir = path.resolve("android/app/playstore/screenshots");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const WIDTH = 1080;
const HEIGHT = 1920;

const sourceScreens = [
  {
    path: "C:/Users/User/.gemini/antigravity/brain/1dc026db-7350-4281-b994-bec839dea5a9/.user_uploaded/media_1793540967361_af88418f.png",
    name: "screenshot-1-welcome.png",
    tagline: "GENUINE CONNECTION",
    title: "Not a Chatbot Pretending",
    subtitle: "Emotionally intelligent companions designed for real connection.",
    glowColor: "#B03A48",
  },
  {
    path: "C:/Users/User/.gemini/antigravity/brain/1dc026db-7350-4281-b994-bec839dea5a9/.user_uploaded/media_1793541002152_4022d0e2.png",
    name: "screenshot-2-personas.png",
    tagline: "THOUGHTFUL ROSTER",
    title: "Personalities That Fit You",
    subtitle: "Explore unique characters with distinct voices and stories.",
    glowColor: "#7E5A9B",
  },
  {
    path: "C:/Users/User/.gemini/antigravity/brain/1dc026db-7350-4281-b994-bec839dea5a9/.user_uploaded/media_1793541067245_4faf90ad.png",
    name: "screenshot-3-discovery.png",
    tagline: "INTUITIVE MATCHING",
    title: "Curated Companion Decks",
    subtitle: "Swipe through companions matched to your conversational tone.",
    glowColor: "#2E7D6B",
  },
  {
    path: "C:/Users/User/.gemini/antigravity/brain/1dc026db-7350-4281-b994-bec839dea5a9/.user_uploaded/media_1793541113496_166b1281.png",
    name: "screenshot-4-proposal.png",
    tagline: "RELATIONSHIP CONTINUITY",
    title: "They Listen &amp; Text Back",
    subtitle: "Companions who remember your conversations and reach out.",
    glowColor: "#C4702A",
  },
];

async function generateScreenshots() {
  console.log("Generating marketing screenshots (1080x1920)...");

  // Device mockup dimensions
  const phoneW = 760;
  const phoneH = 1420;
  const phoneRadius = 40;

  for (const item of sourceScreens) {
    console.log(`Processing: ${item.name}...`);

    // 1. Prepare rounded phone screenshot
    const screenInner = await sharp(item.path)
      .resize(phoneW - 16, phoneH - 16, { fit: "cover", position: "top" })
      .composite([
        {
          input: Buffer.from(
            `<svg><rect x="0" y="0" width="${phoneW - 16}" height="${phoneH - 16}" rx="${phoneRadius - 8}" ry="${phoneRadius - 8}"/></svg>`
          ),
          blend: "dest-in",
        },
      ])
      .png()
      .toBuffer();

    // 2. Prepare phone frame & drop shadow
    const phoneX = Math.round((WIDTH - phoneW) / 2);
    const phoneY = 460;

    const svgBgAndText = Buffer.from(`
      <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="ambientGlow" cx="50%" cy="30%" r="55%">
            <stop offset="0%" stop-color="${item.glowColor}" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="#0a0910" stop-opacity="0"/>
          </radialGradient>
          <filter id="phoneShadow" x="-20%" y="-10%" width="140%" height="130%">
            <feDropShadow dx="0" dy="30" stdDeviation="40" flood-color="#000000" flood-opacity="0.9"/>
          </filter>
        </defs>

        <!-- Dark base background -->
        <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#0a0910"/>
        
        <!-- Ambient atmospheric glow -->
        <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#ambientGlow)"/>

        <!-- Header Typography -->
        <g transform="translate(${WIDTH / 2}, 150)" text-anchor="middle">
          <!-- Tagline Pill -->
          <rect x="-105" y="0" width="210" height="32" rx="16" fill="#151220" stroke="#2c2638" stroke-width="1.2"/>
          <text x="0" y="21" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" fill="${item.glowColor}" letter-spacing="2.5">${item.tagline}</text>
          
          <!-- Main Title -->
          <text x="0" y="90" font-family="Georgia, serif" font-size="58" font-weight="400" fill="#f4efe6" letter-spacing="-1">${item.title}</text>
          
          <!-- Subtitle -->
          <text x="0" y="140" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="21" fill="#9a92a6" max-width="800">${item.subtitle}</text>
        </g>

        <!-- Device Outer Chassis with Drop Shadow -->
        <g filter="url(#phoneShadow)">
          <rect x="${phoneX}" y="${phoneY}" width="${phoneW}" height="${phoneH}" rx="${phoneRadius}" fill="#151220" stroke="#2c2638" stroke-width="2.5"/>
        </g>
      </svg>
    `);

    // Compose final image
    await sharp({
      create: {
        width: WIDTH,
        height: HEIGHT,
        channels: 3,
        background: { r: 10, g: 9, b: 16 },
      },
    })
      .composite([
        { input: svgBgAndText, left: 0, top: 0 },
        { input: screenInner, left: phoneX + 8, top: phoneY + 8 },
      ])
      .png()
      .toFile(path.join(outDir, item.name));

    console.log(`Saved: ${item.name}`);
  }

  console.log("All marketing screenshots successfully generated!");
}

generateScreenshots().catch(console.error);
