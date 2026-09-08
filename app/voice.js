// Connecteur Voice (§5.2, §15 : voice.listen, voice.speak, voice.stop).
// La synthese vocale (TTS) est entierement fonctionnelle : voix Windows
// locales via l'API Web Speech du renderer, sans cle API (verifie en
// conditions reelles). La reconnaissance vocale (STT) n'a en revanche
// aucun fournisseur branche pour l'instant - webkitSpeechRecognition
// echoue systematiquement dans Electron (erreur "network", faute de
// cle Google embarquee) et aucun fournisseur cloud n'a ete choisi. La
// capture microphone elle-meme reste reelle (renderer, MediaRecorder) :
// seule l'etape de transcription est en attente, comme le build Unity
// du connecteur Developpement.
const core = require('./core');
const store = require('./store');

const CONFIG_FIELDS = ['wakeWord', 'ttsVoice', 'micEnabled', 'handsFree', 'speakAlerts'];
const DEFAULTS = { wakeWord: 'AURA', ttsVoice: '', micEnabled: true, handsFree: false, speakAlerts: true };

function getConfig() {
  const config = core.loadConfig();
  return {
    wakeWord: config.wakeWord || DEFAULTS.wakeWord,
    ttsVoice: config.ttsVoice || DEFAULTS.ttsVoice,
    micEnabled: config.micEnabled !== false,
    handsFree: !!config.handsFree,
    speakAlerts: config.speakAlerts !== false,
    sttProvider: 'non_configure'
  };
}

function setConfigField(key, value) {
  if (!CONFIG_FIELDS.includes(key)) throw new Error(`Champ inconnu : ${key}.`);
  const config = core.loadConfig();
  config[key] = value;
  core.saveConfig(config);
  return getConfig();
}

// voice.listen (§15, Lecture) : une tentative d'ecoute complete. La
// capture est reelle (cf. commentaire d'en-tete) ; sans fournisseur STT
// configure, transcript reste vide et error decrit l'etat reel.
function recordListen({ durationMs, transcript, error }) {
  if (!getConfig().micEnabled) throw new Error('Microphone désactivé dans les préférences AURA VOICE.');
  store.logAction({
    typeAction: 'voice.listen', sensibilite: 'lecture', statut: error ? 'echoue' : 'execute',
    details: { durationMs: durationMs || null, transcript: transcript || null, error: error || null }
  });
  return { logged: true };
}

// voice.speak (§15, Reversible) : synthese reelle cote renderer, journalisee ici.
function recordSpeak({ text }) {
  if (!text || !text.trim()) throw new Error('Texte à synthétiser manquant.');
  store.logAction({
    typeAction: 'voice.speak', sensibilite: 'reversible', statut: 'execute',
    details: { textPreview: text.trim().slice(0, 160) }
  });
  return { logged: true };
}

// voice.stop (§15, Lecture) : interruption d'une ecoute ou d'une
// synthese en cours (bouton utilisateur ou "barge-in" pendant une
// synthese, §5.2 "detection des interruptions").
function recordStop({ reason }) {
  store.logAction({
    typeAction: 'voice.stop', sensibilite: 'lecture', statut: 'execute',
    details: { reason: reason || 'utilisateur' }
  });
  return { logged: true };
}

// Correspondance du mot d'activation (§5.2). Fonction pure, prete a
// etre branchee sur un flux de transcription continu des qu'un
// fournisseur STT sera configure - ne change pas quand ce jour vient.
function matchesWakeWord(transcript, wakeWord) {
  if (!transcript) return false;
  const needle = (wakeWord || DEFAULTS.wakeWord).trim().toLowerCase();
  if (!needle) return false;
  return transcript.trim().toLowerCase().includes(needle);
}

module.exports = {
  getConfig,
  setConfigField,
  recordListen,
  recordSpeak,
  recordStop,
  matchesWakeWord
};
