const { contextBridge, ipcRenderer } = require('electron');

// Constantes dupliquees depuis server.js (volontairement, pas un require) :
// en mode sandbox:true, le preload ne peut pas charger des modules Node
// complets comme express/server.js - seule une poignee d'API restreintes
// est disponible ici, dont fetch.
const BASE_URL = 'http://127.0.0.1:8420';

async function postJson(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur serveur (${res.status})`);
  return data;
}

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur serveur (${res.status})`);
  return data;
}

async function delJson(path) {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur serveur (${res.status})`);
  return data;
}

async function putJson(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur serveur (${res.status})`);
  return data;
}

contextBridge.exposeInMainWorld('aura', {
  version: '0.1.0',
  getStatus: () => getJson('/api/status'),
  setApiKey: (provider, key) => postJson('/api/config/api-key', { provider, key }),
  sendMessage: (text) => postJson('/api/message', { text }),
  getJournal: () => getJson('/api/journal'),

  getTasks: () => getJson('/api/tasks'),
  createTask: (task) => postJson('/api/tasks', task),
  completeTask: (id) => postJson(`/api/tasks/${encodeURIComponent(id)}/complete`),
  deleteTask: (id) => delJson(`/api/tasks/${encodeURIComponent(id)}`),
  getReminders: () => getJson('/api/reminders'),
  createReminder: (reminder) => postJson('/api/reminders', reminder),
  deleteReminder: (id) => delJson(`/api/reminders/${encodeURIComponent(id)}`),
  checkDueReminders: () => getJson('/api/reminders/due'),

  getEstop: () => getJson('/api/autonomy/estop'),
  setEstop: (active) => postJson('/api/autonomy/estop', { active }),
  getRules: () => getJson('/api/autonomy/rules'),
  createRule: (rule) => postJson('/api/autonomy/rules', rule),
  toggleRule: (id, enabled) => postJson(`/api/autonomy/rules/${encodeURIComponent(id)}/toggle`, { enabled }),
  updateRule: (id, rule) => putJson(`/api/autonomy/rules/${encodeURIComponent(id)}`, rule),
  deleteRule: (id) => delJson(`/api/autonomy/rules/${encodeURIComponent(id)}`),
  runRule: (id) => postJson(`/api/autonomy/rules/${encodeURIComponent(id)}/run`),

  getSystemSnapshot: () => getJson('/api/system/monitor'),

  // AURA SECURITY (§5) - choix de dossier via le dialogue natif (dialog,
  // main.js) : seule methode du bridge qui passe par ipcRenderer plutot
  // que par l'API HTTP locale, aucun autre moyen d'ouvrir ce dialogue
  // depuis un renderer sandboxe/contextIsolation.
  chooseFolder: () => ipcRenderer.invoke('security:choose-folder'),
  scanSecrets: (path) => postJson('/api/security/scan-secrets', { path }),
  auditDependencies: (path) => postJson('/api/security/audit-deps', { path }),
  revealFile: (dossier, fichier) => ipcRenderer.invoke('security:reveal-file', dossier, fichier),
  getRecentSecurityFolders: () => getJson('/api/security/recent-folders'),
  fixDependency: (path, correctif) => postJson('/api/security/fix-dependency', { path, correctif }),
  exportSecurityReport: (contenu) => ipcRenderer.invoke('security:export-report', contenu),
  ignoreFinding: (path, fichier, ligne, motif) => postJson('/api/security/ignore-finding', { path, fichier, ligne, motif }),
  clearIgnoredFindings: (path) => postJson('/api/security/clear-ignores', { path }),
  ignoreDependency: (path, nom, gravite) => postJson('/api/security/ignore-dependency', { path, nom, gravite }),
  clearIgnoredDependencies: (path) => postJson('/api/security/clear-ignored-dependencies', { path }),
  getSecurityHistory: () => getJson('/api/security/history'),
  // clipboard direct (module Electron, pas l'API web navigator.clipboard) :
  // le gestionnaire de permissions (main.js#setupPermissions) refuse tout
  // sans exception, ce qui aurait bloque un appel navigator.clipboard.
  copyToClipboard: (texte) => ipcRenderer.invoke('security:copy-to-clipboard', texte),
  // Lien vers l'avis de securite (idee "avis") - shell.openExternal cote
  // main, inaccessible depuis un renderer sandboxe.
  openExternal: (url) => ipcRenderer.invoke('security:open-external', url),
  getExclusions: (path) => getJson(`/api/security/exclusions?path=${encodeURIComponent(path)}`),
  addExclusion: (path, motif) => postJson('/api/security/exclusions', { path, motif }),
  removeExclusion: (path, motif) => postJson('/api/security/exclusions/remove', { path, motif })
});
