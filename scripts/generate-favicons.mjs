import sharp from "sharp";
import toIco from "to-ico";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = fs.readFileSync(path.join(root, "favicon.svg"));

const sizes = [
  [16, "favicon-16x16.png"],
  [32, "favicon-32x32.png"],
  [96, "favicon-96x96.png"],
  [180, "favicon-180x180.png"],
];

const icoInputs = [];
for (const [size, name] of sizes) {
  const buf = await sharp(svg).resize(size, size).png().toBuffer();
  fs.writeFileSync(path.join(root, name), buf);
  if (size <= 32) icoInputs.push(buf);
  console.log("wrote", name);
}

fs.writeFileSync(path.join(root, "favicon.ico"), await toIco(icoInputs));
console.log("wrote favicon.ico");
