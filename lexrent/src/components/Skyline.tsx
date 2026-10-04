import { useEffect, useState } from "react";

// ViewBox 1000 x 120, ground at y=120. Landmarks are hand-built shapes.
const G = 120;
const r = (x: number, w: number, h: number) => `M${x} ${G}V${G - h}H${x + w}V${G}Z`;
const steps = (cx: number, tiers: [number, number][], spire = 0) => {
  let d = "";
  for (const [w, h] of tiers) d += r(cx - w / 2, w, h);
  if (spire) { const top = tiers[tiers.length - 1]?.[1] ?? 0; d += `M${cx - 1} ${G - top}L${cx} ${G - top - spire}L${cx + 1} ${G - top}Z`; }
  return d;
};
// Deterministic filler buildings between x0 and x1
function filler(x0: number, x1: number, seed: number, min = 18, max = 55) {
  let d = "", x = x0, s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  while (x < x1) {
    const w = Math.min(12 + rnd() * 22, x1 - x);
    const h = min + rnd() * (max - min);
    d += r(x, w + 0.5, h);
    if (rnd() > 0.7) d += r(x + w / 2 - 1, 2, h + 6);
    x += w;
  }
  return d;
}

const empire = (cx: number) => steps(cx, [[46, 52], [34, 72], [24, 86], [14, 93], [8, 98]], 18);
const chrysler = (cx: number) =>
  steps(cx, [[34, 60], [24, 78]]) + `M${cx - 12} ${G - 78}Q${cx - 10} ${G - 96} ${cx} ${G - 104}Q${cx + 10} ${G - 96} ${cx + 12} ${G - 78}Z` + `M${cx - 0.8} ${G - 104}L${cx} ${G - 116}L${cx + 0.8} ${G - 104}Z`;
const oneWTC = (cx: number) => `M${cx - 18} ${G}V${G - 14}L${cx - 7} ${G - 100}H${cx + 7}L${cx + 18} ${G - 14}V${G}Z` + r(cx - 0.8, 1.6, 119);
const willis = (cx: number) => r(cx - 30, 60, 55) + r(cx - 22, 44, 78) + r(cx - 14, 28, 96) + r(cx - 14, 14, 103) + r(cx - 11, 2, 119) + r(cx + 1, 2, 117);
const hancock = (cx: number) => `M${cx - 22} ${G}L${cx - 14} ${G - 96}H${cx + 14}L${cx + 22} ${G}Z` + r(cx - 7, 2, 118) + r(cx + 5, 2, 118);
const trump = (cx: number) => steps(cx, [[30, 60], [24, 75], [18, 86], [12, 93]], 14);
const needle = (cx: number) =>
  `M${cx - 14} ${G}L${cx - 3} ${G - 80}H${cx + 3}L${cx + 14} ${G}H${cx + 10}L${cx} ${G - 60}L${cx - 10} ${G}Z` +
  `M${cx - 26} ${G - 84}L${cx + 26} ${G - 84}L${cx + 16} ${G - 92}H${cx - 16}Z` + r(cx - 10, 20, 96) + r(cx - 1, 2, 116);
const columbia = (cx: number) => steps(cx, [[34, 70], [26, 84], [18, 90]]);
const transamerica = (cx: number) =>
  `M${cx - 14} ${G}L${cx} ${G - 116}L${cx + 14} ${G}Z` + `M${cx - 9} ${G - 70}H${cx - 14}L${cx - 11} ${G - 55}Z M${cx + 9} ${G - 70}H${cx + 14}L${cx + 11} ${G - 55}Z`;
