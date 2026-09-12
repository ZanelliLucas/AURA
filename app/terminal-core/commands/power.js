'use strict';

/**
 * `alimentation` : reglages d'energie, cause probable des arrets imprevus, et
 * chronologie des demarrages, arrets et mises en veille. Lecture seule.
 *
 * Constats sur la machine cible :
 *  - powercfg repond en francais (« Index actuel du parametre de courant
 *    alternatif : 0x00000000 ») : on lit les lignes « actuel / current » ;
 *  - l'evenement Kernel-Power 41 (redemarrage sans arret propre) porte des
 *    indices dans ses donnees : code d'ecran bleu, panne pendant la veille,
 *    bouton d'alimentation presse ou maintenu. Tous a zero : coupure nette.
 */

const { runJson, formatDate, IS_WINDOWS } = require('../platform');
const journal = require('./journal').internals;

/** Evenements de la chronologie, et leur libelle. */
const TIMELINE_FILTERS = [
  { log: 'System', provider: 'Microsoft-Windows-Kernel-General', id: [12, 13] },
  { log: 'System', provider: 'Microsoft-Windows-Kernel-Power', id: [41, 42, 107] },
  { log: 'System', provider: 'Microsoft-Windows-Power-Troubleshooter', id: 1 },
  { log: 'System', provider: 'User32', id: 1074 },
  { log: 'System', provider: 'EventLog', id: 6008 }
];

const TIMELINE = {
  'Microsoft-Windows-Kernel-General|12': ['Demarrage', 'ok'],
  'Microsoft-Windows-Kernel-General|13': ['Arret', 'dim'],
  'Microsoft-Windows-Kernel-Power|41': ['Redemarrage sans arret propre', 'error'],
  'Microsoft-Windows-Kernel-Power|42': ['Mise en veille', 'dim'],
  'Microsoft-Windows-Kernel-Power|107': ['Sortie de veille', 'dim'],
  'Microsoft-Windows-Power-Troubleshooter|1': ['Sortie de veille', 'dim'],
  'User32|1074': ['Arret ou redemarrage demande', 'dim'],
  'EventLog|6008': ['Arret precedent inattendu', 'warn']
};

/** Les arrets imprevus, regroupes par cause, dits en clair. */
const CAUSES = {
  'ecran-bleu': 'ecran bleu (erreur systeme)',
  'bouton-long': 'bouton d\'alimentation maintenu : arret force',
  bouton: 'bouton d\'alimentation presse juste avant : PC sans doute fige, ou eteint par le bouton',
  veille: 'panne pendant la mise en veille ou la sortie de veille',
  coupure: 'coupure nette, sans ecran bleu ni veille : courant, alimentation electrique, surchauffe, blocage materiel ou bouton reset'
};

const isSet = (value) => value != null && value !== '' && value !== '0' && String(value).toLowerCase() !== 'false';

/** Cause probable d'un Kernel-Power 41, d'apres ses donnees. */
function causeOf(event) {
  if (isSet(event.bugcheck)) {
    const code = `0x${Number(event.bugcheck).toString(16).toUpperCase()}`;
    return { kind: 'ecran-bleu', label: `Ecran bleu (code ${code})` };
  }
  if (isSet(event.longPress)) return { kind: 'bouton-long', label: 'Bouton d\'alimentation maintenu (arret force)' };
  if (isSet(event.button)) return { kind: 'bouton', label: 'Bouton d\'alimentation presse juste avant' };
  if (isSet(event.sleep)) return { kind: 'veille', label: 'Panne pendant la veille ou la sortie de veille' };
  return { kind: 'coupure', label: 'Coupure nette (ni ecran bleu, ni veille, ni bouton)' };
}

/** « GUID du mode ... : 8c5e...  (Paragon Core Power Plan) » */
function parseScheme(text) {
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*\(([^)]*)\)/i.exec(String(text || ''));
  return match ? { guid: match[1], name: match[2].trim() } : null;
}

/**
 * Valeur actuelle d'un reglage powercfg : secteur, puis batterie. On lit les
 * lignes « actuel » (ou « Current ») ; a defaut, les deux dernieres valeurs.
 */
function parseSetting(text) {
  const lines = String(text || '').split(/\r?\n/);
  const hex = (line) => { const m = /0x([0-9a-f]+)/i.exec(line); return m ? parseInt(m[1], 16) : null; };
  let values = lines.filter((l) => /actuel|current/i.test(l)).map(hex).filter((v) => v != null);
  if (!values.length) values = lines.map(hex).filter((v) => v != null).slice(-2);
  if (!values.length) return null;
  return { ac: values[0], dc: values.length > 1 ? values[1] : null };
}

