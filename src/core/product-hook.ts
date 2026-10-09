/**
 * Hook library — product-aware hooks that vary the opening of a post.
 *
 * Rules:
 *   1. Never name the product, brand, or shop. Mystery = soft sell.
 *      (The old {{shop}} slot leaked the store slug into published captions —
 *      removed for good; do not reintroduce any shop/brand placeholder.)
 *   2. Each slot gets a different hook — rotate on publishIndex.
 *   3. `why` is short, genuinely useful education for the category — a real
 *      general fact or selection principle, never a claim about THIS product.
 *   4. `cta` speaks to a community ("tag the friend who…"), link stays in bio.
 */

import type { ProductIdentity } from "./product-identity.ts";
import { detectType, typeLabel } from "./product-identity.ts";
import { bestOpenFor } from "./hook-perf.ts";

export type HookVariant = {
  open: string;  // paragraph 1 — scroll-stopping hook
  why: string;   // paragraph 2 — educational storytelling, per category
  cta: string;   // paragraph 3 — community call, no inline link
};

type HooksByType = Record<string, HookVariant[]>;

const HOOKS: HooksByType = {
  helm: [
    {
      open: "Sebelum ganti helm, baca ini dulu — 2 detik yang bisa nyelametin kepala kamu. 🪖",
      why: "Helm yang melindungi itu yang ngiket kepala pas goyang, bukan yang kendor biar nggak rusak rambut. Busa pipi yang nahan pipi = ukuran pas; pastiin sertifikasi tercetak di shell, bukan tempelan. Dan ganti tiap ±5 tahun — busa yang pernah kena bentrok nggak pernah sama lagi, walau looks-nya masih mulus.",
      cta: "Tag temen rider yang helmnya masih kendor — semahal apa pun helm lama, kepala cuma satu. Yang lagi incer kandidat baru, detailnya di bio.",
    },
    {
      open: "Yang pakai half-face sering salah di satu titik ini. 👀",
      why: "Half-face cuma lindungin atas — jadi kaca dan fitting jadi segalanya. Cek jarak pandang kaca pas dipakai, dan pastiin busa dalam nggak naik ke alis. Rider yang sering berhenti mendadak wajib ngerasain sendiri pas fitting, bukan percaya review doang.",
      cta: "Komunitas rider, waktunya ngobrol: sharing cara fitting versi kalian di komentar. Candidate yang lagi kulirik ada di bio.",
    },
    {
      open: "Satu hal soal helm yang jarang diceritain sebelum beli. 🤫",
      why: "Harga nggak njamin keamanan — fitting yang njamin. Cek 10 detik: pakai, goyangin kepala kiri-kanan; kalau helm yang geser duluan sebelum kulit wajah, itu kebesaran. Helm bekas jatuh walau cuma baret kecil sudah selesai tugasnya.",
      cta: "Tag teman yang mau beli helm bulan ini biar nggak salah ukuran. Referensinya ada di bio.",
    },
  ],
  gadget: [
    {
      open: "Gadget kecil ini yang bikin meja kerja berubah nasib — tapi satu kesalahan bikin orang kecewa. ⚡",
      why: "Sebelum beli aksesoris elektronik cocokin 2 hal: jenis port (USB-A vs C, berapa watt) dan daya yang nyediain butuh. Charger lambat dan panas berlebih biasanya bukan salah device-nya — adaptor-nya nggak sefrekuensi. Baca spesifikasi, bukan cuma foto produk.",
      cta: "Tim setup meja rapi, kumpul — share masalah kabel kalian di komentar. Penasarannya sudah naik? Link di bio.",
    },
    {
      open: "Kenapa gadget sekecil ini bikin produktivitas naik diam-diam? 🧠",
      why: "Karena dia ngilangin friksi kecil: nyolok, langsung kepakai, tanpa ritual. Prinsipnya — perangkat yang butuh driver atau manual dulu sebelum kepakai biasanya mati di laci dalam sebulan. Cari yang jalan tanpa syarat.",
      cta: "Tag teman yang setup-nya masih semrawut. Detailnya sudah nunggu di bio.",
    },
    {
      open: "Jangan checkout dulu sebelum tahu satu ciri ini di gadget tipe gini. ⚠️",
      why: "Versi tiruan biasanya cuma niru bentuk luar. Pembedanya: bobot (komponen asli lebih padat), kerapian sambungan, dan garansi toko yang jelas. Foto produk yang nunjukin detail sambungan biasanya lebih jujur daripada render.",
      cta: "Komunitas yang suka ngulik, diskusi di komentar: ciri fisik apa yang kalian cek duluan? Link di bio.",
    },
  ],
  rumah: [
    {
      open: "Satu perubahan kecil di kamar yang efeknya nggak masuk akal. 🏠",
      why: "Kamar rapi itu bukan soal luas — tapi one-in-one-out: tiap barang baru masuk, satu keluar. Barang 'nanti juga kepakai' adalah sumber debu nomor satu. Mulai dari satu permukaan meja yang bersih — otak langsung terasa lega.",
      cta: "Tag teman yang kamarnya jadi gudang diam-diam. Yang mau mulai beres-beres aesthetic, link di bio.",
    },
    {
      open: "Barang rumah yang kelihatannya sepele ini yang bikin tamu nanya duluan. 🤫",
      why: "Prinsip dekor: satu objek fokus per sudut, jangan tiga. Warna netral plus satu tekstur unik kelihatannya lebih mahal daripada banyak corak ditumpuk. Lighting hangat sore hari nyelesaiin sisanya.",
      cta: "Kaum anak kos aesthetic, share sudut favorit kamar kalian di komentar. Detail barangnya di bio.",
    },
    {
      open: "Kenapa barang rumah cepat rusak? Sering cuma karena dua hal. 🔧",
      why: "Kelembapan dan sinar matahari langsung — dua-duanya nyiksa material. Simpen yang sensitif jauh dari jendela, lap setelah kena air walau cuma sedikit. Barang yang dipelihara 30 detik per hari umurnya panjang berlipat.",
      cta: "Tag yang rajin beli baru tapi nggak rawat. Yang mau cek detail, link di bio.",
    },
  ],
  fashion: [
    {
      open: "Outfit ini nggak aku sebut namanya — tapi potongannya ngomong sendiri. ✨",
      why: "Rahasia outfit kelihatan mahal bukan harga: warna netral gampang di-mix, bahan adem bikin sering kepakai, dan ukuran pas badan ngalahin brand apa pun. Beli karena bakal kepakai 5x, bukan karena viral seminggu.",
      cta: "Tag OOTD squad kamu buat tebak ini cocok buat acara apa. Size dan detail di bio.",
    },
    {
      open: "Tahan dulu 7 hari sebelum beli outfit viral — baca ini. 👀",
      why: "Tes sederhana sebelum checkout fashion: punya minimal 2 kombinasi dari lemari yang sudah ada buat item ini? Kalau nggak, dia bakal join kolektif 'dibeli mikir dua kali, dipakai sekali'. Warna statement sesekali boleh, fondasi lemari tetap yang netral.",
      cta: "Komunitas anti-galat-beli, ngobrol di komentar: kombinasi apa yang kalian bikin? Link di bio.",
    },
    {
      open: "Satu item yang bikin semua outfit di lemari tiba-tiba nyambung. 🧩",
      why: "Itu kerja potongan timeless: garis bersih, warna gampang di-mix, bahan yang jatuh rapi. Kualitas jahitan kelihatan dari bagian dalam — foto detail yang rapi biasanya bukan kebetulan.",
      cta: "Tag teman yang lemarinya penuh tapi nggak ada yang kepakai. Detail di bio.",
    },
  ],
  skincare: [
    {
      open: "Sebelum skincare-an makin rame, betulin dulu fondasi ini. 🔬",
      why: "Urutan layering itu dari tekstur paling cair ke paling kental — salah urutan, yang mahal nggak nyerep. Dan step pagi yang paling ngefek buat jangka panjang bukan serum: itu sunscreen. Mayoritas tanda penuaan dini datang dari UV, bukan umur.",
      cta: "Tag bestie skincare kamu buat cek rutinitasnya udah bener apa belum. Kandidat yang lagi dilirik ada di bio.",
    },
    {
      open: "Skin barrier rusak vs breakout — beda penyakit, beda solusi. ⚠️",
      why: "Perih setelah pakai produk itu sinyal barrier, bukan 'lagi detoks'. Kalau begitu: stop bahan aktif yang keras, balik ke cleanser lembut + moisturizer + sunscreen sampai tenang. Bahan aktif itu penambah, bukan pengganti fondasi.",
      cta: "Komunitas kulit sensitif, sharing pengalaman kalian di komentar. Gentle pick-nya di bio.",
    },
    {
      open: "Skincare viral belum tentu bener — yang ini bikin nanya duluan. 🔍",
      why: "Cara baca produk 10 detik: klaim didukung nama bahan (bukan cuma kata 'glowing'), terdaftar di badan pengawas, dan daftar INCI-nya masuk akal buat harga segitu. Kemasan rapi bukan jaminan isi rapi.",
      cta: "Tag yang gampang tergiur FYP beauty. Mau cek detail? Link di bio.",
    },
  ],
  sepatu: [
    {
      open: "Rahasia sepatu awet 2-3x lebih lama yang jarang dikasih tahu. 👟",
      why: "Kuncinya rotasi, bukan harga: jangan pakai sepatu yang sama dua hari berturut-turut — busa butuh sekitar 24 jam buat balik bentuk. Hindari panas langsung (sol getas), dan buat musim hujan sol tahan aus lebih penting daripada looks.",
      cta: "Tag yang koleksi sepatunya cuma satu pasang. Kandidat berikutnya nunggu di bio.",
    },
    {
      open: "Sepatu ini gampang banget di-mix — dan itu bukan kebetulan. 🎨",
      why: "Warna netral plus siluet clean bikin satu sepatu nyambung ke kampus, nongkrong, sampai semi-formal. Prinsip beli: pilih yang paling gampang dipaduin sama lemari kamu yang sudah ada, bukan yang paling ramai di feed orang.",
      cta: "Share kombinasi ala kalian di komentar, komunitas step rapi. Detail ukuran di bio.",
    },
    {
      open: "Ukuran sepatu online selalu jadi drama — ini cara nutup dramanya. 📏",
      why: "Ukur kaki sore hari (kaki ngebesar sepanjang hari), sisain ibu jari 0,5–1 cm di ujung, dan pakai tabel sentimeter toko — bukan nama size-nya. Salah size itu bukan dosa, tapi drama yang bisa dicegah 30 detik.",
      cta: "Tag teman yang selalu salah size online. Size chart-nya sudah nunggu di bio.",
    },
  ],
  tas: [
    {
      open: "Tas kamu cepat rusak bisa jadi bukan karena kualitas — tapi cara pakai. 👜",
      why: "Beban ideal di bahu itu ringan dan merata; satu pundak terus-terusan bikin badan nyari kompensasi dan bahu yang bayar. Barang berat paling dekat punggung, dan resleting yang dipaksa muat adalah pembunuh nomor satu.",
      cta: "Tag yang tasnya selalu jebol di resleting. Kandidat gantinya ada di bio.",
    },
    {
      open: "Kompartemen tas ini yang bikin isinya nggak jadi dasar laut. 🌊",
      why: "Prinsip pack: berat di dekat punggung, yang sering dikeluarin di saku luar. Satu pouch kecil buat charger dan benda receh lebih ngirit waktu nyari barang daripada tas ukuran apa pun. Tas rapi itu hasil sistem, bukan ukuran.",
      cta: "Kaum EDC, share isi tas kalian di komentar. Yang mau upgrade carrier, link di bio.",
    },
    {
      open: "Satu tas buat kerja, kuliah, dan akhir pekan — emang bisa? 🎒",
      why: "Bisa kalau bentuknya nggak teriak 'komuter' dan warnanya netral. Cek tiga hal: muat laptop plus sekatnya? Jahitan di titik beban dobel? Ada saku samping buat botol? Itu yang misahin tas 2-tahun dan tas 5-tahun.",
      cta: "Tag teman yang tas kerjanya masih tas bungkusan paket. Detail di bio.",
    },
  ],
  outdoor: [
    {
      open: "Yang bikin kedinginan di gunung biasanya bukan soal jaket tipis. 🏔️",
      why: "Prinsip 3 layer: base buang keringat, mid nahan panas, outer tahan angin+hujan. Katun nempel basah dan nyedot panas badan — musuh nomor satu. Kaus kaki ganti di tengah hari lebih ngefek daripada sepatu mahal.",
      cta: "Komunitas pendaki, share setup layering kalian di komentar. Gear yang lagi diincer ada di bio.",
    },
    {
      open: "Gear receh yang bikin pendakian pertama kerasa seperti yang kesepuluh. ⛺",
      why: "Nyaman di jalur sering datang dari barang kecil: headlamp dengan mode redup, matras yang nahan angin bawah, dry-bag buat elektronik. Tiap 100 gram di carrier berasa di kilometer jauh — tapi kenyamanan 100 gram berasa di jam pertama.",
      cta: "Tag kelompok gunung kalian yang masih nekat naik tanpa prepare. Detail di bio.",
    },
    {
      open: "Kesalahan gear paling mahal yang sering aku lihat di jalur. 🔥",
      why: "Memakai sesuatu yang belum pernah diuji di rumah. Semua material butuh break-in — trek pertama bukan tempat eksperimen. Coba dulu, jalan 30 menit di rumah, rasain titik geseknya sebelum bawa belasan kilo.",
      cta: "Pendaki lama, tambahin pelajaran mahal kalian di komentar. Yang baru mulai, cek bio.",
    },
  ],
  mainan: [
    {
      open: "Mainan yang bikin anak lupa HP seharian — dan otaknya tetep jalan. 🧸",
      why: "Mainan terbuka (bongkar-pasang, konstruksi) umurnya panjang karena anak bikin aturannya sendiri; mainan satu fungsi cepet bosen. Tandanya mainan bagus: anak fokus 15–20 menit tanpa disuapin. Buat usia kecil: bahan tebal, sudut tumpul.",
      cta: "Orang tua, share mainan paling awet di rumah kalian di komentar. Referensinya di bio.",
    },
    {
      open: "Kado anak yang nggak asal heboh — ada rumusnya. 🎁",
      why: "Rumus kado anti-gagal: sesuai usia + bisa dieksplor anak sendiri (bukan cuma nyala-nyala). Satu mainan besar lebih diingat daripada tiga kecil. Ragu usianya? Ambil satu tingkat di atas — masih kepakai sekarang, tumbuh bareng nanti.",
      cta: "Tag teman yang butuh kado weekend ini. Varian umur dan detail di bio.",
    },
    {
      open: "Sambil main sambil belajar itu bukan sekadar klaim — ini cara kerjanya. 📚",
      why: "Mainan edukatif bekerja kalau anak harus mikir buat menang, bukan asal pencet. Puzzle, balok, dan board game sederhana ngajarin sebab-akibat dan kesabaran yang nggak diajarin game layar. Bonus: orang tua ikut main — itu bagian 'edukatif' yang asli.",
      cta: "Komunitas parent, board game apa yang paling sering keluar di rumah? Link di bio.",
    },
  ],
  olahraga: [
    {
      open: "Alat ini bukan alasan buat males — ini penghapus alasan. 💪",
      why: "Progres itu volume naik bertahap, bukan semangat hari pertama. Teknik yang salah nggak ditambal alat mahal — mulai ringan dulu, catat progres. Dan istirahat itu bagian program: otot tumbuh pas tidur, bukan pas angkat.",
      cta: "Tag partner gym-kamar kamu yang mager. Mau mulai dari sini? Link di bio.",
    },
    {
      open: "Workout di kamar kos bisa kerasa seperti di gym — dengan satu penyesuaian. 🏠",
      why: "Kuncinya bukan berat alat tapi tempo: gerakan pelan (±3 detik turun) ngasih stimulus yang biasanya butuh beban besar. Matras 6–8 mm cukup buat lutut dan tetangga bawah — mulai dari sana sebelum nambah alat apa pun.",
      cta: "Tim home workout, share rutinitas favorit di komentar. Alasnya ada di bio.",
    },
    {
      open: "Cedera olahraga amatir hampir selalu karena hal yang sama. 🏃",
      why: "Naik intensitas sebelum badan siap — lompat duluan, teknik belum. Panasin sendi, naik pelan, dan bedain nyeri tajam dari pegal biasa. Alat yang pas bikin konsisten lebih gampang dipertahanin daripada motivasi apa pun.",
      cta: "Tag teman yang baru mulai tapi udah ngebut. Perlengkapannya nunggu di bio.",
    },
  ],
  default: [
    {
      open: "Nggak aku sebut namanya — tapi yang satu ini bikin berhenti scroll. 🤫",
      why: "Barang yang paling layak direkomendasiin biasanya yang ngeberesin masalah harian kecil: yang selama ini kamu tahan-tahan padahal ada jalan lebih simpel. Kalau pernah mikir 'kok belum ada yang bikin begini ya' — biasanya emang belum.",
      cta: "Tebak ini apa di komentar. Link harga dan varian ada di bio.",
    },
    {
      open: "Barang yang kelihatan biasa tapi nyesel kalau nggak keburu ambil. 👀",
      why: "Tips checkout online aman: cek review dengan foto (bukan bintang doang), perhatikan detail di foto dekat, dan simpen video unboxing. Harga bagus yang bikin tenang itu yang penjualnya transparan.",
      cta: "Tag teman yang keranjangnya selalu nanggung. Detailnya sudah nunggu di bio.",
    },
    {
      open: "Satu temuan yang bakal sering lewat di FYP kamu, kalau aku nggak salah. 🔥",
      why: "Barang layak disimpen itu yang fungsinya kepakai mingguan, fotonya jujur, dan dia nyelesaiin satu hal spesifik. Simpen postingan ini dulu — stok varian nggak nunggu kamu siap.",
      cta: "Yang udah ngerasa butuh, link lengkap ada di bio. Jangan tanya harga di komentar ya.",
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
// P2.7 feedback channel: the scheduler injects the daily hook_perf aggregate
// (meta table value) via setHookPerf; pickHook reads the cached string. A
// plain module-level cache keeps this file DB-free and unit-testable.
let hookPerfCache: string | null = null;
export function setHookPerf(json: string | null): void {
  hookPerfCache = json;
}

export function pickHook(id: ProductIdentity, publishIndex: number): HookVariant {
  const type = detectType(id);
  const pool = HOOKS[type] ?? HOOKS.default;
  const clue = typeLabel(type);
  const fill = (s: string) => s.replace(/\{\{clue\}\}/g, clue);
  const filled = pool.map((h) => ({ open: fill(h.open), why: fill(h.why), cta: fill(h.cta) }));
  // Once the daily hook_perf aggregate has >= MIN_SAMPLE posts for a variant,
  // that variant wins. No data / thin sample = rotation exactly as before
  // (slot-index), so behavior is unchanged while cold.
  const winner = bestOpenFor(hookPerfCache, type);
  if (winner) {
    // perf stores the first line of the PUBLISHED caption = the filled open.
    const hit = filled.find((h) => h.open === winner);
    if (hit) return hit;
  }
  return filled[publishIndex % filled.length]!;
}

/**
 * Scene detector for img2img prompt building.
 * Proven live failure: coffee maker classified as `rumah` was prompted in a
 * "cozy modern bedroom" — vision review rejected it (link 44). Scene must
 * match the actual product function (kitchen vs bedroom vs entryway vs food).
 * Returns the scene AND the concrete product noun so the prompt never says a
 * generic category list ("appliance (coffee maker/grinder/...)") — the image
 * model picks one at random and the vision reviewer rejects the mismatch.
 */
const SCENE_RULES: Array<{ scene: string; terms: Array<[RegExp, string]> }> = [
  // 1. Drinkware BEFORE food: kategori "Minuman" matches the food list too.
  { scene: "drinkware", terms: [[/TUMBLER/, "insulated stainless steel tumbler"], [/BOTOL\s*MINUM|WATER\s*BOTTLE/, "water bottle"], [/TERMOS|THERMOS/, "vacuum flask"], [/MUG|CANGKIR/, "mug"]] },
  { scene: "kitchen", terms: [[/COFFEE\s*GRINDER|GRINDER|GILINGAN/, "electric coffee grinder"], [/COFFEE\s*(MAKER|BREWER|MACHINE)/, "coffee maker"], [/BLENDER/, "blender"], [/MIXER/, "hand mixer"], [/JUICER/, "juicer"], [/AIR\s*FRYER/, "air fryer"], [/MICROWAVE/, "microwave oven"], [/OVEN/, "oven"], [/RICE\s*COOKER/, "rice cooker"], [/KETTLE|TEKO/, "electric kettle"], [/KOMPOR/, "portable stove"], [/PANCI/, "cooking pot"], [/KITCHEN\s*SINK|SINK\s*FILTER|PENYARING\s*AIR/, "kitchen sink water filter"]] },
  { scene: "food", terms: [[/POPCORN/, "salted caramel popcorn snack"], [/DRY\s*RUB|MARINASI|BUMBU/, "BBQ dry rub seasoning"], [/COKLAT|CHOCOLATE/, "chocolate confectionery"], [/KUE|COOKIE/, "cookies"], [/KERIPIK|CHIPS/, "potato chips"], [/SAMBAL|SAUS/, "chili sauce"], [/SUSU/, "milk beverage"], [/MAKANAN|SNACK/, "packaged snack food"]] },
  { scene: "entryway", terms: [[/RAK\s*SEPATU|SHOE\s*RACK/, "shoe rack"], [/BOX\s*SEPATU|KOTAK\s*SEPATU/, "shoe storage box"], [/RAK\s*BUKU/, "bookshelf"], [/GANTUNGAN/, "wall hanger"], [/ORGANIZER/, "storage organizer"], [/LEMARI/, "cabinet"]] },
  { scene: "bedroom", terms: [[/BANTAL\s*GULING|GULING/, "bolster pillow"], [/BANTAL/, "bed pillow"], [/KASUR|MATRAS/, "mattress"], [/SPREI/, "bed sheet"], [/SELIMUT/, "blanket"]] },
  { scene: "decor", terms: [[/PENGHARUM|AROMATERAPI|DIFFUSER/, "reed diffuser aroma"], [/HUMIDIFIER/, "humidifier"], [/LILIN|CANDLE/, "scented candle"], [/LAMPU\s*TIDUR/, "bedside lamp"], [/VASE|VAS\s*BUNGA/, "flower vase"]] },
  { scene: "automotive", terms: [[/POMPA\s*BAN|TIRE\s*PUMP/, "electric tire pump"], [/DASHCAM/, "dashboard camera"], [/CAR\s*HOLDER/, "car phone holder"], [/\bMOBIL\b/, "car accessory"], [/\bMOTOR(?:\s|$)/, "motorcycle accessory"]] },
  { scene: "gaming", terms: [[/HANDHELD|RETRO\s*GAME|R36S/, "retro handheld game console"], [/GAME\s*CONSOLE|KONSOL/, "game console"], [/GAMEPAD|STICK\s*GAME/, "game controller"], [/GAMING/, "gaming gear"]] },
  { scene: "ergonomic", terms: [[/KURSI\s*RODA|WHEELCHAIR/, "wheelchair"], [/KURSI\s*PUTAR/, "360 rotating mini chair"], [/KURSI\s*KERJA|ERGONOMIC/, "ergonomic office chair"], [/TONGKAT/, "walking cane"]] },
  { scene: "hardware", terms: [[/PENAHAN\s*PINTU|DOOR\s*STOPPER/, "door stopper"], [/GEMBOK|KUNCI/, "door lock"], [/COLOKAN|STOP\s*KONTAK/, "power socket adapter"]] },
];

function detectScene(id: ProductIdentity): { scene: string; noun: string } | null {
  const hay = `${id.name || ""} ${id.kategori || ""}`.toUpperCase();
  for (const rule of SCENE_RULES) {
    for (const [re, noun] of rule.terms) {
      if (re.test(hay)) return { scene: rule.scene, noun };
    }
  }
  return null;
}

const FIDELITY_CLAUSE = "Keep the product exactly as in the reference — same design, colours, labels, proportions and features, no invented details.";

/** Prompt fragment for image regen — matches the product type and scene. */
export function imagePromptFor(id: ProductIdentity): string {
  const hit = detectScene(id);
  const type = detectType(id);
  const productTypeLabel = typeLabel(type);

  // Scene-specific prompts take precedence over generic category prompts
  // to avoid absurd placements like coffee makers in cozy bedrooms. The noun
  // is interpolated so the image model never has to guess which product.
  const sceneTemplates: Record<string, string> = {
    kitchen: `Professional e-commerce product photograph of a {noun} on a clean marble kitchen countertop with soft morning natural light from a nearby window, pristine modern kitchen background with shallow depth of field.`,
    food: `Appetizing commercial food photography of a {noun} package styled on a warm wooden dining tabletop, soft natural lighting, natural gourmet props softly blurred in background, high-end food magazine editorial quality.`,
    drinkware: `Clean commercial product photograph of a {noun} standing upright on a minimalist stone coaster with subtle condensation droplets, soft studio lighting, fresh contemporary aesthetic.`,
    entryway: `Modern interior lifestyle photograph of a {noun} styled in a tidy contemporary entryway foyer with clean wooden flooring and bright natural ambient light, architectural digest quality.`,
    bedroom: `Warm lifestyle product photograph of premium {noun} neatly arranged on a modern luxury bed, soft morning window light, serene and cozy atmosphere, catalogue quality.`,
    decor: `Aesthetic interior lifestyle product photograph of a {noun} on a minimalist wooden side table with gentle ambient glow and soft morning bokeh, calm modern zen vibe.`,
    automotive: `Professional e-commerce product photograph of a {noun} on a clean textured charcoal surface, precise technical rim lighting, sleek modern tool aesthetic.`,
    gaming: `Sleek product photograph of a {noun} on a matte dark desk with subtle warm-amber and cyan rim lighting, crisp button details, tech-review quality.`,
    ergonomic: `Professional lifestyle product photograph of a {noun} on a clean light-grey seamless studio floor, soft even lighting, clear functional details visible.`,
    hardware: `Clean catalogue product photograph of a {noun} installed neatly against a modern door and wooden floor, natural lighting, clear functional view.`,
  };

  if (hit && sceneTemplates[hit.scene]) {
    return `${sceneTemplates[hit.scene]!.replace("{noun}", hit.noun)} ${FIDELITY_CLAUSE}`;
  }

  const categoryPrompts: Record<string, string> = {
    helm: `Professional e-commerce product photograph of a full-face motorcycle helmet on a pure white seamless background, soft directional lighting, clean drop shadow, 45-degree three-quarter angle showing shell curvature and visor detail. ${FIDELITY_CLAUSE}`,
    tas: `Professional e-commerce product photograph of a bag/backpack on a light concrete studio surface with soft diffused shadow, slight overhead angle. ${FIDELITY_CLAUSE}`,
    sepatu: `Professional e-commerce product photograph of footwear on a seamless stone-grey background, laces visible, soft directional light, clean drop shadow. ${FIDELITY_CLAUSE}`,
    gadget: `Professional e-commerce product photograph of a small electronic gadget on a matte grey seamless surface with subtle flat-lay composition, precise edge lighting, clean shadow, catalogue quality. ${FIDELITY_CLAUSE}`,
    rumah: `Warm lifestyle product photograph of a home item styled in a cozy modern living room, soft daylight, tidy modern decor, shallow depth of field, catalogue quality. ${FIDELITY_CLAUSE}`,
    fashion: `Fashion e-commerce product photograph of an outfit on a ghost mannequin against a light grey studio backdrop, soft diffused lighting, fabric texture crisp, catalogue quality. ${FIDELITY_CLAUSE}`,
    skincare: `Clean beauty product photograph of a skincare product on a glossy white podium with soft water-splash bokeh background, fresh dewy lighting, premium skincare-ad quality. ${FIDELITY_CLAUSE}`,
    outdoor: `Rugged outdoor product photograph of outdoor gear on dark volcanic rock with blurred pine-forest background, dramatic natural light, adventure-catalogue quality. ${FIDELITY_CLAUSE}`,
    mainan: `Cheerful product photograph of a toy on a pastel-yellow seamless background with soft confetti bokeh, bright playful lighting, toy-catalogue quality. ${FIDELITY_CLAUSE}`,
    olahraga: `Dynamic sports product photograph of sports gear on a dark charcoal gym backdrop with dramatic rim lighting, sense of motion, fitness-catalogue quality. ${FIDELITY_CLAUSE}`,
    default: `Professional e-commerce product photograph of ${productTypeLabel} on a pure white seamless studio background, soft directional lighting and clean drop shadow. ${FIDELITY_CLAUSE}`,
  };
  return categoryPrompts[type] || categoryPrompts.default!;
}
