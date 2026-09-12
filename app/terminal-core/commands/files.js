'use strict';

const fs = require('fs');
const fsp = fs.promises;
const { spawn } = require('child_process');
const path = require('path');
const { formatBytes, formatDate, run, IS_WINDOWS, psQuote } = require('../platform');
const { fold } = require('../text');
const { contentWords, buildContentQuery, queryContent, selectPaths, toScopeUrl, NOISE } = require('../windows-index');
const { units, rebuild } = require('../pipe');

// Un octet nul est le marqueur le plus fiable d’un binaire lu comme du texte.
const NUL_BYTE = String.fromCharCode(0);

/** Documents binaires : l'index en connait le texte, pas une lecture brute. */
const BINARY_DOCS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.epub', '.msg', '.one']);

/** Au-dela, un fichier n'est pas lu en entier : un gros binaire ne contient pas de texte utile. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const CATEGORY = 'Fichiers';

/** Completion sur les chemins : propose les entrees du dossier vise. */
function completePath(onlyDirs = false) {
  return async ({ partial, session }) => {
    const value = partial || '';
    const hasSep = value.includes('/') || value.includes('\\');
    const dir = hasSep ? session.resolve(path.dirname(value)) : session.cwd;
    const prefix = hasSep ? path.basename(value) : value;
    const head = hasSep ? value.slice(0, value.length - prefix.length) : '';
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => (!onlyDirs || e.isDirectory()) && e.name.toLowerCase().startsWith(prefix.toLowerCase()))
        .map((e) => head + e.name + (e.isDirectory() ? path.sep : ''));
    } catch {
      return [];
    }
  };
}

const pwd = {
  name: 'pwd',
  aliases: ['ou'],
  category: CATEGORY,
  summary: 'Affiche le dossier courant.',
  usage: 'pwd',
  run: (ctx) => ctx.out.path(ctx.session.cwd)
};

const cd = {
  name: 'cd',
  category: CATEGORY,
  summary: 'Change de dossier.',
  usage: 'cd <dossier|n>',
  details: [
    '`cd` sans argument revient au dossier utilisateur, `cd -` au dossier precedent.',
    '`cd 3` va dans le dossier du 3e resultat de la derniere recherche (find, grep).'
  ].join('\n'),
  examples: ['cd ~/Documents', 'cd ..', 'cd -', 'cd 3'],
  complete: completePath(true),
  run(ctx) {
    const target = ctx.args[0];
    const previous = ctx.session.cwd;

    if (!target) ctx.session.setCwd(ctx.session.home);
    else if (target === '-') {
      const back = ctx.session.vars.get('OLDPWD');
      if (!back) throw new Error('Aucun dossier precedent.');
      ctx.session.setCwd(back);
    } else {
      let dir = ctx.session.resolveTarget(target);
      // Un resultat de find ou grep est souvent un fichier : on va dans son dossier.
      if (fs.existsSync(dir) && fs.statSync(dir).isFile()) dir = path.dirname(dir);
      ctx.session.setCwd(dir);
    }

    ctx.session.vars.set('OLDPWD', previous);
    return ctx.out.path(ctx.session.cwd);
  }
};