/** « Compteur d'historique des sorties de veille - 0 » puis le detail eventuel. */
function parseLastWake(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const count = lines.length ? Number((/(\d+)\s*$/.exec(lines[0]) || [])[1]) : NaN;
  return { count: Number.isFinite(count) ? count : null, details: lines.slice(1) };
}

/** Delai en secondes : « jamais », « 10 min », « 1 h 30 min ». */
function durationLabel(seconds) {
  if (seconds == null) return '?';
  if (!seconds) return 'jamais';
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h${m ? ` ${m} min` : ''}`;
}

/** Detail d'un evenement de la chronologie. */
function timelineDetail(event, causes) {
  const key = `${event.source}|${event.id}`;
  const message = String(event.message || '');
  if (key === 'User32|1074') {
    const proc = /([^\s\\/"]+\.exe)/i.exec(message);
    const kind = /red[ée]marr|restart/i.test(message) ? 'redemarrage' : 'arret';
    return `${kind} demande${proc ? ` par ${proc[1]}` : ''}`;
  }
  if (key === 'Microsoft-Windows-Power-Troubleshooter|1') {
    const source = /(?:Source de sortie de veille|Wake Source)\s*:\s*(.+)/i.exec(message);
    return source ? `reveille par : ${source[1].trim()}` : '';
  }
  if (key === 'Microsoft-Windows-Kernel-Power|41') {
    const cause = causes.get(event.time);
    return cause ? cause.label : '';
  }
  return '';
}

/** Script : reglages, arrets imprevus (30 j) et chronologie (periode demandee). */
function powerScript(minutes) {
  return [
    '$scheme = (powercfg /getactivescheme) -join "`n"',
    '$standby = (powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE) -join "`n"',
    '$video = (powercfg /query SCHEME_CURRENT SUB_VIDEO VIDEOIDLE) -join "`n"',
    '$lastwake = (powercfg /lastwake) -join "`n"',
    "$p1 = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power' -ErrorAction SilentlyContinue",
    "$p2 = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power' -ErrorAction SilentlyContinue",
    '$battery = @(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ charge = [int]$_.EstimatedChargeRemaining } })',
    '$since = (Get-Date).AddDays(-30)',
    '$arrets = @(); try { $arrets = @(Get-WinEvent -FilterHashtable @{ LogName = \'System\'; ProviderName = \'Microsoft-Windows-Kernel-Power\'; Id = 41; StartTime = $since } -ErrorAction Stop | ForEach-Object {',
    "  $d = @{}; foreach ($n in ([xml]$_.ToXml()).Event.EventData.Data) { $d[[string]$n.Name] = [string]$n.'#text' }",
    "  [pscustomobject]@{ time = $_.TimeCreated.ToString('o'); bugcheck = $d['BugcheckCode']; sleep = $d['SleepInProgress']; button = $d['PowerButtonTimestamp']; longPress = $d['LongPowerButtonPressDetected'] }",
    '}) } catch {}',
    `$since = (Get-Date).AddMinutes(-${minutes})`,
    '$timeline = New-Object System.Collections.ArrayList',
    `foreach ($f in @(${TIMELINE_FILTERS.map(journal.hashtable).join(', ')})) {`,
    "  try { foreach ($e in Get-WinEvent -FilterHashtable $f -ErrorAction Stop) { $m = [string]$e.Message; if ($m.Length -gt 1000) { $m = $m.Substring(0, 1000) }; [void]$timeline.Add([pscustomobject]@{ time = $e.TimeCreated.ToString('o'); source = $e.ProviderName; id = $e.Id; message = $m }) } } catch {}",
    '}',
    '[pscustomobject]@{ scheme = $scheme; standby = $standby; video = $video; lastwake = $lastwake; hiberboot = $p1.HiberbootEnabled; hibernate = $p2.HibernateEnabled; battery = $battery; arrets = $arrets; timeline = @($timeline) }'
  ].join('\n');
}

const asList = (value) => (Array.isArray(value) ? value : (value == null ? [] : [value]));
const onOff = (value) => (value == null ? '?' : Number(value) ? 'active' : 'desactive');

function settingLabel(setting, hasBattery) {
  if (!setting) return '?';
  if (!hasBattery || setting.dc == null) return durationLabel(setting.ac);
  return `secteur : ${durationLabel(setting.ac)}, batterie : ${durationLabel(setting.dc)}`;
}

