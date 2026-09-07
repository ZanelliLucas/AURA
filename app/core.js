// AURA CORE minimal : coeur conversationnel (F-01 a F-04) branche sur
// l'API Claude (Anthropic). Le reste (routage vers agents, connecteurs,
// permissions) viendra se greffer ici plus tard sans reecrire ce module
// (§13.1). Module pur, sans dependance a Electron IPC : expose via
// server.js (API HTTP locale) pour que d'autres clients (fenetre
// applicative, futur bot Discord F-13...) puissent s'y brancher.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-5';
const MAX_HISTORY = 40;

const SYSTEM_PROMPT = `Tu es AURA (Assistant Universel Reactif et Autonome), l'assistant IA personnel de Lucas.
Reponds en francais, de maniere directe et concise. Adapte ton ton au contexte (plus professionnel pour le developpement, plus detendu pour le gaming/streaming).
Tu n'as pour l'instant aucune capacite d'action reelle (pas de connecteurs branches) : tu es un coeur conversationnel seul. Si on te demande d'agir sur un systeme, un fichier ou un service externe, explique clairement que cette capacite n'est pas encore disponible plutot que d'inventer un resultat.`;

let history = [];

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

// La cle API n'est jamais embarquee dans l'app packagee (publiee
// publiquement sur GitHub Releases) : elle vient soit d'un .env local de
// dev (non inclus dans le build, voir build.files du package.json), soit
// saisie par l'utilisateur au premier lancement et stockee dans le
// dossier utilisateur (config.json, hors depot, hors build).
function getApiKey() {
  const config = loadConfig();
  return config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || null;
}

function friendlyErrorMessage(err) {
  switch (err.status) {
    case 401: return 'Clé API invalide ou révoquée.';
    case 429: return 'Trop de requêtes ou crédit insuffisant sur le compte Anthropic.';
    case 529: return 'API Claude momentanément surchargée, réessaie dans un instant.';
    default:
      return err.status
        ? `Erreur API Claude (${err.status}).`
        : `Erreur réseau : ${err.message}`;
  }
}

function getStatus() {
  return { configured: !!getApiKey() };
}

function setApiKey(key) {
  const trimmed = String(key || '').trim();
  if (!trimmed) throw new Error('Clé vide.');
  const config = loadConfig();
  config.anthropicApiKey = trimmed;
  saveConfig(config);
  return { configured: true };
}

async function sendMessage(text) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Aucune clé API Anthropic configurée.');

  const client = new Anthropic({ apiKey });

  history.push({ role: 'user', content: text });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history
    });
  } catch (err) {
    history.pop();
    throw new Error(friendlyErrorMessage(err));
  }

  const replyText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  history.push({ role: 'assistant', content: replyText });
  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
  }

  return { text: replyText };
}

module.exports = { getStatus, setApiKey, sendMessage };
