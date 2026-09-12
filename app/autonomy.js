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
const security = require('./security');

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

const TRIGGER_TYPES = ['interval', 'daily', 'threshold'];
const ACTION_TYPES = ['notify', 'task.create', 'system.snapshot', 'security.scan'];

function validateTrigger(trigger) {
  if (!trigger || !TRIGGER_TYPES.includes(trigger.type)) return 'Type de déclencheur invalide.';
  if (trigger.type === 'interval') {
    if (!(Number(trigger.minutes) > 0)) return 'Intervalle invalide (minutes > 0 attendu).';
  } else if (trigger.type === 'daily') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trigger.time || '')) return 'Heure invalide (format HH:MM attendu).';
  } else if (trigger.type === 'threshold') {
    if (!['cpu', 'ram', 'gpu'].includes(trigger.metric)) return 'Métrique invalide.';
    if (!['below', 'above'].includes(trigger.operator)) return 'Opérateur invalide.';
    if (!(Number(trigger.value) >= 0)) return 'Seuil invalide.';
  }
  return null;
}

function validateAction(action) {
  if (!action || !ACTION_TYPES.includes(action.type)) return 'Type d\'action invalide.';
  const params = action.params || {};
  if (action.type === 'notify' && !(params.message && params.message.trim())) return 'Message de notification manquant.';
  if (action.type === 'task.create' && !(params.title && params.title.trim())) return 'Titre de tâche manquant.';
  if (action.type === 'security.scan' && !(params.path && params.path.trim())) return 'Dossier à analyser manquant.';
  return null;
}

// rule.create (§5.9, Reversible) : la regle elle-meme ne fait rien tant
// que tick() ne l'evalue pas - creer une regle est donc une action
// reversible, meme si son action associee (une fois declenchee) ne
// l'est pas forcement au meme degre (§14.1, deja restreint a
// notify/task.create/system.snapshot).
function ruleCreate({ name, enabled, mode, trigger, action }) {
  const error = (!name || !name.trim()) ? 'Nom de règle manquant.' : (validateTrigger(trigger) || validateAction(action));
  if (error) {
    store.logAction({
      typeAction: 'rule.create', sensibilite: 'reversible', statut: 'echoue',
      details: { error }
    });
    throw new Error(error);
  }
  const rule = store.createRule({ name: name.trim(), enabled, mode, trigger, action });
  store.logAction({
    typeAction: 'rule.create', sensibilite: 'reversible', statut: 'execute',
    details: { id: rule.id, name: rule.name, trigger: rule.trigger, action: rule.action }
  });
  return rule;
}

function ruleDelete(id) {
  return store.deleteRule(id);
}

// rule.update (§16, idee "modifier une regle existante") : meme
// validation que ruleCreate, mais ne touche pas enabled - deja gere
// separement par ruleSetEnabled (case a cocher de la ligne).
function ruleUpdate(id, { name, mode, trigger, action }) {
  const error = (!name || !name.trim()) ? 'Nom de règle manquant.' : (validateTrigger(trigger) || validateAction(action));
  if (error) {
    store.logAction({
      typeAction: 'rule.update', sensibilite: 'reversible', statut: 'echoue',
      details: { id, error }
    });
    throw new Error(error);
  }
  const rule = store.updateRule(id, { name: name.trim(), mode, trigger, action });
  store.logAction({
    typeAction: 'rule.update', sensibilite: 'reversible', statut: 'execute',
    details: { id: rule.id, name: rule.name, trigger: rule.trigger, action: rule.action }
  });
  return rule;
}

function ruleSetEnabled(id, enabled) {
  const rule = store.setRuleEnabled(id, enabled);
  store.logAction({
    typeAction: 'rule.toggle', sensibilite: 'reversible', statut: 'execute',
    details: { id: rule.id, name: rule.name, enabled: rule.enabled }
  });
  return rule;
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
  if (type === 'security.scan') {
    // scanSecrets est en lecture seule (security.js, §14.2) : peut
    // s'executer directement, comme system.snapshot, sans que ca outrepasse
    // la restriction "actions deja sures" des regles AUTONOMY (§14.1).
    const resultat = await security.scanSecrets(params.path);
    const detail = resultat.nouveaux ? ` dont ${resultat.nouveaux} nouveau(x)` : '';
    return `Scan de sécurité sur "${params.path}" : ${resultat.resultats.length} résultat(s)${detail}`;
  }
  throw new Error(`Action inconnue : ${type}`);
}

// Simule ou execute reellement une regle deja jugee "a declencher"
// (par tick() ou par un test manuel, ruleRunNow) - marque son heure de
// derniere execution et journalise dans les deux cas, factorise pour
// que les deux appelants restent strictement coherents.
async function fireRule(rule, snapshot) {
  store.markRuleRun(rule.id);

  if (rule.mode === 'simulation') {
    store.logAction({
      typeAction: 'autonomy.simulation', sensibilite: 'lecture', statut: 'execute',
      details: { ruleId: rule.id, name: rule.name, aurait_execute: rule.action }
    });
    return;
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
    await fireRule(rule, snapshot);
  }
}

// Declenchement manuel depuis l'ecran AURA AUTONOMY ("Tester maintenant",
// §16) : ignore le declencheur (interval/daily/threshold) et l'etat
// active/inactive de la regle - seul l'arret d'urgence reste respecte,
// une regle testee doit se comporter exactement comme si elle avait
// declenche naturellement (meme mode simulation/live, meme journalisation).
async function ruleRunNow(id) {
  if (estopped) throw new Error('Arrêt d\'urgence actif : aucune règle ne peut s\'exécuter.');
  const rule = store.getRules().find((r) => r.id === id);
  if (!rule) throw new Error('Règle introuvable.');

  let snapshot = null;
  if (rule.trigger.type === 'threshold' || rule.action.type === 'system.snapshot') {
    try { snapshot = await sysinfo.getSnapshot(); } catch { /* system.snapshot retentera elle-meme si besoin */ }
  }

  await fireRule(rule, snapshot);
  return store.getRules().find((r) => r.id === id);
}

module.exports = {
  setEstop,
  getEstop,
  getRules: store.getRules,
  ruleCreate,
  ruleDelete,
  ruleSetEnabled,
  ruleUpdate,
  ruleRunNow,
  tick
};
