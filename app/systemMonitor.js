// AURA SYSTEM MONITOR (§5.7). Uniquement de l'observation (niveau
// OBSERVE, §14.2) : aucune action, jamais de confirmation necessaire.
const core = require('./core');
const store = require('./store');
const sysinfo = require('./connectors/systemMonitor');

const DEFAULT_THRESHOLDS = { cpuPercent: 90, ramPercent: 90, diskPercent: 90 };
const THRESHOLD_KEYS = Object.keys(DEFAULT_THRESHOLDS);

function getThresholds() {
  const config = core.loadConfig();
  return { ...DEFAULT_THRESHOLDS, ...(config.systemThresholds || {}) };
}

function setThreshold(key, value) {
  if (!THRESHOLD_KEYS.includes(key)) throw new Error(`Seuil inconnu : ${key}.`);
  const config = core.loadConfig();
  config.systemThresholds = { ...getThresholds(), [key]: Number(value) };
  core.saveConfig(config);
  return config.systemThresholds;
}

// Detection d'ecarts par rapport aux seuils configures (§5.7). Version
// simple par seuil fixe ; une vraie "detection d'ecarts par rapport aux
// habitudes enregistrees" demanderait un historique statistique - a
// affiner plus tard (AURA ANALYTICS) sans changer cette interface.
function checkThresholds(snapshot) {
  const thresholds = getThresholds();
  const created = [];

  if (snapshot.cpu.loadPercent >= thresholds.cpuPercent) {
    created.push(store.createAlert({
      level: 'warning',
      cause: `CPU à ${snapshot.cpu.loadPercent}% (seuil ${thresholds.cpuPercent}%)`
    }));
  }
  if (snapshot.memory.usedPercent >= thresholds.ramPercent) {
    created.push(store.createAlert({
      level: 'warning',
      cause: `RAM à ${snapshot.memory.usedPercent}% (seuil ${thresholds.ramPercent}%)`
    }));
  }
  snapshot.disks.forEach((d) => {
    if (d.usedPercent >= thresholds.diskPercent) {
      created.push(store.createAlert({
        level: 'warning',
        cause: `Disque ${d.mount} à ${d.usedPercent}% (seuil ${thresholds.diskPercent}%)`
      }));
    }
  });

  if (created.length) {
    store.logAction({
      typeAction: 'system.metrics', sensibilite: 'lecture', statut: 'execute',
      details: { alerts: created.length }
    });
  }

  return created;
}

async function snapshot() {
  const snap = await sysinfo.getSnapshot();
  const newAlerts = checkThresholds(snap);
  return { snapshot: snap, newAlerts };
}

module.exports = {
  snapshot,
  getThresholds,
  setThreshold,
  getAlerts: store.getAlerts,
  acknowledgeAlert: store.acknowledgeAlert
};