const salesforce = (cx: number) => `M${cx - 14} ${G}V${G - 90}Q${cx} ${G - 110} ${cx + 14} ${G - 90}V${G}Z`;
const gate = (x: number) => r(x, 4, 95) + r(x + 120, 4, 95) + r(x - 40, 210, 4);
const usbank = (cx: number) => steps(cx, [[28, 80], [22, 90], [16, 97], [10, 102]]);
const wilshire = (cx: number) => `M${cx - 14} ${G}V${G - 88}L${cx + 14} ${G - 100}V${G}Z` + `M${cx + 12} ${G - 100}L${cx + 14} ${G - 118}L${cx + 15} ${G - 99}Z`;
const palm = (x: number, h: number) =>
  `M${x - 1} ${G}Q${x + 2} ${G - h / 2} ${x} ${G - h}H${x + 2}Q${x + 4} ${G - h / 2} ${x + 1} ${G}Z` +
  `M${x + 1} ${G - h}Q${x - 10} ${G - h - 4} ${x - 14} ${G - h + 6}Q${x - 6} ${G - h - 1} ${x + 1} ${G - h}Q${x + 12} ${G - h - 4} ${x + 16} ${G - h + 6}Q${x + 8} ${G - h - 1} ${x + 1} ${G - h}Q${x - 2} ${G - h - 9} ${x - 8} ${G - h - 8}Q${x} ${G - h - 4} ${x + 1} ${G - h}Q${x + 6} ${G - h - 10} ${x + 12} ${G - h - 7}Q${x + 4} ${G - h - 3} ${x + 1} ${G - h}Z`;

// Extra detailed landmarks
const willis2 = (cx: number) =>
  r(cx - 24, 16, 70) + r(cx - 8, 16, 112) + r(cx + 8, 16, 88) + r(cx - 24, 16, 92) + r(cx - 8, 8, 112) +
  r(cx - 6, 2.2, 120) + r(cx + 3, 2.2, 120);
const hancock2 = (cx: number) =>
  `M${cx - 18} ${G}L${cx - 11} ${G - 100}H${cx + 11}L${cx + 18} ${G}Z` + r(cx - 12, 24, 102) +
  r(cx - 7, 2, 120) + r(cx + 5, 2, 120);
const trump2 = (cx: number) => steps(cx, [[26, 62], [22, 78], [16, 90], [11, 98]], 18);
const aon = (cx: number) => r(cx - 12, 24, 94);
const needle2 = (cx: number) =>
  // hourglass legs
  `M${cx - 12} ${G}L${cx - 2.5} ${G - 50}L${cx - 6} ${G - 84}H${cx - 3}L${cx} ${G - 60}L${cx + 3} ${G - 84}H${cx + 6}L${cx + 2.5} ${G - 50}L${cx + 12} ${G}H${cx + 8}L${cx} ${G - 40}L${cx - 8} ${G}Z` +
  // halo / saucer
  `M${cx - 22} ${G - 86}H${cx + 22}L${cx + 15} ${G - 92}H${cx - 15}Z` + `M${cx - 12} ${G - 92}H${cx + 12}L${cx + 8} ${G - 96}H${cx - 8}Z` +
  r(cx - 0.8, 1.6, 114) + r(cx - 18, 36, 6);
const columbia2 = (cx: number) => `M${cx - 14} ${G}V${G - 76}L${cx - 10} ${G - 84}V${G - 92}H${cx + 4}L${cx + 10} ${G - 86}L${cx + 14} ${G - 80}V${G}Z`;
const smith = (cx: number) => r(cx - 6, 12, 48) + `M${cx - 6} ${G - 48}L${cx} ${G - 66}L${cx + 6} ${G - 48}Z`;
const transamerica2 = (cx: number) =>
  `M${cx - 11} ${G}L${cx - 0.6} ${G - 104}L${cx} ${G - 118}L${cx + 0.6} ${G - 104}L${cx + 11} ${G}Z` +
  `M${cx - 6} ${G - 62}L${cx - 11} ${G - 62}L${cx - 6} ${G - 48}Z M${cx + 6} ${G - 62}L${cx + 11} ${G - 62}L${cx + 6} ${G - 48}Z`;
