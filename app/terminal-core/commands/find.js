'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { formatBytes, formatDate, driveRoots, IS_WINDOWS } = require('../platform');
const { fold } = require('../text');
const { likePattern, buildQuery, queryIndex, selectPaths, toScopeUrl, NOISE } = require('../windows-index');

/** Convertit un motif type `*.pdf` ou `rapport-202?.docx` en expression reguliere. */
function globToRegExp(pattern) {
  let source = '';
  for (const ch of pattern) {
    if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'i');
}

/**
 * Forme du motif :
 * - `--regex`            : expression reguliere fournie telle quelle
 * - motif avec * ou ?    : glob
 * - `--exact`            : nom entier
 * - `--sensible`         : sous-chaine, casse et accents respectes
 * - sinon                : sous-chaine, casse et accents ignores
 */
function patternMode(pattern, flags) {
  if (flags.regex) return 'regex';
  if (/[*?]/.test(pattern)) return 'glob';
  if (flags.exact) return 'exact';
  if (flags.sensible) return 'sensible';
  return 'substring';
}

/** Predicat de correspondance sur le NOM du fichier. */
function buildMatcher(pattern, mode, flags) {
  if (mode === 'regex') {
    let re;
    try {
      re = new RegExp(pattern, flags.sensible ? '' : 'i');
    } catch {
      throw new Error(`Expression reguliere invalide : ${pattern}`);
    }
    return (name) => re.test(name);
  }
  if (mode === 'glob') {
    const re = globToRegExp(pattern);
    return (name) => re.test(name);
  }
  if (mode === 'exact') {
    return flags.sensible
      ? (name) => name === pattern
      : (name) => name.toLowerCase() === pattern.toLowerCase();
  }
  if (mode === 'sensible') return (name) => name.includes(pattern);
  const needle = fold(pattern);
  return (name) => fold(name).includes(needle);
}

function parseSize(value) {
  const match = String(value).trim().match(/^(\d+(?:[.,]\d+)?)\s*(o|ko|mo|go|to|b|kb|mb|gb|tb)?$/i);
  if (!match) throw new Error(`Taille invalide : ${value} (exemples : 500ko, 12mo, 2go).`);
  const amount = Number(match[1].replace(',', '.'));
  const unit = (match[2] || 'o').toLowerCase();
  const scale = { o: 1, b: 1, ko: 1024, kb: 1024, mo: 1024 ** 2, mb: 1024 ** 2, go: 1024 ** 3, gb: 1024 ** 3, to: 1024 ** 4, tb: 1024 ** 4 };
  return amount * scale[unit];
}

function resultRow(full, isDir, stat) {
  return {
    nom: path.basename(full),
    type: isDir ? 'DIR' : (path.extname(full).slice(1).toUpperCase() || 'FIC'),
    taille: isDir ? '-' : formatBytes(stat ? stat.size : 0),
    modifie: stat ? formatDate(stat.mtime) : '-',
    chemin: path.dirname(full),
    _full: full
  };
}

function resultTable(out, rows) {
  return out.table(
    [
      { key: 'n', label: '#', align: 'right' },
      { key: 'nom', label: 'Nom' },
      { key: 'type', label: 'Type' },
      { key: 'taille', label: 'Taille', align: 'right' },
      { key: 'modifie', label: 'Modifie' },
      { key: 'chemin', label: 'Emplacement', kind: 'path' }
    ],
    rows
  );
}

// ---------------------------------------------------------------------------
// Par l'index de Windows
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{status:'ok', rows, ms, capped, truncated, accentExact}
 *                  |{status:'unindexed'}|{status:'unavailable', message}>}
 */
