/**
 * Category guess — keyword first, LLM when key present.
 *
 * ponytail: taxonomy fixed 16 labels; swap in real Shopee
 * category list when available.
 */

export const CATEGORIES = [
  "Elektronik",
  "Aksesoris HP",
  "Fashion",
  "Kecantikan",
  "Kesehatan",
  "Rumah Tangga",
  "Dapur",
  "Olahraga",
  "Outdoor",
  "Mainan",
  "Bayi & Anak",
  "Otomotif",
  "Komputer",
  "Fotografi",
  "Hobi",
  "Lainnya",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type CategoryResult = { category: Category; confidence: number; source: "keyword" | "llm" | "cache" };

const RULES: Array<[Category, RegExp]> = [
  ["Aksesoris HP", /CHARGER|CABLE|KABEL|\bCASE\b|CASSING|TEMPERED|POWERBANK|EARPHONE|HEADSET|\bTWS\b|HOLDER|MAGSAFE|\bFAN\b|PENDINGIN|\bCOOLER\b|RADIATOR/i],
  ["Elektronik", /TV|SPEAKER|EARBUD|HEADPHONE|SMARTWATCH|SCC|KIPAS ANGIN|LAMPU LED|BLENDER|RICE COOKER|VAKUM|ELEKTRONIK/i],
  ["Komputer", /MOUSE|KEYBOARD|MONITOR|LAPTOP|SSD|HDD|WEBCAM|PRINTER|USB HUB/i],
  ["Outdoor", /TENDA|CAMPING|HIKING|CARRIER|SLEEPING BAG/i],
  ["Mainan", /LEGO|MAINAN|\bTOY\b|RC |DRONE MAINAN|BONEKA|PUZZLE/i],
  ["Bayi & Anak", /PAMPERS|SUSU BAYI|STROLLER|BOTOL SUSU|POPOK/i],
  ["Otomotif", /HELM|OLI\b|BAN MOTOR|\bAKI\b|SARUNG MOTOR|SPION/i],
  ["Olahraga", /DUMBBELL|YOGA\b|\bBOLA\b|RAKET|FITNESS|\bGYM\b|SEPEDA/i],
  ["Fashion", /BAJU|KAOS|KEMEJA|DRESS|HOODIE|JAKET|CELANA|SEPATU|SANDAL|\bTAS\b|DOMPET|JILBAB|HIJAB|JAM TANGAN/i],
  ["Kecantikan", /SERUM|SKINCARE|MAKEUP|LIPSTIK|BEDAK|TONER|MOISTURIZER|MASKER WAJAH|PARFUM/i],
  ["Kesehatan", /VITAMIN|SUPLEMEN|OBAT|MASKER MEDIS|TERMOMETER|MINYAK KAYU PUTIH|HERBAL/i],
  ["Dapur", /PANCI|WAJAN|PISAU|KOMPOR|BOTOL MINUM|LUNCH BOX|DAPUR/i],
  ["Rumah Tangga", /SPREI|BANTAL|GORDEN|DEKORASI|STORAGE|RAK|HOME|RUMAH/i],
  ["Fotografi", /KAMERA|LENSA|TRIPOD|GIMBAL|RING LIGHT/i],
  ["Hobi", /ACTION FIGURE|GUNDAM|AQUARIUM|UM PAN|ALAT MUSIK|GITAR/i],
];

const cache = new Map<string, CategoryResult>();

function keyword(title: string, desc: string): CategoryResult {
  const hay = `${title} ${desc}`;
  for (const [cat, re] of RULES) if (re.test(hay)) return { category: cat, confidence: 0.7, source: "keyword" };
  return { category: "Lainnya", confidence: 0.3, source: "keyword" };
}

async function llm(title: string, desc: string): Promise<CategoryResult | null> {
  const key = process.env.CATEGORY_API_KEY?.trim();
  const base = (process.env.CATEGORY_API_BASE || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const model = process.env.CATEGORY_MODEL || "google/gemini-2.0-flash-001";
  if (!key) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 40,
        messages: [
          { role: "system", content: `Klasifikasikan produk ke SATU label: ${CATEGORIES.join(", ")}. Balas JSON {"category":"...","confidence":0-1}.` },
          { role: "user", content: `Judul: ${title}\nDeskripsi: ${desc.slice(0, 500)}` },
        ],
      }),
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const raw = j.choices?.[0]?.message?.content || "";
    const m = raw.match(/\{[^}]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]) as { category?: string; confidence?: number };
    if (!p.category || !(CATEGORIES as readonly string[]).includes(p.category)) return null;
    return { category: p.category as Category, confidence: p.confidence ?? 0.8, source: "llm" };
  } catch {
    return null;
  }
}

/** Guess category from scraped title + description. Cached per title. */
export async function classifyCategory(title: string, description = ""): Promise<CategoryResult> {
  const k = title.trim().toLowerCase();
  const hit = cache.get(k);
  if (hit) return { ...hit, source: "cache" };
  const ai = await llm(title, description);
  const r = ai ?? keyword(title, description);
  cache.set(k, r);
  return r;
}

export function clearCategoryCache(): void {
  cache.clear();
}