const salesforce2 = (cx: number) => `M${cx - 11} ${G}V${G - 92}Q${cx - 10} ${G - 106} ${cx} ${G - 108}Q${cx + 10} ${G - 106} ${cx + 11} ${G - 92}V${G}Z`;
const coit = (cx: number) => r(cx - 3, 6, 50) + r(cx - 4, 8, 34);
const gate2 = (x: number) => {
  const tower = (tx: number) => r(tx, 2.5, 100) + r(tx + 8, 2.5, 100) + r(tx, 10.5, 3).replace(`${G}V${G - 3}`, `${G - 70}V${G - 73}`) ;
  return tower(x + 40) + tower(x + 170) + `M${x - 30} ${G - 38}H${x + 260}V${G - 34}H${x - 30}Z` +
    r(x + 42, 8, 0) + r(x + 40, 11, 6) + r(x + 170, 11, 6);
};
const gateCables = (x: number) =>
  `M${x - 30} ${G - 40}Q${x + 5} ${G - 50} ${x + 45} ${G - 100}Q${x + 110} ${G - 30} ${x + 175} ${G - 100}Q${x + 215} ${G - 50} ${x + 260} ${G - 40}` +
  Array.from({ length: 15 }, (_, k) => { const px = x + 52 + k * 8; const t = (px - (x + 45)) / 130; const cy = G - 100 + 140 * t * (1 - t); return `M${px} ${cy}V${G - 38}`; }).join("");
const usbank2 = (cx: number) =>
  `M${cx - 12} ${G}V${G - 92}Q${cx} ${G - 98} ${cx + 12} ${G - 92}V${G}Z` + `M${cx - 9} ${G - 93}V${G - 100}Q${cx} ${G - 105} ${cx + 9} ${G - 100}V${G - 93}Z` + `M${cx - 5} ${G - 101}V${G - 106}H${cx + 5}V${G - 101}Z`;
const wilshire2 = (cx: number) => `M${cx - 12} ${G}V${G - 92}L${cx + 12} ${G - 100}V${G}Z` + `M${cx + 9} ${G - 99}L${cx + 12} ${G - 120}L${cx + 13} ${G - 100}Z`;
const aonLA = (cx: number) => `M${cx - 10} ${G}V${G - 80}Q${cx} ${G - 86} ${cx + 10} ${G - 80}V${G}Z`;
const griffith = (cx: number) => r(cx - 16, 32, 8).replace(`${G}V${G - 8}`, `${G - 30}V${G - 38}`) +
  `M${cx - 6} ${G - 38}A6 6 0 0 1 ${cx + 6} ${G - 38}Z M${cx - 16} ${G - 38}A3 3 0 0 1 ${cx - 10} ${G - 38}Z M${cx + 10} ${G - 38}A3 3 0 0 1 ${cx + 16} ${G - 38}Z`;

const empire2 = (cx: number) =>
  steps(cx, [[40, 46], [30, 64], [22, 80], [16, 86], [12, 90], [8, 94], [5, 99]]) + `M${cx - 2} ${G - 99}L${cx} ${G - 106}L${cx + 2} ${G - 99}Z` + r(cx - 0.7, 1.4, 120);
const chrysler2 = (cx: number) => {
  let d = steps(cx, [[30, 56], [20, 74]]);
  for (let k = 0; k < 5; k++) { const w = 10 - k * 1.8, b = 74 + k * 5; d += `M${cx - w} ${G - b}Q${cx - w} ${G - b - 6} ${cx} ${G - b - 7}Q${cx + w} ${G - b - 6} ${cx + w} ${G - b}Z`; }
  return d + `M${cx - 1.2} ${G - 100}L${cx} ${G - 118}L${cx + 1.2} ${G - 100}Z`;
};
const oneWTC2 = (cx: number) => `M${cx - 14} ${G}V${G - 16}L${cx - 9} ${G - 104}H${cx + 9}L${cx + 14} ${G - 16}V${G}Z` + r(cx - 3, 6, 107) + r(cx - 0.7, 1.4, 120);
const slim = (x: number, h: number) => r(x, 9, h);
const brooklyn = (x: number) => {
  const tower = (tx: number) => `M${tx} ${G}V${G - 70}H${tx + 16}V${G}H${tx + 12}V${G - 40}Q${tx + 10} ${G - 50} ${tx + 8} ${G - 50}Q${tx + 6} ${G - 50} ${tx + 4} ${G - 40}V${G}Z`;
  return tower(x + 40) + tower(x + 200) + `M${x - 60} ${G - 30}H${x + 320}V${G - 26}H${x - 60}Z`;
};
const brooklynCables = (x: number) =>
  `M${x - 60} ${G - 28}Q${x + 10} ${G - 40} ${x + 48} ${G - 70}Q${x + 128} ${G - 10} ${x + 208} ${G - 70}Q${x + 250} ${G - 40} ${x + 320} ${G - 28}` +
  `M${x + 48} ${G - 70}L${x + 110} ${G - 30}M${x + 48} ${G - 70}L${x + 90} ${G - 30}M${x + 208} ${G - 70}L${x + 146} ${G - 30}M${x + 208} ${G - 70}L${x + 166} ${G - 30}`;
