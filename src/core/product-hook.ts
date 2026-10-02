/**
 * Hook library — product-aware hooks that vary the opening line of a post.
 *
 * Rules:
 *   1. Never name the product (mystery = soft sell).
 *   2. Each slot gets a different hook — no consecutive duplicates.
 *   3. Hooks reference the *type* of product, not a claim about it.
 */

import type { ProductIdentity } from "./product-identity.ts";
import { detectType, typeLabel } from "./product-identity.ts";

export type HookVariant = {
  open: string;  // paragraph 1
  why: string;   // paragraph 2 (the "what makes it interesting" line)
  cta: string;   // paragraph before bio
};

type HooksByType = Record<string, HookVariant[]>;

const HOOKS: HooksByType = {
  helm: [
    {
      open: "Helm yang satu ini bikin feed berhenti sendiri — warna doff-nya nggak pasaran.",
      why: "Setiap sudutnya kelihatan effort, dari helm hingga kaca yang match di foto.",
      cta: "Masuk toko langsung kebayang pakai di jalan. Kira-kira serasi buat motor kamu? Cek bio.",
    },
    {
      open: "Baru lewat helm di {{shop}} yang nggak kelihatan biasa di jalan.",
      why: "Warna hitam doff dan kaca hitam bikin look monolit — beda sama yang glossy rame di pasaran.",
      cta: "Yang cari helm anti-mainstream, ini titik temu. Detail harga dan varian di bio.",
    },
    {
      open: "Scroll terus sampai helm ini nahan jari. Ngeliat sekali, kebayang terus.",
      why: "Desain shell half-face-nya ramping, kaca tegas — outfit rider langsung naik kelas.",
      cta: "Penasaran seberapa paket hemat? Link lengkap ada di bio.",
    },
  ],
  gadget: [
    {
      open: "Gadget kecil ini jawabannya buat yang meja kerjanya kabel ke mana-mana.",
      why: "Ukurannya ringkas tapi fungsinya nempel terus tiap hari — sekali pakai susah balik ke cara lama.",
      cta: "Yang setup-nya masih berantakan, cek bio sebelum kehabisan varian warna.",
    },
    {
      open: "Kenapa nggak ada yang kasih tahu gadget ini dari dulu? ⌁",
      why: "Detail build-nya rapi, nyolok ke HP langsung jalan, nggak perlu setting aneh-aneh.",
      cta: "Tebak fungsinya di komentar. Link + harga ada di bio.",
    },
    {
      open: "POV: meja kamu rapi dalam 2 menit gara-gara satu barang ini.",
      why: "Bentuknya minimalis, warnanya masuk ke semua setup — foto produknya jujur, bukan render.",
      cta: "Simpen dulu postingan ini, link-nya di bio kalau nanti butuh.",
    },
  ],
  rumah: [
    {
      open: "Satu barang rumah yang bikin tamu nanya 'beli di mana?' 🤫",
      why: "Bentuk dan warnanya beda dari yang biasa beredar — taruh di kamar langsung naik kelas.",
      cta: "Biar nggak salah harga, cek link di bio sebelum variannya habis.",
    },
    {
      open: "Kamar kos auto aesthetic cuma gara-gara ganti satu ini.",
      why: "Detail finishing-nya rapi, ukurannya pas buat kamar sempit maupun luas.",
      cta: "Yang lagi upgrade kamar, link lengkap ada di bio.",
    },
    {
      open: "Ibu-ibu PKK komplek sebelah sudah punya duluan, kamu kapan?",
      why: "Fungsinya kepakai tiap hari, bukan pajangan — sekali coba langsung paham kenapa laris.",
      cta: "Cek bio buat harga dan varian. Jangan tanya harga di komentar ya.",
    },
  ],
  fashion: [
    {
      open: "Outfit yang satu ini bikin OOTD auto beda dari kebanyakan orang. ✨",
      why: "Potongan dan warnanya statement tapi gampang di-mix — sekali lihat langsung kebayang pakai jalan.",
      cta: "Size lari terus, cek bio buat size chart + harga.",
    },
    {
      open: "Nemu hidden gem fashion di {{shop}} — harganya nggak masuk akal buat kualitas segini.",
      why: "Jahitannya rapi, bahannya kelihatan adem, foto produknya jujur bukan mockup.",
      cta: "Tebak ini apa di komentar. Link ada di bio.",
    },
    {
      open: "Stop beli outfit pasaran. Yang ini belum banyak yang punya. 👀",
      why: "Desainnya clean, warnanya statement — dipakai nongkrong langsung jadi pusat perhatian.",
      cta: "Simpen postingan ini, link-nya di bio kalau nanti butuh.",
    },
  ],
  skincare: [
    {
      open: "Skincare yang lagi rame dibahas di FYP — aku coba cari tahu kenapa. 🔍",
      why: "Kemasannya meyakinkan, klaim bahannya fokus ke masalah kulit yang paling sering dikeluhin.",
      cta: "Pastinya cek dulu cocok buat tipe kulitmu — link + detail di bio.",
    },
    {
      open: "POV: skin barrier kamu membaik cuma gara-gara ganti satu step ini.",
      why: "Teksturnya kelihatan ringan, gampang layering sama skincare lain.",
      cta: "Yang penasaran sama ingredients-nya, link lengkap di bio.",
    },
    {
      open: "Jangan beli skincare viral sebelum lihat yang satu ini dulu. ⚠️",
      why: "Bandingin kemasan dan klaimnya sama yang beredar — bedanya kelihatan di detail.",
      cta: "Cek bio buat harga dan varian ukuran.",
    },
  ],
  sepatu: [
    {
      open: "Sepatu yang bikin langkah berasa beda dari pertama pakai. 👟",
      why: "Siluetnya clean, warnanya gampang masuk ke semua outfit — difoto dari angle mana pun masuk.",
      cta: "Size lari terus, cek bio buat size chart.",
    },
    {
      open: "Sneakers di {{shop}} ini underrated parah — belum banyak yang tahu.",
      why: "Detail sol dan talinya rapi, dipakai harian nyaman dilihat maupun dipakai.",
      cta: "Link + harga ada di bio. Simpen dulu biar nggak lupa.",
    },
    {
      open: "Satu sepatu, tiga gaya: kampus, nongkrong, kondangan — semua masuk.",
      why: "Warnanya netral tapi nggak ngebosenin, potongannya timeless.",
      cta: "Tebak harganya di komentar. Jawabannya di bio.",
    },
  ],
  tas: [
    {
      open: "Tas yang muat banyak tapi tetap kelihatan ramping. 👜",
      why: "Kompartemennya mikir banget — dompet, HP, powerbank, semua ada tempatnya.",
      cta: "Yang tasnya sudah jebol resleting, link pengganti ada di bio.",
    },
    {
      open: "Nemu tas di {{shop}} yang harganya nggak masuk akal buat kerapian segini.",
      why: "Jahitan dan resletingnya kelihatan kokoh, talinya bisa diatur panjang-pendek.",
      cta: "Cek bio buat warna dan harga. Varian favorit cepat habis.",
    },
    {
      open: "Tas kerja yang nggak bikin bahu pegal + tetap stylish — emang ada?",
      why: "Bentuknya profesional tapi nggak kaku, muat laptop tanpa kelihatan gembung.",
      cta: "Simpen postingan ini, link-nya di bio.",
    },
  ],
  outdoor: [
    {
      open: "Gear outdoor yang bikin pendakian pertama berasa kayak yang kesepuluh. 🏕️",
      why: "Ringan, ringkas, fungsinya kepakai tiap jam di jalur — bukan gear pajangan.",
      cta: "Musim pendakian segera mulai, cek bio sebelum stok menipis.",
    },
    {
      open: "Jangan naik gunung sebelum punya yang satu ini. Serius. ⛰️",
      why: "Detail materialnya kelihatan tangguh, lipatannya kecil gampang masuk carrier.",
      cta: "Link + spek lengkap ada di bio.",
    },
    {
      open: "Camping auto nyaman cuma gara-gara upgrade satu gear ini.",
      why: "Yang pernah kedinginan di tenda pasti paham kenapa barang ini wajib.",
      cta: "Tebak fungsinya di komentar. Jawaban + link di bio.",
    },
  ],
  mainan: [
    {
      open: "Mainan yang bikin anak lupa HP seharian. Para orang tua wajib lihat. 🧸",
      why: "Warnanya cerah, bentuknya ngajak eksplor — bukan mainan yang sehari langsung bosen.",
      cta: "Cek bio buat harga dan varian umur.",
    },
    {
      open: "Kado ultah anak yang anti gagal — bungkusnya belum dibuka sudah heboh. 🎁",
      why: "Detailnya lucu, bahannya kelihatan aman buat anak.",
      cta: "Link ada di bio. Simpen buat nanti pas butuh kado dadakan.",
    },
    {
      open: "Mainan edukatif yang anaknya senang, orang tuanya tenang. 📚",
      why: "Sambil main sambil belajar — konsepnya cerdas, eksekusinya rapi.",
      cta: "Tebak ini apa di komentar sama anak. Link di bio.",
    },
  ],
  olahraga: [
    {
      open: "Gear olahraga yang bikin alasan 'mager' makin tipis. 💪",
      why: "Ringan, praktis, hasilnya kerasa — sekali rutin susah berhenti.",
      cta: "Resolusi sehat mulai dari sini. Link di bio.",
    },
    {
      open: "Workout di rumah berasa punya PT pribadi gara-gara satu alat ini. 🏠",
      why: "Ukurannya compact buat kamar kos, fungsinya setara alat gym besar.",
      cta: "Cek bio buat harga dan cara pakai.",
    },
    {
      open: "Atlet amatir vs yang niat — bedanya sering cuma di gear-nya. 🏃",
      why: "Materialnya kelihatan awet, dipakai intensif tetap nyaman.",
      cta: "Simpen postingan ini, link-nya di bio kalau nanti butuh.",
    },
  ],
  default: [
    {
      open: "Ngga aku sebut namanya, kalau penasaran cek di bio.",
      why: "Yang bikin menarik: bentuk dan warnanya beda dari yang biasa beredar. Detail pas di foto.",
      cta: "Biar nggak salah harga, langsung cek link di bio sebelum kepencar.",
    },
    {
      open: "Satu barang bikin berhenti scroll — bukan karena promo besar, tapi karena kelihatan benar-benar beda.",
      why: "Garis desainnya clean, warnanya statement, langsung kebayang dipakai sehari-hari.",
      cta: "Tebak ini apa di komentar. Link harga dan varian ada di bio.",
    },
    {
      open: "Nemu satu yang kayanya bakal sering lewat di FYP. Simpen dulu, kali aja kamu cari juga.",
      why: "Detail finishing-nya rapi, foto produknya jujur — bukan render, bukan mockup.",
      cta: "Yang mau cek langsung, link ada di bio. Jangan tanya harga di komentar ya.",
    },
  ],
};

