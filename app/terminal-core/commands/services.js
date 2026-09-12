'use strict';

/**
 * `service` : les services Windows - lister, detailler, demarrer, arreter,
 * redemarrer, changer leur mode de demarrage.
 *
 * La plupart des actions sur un service exigent les droits administrateur,
 * que le Terminal n'a pas. Il tente l'action ; si Windows la refuse pour
 * cette raison, il le dit, et `--admin` la relance avec les droits apres
 * l'autorisation que Windows demande (UAC).
 */

const { run, runJson, runElevated, psQuote, IS_WINDOWS } = require('../platform');
const { fold } = require('../text');

/**
 * Services dont l'arret rendrait Windows instable, ou couperait le Terminal
 * lui-meme (WMI sert a ps, disk, service...). Refuses sans option pour passer
 * outre : services.msc reste la pour qui sait ce qu'il fait.
 */
const CRITICAL = new Set([
  'rpcss', 'rpceptmapper', 'dcomlaunch', 'lsm', 'samss', 'eventlog', 'winmgmt',
  'plugplay', 'power', 'profsvc', 'bfe', 'mpssvc', 'windefend', 'cryptsvc',
  'schedule', 'brokerinfrastructure', 'systemeventsbroker', 'coremessagingregistrar',
  'gpsvc', 'nsi', 'dhcp', 'dnscache'
]);

/** Consequences a signaler apres certaines actions. */
const NOTES = {
  wsearch: 'Tant que Windows Search est arrete, find et grep parcourent le disque au lieu de l\'index : plus lentement.'
};

const ACTIONS = {
  start: 'start', demarrer: 'start',
  stop: 'stop', arreter: 'stop',
  restart: 'restart', redemarrer: 'restart',
  mode: 'mode'
};

/** Mode demande -> valeur de Set-Service -StartupType. */
const MODES = {
  auto: 'Automatic', automatique: 'Automatic',
  manuel: 'Manual', manual: 'Manual',
  desactive: 'Disabled', desactiver: 'Disabled', disabled: 'Disabled'
};

const STATES = {
  Running: 'en cours',
  Stopped: 'arrete',
  'Start Pending': 'demarrage...',
  'Stop Pending': 'arret...',
  Paused: 'en pause',
  'Continue Pending': 'reprise...',
  'Pause Pending': 'mise en pause...'
};

const stateLabel = (s) => STATES[s.State] || String(s.State || '?');

function modeLabel(s) {
  if (s.StartMode === 'Auto') return s.DelayedAutoStart ? 'automatique (differe)' : 'automatique';
  return { Manual: 'manuel', Disabled: 'desactive', Boot: 'systeme', System: 'systeme' }[s.StartMode] || String(s.StartMode || '?');
}

const labelOf = (s) => (s.DisplayName && s.DisplayName !== s.Name ? `${s.DisplayName} (${s.Name})` : s.Name);

function requireWindows() {
  if (!IS_WINDOWS) throw new Error('Les services ne se gerent que sous Windows.');
}

async function loadServices(ctx, name = null) {
  const filter = name ? ` | Where-Object { $_.Name -eq ${psQuote(name)} }` : '';
  return runJson(
    `Get-CimInstance Win32_Service${filter} | Select-Object Name, DisplayName, State, StartMode, DelayedAutoStart, ProcessId, StartName, PathName, Description`,
    { signal: ctx.signal, timeout: 30000 }
  );
}

/** Le service designe exactement (nom court ou nom affiche), sinon null. */
function resolveService(services, query) {
  const q = fold(query);
  return services.find((s) => fold(s.Name) === q) || services.find((s) => fold(s.DisplayName || '') === q) || null;
}

/** Services dont le nom contient la recherche. */
function matching(services, query) {
  const q = fold(query);
  return services.filter((s) => fold(s.Name).includes(q) || fold(s.DisplayName || '').includes(q));
}

/** Commande PowerShell d'une action. */
function actionScript(action, name, { force = false, mode = null } = {}) {
  const n = psQuote(name);
  const f = force ? ' -Force' : '';
  if (action === 'start') return `Start-Service -Name ${n} -ErrorAction Stop`;
  if (action === 'stop') return `Stop-Service -Name ${n}${f} -ErrorAction Stop`;
  if (action === 'restart') return `Restart-Service -Name ${n}${f} -ErrorAction Stop`;
  if (action === 'mode') return `Set-Service -Name ${n} -StartupType ${mode} -ErrorAction Stop`;
  throw new Error(`Action inconnue : ${action}`);
}

/**
 * Tentative sans droits : le script dit OK, ACCES (Windows exige les droits
 * administrateur : erreur Win32 5 quelque part dans la chaine), ou ERREUR.
 */
