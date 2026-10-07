import { test } from "node:test";
import assert from "node:assert/strict";
import { contrastText, hexToOklch, surfaceTokens } from "./color.js";

test("palette tokens: hue extraction, readable text, and light/dark accent ink", () => {
  assert.ok(Math.abs(hexToOklch("#ffffff").l - 1) < 0.001);
  assert.ok(Math.abs(hexToOklch("#ff0000").h - 29.2) < 0.5);
  assert.equal(contrastText("#d6ffac"), "#010101");
  assert.equal(contrastText("#2f4f3a"), "#fefefe");

  const prefs = { accent: "#d6ffac", bg: "accent", tint: 50 };
  assert.match(surfaceTokens(prefs, false)["--accent-ink"], /^oklch\(0\.5/);
  assert.ok(
    Number(surfaceTokens(prefs, true)["--accent-ink"].match(/\(([\d.]+)/)[1]) >=
      0.72,
  );
  assert.equal(surfaceTokens({ ...prefs, bg: "neutral" }, false)["--k"], "0.5");
  assert.equal(
    surfaceTokens({ ...prefs, bg: "#bcd0ea", tint: 100 }, false)["--k"],
    "2",
  );
});