const ls = {
  name: 'ls',
  aliases: ['dir', 'liste'],
  category: CATEGORY,
  summary: 'Liste le contenu d\'un dossier.',
  usage: 'ls [dossier] [--tout] [--tri nom|taille|date]',
  flags: { tout: 'boolean', tri: 'string', inverse: 'boolean' },
  flagAliases: { all: 'tout', sort: 'tri', reverse: 'inverse' },
  flagHelp: {
    tout: 'Afficher aussi les elements caches.',
    tri: 'Trier par nom (defaut), taille ou date.',
    inverse: 'Inverser l\'ordre de tri.'
  },
  short: { a: 'tout', t: 'tri' },
  examples: ['ls', 'ls ~/Downloads --tri date --inverse'],
  complete: completePath(true),
  async run(ctx) {
    const dir = ctx.session.resolve(ctx.args[0] || '.');
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      throw new Error(err.code === 'ENOENT' ? `Dossier introuvable : ${dir}` : `Lecture impossible : ${dir}`);
    }

    const rows = [];
    for (const entry of entries) {
      if (!ctx.flags.tout && entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      let stat = null;
      try { stat = await fsp.stat(full); } catch { /* lien casse ou acces refuse */ }
      const isDir = entry.isDirectory();
      rows.push({
        nom: entry.name,
        type: isDir ? 'DIR' : (path.extname(entry.name).slice(1).toUpperCase() || 'FIC'),
        taille: isDir ? '-' : formatBytes(stat ? stat.size : 0),
        modifie: stat ? formatDate(stat.mtime) : '-',
        _dir: isDir,
        _size: stat ? stat.size : 0,
        _time: stat ? stat.mtimeMs : 0
      });
    }

    if (!rows.length) return ctx.out.dim('Dossier vide.');

    const tri = (ctx.flags.tri || 'nom').toLowerCase();
    const comparators = {
      nom: (a, b) => a.nom.localeCompare(b.nom, 'fr'),
      taille: (a, b) => b._size - a._size,
      date: (a, b) => b._time - a._time
    };
    const comparator = comparators[tri];
    if (!comparator) throw new Error('--tri accepte : nom, taille, date.');

    // Les dossiers restent groupes en tete, quel que soit le critere.
    rows.sort((a, b) => (a._dir === b._dir ? comparator(a, b) : a._dir ? -1 : 1));
    if (ctx.flags.inverse) rows.reverse();

    const dirs = rows.filter((r) => r._dir).length;
    return [
      ctx.out.table(
        [
          { key: 'nom', label: 'Nom' },
          { key: 'type', label: 'Type' },
          { key: 'taille', label: 'Taille', align: 'right' },
          { key: 'modifie', label: 'Modifie' }
        ],
        rows
      ),
      ctx.out.dim(`${dirs} dossier(s), ${rows.length - dirs} fichier(s) - ${dir}`)
    ];
  }
};

const cat = {
  name: 'cat',
  aliases: ['lire'],
  category: CATEGORY,
  summary: 'Affiche le contenu d\'un fichier texte.',
  usage: 'cat <fichier|n> [--lignes 200] [--fin]',
  details: '`cat 3` affiche le 3e resultat de la derniere recherche (find, grep).',
  flags: { lignes: 'number', fin: 'boolean' },
  flagAliases: { lines: 'lignes' },
  flagHelp: { lignes: 'Nombre de lignes affichees (defaut 200).', fin: 'Afficher la fin plutot que le debut.' },
  short: { n: 'lignes' },
  complete: completePath(false),
  async run(ctx) {
    if (!ctx.args[0]) throw new Error('Indiquez un fichier. Exemple : cat notes.txt');
    const file = ctx.session.resolveTarget(ctx.args[0]);

    let stat;
    try { stat = await fsp.stat(file); } catch { throw new Error(`Fichier introuvable : ${file}`); }
    if (stat.isDirectory()) throw new Error(`${file} est un dossier. Utilisez ls.`);
    if (stat.size > 8 * 1024 * 1024) throw new Error(`Fichier trop volumineux (${formatBytes(stat.size)}). Limite : 8 Mo.`);

    const content = await fsp.readFile(file, 'utf8');
    // Un octet nul est le signe le plus fiable d'un binaire lu comme du texte.
    if (content.includes(NUL_BYTE)) throw new Error('Fichier binaire : affichage impossible.');

    const lines = content.split(/\r?\n/);
    const max = Math.max(1, ctx.flags.lignes || 200);
    const shown = ctx.flags.fin ? lines.slice(-max) : lines.slice(0, max);

    const blocks = [ctx.out.code(shown.join('\n'), path.extname(file).slice(1))];
    if (lines.length > max) {
      blocks.push(ctx.out.dim(`${shown.length} lignes sur ${lines.length} - ${formatBytes(stat.size)}`));
    }
    return blocks;
  }
};

