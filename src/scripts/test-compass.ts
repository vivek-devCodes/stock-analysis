import { accuracy, buildCompass, compassAgainst, fairPremiumPct, grade, type CompassInputs } from "../lib/compass/core";
import { currentCompass, giftNifty } from "../lib/compass/fetch";

// npm run test:compass — the 9 AM pre-market checklist: synthetic mornings with known answers, then live data.

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
};

const base: CompassInputs = {
  asOf: "2026-11-26T03:00:00.000Z", // 08:30 IST
  us: { dow: 0, nasdaq: 0, sp: 0, closedAt: null },
  usFutures: { dow: 0, nasdaq: 0 },
  asia: { nikkei: 0, hangSeng: 0 },
  gift: null,
  niftyClose: 25_000,
  preOpen: null,
  prevBreadth: null,
  vix: { level: 13, changePct: 0 },
};
// A GIFT price that shows `gapPct` after the normal carry for a contract expiring in ~33 days.
const giftAt = (gapPct: number) => ({ price: 25_000 * (1 + (gapPct + fairPremiumPct(33.3)) / 100), changePct: gapPct, at: null, expiry: "2026-12-29" });

{
  const bull = buildCompass({ ...base, us: { dow: 1.2, nasdaq: 1.6, sp: 1.3, closedAt: null }, usFutures: { dow: 0.3, nasdaq: 0.5 }, asia: { nikkei: 1, hangSeng: 0.8 }, gift: giftAt(0.6), prevBreadth: { advances: 1800, declines: 900 } });
  check("green US close + GIFT premium + Asia up → gap-up", bull.bias === "gap-up" && (bull.score ?? 0) >= 50, `${bull.bias} ${bull.score}`);
  check("expected gap is GIFT's premium after carry", Math.abs((bull.expectedGapPct ?? 0) - 0.6) < 0.02, String(bull.expectedGapPct?.toFixed(3)));

  const bear = buildCompass({ ...base, us: { dow: -1.5, nasdaq: -2, sp: -1.7, closedAt: null }, usFutures: { dow: -0.4, nasdaq: -0.6 }, asia: { nikkei: -1.2, hangSeng: -1.5 }, gift: giftAt(-0.7), preOpen: { advances: 8, declines: 42, indexChangePct: -0.6 } });
  check("red US close + GIFT discount + pre-open declines → gap-down", bear.bias === "gap-down", `${bear.bias} ${bear.score}`);
  check("pre-open A/D used when available", bear.checks.some((c) => c.id === "pre-open" && c.tone === "bearish"));

  const mixed = buildCompass({ ...base, us: { dow: 0.6, nasdaq: -0.5, sp: 0.1, closedAt: null }, gift: giftAt(0.02) });
  check("mixed cues → flat", mixed.bias === "flat", `${mixed.bias} ${mixed.score}`);

  // Carry: a GIFT price exactly at fair value is NOT a bullish signal.
  const fair = buildCompass({ ...base, gift: giftAt(0) });
  check("GIFT at fair carry premium reads neutral, not bullish", Math.abs(fair.expectedGapPct ?? 9) < 0.02 && fair.checks.find((c) => c.id === "gift")?.tone === "neutral", `${fair.expectedGapPct?.toFixed(3)}%`);
  check("fair premium ≈ 0.47% for 33 days", Math.abs(fairPremiumPct(33) - 0.47) < 0.01, fairPremiumPct(33).toFixed(3));

  check("VIX ≥ 15 → volatile", buildCompass({ ...base, vix: { level: 17.7, changePct: 13 } }).volatility === "volatile");
  check("VIX < 15 → calm", buildCompass({ ...base, vix: { level: 12.4, changePct: -2 } }).volatility === "calm");
  check("playbook advice is given", bull.playbook.length > 0 && bear.playbook.length > 0);

  const empty = buildCompass({ ...base, us: { dow: null, nasdaq: null, sp: null, closedAt: null }, usFutures: { dow: null, nasdaq: null }, asia: { nikkei: null, hangSeng: null }, niftyClose: null, vix: null });
  check("no data → unknown, not a guess", empty.bias === "unknown" && empty.score === null);

  check("compass against a long on a gap-down morning", compassAgainst(bear, "long") >= 0.5 && compassAgainst(bear, "short") === 0);
  check("compass neutral on a flat morning", compassAgainst(mixed, "long") === 0);
}

{
  const up = grade("2026-11-20", 60, 25_000, 25_150, 25_200);
  const wrong = grade("2026-11-21", -40, 25_000, 25_100, 25_250);
  const flat = grade("2026-11-24", 5, 25_000, 25_010, 24_900);
  check("grading: correct gap-up call", up.gapRight === true && up.dayRight === true);
  check("grading: wrong bearish call", wrong.gapRight === false && wrong.dayRight === false);
  check("grading: flat calls are not counted", flat.gapRight === null);
  const a = accuracy([up, wrong, flat]);
  check("accuracy over directional calls only", a.calls === 2 && a.gapHit === 0.5, JSON.stringify(a));
}

(async () => {
  try {
    const g = await giftNifty();
    check("live: GIFT Nifty from NSE IX", g != null && g.price > 10_000 && g.expiry != null, g ? `${g.price} exp ${g.expiry} (${g.changePct}%)` : "none");
    const { compass, tiles } = await currentCompass(true);
    check("live: compass built with most inputs", compass.coverage >= 0.6, `coverage ${Math.round(compass.coverage * 100)}%`);
    console.log(`      ${compass.biasText} (score ${compass.score}) · expected gap ${compass.expectedGapPct?.toFixed(2)}% · ${compass.volatilityText}`);
    for (const c of compass.checks) console.log(`      ${c.tone.padEnd(8)} ${c.label}: ${c.reading}`);
    check("live: global market tiles", tiles.filter((t) => t.price != null).length >= 12, `${tiles.filter((t) => t.price != null).length} of ${tiles.length}`);
  } catch (e) {
    console.log(`SKIP  live: ${e instanceof Error ? e.message : e}`);
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})();
