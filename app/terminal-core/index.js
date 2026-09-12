'use strict';

const fs = require('fs');
const { Registry, requiresConfirmation, suggestFlag } = require('./registry');
const { Session, fileStorage } = require('./session');
const { parse, splitCommand, tokenize } = require('./parser');
const { parseChain, isSimple, hasOperators, lastSegment } = require('./chain');
const { pipeData, units, toText, toCsv } = require('./pipe');
const out = require('./output');
const platform = require('./platform');
const builtins = require('./commands');
const { ServerManager } = require('./servers');
const { validateOptions } = require('./options');

/** Profondeur maximale d'alias qui enchainent d'autres alias. */
const MAX_ALIAS_DEPTH = 4;

/** L'onglet de toujours : sa session est celle qui est conservee d'un lancement a l'autre. */
const MAIN_TAB = 'main';

/**
 * Moteur du Terminal.
 *
 * Ne connait ni Electron ni le DOM : il recoit une ligne de texte et rend
 * des blocs de sortie structures. L'application Electron et la version
 * console les affichent chacune a sa maniere.
 *
 *   const term = createTerminal();
 *   const res = await term.execute('find rapport.pdf --all');
 *   res.blocks.forEach(render);
 */
class Terminal {
  constructor(options = {}) {
    validateOptions(options);
    this.registry = new Registry();
    this.session = new Session(options);
    this.options = options;
    this.name = options.name || 'TERMINAL';
    this.version = options.version || require('../package.json').version;
    // Serveurs demarres par ce Terminal : `start`, `stop`, `exit`, et
    // l'application a sa fermeture (`terminal.servers.stopAll()`).
    this.servers = new ServerManager();
    // Ouvre fichiers, dossiers et pages web pour `access`. L'application
    // Electron fournit le sien (shell.openPath) ; les tests aussi.
    this.open = options.opener || platform.openTarget;
    // Demarrage avec Windows pour `demarrage` : `{ get(), set(enabled) }`,
    // fourni par l'application Electron. La console n'en a pas.
    this.startup = options.startup || null;
    // Surveillance de fond de l'application : boite noire et suivi de la sante.
    this.blackbox = options.blackbox || null;
    this.healthWatch = options.healthWatch || null;
    // Essais guides (`essai`) : notification et touches, observees par l'application.
    this.selftest = options.selftest || null;
    // Console des programmes interactifs (`run python`) : `{ open(spec) }`.
    // L'application en ouvre une vraie (node-pty) ; la version console passe
    // son propre clavier au programme.
    this.console = options.console || null;
    // Onglets de l'application : chacun sa session (dossier, resultats, serveur
    // courant), le reste partage. Sans onglet (console, tests) : `main`.
    this.tabs = new Map([[MAIN_TAB, this.session]]);
    this.openTabs = new Set([MAIN_TAB]);

    if (options.builtins !== false) this.registry.registerAll(builtins);
    if (Array.isArray(options.commands)) this.registry.registerAll(options.commands);
  }

  register(command) { return this.registry.register(command); }
  registerAll(commands) { return this.registry.registerAll(commands); }
  unregister(name) { return this.registry.unregister(name); }
  commands() { return this.registry.list(); }

  // --- Onglets -------------------------------------------------------------------

  /** Session d'un onglet ; sans onglet, ou onglet inconnu, celle de toujours. */
  sessionFor(tab) {
    return (tab && this.tabs.get(tab)) || this.session;
  }

  /** Nouvel onglet, qui demarre dans le dossier de l'onglet `from`. */
  openTab(id, { from } = {}) {
    const key = String(id == null ? '' : id);
    if (!/^[\w-]{1,40}$/.test(key)) throw new Error(`Identifiant d'onglet invalide : ${key}`);
    if (!this.tabs.has(key)) this.tabs.set(key, this.session.forTab(this.sessionFor(from)));
    this.openTabs.add(key);
    return this.tabs.get(key);
  }

  /** Onglet ferme : son dossier et ses resultats disparaissent (`main` reste, pour la persistance). */
  closeTab(id) {
    const existed = this.openTabs.delete(id);
    if (id !== MAIN_TAB) this.tabs.delete(id);
    return existed;
  }

