// Routage AURA CORE (F-03, §5.1, §5.6) : decide quel agent - et donc
// quel moteur IA - traite une demande. Version initiale par heuristique
// de mots-cles ; a affiner plus tard (classification par un modele
// dedie, contexte de conversation, etc.) sans changer l'interface
// exposee ici (route(text) -> nom de route dans ROUTES).
const anthropic = require('./providers/anthropic');
const google = require('./providers/google');

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
    keyName: 'googleApiKey',
    providerLabel: 'Gemini (Google)',
    provider: google,
    model: 'gemini-2.5-pro'
  }
};

function routeFor(text) {
  return CODE_PATTERN.test(text) ? 'code' : 'general';
}

module.exports = { routeFor, ROUTES };
