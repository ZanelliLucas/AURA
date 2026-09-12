'use strict';

/**
 * `nettoyer` : ce qui prend de la place sans servir - fichiers temporaires,
 * caches, corbeille. Mesure d'abord ; ne vide que sur demande
 * (`nettoyer vider`, confirme dans l'interface).
 *
 * Temporaires et caches sont supprimes pour de bon : les envoyer a la
 * corbeille ne libererait aucune place, et leurs applications les recreent au
 * besoin. Dans les dossiers temporaires, seuls les elements de plus d'un jour
 * sont vises (un installateur en cours y travaille peut-etre) ; un fichier
 * ouvert est laisse de cote ; un lien ou une jonction n'est jamais suivi.
 */

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { run, runJson, runElevated, psQuote, formatBytes, formatDate, IS_WINDOWS } = require('../platform');
const { buildLargestQuery, queryIndex, selectPaths, toScopeUrl, NOISE } = require('../windows-index');
const { fold } = require('../text');

const DAY = 24 * 3600 * 1000;

const abortError = () => Object.assign(new Error('Interrompu.'), { name: 'AbortError' });

/** Caches d'un navigateur Chromium, pour chacun de ses profils. */
function browserCaches(userData) {
  let names = [];
  try { names = fs.readdirSync(userData); } catch { return []; }
  return names
    .filter((name) => name === 'Default' || /^Profile \d+$/.test(name))
    .flatMap((name) => [path.join(userData, name, 'Cache'), path.join(userData, name, 'Code Cache')]);
}

/** Emplacements nettoyables. `env` est injectable pour les tests. */
function categories(env = process.env) {
  const local = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const windir = env.WINDIR || env.SystemRoot || 'C:\\Windows';
  return [
    { id: 'temp', label: 'Fichiers temporaires', roots: [env.TEMP || os.tmpdir()], minAge: DAY },
    { id: 'temp-windows', label: 'Temporaires de Windows', roots: [path.join(windir, 'Temp')], minAge: DAY, admin: true },
    { id: 'plantages', label: 'Rapports de plantage', roots: [path.join(local, 'CrashDumps')], minAge: 0 },
    { id: 'edge', label: 'Cache Edge', roots: browserCaches(path.join(local, 'Microsoft', 'Edge', 'User Data')), minAge: 0 },
    { id: 'chrome', label: 'Cache Chrome', roots: browserCaches(path.join(local, 'Google', 'Chrome', 'User Data')), minAge: 0 },
    { id: 'npm', label: 'Cache npm', roots: [path.join(local, 'npm-cache', '_cacache')], minAge: 0 },
    { id: 'corbeille', label: 'Corbeille', recycleBin: true }
  ];
}

/**
 * Parcourt un dossier : `visit.file(chemin)`, puis `visit.dir(chemin, etat)`
 * apres le contenu de chaque sous-dossier, avec son etat d'avant le passage.
 * @returns {Promise<'ok'|'absent'|'denied'>}
 */
async function walk(root, visit, signal) {
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch (err) {
    return err.code === 'ENOENT' ? 'absent' : 'denied';
  }
  for (const entry of entries) {
    if (signal && signal.aborted) throw abortError();
    const full = path.join(root, entry.name);
    // Jamais suivre un lien ni une jonction : il pourrait mener hors du cache.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      let before;
      try { before = await fsp.lstat(full); } catch { continue; }
      if (before.isSymbolicLink()) continue;
      await walk(full, visit, signal);
      if (visit.dir) await visit.dir(full, before);
    } else if (entry.isFile()) {
      await visit.file(full);
    }
  }
  return 'ok';
}

const tooYoung = (category, stat, now) => Boolean(category.minAge) && now - stat.mtimeMs < category.minAge;

/** Ce que `purgeCategory` supprimerait. */
async function measureCategory(category, { now = Date.now(), signal } = {}) {
  let bytes = 0;
  let files = 0;
  let present = false;
  let denied = false;
  for (const root of category.roots) {
    const status = await walk(root, {
      file: async (full) => {
        let stat;
        try { stat = await fsp.lstat(full); } catch { return; }
        if (tooYoung(category, stat, now)) return;
        bytes += stat.size;
        files += 1;
      }
    }, signal);
    if (status !== 'absent') present = true;
    if (status === 'denied') denied = true;
  }
  return { bytes, files, present, denied };
}