const liberty = (cx: number) =>
  `M${cx - 14} ${G}V${G - 18}H${cx - 8}V${G - 34}H${cx + 8}V${G - 18}H${cx + 14}V${G}Z` +
  `M${cx - 5} ${G - 34}Q${cx - 6} ${G - 50} ${cx - 3} ${G - 62}Q${cx - 2} ${G - 66} ${cx} ${G - 66}Q${cx + 3} ${G - 66} ${cx + 3} ${G - 60}L${cx + 4} ${G - 64}L${cx + 4.5} ${G - 80}L${cx + 6} ${G - 80}L${cx + 5.5} ${G - 62}Q${cx + 6} ${G - 50} ${cx + 5} ${G - 34}Z` +
  `M${cx + 3} ${G - 80}H${cx + 7.5}L${cx + 5.2} ${G - 86}Z` + `M${cx - 3} ${G - 66}L${cx - 4} ${G - 70}L${cx - 1} ${G - 67}L${cx} ${G - 71}L${cx + 1} ${G - 67}L${cx + 4} ${G - 70}L${cx + 3} ${G - 66}Z`;

const willis3 = (cx: number) =>
  r(cx - 21, 14, 62) + r(cx + 7, 14, 76) + r(cx - 21, 14, 82).replace(/^/, "") + r(cx - 7, 14, 108) + r(cx + 7, 14, 92) + r(cx - 21, 7, 92) +
  r(cx - 5.5, 2.4, 120) + r(cx + 3.2, 2.4, 118);
const trump3 = (cx: number) => r(cx - 13, 26, 58) + r(cx - 11, 22, 74) + r(cx - 8, 16, 88) + r(cx - 5, 10, 96) + `M${cx - 1.2} ${G - 96}L${cx} ${G - 118}L${cx + 1.2} ${G - 96}Z`;
const hancock3 = (cx: number) => `M${cx - 16} ${G}L${cx - 10} ${G - 102}H${cx + 10}L${cx + 16} ${G}Z` + r(cx - 6, 1.8, 120) + r(cx + 4.2, 1.8, 120);
const hancockX = (cx: number) => {
  let d = "";
  for (let k = 0; k < 4; k++) { const y0 = G - 6 - k * 24, y1 = y0 - 22; const w0 = 15.5 - k * 1.4, w1 = w0 - 1.3;
    d += `M${cx - w0 + 3} ${y0}L${cx + w1 - 3} ${y1}M${cx + w0 - 3} ${y0}L${cx - w1 + 3} ${y1}`; }
  return d;
};
const marina = (cx: number) => {
  let d = `M${cx - 7} ${G}V${G - 52}Q${cx} ${G - 58} ${cx + 7} ${G - 52}V${G}Z`;
  return d;
};
const stregis = (cx: number) => `M${cx - 8} ${G}V${G - 80}Q${cx - 2} ${G - 92} ${cx + 4} ${G - 86}Q${cx + 9} ${G - 82} ${cx + 8} ${G - 76}V${G}Z`;
const wheel = (cx: number) => `M${cx - 2} ${G}L${cx} ${G - 38}L${cx + 2} ${G}Z M${cx - 12} ${G}L${cx} ${G - 38}L${cx - 9} ${G}Z M${cx + 12} ${G}L${cx} ${G - 38}L${cx + 9} ${G}Z` + r(cx - 60, 120, 6);
const wheelSpokes = (cx: number) => {
  const R = 30, cy = G - 38;
  let d = `M${cx - R} ${cy}A${R} ${R} 0 1 0 ${cx + R} ${cy}A${R} ${R} 0 1 0 ${cx - R} ${cy}`;
  for (let k = 0; k < 12; k++) { const a = (k * Math.PI) / 6; d += `M${cx} ${cy}L${(cx + R * Math.cos(a)).toFixed(1)} ${(cy + R * Math.sin(a)).toFixed(1)}`; }
  return d;
};

