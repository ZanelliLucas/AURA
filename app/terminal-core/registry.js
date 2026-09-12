'use strict';

/**
 * Registre des commandes.
 *
 * Ajouter une commande au Terminal = enregistrer un objet ici. Rien d'autre
 * dans le moteur n'a besoin d'etre modifie : c'est le point d'extension.
 *
 * Forme d'une commande :
 * {
 *   name: 'find',
 *   aliases: ['chercher'],
 *   category: 'Fichiers',
 *   summary: 'Recherche un fichier par son nom.',
 *   usage: 'find <motif> [--in <dossier>]',
 *   details: 'Texte long optionnel affiche par `help find`.',
 *   examples: ['find rapport.pdf --all'],
 *   flags: { in: 'string', all: 'boolean' },   // types pour l'analyseur
 *   flagHelp: { in: 'Dossier de depart.' },
 *   short: { n: 'limit' },                     // alias courts
 *   dangerous: false,                          // demande confirmation
 *   confirmWhen: ['stop'],                     // ... ou seulement pour ces sous-commandes
 *   passthrough: false,                        // true : options non verifiees (run, watch, alias, echo)
 *   flagAliases: { depth: 'profondeur' },      // synonymes d'options
 *   acceptsInput: false,                       // true : lit un tube (`ps | grep node`), via ctx.input
 *   run: async (ctx) => { ... }
 * }
 */

const { fold } = require('./text');

/**
 * La commande demande-t-elle une confirmation pour ces arguments ?
 * `dangerous` : toujours ; `confirmWhen` : seulement quand le premier argument
 * est l'une de ces sous-commandes (`service stop`, mais pas `service`).
 */
function requiresConfirmation(command, args = []) {
  if (!command) return false;
  if (command.dangerous) return true;
  // Accents et casse ignores : « arrêter » vaut « arreter ».
  const first = fold(args[0] || '');
  return Array.isArray(command.confirmWhen) && command.confirmWhen.some((word) => fold(word) === first);
}
class Registry {
  constructor() {
    this.commands = new Map();
    this.aliases = new Map();
  }

  register(command) {
    if (!command || typeof command.name !== 'string' || !command.name) {
      throw new Error('Une commande doit avoir un nom.');
    }
    if (typeof command.run !== 'function') {
      throw new Error(`La commande "${command.name}" doit exposer une fonction run().`);
    }

    const normalized = {
      aliases: [],
      category: 'Divers',
      summary: '',
      usage: command.name,
      details: '',
      examples: [],
      flags: {},
      flagHelp: {},
      short: {},
      dangerous: false,
      confirmWhen: [],
      passthrough: false,
      flagAliases: {},
      acceptsInput: false,
      ...command
    };
    for (const [alias, target] of Object.entries(normalized.flagAliases)) {
      if (!(target in normalized.flags)) {
        throw new Error(`La commande "${normalized.name}" : --${alias} renvoie a --${target}, qui n'existe pas.`);
      }
    }

    this.commands.set(normalized.name, normalized);
    for (const alias of normalized.aliases) this.aliases.set(alias, normalized.name);
    return normalized;
  }

  registerAll(commands) {
    for (const command of commands) this.register(command);
    return this;
  }

  unregister(name) {
    const command = this.get(name);
    if (!command) return false;
    for (const alias of command.aliases) this.aliases.delete(alias);
    return this.commands.delete(command.name);
  }

  get(name) {
    if (!name) return null;
    const key = String(name).toLowerCase();
    if (this.commands.has(key)) return this.commands.get(key);
    if (this.aliases.has(key)) return this.commands.get(this.aliases.get(key));
    return null;
  }

  has(name) {
    return Boolean(this.get(name));
  }

  list() {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  /** Commandes regroupees par categorie, pour l'affichage de `help`. */
  byCategory() {
    const groups = new Map();
    for (const command of this.list()) {
      if (command.hidden) continue;
      if (!groups.has(command.category)) groups.set(command.category, []);
      groups.get(command.category).push(command);
    }
    return groups;
  }

  /** Noms + alias, pour l'autocompletion. */
  names() {
    return [...this.commands.keys(), ...this.aliases.keys()].sort();
  }

  /** Suggestions « vouliez-vous dire... » pour une commande inconnue. */
  suggest(name, max = 3) {
    const target = String(name).toLowerCase();
    return this.names()
      .map((candidate) => ({ candidate, score: distance(target, candidate) }))
      // Deux corrections au maximum, et au-dela d'une seule on exige la meme
      // initiale : sur des noms courts, « fnd » proposerait sinon « cd » et
      // « env », qui n'ont rien a voir avec ce qui a ete tape.
      .filter(({ candidate, score }) => score <= 2 && (score <= 1 || candidate[0] === target[0]))
      .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
      .slice(0, max)
      .map((entry) => entry.candidate);
  }
}

/** Distance de Levenshtein, en memoire lineaire. */
function distance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current.slice();
  }
  return previous[b.length];
}

/** Equivalents courants, pour suggerer la bonne option (`ls --hidden` -> `--tout`). */
const FLAG_SYNONYMS = [
  ['depth', 'profondeur'],
  ['all', 'tout', 'tous'],
  ['hidden', 'tout'],
  ['sort', 'tri'],
  ['reverse', 'inverse'],
  ['since', 'depuis'],
  ['every', 'toutes'],
  ['lines', 'lignes'],
  ['file', 'fichier'],
  ['dir', 'folder', 'dossier'],
  ['size', 'big', 'gros'],
  ['delete', 'remove', 'supprimer']
];

/**
 * L'option connue la plus proche d'une option mal tapee : une ou deux lettres
 * de difference, ou un equivalent anglais / francais. null sinon.
 */
function suggestFlag(name, known) {
  const target = String(name).toLowerCase();
  const close = known
    .map((candidate) => ({ candidate, score: distance(target, candidate) }))
    // Deux lettres d'ecart des 5 lettres : une inversion (« depht ») en compte deux.
    .filter(({ candidate, score }) => score <= (candidate.length >= 5 ? 2 : 1))
    .sort((a, b) => a.score - b.score)[0];
  if (close) return close.candidate;
  for (const group of FLAG_SYNONYMS) {
    if (!group.includes(target)) continue;
    const hit = group.find((word) => word !== target && known.includes(word));
    if (hit) return hit;
  }
  return null;
}

module.exports = { Registry, distance, requiresConfirmation, suggestFlag };
