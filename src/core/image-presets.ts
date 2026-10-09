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
  "Do not mention or include any brand name, shop name, or product name in the image",
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
  if (name.includes("tas") || name.includes("backpack") || name.includes("ransel")) {
    return "The product is a bag/backpack — keep the main compartment shape, straps, zippers, and pocket layout exactly as in the reference image";
  }
  if (name.includes("sepatu") || name.includes("sneaker") || name.includes("shoes") || name.includes("sandal")) {
    return "The product is footwear — keep the sole pattern, upper material, lacing, and silhouette exactly as in the reference image";
  }
  if (name.includes("case") || name.includes("charger") || name.includes("kabel") || name.includes("cable") || name.includes("power") || name.includes("holder") || name.includes("speaker") || name.includes("earphone") || name.includes("headset") || name.includes("lampu") || name.includes("kipas") || name.includes("mouse") || name.includes("keyboard")) {
    return "The product is a small electronic accessory — keep the exact port/connector type and count, button placement, cable shape, surface finish (matte vs glossy) and colour as in the reference image";
  }
  if (name.includes("kaos") || name.includes("kemeja") || name.includes("jaket") || name.includes("hoodie") || name.includes("celana") || name.includes("dress") || name.includes("gamis") || name.includes("baju") || name.includes("kemeja") || name.includes("switer") || name.includes("sweater") || name.includes("rokbaju")) {
    return "The product is a garment — keep the exact neckline shape, sleeve length, cut/silhouette, fabric texture, print pattern placement and stitching color as in the reference image";
  }
  if (name.includes("serum") || name.includes("krim") || name.includes("cream") || name.includes("toner") || name.includes("masker") || name.includes("shampoo") || name.includes("sabun") || name.includes("sunscreen") || name.includes("lipstik") || name.includes("parfum")) {
    return "The product is a skincare/beauty item — keep the exact bottle/jar/tube shape, cap style, pump vs dropper mechanism, label layout and product color as in the reference image";
  }
  if (name.includes("mainan") || name.includes("puzzle") || name.includes("lego") || name.includes("boneka") || name.includes("puzzle")) {
    return "The product is a toy — keep the exact character shape, face expression, limb count/pose, color blocking and any printed artwork exactly as in the reference image";
  }
  if (name.includes("matras") || name.includes("dumbbell") || name.includes("olahraga") || name.includes("gym") || name.includes("yoga") || name.includes("sepeda") || name.includes("skipping")) {
    return "The product is sports/fitness equipment — keep the exact shape, grip texture, dimension proportions, adjustment mechanism and color scheme as in the reference image";
  }
  if (name.includes("tend") || name.includes("carrier") || name.includes("matras gunung") || name.includes("headlamp") || name.includes("jaket gunung") || name.includes("carrier") || name.includes("sleeping")) {
    return "The product is outdoor gear — keep the exact panel layout, pole/buckle/strap hardware, seam lines, color blocking and size proportions as in the reference image";
  }
  if (name.includes("lampu") || name.includes("rak") || name.includes("gantungan") || name.includes("vas") || name.includes("karpet") || name.includes("rak") || name.includes("gorden") || name.includes("sarung") || name.includes("selimut") || name.includes("spray") || name.includes("wadah") || name.includes("kotak")) {
    return "The product is a home/living item — keep the exact form, material look (fabric/wood/ceramic/plastic), color, dimensions proportion and any printed pattern exactly as in the reference image";
  }
  return "the product's exact design, colours, labels, printed text, proportions and materials as shown in the reference image — nothing re-drawn, re-coloured or re-branded";
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
export const PREMIUM_IMG2IMG_PROMPT = `Recreate the EXACT product from the reference photo as a premium e-commerce hero shot. This is a restyle of the same photo — NOT a new design.

FIDELITY LOCK (absolute, highest priority — overrides everything below):
- The product must be pixel-faithful to the reference: identical silhouette, identical shape and proportions, identical part count, identical colors and color placement, identical materials and surface texture, identical seams/holes/buttons/ports/straps/edges, identical printed text and label positions where legible.
- Do not redesign, restyle, resize, re-angle, re-brand, simplify, embellish, merge, split, mirror-flip, or invent ANY feature of the product. Do not add parts the reference does not show; do not remove parts the reference shows.
- Same product type and same viewing angle family as the reference. If the reference shows one object, output exactly one object — never a different object, even one of the same category.
- THE ONE FIDELITY EXCEPTION (operator rule — brand must not be readable): REMOVE brand wordmarks, logos and brand names printed/embossed on the product body itself — replace the marking area with plain same-color surface or a generic unbranded mark. Everything else stays identical. No text may be readable anywhere in the final photo.
- When in doubt between making the image prettier and keeping the product exact: keep the product exact.

STYLING (what you ARE allowed to improve):
- Ad-overlay REMOVAL (mandatory): delete all text and graphics that are NOT physically part of the product — promotional slogans, price/rating badges, feature icons, watermarks, corner logos, arrows, spec callouts baked into the reference photo. These are ad presentation, not product identity. Keep only text physically printed/engraved on the product itself.
- Background: clean seamless light-gray studio sweep with a soft radial brightening behind the product (premium minimalist marketplace look). Neutral, uncluttered, product floats as the hero.
- Lighting: professional softbox studio setup — soft directional key light, gentle fill, realistic contact shadow beneath the product, natural highlights and reflections, balanced exposure.
- Composition: product centered, fills the frame with modest negative space, subtle ground contact and depth, crisp edges, sharp focus across the product, fine material detail.
- Color grade: accurate, true-to-reference product colors; overall image clean, bright, modern, high-end commercial photography quality, photorealistic, high resolution.

NEVER ADD: brand names, logos, watermarks, slogans, promotional text, prices, badges, rating stars, "free shipping" ribbons, packaging redesign, props, models, hands, reflections of other objects, invented glow/particles.

Output: one photorealistic premium product photograph of the exact product from the reference, as if shot in a top-tier studio — identical product, elevated presentation.`;