const tree = {
  name: 'tree',
  aliases: ['arbre'],
  category: CATEGORY,
  summary: 'Affiche l\'arborescence d\'un dossier.',
  usage: 'tree [dossier] [--profondeur 3]',
  flags: { profondeur: 'number', tout: 'boolean' },
  // `find` dit --depth : les deux noms marchent partout.
  flagAliases: { depth: 'profondeur' },
  flagHelp: { profondeur: 'Niveaux affiches (defaut 3).', tout: 'Inclure les elements caches.' },
  short: { p: 'profondeur' },
  complete: completePath(true),
  async run(ctx) {
    const root = ctx.session.resolve(ctx.args[0] || '.');
    const maxDepth = Math.max(1, ctx.flags.profondeur || 3);
    const lines = [];
    let dirs = 0;
    let files = 0;

    async function walk(dir, prefix, depth) {
      if (depth > maxDepth || lines.length > 2000) return;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const visible = entries
        .filter((e) => ctx.flags.tout || !e.name.startsWith('.'))
        .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name, 'fr') : a.isDirectory() ? -1 : 1));

      for (let i = 0; i < visible.length; i += 1) {
        const entry = visible[i];
        const last = i === visible.length - 1;
        lines.push(`${prefix}${last ? '└─ ' : '├─ '}${entry.name}${entry.isDirectory() ? path.sep : ''}`);
        if (entry.isDirectory()) {
          dirs += 1;
          await walk(path.join(dir, entry.name), `${prefix}${last ? '   ' : '│  '}`, depth + 1);
        } else files += 1;
      }
    }

    if (!fs.existsSync(root)) throw new Error(`Dossier introuvable : ${root}`);
    await walk(root, '', 1);

    return [
      ctx.out.path(root),
      ctx.out.code(lines.join('\n') || '(vide)'),
      ctx.out.dim(`${dirs} dossier(s), ${files} fichier(s)`)
    ];
  }
};

const mkdir = {
  name: 'mkdir',
  aliases: ['creer-dossier'],
  category: CATEGORY,
  summary: 'Cree un dossier (et ses parents si besoin).',
  usage: 'mkdir <dossier>',
  async run(ctx) {
    if (!ctx.args[0]) throw new Error('Indiquez le nom du dossier a creer.');
    const target = ctx.session.resolve(ctx.args[0]);
    await fsp.mkdir(target, { recursive: true });
    return ctx.out.success(`Dossier cree : ${target}`);
  }
};

const copy = {
  name: 'cp',
  aliases: ['copier'],
  category: CATEGORY,
  summary: 'Copie un fichier ou un dossier.',
  usage: 'cp <source> <destination> [--ecraser]',
  flags: { ecraser: 'boolean' },
  flagHelp: { ecraser: 'Autoriser le remplacement de la destination.' },
  complete: completePath(false),
  async run(ctx) {
    const [from, to] = ctx.args;
    if (!from || !to) throw new Error('Usage : cp <source> <destination>');
    const source = ctx.session.resolve(from);
    const dest = ctx.session.resolve(to);

    if (!fs.existsSync(source)) throw new Error(`Source introuvable : ${source}`);
    if (fs.existsSync(dest) && !ctx.flags.ecraser) {
      throw new Error(`${dest} existe deja. Ajoutez --ecraser pour le remplacer.`);
    }

    await fsp.cp(source, dest, { recursive: true, force: Boolean(ctx.flags.ecraser) });
    return ctx.out.success(`Copie : ${source} -> ${dest}`);
  }
};

const move = {
  name: 'mv',
  aliases: ['deplacer', 'renommer'],
  category: CATEGORY,
  summary: 'Deplace ou renomme un fichier ou un dossier.',
  usage: 'mv <source> <destination> [--ecraser]',
  flags: { ecraser: 'boolean' },
  complete: completePath(false),
  async run(ctx) {
    const [from, to] = ctx.args;
    if (!from || !to) throw new Error('Usage : mv <source> <destination>');
    const source = ctx.session.resolve(from);
    let dest = ctx.session.resolve(to);

    if (!fs.existsSync(source)) throw new Error(`Source introuvable : ${source}`);
    // `mv fichier.txt dossier/` deplace dedans plutot que d'ecraser le dossier.
    if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) {
      dest = path.join(dest, path.basename(source));
    }
    if (fs.existsSync(dest) && !ctx.flags.ecraser) {
      throw new Error(`${dest} existe deja. Ajoutez --ecraser pour le remplacer.`);
    }

    await fsp.rename(source, dest);
    return ctx.out.success(`Deplace : ${source} -> ${dest}`);
  }
};

