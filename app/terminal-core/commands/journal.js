'use strict';

/**
 * `journal` : les erreurs du journal d'evenements de Windows - ce qu'on
 * regarde en premier quand le PC se comporte mal.
 *
 * Constats sur la machine cible : la lecture est rapide (200 evenements avec
 * leurs messages en ~120 ms), mais les alertes sont bruyantes (un pilote
 * Wi-Fi en ecrit des centaines par jour). D'ou : erreurs et critiques par
 * defaut, alertes sur demande, evenements regroupes par source. Quand rien ne
 * correspond, Get-WinEvent echoue (NoMatchingEventsFound) : ce n'est pas une
 * erreur ici.
 */

const { runJson, psQuote, formatDate, IS_WINDOWS } = require('../platform');
const { fold } = require('../text');

/** Lecture maximale : au-dela, la periode est trop large pour etre utile. */
const MAX_EVENTS = 3000;

const LEVELS = { 0: 'info', 1: 'critique', 2: 'erreur', 3: 'alerte', 4: 'info', 5: 'detail' };

const LOGS = { system: 'System', systeme: 'System', application: 'Application', applications: 'Application' };

/** Recherches toutes faites. */
const PRESETS = {
  arrets: [
    { log: 'System', provider: 'Microsoft-Windows-Kernel-Power', id: 41 },
    { log: 'System', provider: 'EventLog', id: 6008 },
    { log: 'System', provider: 'Microsoft-Windows-WER-SystemErrorReporting', id: 1001 }
  ],
  plantages: [
    { log: 'Application', provider: 'Application Error', id: 1000 },
    { log: 'Application', provider: 'Application Hang', id: 1002 }
  ]
};

/** Ce que signifient les evenements les plus parlants. */
const MEANINGS = {
  'Microsoft-Windows-Kernel-Power|41': 'Redemarrage sans arret propre : coupure de courant, blocage, ou bouton d\'alimentation maintenu.',
  'EventLog|6008': 'Windows a constate que l\'arret precedent etait inattendu.',
  'Microsoft-Windows-WER-SystemErrorReporting|1001': 'Ecran bleu : Windows s\'est arrete sur une erreur systeme.',
  'Application Error|1000': 'Une application a plante.',
  'Application Hang|1002': 'Une application a cesse de repondre et a ete fermee.'
};
const meaningOf = (event) => MEANINGS[`${event.source}|${event.id}`] || null;

const NONE = {
  arrets: 'Aucun arret imprevu',
  plantages: 'Aucun plantage d\'application',
  erreurs: 'Aucune erreur',
  alertes: 'Aucune erreur ni alerte'
};

/** Derniere liste affichee, par session : `journal 3` en detaille une ligne. */
const lastListing = new WeakMap();

/** « 24h », « 7j », « 90m », « 2d » : duree en minutes (90 jours au plus). */
function parsePeriod(value) {
  const match = /^(\d+(?:[.,]\d+)?)\s*(m|min|h|j|d)$/i.exec(String(value).trim());
  if (!match) throw new Error(`Periode invalide : ${value} (exemples : 90m, 24h, 7j).`);
  const amount = Number(match[1].replace(',', '.'));
  const unit = match[2].toLowerCase();
  const minutes = amount * (unit.startsWith('m') ? 1 : unit === 'h' ? 60 : 1440);
  return Math.max(1, Math.min(90 * 1440, Math.round(minutes)));
}

