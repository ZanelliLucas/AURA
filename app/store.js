// Memory Layer minimale (§12) : preferences, interactions, journal
// d'actions. Stockage JSON simple dans le dossier utilisateur - pas de
// node:sqlite (absent du Node 20.18 embarque par Electron 32, le module
// n'existe qu'a partir de Node 22.5) ni de dependance native pour
// l'instant. A migrer vers une vraie base si le volume le justifie un
// jour ; l'API de ce module (get/set/append) ne devrait pas changer.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_JOURNAL = 500;
const MAX_INTERACTIONS = 200;

function storeDir() {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function filePath(name) {
  return path.join(storeDir(), name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, data) {
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
}

// --- Interactions (F-02 : contexte de conversation persistant) -----

function getInteractions() {
  return readJson('interactions.json', []);
}

function appendInteraction(role, content) {
  const interactions = getInteractions();
  interactions.push({ role, content, at: new Date().toISOString() });
  const trimmed = interactions.slice(-MAX_INTERACTIONS);
  writeJson('interactions.json', trimmed);
  return trimmed;
}

// --- Taches (§12.2 Task, connecteur Productivite §7) ----------------

function getTasks() {
  return readJson('tasks.json', []);
}

function createTask({ title, dueDate, priority }) {
  const tasks = getTasks();
  const task = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title,
    dueDate: dueDate || null,
    priority: priority || 'moyenne',
    status: 'active',
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  tasks.push(task);
  writeJson('tasks.json', tasks);
  return task;
}

function completeTask(id) {
  const tasks = getTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error('Tâche introuvable.');
  task.status = 'completed';
  task.completedAt = new Date().toISOString();
  writeJson('tasks.json', tasks);
  return task;
}

function deleteTask(id) {
  const tasks = getTasks().filter((t) => t.id !== id);
  writeJson('tasks.json', tasks);
  return tasks;
}

// --- Rappels (connecteur Productivite §7 : reminder.schedule) -------

function getReminders() {
  return readJson('reminders.json', []);
}

function createReminder({ text, at, recurring }) {
  const reminders = getReminders();
  const reminder = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text,
    at,
    recurring: recurring || null,
    active: true,
    createdAt: new Date().toISOString(),
    lastFiredAt: null
  };
  reminders.push(reminder);
  writeJson('reminders.json', reminders);
  return reminder;
}

function markReminderFired(id) {
  const reminders = getReminders();
  const reminder = reminders.find((r) => r.id === id);
  if (!reminder) return null;
  reminder.lastFiredAt = new Date().toISOString();
  if (reminder.recurring === 'daily') {
    reminder.at = new Date(new Date(reminder.at).getTime() + 24 * 60 * 60 * 1000).toISOString();
  } else if (reminder.recurring === 'weekly') {
    reminder.at = new Date(new Date(reminder.at).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    reminder.active = false;
  }
  writeJson('reminders.json', reminders);
  return reminder;
}

function deleteReminder(id) {
  const reminders = getReminders().filter((r) => r.id !== id);
  writeJson('reminders.json', reminders);
  return reminders;
}

// --- Regles d'automatisation (§12.2 Policy, AURA AUTONOMY §5.9) ------
// Lues/evaluees par autonomy.js#tick() ; creees/supprimees via
// autonomy.js#ruleCreate/ruleDelete, exposees a l'ecran AURA AUTONOMY.

function getRules() {
  return readJson('rules.json', []);
}

function markRuleRun(id) {
  const rules = getRules();
  const rule = rules.find((r) => r.id === id);
  if (rule) {
    rule.lastRunAt = new Date().toISOString();
    writeJson('rules.json', rules);
  }
  return rule;
}

function createRule({ name, enabled, mode, trigger, action }) {
  const rules = getRules();
  const rule = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    enabled: enabled !== false,
    mode: mode || 'simulation',
    trigger,
    action,
    createdAt: new Date().toISOString(),
    lastRunAt: null
  };
  rules.push(rule);
  writeJson('rules.json', rules);
  return rule;
}

function deleteRule(id) {
  const rules = getRules().filter((r) => r.id !== id);
  writeJson('rules.json', rules);
  return rules;
}

function setRuleEnabled(id, enabled) {
  const rules = getRules();
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new Error('Règle introuvable.');
  rule.enabled = !!enabled;
  writeJson('rules.json', rules);
  return rule;
}

// enabled n'est volontairement pas modifiable ici - deja gere par la
// case a cocher de la ligne (setRuleEnabled ci-dessus), independante de
// l'edition du contenu de la regle.
function updateRule(id, { name, mode, trigger, action }) {
  const rules = getRules();
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new Error('Règle introuvable.');
  rule.name = name;
  rule.mode = mode || 'simulation';
  rule.trigger = trigger;
  rule.action = action;
  writeJson('rules.json', rules);
  return rule;
}

// --- Dossiers recents AURA SECURITY (§5, idee 1) --------------------
// Purement du confort d'UI (pas d'action a journaliser) : evite de
// retaper/re-parcourir le meme dossier de projet a chaque analyse.

const MAX_DOSSIERS_RECENTS = 5;

function getRecentSecurityFolders() {
  return readJson('security-recents.json', []);
}

// --- Resultats ignores AURA SECURITY (§5, idee 1) --------------------
// Faux positifs marques par l'utilisateur - scoped par dossier (un
// resultat "normal" dans un projet peut etre un vrai secret dans un
// autre). Cle composite fichier::ligne::motif plutot que le contenu du
// match lui-meme : on ne stocke jamais le secret, meme masque.

function getIgnoredFindings(dossier) {
  const tout = readJson('security-ignores.json', {});
  return tout[dossier] || [];
}

function ignoreFinding(dossier, cle) {
  const tout = readJson('security-ignores.json', {});
  tout[dossier] = [...new Set([...(tout[dossier] || []), cle])];
  writeJson('security-ignores.json', tout);
  return tout[dossier];
}

function clearIgnoredFindings(dossier) {
  const tout = readJson('security-ignores.json', {});
  delete tout[dossier];
  writeJson('security-ignores.json', tout);
  return [];
}

function addRecentSecurityFolder(dossier) {
  const recents = [dossier, ...getRecentSecurityFolders().filter((d) => d !== dossier)].slice(0, MAX_DOSSIERS_RECENTS);
  writeJson('security-recents.json', recents);
  return recents;
}

// --- Journal d'actions (§12.3 actions_log, §5.9) --------------------

function getJournal(limit = 50) {
  const journal = readJson('journal.json', []);
  return journal.slice(-limit).reverse();
}

function logAction({ typeAction, sensibilite, statut, details }) {
  const journal = readJson('journal.json', []);
  journal.push({
    typeAction,
    sensibilite,
    statut,
    details: details || null,
    date: new Date().toISOString()
  });
  writeJson('journal.json', journal.slice(-MAX_JOURNAL));
}

module.exports = {
  getInteractions,
  appendInteraction,
  getTasks,
  createTask,
  completeTask,
  deleteTask,
  getReminders,
  createReminder,
  markReminderFired,
  deleteReminder,
  getRules,
  markRuleRun,
  createRule,
  deleteRule,
  setRuleEnabled,
  updateRule,
  getRecentSecurityFolders,
  addRecentSecurityFolder,
  getIgnoredFindings,
  ignoreFinding,
  clearIgnoredFindings,
  getJournal,
  logAction
};