const remove = {
  name: 'rm',
  aliases: ['supprimer'],
  category: CATEGORY,
  summary: 'Envoie un fichier ou un dossier a la corbeille.',
  usage: 'rm <chemin|n> [--definitif]',
  details: [
    'Par defaut, `rm` place l\'element dans la corbeille : une suppression',
    'reste annulable. `--definitif` efface sans retour possible et demande',
    'une confirmation explicite dans l\'interface.'
  ].join('\n'),
  flags: { definitif: 'boolean' },
  flagHelp: { definitif: 'Effacer reellement, sans passer par la corbeille.' },
  dangerous: true,
  complete: completePath(false),
  async run(ctx) {
    if (!ctx.args[0]) throw new Error('Indiquez ce qu\'il faut supprimer.');
    // `rm 3` : le 3e resultat de la derniere recherche (find, grep, nettoyer --gros).
    const target = ctx.session.resolveTarget(ctx.args[0]);
    if (!fs.existsSync(target)) throw new Error(`Introuvable : ${target}`);

    const parsed = path.parse(target);
    if (parsed.root === target) throw new Error('Refus : suppression de la racine d\'un disque.');
    if (target === ctx.session.home) throw new Error('Refus : suppression du dossier utilisateur.');

    if (ctx.flags.definitif) {
      await fsp.rm(target, { recursive: true, force: true });
      return ctx.out.warn(`Supprime definitivement : ${target}`);
    }

    if (!IS_WINDOWS) {
      throw new Error('La corbeille n\'est geree que sous Windows. Utilisez --definitif.');
    }

    // La corbeille passe par le shell Windows : Node n'a pas d'API pour ca.
    const script = `Add-Type -AssemblyName Microsoft.VisualBasic; `
      + `$p = ${psQuote(target)}; `
      + `if (Test-Path -LiteralPath $p -PathType Container) { `
      + `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') } `
      + `else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') }`;

    const { code, stderr } = await run(script, { signal: ctx.signal });
    if (code !== 0) throw new Error(stderr.trim() || 'La mise a la corbeille a echoue.');
    return ctx.out.success(`Envoye a la corbeille : ${target}`);
  }
};

const open = {
  name: 'open',
  aliases: ['ouvrir'],
  category: CATEGORY,
  summary: 'Ouvre un fichier ou un dossier dans l\'application par defaut.',
  usage: 'open [chemin|n] [--dossier]',
  details: [
    '`open` sans argument ouvre le dossier courant dans l\'explorateur.',
    '`open 3` ouvre le 3e resultat de la derniere recherche (find, grep).'
  ].join('\n'),
  examples: ['open rapport.pdf', 'open 3', 'open 3 --dossier'],
  flags: { dossier: 'boolean' },
  flagHelp: { dossier: 'Ouvrir le dossier contenant plutot que le fichier lui-meme.' },
  complete: completePath(false),
  async run(ctx) {
    let target = ctx.session.resolveTarget(ctx.args[0] || '.');
    if (!fs.existsSync(target)) throw new Error(`Introuvable : ${target}`);
    if (ctx.flags.dossier && fs.statSync(target).isFile()) target = path.dirname(target);

    // Meme ouverture que `access` : celle de l'hote (Electron), sinon celle du systeme.
    await ctx.terminal.open(target);
    return ctx.out.success(`Ouvert : ${target}`);
  }
};

const size = {
  name: 'taille',
  aliases: ['du'],
  category: CATEGORY,
  summary: 'Calcule la taille reelle d\'un dossier.',
  usage: 'taille [dossier] [--detail]',
  flags: { detail: 'boolean' },
  flagHelp: { detail: 'Detailler la taille de chaque sous-dossier.' },
  complete: completePath(true),
  async run(ctx) {
    const root = ctx.session.resolve(ctx.args[0] || '.');
    if (!fs.existsSync(root)) throw new Error(`Introuvable : ${root}`);

    let files = 0;

    async function measure(dir) {
      let total = 0;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return 0;
      }
      for (const entry of entries) {
        if (ctx.signal && ctx.signal.aborted) throw Object.assign(new Error('Interrompu.'), { name: 'AbortError' });
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) total += await measure(full);
        else {
          try { total += (await fsp.stat(full)).size; files += 1; } catch { /* inaccessible */ }
        }
      }
      return total;
    }

    if (fs.statSync(root).isFile()) {
      return ctx.out.kv([['Fichier', root], ['Taille', formatBytes(fs.statSync(root).size)]]);
    }

    const blocks = [];
    if (ctx.flags.detail) {
      const children = (await fsp.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory());
      const rows = [];
      for (const child of children) {
        const bytes = await measure(path.join(root, child.name));
        rows.push({ dossier: child.name, taille: formatBytes(bytes), _b: bytes });
      }
      rows.sort((a, b) => b._b - a._b);
      if (rows.length) {
        blocks.push(ctx.out.table([{ key: 'dossier', label: 'Sous-dossier' }, { key: 'taille', label: 'Taille', align: 'right' }], rows));
      }
    }

    const total = await measure(root);
    blocks.push(ctx.out.kv([['Dossier', root], ['Taille totale', formatBytes(total)], ['Fichiers', String(files)]]));
    return blocks;
  }
};

