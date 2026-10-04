// Decorative skyline adapted from the user's LEXRENT Lovable project.
// It is illustration, not property or jurisdiction data.
const ground = 120;
const building = (x: number, width: number, height: number) => `M${x} ${ground}V${ground - height}H${x + width}V${ground}Z`;
function filler(start: number, end: number, seed: number) {
  let path = "", x = start, value = seed;
  const random = () => ((value = (value * 9301 + 49297) % 233280) / 233280);
  while (x < end) {
    const width = Math.min(12 + random() * 22, end - x);
    const height = 10 + random() * 28;
    path += building(x, width + .5, height);
    if (random() > .7) path += building(x + width / 2 - 1, 2, height + 6);
    x += width;
  }
  return path;
}
const tower = (x: number) => building(x, 2.5, 100) + building(x + 8, 2.5, 100);
const bridge = tower(70) + tower(200) + "M0 82H290V86H0Z";
const cables = "M0 80Q35 70 75 20Q140 90 205 20Q245 70 290 80" + Array.from({ length: 15 }, (_, index) => { const x = 82 + index * 8; const t = (x - 75) / 130; return `M${x} ${20 + 140 * t * (1 - t)}V82`; }).join("");
const landmarks = "M549 120L559.4 16L560 2L560.6 16L571 120Z" + "M669 120V28Q670 14 680 12Q690 14 691 28V120Z" + building(437, 6, 50) + building(436, 8, 34) + building(601, 18, 78) + building(720, 18, 70) + building(500, 16, 58);

export default function Skyline() {
  return <div className="lovable-skyline" aria-hidden="true"><span>CALIFORNIA · NEW JERSEY · MASSACHUSETTS</span><svg viewBox="-280 0 1560 120" preserveAspectRatio="xMidYMax slice"><path d="M-280 120Q-150 70 0 96Q120 60 260 100L340 120Z" fill="currentColor" opacity=".2"/><path d={filler(330, 1280, 33) + filler(-280, -40, 9) + landmarks + bridge} fill="currentColor"/><path d={cables} fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></div>;
}