/** Supprime les fichiers vises, puis les sous-dossiers devenus vides. */
async function purgeCategory(category, { now = Date.now(), signal } = {}) {
  let freed = 0;
  let deleted = 0;
  let kept = 0;
  for (const root of category.roots) {
    await walk(root, {
      file: async (full) => {
        let stat;
        try { stat = await fsp.lstat(full); } catch { return; }
        if (tooYoung(category, stat, now)) return;
        try {
          await fsp.unlink(full);
          freed += stat.size;
          deleted += 1;
        } catch {
          kept += 1; // ouvert par une application, ou protege
        }
      },
      dir: async (full, before) => {
        if (tooYoung(category, before, now)) return;
        try { await fsp.rmdir(full); } catch { /* pas vide, ou en cours d'usage */ }
      }
    }, signal);
  }
  return { freed, deleted, kept };
}

// --- Corbeille -----------------------------------------------------------------

const RECYCLE_MEASURE = [
  '$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  '$bytes = [int64]0; $items = 0',
  'foreach ($d in [System.IO.DriveInfo]::GetDrives()) {',
  "  if ($d.DriveType -ne 'Fixed' -or -not $d.IsReady) { continue }",
  "  $bin = Join-Path $d.RootDirectory.FullName ('$Recycle.Bin\\' + $sid)",
  '  if (-not (Test-Path -LiteralPath $bin)) { continue }',
  "  $items += @(Get-ChildItem -LiteralPath $bin -Force -Filter '$R*' -ErrorAction SilentlyContinue).Count",
  '  $sum = (Get-ChildItem -LiteralPath $bin -Force -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum',
  '  if ($sum) { $bytes += [int64]$sum }',
  '}',
  '[pscustomobject]@{ bytes = $bytes; files = $items }'
].join('\n');

async function measureRecycleBin(ctx) {
  const data = await runJson(RECYCLE_MEASURE, { asArray: false, signal: ctx.signal, timeout: 60000 });
  return { bytes: Number(data && data.bytes) || 0, files: Number(data && data.files) || 0, present: true, denied: false };
}

async function emptyRecycleBin(ctx) {
  const before = await measureRecycleBin(ctx);
  await run('Clear-RecycleBin -Force -ErrorAction SilentlyContinue', { signal: ctx.signal, timeout: 120000 });
  const after = await measureRecycleBin(ctx);
  return { freed: Math.max(0, before.bytes - after.bytes), deleted: Math.max(0, before.files - after.files), kept: after.files };
}

// --- Avec les droits administrateur ----------------------------------------------

/** Meme regles que purgeCategory, pour un processus eleve : liens ignores, fichiers anciens seulement. */
function elevatedPurgeScript(category) {
  const days = (category.minAge || 0) / DAY;
  return [
    'function Purge([string]$dir, [datetime]$limit) {',
    '  try { $entries = [System.IO.Directory]::GetFileSystemEntries($dir) } catch { return }',
    '  foreach ($p in $entries) {',
    '    try { $a = [System.IO.File]::GetAttributes($p) } catch { continue }',
    '    if ($a -band [System.IO.FileAttributes]::ReparsePoint) { continue }',
    '    if ($a -band [System.IO.FileAttributes]::Directory) {',
    '      $before = [System.IO.Directory]::GetLastWriteTime($p)',
    '      Purge $p $limit',
    '      if ($before -lt $limit) { try { [System.IO.Directory]::Delete($p) } catch {} }',
    '    } elseif ([System.IO.File]::GetLastWriteTime($p) -lt $limit) {',
    '      try { [System.IO.File]::Delete($p) } catch {}',
    '    }',
    '  }',
    '}',
    ...category.roots.map((root) => `Purge ${psQuote(root)} (Get-Date).AddDays(-${days})`)
  ].join('\n');
}

async function purgeElevated(ctx, category) {
  const before = await measureCategory(category, { signal: ctx.signal });
  ctx.emit(ctx.out.dim(`${category.label} : Windows demande l'autorisation administrateur...`));
  const code = await runElevated(elevatedPurgeScript(category), { signal: ctx.signal });
  if (code !== 0) throw new Error(`${category.label} : le nettoyage a echoue, meme avec les droits administrateur (code ${code}).`);
  const after = await measureCategory(category, { signal: ctx.signal });
  return { freed: Math.max(0, before.bytes - after.bytes), deleted: Math.max(0, before.files - after.files), kept: after.files };
}

