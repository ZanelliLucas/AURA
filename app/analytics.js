// AURA ANALYTICS (§5.5). Fusionne des donnees issues de plusieurs
// connecteurs deja reels (SYSTEM MONITOR, Productivite, journal
// d'actions) - jamais de donnees inventees. Toute prevision reste
// accompagnee d'un niveau de confiance et n'est jamais presentee comme
// une certitude (§5.5, principe explicite du cahier des charges).
const store = require('./store');
const math = require('./connectors/analytics');

function round1(n) {
  return n === null || n === undefined ? null : Math.round(n * 10) / 10;
}

function metricSeries(history, key) {
  return history.map((h) => h[key]).filter((v) => typeof v === 'number');
}

// analytics.query (§15, Lecture)
function summary() {
  const history = store.getMetricHistory();
  const cpuValues = metricSeries(history, 'cpuPercent');
  const ramValues = metricSeries(history, 'ramPercent');
  const gpuValues = metricSeries(history, 'gpuPercent');

  const tasks = store.getTasks();
  const completed = tasks.filter((t) => t.status === 'completed');

  const journal = store.getJournal(500);
  const byType = {};
  let failures = 0;
  journal.forEach((e) => {
    byType[e.typeAction] = (byType[e.typeAction] || 0) + 1;
    if (e.statut === 'echoue') failures++;
  });

  store.logAction({
    typeAction: 'analytics.query', sensibilite: 'lecture', statut: 'execute',
    details: { sampleCount: history.length }
  });

  return {
    system: {
      sampleCount: history.length,
      cpu: cpuValues.length ? { ...math.stats(cpuValues), trend: math.trend(cpuValues) } : null,
      ram: ramValues.length ? { ...math.stats(ramValues), trend: math.trend(ramValues) } : null,
      gpu: gpuValues.length ? { ...math.stats(gpuValues), trend: math.trend(gpuValues) } : null,
      cpuGpuCorrelation: (cpuValues.length >= 3 && gpuValues.length >= 3) ? math.correlate(cpuValues, gpuValues) : null
    },
    productivity: {
      totalTasks: tasks.length,
      completedTasks: completed.length,
      completionRatePercent: tasks.length ? round1((completed.length / tasks.length) * 100) : null
    },
    journal: {
      totalActions: journal.length,
      failureRatePercent: journal.length ? round1((failures / journal.length) * 100) : null,
      byType
    }
  };
}

// analytics.detect_anomaly (§15, Lecture) - traçabilite de la provenance
// des donnees : chaque anomalie renvoie l'horodatage exact de l'echantillon.
function anomalies() {
  const history = store.getMetricHistory();
  const result = {
    cpu: math.detectAnomalies(history, 'cpuPercent'),
    ram: math.detectAnomalies(history, 'ramPercent'),
    gpu: math.detectAnomalies(history, 'gpuPercent')
  };
  const found = result.cpu.length + result.ram.length + result.gpu.length;
  store.logAction({
    typeAction: 'analytics.detect_anomaly', sensibilite: 'lecture', statut: 'execute',
    details: { found, sampleCount: history.length }
  });
  return result;
}

const MIN_SAMPLES_FOR_FORECAST = 8;

// analytics.forecast (§15, Lecture) - le resultat porte toujours un
// niveau de confiance ; ne jamais l'afficher comme une certitude (§5.5).
function forecastMetric(metric, stepsAhead) {
  const key = `${metric}Percent`;
  const history = store.getMetricHistory();
  const values = metricSeries(history, key);
  if (values.length < MIN_SAMPLES_FOR_FORECAST) {
    throw new Error(`Historique insuffisant pour une prévision (${values.length}/${MIN_SAMPLES_FOR_FORECAST} échantillons).`);
  }
  const result = math.forecast(values, stepsAhead);
  const prediction = store.createPrediction({
    metric,
    sourceCount: values.length,
    predictedValue: result.predictedValue,
    confidence: result.confidence,
    horizon: stepsAhead
  });
  store.logAction({
    typeAction: 'analytics.forecast', sensibilite: 'lecture', statut: 'execute',
    details: { metric, predictedValue: result.predictedValue, confidence: result.confidence }
  });
  return prediction;
}

module.exports = {
  summary,
  anomalies,
  forecastMetric,
  getPredictions: store.getPredictions
};
