'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const MAX_HISTORY = 500;

/** Nom de variable : lettres, chiffres et _, sans commencer par un chiffre. */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Etat vivant d'un terminal : dossier courant, historique, alias,
 * serveurs enregistres, serveur courant, variables.
 *
 * La persistance est injectee (`storage`) au lieu d'etre codee en dur : le
 * coeur ne sait pas s'il tourne dans Electron ou dans la console.
 * Un `storage` vaut `{ load(): Object, save(state): void }`.
 *
 * Onglets : `forTab()` donne la session d'un autre onglet. Chacun a son
 * dossier, ses resultats numerotes, son serveur courant et son `cd -` ;
 * historique, alias, serveurs enregistres et variables sont partages.
 */
class Session {
  constructor(options = {}) {
    this.home = options.home || os.homedir();
    this.cwd = options.cwd || this.home;
    // Ce que tous les onglets partagent : lu et ecrit par les accesseurs ci-dessous.
    this.shared = { history: [], aliases: new Map(), servers: new Map(), variables: new Map() };
    // Serveur dans lequel on se trouve ({ key, label }). Volontairement non
    // persiste : au redemarrage, plus aucun serveur ne tourne.
    this.server = null;
    // Variables internes de l'onglet (`OLDPWD` pour `cd -`).
    this.vars = new Map();
    // Chemins des resultats numerotes de la derniere recherche (`find`,
    // `grep`), pour `open 3`, `cd 3`... Non persistes, comme `server`.
    this.results = [];
    this.startedAt = Date.now();
    this.storage = options.storage || null;

    if (this.storage && typeof this.storage.load === 'function') {
      const saved = this.storage.load() || {};
      if (Array.isArray(saved.history)) this.history = saved.history.slice(-MAX_HISTORY);
      if (saved.aliases) this.aliases = new Map(Object.entries(saved.aliases));
      if (saved.servers) this.servers = new Map(Object.entries(saved.servers));
      if (saved.variables) {
        this.variables = new Map(Object.entries(saved.variables).filter(([name]) => VARIABLE_NAME.test(name)));
      }
      if (saved.cwd && isDirectory(saved.cwd)) this.cwd = saved.cwd;
    }
  }

  // Un onglet herite de ces accesseurs : `this.history = []` y remplace
  // l'historique partage, au lieu de lui en donner un a lui seul.
  get history() { return this.shared.history; }
  set history(value) { this.shared.history = value; }
  get aliases() { return this.shared.aliases; }
  set aliases(value) { this.shared.aliases = value; }
  get servers() { return this.shared.servers; }
  set servers(value) { this.shared.servers = value; }
  get variables() { return this.shared.variables; }
  set variables(value) { this.shared.variables = value; }

  /** Session d'un nouvel onglet, qui demarre dans le dossier de `from`. */
  forTab(from = this) {
    const base = this.base || this;
    const tab = Object.create(base);
    tab.base = base;
    tab.cwd = from.cwd;
    tab.server = null;
    tab.vars = new Map();
    tab.results = [];
    return tab;
  }

  /** Resout un chemin relatif au dossier courant, avec support de `~`. */
  resolve(target) {
    if (!target) return this.cwd;
    let value = String(target).trim();
    if (value === '~') return this.home;
    if (value.startsWith('~/') || value.startsWith('~\\')) {
      value = path.join(this.home, value.slice(2));
    }
    return path.resolve(this.cwd, value);
  }

  /**
   * Numerote les lignes d'une recherche (colonne `n`) et retient leurs
   * chemins (`_full`). Une recherche sans resultat efface les precedents.
   */
  numberResults(rows) {
    rows.forEach((row, i) => { row.n = String(i + 1); });
    this.results = rows.map((row) => row._full);
    return rows;
  }

  /** Rappel affiche sous des resultats numerotes. */
  resultsHint() {
    return '`open <n>` ouvre le resultat n, `cd <n>` va dans son dossier, `cat <n>` l\'affiche.';
  }

  /**
   * Chemin designe par un argument de commande. `#3` est toujours le 3e
   * resultat de la derniere recherche ; `3` aussi, sauf si un fichier ou un
   * dossier de ce nom existe dans le dossier courant.
   */
  resolveTarget(target) {
    const value = String(target == null ? '' : target).trim();
    const match = /^#?(\d+)$/.exec(value);
    if (!match) return this.resolve(value);

    const explicit = value.startsWith('#');
    const literal = this.resolve(value);
    if (!explicit && fs.existsSync(literal)) return literal;
    if (!this.results.length) {
      if (!explicit) return literal;
      throw new Error('Aucun resultat a designer : lancez find ou grep, puis designez un resultat par son numero (open 1, cd 2...).');
    }
    const n = Number(match[1]);
    if (n < 1 || n > this.results.length) {
      throw new Error(`Pas de resultat n°${n} : la derniere recherche en compte ${this.results.length}.`);
    }
    return this.results[n - 1];
  }

  /** Dossier courant abrege : `~` remplace le dossier utilisateur. */
  displayCwd() {
    if (this.cwd === this.home) return '~';
    if (this.cwd.toLowerCase().startsWith(this.home.toLowerCase() + path.sep)) {
      return '~' + this.cwd.slice(this.home.length);
    }
    return this.cwd;
  }