async function searchIndex(ctx, o) {
  const { like, accentExact } = likePattern(o.pattern, o.mode);
  // Plus de candidats que de resultats voulus : une partie sera ecartee par le
  // refiltrage (joker des voyelles, dossiers ignores, entrees perimees).
  const top = Math.min(5000, Math.max(o.limit * 10, 500));
  const scopeUrl = o.root ? toScopeUrl(o.root) : null;
  const sql = buildQuery({
    like,
    scopeUrl,
    extensions: o.extensions,
    minSize: o.minSize,
    minMtime: o.minMtime,
    dirsOnly: o.wantDirs && !o.wantFiles,
    filesOnly: o.wantFiles && !o.wantDirs,
    top
  });

  const started = Date.now();
  let data;
  try {
    data = await queryIndex(sql, scopeUrl, { signal: ctx.signal });
  } catch (err) {
    if (ctx.signal && ctx.signal.aborted) throw Object.assign(new Error('Recherche interrompue.'), { name: 'AbortError' });
    return { status: 'unavailable', message: String(err.message || err).split('\n')[0] };
  }
  if (!data.indexed) return { status: 'unindexed' };

  const candidates = selectPaths(data.paths, {
    root: o.root,
    matches: o.matches,
    maxDepth: o.maxDepth,
    showAll: o.showAll,
    noise: NOISE
  });

  // Taille et date relues sur le disque : l'index renvoie des dates sans
  // fuseau, et peut encore lister un fichier supprime depuis.
  const rows = [];
  for (const full of candidates) {
    if (rows.length >= o.limit) break;
    let stat;
    try { stat = await fsp.stat(full); } catch { continue; }
    const isDir = stat.isDirectory();
    if (isDir && !o.wantDirs) continue;
    if (!isDir && !o.wantFiles) continue;
    if (o.extensions.length && (isDir || !o.extensions.includes(path.extname(full).toLowerCase()))) continue;
    if (!isDir && o.minSize && stat.size < o.minSize) continue;
    if (o.minMtime && stat.mtimeMs < o.minMtime) continue;
    rows.push(resultRow(full, isDir, stat));
  }

  return {
    status: 'ok',
    rows,
    ms: Date.now() - started,
    capped: data.paths.length >= top,
    truncated: rows.length >= o.limit && candidates.length > rows.length,
    accentExact
  };
}

// ---------------------------------------------------------------------------
// Par le parcours du disque
// ---------------------------------------------------------------------------

async function searchDisk(ctx, o) {
  const { emit, out, signal } = ctx;
  const deadline = Date.now() + Math.max(1, o.delai || 30) * 1000;
  const results = [];
  const queue = o.roots.map((root) => ({ dir: root, depth: 0 }));
  let scanned = 0;
  let truncated = false;
  let timedOut = false;
  let lastPing = 0;

  while (queue.length) {
    if (signal && signal.aborted) throw Object.assign(new Error('Recherche interrompue.'), { name: 'AbortError' });
    if (Date.now() > deadline) { timedOut = true; break; }
    if (results.length >= o.limit) { truncated = true; break; }

    const { dir, depth } = queue.shift();
    scanned += 1;

    if (Date.now() - lastPing > 250) {
      lastPing = Date.now();
      emit(out.control('progress', { scanned, found: results.length, current: dir }));
    }

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // dossier protege ou disparu : on passe
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const isDir = entry.isDirectory();

      if (isDir && depth < o.maxDepth) {
        const low = entry.name.toLowerCase();
        const skip = !o.showAll && (NOISE.has(low) || (entry.name.startsWith('.') && depth > 0));
        if (!skip && !entry.isSymbolicLink()) queue.push({ dir: full, depth: depth + 1 });
      }

      if (isDir && !o.wantDirs) continue;
      if (!isDir && !o.wantFiles) continue;
      if (!entry.isFile() && !isDir) continue;
      if (!o.matches(entry.name)) continue;
      if (o.extensions.length && (isDir || !o.extensions.includes(path.extname(entry.name).toLowerCase()))) continue;

      let stat = null;
      try { stat = await fsp.stat(full); } catch { if (o.minSize || o.minMtime) continue; }
      if (!isDir && o.minSize && (!stat || stat.size < o.minSize)) continue;
      if (o.minMtime && (!stat || stat.mtimeMs < o.minMtime)) continue;

      results.push(resultRow(full, isDir, stat));
      if (results.length >= o.limit) { truncated = true; break; }
    }
  }

  emit(out.control('progress', { done: true, scanned, found: results.length }));
  return { rows: results, scanned, truncated, timedOut };
}

