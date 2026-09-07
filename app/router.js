// Routage AURA CORE (F-03, §5.1, §5.6) : decide quel agent - et donc
// quel moteur IA - traite une demande. Version initiale par heuristique
// de mots-cles ; a affiner plus tard (classification par un modele
// dedie, contexte de conversation, etc.) sans changer l'interface
// exposee ici (route(text) -> nom de route dans ROUTES).
const anthropic = require('./providers/anthropic');
// providers/google.js (Gemini) est ecrit et pret, mais pas encore
// branche a une route : reserve a l'image/video (§10, §11.1) quand
// cette capacite existera dans l'UI.

const CODE_PATTERN = /```|\b(fonction|function|debug|bug|stack ?trace|exception|script|algorithme|refactor|compile|syntax|variable|api|json|regex)\b|\.(js|ts|py|java|cs|cpp|html|css|json|jsx|tsx)\b/i;

const ROUTES = {
  code: {
    agent: 'AURA CODE',
    keyName: 'anthropicApiKey',
    providerLabel: 'Claude (Anthropic)',
    provider: anthropic,
    model: 'claude-sonnet-5'
  },
  general: {
    agent: 'AURA CORE',
    keyName: 'anthropicApiKey',
    providerLabel: 'Claude (Anthropic)',
    provider: anthropic,
    model: 'claude-sonnet-5'
  }
  // Gemini (google.js) reste reserve a l'image/video (§10, §11.1) - pas
  // encore de route active tant que cette capacite n'existe pas dans
  // l'UI (pas d'upload d'image pour l'instant).
};

function routeFor(text) {
  return CODE_PATTERN.test(text) ? 'code' : 'general';
}

module.exports = { routeFor, ROUTES };
