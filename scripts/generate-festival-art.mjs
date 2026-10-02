// Renders the local festival illustrations in public/festival-art/*.webp (160px, transparent background).
// Run: node scripts/generate-festival-art.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "festival-art");
mkdirSync(OUT, { recursive: true });

const grad = (id, a, b, v = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${v ? 0 : 1}" y2="${v ? 1 : 0}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const glow = (c) =>
  `<radialGradient id="glow"><stop offset="0" stop-color="${c}" stop-opacity=".55"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`;
const wrap = (glowColor, defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<defs>${glow(glowColor)}${defs}<filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".35"/></filter></defs>
<circle cx="64" cy="64" r="60" fill="url(#glow)"/><g filter="url(#sh)">${body}</g></svg>`;

const bow = (c1, c2, arrow) =>
  wrap(c1, grad("g", c1, c2),
    `<path d="M40 14C104 36 104 92 40 114" stroke="url(#g)" stroke-width="9" fill="none" stroke-linecap="round"/>
     <path d="M40 14V114" stroke="#f1f5f9" stroke-width="2.5"/>
     <path d="M30 64H112" stroke="${arrow}" stroke-width="5" stroke-linecap="round"/>
     <path d="M102 50L122 64 102 78z" fill="${arrow}"/><path d="M30 64l-8-9M30 64l-8 9" stroke="${arrow}" stroke-width="4" stroke-linecap="round"/>`);

const kite = (x, y, c1, c2, r) =>
  `<g transform="translate(${x} ${y}) rotate(${r})"><path d="M0-34L24 0 0 34-24 0z" fill="${c1}"/><path d="M0-34L24 0H-24z" fill="${c2}"/><path d="M0-34V34M-24 0H24" stroke="#fff" stroke-opacity=".7" stroke-width="1.5"/><path d="M0 34C-8 48 8 54-2 70" stroke="#fde68a" stroke-width="2" fill="none"/></g>`;

const lotus = (c1, c2) => `
  <path d="M64 24C84 44 86 68 64 92 42 68 44 44 64 24z" fill="${c1}"/>
  <path d="M22 52C46 50 62 68 64 92 36 94 20 78 22 52z" fill="${c2}"/>
  <path d="M106 52C82 50 66 68 64 92 92 94 108 78 106 52z" fill="${c2}"/>
  <path d="M10 82C30 74 52 84 64 98 40 108 18 102 10 82z" fill="${c1}" opacity=".9"/>
  <path d="M118 82C98 74 76 84 64 98 88 108 110 102 118 82z" fill="${c1}" opacity=".9"/>`;

const flag = wrap("#f97316", grad("o", "#fb923c", "#ea580c") + grad("g", "#22c55e", "#15803d") + grad("w", "#ffffff", "#e2e8f0"),
  `<rect x="14" y="8" width="7" height="116" rx="3" fill="#cbd5e1"/><circle cx="17.5" cy="8" r="6" fill="#fbbf24"/>
   <path d="M21 16C44 8 60 28 84 20 100 15 108 18 116 20V50C108 48 100 45 84 50 60 58 44 38 21 46z" fill="url(#o)"/>
   <path d="M21 46C44 38 60 58 84 50 100 45 108 48 116 50V80C108 78 100 75 84 80 60 88 44 68 21 76z" fill="url(#w)"/>
   <path d="M21 76C44 68 60 88 84 80 100 75 108 78 116 80V106C108 104 100 101 84 106 60 114 44 94 21 102z" fill="url(#g)"/>
   <circle cx="68" cy="64" r="11" stroke="#1d4ed8" stroke-width="2.4" fill="none"/>
   <g stroke="#1d4ed8" stroke-width="1.2">${Array.from({ length: 12 }, (_, i) => `<path d="M68 53V75" transform="rotate(${i * 15} 68 64)"/>`).join("")}</g>`);

const diwali = wrap("#fbbf24", grad("f", "#fde047", "#f97316") + grad("b", "#d97706", "#7c2d12"),
  `<path d="M64 12C84 36 90 52 80 68 74 78 54 78 48 68 38 52 44 36 64 12z" fill="url(#f)"/>
   <path d="M64 34C73 46 74 56 69 62 66 66 62 66 59 62 54 56 55 46 64 34z" fill="#fff7d6"/>
   <path d="M10 78H118C118 106 94 122 64 122S10 106 10 78z" fill="url(#b)"/>
   <path d="M10 78H118" stroke="#fdba74" stroke-width="5" stroke-linecap="round"/>
   <path d="M26 94H102M36 106H92" stroke="#fcd34d" stroke-width="3" stroke-linecap="round" opacity=".7"/>
   <circle cx="20" cy="112" r="7" fill="#f97316"/><circle cx="108" cy="112" r="7" fill="#fbbf24"/>`);

const holi = wrap("#a855f7", grad("p", "#f472b6", "#db2777") + grad("v", "#a78bfa", "#6d28d9") + grad("o", "#fbbf24", "#ea580c") + grad("t", "#5eead4", "#0891b2"),
  `<circle cx="42" cy="44" r="26" fill="url(#p)"/><circle cx="86" cy="40" r="22" fill="url(#v)"/><circle cx="84" cy="86" r="28" fill="url(#o)"/><circle cx="38" cy="88" r="22" fill="url(#t)"/>
   <circle cx="64" cy="64" r="14" fill="#fff" opacity=".25"/>
   <circle cx="108" cy="64" r="5" fill="#f472b6"/><circle cx="18" cy="62" r="5" fill="#fbbf24"/><circle cx="64" cy="12" r="4" fill="#38bdf8"/><circle cx="62" cy="118" r="5" fill="#a78bfa"/>`);

const A = {
  "gandhi-jayanti": wrap("#34d399", grad("s", "#e0b48a", "#b98558") + grad("c", "#ffffff", "#d9e2ea"),
    `<path d="M16 124C18 98 38 90 64 90s46 8 48 34z" fill="url(#c)"/>
     <path d="M52 90l12 16 12-16" fill="#c99a6b"/>
     <ellipse cx="22" cy="58" rx="7" ry="11" fill="#c99a6b"/><ellipse cx="106" cy="58" rx="7" ry="11" fill="#c99a6b"/>
     <ellipse cx="64" cy="56" rx="38" ry="42" fill="url(#s)"/>
     <path d="M30 40C34 22 48 16 64 16s30 6 34 24C86 30 42 30 30 40z" fill="#cfa075" opacity=".55"/>
     <circle cx="48" cy="58" r="12" fill="#fff" fill-opacity=".25" stroke="#1f2937" stroke-width="3"/><circle cx="80" cy="58" r="12" fill="#fff" fill-opacity=".25" stroke="#1f2937" stroke-width="3"/>
     <path d="M60 58h8M36 54l-10-3M92 54l10-3" stroke="#1f2937" stroke-width="3" stroke-linecap="round"/>
     <circle cx="48" cy="59" r="2.6" fill="#1f2937"/><circle cx="80" cy="59" r="2.6" fill="#1f2937"/>
     <path d="M52 78c8-5 16-5 24 0-6 3-18 3-24 0z" fill="#e8e8ee"/><path d="M52 90c8 5 16 5 24 0" stroke="#7c4a2d" stroke-width="3" fill="none" stroke-linecap="round"/>`),

  "republic-day": flag,
  "independence-day": flag,
  diwali,
  "gujarati-new-year": diwali,
  holi,
  dhuleti: holi,

  navratri: wrap("#f59e0b", grad("m", "#ea580c", "#7c2d12") + grad("l", "#16a34a", "#166534"),
    `<path d="M64 14C54 26 44 28 36 30 46 38 54 36 64 30z" fill="url(#l)"/><path d="M64 14C74 26 84 28 92 30 82 38 74 36 64 30z" fill="url(#l)"/>
     <circle cx="64" cy="26" r="12" fill="#b45309"/><circle cx="60" cy="22" r="4" fill="#d97706"/>
     <rect x="42" y="36" width="44" height="12" rx="5" fill="#fbbf24"/>
     <path d="M42 48C16 56 8 78 10 92c4 22 26 30 54 30s50-8 54-30c2-14-6-36-32-44z" fill="url(#m)"/>
     <path d="M16 78C44 86 84 86 112 78" stroke="#fde68a" stroke-width="4" fill="none"/>
     <path d="M20 96C46 104 82 104 108 96" stroke="#fde68a" stroke-width="3" stroke-dasharray="5 5" fill="none"/>
     <circle cx="64" cy="64" r="8" fill="#fde68a"/><circle cx="40" cy="70" r="4" fill="#fde68a"/><circle cx="88" cy="70" r="4" fill="#fde68a"/>`),

  dussehra: bow("#fbbf24", "#d97706", "#f97316"),
  "ram-navami": bow("#fb923c", "#c2410c", "#fde047"),

  "ganesh-chaturthi": wrap("#fb923c", grad("h", "#fdba74", "#ea580c") + grad("k", "#fde047", "#d97706"),
    `<path d="M30 40C14 44 8 70 22 88 38 84 44 64 40 46z" fill="url(#h)"/><path d="M98 40c16 4 22 30 8 48-16-4-22-24-18-42z" fill="url(#h)"/>
     <path d="M34 36L64 8l30 28" fill="url(#k)"/><circle cx="64" cy="14" r="5" fill="#ef4444"/>
     <ellipse cx="64" cy="58" rx="32" ry="34" fill="url(#h)"/>
     <path d="M64 46c-14 6-12 30-4 44 6 12 24 14 30 4 4-8-4-12-8-8" stroke="#c2410c" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M64 46c-14 6-12 30-4 44 6 12 24 14 30 4" stroke="#fdba74" stroke-width="4" fill="none" stroke-linecap="round" opacity=".6"/>
     <circle cx="50" cy="50" r="4.5" fill="#1f2937"/><circle cx="78" cy="50" r="4.5" fill="#1f2937"/>
     <path d="M46 78c-4 10 0 22 6 26" stroke="#fffbeb" stroke-width="6" fill="none" stroke-linecap="round"/>
     <path d="M44 34h40" stroke="#fde047" stroke-width="4" stroke-linecap="round"/>`),

  janmashtami: wrap("#38bdf8", grad("f", "#7dd3fc", "#0369a1") + grad("p", "#2dd4bf", "#1d4ed8"),
    `<rect x="6" y="62" width="116" height="14" rx="7" transform="rotate(-22 64 69)" fill="url(#f)"/>
     <g fill="#0c4a6e"><circle cx="40" cy="80" r="2.8"/><circle cx="54" cy="75" r="2.8"/><circle cx="68" cy="69" r="2.8"/><circle cx="82" cy="64" r="2.8"/></g>
     <path d="M96 14C124 22 126 62 100 78 82 64 80 30 96 14z" fill="url(#p)"/>
     <path d="M98 20C104 40 102 60 98 74" stroke="#a7f3d0" stroke-width="2.5" fill="none"/>
     <ellipse cx="104" cy="44" rx="9" ry="12" fill="#1d4ed8"/><ellipse cx="104" cy="44" rx="4" ry="6" fill="#fbbf24"/>
     <path d="M20 110c10-12 28-12 38 0" stroke="#fde68a" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/>`),

  "raksha-bandhan": wrap("#fb7185", grad("r", "#fda4af", "#e11d48") + grad("g", "#fde68a", "#d97706"),
    `<path d="M4 64C22 50 34 50 40 64M124 64C106 78 94 78 88 64" stroke="#f43f5e" stroke-width="7" fill="none" stroke-linecap="round"/>
     <path d="M4 64C22 78 34 78 40 64" stroke="#fbbf24" stroke-width="4" fill="none" stroke-linecap="round"/>
     <g fill="url(#r)">${[0, 60, 120, 180, 240, 300].map((a) => `<ellipse cx="64" cy="30" rx="12" ry="20" transform="rotate(${a} 64 64)"/>`).join("")}</g>
     <circle cx="64" cy="64" r="20" fill="url(#g)"/><circle cx="64" cy="64" r="10" fill="#be123c"/><circle cx="60" cy="60" r="3.5" fill="#fff" opacity=".6"/>`),

  "bhai-dooj": wrap("#fb7185", grad("t", "#fde68a", "#b45309") + grad("f", "#fde047", "#f97316"),
    `<ellipse cx="64" cy="88" rx="54" ry="26" fill="url(#t)"/><ellipse cx="64" cy="84" rx="44" ry="19" fill="#fff1f2"/>
     <circle cx="64" cy="84" r="7" fill="#e11d48"/><circle cx="42" cy="84" r="4" fill="#fb7185"/><circle cx="86" cy="84" r="4" fill="#fbbf24"/>
     <path d="M64 14C74 28 78 38 72 48 68 54 60 54 56 48 50 38 54 28 64 14z" fill="url(#f)"/><path d="M64 28c4 8 4 14 0 18-4-4-4-10 0-18z" fill="#fff7d6"/>
     <path d="M44 60H84C84 70 76 74 64 74S44 70 44 60z" fill="#c2410c"/>`),

  "maha-shivratri": wrap("#22d3ee", grad("t", "#cffafe", "#0891b2") + grad("m", "#f1f5f9", "#94a3b8"),
    `<path d="M64 20V122" stroke="url(#t)" stroke-width="7" stroke-linecap="round"/>
     <path d="M32 26V58C32 78 46 86 64 86s32-8 32-28V26" stroke="url(#t)" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M64 4L53 26H75z" fill="url(#t)"/><path d="M32 12L26 30H38zM96 12L90 30H102z" fill="url(#t)"/>
     <path d="M46 100c12 6 24 6 36 0" stroke="#67e8f9" stroke-width="4" fill="none" stroke-linecap="round"/>
     <path d="M110 40C96 42 90 56 98 68 90 66 84 54 88 44 94 32 104 32 110 40z" fill="url(#m)"/>`),

  uttarayan: wrap("#38bdf8", "",
    `${kite(46, 46, "#ec4899", "#f9a8d4", -14)}${kite(86, 70, "#f59e0b", "#fde68a", 16)}
     <path d="M70 84C60 96 72 106 62 120" stroke="#fde68a" stroke-width="2" fill="none"/>`),

  christmas: wrap("#22c55e", grad("g", "#4ade80", "#15803d"),
    `<path d="M64 8l7 14 15 2-11 10 3 15-14-8-14 8 3-15L42 24l15-2z" fill="#fbbf24"/>
     <path d="M64 34L90 66H76L98 94H30L52 66H38z" fill="url(#g)"/><path d="M64 60L104 108H24z" fill="url(#g)" opacity=".9"/>
     <rect x="54" y="106" width="20" height="16" rx="2" fill="#92400e"/>
     <circle cx="52" cy="76" r="5" fill="#ef4444"/><circle cx="76" cy="84" r="5" fill="#fbbf24"/><circle cx="46" cy="98" r="5" fill="#60a5fa"/><circle cx="82" cy="102" r="5" fill="#ef4444"/><circle cx="64" cy="94" r="4" fill="#fde68a"/>`),

  "good-friday": wrap("#e2e8f0", grad("c", "#f8fafc", "#94a3b8", false),
    `<path d="M64 64L8 14M64 64L120 14M64 64L8 114M64 64L120 114" stroke="#fff" stroke-opacity=".10" stroke-width="10"/>
     <rect x="54" y="10" width="20" height="108" rx="4" fill="url(#c)"/><rect x="26" y="36" width="76" height="20" rx="4" fill="url(#c)"/>
     <path d="M54 10h6v108h-6z" fill="#fff" opacity=".35"/>`),

  eid: wrap("#fbbf24", grad("m", "#fde68a", "#d97706", false),
    `<path d="M84 8C44 8 16 34 16 68s28 60 68 60C58 114 46 92 46 68S58 22 84 8z" fill="url(#m)"/>
     <path d="M98 36l6 14 15 2-11 10 3 15-13-8-13 8 3-15-11-10 15-2z" fill="#fff7d6"/>
     <circle cx="104" cy="104" r="4" fill="#fde68a"/><circle cx="112" cy="84" r="3" fill="#fde68a"/>`),

  "gujarat-day": wrap("#f59e0b", grad("m", "#fbbf24", "#b45309") + grad("f", "#fcd34d", "#d97706"),
    `<g fill="url(#m)">${Array.from({ length: 14 }, (_, i) => `<circle cx="64" cy="22" r="14" transform="rotate(${i * (360 / 14)} 64 64)"/>`).join("")}</g>
     <circle cx="64" cy="64" r="36" fill="url(#f)"/>
     <circle cx="50" cy="58" r="4.5" fill="#1f2937"/><circle cx="78" cy="58" r="4.5" fill="#1f2937"/>
     <path d="M60 68h8l-4 8z" fill="#7c2d12"/><path d="M54 82c6 5 14 5 20 0" stroke="#7c2d12" stroke-width="3" fill="none" stroke-linecap="round"/>
     <circle cx="38" cy="44" r="6" fill="#d97706"/><circle cx="90" cy="44" r="6" fill="#d97706"/>`),

  "buddha-jayanti": wrap("#f472b6", "", lotus("#f9a8d4", "#ec4899") + `<circle cx="64" cy="76" r="8" fill="#fde047"/>`),

  "mahavir-jayanti": wrap("#fbbf24", grad("g", "#fde68a", "#d97706"),
    `<path d="M40 14C70 10 94 30 94 56c-16-8-34-10-54 0 0-20 0-30 0-42z" fill="url(#g)"/>
     <circle cx="64" cy="64" r="8" fill="url(#g)"/><circle cx="46" cy="76" r="7" fill="url(#g)"/><circle cx="82" cy="76" r="7" fill="url(#g)"/>
     <path d="M22 94C40 88 54 98 64 112 74 98 88 88 106 94 98 116 74 120 64 120S30 116 22 94z" fill="#f472b6"/>`),

  "guru-nanak-jayanti": wrap("#60a5fa", grad("s", "#e2e8f0", "#64748b"),
    `<path d="M40 10L58 82 40 94 24 82z" fill="url(#s)" transform="rotate(30 64 64)"/><path d="M88 10L104 82 88 94 70 82z" fill="url(#s)" transform="rotate(-30 64 64)"/>
     <path d="M64 8l9 24v56l-9 8-9-8V32z" fill="url(#s)"/><path d="M64 8V96" stroke="#f8fafc" stroke-width="2" opacity=".7"/>
     <circle cx="64" cy="64" r="26" stroke="#fbbf24" stroke-width="7" fill="none"/>
     <path d="M30 100l-8 14M98 100l8 14" stroke="#cbd5e1" stroke-width="6" stroke-linecap="round"/>`),

  "new-year": wrap("#a78bfa", grad("g", "#fde68a", "#f59e0b"),
    `<g stroke="#fbbf24" stroke-width="6" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => `<path d="M64 14V40" transform="rotate(${i * 45} 64 64)"/>`).join("")}</g>
     <g fill="#fff7d6">${Array.from({ length: 8 }, (_, i) => `<circle cx="64" cy="8" r="4" transform="rotate(${i * 45 + 22} 64 64)"/>`).join("")}</g>
     <circle cx="64" cy="64" r="12" fill="#fde047"/><circle cx="64" cy="64" r="5" fill="#fff"/>`),

  monsoon: wrap("#38bdf8", grad("c", "#f1f5f9", "#94a3b8"),
    `<path d="M32 80C10 80 6 52 28 46 30 22 64 14 80 34 100 26 122 44 112 68 124 80 112 86 100 80z" fill="url(#c)"/>
     <path d="M40 92l-8 22M64 92l-8 22M88 92l-8 22" stroke="#38bdf8" stroke-width="6" stroke-linecap="round"/>`),

  "office-holiday": wrap("#818cf8", grad("b", "#818cf8", "#3730a3"),
    `<rect x="26" y="12" width="76" height="106" rx="6" fill="url(#b)"/>
     <g fill="#e0e7ff">${[0, 1, 2, 3].flatMap((r) => [0, 1, 2].map((c) => `<rect x="${38 + c * 22}" y="${24 + r * 20}" width="12" height="12" rx="2"/>`)).join("")}</g>
     <rect x="54" y="98" width="20" height="20" rx="2" fill="#1e1b4b"/>`),

  "holiday-default": wrap("#94a3b8", grad("c", "#94a3b8", "#475569") + grad("h", "#cbd5e1", "#64748b"),
    `<rect x="14" y="26" width="100" height="92" rx="14" fill="url(#c)"/><rect x="14" y="26" width="100" height="30" rx="14" fill="url(#h)"/><rect x="14" y="44" width="100" height="12" fill="url(#h)"/>
     <path d="M42 12V38M86 12V38" stroke="#e2e8f0" stroke-width="8" stroke-linecap="round"/>
     <path d="M64 66l7 15 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2z" fill="#f8fafc"/>`),
};

for (const [name, svg] of Object.entries(A)) {
  await sharp(Buffer.from(svg), { density: 192 })
    .resize(160, 160)
    .webp({ quality: 88, alphaQuality: 90, effort: 6 })
    .toFile(join(OUT, `${name}.webp`));
}
console.log(`Generated ${Object.keys(A).length} assets in ${OUT}`);
