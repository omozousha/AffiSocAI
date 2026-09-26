import { generateImage } from "../src/core/router-image.ts";
try {
  const r = await generateImage("a tiny test apple on white");
  console.log("OK", r.bytes.length, r.model);
} catch (e) {
  console.log("THREW:", String(e).slice(0, 400));
}