  /**
   * La commande qu'executerait une ligne, sans l'executer : alias developpes,
   * raccourci `!` traduit, variables (`$NOM`) remplacees.
   *
   * @returns {{ command: Object|null, name: string, rest: string, expanded: string }}
   * @throws si la ligne est mal formee (guillemet non ferme...)
   */
  resolveCommand(line, session = this.session) {
    const trimmed = String(line == null ? '' : line).trim();
    // `!git status` est un raccourci pour `run git status`.
    const expanded = session.expandVariables(trimmed.startsWith('!')
      ? `run ${trimmed.slice(1).trim()}`
      : session.expandAlias(trimmed));
    const { name, rest } = splitCommand(expanded);
    return { command: name ? this.registry.get(name) : null, name, rest, expanded };
  }

  /**
   * Les commandes d'une ligne, enchainements compris. Un alias qui enchaine
   * lui-meme plusieurs commandes est developpe.
   *
   * @returns {Array<{ text, index, group, command, name, rest, expanded }>}
   *          `index` : rang dans son tube (0 : la premiere, qui ne lit rien).
   * @throws si la ligne est mal formee
   */
  stagesOf(line, depth = 0, session = this.session) {
    const found = [];
    for (const group of parseChain(line)) {
      group.stages.forEach((text, index) => {
        const resolved = this.resolveCommand(text, session);
        if (depth < MAX_ALIAS_DEPTH && resolved.expanded !== text.trim() && hasOperators(resolved.expanded)) {
          found.push(...this.stagesOf(resolved.expanded, depth + 1, session));
          return;
        }
        found.push({ text, index, group, ...resolved });
      });
    }
    return found;
  }

  /**
   * Faut-il une confirmation avant d'executer la ligne, et pourquoi ?
   * Commande sensible (ou sous-commande listee dans `confirmWhen`) a n'importe
   * quelle place de l'enchainement, ou fichier existant remplace par `>`.
   *
   * @param {{ tab?: string }} options  l'onglet dont le dossier compte pour `>`
   * @returns {{ required: boolean, reasons: string[] }}
   */
  confirmation(line, { tab } = {}) {
    const session = this.sessionFor(tab);
    let stages;
    try {
      stages = this.stagesOf(line, 0, session);
    } catch {
      // Ligne mal formee : l'execution le dira elle-meme.
      return { required: false, reasons: [] };
    }
    const reasons = [];
    const groups = new Set();
    for (const stage of stages) {
      groups.add(stage.group);
      if (!stage.command) continue;
      let args = [];
      try {
        ({ args } = parse(stage.rest, stage.command.flags, stage.command.short));
      } catch {
        // Idem : la commande expliquera.
      }
      if (requiresConfirmation(stage.command, args)) reasons.push(`${stage.text.trim()} : ${stage.command.summary}`);
    }
    for (const group of groups) {
      if (!group.redirect || group.redirect.mode !== 'write') continue;
      const file = session.resolve(session.expandVariables(group.redirect.target, { quote: false }));
      if (fs.existsSync(file)) reasons.push(`> ${group.redirect.target} : remplace le fichier existant ${file}`);
    }
    return { required: reasons.length > 0, reasons };
  }

  /**
   * La ligne demanderait-elle une confirmation ? `watch` s'en sert pour
   * refuser de relancer en boucle ce qui exige un accord a chaque fois.
   */
  requiresConfirmation(line, options = {}) {
    return this.confirmation(line, options).required;
  }

