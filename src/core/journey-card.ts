/**
 * Journey proof card — the pattern that makes a Threads reader stop.
 *
 * The reference post (ariefdm19) does not sell. It tells a short arc —
 * "I used to do it the small way, then I tried something, now there is a
 * number" — and attaches ONE image that is a screenshot of a real dashboard.
 * The number is what carries the post; the caption only frames it.
 *
 * This module builds both halves from data we actually hold:
 *
 *   1. `journeyCaption()`   — the arc, written from real counters
 *   2. `renderProofCard()` — a dark-mode dashboard card in PIL
 *
 * The numbers are pulled from the live database, never typed by hand. If a
 * counter is not available the card leaves the slot blank instead of
 * inventing a figure — a fabricated metric is the one thing that destroys
 * this format, because the entire post is a credibility claim.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const HERE = import.meta.dirname;
/**
 * PIL lives in the Hermes agent venv, not in the system python. The daemon's
 * PATH does not include the venv, so resolve the interpreter explicitly;
 * PY overrides for a different environment.
 */
const PYTHON = process.env.PYTHON || "/usr/local/lib/hermes-agent/venv/bin/python3";
/**
 * Cards are served through the same `/api/images/:file` route as recreated
 * product images, so they have to land in IMAGE_DIR. Writing them anywhere
 * else produces a URL that 404s.
 */
const CARD_DIR = process.env.AFFILIATE_CARD_DIR || join(HERE, "..", "..", "data", "images");

export interface JourneyStats {
  /** Products with a live affiliate link. */
  products: number;
  /** Distinct product categories covered. */
  categories: number;
  /** Content rows the generator has produced. */
  contentPieces: number;
  /** Scheduler slots that actually went out. */
  postsPublished: number;
  /** Days between the first and the most recent entry. */
  daysActive: number;
  /** Human-readable label for the handle the content belongs to. */
  handle: string;
  /** e.g. "Sep 2026" */
  period: string;
}

export interface ProofCard {
  ok: true;
  file: string;
  served_url: string;
  stats: JourneyStats;
  /** The caption that must travel with the card. */
  caption: string;
  hashtags: string[];
}
export type ProofCardResult = ProofCard | { ok: false; error: string };

/** One dated counter. The card prints label + value; blank legs never render. */
type Leg = { label: string; value: string; unit?: string };

/**
 * The caption arc. Four beats, in order — the same rhythm as the reference:
 * where I was, what changed, what it produced, the note to the reader.
 * The hook line stays product-flavoured so the post still reads as the
 * account's own voice rather than a generic founder story.
 */
export function journeyCaption(stats: JourneyStats, handle = stats.handle): string {
  return [
    `Dulu aku cuma kirim link harapan. Yang klik jarang, yang belanja makin jarang.`,
    `Belajar satu hal: jualan mulai dari bikin orang berhenti scroll dulu.`,
    `Terus aku coba bikin konten yang nggak langsung nawarin, tapi bikin orang baca habis.`,
    `Hasilnya sampai hari ini: ${stats.products} produk, ${stats.categories} kategori, ${stats.postsPublished} konten sudah terbit di ${handle}.`,
    `Pelan-pelan aja, yang penting mulai dulu.`,
  ].join("\n\n");
}

/** The five-tag set. Product-led, not trend-chasing. */
export function journeyHashtags(stats: JourneyStats): string[] {
  return ["#afiliasi", "#belanjamurah", "#rekomendasi", "#story", "#mulai"];
}

/** The caption plus hashtags, in the order a Threads post writes them. */
export function journeyText(stats: JourneyStats): string {
  return `${journeyCaption(stats)}\n\n${journeyHashtags(stats).join(" ")}`;
}

/**
 * Render the card by shelling out to the Python renderer. The TypeScript
 * side only prepares the stats payload; all drawing decisions live in the
 * script so the layout can be tuned without touching this module.
 */
function renderCard(stats: JourneyStats, legs: Leg[], outPath: string): void {
  const payload = JSON.stringify({
    handle: stats.handle,
    period: stats.period,
    legs: legs.filter((l) => l.value),
    out: outPath,
  });
  const script = [
    "import json, sys",
    "from PIL import Image, ImageDraw, ImageFont",
    `p = json.loads(${JSON.stringify(payload)})`,
    "W, H = 1080, 1350",
    "img = Image.new('RGB', (W, H), (14, 14, 14))",
    "d = ImageDraw.Draw(img)",
    "def f(sz, bold=False):",
    "    path = '/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf' % ('-Bold' if bold else '')",
    "    return ImageFont.truetype(path, sz)",
    "pad = 72",
    "fg, dim, faint = (250, 250, 250), (172, 172, 172), (140, 140, 140)",
    "rule = (48, 48, 48)",
    "y = pad",
    // header: handle big, period under it, hairline below
    "d.text((pad, y), p['handle'], font=f(52, True), fill=fg)",
    "y += 74",
    "d.text((pad, y), p['period'], font=f(30), fill=dim)",
    "y += 54",
    "d.rectangle((pad, y, W - pad, y + 2), fill=rule)",
    "y += 46",
    // metric blocks: label, value + unit, hairline between blocks
    "for i, leg in enumerate(p['legs']):",
    "    d.text((pad, y), leg['label'], font=f(29), fill=dim)",
    "    y += 48",
    "    d.text((pad, y), leg['value'], font=f(78, True), fill=fg)",
    "    unit = leg.get('unit', '')",
    "    if unit:",
    "        # fixed column + aligned to the number's baseline",
    "        d.text((pad + 320, y + 40), unit, font=f(29), fill=faint)",
    "    y += 78 + 30",
    "    if i < len(p['legs']) - 1:",
    "        d.rectangle((pad, y, W - pad, y + 1), fill=rule)",
    "        y += 46",
    // footer; bottom padding equals the top padding (pad = 72)
    "fy = y - 20",
    "d.rectangle((pad, fy, W - pad, fy + 2), fill=rule)",
    "d.text((pad, fy + 24), 'angka dari dashboard internal · bukan klaim penjualan', font=f(27), fill=faint)",
    "content_bottom = fy + 78",
    "img.crop((0, 0, W, min(H, content_bottom + pad))).save(p['out'])",
    'print("rendered", p["out"])',
  ].join("\n");
  execFileSync(PYTHON, ["-c", script], { stdio: ["ignore", "pipe", "pipe"] });
}

/** Build the card from live DB counters. */
export function renderProofCard(stats: JourneyStats): ProofCardResult {
  try {
    mkdirSync(CARD_DIR, { recursive: true });
    const file = `journey-${Date.now()}.png`;
    const outPath = join(CARD_DIR, file);

    const legs: Leg[] = [
      { label: "TOTAL PRODUK", value: String(stats.products), unit: "link aktif" },
      { label: "KATEGORI", value: String(stats.categories), unit: "kelas produk" },
      { label: "KONTEN TERBIT", value: String(stats.postsPublished), unit: "telah tayang" },
      {
        label: "HARI AKTIF",
        value: stats.daysActive > 0 ? String(stats.daysActive) : "",
        unit: "hari berjalan",
      },
    ];

    renderCard(stats, legs, outPath);

    return {
      ok: true,
      file,
      served_url: `/api/images/${file}`,
      stats,
      caption: journeyCaption(stats),
      hashtags: journeyHashtags(stats),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