function grepTable(out, rows) {
  return out.table(
    [
      { key: 'n', label: '#', align: 'right' },
      { key: 'fichier', label: 'Fichier', kind: 'path' },
      { key: 'ligne', label: 'L.', align: 'right' },
      { key: 'contenu', label: 'Contenu' }
    ],
    rows
  );
}

/**
 * Premiere ligne d'un fichier texte ou figurent les mots trouves par l'index
 * (a defaut, le premier d'entre eux). null pour un binaire ou un gros fichier.
 */
async function locateLine(full, size, words) {
  if (size > MAX_TEXT_BYTES) return null;
  let content;
  try { content = await fsp.readFile(full, 'utf8'); } catch { return null; }
  if (content.includes(NUL_BYTE)) return null;
  const needles = words.map(fold);
  const lines = content.split(/\r?\n/);
  let partial = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = fold(lines[i]);
    if (!line.includes(needles[0])) continue;
    const hit = { line: i + 1, text: lines[i].trim().slice(0, 160) };
    if (needles.every((n) => line.includes(n))) return hit;
    partial = partial || hit;
  }
  return partial;
}

/** Debut du texte d'un document selon l'index, sans les blancs superflus. */
function summaryText(summary) {
  const text = String(summary || '').replace(/^\(unspecified\)\s*/i, '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return `debut : ${text.length > 150 ? `${text.slice(0, 147)}...` : text}`;
}

/**
 * `grep` par l'index de Windows : le texte des fichiers, PDF compris, en une
 * requete. Renvoie `{status:'ok', blocks}`, ou `{status:'fallback', reason}`
 * quand il faut lire le disque.
 */
async function grepIndex(ctx, { needle, root, extensions, limit }) {
  const { out, signal } = ctx;
  const words = contentWords(needle);
  if (!words.length) return { status: 'fallback', reason: null };

  const scopeUrl = toScopeUrl(root);
  const sql = buildContentQuery({ words, scopeUrl, extensions, top: Math.min(1000, Math.max(limit * 3, 100)) });
  const started = Date.now();
  let data;
  try {
    data = await queryContent(sql, scopeUrl, { signal, extensions });
  } catch (err) {
    if (signal && signal.aborted) throw Object.assign(new Error('Recherche interrompue.'), { name: 'AbortError' });
    return { status: 'fallback', reason: `Index Windows indisponible (${String(err.message || err).split('\n')[0]}) : lecture des fichiers un par un.` };
  }
  // Le type de fichier d'abord : meme dans un dossier indexe, l'index n'aurait rien.
  if (extensions.length && data.unfiltered.length >= extensions.length) {
    return { status: 'fallback', reason: `Windows n'indexe pas le texte des fichiers ${extensions.join(', ')} : lecture des fichiers un par un.` };
  }
  if (!data.indexed) return { status: 'fallback', reason: `${root} n'est pas indexe par Windows : lecture des fichiers un par un.` };

  // Memes dossiers ignores que la lecture du disque ; l'ordre de pertinence est garde.
  const kept = new Set(selectPaths(data.hits.map((h) => h.path), { root, matches: () => true, noise: NOISE }));
  const rows = [];
  for (const hit of data.hits) {
    if (rows.length >= limit) break;
    if (signal && signal.aborted) throw Object.assign(new Error('Recherche interrompue.'), { name: 'AbortError' });
    if (!kept.has(hit.path)) continue;
    let stat;
    try { stat = await fsp.stat(hit.path); } catch { continue; } // supprime depuis l'indexation
    if (!stat.isFile()) continue;
    const found = BINARY_DOCS.has(path.extname(hit.path).toLowerCase()) ? null : await locateLine(hit.path, stat.size, words);
    rows.push({
      fichier: path.relative(root, hit.path) || path.basename(hit.path),
      ligne: found ? String(found.line) : '-',
      contenu: found ? found.text : summaryText(hit.summary),
      _full: hit.path
    });
  }

  ctx.session.numberResults(rows);
  const blocks = [];
  if (rows.length) blocks.push(grepTable(out, rows));
  else blocks.push(out.warn(`Aucun fichier ne contient ${words.length > 1 ? `les mots ${words.join(', ')}` : `« ${needle} »`} d'apres l'index.`));

  const parts = [`${rows.length} fichier${rows.length > 1 ? 's' : ''}`, `index Windows, ${Date.now() - started} ms`];
  if (rows.length >= limit && kept.size > rows.length) parts.push(`limite de ${limit} atteinte (--limit pour elargir)`);
  blocks.push(out.dim(parts.join(' - ')));
  if (rows.length) blocks.push(out.dim(ctx.session.resultsHint()));

  if (words.length > 1) blocks.push(out.dim(`Fichiers contenant tous les mots, dans n'importe quel ordre : ${words.join(', ')}.`));
  if (data.unfiltered.length) {
    blocks.push(out.dim(`Windows n'indexe pas le texte des fichiers ${data.unfiltered.join(', ')} : --disque pour les lire un par un.`));
  }
  if (!rows.length) {
    blocks.push(out.dim('L\'index ne connait ni le texte de certains types (souvent .md, .json, .log), ni les fichiers tout juste modifies : --disque pour lire les fichiers un par un.'));
  }
  return { status: 'ok', blocks };
}

/** Le test d'une ligne : texte exact, expression reguliere, ou accents et casse ignores. */
function lineTest(needle, flags) {
  if (flags.regex) {
    let re;
    try { re = new RegExp(needle, flags.sensible ? '' : 'i'); } catch { throw new Error('Expression reguliere invalide.'); }
    return (line) => re.test(line);
  }
  if (flags.sensible) return (line) => line.includes(needle);
  // Accents et casse ignores, comme par l'index.
  const folded = fold(needle);
  return (line) => fold(line).includes(folded);
}

/** `ps | grep node` : garde les lignes recues qui contiennent le texte ; un tableau reste un tableau. */
function grepInput(ctx, needle) {
  for (const flag of ['in', 'ext', 'disque', 'limit']) {
    if (flag in ctx.flags) throw new Error(`--${flag} ne s'applique pas a un tube : grep filtre la sortie recue.`);
  }
  const test = lineTest(needle, ctx.flags);
  const kept = units(ctx.input).filter((unit) => test(unit.text) !== Boolean(ctx.flags.inverse));
  if (!kept.length) return ctx.out.warn(`Aucune ligne ${ctx.flags.inverse ? 'sans' : 'avec'} « ${needle} ».`);
  return rebuild(kept);
}

const grep = {
  name: 'grep',
  aliases: ['chercher-dans'],
  category: CATEGORY,
  summary: 'Cherche un texte a l\'interieur des fichiers, documents PDF compris.',
  usage: 'grep <texte> [--in <dossier>] [--ext pdf,txt] [--disque] [--regex]   |   ... | grep <texte> [--inverse]',
  details: [
    'Sous Windows, grep interroge l\'index de Windows, qui connait le texte des',
    'fichiers : PDF, .txt, pages web, code... La reponse est quasi instantanee,',
    'classee par pertinence, et renvoie les fichiers contenant TOUS les mots',
    '(accents et casse ignores, « factur » trouve « facturation »).',
    '',
    'Windows n\'indexe pas le texte de tous les types (souvent .md, .json, .log)',
    'ni les fichiers tout juste modifies. --disque lit alors les fichiers un par',
    'un et cherche le texte exact, ligne par ligne. Un dossier hors index,',
    '--regex et --sensible lisent aussi le disque.',
    '',
    'Apres un tube, grep filtre la sortie de la commande precedente :',
    '`ps | grep node` garde les lignes du tableau qui contiennent « node ».'
  ].join('\n'),
  flags: { in: 'string', ext: 'list', regex: 'boolean', sensible: 'boolean', limit: 'number', disque: 'boolean', inverse: 'boolean' },
  acceptsInput: true,
  flagHelp: {
    inverse: 'Dans un tube : garder les lignes qui NE contiennent PAS le texte.',
    in: 'Dossier de depart (defaut : dossier courant).',
    ext: 'Limiter a certaines extensions.',
    regex: 'Interpreter le texte comme une expression reguliere (lecture du disque).',
    sensible: 'Respecter la casse et les accents (lecture du disque).',
    limit: 'Nombre maximum de resultats (defaut 200).',
    disque: 'Lire les fichiers un par un au lieu d\'interroger l\'index de Windows.'
  },
  short: { i: 'in', e: 'ext', n: 'limit', v: 'inverse' },
  examples: [
    'grep "facture Durand" --in ~/Documents',
    'ps | grep node',
    'grep contrat --ext pdf',
    'grep TODO --ext md --disque',
    'grep "^import" --regex --ext js'
  ],
  async run(ctx) {
    const needle = ctx.args.join(' ').trim();
    if (!needle) throw new Error('Indiquez le texte a chercher.');
    if (ctx.input) return grepInput(ctx, needle);
    if (ctx.flags.inverse) throw new Error('--inverse filtre la sortie d\'une autre commande : ps | grep node --inverse');

    const root = ctx.session.resolve(ctx.flags.in || '.');
    if (!fs.existsSync(root)) throw new Error(`Dossier introuvable : ${root}`);
    const extensions = (ctx.flags.ext || []).map((e) => (e.startsWith('.') ? e : `.${e}`).toLowerCase());
    const limit = Math.max(1, ctx.flags.limit || 200);

    // --- Index de Windows ------------------------------------------------
    if (IS_WINDOWS && !ctx.flags.disque && !ctx.flags.regex && !ctx.flags.sensible) {
      ctx.emit(ctx.out.dim(`Recherche de « ${needle} » dans le contenu des fichiers de ${root} (index Windows)...`));
      const found = await grepIndex(ctx, { needle, root, extensions, limit });
      if (found.status === 'ok') return found.blocks;
      if (found.reason) ctx.emit(ctx.out.dim(found.reason));
    }

    // --- Lecture du disque ---------------------------------------------------
    const test = lineTest(needle, ctx.flags);

    const rows = [];

    async function scan(dir) {
      if (rows.length >= limit) return;
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (rows.length >= limit) return;
        if (ctx.signal && ctx.signal.aborted) throw Object.assign(new Error('Interrompu.'), { name: 'AbortError' });
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || NOISE.has(entry.name.toLowerCase())) continue;
          await scan(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (extensions.length && !extensions.includes(path.extname(entry.name).toLowerCase())) continue;

        let stat;
        try { stat = await fsp.stat(full); } catch { continue; }
        if (stat.size > MAX_TEXT_BYTES) continue;

        let content;
        try { content = await fsp.readFile(full, 'utf8'); } catch { continue; }
        if (content.includes(NUL_BYTE)) continue;

        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length && rows.length < limit; i += 1) {
          if (!test(lines[i])) continue;
          rows.push({
            fichier: path.relative(root, full) || entry.name,
            ligne: String(i + 1),
            contenu: lines[i].trim().slice(0, 160),
            _full: full
          });
        }
      }
    }

    await scan(root);

    ctx.session.numberResults(rows);
    if (!rows.length) return ctx.out.warn(`Aucune occurrence de « ${needle} » sous ${root}.`);
    return [
      grepTable(ctx.out, rows),
      ctx.out.dim(`${rows.length} occurrence(s) - lecture du disque${rows.length >= limit ? ` - limite de ${limit} atteinte` : ''}`),
      ctx.out.dim(ctx.session.resultsHint())
    ];
  }
};

