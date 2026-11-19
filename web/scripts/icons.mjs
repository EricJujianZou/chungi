// Generates the placeholder PWA icons: flat colour with the letter c.
// Run with: node web/scripts/icons.mjs
// The design pass replaces these with real icons.
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../public/", import.meta.url));
const sizes = { "icon-192.png": 192, "icon-512.png": 512, "apple-touch-icon.png": 180 };

for (const [name, size] of Object.entries(sizes)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="100%" height="100%" fill="#2f6b4f"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="sans-serif"
    font-weight="700" font-size="${Math.round(size * 0.62)}" fill="#f4efe6">c</text>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out + name);
  console.log("wrote", name);
}
