// Gaming & Streaming (§8, §16.3). Connecteur gaming strictement en
// lecture (§18.2 : aucune automatisation cote jeu). Le controle OBS
// reste de la supervision de diffusion, pas du jeu lui-meme.
const core = require('./core');
const store = require('./store');
const riot = require('./connectors/riot');
const steam = require('./connectors/steam');
const obs = require('./connectors/obs');

const CONNECTOR_FIELDS = ['riotApiKey', 'steamApiKey', 'steamId', 'obsHost', 'obsPort', 'obsPassword'];

function getConnectorStatus() {
  const config = core.loadConfig();
  return {
    riot: !!config.riotApiKey,
    steam: !!(config.steamApiKey && config.steamId),
    obs: {
      configured: !!(config.obsHost && config.obsPort),
      connected: obs.isConnected()
    }
  };
}

function setConnectorField(key, value) {
  if (!CONNECTOR_FIELDS.includes(key)) throw new Error(`Champ inconnu : ${key}.`);
  const config = core.loadConfig();
  config[key] = value;
  core.saveConfig(config);
  return getConnectorStatus();
}

function friendlyExternalError(err, label) {
  if (err.status === 401 || err.status === 403) return `Clé ${label} invalide ou non autorisée.`;
  if (err.status === 404) return `${label} : introuvable (identifiant incorrect ?).`;
  if (err.status === 429) return `${label} : trop de requêtes, réessaie plus tard.`;
  return err.message;
}

// riot.get_match_history (§8, Lecture)
async function fetchMatchHistory(gameName, tagLine, region) {
  const config = core.loadConfig();
  if (!config.riotApiKey) throw new Error('Clé API Riot non configurée.');
  try {
    const matches = await riot.getMatchHistory({ apiKey: config.riotApiKey, region, gameName, tagLine });
    store.logAction({
      typeAction: 'riot.get_match_history', sensibilite: 'lecture', statut: 'execute',
      details: { gameName, tagLine, region, count: matches.length }
    });
    return matches;
  } catch (err) {
    store.logAction({ typeAction: 'riot.get_match_history', sensibilite: 'lecture', statut: 'echoue', details: { error: err.message } });
    throw new Error(friendlyExternalError(err, 'Riot'));
  }
}

// steam.get_playtime (§8, Lecture)
async function fetchOwnedGames(steamIdOverride) {
  const config = core.loadConfig();
  const apiKey = config.steamApiKey;
  const steamId = steamIdOverride || config.steamId;
  if (!apiKey) throw new Error('Clé API Steam non configurée.');
  if (!steamId) throw new Error('SteamID non configuré.');
  try {
    const games = await steam.getOwnedGames({ apiKey, steamId });
    store.logAction({ typeAction: 'steam.get_playtime', sensibilite: 'lecture', statut: 'execute', details: { count: games.length } });
    return games;
  } catch (err) {
    store.logAction({ typeAction: 'steam.get_playtime', sensibilite: 'lecture', statut: 'echoue', details: { error: err.message } });
    throw new Error(friendlyExternalError(err, 'Steam'));
  }
}

async function obsConnect() {
  const config = core.loadConfig();
  if (!config.obsHost || !config.obsPort) throw new Error('Hôte/port OBS non configurés.');
  try {
    await obs.connect({ host: config.obsHost, port: config.obsPort, password: config.obsPassword });
  } catch (err) {
    throw new Error(`Connexion OBS échouée : ${err.message}`);
  }
  return { connected: true };
}

async function obsSwitchScene(sceneName) {
  const result = await obs.setScene(sceneName);
  store.logAction({ typeAction: 'obs.switch_scene', sensibilite: 'reversible', statut: 'execute', details: { sceneName } });
  return result;
}

async function obsUpdateOverlay(sourceName, text) {
  const result = await obs.setOverlayText(sourceName, text);
  store.logAction({ typeAction: 'obs.update_overlay_text', sensibilite: 'reversible', statut: 'execute', details: { sourceName } });
  return result;
}

// obs.start_stream (§8, Sensible) - confirmation geree cote UI avant l'appel.
async function obsStartStream() {
  const result = await obs.startStream();
  store.logAction({ typeAction: 'obs.start_stream', sensibilite: 'sensible', statut: 'execute' });
  return result;
}

module.exports = {
  getConnectorStatus,
  setConnectorField,
  fetchMatchHistory,
  fetchOwnedGames,
  obsConnect,
  obsDisconnect: obs.disconnect,
  obsScenes: obs.getScenes,
  obsSwitchScene,
  obsUpdateOverlay,
  obsStartStream
};
