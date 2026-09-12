'use strict';

/**
 * Recherche de fichiers par l'index de Windows (Windows Search), pour `find`.
 *
 * Constats mesures sur la machine cible, qui dictent la conception :
 *  - la requete repond en quelques centaines de millisecondes, la ou le
 *    parcours du disque peut prendre ses 30 secondes ;
 *  - LIKE ignore la casse mais PAS les accents : « ecran » ne trouve pas
 *    « écran ». Chaque voyelle du motif devient donc le joker « un
 *    caractere », puis les resultats sont refiltres par la regle habituelle
 *    de `find`, qui ecarte les faux positifs ;
 *  - System.ItemPathDisplay renvoie des chemins traduits pour l'affichage
 *    (C:\Utilisateurs\...\Téléchargements) qui n'existent pas sur le disque :
 *    on lit System.ItemUrl (file:C:/Users/...) ;
 *  - seuls les dossiers personnels sont indexes (ni Program Files, ni
 *    Windows, ni le dossier temporaire) : hors index, `find` revient au
 *    parcours du disque.
 *
 * Et pour le contenu des fichiers (`grep`) :
 *  - CONTAINS ignore la casse ET les accents : « ecran » trouve « écran » ;
 *  - l'index connait le texte des PDF, .txt, .js, .html... mais pas celui des
 *    types sans gestionnaire de contenu (PersistentHandler) dans le registre,
 *    comme .md ou .json : ceux-la doivent etre lus sur le disque ;
 *  - `System.FileExtension IN (...)` fait echouer une requete CONTAINS
 *    (0x80040E14) : les extensions passent par des OR explicites.
 */

const path = require('path');
const { runJson, psQuote } = require('./platform');
const { fold } = require('./text');

/** Dossiers systeme et caches sans interet pour une recherche utilisateur. */
const NOISE = new Set([
  '$recycle.bin',
  'system volume information',
  'winsxs',
  'windowsapps',
  'assembly',
  'servicing',
  'installer',
  'driverstore',
  '.git',
  'node_modules',
  '__pycache__',
  '.cache'
]);

/** Voyelles : seules lettres dont on tolere l'accent (c/ç ou n/ñ : non). */
const VOWEL = /[aeiouy]/i;