const power = {
  name: 'alimentation',
  aliases: ['energie', 'power'],
  category: 'Systeme',
  summary: 'Reglages d\'energie, cause probable des arrets imprevus, et chronologie des demarrages et arrets.',
  usage: 'alimentation [--depuis 7j] [--limit 20]',
  details: [
    'Trois parties, en lecture seule :',
    '  - reglages : mode d\'alimentation, mise en veille, extinction de l\'ecran,',
    '    demarrage rapide, veille prolongee, dernier reveil ;',
    '  - arrets imprevus (30 jours), chacun avec sa cause probable : ecran bleu,',
    '    panne de veille, bouton d\'alimentation presse ou maintenu, ou coupure nette ;',
    '  - chronologie des demarrages, arrets et mises en veille (--depuis, 7 jours',
    '    par defaut), avec le programme qui a demande chaque arret.'
  ].join('\n'),
  examples: ['alimentation', 'alimentation --depuis 30j --limit 40'],
  flags: { depuis: 'string', limit: 'number' },
  flagHelp: {
    depuis: 'Periode de la chronologie : 24h, 7j, 30j... (defaut 7j).',
    limit: 'Lignes de la chronologie (defaut 20).'
  },
  short: { d: 'depuis', n: 'limit' },

  async run(ctx) {
    if (!IS_WINDOWS) throw new Error('Les reglages d\'alimentation ne se lisent que sous Windows.');
    const { out, flags } = ctx;
    const minutes = journal.parsePeriod(flags.depuis || '7j');
    const data = await runJson(powerScript(minutes), { asArray: false, signal: ctx.signal, timeout: 60000 });

    // --- Reglages -----------------------------------------------------------------
    const battery = asList(data.battery);
    const scheme = parseScheme(data.scheme);
    const wake = parseLastWake(data.lastwake);
    const pairs = [
      ['Mode actif', scheme ? scheme.name : '?'],
      ['Mise en veille', settingLabel(parseSetting(data.standby), battery.length)],
      ['Extinction de l\'ecran', settingLabel(parseSetting(data.video), battery.length)],
      ['Demarrage rapide', onOff(data.hiberboot)],
      ['Veille prolongee', onOff(data.hibernate)]
    ];
    if (battery.length) pairs.push(['Batterie', `${battery[0].charge} %`]);
    pairs.push(['Dernier reveil', wake.count ? wake.details.join(' ; ') || `${wake.count} enregistre(s)` : 'aucun enregistre']);
    const blocks = [out.title('Reglages'), out.kv(pairs)];

    // --- Arrets imprevus ----------------------------------------------------------
    const arrets = asList(data.arrets).sort((a, b) => new Date(b.time) - new Date(a.time));
    const causes = new Map(arrets.map((a) => [a.time, causeOf(a)]));
    blocks.push(out.title('Arrets imprevus', '30 jours'));
    if (!arrets.length) {
      blocks.push(out.success('Aucun redemarrage sans arret propre en 30 jours.'));
    } else {
      blocks.push(out.table(
        [{ key: 'date', label: 'Date' }, { key: 'cause', label: 'Cause probable', tone: true }],
        arrets.map((a) => ({ date: formatDate(new Date(a.time)), cause: causes.get(a.time).label, _tone: 'error' }))
      ));
      const counts = new Map();
      for (const cause of causes.values()) counts.set(cause.kind, (counts.get(cause.kind) || 0) + 1);
      blocks.push(out.list([...counts].sort((a, b) => b[1] - a[1]).map(([kind, n]) => `${n} fois : ${CAUSES[kind]}`)));
      blocks.push(out.dim('Les minutes qui precedent un arret : journal --depuis 7j (voir les heures ci-dessus). Materiel : peripheriques.'));
    }

    // --- Chronologie ---------------------------------------------------------------
    const limit = Math.max(1, flags.limit || 20);
    const timeline = asList(data.timeline).sort((a, b) => new Date(b.time) - new Date(a.time));
    blocks.push(out.title('Chronologie', `${journal.periodLabel(minutes)}`));
    if (!timeline.length) {
      blocks.push(out.dim('Aucun demarrage, arret ni mise en veille sur la periode.'));
    } else {
      blocks.push(out.table(
        [{ key: 'date', label: 'Date' }, { key: 'quoi', label: 'Evenement', tone: true }, { key: 'detail', label: 'Detail' }],
        timeline.slice(0, limit).map((e) => {
          const [label, tone] = TIMELINE[`${e.source}|${e.id}`] || [`${e.source} ${e.id}`, 'dim'];
          return { date: formatDate(new Date(e.time)), quoi: label, detail: timelineDetail(e, causes), _tone: tone };
        })
      ));
      if (timeline.length > limit) blocks.push(out.dim(`${limit} evenements sur ${timeline.length} - --limit pour plus.`));
    }
    return blocks;
  }
};

module.exports = [power];
module.exports.internals = { causeOf, parseScheme, parseSetting, parseLastWake, durationLabel, timelineDetail, powerScript, CAUSES };
