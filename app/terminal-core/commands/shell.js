'use strict';

const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { IS_WINDOWS } = require('../platform');
const { killTree } = require('../servers');
const { unquoteWhole } = require('../chain');
const { toText } = require('../pipe');

/** Code de sortie d'un programme arrete par Ctrl+C (STATUS_CONTROL_C_EXIT). */
const CTRL_C_EXIT = new Set([3221225786, -1073741510]);

/**
 * Passe-plat vers le shell natif, avec sortie en direct.
 *
 * Le Terminal ne cherche pas a reimplementer PowerShell : quand une commande
 * dediee n'existe pas, `run` (ou le prefixe `!`) laisse la main au systeme.
 * La sortie s'affiche au fil de l'eau : `npm install` ou `git clone` montrent
 * leur avancement au lieu de rester muets jusqu'a la fin.
 */

/** Au-dela, les lignes sont comptees mais plus affichees. */
const MAX_LINES = 2000;
/** Les lignes sont regroupees par paquets : un bloc par ligne noierait l'interface. */
const FLUSH_MS = 80;

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
/** Sequences ANSI (couleurs, curseur, titres) : illisibles dans un bloc de texte. */
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, 'g');

/**
 * Options du Terminal placees AVANT la commande ; tout le reste part tel
 * quel au shell. Sans cette regle, `run npm test --delai 5` enverrait
 * `--delai 5` a npm.
 */
function splitLeadingFlags(raw) {
  let rest = String(raw || '').trim();
  const options = { cmd: false, delai: 0, texte: false };
  for (;;) {
    const cmd = /^--cmd(?:\s+|$)/.exec(rest);
    if (cmd) { options.cmd = true; rest = rest.slice(cmd[0].length); continue; }
    const texte = /^--texte(?:\s+|$)/.exec(rest);
    if (texte) { options.texte = true; rest = rest.slice(texte[0].length); continue; }
    const delai = /^--delai(?:=|\s+)(\d+)(?:\s+|$)/.exec(rest);
    if (delai) { options.delai = Number(delai[1]); rest = rest.slice(delai[0].length); continue; }
    return { options, command: rest.trim() };
  }
}

/**
 * `interactive` : dans une console, le programme peut poser des questions
 * (PowerShell sans -NonInteractive).
 */
function shellInvocation(command, kind, { interactive = false } = {}) {
  if (kind === 'cmd') return ['cmd.exe', ['/d', '/s', '/c', command]];
  if (kind === 'powershell') {
    // Sortie en UTF-8 : sans cela, PowerShell 5 ecrit dans la page de code
    // OEM et les accents arrivent casses.
    const prelude = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
    // Sans epilogue, `powershell -Command` ramene tout echec au code 1 : un
    // programme qui sort en 3 serait rapporte « code 1 ». On transmet le vrai
    // code. `$?` est releve en premier : toute autre instruction le remettrait
    // a vrai. Sur sa propre ligne, pour qu'un commentaire final ne l'avale pas.
    const epilogue = '\n$terminalOk = $?; $terminalCode = $LASTEXITCODE; '
      + 'if ($null -ne $terminalCode -and $terminalCode -ne 0) { exit $terminalCode } '
      + 'elseif (-not $terminalOk) { exit 1 }';
    const mode = interactive ? ['-NoLogo'] : ['-NonInteractive'];
    return ['powershell.exe', ['-NoProfile', ...mode, '-ExecutionPolicy', 'Bypass', '-Command', prelude + command + epilogue]];
  }
  return ['/bin/sh', ['-c', command]];
}

/**
 * Ligne telle qu'on la verrait a l'ecran : une barre de progression qui se
 * reecrit avec `\r` ne garde que son dernier etat.
 */
function visible(line) {
  const clean = line.replace(/\r$/, '');
  const cut = clean.lastIndexOf('\r');
  return (cut === -1 ? clean : clean.slice(cut + 1)).replace(ANSI, '');
}

