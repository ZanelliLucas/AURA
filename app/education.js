// Connecteur Education (§11.2 : explications pedagogiques, tutorat
// personnalise, traduction). Aucun service externe propre : le §15 ne
// liste pas de famille d'actions dediee pour ce module (contrairement a
// System/Vision/Voice/Analytics/Automation/Security), les noms
// d'actions ci-dessous suivent donc simplement le style etabli
// (education.explain/translate/tutor_log). Reutilise AURA CORE (Claude,
// meme cle API que la conversation generale) avec des prompts systeme
// dedies par fonction plutot qu'un nouveau connecteur/SDK. Le "suivi
// d'apprentissage dans la duree" (§11.2) s'appuie sur une memoire de
// progression persistante (store.js) injectee dans le contexte des
// explications ulterieures sur le meme sujet.
const core = require('./core');
const store = require('./store');
const anthropic = require('./providers/anthropic');

const MODEL = 'claude-sonnet-5';

function requireKey() {
  const key = core.loadConfig().anthropicApiKey || process.env.ANTHROPIC_API_KEY || null;
  if (!key) throw new Error('Aucune clé Claude (Anthropic) configurée.');
  return key;
}

function priorContextFor(topic) {
  const entries = store.getProgress()
    .filter((e) => e.topic.toLowerCase() === topic.toLowerCase())
    .slice(-5);
  if (!entries.length) return '';
  return `\n\nSuivi antérieur de l'utilisateur sur ce sujet (le plus récent en dernier) :\n${entries.map((e) => `- [${e.level || 'niveau non précisé'}] ${e.note}`).join('\n')}`;
}

// education.explain (§11.2, Lecture) : reformule une notion au niveau demande.
async function explainConcept({ topic, level }) {
  if (!topic || !topic.trim()) throw new Error('Sujet manquant.');
  const key = requireKey();
  const systemPrompt = `Tu es AURA EDUCATION. Explique la notion demandée de manière pédagogique, adaptée au niveau "${level || 'intermédiaire'}" de l'utilisateur. Sois clair et concret, avec un exemple si utile. Réponds en français.${priorContextFor(topic.trim())}`;
  try {
    const result = await anthropic.complete({ apiKey: key, model: MODEL, systemPrompt, messages: [{ role: 'user', content: topic.trim() }] });
    store.logAction({ typeAction: 'education.explain', sensibilite: 'lecture', statut: 'execute', details: { topic: topic.trim(), level: level || null } });
    return { text: result.text };
  } catch (err) {
    store.logAction({ typeAction: 'education.explain', sensibilite: 'lecture', statut: 'echoue', details: { topic: topic.trim(), error: err.message } });
    throw err;
  }
}

// education.translate (§11.2, Lecture) : traduction et adaptation de texte.
async function translateText({ text, targetLang, sourceLang }) {
  if (!text || !text.trim()) throw new Error('Texte à traduire manquant.');
  if (!targetLang || !targetLang.trim()) throw new Error('Langue cible manquante.');
  const key = requireKey();
  const systemPrompt = `Tu es un traducteur. Traduis le texte fourni ${sourceLang && sourceLang.trim() ? `depuis le ${sourceLang.trim()} ` : ''}vers le ${targetLang.trim()}. Réponds uniquement avec la traduction, sans commentaire ni guillemets.`;
  try {
    const result = await anthropic.complete({ apiKey: key, model: MODEL, systemPrompt, messages: [{ role: 'user', content: text.trim() }] });
    store.logAction({ typeAction: 'education.translate', sensibilite: 'lecture', statut: 'execute', details: { targetLang: targetLang.trim(), sourceLang: sourceLang ? sourceLang.trim() : null, length: text.trim().length } });
    return { text: result.text };
  } catch (err) {
    store.logAction({ typeAction: 'education.translate', sensibilite: 'lecture', statut: 'echoue', details: { targetLang: targetLang.trim(), error: err.message } });
    throw err;
  }
}

// education.tutor_log (§11.2, Reversible) : enregistre une entree de
// suivi pedagogique dans la memoire de projet ("tutorat personnalise").
function logTutorEntry({ topic, level, note }) {
  if (!topic || !topic.trim()) throw new Error('Sujet manquant.');
  if (!note || !note.trim()) throw new Error('Note de suivi manquante.');
  const entry = store.addProgressEntry({ topic: topic.trim(), level: level || null, note: note.trim() });
  store.logAction({ typeAction: 'education.tutor_log', sensibilite: 'reversible', statut: 'execute', details: { topic: entry.topic, level: entry.level } });
  return entry;
}

function getProgress(topic) {
  const entries = store.getProgress();
  return topic ? entries.filter((e) => e.topic.toLowerCase() === topic.trim().toLowerCase()) : entries;
}

module.exports = {
  explainConcept,
  translateText,
  logTutorEntry,
  getProgress
};
