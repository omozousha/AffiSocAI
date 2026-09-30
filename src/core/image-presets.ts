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

/**
 * Identity guardrail — the visual features that make the product recognisably
 * ITSELF. Derived from the actual reference image, not from the product title.
 *
 * Verified against the live COSMO helmet: with only "keep the product as the
 * reference", every preset came back open-face with a clear visor and no rear
 * spoiler — a different product from the one the buyer receives. An image model
 * will substitute a plausible sibling unless the defining features are named.
 *
 * The jacket/helmet branch is a stopgap keyed on the word "helm"; the general
 * branch quotes the reference verbatim. A per-product override on the link row
 * is the real fix (operator confirms identity at import).
 */
const NEVER_RENDER = [
  "Do not render the retail packaging, box, carton, hang-tag or crate instead of the product — photograph the product itself",
  "Do not substitute a different model, variant or colour of the product",
  "No text, no watermark, no caption, no badge, no marketing overlay added by you",
].join(". ");

function identityFacts(productLabel: string): string {
  const name = productLabel.toLowerCase();
  if (name.includes("helm") || name.includes("helmet")) {
    return [
      "The product is a full-face motorcycle helmet — the chin bar is closed and integrated, not an open-face helmet",
      "matte (flat, non-glossy) black shell",
      "dark tinted smoke-black visor, not clear",
      "pointed rear spoiler fin at the back of the shell",
      "white italic COSMO logo on the lower side panel",
    ].join("; ");
  }
  return "the product's exact design, colours, labels and printed text as shown in the reference image — nothing re-drawn, re-coloured or re-branded";
}

const IDENTITY = [
  "Keep the product exactly as in the reference image — same design, colours, labels, text and proportions.",
  "Do not re-draw, re-brand or change the product in any way.",
  "Photorealistic, sharp focus, high detail, commercial advertising quality.",
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
      "{{IDENTITY}}",
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
      "{{IDENTITY}}",
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
      "{{IDENTITY}}",
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
      "{{IDENTITY}}",
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
      "{{IDENTITY}}",
    ].join(" "),
    aspect: "1:1",
  },
  {
    id: "lifestyle-room",
    label: "Lifestyle ruangan",
    prompt: [
      "Warm lifestyle photograph of the product styled in a real lived-in room, morning window light with soft long shadows, cozy textile layers around it, shallow depth of field, the product tack-sharp and hero of the frame.",
      "{{PRODUCT}}",
      "{{IDENTITY}}",
    ].join(" "),
    aspect: "4:3",
  },
  {
    id: "macro-detail",
    label: "Macro detail",
    prompt: [
      "Dramatic macro close-up of the product's most interesting texture or detail, raking side light revealing every stitch, weave or grain, dark blurred background, luxury commercial photography.",
      "{{PRODUCT}}",
      "{{IDENTITY}}",
    ].join(" "),
    aspect: "1:1",
  },
  {
    id: "night-neon",
    label: "Malam neon",
    prompt: [
      "Moody night photograph of the product on a wet reflective surface, neon pink and cyan rim light, cinematic haze, premium tech-ad mood, product perfectly lit and legible.",
      "{{PRODUCT}}",
      "{{IDENTITY}}",
    ].join(" "),
    aspect: "4:3",
  },
];

export const DEFAULT_PRESET = "gesture-closeup";

export function findPreset(id: string | null | undefined): ImagePreset {
  return IMAGE_PRESETS.find((p) => p.id === id) || IMAGE_PRESETS.find((p) => p.id === DEFAULT_PRESET)!;
}

/** Full prompt for a preset, with the product label, identity facts and scene substituted. */
export function presetPrompt(presetId: string | null | undefined, productLabel: string, kategori: string | null): string {
  const preset = findPreset(presetId);
  return preset.prompt
    .split("{{PRODUCT}}").join(`Product: ${productLabel}. ${identityFacts(productLabel)}.`)
    .split("{{SCENE}}").join(`Scene: ${categoryScene(kategori)}`)
    .split("{{IDENTITY}}").join(`${IDENTITY} ${NEVER_RENDER}`);
}

/**
 * Premium image-to-image master prompt (operator-supplied).
 * Used verbatim: the reference photo carries the product identity, so no
 * product label is injected — the model preserves the photo's subject.
 */
export const PREMIUM_IMG2IMG_PROMPT = `Transform the provided product photo into a premium, professional e-commerce product image.

Preserve the original product exactly as the main subject, including its shape, proportions, structure, materials, colors, textures, important details, and recognizable characteristics. Do not redesign, replace, or invent the product.

Improve the overall visual presentation to make the product look attractive, clean, modern, premium, trustworthy, and professionally photographed for an online shop.

Create a visually appealing commercial product photography composition with:
- clean and polished appearance
- professional studio lighting
- soft realistic shadows
- natural highlights and reflections
- balanced exposure
- accurate and realistic colors
- sharp product details
- subtle depth and dimensionality
- clean background with a premium minimalist aesthetic
- visually balanced composition
- suitable negative space around the product
- realistic perspective
- high-end commercial photography quality
- crisp edges and fine material details
- subtle separation between the product and background
- natural-looking contrast
- premium visual hierarchy
- optimized composition for online shopping platforms

Make the product immediately noticeable and visually appealing while keeping the image realistic and commercially credible.

The final image should look like a professionally produced e-commerce product photograph, suitable for product listings, marketplaces, catalogs, advertisements, social media commerce, and promotional materials.

Do not add any brand name, logo, watermark, slogan, promotional text, price, badge, label, packaging redesign, or artificial product features.

Do not change the identity or fundamental appearance of the original product.

Photorealistic, premium commercial product photography, realistic materials, realistic lighting, highly detailed, clean, elegant, modern, professional, visually appealing, high resolution.`;