/**
 * Pick a hook for this (product, publishIndex).
 *
 * publishIndex is the content's sequential id or slot index — any stable
 * integer that increments each publish. Rotating on it guarantees the first
 * N slots for one product are all different before any repeats.
 */
export function pickHook(id: ProductIdentity, publishIndex: number): HookVariant {
  const type = detectType(id);
  const pool = HOOKS[type] ?? HOOKS.default;
  const idx = publishIndex % pool.length;
  const h = pool[idx]!;
  const shop = id.shop.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const clue = typeLabel(type);
  return {
    open: h.open.replace(/\{\{shop\}\}/g, shop).replace(/\{\{clue\}\}/g, clue),
    why: h.why.replace(/\{\{shop\}\}/g, shop).replace(/\{\{clue\}\}/g, clue),
    cta: h.cta.replace(/\{\{shop\}\}/g, shop).replace(/\{\{clue\}\}/g, clue),
  };
}

/** Prompt fragment for image regen — matches the product type. */
export function imagePromptFor(id: ProductIdentity): string {
  const type = detectType(id);
  const productTypeLabel = typeLabel(type);
  const prompts: Record<string, string> = {
    helm: `Professional e-commerce product photograph of a full-face motorcycle helmet on a pure white seamless background, soft directional lighting, clean drop shadow, 45-degree three-quarter angle showing shell curvature and visor detail. Keep the product exactly as in the reference — same shell, same visor colour, no invented details.`,
    tas: `Professional e-commerce product photograph of a bag/backpack on a light concrete studio surface with soft diffused shadow, slight overhead angle.`,
    sepatu: `Professional e-commerce product photograph of footwear on a seamless stone-grey background, laces visible, soft directional light, clean drop shadow.`,
    gadget: `Professional e-commerce product photograph of a small electronic gadget on a matte grey seamless surface with subtle flat-lay composition, precise edge lighting, clean shadow, catalogue quality.`,
    rumah: `Warm lifestyle product photograph of a home item styled in a cozy modern bedroom, soft morning window light, lived-in but tidy bedding, shallow depth of field, catalogue quality.`,
    fashion: `Fashion e-commerce product photograph of an outfit on a ghost mannequin against a light grey studio backdrop, soft diffused lighting, fabric texture crisp, catalogue quality.`,
    skincare: `Clean beauty product photograph of a skincare product on a glossy white podium with soft water-splash bokeh background, fresh dewy lighting, premium skincare-ad quality.`,
    outdoor: `Rugged outdoor product photograph of outdoor gear on dark volcanic rock with blurred pine-forest background, dramatic natural light, adventure-catalogue quality.`,
    mainan: `Cheerful product photograph of a toy on a pastel-yellow seamless background with soft confetti bokeh, bright playful lighting, toy-catalogue quality.`,
    olahraga: `Dynamic sports product photograph of sports gear on a dark charcoal gym backdrop with dramatic rim lighting, sense of motion, fitness-catalogue quality.`,
    default: `Professional e-commerce product photograph of ${productTypeLabel} on a pure white seamless studio background, soft directional lighting and clean drop shadow. Keep the product exactly as in the reference — same design, colours and proportions.`,
  };
  return prompts[type] || prompts.default!;
}
