// gta6-twitch-ccu-forecast-01 entry (Node 22, standard library only): a launch-day shape model. The persistence
// baseline is wrong for a launch twice over: launch days rise, and the size of the launch decides how much. Each
// comparable's 24-hour day shape is copied onto the case's hour-1 print, weighted by how close the comparable's own
// hour-1 print is to the case's, in log space.
//
// Shape. For each usable comparable (37 of the 38 in a package carry a full 24 hours on their own day_start day; the
// one that does not is GTA VI's own pre-release traffic from the August premiere, which is read as traffic, not a
// launch), take its hour-1 print p1_comp and its day shape ln(viewers_h / viewers_1) for h = 1..24. For the case we
// forecast a centre and a spread for each hour h = 2..24 from the comparables, weighted by
//
//   weight = exp(-0.5 * ((ln(p1_comp) - ln(p1_case)) / 1.1)^2)
//
//   centre = 0.8 * weighted median of shape_h  +  0.2 * ordinary least-squares fit of shape_h on ln(p1),
//            the fit unweighted over the usable comparables and evaluated at ln(p1_case)
//   spread = 0.85 * (weighted 95th percentile - weighted 5th percentile) / 3.29, floored at 0.2 after scaling
//
// and emit the quantiles q_tau(h) = exp(ln(p1_case) + centre + z_tau * spread), for z = -1.6449, -0.6745, 0,
// 0.6745, 1.6449, rounded to 2 decimals and forced non-decreasing.
//
// Verified facts (scratch under /tmp, from p00's comparables):
//   - 35 of the 37 usable comparables see hour 24 exceed hour 6 (day rises).
//   - Splitting the 37 on hour-1 viewers at 5,000: the small group's median (hour 24 / hour 1) is ~163x, the big
//     group's ~1.3x; at a 20,000 split the same two figures are ~99.5x and ~1.19x. Size decides growth, and the
//     exact ratio moves with the split point while the split itself does not.
//   - Across the 37 comparable launches, ln(hour 24 / hour 1) correlates at r = -0.931 with ln(hour 1 viewers). A
//     weighted median saturates: it can never output a shape more extreme than its largest neighbour, so a case
//     bigger than every comparable is stuck at the biggest comparable's shape. Blending in an unweighted least-
//     squares fit (above) lets the centre extrapolate, and loses less on the largest launches.
//
// Measured design choices (scratch under /tmp, leave-one-launch-out over the 37 launches):
//   - Spread asymmetry: the weighted upper half-width (p95 - median) runs wider than the lower (median - p05); the
//     leave-one-launch-out ratio of the summed half-widths across hours is ~1.39. A two-width version (separate
//     up/down sd, both floored at 0.2) was implemented and re-measured, but it raises every pinball figure, so it
//     is reverted here and the symmetric form is kept.
//   - Hour-1 viewers-per-channel vs day growth (hour 24 / hour 1): Pearson r = -0.153 on logs across the 37
//     comparables -> weak (|r| < 0.3), so no case-pull term is added; the centre is the weighted median blended
//     with the unweighted fit above.
//   - The spread scale is swept 0.70..1.10 (step 0.05) on the blended model: the leave-one-launch-out mean loss is
//     flat around 0.85-0.90 (0.3919 at 0.85, 0.3920 at 0.90, 0.3938 at 1.00), so 0.85 is shipped.
//
// Leave-one-launch-out over the 37 launches (pinball loss per hour and quantile, d = ln(y) - ln(q), loss =
// 2 * max(tau*d, (tau-1)*d)):
//   - Plain weighted median:  mean pinball 0.4064; median launch loss 0.2626.
//   - Blended model (this entry):  mean pinball 0.3938 at scale 1.0, 0.3919 at the shipped scale 0.85.
//   - House baseline q_tau(h) = p1 * exp(z_tau * 0.15 * sqrt(h-1)):  mean 0.9296; median 0.3249.
//   - Held-out launches with hour 1 >= 5,000 viewers:  blended model 0.2703 (n=29);  baseline 0.3595.
//   - The six largest launches (hour-1 >= 320,000) as a group, trained on the 31 smaller ones: plain median
//     0.2047, blended 0.1457, weighted-least-squares blend 0.1650; unweighted fit wins.
//   - Band calibration at the shipped scale 0.85 on held-out hour-forecasts:  85.3% fall inside the 5-95 interval.
//
// It runs offline, with no network, under the case's time cap: everything it knows is in the case file.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.6449, -0.6745, 0, 0.6745, 1.6449];
/** The log-distance kernel width, in log units of p1. */
const KERNEL = 1.1;
/** The spread floor, in log units, applied after scaling. */
const SPREAD_FLOOR = 0.2;
/** The z-interval width that maps to one standard deviation. */
const Z95_TO_SD = 3.29;
/** Multiplier on the raw spread (95th - 5th)/3.29, chosen by leave-one-launch-out sweep. */
const SPREAD_SCALE = 0.85;
/** Weight on the least-squares fit in the blended centre; the rest is the weighted median. */
const BLEND_ALPHA = 0.2;

