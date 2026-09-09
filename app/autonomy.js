// AURA AUTONOMY (§5.9). Moteur de regles minimal : declencheurs horaire/
// intervalle/seuil, actions limitees a un ensemble deja "sur" (lecture ou
// reversible - §14.1) reutilisant des fonctions existantes plutot que
// d'en reimplementer. Aucune action sensible/irreversible n'est
// automatisable ici : c'est la forme la plus honnete d'"escalade vers
// l'utilisateur" tant qu'aucune vraie file d'approbation n'existe.
// Ne tourne que pendant la session (F-22, verifie via main.js).
const { Notification } = require('electron');
const store = require('./store');
const productivity = require('./productivity');
const sysinfo = require('./connectors/systemMonitor');

const THRESHOLD_COOLDOWN_MS = 10 * 60 * 1000;
const DAILY_WINDOW_MS = 60 * 1000;

let estopped = false;

// Arret d'urgence global (§5.9, §22) : quand actif, aucune regle ne peut
// se declencher, quel que soit son mode.
function setEstop(active) {
  estopped = !!active;
  store.logAction({
    typeAction: 'autonomy.estop', sensibilite: 'lecture', statut: 'execute',
    details: { active: estopped }
  });
  return { active: estopped };
}

function getEstop() {
  return { active: estopped };
}

function metricValue(snapshot, metric) {
  if (metric === 'cpu') return snapshot.cpu.loadPercent;
  if (metric === 'ram') return snapshot.memory.usedPercent;
  if (metric === 'gpu') return snapshot.gpu[0]?.loadPercent ?? null;
  return null;
}

function shouldFireInterval(rule, now) {
  const minutes = Number(rule.trigger.minutes) || 30;
  if (!rule.lastRunAt) return true;
  return now - new Date(rule.lastRunAt).getTime() >= minutes * 60000;
}

function shouldFireDaily(rule, now) {
  const [h, m] = (rule.trigger.time || '00:00').split(':').map(Number);
  const nowDate = new Date(now);
  const scheduled = new Date(nowDate);
  scheduled.setHours(h, m, 0, 0);
  const diff = nowDate - scheduled;
  if (diff < 0 || diff > DAILY_WINDOW_MS) return false;
  if (rule.lastRunAt && new Date(rule.lastRunAt).toDateString() === nowDate.toDateString()) return false;
  return true;
}

function shouldFireThreshold(rule, snapshot, now) {
  if (!snapshot) return false;
  const current = metricValue(snapshot, rule.trigger.metric);
  if (current === null) return false;
  const target = Number(rule.trigger.value);
  const crossed = rule.trigger.operator === 'below' ? current <= target : current >= target;
  if (!crossed) return false;
  if (rule.lastRunAt && now - new Date(rule.lastRunAt).getTime() < THRESHOLD_COOLDOWN_MS) return false;
  return true;
}

// Actions volontairement limitees a un ensemble deja "sur" (§14.1) :
// reutilisent des fonctions existantes, n'en inventent pas de nouvelles.
async function executeAction(rule, snapshot) {
  const { type, params = {} } = rule.action;
  if (type === 'notify') {
    new Notification({ title: 'AURA AUTONOMY', body: params.message || rule.name }).show();
    return `Notification envoyée : "${params.message || rule.name}"`;
  }
  if (type === 'task.create') {
    const task = productivity.taskCreate({ title: params.title || rule.name, priority: 'moyenne' });
    return `Tâche créée : "${task.title}"`;
  }
  if (type === 'system.snapshot') {
    const snap = snapshot || await sysinfo.getSnapshot();
    return `Instantané système : CPU ${snap.cpu.loadPercent}% · RAM ${snap.memory.usedPercent}%`;
  }
  throw new Error(`Action inconnue : ${type}`);
}

// task.schedule (§15) : evalue tous les declencheurs actifs et execute
// (ou simule) l'action correspondante. Appele periodiquement par
// main.js pendant la session.
async function tick() {
  if (estopped) return;

  const rules = store.getRules().filter((r) => r.enabled);
  if (!rules.length) return;

  const needsSnapshot = rules.some((r) => r.trigger.type === 'threshold' || r.action.type === 'system.snapshot');
  let snapshot = null;
  if (needsSnapshot) {
    try { snapshot = await sysinfo.getSnapshot(); } catch { /* pas grave, les regles seuil ne se declencheront pas ce tour */ }
  }

  const now = Date.now();
  for (const rule of rules) {
    let fired = false;
    if (rule.trigger.type === 'interval') fired = shouldFireInterval(rule, now);
    else if (rule.trigger.type === 'daily') fired = shouldFireDaily(rule, now);
    else if (rule.trigger.type === 'threshold') fired = shouldFireThreshold(rule, snapshot, now);

    if (!fired) continue;
    store.markRuleRun(rule.id);

    if (rule.mode === 'simulation') {
      store.logAction({
        typeAction: 'autonomy.simulation', sensibilite: 'lecture', statut: 'execute',
        details: { ruleId: rule.id, name: rule.name, aurait_execute: rule.action }
      });
      continue;
    }

    try {
      const summary = await executeAction(rule, snapshot);
      store.logAction({
        typeAction: 'autonomy.rule_fired', sensibilite: 'reversible', statut: 'execute',
        details: { ruleId: rule.id, name: rule.name, summary }
      });
    } catch (err) {
      store.logAction({
        typeAction: 'autonomy.rule_fired', sensibilite: 'reversible', statut: 'echoue',
        details: { ruleId: rule.id, name: rule.name, error: err.message }
      });
    }
  }
}

module.exports = {
  setEstop,
  getEstop,
  tick
};
