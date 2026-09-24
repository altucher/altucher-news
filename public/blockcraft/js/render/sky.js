// STUB — CPU sky model (real implementation replaces this).
// computeSkyState(dayFraction, sunDir, rain) → see ARCHITECTURE.md / renderer.js _fillFrame.

export function computeSkyState(dayFraction, sunDir, rain) {
  const sunUp = sunDir[1];
  const daylight = Math.max(0, Math.min(1, sunUp * 4 + 0.2));
  const lightIsSun = sunUp > -0.05;
  const lightDir = lightIsSun ? sunDir.slice() : [-sunDir[0], -sunDir[1], -sunDir[2]];
  const lightColor = lightIsSun ? [3 * daylight, 2.8 * daylight, 2.5 * daylight] : [0.05, 0.07, 0.12];
  return {
    lightDir,
    lightIsSun,
    lightColor,
    skyAmbient: [0.35 * daylight + 0.01, 0.45 * daylight + 0.015, 0.7 * daylight + 0.03],
    fogColor: [0.6 * daylight, 0.7 * daylight, 0.9 * daylight],
    fogDensity: 0.002,
    daylight,
    night: 1 - daylight,
    sunset: 0,
    moonBrightness: 1 - daylight,
    moonPhase: 0,
    cloudCoverage: 0.45,
  };
}