/** Decoupe un flux d'octets en lignes completes, sans casser un caractere UTF-8. */
function lineReader(onLine) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const feed = (text) => {
    pending += text;
    const parts = pending.split('\n');
    pending = parts.pop();
    for (const part of parts) onLine(visible(part));
  };
  return {
    write: (chunk) => feed(decoder.write(chunk)),
    end() {
      feed(decoder.end());
      if (pending) onLine(visible(pending));
      pending = '';
    }
  };
}

/**
 * Programme ouvert dans une console de l'hote : l'interface l'affiche (bloc
 * `console`) et lui passe le clavier. On attend sa fin.
 */
async function runInConsole(ctx, session, options, command) {
  ctx.emit(ctx.out.console(session.id, command));

  let stopped = null;
  const stop = (reason) => {
    if (stopped) return;
    stopped = reason;
    session.kill();
  };
  const onAbort = () => stop('abort');
  if (ctx.signal) {
    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener('abort', onAbort, { once: true });
  }
  const limit = options.delai ? setTimeout(() => stop('timeout'), options.delai * 1000) : null;

  let code;
  try {
    code = await session.done;
  } finally {
    if (limit) clearTimeout(limit);
    if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
  }

  if (stopped === 'abort' || CTRL_C_EXIT.has(code)) {
    throw Object.assign(new Error('Commande interrompue.'), { name: 'AbortError' });
  }
  if (stopped === 'timeout') throw new Error(`Delai de ${options.delai} s depasse : commande arretee.`);
  if (code !== 0) throw new Error(`Code de sortie ${code}.`);
  return null;
}