// --- Creer et modifier un fichier -------------------------------------------------

const touch = {
  name: 'touch',
  aliases: ['creer'],
  category: CATEGORY,
  summary: 'Cree un fichier vide, ou met a jour la date d\'un fichier existant.',
  usage: 'touch <fichier> [autres fichiers...]',
  details: 'Le contenu d\'un fichier existant n\'est jamais touche. Le dossier doit exister (mkdir le cree).',
  examples: ['touch notes.txt', 'touch index.html style.css'],
  complete: completePath(false),
  async run(ctx) {
    if (!ctx.args.length) throw new Error('Indiquez le fichier a creer. Exemple : touch notes.txt');
    const blocks = [];
    for (const arg of ctx.args) {
      const file = ctx.session.resolve(arg);
      let stat = null;
      try { stat = await fsp.stat(file); } catch { stat = null; }
      if (stat && stat.isDirectory()) throw new Error(`${file} est un dossier.`);
      if (stat) {
        const now = new Date();
        await fsp.utimes(file, now, now);
        blocks.push(ctx.out.success(`Date mise a jour : ${file}`));
        continue;
      }
      if (!fs.existsSync(path.dirname(file))) throw new Error(`Dossier introuvable : ${path.dirname(file)}. mkdir le cree.`);
      // `wx` : jamais d'ecrasement, meme si le fichier apparait entre-temps.
      await fsp.writeFile(file, '', { flag: 'wx' });
      blocks.push(ctx.out.success(`Fichier cree : ${file}`));
    }
    return blocks;
  }
};