  /**
   * Execute une ligne de commande, enchainements compris (`a && b`, `a | b`,
   * `a > fichier`).
   *
   * @param {string} line
   * @param {{onBlock?:Function, signal?:AbortSignal, record?:boolean, interactive?:boolean, tab?:string}} options
   *        `interactive` : la sortie va a l'ecran d'un utilisateur, qui peut
   *        repondre a un programme (`run python` ouvre alors une console).
   *        `tab` : l'onglet ou la ligne est tapee (son dossier, ses resultats).
   * @returns {Promise<{ok:boolean, blocks:Array, offset:number, durationMs:number, command:string|null}>}
   *          `blocks` commence a l'indice `offset` du flux (voir `frame`).
   */
  async execute(line, options = {}) {
    const started = Date.now();
    const blocks = [];
    // Un bloc de controle `frame` (watch) remplace tout ce qui le precede : le
    // moteur ne garde que la derniere image, et `offset` dit ou elle commence
    // dans le flux. Une surveillance de plusieurs heures n'enfle pas la memoire.
    let offset = 0;
    const emit = (block) => {
      if (!block) return;
      if (block.type === 'control' && block.action === 'frame') {
        offset += blocks.length;
        blocks.length = 0;
      }
      blocks.push(block);
      if (typeof options.onBlock === 'function') options.onBlock(block);
    };

    const raw = String(line == null ? '' : line);
    const finish = (ok, commandName = null) => ({
      ok,
      blocks,
      offset,
      durationMs: Date.now() - started,
      command: commandName
    });

    if (!raw.trim()) return finish(true);
    const session = this.sessionFor(options.tab);
    if (options.record !== false) session.pushHistory(raw);

    let chain;
    try {
      chain = parseChain(raw);
    } catch (err) {
      // Guillemet non ferme, commande manquante apres && : on l'explique.
      emit(out.error(err.message));
      return finish(false);
    }
    if (!chain.length) return finish(true);

    // Tout est verifie avant de rien lancer : une faute de frappe en fin de
    // ligne ne doit pas laisser la premiere moitie s'executer seule.
    if (!isSimple(chain)) {
      const problems = this.checkChain(raw, session);
      if (problems.length) {
        problems.forEach(emit);
        return finish(false);
      }
    }

    const io = {
      emit,
      signal: options.signal,
      interactive: Boolean(options.interactive),
      session,
      tab: options.tab || null
    };
    const result = await this.runChain(chain, io, 0);
    return finish(result.ok, result.command);
  }

  /** Commandes inconnues, tubes vers une commande qui ne lit rien, `watch` enchaine. */
  checkChain(line, session = this.session) {
    let stages;
    try {
      stages = this.stagesOf(line, 0, session);
    } catch (err) {
      return [out.error(err.message)];
    }
    for (const stage of stages) {
      if (!stage.name) continue;
      if (!stage.command) {
        const blocks = [out.error(`Commande inconnue : ${stage.name} - rien n'a ete execute.`)];
        const suggestions = this.registry.suggest(stage.name);
        if (suggestions.length) blocks.push(out.dim(`Vouliez-vous dire : ${suggestions.join(', ')} ?`));
        return blocks;
      }
      if (stage.command.name === 'watch') {
        return [out.error('watch s\'utilise seul sur la ligne. Pour surveiller un enchainement, mettez-le entre guillemets : watch "ps | grep node"')];
      }
      if (stage.index > 0 && !stage.command.acceptsInput) return [out.error(this.pipeRefusal(stage.command.name))];
    }
    return [];
  }

  pipeRefusal(name) {
    const readers = this.registry.list().filter((c) => c.acceptsInput).map((c) => c.name);
    return `${name} ne lit pas de tube : rien n'a ete execute. Commandes qui en lisent un : ${readers.join(', ')}.`;
  }

  /** `&&` : seulement si le precedent a reussi ; `||` : seulement s'il a echoue. */
  async runChain(chain, io, depth) {
    let ok = true;
    let command = null;
    for (const group of chain) {
      if (group.op === '&&' && !ok) continue;
      if (group.op === '||' && ok) continue;
      if (io.signal && io.signal.aborted) return { ok: false, command };
      const result = await this.runPipeline(group, io, depth);
      ok = result.ok;
      command = result.command || command;
    }
    return { ok, command };
  }

  /**
   * `a | b | c > fichier` : la sortie de chaque commande passe a la suivante.
   * Erreurs et avertissements restent a l'ecran ; le premier echec arrete le tube.
   */
  async runPipeline({ stages, redirect }, io, depth) {
    let input = null;
    let result = { ok: true, command: null };
    for (let i = 0; i < stages.length; i += 1) {
      const toScreen = i === stages.length - 1 && !redirect;
      const captured = [];
      const emit = toScreen ? io.emit : (block) => {
        if (block && block.type === 'text' && (block.tone === 'error' || block.tone === 'warn')) io.emit(block);
        else captured.push(block);
      };
      result = await this.runStage(stages[i], { ...io, emit, interactive: io.interactive && toScreen }, { input, depth });
      if (!result.ok) return result;
      input = toScreen ? null : pipeData(captured);
    }
    return redirect ? this.writeRedirect(redirect, input, io, result.command) : result;
  }