const shell = {
  name: 'run',
  aliases: ['sh', 'exec'],
  category: 'Systeme',
  summary: 'Execute une commande dans le shell natif, avec sa sortie en direct.',
  usage: 'run [--cmd] [--texte] [--delai <secondes>] <commande>',
  details: [
    'Raccourci : prefixer une ligne par « ! » revient au meme.',
    '  !git status',
    '',
    'Dans l\'application, le programme s\'ouvre dans une vraie console : il peut',
    'poser des questions, afficher ses couleurs, redessiner l\'ecran (python,',
    'node, ssh, npm init...). Le clavier va au programme ; Ctrl+C l\'interrompt,',
    'le bouton ARRETER l\'arrete avec tout ce qu\'il a lance. Ctrl+C avec du',
    'texte selectionne copie, Ctrl+V colle.',
    '',
    'Dans un tube ou vers un fichier, la sortie est du texte :',
    '`run git log --oneline | grep fix`, `ls | run findstr x` (le programme',
    'lit alors la sortie recue).',
    '',
    'Les options du Terminal se placent AVANT la commande : tout ce qui suit',
    'est transmis tel quel au shell (`run --cmd dir`, `run npm test --watch`).',
    'Pour un tube du shell natif, mettez toute la commande entre guillemets :',
    '  run "Get-Process | Sort-Object CPU -Descending"'
  ].join('\n'),
  // La ligne appartient au shell : ses options ne sont pas celles du Terminal.
  passthrough: true,
  acceptsInput: true,
  flags: { cmd: 'boolean', texte: 'boolean', delai: 'number' },
  flagHelp: {
    cmd: 'Utiliser cmd.exe plutot que PowerShell.',
    texte: 'Sortie en texte, sans console : le programme ne peut rien demander.',
    delai: 'Arreter la commande apres ce nombre de secondes (defaut : aucune limite).'
  },
  examples: ['run git status', '!python', 'run --cmd dir', 'run --delai 10 ping 1.1.1.1 -t', 'run git log --oneline | head 5'],
  dangerous: true,

  async run(ctx) {
    const { options, command: typed } = splitLeadingFlags(ctx.raw);
    // Entre guillemets, la ligne entiere va au shell natif, tubes compris.
    const command = unquoteWhole(typed);
    if (!command) throw new Error('Indiquez la commande a executer.');

    const kind = options.cmd ? 'cmd' : (IS_WINDOWS ? 'powershell' : 'sh');

    // --- Console : le programme dialogue avec l'utilisateur -------------------
    if (ctx.console && !options.texte && !ctx.input) {
      const [file, args] = shellInvocation(command, kind, { interactive: true });
      let session = null;
      try {
        session = ctx.console.open({ file, args, cwd: ctx.session.cwd, env: ctx.session.programEnv() });
      } catch (err) {
        ctx.emit(ctx.out.dim(`Console indisponible (${err.message}) : sortie affichee en texte.`));
      }
      if (session) return runInConsole(ctx, session, options, command);
    }

    const [file, args] = shellInvocation(command, kind);

    // --- Lignes regroupees, dans l'ordre, stdout et stderr confondus -------
    let shown = 0;
    let hidden = 0;
    let queue = [];

    const flush = () => {
      if (!queue.length) return;
      let group = null;
      for (const item of queue) {
        if (group && group.lang === item.lang) {
          group.lines.push(item.line);
        } else {
          if (group) ctx.emit(ctx.out.code(group.lines.join('\n'), group.lang));
          group = { lang: item.lang, lines: [item.line] };
        }
      }
      ctx.emit(ctx.out.code(group.lines.join('\n'), group.lang));
      queue = [];
    };

    const collect = (lang) => (line) => {
      if (shown >= MAX_LINES) { hidden += 1; return; }
      shown += 1;
      queue.push({ lang, line });
    };

    // Hors console, stdin recoit la sortie du tube, ou rien : un programme qui
    // attend une saisie recoit une fin de fichier au lieu de bloquer.
    // Les variables du Terminal (`set`) font partie de son environnement.
    const child = spawn(file, args, {
      cwd: ctx.session.cwd,
      env: ctx.session.programEnv(),
      windowsHide: true,
      stdio: [ctx.input ? 'pipe' : 'ignore', 'pipe', 'pipe']
    });
    if (ctx.input) {
      // Un programme qui se termine sans tout lire ferme son entree : sans importance.
      child.stdin.on('error', () => {});
      child.stdin.end(toText(ctx.input));
    }
    const stdout = lineReader(collect(''));
    // stderr n'est pas forcement une erreur : git y ecrit sa progression.
    const stderr = lineReader(collect('stderr'));
    child.stdout.on('data', (chunk) => stdout.write(chunk));
    child.stderr.on('data', (chunk) => stderr.write(chunk));
    const ticker = setInterval(flush, FLUSH_MS);

    // --- Arret : Echap ou delai --------------------------------------------
    // Tuer le seul shell laisserait tourner ce qu'il a lance (git, npm...) :
    // on arrete toute l'arborescence.
    let stopped = null;
    const stop = (reason) => {
      if (stopped) return;
      stopped = reason;
      killTree(child.pid);
    };
    const onAbort = () => stop('abort');
    if (ctx.signal) {
      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener('abort', onAbort, { once: true });
    }
    const limit = options.delai ? setTimeout(() => stop('timeout'), options.delai * 1000) : null;

    let exitCode;
    try {
      exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => resolve(code == null ? -1 : code));
      });
    } finally {
      clearInterval(ticker);
      if (limit) clearTimeout(limit);
      if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
    }

    stdout.end();
    stderr.end();
    flush();
    if (hidden) ctx.emit(ctx.out.dim(`${hidden} ligne(s) de plus non affichee(s) (limite de ${MAX_LINES}).`));

    if (stopped === 'abort') throw Object.assign(new Error('Commande interrompue.'), { name: 'AbortError' });
    if (stopped === 'timeout') throw new Error(`Delai de ${options.delai} s depasse : commande arretee.`);
    if (exitCode !== 0) throw new Error(`Code de sortie ${exitCode}.`);
    if (!shown && !hidden) return ctx.out.success('Termine, aucune sortie.');
    return null;
  }
};

module.exports = [shell];
module.exports.splitLeadingFlags = splitLeadingFlags;