/**
 * L'editeur de `edit` : la variable EDITEUR (`set EDITEUR=notepad++`), sinon
 * Visual Studio Code s'il est installe, sinon le Bloc-notes.
 * `command` est un debut de ligne de commande, auquel on ajoute le fichier.
 */
async function chooseEditor(session) {
  const wanted = session.variable('EDITEUR');
  if (wanted && wanted.trim()) return { command: wanted.trim(), label: wanted.trim() };
  if (!IS_WINDOWS) {
    const fallback = process.env.VISUAL || process.env.EDITOR || 'xdg-open';
    return { command: fallback, label: fallback };
  }
  try {
    const { stdout, code } = await run('where code', { shell: 'cmd', timeout: 5000 });
    const found = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => /\.(cmd|exe)$/i.test(line));
    if (code === 0 && found) return { command: `"${found}"`, label: 'Visual Studio Code' };
  } catch {
    // `where` indisponible : le Bloc-notes, qui est toujours la.
  }
  return { command: 'notepad.exe', label: 'le Bloc-notes' };
}

/** Lance l'editeur sans l'attendre : il vit sa vie, meme apres la fermeture du Terminal. */
const editorLauncher = {
  launch(editor, file, env) {
    const child = IS_WINDOWS
      // `start` : l'editeur s'ouvre au premier plan, dans sa propre fenetre.
      ? spawn('cmd.exe', ['/d', '/c', `start "" ${editor.command} "${file}"`], {
          detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, env
        })
      : spawn(editor.command, [file], { detached: true, stdio: 'ignore', env });
    child.on('error', () => {});
    child.unref();
  }
};

