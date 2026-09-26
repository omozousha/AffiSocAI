import { generateImage } from "../src/core/router-image.ts";
const t0 = Date.now();
try {
  const img = await generateImage("a red apple on white background", { size: "1024x1024" });
  await import("node:fs/promises").then((fs) => fs.writeFile("/tmp/chain-test.bin", img.bytes));
  console.log(`OK model=${img.model} mime=${img.mime} bytes=${img.bytes.length} secs=${((Date.now()-t0)/1000).toFixed(1)}`);
} catch (e) {
  console.log("FAIL:", String(e).slice(0, 400));
}
