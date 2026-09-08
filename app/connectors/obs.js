// Connecteur Streaming - OBS WebSocket (§8, §5.6 AURA STREAM). Connexion
// locale (OBS doit tourner sur la meme machine avec son serveur
// WebSocket active), pas un service cloud.
const { OBSWebSocket } = require('obs-websocket-js');

let obs = null;
let connected = false;

obsReset();
function obsReset() {
  obs = new OBSWebSocket();
  connected = false;
  obs.on('ConnectionClosed', () => { connected = false; });
}

function isConnected() {
  return connected;
}

async function connect({ host, port, password }) {
  if (connected) return { connected: true };
  obsReset();
  await obs.connect(`ws://${host}:${port}`, password || undefined);
  connected = true;
  return { connected: true };
}

async function disconnect() {
  if (connected) await obs.disconnect();
  connected = false;
  return { connected: false };
}

function assertConnected() {
  if (!connected) throw new Error('OBS non connecté.');
}

// obs.switch_scene (§8, Reversible)
async function getScenes() {
  assertConnected();
  const { scenes, currentProgramSceneName } = await obs.call('GetSceneList');
  return { current: currentProgramSceneName, scenes: scenes.map((s) => s.sceneName).reverse() };
}

async function setScene(sceneName) {
  assertConnected();
  await obs.call('SetCurrentProgramScene', { sceneName });
  return { sceneName };
}

// obs.update_overlay_text (§8, Reversible)
async function setOverlayText(sourceName, text) {
  assertConnected();
  await obs.call('SetInputSettings', { inputName: sourceName, inputSettings: { text } });
  return { sourceName, text };
}

// obs.start_stream (§8, Sensible - confirmation geree cote UI)
async function startStream() {
  assertConnected();
  await obs.call('StartStream');
  return { started: true };
}

async function getStreamStatus() {
  assertConnected();
  const status = await obs.call('GetStreamStatus');
  return { active: status.outputActive };
}

module.exports = { isConnected, connect, disconnect, getScenes, setScene, setOverlayText, startStream, getStreamStatus };
