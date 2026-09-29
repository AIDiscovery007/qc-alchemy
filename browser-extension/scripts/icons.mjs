import { readFile, mkdir, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const source = await readFile(new URL("../assets/brand/alchemy.svg", import.meta.url));
const directory = new URL("../public/icon/", import.meta.url);
await mkdir(directory, { recursive: true });
for (const width of [16, 32, 48, 96, 128]) {
  const png = new Resvg(source, { fitTo: { mode: "width", value: width } }).render().asPng();
  await writeFile(new URL(`${width}.png`, directory), png);
}
console.log("Generated Alchemy icons: 16, 32, 48, 96, 128 px");
