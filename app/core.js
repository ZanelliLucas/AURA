// AURA CORE minimal : coeur conversationnel (F-01 a F-04) + routage
// multi-fournisseurs (F-03, §5.1) vers l'agent le plus adapte a la
// demande. Le reste (connecteurs, permissions) viendra se greffer ici
// plus tard sans reecrire ce module (§13.1). Module pur, sans dependance
// a Electron IPC : expose via server.js (API HTTP locale) pour que
// d'autres clients (fenetre applicative, futur bot Discord F-13...)
// puissent s'y brancher.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { routeFor, ROUTES } = require('./router');

const MAX_HISTORY = 40;

const SYSTEM_PROMPT = `Tu es AURA (Assistant Universel Reactif et Autonome), l'assistant IA personnel de Lucas.
Reponds en francais, de maniere directe et concise. Adapte ton ton au contexte (plus professionnel pour le developpement, plus detendu pour le gaming/streaming).
Tu n'as pour l'instant aucune capacite d'action reelle (pas de connecteurs branches) : tu es un coeur conversationnel seul. Si on te demande d'agir sur un systeme, un fichier ou un service externe, explique clairement que cette capacite n'est pas encore disponible plutot que d'inventer un resultat.`;

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

// Les cles API ne sont jamais embarquees dans l'app packagee (publiee
// publiquement sur GitHub Releases) : elles viennent soit d'un .env
// local de dev (non inclus dans le build, voir build.files du
// package.json), soit saisies par l'utilisateur et stockees dans le
// dossier utilisateur (config.json, hors depot, hors build).
function getKey(keyName, envVar) {
  const config = loadConfig();
  return config[keyName] || process.env[envVar] || null;
}

function providerKeys() {
  return {
    anthropicApiKey: getKey('anthropicApiKey', 'ANTHROPIC_API_KEY'),
    googleApiKey: getKey('googleApiKey', 'GOOGLE_API_KEY')
  };
}

function friendlyErrorMessage(err, providerLabel) {
  const status = err.status;
  if (status === 401 || status === 400) return `Clé ${providerLabel} invalide ou révoquée.`;
  if (status === 429) return `Trop de requêtes ou crédit insuffisant sur le compte ${providerLabel}.`;
  if (status && status >= 500) return `${providerLabel} momentanément surchargé, réessaie dans un instant.`;
  return status ? `Erreur ${providerLabel} (${status}).` : `Erreur réseau : ${err.message}`;
}

// getStatus : "configured" reste vrai des que la route par defaut
// (general -> Claude) a une cle, pour piloter l'ecran de premiere
// configuration ; le detail par fournisseur alimente le panneau Journal.
function getStatus() {
  const keys = providerKeys();
  return {
    configured: !!keys.anthropicApiKey,
    providers: {
      google: !!keys.googleApiKey,
      anthropic: !!keys.anthropicApiKey
    }
  };
}

const PROVIDER_KEY_NAMES = { google: 'googleApiKey', anthropic: 'anthropicApiKey' };

function setApiKey(provider, key) {
  const keyName = PROVIDER_KEY_NAMES[provider];
  const trimmed = String(key || '').trim();
  if (!keyName || !trimmed) {
    const error = !keyName ? `Fournisseur inconnu : ${provider}.` : 'Clé vide.';
    store.logAction({
      typeAction: 'config.api_key', sensibilite: 'reversible', statut: 'echoue',
      details: { provider, error }
    });
    throw new Error(error);
  }
  const config = loadConfig();
  config[keyName] = trimmed;
  saveConfig(config);
  store.logAction({
    typeAction: 'config.api_key', sensibilite: 'reversible', statut: 'execute',
    details: { provider }
  });
  return getStatus();
}

function apiMessages() {
  return store.getInteractions()
    .slice(-MAX_HISTORY)
    .map(({ role, content }) => ({ role, content }));
}

async function sendMessage(text) {
  const routeName = routeFor(text);
  const route = ROUTES[routeName];
  const keys = providerKeys();
  const apiKey = keys[route.keyName];

  if (!apiKey) {
    const message = `Cette demande a été orientée vers ${route.agent} (${route.providerLabel}), mais aucune clé n’est configurée pour ce fournisseur.`;
    store.logAction({
      typeAction: 'core.send_message',
      sensibilite: 'lecture',
      statut: 'echoue',
      details: { error: message, route: routeName, agent: route.agent }
    });
    throw new Error(message);
  }

  const messages = [...apiMessages(), { role: 'user', content: text }];

  let result;
  try {
    result = await route.provider.complete({
      apiKey,
      model: route.model,
      systemPrompt: SYSTEM_PROMPT,
      messages
    });
  } catch (err) {
    const message = friendlyErrorMessage(err, route.providerLabel);
    store.logAction({
      typeAction: 'core.send_message',
      sensibilite: 'lecture',
      statut: 'echoue',
      details: { error: message, route: routeName, agent: route.agent }
    });
    throw new Error(message);
  }

  store.appendInteraction('user', text);
  store.appendInteraction('assistant', result.text);
  store.logAction({
    typeAction: 'core.send_message',
    sensibilite: 'lecture',
    statut: 'execute',
    details: { route: routeName, agent: route.agent, model: route.model, length: result.text.length }
  });

  return { text: result.text, agent: route.agent };
}

module.exports = { getStatus, setApiKey, sendMessage, loadConfig, saveConfig };