// ---------------------------------------------------------------------------
// Commande
// ---------------------------------------------------------------------------

module.exports = {
  name: 'find',
  aliases: ['chercher', 'ff'],
  category: 'Fichiers',
  summary: 'Recherche un fichier ou un dossier par son nom, n\'importe ou sur le PC.',
  usage: 'find <motif> [--in <dossier>] [--all] [--ext pdf,docx] [--limit 100] [--disque]',
  details: [
    'Le motif accepte trois formes :',
    '  rapport          -> tout nom contenant « rapport » (accents ignores)',
    '  *.pdf            -> motif glob (* et ?)',
    '  --regex "^\\d+"  -> expression reguliere',
    '',
    'Sous Windows, la recherche passe par l\'index de Windows : quasi',
    'instantanee, mais limitee aux dossiers indexes (vos dossiers personnels)',
    'et aux fichiers deja indexes - un fichier tout juste cree peut manquer.',
    'Un dossier hors index, une expression reguliere ou --disque font',
    'parcourir le disque directement, plus lentement.',
    '',
    'Les dossiers systeme et les node_modules sont ignores, sauf avec --tout-voir.',
    '',
    'Les resultats sont numerotes : `open 3` ouvre le 3e, `cd 3` va dans son',
    'dossier, `cat 3` l\'affiche.'
  ].join('\n'),
  examples: [
    'find rapport.pdf',
    'find facture --in ~/Documents --ext pdf',
    'find *.psd --all --limit 50',
    'find budget --recent 7 --gros 10mo',
    'find brouillon --disque'
  ],
  flags: {
    in: 'string',
    all: 'boolean',
    ext: 'list',
    limit: 'number',
    depth: 'number',
    dossiers: 'boolean',
    fichiers: 'boolean',
    regex: 'boolean',
    exact: 'boolean',
    sensible: 'boolean',
    recent: 'number',
    gros: 'string',
    'tout-voir': 'boolean',
    delai: 'number',
    disque: 'boolean'
  },
  flagHelp: {
    in: 'Dossier de depart (defaut : dossier courant).',
    all: 'Chercher partout : tout l\'index, ou tous les disques avec --disque.',
    ext: 'Filtre par extensions, separees par des virgules.',
    limit: 'Nombre maximum de resultats (defaut 100).',
    depth: 'Profondeur maximale de descente.',
    dossiers: 'Ne renvoyer que des dossiers.',
    fichiers: 'Ne renvoyer que des fichiers.',
    regex: 'Interpreter le motif comme une expression reguliere (parcours du disque).',
    exact: 'Le nom doit correspondre entierement.',
    sensible: 'Respecter la casse et les accents.',
    recent: 'Modifie il y a moins de N jours.',
    gros: 'Taille minimale (ex. 10mo).',
    'tout-voir': 'Ne pas ignorer les dossiers systeme et caches.',
    delai: 'Temps de parcours du disque maximal en secondes (defaut 30).',
    disque: 'Parcourir le disque au lieu d\'interroger l\'index de Windows.'
  },
  short: { i: 'in', e: 'ext', n: 'limit', d: 'depth', a: 'all' },
  // `tree` dit --profondeur : les deux noms marchent partout.
  flagAliases: { profondeur: 'depth' },

  async run(ctx) {
    const { args, flags, out, emit, session } = ctx;

    const pattern = args.join(' ').trim();
    if (!pattern) throw new Error('Indiquez ce qu\'il faut chercher. Exemple : find rapport.pdf');

    const mode = patternMode(pattern, flags);
    const options = {
      pattern,
      mode,
      matches: buildMatcher(pattern, mode, flags),
      limit: Math.max(1, flags.limit || 100),
      maxDepth: flags.depth == null ? Infinity : Math.max(0, flags.depth),
      showAll: flags['tout-voir'] === true,
      extensions: (flags.ext || []).map((e) => (e.startsWith('.') ? e : `.${e}`).toLowerCase()),
      minSize: flags.gros ? parseSize(flags.gros) : 0,
      minMtime: flags.recent ? Date.now() - flags.recent * 86400000 : 0,
      wantDirs: flags.dossiers === true || flags.fichiers !== true,
      wantFiles: flags.fichiers === true || flags.dossiers !== true,
      delai: flags.delai
    };

    let root = null;
    if (!flags.all) {
      root = flags.in ? session.resolve(flags.in) : session.cwd;
      if (!fs.existsSync(root)) throw new Error(`Dossier introuvable : ${root}`);
    }

    // --- Index de Windows ------------------------------------------------
    let fallbackReason = null;
    if (IS_WINDOWS && !flags.disque && mode !== 'regex') {
      emit(out.dim(`Recherche de « ${pattern} » dans ${root || 'tout l\'index'} (index Windows)...`));
      const found = await searchIndex(ctx, { ...options, root });

      if (found.status === 'ok') {
        session.numberResults(found.rows);
        const blocks = [];
        if (found.rows.length) blocks.push(resultTable(out, found.rows));
        else blocks.push(out.warn(`Aucun resultat pour « ${pattern} » dans l'index.`));

        const parts = [`${found.rows.length} resultat${found.rows.length > 1 ? 's' : ''}`, `index Windows, ${found.ms} ms`];
        if (found.truncated) parts.push(`limite de ${options.limit} atteinte (--limit pour elargir)`);
        blocks.push(out.dim(parts.join(' - ')));
        if (found.rows.length) blocks.push(out.dim(session.resultsHint()));

        if (found.capped) {
          blocks.push(out.dim(`L'index a renvoye son maximum de candidats : des resultats peuvent manquer. Affinez le motif, ou --disque.`));
        }
        if (found.accentExact && mode === 'substring') {
          blocks.push(out.dim('Motif trop court pour ignorer les accents dans l\'index : --disque pour les ignorer.'));
        }
        if (!found.rows.length) {
          blocks.push(out.dim('Un fichier tout juste cree, ou hors des dossiers indexes, n\'y figure pas : --disque pour parcourir le disque.'));
        }
        return blocks;
      }

      fallbackReason = found.status === 'unindexed'
        ? `${root} n'est pas indexe par Windows : parcours du disque.`
        : `Index Windows indisponible (${found.message}) : parcours du disque.`;
    }

    // --- Parcours du disque --------------------------------------------------
    const roots = root ? [root] : driveRoots();
    if (fallbackReason) emit(out.dim(fallbackReason));
    emit(out.dim(`Recherche de « ${pattern} » dans ${roots.length === 1 ? roots[0] : `${roots.length} disques`}...`));

    const found = await searchDisk(ctx, { ...options, roots });
    session.numberResults(found.rows);

    if (!found.rows.length) {
      emit(out.warn(`Aucun resultat pour « ${pattern} » (${found.scanned} dossiers explores).`));
      if (!flags.all && !flags.in) emit(out.dim('Astuce : ajoutez --all pour chercher sur tout le PC.'));
      return null;
    }

    const parts = [`${found.rows.length} resultat${found.rows.length > 1 ? 's' : ''}`, `${found.scanned} dossiers explores`];
    if (found.truncated) parts.push(`limite de ${options.limit} atteinte (--limit pour elargir)`);
    if (found.timedOut) parts.push('delai depasse (--delai pour prolonger)');
    return [resultTable(out, found.rows), out.dim(parts.join(' - ')), out.dim(session.resultsHint())];
  }
};