  /** `> fichier` remplace, `>> fichier` ajoute. Un .csv s'ouvre dans Excel. */
  writeRedirect(redirect, blocks, io, command) {
    const file = io.session.resolve(io.session.expandVariables(redirect.target, { quote: false }));
    const csv = /\.csv$/i.test(file);
    const append = redirect.mode === 'append';
    try {
      let existing = false;
      try { existing = fs.statSync(file).size > 0; } catch { existing = false; }
      if (append && existing) {
        fs.appendFileSync(file, csv ? toCsv(blocks, { header: false }) : toText(blocks), 'utf8');
      } else {
        // BOM : sans lui, Excel lit un CSV en ANSI et casse les accents.
        fs.writeFileSync(file, csv ? `\ufeff${toCsv(blocks)}` : toText(blocks), 'utf8');
      }
    } catch (err) {
      const reason = err.code === 'ENOENT' ? 'dossier introuvable' : err.code === 'EISDIR' ? 'c\'est un dossier' : err.message;
      io.emit(out.error(`Ecriture impossible dans ${file} : ${reason}.`));
      return { ok: false, command };
    }
    const count = units(blocks).length;
    const plural = count > 1 ? 's' : '';
    io.emit(out.success(append
      ? `${count} ligne${plural} ajoutee${plural} a ${file}`
      : `${count} ligne${plural} ecrite${plural} dans ${file}`));
    return { ok: true, command };
  }

  /** Une commande seule. `input` : les blocs recus par un tube, ou null. */
  async runStage(text, io, { input = null, depth = 0 } = {}) {
    const { emit } = io;
    const fail = (commandName = null) => ({ ok: false, command: commandName });

    let resolved;
    try {
      resolved = this.resolveCommand(text, io.session);
    } catch (err) {
      emit(out.error(err.message));
      return fail();
    }

    const { command, name, rest, expanded } = resolved;
    if (!name) return { ok: true, command: null };

    // Alias qui enchaine plusieurs commandes (`alias maj = "a && b"`).
    if (expanded !== text.trim() && hasOperators(expanded)) {
      if (input) {
        emit(out.error(`L'alias ${text.trim().split(/\s+/)[0]} enchaine plusieurs commandes : il ne peut pas lire un tube.`));
        return fail();
      }
      if (depth >= MAX_ALIAS_DEPTH) {
        emit(out.error('Trop d\'alias imbriques.'));
        return fail();
      }
      let chain;
      try {
        chain = parseChain(expanded);
      } catch (err) {
        emit(out.error(err.message));
        return fail();
      }
      return this.runChain(chain, io, depth + 1);
    }

    if (!command) {
      emit(out.error(`Commande inconnue : ${name}`));
      const suggestions = this.registry.suggest(name);
      if (suggestions.length) {
        emit(out.dim(`Vouliez-vous dire : ${suggestions.join(', ')} ?`));
      }
      emit(out.dim('Tapez `help` pour la liste des commandes.'));
      return fail();
    }

    if (input && !command.acceptsInput) {
      emit(out.error(this.pipeRefusal(command.name)));
      return fail(command.name);
    }

    // Synonymes d'options (`--depth` pour `--profondeur`) : meme type, et la
    // commande ne voit que le nom principal.
    const flagAliases = command.flagAliases || {};
    let parsed;
    try {
      const spec = { ...command.flags };
      for (const [alias, target] of Object.entries(flagAliases)) spec[alias] = command.flags[target];
      parsed = parse(rest, spec, command.short);
      for (const [alias, target] of Object.entries(flagAliases)) {
        if (!(alias in parsed.flags)) continue;
        if (!(target in parsed.flags)) parsed.flags[target] = parsed.flags[alias];
        delete parsed.flags[alias];
      }
    } catch (err) {
      emit(out.error(err.message));
      emit(out.dim(`Usage : ${command.usage}`));
      return fail(command.name);
    }

    // Une option inconnue est refusee plutot qu'avalee : `tree --depth 1`
    // cherchait sinon un dossier « 1 ». `passthrough` : la ligne appartient a
    // une autre commande (run, watch) ou est prise telle quelle (alias, echo).
    if (!command.passthrough) {
      const known = Object.keys(command.flags || {});
      const unknown = Object.keys(parsed.flags).filter((flag) => !known.includes(flag));
      if (unknown.length) {
        const described = unknown.map((flag) => {
          const guess = suggestFlag(flag, [...known, ...Object.keys(flagAliases)]);
          return guess ? `--${flag} (vouliez-vous dire --${guess} ?)` : `--${flag}`;
        });
        emit(out.error(`Option inconnue pour ${command.name} : ${described.join(', ')}.`));
        emit(out.dim(known.length
          ? `Ses options : ${known.map((flag) => `--${flag}`).join(', ')} - help ${command.name} pour le detail.`
          : `${command.name} n'a pas d'option.`));
        return fail(command.name);
      }
    }

    const ctx = {
      args: parsed.args,
      flags: parsed.flags,
      raw: rest,
      line: expanded,
      command,
      terminal: this,
      session: io.session,
      // Onglet de la ligne (null hors de l'application) : `watch` le garde, `exit` le ferme.
      tab: io.tab,
      registry: this.registry,
      signal: io.signal,
      // Blocs recus par un tube (`ps | grep node`), ou null.
      input,
      // Console ou un programme peut dialoguer avec l'utilisateur : seulement
      // quand la sortie va a l'ecran (pas dans un tube, un fichier ou `watch`).
      console: io.interactive && this.console ? this.console : null,
      out,
      platform,
      emit,
      resolve: (target) => io.session.resolve(target),
      get cwd() { return ctx.session.cwd; }
    };

    try {
      const result = await command.run(ctx);
      // Une commande peut renvoyer un bloc ou un tableau de blocs plutot
      // que d'appeler emit() : les deux styles sont acceptes.
      if (Array.isArray(result)) result.forEach(emit);
      else if (result && typeof result === 'object' && result.type) emit(result);
      return { ok: true, command: command.name };
    } catch (err) {
      if (err && err.name === 'AbortError') {
        emit(out.warn('Commande interrompue.'));
        return fail(command.name);
      }
      emit(out.error(err && err.message ? err.message : String(err)));
      return fail(command.name);
    }
  }