function attemptScript(script) {
  return [
    'try {',
    `  ${script}`,
    "  'OK'",
    '} catch {',
    '  $denied = $false; $e = $_.Exception',
    '  while ($e) { if ($e -is [System.ComponentModel.Win32Exception] -and $e.NativeErrorCode -eq 5) { $denied = $true }; $e = $e.InnerException }',
    "  if ($denied -or $_.Exception.Message -match 'acc.s refus|access is denied') { 'ACCES' } else { 'ERREUR ' + $_.Exception.Message }",
    '}'
  ].join('\n');
}

/** @returns {{status:'ok'|'denied'|'error'|'unknown', message?:string}} */
function parseAttempt(stdout) {
  const last = String(stdout || '').trim().split(/\r?\n/).pop() || '';
  if (last === 'OK') return { status: 'ok' };
  if (last === 'ACCES') return { status: 'denied' };
  if (last.startsWith('ERREUR ')) return { status: 'error', message: last.slice(7).trim() };
  return { status: 'unknown', message: last };
}

function explainFailure(message) {
  if (/dependent|d.pendant/i.test(message)) return `${message} --force arrete aussi les services qui en dependent.`;
  return message;
}

/** L'etat vise est-il atteint ? (pour une action elevee, dont on ne lit pas la sortie) */
function reached(action, mode, s) {
  if (!s) return false;
  if (action === 'start' || action === 'restart') return s.State === 'Running';
  if (action === 'stop') return s.State === 'Stopped';
  return s.StartMode === { Automatic: 'Auto', Manual: 'Manual', Disabled: 'Disabled' }[mode];
}

function detail(ctx, s) {
  const pairs = [
    ['Nom', s.Name],
    ['Nom affiche', s.DisplayName || '-'],
    ['Etat', stateLabel(s)],
    ['Demarrage', modeLabel(s)]
  ];
  if (s.ProcessId) pairs.push(['PID', String(s.ProcessId)]);
  if (s.StartName) pairs.push(['Compte', s.StartName]);
  if (s.PathName) pairs.push(['Executable', s.PathName]);
  const blocks = [ctx.out.title('Service', s.Name), ctx.out.kv(pairs)];
  if (s.Description) blocks.push(ctx.out.dim(s.Description));
  if (CRITICAL.has(s.Name.toLowerCase())) blocks.push(ctx.out.warn('Service indispensable a Windows : le Terminal refuse de l\'arreter.'));
  blocks.push(ctx.out.dim(`service ${s.State === 'Running' ? 'stop' : 'start'} ${s.Name} - service restart ${s.Name} - service mode ${s.Name} auto|manuel|desactive`));
  return blocks;
}

function listing(ctx, services, query) {
  let rows = query ? matching(services, query) : services.slice();
  if (ctx.flags.actifs) rows = rows.filter((s) => s.State === 'Running');
  if (!rows.length) return ctx.out.warn(query ? `Aucun service ne contient « ${query} ».` : 'Aucun service.');

  // Ceux qui tournent d'abord, puis par nom affiche.
  rows.sort((a, b) => (a.State === 'Running') === (b.State === 'Running')
    ? (a.DisplayName || a.Name).localeCompare(b.DisplayName || b.Name, 'fr')
    : (a.State === 'Running' ? -1 : 1));
  const total = rows.length;
  const limit = Math.max(1, ctx.flags.limit || 60);
  rows = rows.slice(0, limit);

  return [
    ctx.out.table(
      [
        { key: 'nom', label: 'Nom' },
        { key: 'affiche', label: 'Nom affiche' },
        { key: 'etat', label: 'Etat' },
        { key: 'mode', label: 'Demarrage' },
        { key: 'pid', label: 'PID', align: 'right' }
      ],
      rows.map((s) => ({
        nom: s.Name,
        affiche: s.DisplayName || '',
        etat: stateLabel(s),
        mode: modeLabel(s),
        pid: s.ProcessId ? String(s.ProcessId) : '-'
      }))
    ),
    ctx.out.dim(`${rows.length} sur ${total} service(s)${query ? ` contenant « ${query} »` : ''}${total > rows.length ? ' - --limit pour en voir plus' : ''}`),
    ctx.out.dim('service <nom> pour le detail - service start|stop|restart <nom> - --actifs pour ceux en cours')
  ];
}