function periodLabel(minutes) {
  if (minutes % 1440 === 0 && minutes >= 2880) return `${minutes / 1440} jours`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

/** Un filtre Get-WinEvent, en syntaxe PowerShell. */
function hashtable(filter) {
  const parts = [`LogName = ${[].concat(filter.log).map(psQuote).join(',')}`];
  if (filter.provider) parts.push(`ProviderName = ${psQuote(filter.provider)}`);
  if (filter.id) parts.push(`Id = ${filter.id}`);
  if (filter.levels) parts.push(`Level = ${filter.levels.join(',')}`);
  parts.push('StartTime = $since');
  return `@{ ${parts.join('; ')} }`;
}

/** Script : les evenements des filtres, du plus recent au plus ancien. */
function eventsScript(filters, minutes, max = MAX_EVENTS) {
  return [
    `$since = (Get-Date).AddMinutes(-${minutes})`,
    '$all = New-Object System.Collections.ArrayList',
    `foreach ($f in @(${filters.map(hashtable).join(', ')})) {`,
    `  try { foreach ($e in Get-WinEvent -FilterHashtable $f -MaxEvents ${max} -ErrorAction Stop) { [void]$all.Add($e) } } catch {}`,
    '}',
    `$all | Sort-Object TimeCreated -Descending | Select-Object -First ${max} | ForEach-Object {`,
    '  $m = [string]$_.Message; if ($m.Length -gt 4000) { $m = $m.Substring(0, 4000) }',
    "  [pscustomobject]@{ time = $_.TimeCreated.ToString('o'); level = [int]$_.Level; source = $_.ProviderName; id = $_.Id; log = $_.LogName; message = $m }",
    '}'
  ].join('\n');
}

/**
 * Regroupe les evenements identiques (journal, source, ID). Les evenements
 * arrivent du plus recent au plus ancien : les groupes aussi, par derniere
 * occurrence.
 */
function group(events) {
  const groups = new Map();
  for (const event of events) {
    const key = `${event.log}|${event.source}|${event.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.first = event;
    } else {
      groups.set(key, { event, first: event, count: 1 });
    }
  }
  return [...groups.values()];
}

/** Premiere ligne utile d'un message. */
function firstLine(message) {
  const line = String(message || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '(message indisponible)';
  return line.length > 110 ? `${line.slice(0, 107)}...` : line;
}

/**
 * Le programme en cause : premier nom en .exe du message, qu'il suive un
 * deux-points (« Nom de l'application defaillante : chrome.exe, ... ») ou non
 * (« Le programme winget.exe version ... a cesse d'interagir »).
 */
function appName(message) {
  const match = /([^\s,:\\/"]+\.exe)\b/i.exec(String(message || ''));
  return match ? match[1] : null;
}

const shortSource = (source) => String(source || '?').replace(/^Microsoft-Windows-/, '');

function detail(ctx, n) {
  const rows = lastListing.get(ctx.session);
  if (!rows || !rows.length) throw new Error('Aucune liste a detailler : lancez d\'abord journal.');
  if (n < 1 || n > rows.length) throw new Error(`Pas d'evenement n°${n} : la derniere liste en compte ${rows.length}.`);

  const { event, count, first } = rows[n - 1];
  const pairs = [
    ['Date', formatDate(new Date(event.time))],
    ['Niveau', LEVELS[event.level] || String(event.level)],
    ['Journal', event.log],
    ['Source', event.source],
    ['ID', String(event.id)]
  ];
  if (count > 1) pairs.push(['Occurrences', `${count}, la premiere le ${formatDate(new Date(first.time))}`]);

  const blocks = [ctx.out.title('Evenement', `${shortSource(event.source)} ${event.id}`), ctx.out.kv(pairs)];
  const meaning = meaningOf(event);
  if (meaning) blocks.push(ctx.out.accent(meaning));
  blocks.push(ctx.out.code(String(event.message || '(message indisponible)').trim()));
  return blocks;
}

const journal = {
  name: 'journal',
  aliases: ['evenements'],
  category: 'Systeme',
  summary: 'Erreurs du journal d\'evenements de Windows : plantages, pilotes, arrets imprevus.',
  usage: 'journal [texte] [--depuis 24h] [--alertes] [--liste] | journal --arrets | journal --plantages | journal <n>',
  details: [
    '  journal                erreurs des dernieres 24 h, regroupees par source',
    '  journal --depuis 7j    sur une autre periode (90m, 24h, 7j... 90 jours au plus)',
    '  journal --alertes      avec les alertes (souvent tres nombreuses)',
    '  journal disque         seulement ce qui mentionne « disque »',
    '  journal --liste        un evenement par ligne, sans regroupement',
    '  journal --arrets       redemarrages sans arret propre, ecrans bleus (30 jours)',
    '  journal --plantages    applications plantees ou bloquees (30 jours)',
    '  journal 3              le message complet de la ligne 3',
    '',
    'Journaux lus : Systeme et Application (--dans pour n\'en garder qu\'un).'
  ].join('\n'),
  examples: ['journal', 'journal --depuis 7j', 'journal --arrets', 'journal --plantages', 'journal 2'],
  flags: { depuis: 'string', alertes: 'boolean', liste: 'boolean', arrets: 'boolean', plantages: 'boolean', dans: 'string', limit: 'number' },
  flagHelp: {
    depuis: 'Periode examinee : 90m, 24h, 7j... (defaut 24h ; 30j pour --arrets et --plantages).',
    alertes: 'Inclure les alertes, en plus des erreurs.',
    liste: 'Un evenement par ligne, sans regroupement.',
    arrets: 'Arrets imprevus et ecrans bleus.',
    plantages: 'Applications plantees ou bloquees.',
    dans: 'Un seul journal : system ou application.',
    limit: 'Nombre de lignes (defaut 30).'
  },
  short: { n: 'limit', d: 'depuis' },

  async run(ctx) {
    if (!IS_WINDOWS) throw new Error('Le journal d\'evenements n\'existe que sous Windows.');
    const { flags, out } = ctx;
    const text = ctx.args.join(' ').trim();

    const number = /^#?(\d+)$/.exec(text);
    if (number) return detail(ctx, Number(number[1]));

    const preset = flags.arrets ? 'arrets' : flags.plantages ? 'plantages' : null;
    const minutes = parsePeriod(flags.depuis || (preset ? '30j' : '24h'));
    let filters;
    if (preset) {
      filters = PRESETS[preset];
    } else {
      let logs = ['System', 'Application'];
      if (flags.dans) {
        const log = LOGS[fold(flags.dans)];
        if (!log) throw new Error('--dans accepte : system, application.');
        logs = [log];
      }
      filters = [{ log: logs, levels: flags.alertes ? [1, 2, 3] : [1, 2] }];
    }

    const started = Date.now();
    let events = await runJson(eventsScript(filters, minutes), { signal: ctx.signal, timeout: 60000 });
    const capped = events.length >= MAX_EVENTS;
    if (text) {
      const q = fold(text);
      events = events.filter((e) => fold(e.source || '').includes(q) || fold(e.message || '').includes(q));
    }

    const grouped = !preset && !flags.liste;
    let entries = grouped ? group(events) : events.map((event) => ({ event, first: event, count: 1 }));
    const total = entries.length;
    entries = entries.slice(0, Math.max(1, flags.limit || 30));
    lastListing.set(ctx.session, entries);

    if (!entries.length) {
      const key = preset || (flags.alertes ? 'alertes' : 'erreurs');
      return out.success(`${NONE[key]}${text ? ` contenant « ${text} »` : ''} sur ${periodLabel(minutes)}.`);
    }

    const columns = [
      { key: 'n', label: '#', align: 'right' },
      { key: 'date', label: grouped ? 'Dernier' : 'Date' },
      { key: 'niveau', label: 'Niveau' },
      { key: 'source', label: 'Source' },
      { key: 'id', label: 'ID', align: 'right' },
      ...(grouped ? [{ key: 'fois', label: 'Fois', align: 'right' }] : []),
      { key: 'message', label: preset === 'plantages' ? 'Application' : 'Message' }
    ];
    const rows = entries.map((entry, i) => ({
      n: String(i + 1),
      date: formatDate(new Date(entry.event.time)),
      niveau: LEVELS[entry.event.level] || String(entry.event.level),
      source: shortSource(entry.event.source),
      id: String(entry.event.id),
      fois: String(entry.count),
      message: (preset === 'plantages' && appName(entry.event.message)) || firstLine(entry.event.message)
    }));

    const parts = [`${events.length} evenement${events.length > 1 ? 's' : ''} sur ${periodLabel(minutes)}`];
    if (grouped) parts.push(`${total} source${total > 1 ? 's' : ''} distincte${total > 1 ? 's' : ''}`);
    if (total > entries.length) parts.push(`${entries.length} premieres lignes (--limit pour plus)`);
    parts.push(`${Date.now() - started} ms`);

    const blocks = [out.table(columns, rows), out.dim(parts.join(' - '))];
    if (preset) {
      const meanings = [...new Set(entries.map((entry) => meaningOf(entry.event)).filter(Boolean))];
      if (meanings.length) blocks.push(out.list(meanings));
    }
    if (capped) blocks.push(out.warn(`Lecture limitee aux ${MAX_EVENTS} evenements les plus recents : reduisez la periode (--depuis).`));
    blocks.push(out.dim(preset
      ? 'journal <n> : le message complet.'
      : 'journal <n> : le message complet - --alertes pour les alertes - --depuis 7j - --arrets, --plantages'));
    return blocks;
  }
};

module.exports = [journal];
module.exports.internals = { parsePeriod, periodLabel, eventsScript, hashtable, group, firstLine, appName, PRESETS, MAX_EVENTS };