// --- Commande --------------------------------------------------------------------

async function analysis(ctx) {
  ctx.emit(ctx.out.dim('Mesure de ce qui peut etre libere...'));
  const now = Date.now();
  const rows = [];
  let total = 0;
  for (const category of categories()) {
    const m = category.recycleBin
      ? await measureRecycleBin(ctx)
      : await measureCategory(category, { now, signal: ctx.signal });
    if (!m.present) continue;
    const notes = [];
    if (category.minAge) notes.push('plus d\'un jour');
    if (category.admin) notes.push('--admin pour tout vider');
    if (m.denied) notes.push('acces en partie refuse');
    rows.push({ quoi: category.label, cle: category.id, taille: formatBytes(m.bytes), fichiers: String(m.files), note: notes.join(', ') });
    total += m.bytes;
  }

  return [
    ctx.out.table(
      [
        { key: 'quoi', label: 'Quoi' },
        { key: 'cle', label: 'Cle' },
        { key: 'taille', label: 'Taille', align: 'right' },
        { key: 'fichiers', label: 'Elements', align: 'right' },
        { key: 'note', label: 'Note' }
      ],
      rows
    ),
    ctx.out.accent(`${formatBytes(total)} recuperables.`),
    ctx.out.dim('nettoyer vider <cle,...> ou nettoyer vider tout - rien n\'est supprime sans confirmation.'),
    ctx.out.dim('nettoyer --gros : les plus gros fichiers de vos dossiers personnels.')
  ];
}

async function purge(ctx, words) {
  const all = categories();
  const ids = all.map((c) => c.id);
  const wanted = words.join(',').split(/[\s,]+/).map((w) => fold(w)).filter(Boolean);
  if (!wanted.length) throw new Error(`Precisez quoi vider : ${ids.join(', ')}, ou tout.`);

  let chosen;
  if (wanted.includes('tout')) {
    chosen = all.filter((c) => !c.admin || ctx.flags.admin);
  } else {
    const unknown = wanted.filter((w) => !ids.includes(w));
    if (unknown.length) throw new Error(`Inconnu : ${unknown.join(', ')}. Possibles : ${ids.join(', ')}, tout.`);
    chosen = all.filter((c) => wanted.includes(c.id));
  }

  const rows = [];
  let freed = 0;
  let kept = 0;
  for (const category of chosen) {
    let result;
    if (category.recycleBin) result = await emptyRecycleBin(ctx);
    else if (category.admin && ctx.flags.admin) result = await purgeElevated(ctx, category);
    else result = await purgeCategory(category, { signal: ctx.signal });
    rows.push({
      quoi: category.label,
      libere: formatBytes(result.freed),
      supprimes: String(result.deleted),
      laisses: String(result.kept)
    });
    freed += result.freed;
    kept += result.kept;
  }

  const blocks = [
    ctx.out.table(
      [
        { key: 'quoi', label: 'Quoi' },
        { key: 'libere', label: 'Libere', align: 'right' },
        { key: 'supprimes', label: 'Supprimes', align: 'right' },
        { key: 'laisses', label: 'Laisses', align: 'right' }
      ],
      rows
    ),
    ctx.out.success(`${formatBytes(freed)} liberes.`)
  ];
  if (kept) blocks.push(ctx.out.dim('Les elements laisses sont ouverts par une application, trop recents, ou exigent les droits administrateur.'));
  if (wanted.includes('tout') && !ctx.flags.admin) {
    blocks.push(ctx.out.dim('Temporaires de Windows : non vides sans --admin.'));
  }
  return blocks;
}