const service = {
  name: 'service',
  aliases: ['services'],
  category: 'Systeme',
  summary: 'Liste, detaille, demarre, arrete ou regle les services Windows.',
  usage: 'service [nom] | service start|stop|restart <nom> | service mode <nom> auto|manuel|desactive',
  details: [
    '  service                  tous les services, ceux en cours d\'abord',
    '  service wsearch          le detail d\'un service (nom court ou nom affiche)',
    '  service search           les services dont le nom contient « search »',
    '  service stop wsearch     arreter ; start, restart de meme',
    '  service mode wsearch manuel   mode de demarrage : auto, manuel, desactive',
    '',
    'Windows exige souvent les droits administrateur pour agir sur un service.',
    'Le Terminal essaie sans ; s\'ils sont exiges, relancez avec --admin :',
    'Windows demande alors votre autorisation.',
    '',
    'Les services indispensables a Windows (RPC, WMI, journal d\'evenements,',
    'pare-feu...) ne peuvent pas etre arretes ni desactives d\'ici.'
  ].join('\n'),
  examples: ['service', 'service --actifs', 'service wsearch', 'service restart spooler --admin', 'service mode wsearch manuel --admin'],
  flags: { actifs: 'boolean', admin: 'boolean', force: 'boolean', limit: 'number' },
  flagHelp: {
    actifs: 'Seulement les services en cours.',
    admin: 'Agir avec les droits administrateur (Windows demande l\'autorisation).',
    force: 'Arreter aussi les services qui dependent de celui-ci.',
    limit: 'Nombre de lignes de la liste (defaut 60).'
  },
  short: { n: 'limit' },
  confirmWhen: ['start', 'stop', 'restart', 'mode', 'demarrer', 'arreter', 'redemarrer'],
  complete: ({ tokens, partial }) => (tokens.length <= 1
    ? ['start', 'stop', 'restart', 'mode'].filter((a) => a.startsWith(partial || ''))
    : []),

  async run(ctx) {
    requireWindows();
    const [first, ...rest] = ctx.args;
    // Accents et casse ignores : « arrêter » vaut « arreter ».
    const action = first ? ACTIONS[fold(first)] : null;

    if (!action) {
      const services = await loadServices(ctx);
      const query = ctx.args.join(' ').trim();
      const exact = query ? resolveService(services, query) : null;
      return exact ? detail(ctx, exact) : listing(ctx, services, query);
    }

    let mode = null;
    let nameWords = rest;
    if (action === 'mode') {
      mode = MODES[fold(rest[rest.length - 1] || '')];
      if (!mode || rest.length < 2) throw new Error('Usage : service mode <nom> auto|manuel|desactive');
      nameWords = rest.slice(0, -1);
    }
    const query = nameWords.join(' ').trim();
    if (!query) throw new Error(`Usage : service ${first.toLowerCase()} <nom>`);

    const services = await loadServices(ctx);
    const svc = resolveService(services, query);
    if (!svc) {
      const near = matching(services, query).slice(0, 5).map((s) => s.Name);
      throw new Error(`Service introuvable : ${query}.${near.length ? ` Proches : ${near.join(', ')}.` : ''}`);
    }

    const key = svc.Name.toLowerCase();
    const label = labelOf(svc);
    const disruptive = action === 'stop' || action === 'restart' || (action === 'mode' && mode !== 'Automatic');
    if (disruptive && CRITICAL.has(key)) {
      throw new Error(`Refus : ${label} est indispensable a Windows${key === 'winmgmt' ? ' et au Terminal' : ''}. Pour passer outre, utilisez services.msc.`);
    }
    if (action === 'start' && svc.State === 'Running') return ctx.out.dim(`${label} tourne deja.`);
    if (action === 'stop' && svc.State === 'Stopped') return ctx.out.dim(`${label} est deja arrete.`);
    if (action === 'start' && svc.StartMode === 'Disabled') {
      throw new Error(`${label} est desactive : service mode ${svc.Name} manuel, puis service start ${svc.Name}.`);
    }

    const script = actionScript(action, svc.Name, { force: ctx.flags.force, mode });
    if (ctx.flags.admin) {
      ctx.emit(ctx.out.dim('Windows demande l\'autorisation administrateur...'));
      await runElevated(script, { signal: ctx.signal });
    } else {
      const { stdout, stderr } = await run(attemptScript(script), { signal: ctx.signal, timeout: 90000 });
      const outcome = parseAttempt(stdout);
      if (outcome.status === 'denied') {
        throw new Error(`Windows exige les droits administrateur pour ${label} : relancez avec --admin (Windows demandera votre autorisation).`);
      }
      if (outcome.status === 'error') throw new Error(explainFailure(outcome.message));
      if (outcome.status !== 'ok') throw new Error(stderr.trim().split('\n')[0] || outcome.message || 'Echec de l\'action.');
    }

    const [after] = await loadServices(ctx, svc.Name);
    if (ctx.flags.admin && !reached(action, mode, after)) {
      throw new Error(`L'action n'a pas abouti, meme avec les droits administrateur. Etat actuel : ${after ? stateLabel(after) : 'inconnu'}.`);
    }

    const verbs = { start: 'demarre', stop: 'arrete', restart: 'redemarre', mode: 'regle' };
    const blocks = [
      ctx.out.success(`${label} ${verbs[action]}.`),
      ctx.out.kv([['Etat', after ? stateLabel(after) : '?'], ['Demarrage', after ? modeLabel(after) : '?']])
    ];
    if (NOTES[key] && (action === 'stop' || (action === 'mode' && mode === 'Disabled'))) blocks.push(ctx.out.warn(NOTES[key]));
    return blocks;
  }
};

module.exports = [service];
module.exports.internals = { actionScript, attemptScript, parseAttempt, resolveService, matching, reached, CRITICAL };
