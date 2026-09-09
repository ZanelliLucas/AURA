const { contextBridge } = require('electron');

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
  setEstop: (active) => postJson('/api/autonomy/estop', { active })
});