  /**
   * Completions pour la touche Tab : noms de commandes sur le premier mot,
   * puis delegation a la commande si elle sait completer ses arguments.
   * Dans un enchainement, seule la derniere commande est completee ; apres
   * un tube, seules les commandes qui en lisent un sont proposees.
   */
  async complete(line, { tab } = {}) {
    const session = this.sessionFor(tab);
    const { segment: value, op } = lastSegment(String(line || ''));
    if (op === '>' || op === '>>') return [];
    let split;
    try {
      split = splitCommand(value);
    } catch {
      return []; // guillemet ouvert en cours de frappe : rien a proposer
    }
    const { name, rest } = split;
    const endsWithSpace = /\s$/.test(value);

    if (!name || (!endsWithSpace && !rest)) {
      const prefix = name.toLowerCase();
      return this.registry.names()
        .filter((candidate) => candidate.startsWith(prefix))
        .filter((candidate) => op !== '|' || this.registry.get(candidate).acceptsInput);
    }

    const command = this.registry.get(name);
    if (!command) return [];
    if (typeof command.complete === 'function') {
      const tokens = tokenize(rest).map((t) => t.value);
      const partial = endsWithSpace ? '' : (tokens[tokens.length - 1] || '');
      return command.complete({ partial, tokens, session, terminal: this });
    }
    return Object.keys(command.flags || {}).map((flag) => `--${flag}`);
  }

  /** Banniere d'accueil, partagee par l'application et la console. */
  banner() {
    const info = platform.hostInfo();
    return [
      out.title(this.name, `v${this.version}`),
      out.dim(`${info.user}@${info.host} - ${info.platform} ${info.release} (${info.arch})`),
      out.dim('`help` pour la liste des commandes, `find <nom>` pour chercher un fichier.'),
      out.blank()
    ];
  }
}

function createTerminal(options = {}) {
  return new Terminal(options);
}

module.exports = {
  MAIN_TAB,
  createTerminal,
  Terminal,
  Registry,
  Session,
  fileStorage,
  parse,
  tokenize,
  splitCommand,
  out,
  platform,
  builtins
};
