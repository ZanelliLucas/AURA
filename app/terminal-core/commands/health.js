'use strict';

/**
 * `sante` : un bilan du PC en une commande - un voyant par point, et la
 * commande a taper pour creuser. Tout se lit sans droits administrateur ;
 * les lectures lentes (etat physique des disques, ~2 s ; place recuperable,
 * ~3 s) partent en parallele.
 */

const os = require('os');
const { runJson, formatBytes, formatDuration, formatDate, IS_WINDOWS } = require('../platform');
const out = require('../output');
const { fold } = require('../text');
const journal = require('./journal').internals;
const desktop = require('./desktop').internals;
const clean = require('./clean').internals;

const GB = 1024 ** 3;

/** Libelle et ton de chaque etat. */
const STATUS = {
  ok: ['OK', 'ok'],
  warn: ['ATTENTION', 'warn'],
  critical: ['CRITIQUE', 'error'],
  unknown: ['?', 'dim']
};

const HEALTH = { Healthy: 'sain', Warning: 'a surveiller', Unhealthy: 'defaillant', Unknown: 'inconnu' };

const asList = (value) => (Array.isArray(value) ? value : (value == null ? [] : [value]));

/** Faits systeme, lus en un seul passage de PowerShell. */
function factsScript() {
  const count = (filters) => `(Count @(${filters.map(journal.hashtable).join(', ')}))`;
  return [
    'function Count($filters) { $n = 0; foreach ($f in $filters) { try { $n += @(Get-WinEvent -FilterHashtable $f -ErrorAction Stop).Count } catch {} }; $n }',
    "$drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { [pscustomobject]@{ id = $_.DeviceID; size = [int64]$_.Size; free = [int64]$_.FreeSpace } })",
    '$disks = @(); try { $disks = @(Get-PhysicalDisk -ErrorAction Stop | ForEach-Object { [pscustomobject]@{ name = [string]$_.FriendlyName; health = [string]$_.HealthStatus } }) } catch {}',
    "$reboot = (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') -or (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending')",
    "$index = 'absent'; try { $index = [string](Get-Service WSearch -ErrorAction Stop).Status } catch {}",
    '$devices = @(); $deviceTotal = 0; try { $pnp = @(Get-CimInstance Win32_PnPEntity -ErrorAction Stop); $deviceTotal = $pnp.Count; $devices = @($pnp | Where-Object { $_.ConfigManagerErrorCode -ne 0 } | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; code = [int]$_.ConfigManagerErrorCode } }) } catch {}',
    '$since = (Get-Date).AddDays(-30)',
    // Le plus recent aussi : le suivi de fond reconnait ainsi un nouvel arret,
    // meme quand un ancien sort de la fenetre de 30 jours.
    `$arretEvents = @(); foreach ($f in @(${journal.PRESETS.arrets.map(journal.hashtable).join(', ')})) { try { $arretEvents += @(Get-WinEvent -FilterHashtable $f -ErrorAction Stop) } catch {} }`,
    '$arrets = $arretEvents.Count',
    "$lastArret = $null; if ($arrets) { $lastArret = ($arretEvents | Sort-Object TimeCreated -Descending | Select-Object -First 1).TimeCreated.ToString('o') }",
    '$since = (Get-Date).AddDays(-7)',
    `$plantages = ${count(journal.PRESETS.plantages)}`,
    '[pscustomobject]@{ drives = $drives; disks = $disks; devices = $devices; deviceTotal = $deviceTotal; rebootPending = $reboot; index = $index; arrets = $arrets; lastArret = $lastArret; plantages = $plantages }'
  ].join('\n');
}

const check = (id, label, status, detail, hint = null) => ({ id, label, status, detail, hint: status === 'ok' ? null : hint });
const unknown = (id, label) => check(id, label, 'unknown', 'lecture impossible');

/**
 * Les voyants, a partir de ce qui a pu etre lu. Une lecture echouee (null)
 * donne un voyant « ? » plutot que de faire echouer tout le bilan.
 *
 * @param {{facts:Object|null, startup:Array|null, reclaimable:number|null, memory:{total:number,free:number}, uptime:number}} input
 */