async function largest(ctx) {
  const root = ctx.session.resolve(ctx.flags.in || ctx.session.home);
  const limit = Math.max(1, ctx.flags.limit || 20);
  const scopeUrl = toScopeUrl(root);
  const started = Date.now();
  let data;
  try {
    data = await queryIndex(buildLargestQuery({ scopeUrl, top: Math.min(1000, limit * 5) }), scopeUrl, { signal: ctx.signal });
  } catch (err) {
    if (ctx.signal && ctx.signal.aborted) throw abortError();
    throw new Error(`Index de Windows indisponible (${String(err.message || err).split('\n')[0]}) : essayez taille <dossier> --detail.`);
  }
  if (!data.indexed) throw new Error(`${root} n'est pas indexe par Windows : essayez taille "${root}" --detail.`);

  const kept = new Set(selectPaths(data.paths, { root, matches: () => true, noise: NOISE }));
  const rows = [];
  for (const full of data.paths) {
    if (!kept.has(full)) continue;
    let stat;
    try { stat = await fsp.stat(full); } catch { continue; } // supprime depuis l'indexation
    if (!stat.isFile()) continue;
    rows.push({ nom: path.basename(full), taille: formatBytes(stat.size), modifie: formatDate(stat.mtime), chemin: path.dirname(full), _full: full, _size: stat.size });
  }
  rows.sort((a, b) => b._size - a._size);
  rows.splice(limit);
  ctx.session.numberResults(rows);
  if (!rows.length) return ctx.out.warn(`Aucun fichier indexe sous ${root}.`);

  return [
    ctx.out.table(
      [
        { key: 'n', label: '#', align: 'right' },
        { key: 'nom', label: 'Nom' },
        { key: 'taille', label: 'Taille', align: 'right' },
        { key: 'modifie', label: 'Modifie' },
        { key: 'chemin', label: 'Emplacement', kind: 'path' }
      ],
      rows
    ),
    ctx.out.dim(`Les ${rows.length} plus gros fichiers de ${root} - index Windows, ${Date.now() - started} ms`),
    ctx.out.dim('open <n> --dossier pour le voir, rm <n> pour l\'envoyer a la corbeille.')
  ];
}

const clean = {
  name: 'nettoyer',
  aliases: ['clean'],
  category: 'Systeme',
  summary: 'Mesure puis vide ce qui prend de la place pour rien : temporaires, caches, corbeille.',
  usage: 'nettoyer | nettoyer vider <cle,...|tout> [--admin] | nettoyer --gros [--in <dossier>]',
  details: [
    '  nettoyer               mesure, sans rien supprimer',
    '  nettoyer vider temp,npm   vide ces emplacements (confirmation demandee)',
    '  nettoyer vider tout    vide tout ce qui est mesure',
    '  nettoyer --gros        les plus gros fichiers de vos dossiers personnels',
    '',
    'Temporaires et caches sont supprimes pour de bon : les passer par la',
    'corbeille ne libererait aucune place. Dans les dossiers temporaires, seuls',
    'les elements de plus d\'un jour sont vises ; un fichier ouvert est laisse',
    'de cote. Les temporaires de Windows exigent --admin.'
  ].join('\n'),
  examples: ['nettoyer', 'nettoyer vider temp,npm', 'nettoyer vider corbeille', 'nettoyer --gros --limit 30'],
  flags: { gros: 'boolean', admin: 'boolean', limit: 'number', in: 'string' },
  flagHelp: {
    gros: 'Lister les plus gros fichiers (index Windows).',
    admin: 'Vider aussi les temporaires de Windows (Windows demande l\'autorisation).',
    limit: 'Nombre de fichiers avec --gros (defaut 20).',
    in: 'Dossier examine par --gros (defaut : dossier utilisateur).'
  },
  short: { n: 'limit' },
  confirmWhen: ['vider'],
  complete: ({ tokens, partial }) => (tokens.length <= 1
    ? ['vider'].filter((v) => v.startsWith(partial || ''))
    : [...categories().map((c) => c.id), 'tout'].filter((v) => v.startsWith(partial || ''))),

  async run(ctx) {
    if (!IS_WINDOWS) throw new Error('nettoyer n\'est disponible que sous Windows pour l\'instant.');
    if (ctx.flags.gros) return largest(ctx);
    const [first, ...rest] = ctx.args;
    if (!first) return analysis(ctx);
    if (fold(first) === 'vider') return purge(ctx, rest);
    throw new Error(`Usage : ${clean.usage}`);
  }
};

module.exports = [clean];
module.exports.internals = { categories, measureCategory, measureRecycleBin, purgeCategory, elevatedPurgeScript, DAY };