type City = { name: string; d: string; bg?: string; strokes?: string; cut?: string };
const CITIES: City[] = [
  { name: "New York City", d: filler(220, 1280, 7, 12, 40) + filler(-280, -40, 3, 4, 12) + empire2(420) + chrysler2(540) + oneWTC2(760) + slim(660, 116) + slim(860, 98) + r(600, 18, 72) + r(470, 20, 64) + r(810, 20, 68) + brooklyn(-20) + liberty(1080), strokes: brooklynCables(-20) },
  { name: "Chicago", d: filler(-280, 1280, 13, 10, 34) + marina(240) + marina(262) + willis3(420) + trump3(560) + aon(640) + hancock3(760) + stregis(500) + r(690, 16, 66) + r(820, 18, 58) + wheel(1000), strokes: wheelSpokes(1000), cut: hancockX(760) },
  {
    name: "Seattle",
    bg: "M600 120L760 62Q800 30 820 26Q840 30 860 46L960 80L1100 120Z",
    d: filler(-280, 1280, 21, 10, 34) + needle2(260) + columbia2(560) + smith(470) + r(510, 18, 70) + r(610, 18, 62) + r(640, 16, 74),
  },
  {
    name: "San Francisco",
    bg: "M-280 120Q-150 70 0 96Q120 60 260 100L340 120Z",
    d: filler(330, 1280, 33, 10, 38) + filler(-280, -40, 9, 4, 14) + transamerica2(560) + salesforce2(680) + coit(440) + r(610, 18, 78) + r(720, 18, 70) + r(500, 16, 58) + gate2(30),
    strokes: gateCables(30),
  },
  {
    name: "Los Angeles",
    bg: "M-280 120Q-120 50 60 80Q200 40 360 90Q520 60 700 96L1280 120Z",
    d: filler(-280, 1280, 41, 8, 30) + usbank2(560) + wilshire2(640) + aonLA(500) + r(600, 16, 70) + r(690, 18, 64) + griffith(160) +
      palm(-60, 66) + palm(20, 82) + palm(70, 60) + palm(880, 78) + palm(940, 62) + palm(1000, 88),
  },
];

export function Skyline() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % CITIES.length), 12000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="pointer-events-none relative h-20 w-full md:h-24" aria-hidden>
      {CITIES.map((c, n) => (
        <div key={c.name} className={`absolute inset-0 transition-opacity duration-[2000ms] ${n === i ? "opacity-100" : "opacity-0"}`}>
          <span className="absolute left-4 top-0 bg-background/80 px-2 text-xs font-semibold uppercase tracking-widest text-primary md:text-sm">{c.name}</span>
          <svg viewBox="-280 0 1560 120" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full">
            {c.bg && <path d={c.bg} className="fill-primary" fillOpacity={0.3} />}
            <path d={c.d} className="fill-primary" />
            {c.strokes && <path d={c.strokes} className="fill-none stroke-primary" strokeWidth={1.5} />}
            {c.cut && <path d={c.cut} className="fill-none stroke-background" strokeWidth={1.2} />}
          </svg>
        </div>
      ))}
    </div>
  );
}