interface Comparable {
  p1: number;
  shape: number[];
}

interface Case {
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Array<{
    day_start: string;
    hourly: Array<{ from: string; viewers: number }>;
  }>;
}

/** x rounded to 2 decimals (half up). */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Pull the usable comparables out of a case: full 24 hours on the day_start day. */
const usableComparables = (c: Case): Comparable[] => {
  const out: Comparable[] = [];
  for (const cb of c.comparables) {
    const start = new Date(cb.day_start).getTime();
    const rows = cb.hourly
      .filter((r) => {
        const t = new Date(r.from).getTime();
        return t >= start && t < start + 24 * 60 * 60 * 1000;
      })
      .sort((a, b) => new Date(a.from).getTime() - new Date(b.from).getTime());
    if (rows.length !== 24) continue;
    const p1 = rows[0].viewers > 0 ? rows[0].viewers : 1;
    out.push({ p1, shape: rows.map((r) => Math.log(Math.max(1, r.viewers) / p1)) });
  }
  return out;
};

/** Weighted quantile of a sorted-by-value list of {v, w} pairs. */
const weightedQuantile = (pairs: Array<{ v: number; w: number }>, tau: number): number => {
  pairs.sort((a, b) => a.v - b.v);
  const total = pairs.reduce((s, p) => s + p.w, 0);
  let cum = 0;
  for (const p of pairs) {
    cum += p.w;
    if (cum >= tau * total) return p.v;
  }
  return pairs[pairs.length - 1].v;
};

/** Unweighted ordinary least-squares prediction of shape_h at ln(p1_case). */
const fitShape = (usable: Comparable[], h: number, p1Case: number): number => {
  const idx = h - 1;
  let sx = 0, sy = 0;
  const n = usable.length;
  for (const u of usable) {
    sx += Math.log(u.p1);
    sy += u.shape[idx];
  }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0;
  for (const u of usable) {
    const x = Math.log(u.p1) - mx;
    sxx += x * x;
    sxy += x * (u.shape[idx] - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return my - slope * mx + slope * Math.log(p1Case);
};

/** Centre and spread of hour h (2..24) over the comparables for a case's p1. */
const hourCentreSpread = (usable: Comparable[], h: number, p1Case: number): { centre: number; spread: number } => {
  const idx = h - 1;
  const pairs = usable.map((u) => ({
    v: u.shape[idx],
    w: Math.exp(-0.5 * Math.pow((Math.log(u.p1) - Math.log(p1Case)) / KERNEL, 2)),
  }));
  const medianCentre = weightedQuantile(pairs.map((p) => ({ ...p })), 0.5);
  const centre = (1 - BLEND_ALPHA) * medianCentre + BLEND_ALPHA * fitShape(usable, h, p1Case);
  const p95 = weightedQuantile(pairs.map((p) => ({ ...p })), 0.95);
  const p05 = weightedQuantile(pairs.map((p) => ({ ...p })), 0.05);
  let spread = ((p95 - p05) / Z95_TO_SD) * SPREAD_SCALE;
  if (spread < SPREAD_FLOOR) spread = SPREAD_FLOOR;
  return { centre, spread };
};

/** The five quantiles of one hour h for a case. */
const hourQuantiles = (usable: Comparable[], h: number, p1Case: number): number[] => {
  const { centre, spread } = hourCentreSpread(usable, h, p1Case);
  const q = Z.map((z) => round2(Math.exp(Math.log(p1Case) + centre + z * spread)));
  for (let i = 1; i < q.length; i++) if (q[i] < q[i - 1]) q[i] = q[i - 1];
  return q;
};

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error(`${file} has no hour-1 print`);
  const p1 = Math.max(1, first.viewers);
  const usable = usableComparables(c);
  const hours = c.forecast.map(({ hour }) => ({ hour, q: hourQuantiles(usable, hour, p1) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
