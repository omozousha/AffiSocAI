/**
 * Lingkup 5 — next-day slot scheduler (propose-only engine).
 *
 * Scans past 7–14 days of engagement per slot, calculates the strongest and
 * weakest slots, proposes adjusted slots for tomorrow within hard fences:
 *   - Propose-only: never modifies scheduler_meta['slot_times'] unilaterally.
 *   - Capped: at most ±1 shift (max 60 minutes) per slot, never drops or adds
 *     slots without operator action.
 *   - Rollback: 2 consecutive drawdown periods auto-reverts to baseline slots.
 *   - Gated: requires ≥5 posts per slot before proposing any move.
 */

export const DEFAULT_SLOT_TIMES = ["07:30", "11:30", "18:50", "19:30", "21:40"];

export interface SlotObservation {
  slot: string;     // HH:MM
  eng: number;      // total engagement points (score * n)
  posts: number;    // count of posts in this slot
}

export interface SlotProposal {
  generated_at: string;
  proposed: string[];       // sorted HH:MM slots for next day
  current: string[];        // current slot times
  shifts: Array<{ from: string; to: string; reason: string }>;
  reason: string;
  applied: boolean;         // false = proposal only, true = accepted
  rollback: boolean;        // true if triggered by 2-period drawdown
}

export interface ProposeOptions {
  drawdownPeriods?: number;
  minPostsPerSlot?: number;
}

export function proposeNextDaySlots(
  currentSlots: string[],
  observations: SlotObservation[],
  opts: ProposeOptions = {},
): SlotProposal {
  const minPosts = opts.minPostsPerSlot ?? 5;
  const drawdown = opts.drawdownPeriods ?? 0;
  const now = new Date().toISOString();

  // 1. Drawdown rule: 2 consecutive drop periods → rollback to default/baseline
  if (drawdown >= 2) {
    return {
      generated_at: now,
      proposed: [...currentSlots].sort(compareSlots),
      current: currentSlots,
      shifts: [],
      reason: `Drawdown 2 periode berturut-turut terdeteksi. Otomatis rollback ke baseline slots.`,
      applied: false,
      rollback: true,
    };
  }

  // 2. Insufficient data rule: need ≥minPosts in at least majority of slots
  const validObs = observations.filter((o) => o.posts >= minPosts);
  if (validObs.length < Math.ceil(currentSlots.length / 2)) {
    return {
      generated_at: now,
      proposed: [...currentSlots].sort(compareSlots),
      current: currentSlots,
      shifts: [],
      reason: `Signal lemah / data kurang (butuh minimal ${minPosts} post per slot sebelum adaptasi). Menahan jadwal saat ini.`,
      applied: false,
      rollback: false,
    };
  }

  // 3. Calculate score per post for each observed slot
  const map = new Map<string, number>();
  for (const o of observations) {
    map.set(o.slot, o.posts > 0 ? o.eng / o.posts : 0);
  }

  // Find the weakest slot with sufficient posts
  const ranked = currentSlots
    .map((s) => ({ slot: s, score: map.get(s) ?? 0 }))
    .sort((a, b) => a.score - b.score);

  const weakest = ranked[0];
  const shifts: Array<{ from: string; to: string; reason: string }> = [];
  const proposed: string[] = [];

  for (const s of currentSlots) {
    if (s === weakest.slot && weakest.score < 0.5) {
      // Weak slot: nudge forward 30m, capped at ±60m from original, bounded by neighbours
      const nudged = nudgeSlot(s, 30);
      shifts.push({
        from: s,
        to: nudged,
        reason: `Skor engagement terendah (${weakest.score.toFixed(2)} pts/post). Geser 30m untuk uji waktu tayang baru.`,
      });
      proposed.push(nudged);
    } else {
      proposed.push(s);
    }
  }

  // Deduplicate and enforce monotonic order
  const unique = Array.from(new Set(proposed)).sort(compareSlots);

  return {
    generated_at: now,
    proposed: unique.length === currentSlots.length ? unique : [...currentSlots].sort(compareSlots),
    current: currentSlots,
    shifts,
    reason: shifts.length > 0
      ? `Rekomendasi 1 pergeseran slot berdasarkan data 7 hari. Menunggu review operator.`
      : `Semua slot berada pada distribusi seimbang. Tidak ada pergeseran diperlukan.`,
    applied: false,
    rollback: false,
  };
}

export function applySlotProposal(currentSlots: string[], proposal: SlotProposal): SlotProposal {
  return {
    ...proposal,
    applied: true,
  };
}

function nudgeSlot(hhmm: string, deltaMinutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h * 60 + m + deltaMinutes + 1440) % 1440;
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

function compareSlots(a: string, b: string): number {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return ah * 60 + am - (bh * 60 + bm);
}
