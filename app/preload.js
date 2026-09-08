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

contextBridge.exposeInMainWorld('aura', {
  version: '0.1.0',
  getStatus: () => getJson('/api/status'),
  setApiKey: (provider, key) => postJson('/api/config/api-key', { provider, key }),
  sendMessage: (text) => postJson('/api/message', { text }),
  getJournal: () => getJson('/api/journal'),
  getPreferences: () => getJson('/api/preferences'),
  setPreference: (key, value) => postJson('/api/preferences', { key, value }),
  deletePreference: (key) => delJson(`/api/preferences/${encodeURIComponent(key)}`),
  clearMemory: () => delJson('/api/memory'),
  logAction: (entry) => postJson('/api/journal', entry),
  saveImage: (dataUrl) => ipcRenderer.invoke('dialog:save-image', dataUrl),

  getGamingStatus: () => getJson('/api/gaming/status'),
  setGamingConfig: (key, value) => postJson('/api/gaming/config', { key, value }),
  fetchRiotMatches: (gameName, tagLine, region) =>
    getJson(`/api/gaming/riot?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}&region=${region}`),
  fetchSteamGames: (steamId) => getJson(`/api/gaming/steam${steamId ? `?steamId=${encodeURIComponent(steamId)}` : ''}`),
  obsConnect: () => postJson('/api/streaming/obs/connect'),
  obsDisconnect: () => postJson('/api/streaming/obs/disconnect'),
  obsScenes: () => getJson('/api/streaming/obs/scenes'),
  obsSwitchScene: (sceneName) => postJson('/api/streaming/obs/scene', { sceneName }),
  obsUpdateOverlay: (sourceName, text) => postJson('/api/streaming/obs/overlay', { sourceName, text }),
  obsStartStream: () => postJson('/api/streaming/obs/start'),

  getTasks: () => getJson('/api/tasks'),
  createTask: (task) => postJson('/api/tasks', task),
  completeTask: (id) => postJson(`/api/tasks/${encodeURIComponent(id)}/complete`),
  deleteTask: (id) => delJson(`/api/tasks/${encodeURIComponent(id)}`),
  getReminders: () => getJson('/api/reminders'),
  createReminder: (reminder) => postJson('/api/reminders', reminder),
  deleteReminder: (id) => delJson(`/api/reminders/${encodeURIComponent(id)}`),
  checkDueReminders: () => getJson('/api/reminders/due'),

  getDevConfig: () => getJson('/api/dev/config'),
  setDevConfig: (key, value) => postJson('/api/dev/config', { key, value }),
  gitStatus: () => getJson('/api/dev/git/status'),
  gitCommit: (message, files) => postJson('/api/dev/git/commit', { message, files }),
  gitPush: (remote, branch) => postJson('/api/dev/git/push', { remote, branch }),
  unityBuild: (options) => postJson('/api/dev/unity/build', options),

  getCommStatus: () => getJson('/api/comm/status'),
  setCommConfig: (key, value) => postJson('/api/comm/config', { key, value }),
  mailSend: (mail) => postJson('/api/comm/mail/send', mail),
  discordSend: (content) => postJson('/api/comm/discord/send', { content }),

  getSystemSnapshot: () => getJson('/api/system/snapshot'),
  getSystemThresholds: () => getJson('/api/system/thresholds'),
  setSystemThreshold: (key, value) => postJson('/api/system/thresholds', { key, value }),
  getSystemAlerts: () => getJson('/api/system/alerts'),
  acknowledgeAlert: (id) => postJson(`/api/system/alerts/${encodeURIComponent(id)}/ack`),

  getAnalyticsSummary: () => getJson('/api/analytics/summary'),
  getAnalyticsAnomalies: () => getJson('/api/analytics/anomalies'),
  getForecast: (metric, stepsAhead) => getJson(`/api/analytics/forecast?metric=${metric}&stepsAhead=${stepsAhead}`),
  getPredictions: () => getJson('/api/analytics/predictions'),

  checkDependencies: () => getJson('/api/security/dependencies'),
  auditSecrets: () => getJson('/api/security/audit'),
  scanSecurityLogs: () => getJson('/api/security/logs'),
  pentestScan: (host, authorized) => postJson('/api/security/pentest', { host, authorized }),

  getRules: () => getJson('/api/autonomy/rules'),
  createRule: (rule) => postJson('/api/autonomy/rules', rule),
  toggleRule: (id) => postJson(`/api/autonomy/rules/${encodeURIComponent(id)}/toggle`),
  deleteRule: (id) => delJson(`/api/autonomy/rules/${encodeURIComponent(id)}`),
  getEstop: () => getJson('/api/autonomy/estop'),
  setEstop: (active) => postJson('/api/autonomy/estop', { active }),

  getVoiceConfig: () => getJson('/api/voice/config'),
  setVoiceConfig: (key, value) => postJson('/api/voice/config', { key, value }),
  logVoiceListen: (entry) => postJson('/api/voice/listen', entry),
  logVoiceSpeak: (text) => postJson('/api/voice/speak', { text }),
  logVoiceStop: (reason) => postJson('/api/voice/stop', { reason }),

  explainConcept: (topic, level) => postJson('/api/education/explain', { topic, level }),
  translateText: (text, targetLang, sourceLang) => postJson('/api/education/translate', { text, targetLang, sourceLang }),
  logTutorEntry: (topic, level, note) => postJson('/api/education/tutor', { topic, level, note }),
  getProgress: (topic) => getJson(`/api/education/progress${topic ? `?topic=${encodeURIComponent(topic)}` : ''}`)
});