function evaluate({ facts, startup, reclaimable, memory, uptime }) {
  const checks = [];

  const drives = facts ? asList(facts.drives).filter((d) => Number(d.size) > 0) : [];
  if (drives.length) {
    const worst = Math.min(...drives.map((d) => d.free / d.size));
    checks.push(check('disques', 'Espace disque',
      worst < 0.10 ? 'critical' : worst < 0.20 ? 'warn' : 'ok',
      drives.map((d) => `${d.id} ${formatBytes(d.free)} libres sur ${formatBytes(d.size)} (${Math.round((100 * d.free) / d.size)} %)`).join(', '),
      'nettoyer, puis nettoyer --gros'));
  } else {
    checks.push(unknown('disques', 'Espace disque'));
  }

  const disks = facts ? asList(facts.disks) : [];
  if (disks.length) {
    const unhealthy = disks.some((d) => d.health === 'Unhealthy');
    const watch = disks.some((d) => d.health !== 'Healthy');
    checks.push(check('etat-disques', 'Etat des disques',
      unhealthy ? 'critical' : watch ? 'warn' : 'ok',
      disks.map((d) => `${d.name} : ${HEALTH[d.health] || d.health}`).join(', '),
      unhealthy ? 'sauvegardez vos donnees sans attendre' : 'gardez une sauvegarde a jour'));
  } else {
    checks.push(unknown('etat-disques', 'Etat des disques'));
  }

  if (facts && facts.deviceTotal) {
    // Desactive volontairement (22) ou debranche (45) : pas une panne.
    const faulty = asList(facts.devices).filter((d) => d.code !== 22 && d.code !== 45);
    checks.push(check('peripheriques', 'Peripheriques', faulty.length ? 'warn' : 'ok',
      faulty.length
        ? `${faulty.length} en erreur : ${faulty.slice(0, 2).map((d) => d.name).join(', ')}${faulty.length > 2 ? '...' : ''}`
        : `aucun en erreur sur ${facts.deviceTotal}`,
      'peripheriques'));
  } else {
    checks.push(unknown('peripheriques', 'Peripheriques'));
  }

  const used = memory.total - memory.free;
  const ratio = used / memory.total;
  checks.push(check('memoire', 'Memoire', ratio >= 0.9 ? 'warn' : 'ok',
    `${formatBytes(used)} utilises sur ${formatBytes(memory.total)} (${Math.round(ratio * 100)} %)`, 'ps --tri ram'));

  if (facts) {
    const arrets = Number(facts.arrets) || 0;
    checks.push(Object.assign(check('arrets', 'Arrets imprevus (30 j)', arrets >= 3 ? 'critical' : arrets >= 1 ? 'warn' : 'ok',
      arrets ? `${arrets} en 30 jours` : 'aucun', 'alimentation, boitenoire, journal --arrets'), { value: facts.lastArret || null }));

    const plantages = Number(facts.plantages) || 0;
    checks.push(check('plantages', 'Plantages (7 j)', plantages >= 10 ? 'critical' : plantages >= 3 ? 'warn' : 'ok',
      plantages ? `${plantages} en 7 jours` : 'aucun', 'journal --plantages'));

    checks.push(check('maj', 'Mises a jour', facts.rebootPending ? 'warn' : 'ok',
      facts.rebootPending ? 'Windows attend un redemarrage pour les terminer' : 'aucun redemarrage en attente',
      'redemarrez quand vous pourrez'));

    const indexed = facts.index === 'Running';
    checks.push(check('index', 'Index Windows', indexed ? 'ok' : 'warn',
      indexed ? 'actif : find et grep sont instantanes' : `arrete (${facts.index}) : find et grep parcourent le disque`,
      'service start wsearch --admin'));
  } else {
    checks.push(unknown('arrets', 'Arrets imprevus (30 j)'), unknown('plantages', 'Plantages (7 j)'),
      unknown('maj', 'Mises a jour'), unknown('index', 'Index Windows'));
  }

  checks.push(check('allume', 'Allume depuis', uptime > 30 * 86400 ? 'warn' : 'ok', formatDuration(uptime),
    'un redemarrage de temps en temps rafraichit Windows'));

  if (startup) {
    const active = startup.filter((e) => e.enabled).length;
    checks.push(check('demarrage', 'Programmes au demarrage', active > 10 ? 'warn' : 'ok',
      `${active} actif${active > 1 ? 's' : ''} sur ${startup.length}`, 'demarrage'));
  } else {
    checks.push(unknown('demarrage', 'Programmes au demarrage'));
  }

  if (reclaimable != null) {
    checks.push(check('place', 'Place recuperable', reclaimable >= 10 * GB ? 'warn' : 'ok',
      `${formatBytes(reclaimable)} (temporaires, caches, corbeille)`, 'nettoyer'));
  } else {
    checks.push(unknown('place', 'Place recuperable'));
  }

  return checks;
}

