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

// --- Preferences (F-05, F-06, F-07) ---------------------------------

function getPreferences() {
  return readJson('preferences.json', {});
}

function setPreference(key, value) {
  const prefs = getPreferences();
  prefs[key] = { value, updatedAt: new Date().toISOString() };
  writeJson('preferences.json', prefs);
  return prefs;
}

function clearPreferences() {
  writeJson('preferences.json', {});
  return {};
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
  getPreferences,
  setPreference,
  clearPreferences,
  getInteractions,
  appendInteraction,
  getJournal,
  logAction
};
