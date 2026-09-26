import { generateImage, recreateImage } from "../src/core/router-image.ts";
import { writeFileSync, readFileSync } from "node:fs";

const which = process.argv[2] || "both";

if (which === "gen" || which === "both") {
  const a = await generateImage("A cute cat wearing a tiny hat, studio photo");
  writeFileSync("/tmp/tt.jpg", a.bytes);
  console.log("generateImage ->", a.bytes.length, "bytes", a.mime, a.model);
}

if (which === "rec" || which === "both") {
  // POST the source the same way production does (src/core/recreate-image.ts):
  // fetched to bytes first, then sent as a data URI. A remote PNG URL makes the
  // gateway answer 400 "Unsupported MIME type: image/*".
  let src = "https://down-id.img.susercontent.com/file/id-11134211-8224y-mivc5zleioskdd";
  const local = process.argv[3];
  if (local) {
    src = `data:image/jpeg;base64,${readFileSync(local).toString("base64")}`;
  }
  const b = await recreateImage(
    src,
    "Redraw this exact product as a clean studio product photo on a plain white background. Keep the product identical.",
  );
  writeFileSync("/tmp/rec.jpg", b.bytes);
  console.log("recreateImage ->", b.bytes.length, "bytes", b.mime, b.model);
}