const edit = {
  name: 'edit',
  aliases: ['editer', 'modifier'],
  category: CATEGORY,
  summary: 'Ouvre un fichier dans votre editeur de texte (le cree s\'il n\'existe pas).',
  usage: 'edit <fichier|n>',
  details: [
    'Editeur : la variable EDITEUR si vous l\'avez definie (set EDITEUR=notepad++,',
    'ou son chemin complet entre guillemets), sinon Visual Studio Code s\'il est',
    'installe, sinon le Bloc-notes. `edit 3` ouvre le 3e resultat de la derniere',
    'recherche. Un editeur en mode texte (vim, nano) s\'ouvre dans une console :',
    'run vim notes.txt'
  ].join('\n'),
  examples: ['edit notes.txt', 'edit 2', 'set EDITEUR=notepad'],
  complete: completePath(false),
  async run(ctx) {
    if (!ctx.args[0]) throw new Error('Indiquez le fichier a ouvrir. Exemple : edit notes.txt');
    const file = ctx.session.resolveTarget(ctx.args[0]);
    let stat = null;
    try { stat = await fsp.stat(file); } catch { stat = null; }
    if (stat && stat.isDirectory()) throw new Error(`${file} est un dossier : open l'ouvre dans l'explorateur.`);

    const blocks = [];
    if (!stat) {
      if (!fs.existsSync(path.dirname(file))) throw new Error(`Dossier introuvable : ${path.dirname(file)}. mkdir le cree.`);
      await fsp.writeFile(file, '', { flag: 'wx' });
      blocks.push(ctx.out.success(`Fichier cree : ${file}`));
    }
    const editor = await chooseEditor(ctx.session);
    editorLauncher.launch(editor, file, ctx.session.programEnv());
    blocks.push(ctx.out.success(`Ouvert dans ${editor.label} : ${file}`));
    if (editor.command === 'notepad.exe') blocks.push(ctx.out.dim('Un autre editeur ? set EDITEUR=notepad++ (ou son chemin complet).'));
    return blocks;
  }
};

module.exports = [pwd, cd, ls, cat, tree, mkdir, touch, copy, move, remove, open, edit, size, grep];
module.exports.completePath = completePath;
module.exports.chooseEditor = chooseEditor;
module.exports.editorLauncher = editorLauncher;