/** Litteral SQL : les apostrophes sont doublees. */
const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** Rend litteraux les jokers de LIKE tapes par l'utilisateur : % _ [ */
const escapeLike = (text) => text.replace(/[[%_]/g, (c) => `[${c}]`);

/**
 * Motif LIKE pour le nom de fichier.
 *
 * @param {string} pattern
 * @param {'substring'|'sensible'|'exact'|'glob'} mode
 * @returns {{ like: string, accentExact: boolean }} `accentExact` : les
 *          accents comptent (l'index ne trouvera pas « écran » pour « ecran »).
 */
function likePattern(pattern, mode) {
  if (mode === 'glob') {
    const like = [...pattern].map((c) => (c === '*' ? '%' : c === '?' ? '_' : escapeLike(c))).join('');
    return { like, accentExact: true };
  }
  if (mode === 'exact') return { like: escapeLike(pattern), accentExact: true };
  if (mode === 'sensible') return { like: `%${escapeLike(pattern)}%`, accentExact: true };

  const chars = [...fold(pattern)];
  const fixed = chars.filter((c) => !VOWEL.test(c)).length;
  // Motif presque tout en voyelles (« eau ») : le joker ne laisserait plus
  // rien de fixe et l'index renverrait n'importe quoi. On garde les accents.
  if (fixed < 2) return { like: `%${escapeLike(chars.join(''))}%`, accentExact: true };
  return { like: `%${chars.map((c) => (VOWEL.test(c) ? '_' : escapeLike(c))).join('')}%`, accentExact: false };
}

/** Horodatage au format attendu par l'index (UTC). */
const sqlDate = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

/** Portee de recherche : C:\Users\x devient file:C:/Users/x. */
const toScopeUrl = (dir) => `file:${String(dir).replace(/\\/g, '/').replace(/\/+$/, '')}`;

/** file:C:/Users/x devient C:\Users\x. */
const urlToPath = (url) => path.win32.normalize(String(url).replace(/^file:/i, ''));

function buildQuery({ like, scopeUrl = null, extensions = [], minSize = 0, minMtime = 0, dirsOnly = false, filesOnly = false, top = 500 }) {
  const where = [];
  if (scopeUrl) where.push(`SCOPE=${sqlString(scopeUrl)}`);
  where.push(`System.FileName LIKE ${sqlString(like)}`);
  if (extensions.length) where.push(`System.FileExtension IN (${extensions.map(sqlString).join(', ')})`);
  if (minSize) where.push(`System.Size >= ${Math.floor(minSize)}`);
  if (minMtime) where.push(`System.DateModified >= ${sqlString(sqlDate(minMtime))}`);
  if (dirsOnly) where.push("System.ItemType = 'Directory'");
  if (filesOnly) where.push("System.ItemType <> 'Directory'");
  return `SELECT TOP ${Math.floor(top)} System.ItemUrl, System.ItemType FROM SYSTEMINDEX WHERE ${where.join(' AND ')}`;
}

/**
 * Mots d'une recherche dans le contenu. Guillemets et etoile appartiennent a
 * la syntaxe de CONTAINS ; un « mot » sans lettre ni chiffre (un tiret isole)
 * ferait echouer la requete.
 */
function contentWords(text) {
  return String(text).split(/\s+/)
    .map((word) => word.replace(/["*]/g, ''))
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
}

/** Requete sur le texte des fichiers : tous les mots requis, les plus pertinents d'abord. */
function buildContentQuery({ words, scopeUrl = null, extensions = [], top = 200 }) {
  const where = [];
  if (scopeUrl) where.push(`SCOPE=${sqlString(scopeUrl)}`);
  // En debut de mot : « factur » trouve « facture » comme « facturation ».
  where.push(`CONTAINS(System.Search.Contents, ${sqlString(words.map((w) => `"${w}*"`).join(' AND '))})`);
  if (extensions.length) {
    where.push(`(${extensions.map((e) => `System.FileExtension = ${sqlString(e)}`).join(' OR ')})`);
  }
  where.push("System.ItemType <> 'Directory'");
  return `SELECT TOP ${Math.floor(top)} System.ItemUrl, System.Search.AutoSummary FROM SYSTEMINDEX WHERE ${where.join(' AND ')} ORDER BY System.Search.Rank DESC`;
}

/** Les plus gros fichiers sous un dossier, pour `nettoyer --gros`. */
function buildLargestQuery({ scopeUrl = null, top = 100 }) {
  const where = [];
  if (scopeUrl) where.push(`SCOPE=${sqlString(scopeUrl)}`);
  where.push("System.ItemType <> 'Directory'");
  return `SELECT TOP ${Math.floor(top)} System.ItemUrl FROM SYSTEMINDEX WHERE ${where.join(' AND ')} ORDER BY System.Size DESC`;
}

/**
 * Script PowerShell : la recherche, et si le dossier de depart est indexe.
 * `summary` : lit aussi le debut du texte de chaque fichier.
 * `contentTypes` : extensions dont on veut savoir si Windows indexe le texte.
 */
function indexScript(sql, scopeUrl, { summary = false, contentTypes = [] } = {}) {
  return [
    '$c = New-Object -ComObject ADODB.Connection',
    "$c.Open('Provider=Search.CollatorDSO;Extended Properties=''Application=Windows'';')",
    '$indexed = $true',
    scopeUrl
      ? `$s = $c.Execute(${psQuote(`SELECT TOP 1 System.ItemUrl FROM SYSTEMINDEX WHERE SCOPE=${sqlString(scopeUrl)}`)}); $indexed = -not $s.EOF; $s.Close()`
      : '',
    // Sans gestionnaire de contenu declare, Windows n'indexe que le nom.
    contentTypes.length
      ? `$unfiltered = @(@(${contentTypes.map(psQuote).join(', ')}) | Where-Object { -not (Test-Path -LiteralPath ('Registry::HKEY_CLASSES_ROOT\\' + $_ + '\\PersistentHandler')) })`
      : '$unfiltered = @()',
    '$rows = New-Object System.Collections.ArrayList',
    '$sums = New-Object System.Collections.ArrayList',
    `$rs = $c.Execute(${psQuote(sql)})`,
    'while (-not $rs.EOF) {',
    "  [void]$rows.Add([string]$rs.Fields.Item('System.ItemUrl').Value)",
    summary
      ? "  $v = [string]$rs.Fields.Item('System.Search.AutoSummary').Value; if ($v.Length -gt 400) { $v = $v.Substring(0, 400) }; [void]$sums.Add($v)"
      : '',
    '  $rs.MoveNext()',
    '}',
    '$rs.Close(); $c.Close()',
    '[pscustomobject]@{ indexed = $indexed; urls = @($rows); summaries = @($sums); unfiltered = @($unfiltered) }'
  ].filter(Boolean).join('\n');
}

/** ConvertTo-Json rend un tableau d'un element comme une valeur seule. */
const asList = (value) => (Array.isArray(value) ? value : (value == null ? [] : [value]));

/**
 * Interroge l'index.
 * @returns {Promise<{ indexed: boolean, paths: string[] }>}
 * @throws si l'index est indisponible (service arrete, fournisseur absent...)
 */
async function queryIndex(sql, scopeUrl, { signal } = {}) {
  const data = await runJson(indexScript(sql, scopeUrl), { asArray: false, timeout: 20000, signal });
  if (!data || typeof data !== 'object') throw new Error('Reponse de l\'index illisible.');
  return {
    indexed: data.indexed !== false,
    paths: asList(data.urls).filter((u) => /^file:/i.test(u)).map(urlToPath)
  };
}

/**
 * Interroge l'index sur le texte des fichiers.
 * @returns {Promise<{ indexed: boolean, hits: {path: string, summary: string}[], unfiltered: string[] }>}
 *          `hits` par pertinence ; `unfiltered` : celles des `extensions`
 *          dont Windows n'indexe pas le texte.
 * @throws si l'index est indisponible
 */
async function queryContent(sql, scopeUrl, { signal, extensions = [] } = {}) {
  const script = indexScript(sql, scopeUrl, { summary: true, contentTypes: extensions });
  const data = await runJson(script, { asArray: false, timeout: 20000, signal });
  if (!data || typeof data !== 'object') throw new Error('Reponse de l\'index illisible.');
  const summaries = asList(data.summaries);
  const hits = [];
  asList(data.urls).forEach((url, i) => {
    if (/^file:/i.test(url)) hits.push({ path: urlToPath(url), summary: String(summaries[i] || '') });
  });
  return { indexed: data.indexed !== false, hits, unfiltered: asList(data.unfiltered).map(String) };
}

/**
 * Filtre et ordonne les chemins renvoyes par l'index, avec les memes regles
 * que le parcours du disque : hors du dossier de depart ecartes, dossiers
 * systeme et caches ignores, profondeur respectee, nom verifie par la regle
 * habituelle ; les plus proches du point de depart d'abord.
 */
function selectPaths(paths, { root = null, matches, maxDepth = Infinity, showAll = false, noise = new Set() }) {
  const base = root ? path.win32.normalize(root).replace(/[\\]+$/, '') : null;
  const kept = [];
  for (const full of paths) {
    const parent = path.win32.dirname(full);
    let rel;
    if (base) {
      rel = path.win32.relative(base, parent);
      if (rel.startsWith('..') || path.win32.isAbsolute(rel)) continue;
    } else {
      rel = parent.replace(/^[A-Za-z]:[\\]?/, '');
    }
    const segments = rel.split('\\').filter(Boolean);
    if (segments.length > maxDepth) continue;
    // Comme le parcours : un dossier cache n'est ignore qu'au-dela du premier niveau.
    if (!showAll && segments.some((s, i) => noise.has(s.toLowerCase()) || (i > 0 && s.startsWith('.')))) continue;
    if (!matches(path.win32.basename(full))) continue;
    kept.push({ full, depth: segments.length });
  }
  return kept
    .sort((a, b) => a.depth - b.depth || a.full.localeCompare(b.full, 'fr'))
    .map((entry) => entry.full);
}

module.exports = {
  likePattern,
  buildQuery,
  queryIndex,
  contentWords,
  buildContentQuery,
  queryContent,
  buildLargestQuery,
  selectPaths,
  toScopeUrl,
  urlToPath,
  escapeLike,
  NOISE
};
