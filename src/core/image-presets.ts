/**
 * Image recreation presets.
 *
 * The recreated image is not a cosmetic variant any more: the affiliate needs
 * the thumbnail to stop looking like every other Shopee screenshot in the feed,
 * so the subject/scene moves. Every preset still holds two hard rules from
 * `defaultRecreatePrompt`:
 *
 *   1. the product is copied from the reference image — never re-invented;
 *   2. the output carries no text, watermark or logo overlay.
 *
 * `{{PRODUCT}}` is replaced by the product label and `{{SCENE}}` by the
 * category-derived setting, both from `recreate-image.ts`. Anything else in the
 * prompt is fixed English: the image model is more reliable with a stable,
 * concrete instruction than with a free-text field typed by the operator.
 */

export type ImagePreset = {
  id: string;
  label: string;
  prompt: string;
  aspect: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
};

const IDENTITY = [
  "Keep the product exactly as in the reference image — same design, colours, labels, text on the packaging and proportions. Do not re-draw, re-brand or change the product in any way.",
  "Photorealistic, sharp focus, high detail, commercial advertising quality.",
  "No text, no watermark, no caption, no logo added by you.",
].join(" ");

/** Scene fallback for unknown categories; kept in sync with recreate-image.ts. */
function categoryScene(kategori: string | null): string {
  const k = (kategori || "").toUpperCase();
  if (k.includes("FASHY") || k.includes("BAJU") || k.includes("PAKAIAN"))
    return "on a clean neutral studio backdrop with soft diffused lighting";
  if (k.includes("OUTDOOR") || k.includes("GADGET") || k.includes("ELEKTRONIK"))
    return "on a light grey seamless surface with a subtle open flat-lay composition, soft shadow";
  return "on a pure white seamless studio background with soft directional lighting and a clean drop shadow";
}

export const IMAGE_PRESETS: ImagePreset[] = [
  {
    id: "human-holding",
    label: "Produk + manusia",
    prompt: [
      "A real human hand and forearm holds the product up at chest height, filling most of the frame.",
      "Natural relaxed grip, fingers clearly visible, skin texture realistic, no gloves.",
      "Cropped close-up framing, the person's face is not in the shot.",
      "{{PRODUCT}}",
      "{{SCENE}}",
      IDENTITY,
    ].join(" "),
    aspect: "4:3",
  },
  {
    id: "gesture-closeup",
    label: "Produk + gesture/pose",
    prompt: [
      "Extreme close-up of two hands interacting with the product: one holding it, the other pointing at or pinching the key detail, as if presenting it to the camera.",
      "Clear expressive gesture, shallow depth of field, product label fully legible.",
      "{{PRODUCT}}",
      "{{SCENE}}",
      IDENTITY,
    ].join(" "),
    aspect: "1:1",
  },
  {
    id: "animal-friend",
    label: "Produk + hewan",
    prompt: [
      "A small cute animal (a kitten, a puppy or a rabbit) sits beside the product, one paw resting on it, looking at the camera.",
      "Warm friendly mood, the animal is well lit and in sharp focus, product not occluded or scratched.",
      "{{PRODUCT}}",
      "{{SCENE}}",
      IDENTITY,
    ].join(" "),
    aspect: "1:1",
  },
  {
    id: "character-mascot",
    label: "Produk + karakter/maskot",
    prompt: [
      "A friendly 3D cartoon mascot character stands next to the product, both hands presenting it forward, oversized head, simple readable design, soft studio lighting.",
      "The character is original and generic, does not mimic any existing franchise or brand.",
      "{{PRODUCT}}",
      "{{SCENE}}",
      IDENTITY,
    ].join(" "),
    aspect: "4:3",
  },
  {
    id: "flatlay-studio",
    label: "Produk studio (safe)",
    prompt: [
      "Professional e-commerce product photograph, front-on, product centred and uncluttered.",
      "{{PRODUCT}}",
      "{{SCENE}}",
      IDENTITY,
    ].join(" "),
    aspect: "1:1",
  },
];

export const DEFAULT_PRESET = "gesture-closeup";

export function findPreset(id: string | null | undefined): ImagePreset {
  return IMAGE_PRESETS.find((p) => p.id === id) || IMAGE_PRESETS.find((p) => p.id === DEFAULT_PRESET)!;
}

/** Full prompt for a preset, with the product label and scene substituted. */
export function presetPrompt(presetId: string | null | undefined, productLabel: string, kategori: string | null): string {
  const preset = findPreset(presetId);
  return preset.prompt.split("{{PRODUCT}}").join(`Product: ${productLabel}.`).split("{{SCENE}}").join(`Scene: ${categoryScene(kategori)}`);
}