  /** Texte de l'invite : le serveur courant, s'il y en a un, puis le dossier. */
  promptLabel() {
    return `${this.server ? `[${this.server.label}] ` : ''}${this.displayCwd()}`;
  }

  setCwd(target) {
    const next = this.resolve(target);
    if (!isDirectory(next)) throw new Error(`Dossier introuvable : ${next}`);
    this.cwd = next;
    this.persist();
    return this.cwd;
  }

  pushHistory(line) {
    const value = String(line).trim();
    if (!value) return;
    if (this.history[this.history.length - 1] === value) return;
    this.history.push(value);
    if (this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY);
    this.persist();
  }

  clearHistory() {
    this.history = [];
    this.persist();
  }

  setAlias(name, value) {
    this.aliases.set(name, value);
    this.persist();
  }

  removeAlias(name) {
    const existed = this.aliases.delete(name);
    this.persist();
    return existed;
  }

  /** Serveur pilotable par `start` / `stop` : `{ label, command, cwd, port }`. */
  setServer(key, def) {
    this.servers.set(key, def);
    this.persist();
  }

  removeServer(key) {
    const existed = this.servers.delete(key);
    this.persist();
    return existed;
  }

  // --- Variables ($NOM) -------------------------------------------------------

  setVariable(name, value) {
    if (!VARIABLE_NAME.test(name)) {
      throw new Error(`Nom de variable invalide : ${name}. Lettres, chiffres et _, sans commencer par un chiffre.`);
    }
    this.variables.set(name, String(value));
    this.persist();
  }

  removeVariable(name) {
    const existed = this.variables.delete(name);
    this.persist();
    return existed;
  }

  /**
   * Valeur de `$NOM` : variable du Terminal, sinon variable du systeme (meme
   * casse : `$TEMP`, `$Path`). undefined si elle n'existe pas.
   */
  variable(name) {
    if (this.variables.has(name)) return this.variables.get(name);
    return Object.prototype.hasOwnProperty.call(process.env, name) && Object.keys(process.env).includes(name)
      ? process.env[name]
      : undefined;
  }

  /**
   * Remplace `$NOM` et `${NOM}` par leur valeur. Rien n'est remplace entre
   * apostrophes ('prix : 5$'), ni un nom qui n'existe pas : `$_` et `$env:X`
   * de PowerShell passent intacts dans `run`. Hors guillemets, une valeur qui
   * contient des espaces ou des operateurs est mise entre guillemets : elle
   * reste un seul argument, et son `|` n'enchaine rien. `quote: false` : un
   * texte deja isole (nom de fichier apres `>`), remplace tel quel.
   */
  expandVariables(text, { quote: protect = true } = {}) {
    const source = String(text == null ? '' : text);
    if (!source.includes('$')) return source;
    let result = '';
    let quote = null;
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];
      if (quote === "'") {
        if (ch === "'") quote = null;
        result += ch;
        continue;
      }
      if (ch === "'" && !quote) { quote = "'"; result += ch; continue; }
      if (ch === '"') { quote = quote === '"' ? null : '"'; result += ch; continue; }
      if (ch === '\\' && quote === '"' && source[i + 1] === '"') { result += ch + source[i + 1]; i += 1; continue; }
      if (ch === '$') {
        const match = /^\{([A-Za-z_][A-Za-z0-9_]*)\}|^([A-Za-z_][A-Za-z0-9_]*)/.exec(source.slice(i + 1));
        const value = match ? this.variable(match[1] || match[2]) : undefined;
        if (value !== undefined) {
          const needsQuotes = protect && !quote && /[\s"'|&;<>]/.test(value);
          result += needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : (quote && protect ? value.replace(/"/g, '\\"') : value);
          i += match[0].length;
          continue;
        }
      }
      result += ch;
    }
    return result;
  }

  /** Environnement des programmes lances par le Terminal : le systeme, plus ses variables. */
  programEnv() {
    return { ...process.env, ...Object.fromEntries(this.variables) };
  }

  /**
   * Developpe un alias en tete de ligne. `depth` borne les alias en cascade
   * pour eviter qu'un alias circulaire ne boucle indefiniment.
   */
  expandAlias(line, depth = 0) {
    if (depth > 8) return line;
    const trimmed = String(line).trim();
    const space = trimmed.search(/\s/);
    const head = space === -1 ? trimmed : trimmed.slice(0, space);
    const tail = space === -1 ? '' : trimmed.slice(space);
    if (!this.aliases.has(head)) return trimmed;
    return this.expandAlias(this.aliases.get(head) + tail, depth + 1);
  }

  snapshot() {
    return {
      cwd: this.cwd,
      history: this.history,
      aliases: Object.fromEntries(this.aliases),
      servers: Object.fromEntries(this.servers),
      variables: Object.fromEntries(this.variables)
    };
  }

  persist() {
    if (this.storage && typeof this.storage.save === 'function') {
      try {
        this.storage.save(this.snapshot());
      } catch {
        // La persistance est un confort, jamais une raison de casser une commande.
      }
    }
  }
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** Persistance sur disque, prete a l'emploi pour Electron ou le CLI. */
function fileStorage(filePath) {
  return {
    load() {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        return {};
      }
    },
    save(state) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
    }
  };
}

module.exports = { Session, fileStorage, MAX_HISTORY, VARIABLE_NAME };
