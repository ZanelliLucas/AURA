// Moteur d'analyse AURA ANALYTICS (§5.5). Fonctions statistiques pures,
// sans dependance : faciles a verifier independamment de toute source
// de donnees reelle.

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values, avg = mean(values)) {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function stats(values) {
  if (!values.length) return { count: 0, mean: null, stdDev: null, min: null, max: null };
  const avg = mean(values);
  return {
    count: values.length,
    mean: round2(avg),
    stdDev: round2(stdDev(values, avg)),
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

// Detection d'ecarts par rapport aux habitudes enregistrees (§5.7, §5.5) :
// z-score, plus robuste qu'un simple seuil fixe car adapte a l'historique
// reel de la machine plutot qu'a une valeur arbitraire universelle.
function detectAnomalies(samples, key, zThreshold = 2.5) {
  const values = samples.map((s) => s[key]).filter((v) => typeof v === 'number');
  if (values.length < 8) return [];
  const avg = mean(values);
  const sd = stdDev(values, avg);
  if (sd === 0) return [];
  return samples
    .filter((s) => typeof s[key] === 'number' && Math.abs(s[key] - avg) / sd >= zThreshold)
    .map((s) => ({ at: s.at, value: s[key], zScore: round2((s[key] - avg) / sd) }));
}

// Regression lineaire simple (moindres carres) : tendance + R² (mesure
// de confiance dans l'ajustement, jamais presentee comme une certitude).
function linearRegression(values) {
  const n = values.length;
  if (n < 2) return null;
  const xs = values.map((_, i) => i);
  const xMean = mean(xs);
  const yMean = mean(values);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (values[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;

  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * xs[i] + intercept;
    ssRes += (values[i] - predicted) ** 2;
    ssTot += (values[i] - yMean) ** 2;
  }
  const rSquared = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);

  return { slope, intercept, rSquared };
}

function trend(values) {
  const reg = linearRegression(values);
  if (!reg) return { direction: 'stable', slope: 0, confidence: 0 };
  const direction = Math.abs(reg.slope) < 0.01 ? 'stable' : reg.slope > 0 ? 'hausse' : 'baisse';
  return { direction, slope: round2(reg.slope), confidence: round2(reg.rSquared) };
}

// Previsions probabilistes avec niveau de confiance (§5.5) - la confiance
// vient du R² de l'ajustement lineaire, jamais presentee comme certaine.
function forecast(values, stepsAhead = 1) {
  const reg = linearRegression(values);
  if (!reg) return null;
  const predictedValue = round2(reg.slope * (values.length - 1 + stepsAhead) + reg.intercept);
  return { predictedValue, confidence: round2(reg.rSquared) };
}

// Correlation de Pearson entre deux series de meme longueur.
function correlate(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const av = a.slice(-n), bv = b.slice(-n);
  const aMean = mean(av), bMean = mean(bv);
  let num = 0, aDen = 0, bDen = 0;
  for (let i = 0; i < n; i++) {
    num += (av[i] - aMean) * (bv[i] - bMean);
    aDen += (av[i] - aMean) ** 2;
    bDen += (bv[i] - bMean) ** 2;
  }
  const denom = Math.sqrt(aDen * bDen);
  return denom === 0 ? 0 : round2(num / denom);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { stats, detectAnomalies, trend, forecast, correlate };