/** Ce que `nettoyer vider tout --admin` pourrait liberer. */
async function measureReclaimable(ctx) {
  let total = 0;
  for (const category of clean.categories()) {
    const m = category.recycleBin
      ? await clean.measureRecycleBin(ctx)
      : await clean.measureCategory(category, { signal: ctx.signal });
    total += m.bytes;
  }
  return total;
}

/**
 * L'examen complet : les lectures (en parallele), puis les voyants. Partage
 * par la commande et par le suivi de fond de l'application.
 */
async function examine({ signal } = {}) {
  // Une lecture qui echoue donne un voyant « ? », pas un bilan en echec.
  const attempt = (promise) => promise.catch(() => null);
  const [facts, startup, reclaimable] = await Promise.all([
    attempt(runJson(factsScript(), { asArray: false, signal, timeout: 60000 })),
    attempt(runJson(desktop.listScript(), { signal, timeout: 30000 })),
    attempt(measureReclaimable({ signal }))
  ]);
  if (signal && signal.aborted) throw Object.assign(new Error('Bilan interrompu.'), { name: 'AbortError' });
  return evaluate({
    facts,
    startup,
    reclaimable,
    memory: { total: os.totalmem(), free: os.freemem() },
    uptime: os.uptime()
  });
}

const RANK = { ok: 0, warn: 1, critical: 2 };

/**
 * Ce qui justifie de prevenir entre deux examens : un voyant qui se degrade,
 * ou un arret imprevu plus recent que le dernier connu. Une amelioration, un
 * voyant « ? » ou un etat stable ne previennent pas.
 */
function compareHealth(previous, current) {
  const before = new Map((previous || []).map((c) => [c.id, c]));
  const changes = [];
  for (const c of current) {
    const old = before.get(c.id);
    if (!old || !(c.status in RANK) || !(old.status in RANK)) continue;
    if (RANK[c.status] > RANK[old.status]) {
      changes.push({ ...c, from: old.status, reason: 'degrade' });
    } else if (c.id === 'arrets' && c.value && (!old.value || new Date(c.value) > new Date(old.value))) {
      changes.push({ ...c, from: old.status, reason: 'nouvel-arret' });
    }
  }
  return changes;
}

/** Notification et annonce d'un changement de sante. */
function describeHealthChanges(changes) {
  const lines = changes.map((c) => (c.reason === 'nouvel-arret'
    ? `Nouvel arret imprevu - ${c.detail}`
    : `${c.label} : ${STATUS[c.status][0]} - ${c.detail}`));
  const arret = changes.some((c) => c.id === 'arrets');
  return {
    title: 'Sante du PC : du nouveau',
    body: lines.join('\n'),
    blocks: [
      out.warn('Sante du PC : du nouveau.'),
      out.list(lines),
      out.dim(`sante pour le bilan complet${arret ? ' - boitenoire pour les minutes avant l\'arret' : ''}.`)
    ]
  };
}

