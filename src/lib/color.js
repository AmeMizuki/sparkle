const toLinear = (v) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const channels = (hex) =>
  hex
    .slice(1)
    .match(/../g)
    .map((n) => toLinear(parseInt(n, 16) / 255));

export const isHex = (value) => /^#[a-f\d]{6}$/i.test(value);

export function hexToOklch(hex) {
  const [r, g, b] = channels(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const c = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: Math.hypot(a, c),
    h: ((Math.atan2(c, a) * 180) / Math.PI + 360) % 360,
  };
}

/** Readable text colour on a filled accent (the higher-contrast of near-black / near-white). */
export function contrastText(hex) {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#010101" : "#fefefe";
}

/**
 * CSS custom properties derived from the user's palette.
 * --h/--k tint every neutral surface; --accent-ink is the accent re-lit to read as text
 * on the current surfaces (>= 4.5:1 light, >= 7:1 dark).
 */
export function surfaceTokens({ accent, bg, tint }, dark) {
  const ink = hexToOklch(accent);
  const hue =
    bg === "neutral"
      ? { h: 250, k: 0.5 }
      : { h: hexToOklch(bg === "accent" ? accent : bg).h, k: tint / 50 };
  const lightness = dark ? Math.max(ink.l, 0.72) : Math.min(ink.l, 0.5);
  return {
    "--primary": accent,
    "--primary-foreground": contrastText(accent),
    "--accent-ink": `oklch(${lightness.toFixed(3)} ${ink.c.toFixed(3)} ${ink.h.toFixed(1)})`,
    "--h": hue.h.toFixed(1),
    "--k": String(hue.k),
  };
}