/** `sante suivi [on|off]` : le suivi de fond de l'application. */
async function watchSettings(ctx) {
  const host = ctx.terminal.healthWatch;
  if (!host) throw new Error('Le suivi de la sante tourne dans l\'application, pas dans la console.');
  const choice = fold(ctx.args[1] || '');
  if (choice && choice !== 'on' && choice !== 'off') throw new Error('Usage : sante suivi [on|off]');
  if (choice) await host.set(choice === 'on');

  const state = host.get();
  const blocks = [];
  if (choice) blocks.push(ctx.out.success(choice === 'on' ? 'Suivi de la sante relance.' : 'Suivi de la sante coupe.'));
  blocks.push(ctx.out.kv([
    ['Suivi', state.enabled ? (state.active ? 'actif, un examen toutes les heures' : 'prevu (version installee seulement)') : 'coupe'],
    ['Dernier examen', state.lastRun ? formatDate(new Date(state.lastRun)) : 'pas encore'],
    ['Previent', 'quand un voyant passe a ATTENTION ou CRITIQUE, et a chaque nouvel arret imprevu']
  ]));
  return blocks;
}

const health = {
  name: 'sante',
  aliases: ['bilan', 'health'],
  category: 'Systeme',
  summary: 'Bilan du PC : disques, memoire, arrets imprevus, plantages, mises a jour... un voyant par point.',
  usage: 'sante | sante suivi [on|off]',
  details: [
    'Onze points, chacun avec un voyant (OK, ATTENTION, CRITIQUE) et, s\'il y a',
    'lieu, la commande a taper pour creuser : espace et etat des disques, materiel,',
    'memoire, arrets imprevus (30 j), plantages (7 j), mises a jour en attente,',
    'duree depuis le dernier demarrage, index Windows, programmes au demarrage,',
    'place recuperable. Rien n\'est modifie ; aucun droit administrateur requis.',
    '',
    'L\'application refait cet examen toutes les heures, en silence, et previent',
    'par une notification quand un voyant se degrade ou qu\'un nouvel arret',
    'imprevu apparait. sante suivi off le coupe, sante suivi on le relance.'
  ].join('\n'),
  examples: ['sante', 'sante suivi', 'sante suivi off'],

  async run(ctx) {
    if (!IS_WINDOWS) throw new Error('Le bilan n\'est disponible que sous Windows pour l\'instant.');
    const word = fold(ctx.args[0] || '');
    if (word === 'suivi') return watchSettings(ctx);
    if (word) throw new Error(`Usage : ${health.usage}`);

    const { out, signal } = ctx;
    ctx.emit(out.dim('Examen du PC...'));
    const started = Date.now();
    const checks = await examine({ signal });
    const critical = checks.filter((c) => c.status === 'critical');
    const warn = checks.filter((c) => c.status === 'warn');
    const toSee = critical.length + warn.length;

    const blocks = [
      out.title('Sante du PC', toSee ? `${toSee} point${toSee > 1 ? 's' : ''} a voir` : 'rien a signaler'),
      out.table(
        [
          { key: 'etat', label: 'Etat', tone: true },
          { key: 'point', label: 'Point' },
          { key: 'detail', label: 'Detail' },
          { key: 'creuser', label: 'Pour creuser' }
        ],
        checks.map((c) => ({
          etat: STATUS[c.status][0],
          point: c.label,
          detail: c.detail,
          creuser: c.hint || '',
          _tone: STATUS[c.status][1]
        }))
      )
    ];
    if (critical.length) blocks.push(out.error(`Critique : ${critical.map((c) => c.label).join(', ')}.`));
    if (warn.length) blocks.push(out.warn(`A surveiller : ${warn.map((c) => c.label).join(', ')}.`));
    if (!toSee) blocks.push(out.success('Rien a signaler.'));
    blocks.push(out.dim(`Bilan en ${Date.now() - started} ms - rien n'a ete modifie.`));
    return blocks;
  }
};

module.exports = [health];
module.exports.internals = { factsScript, evaluate, examine, compareHealth, describeHealthChanges, STATUS };
