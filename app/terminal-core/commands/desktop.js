'use strict';

/**
 * `demarrage` : ce qui se lance a l'ouverture de session Windows.
 *
 *  - `demarrage` liste les programmes de demarrage, et l'etat du Terminal ;
 *  - `demarrage off|on <nom>` desactive ou retablit un programme, comme le
 *    Gestionnaire des taches : son inscription est gardee, seul son
 *    interrupteur (StartupApproved) change ;
 *  - `demarrage off|on` seul regle le Terminal lui-meme. Le moteur ne sait
 *    pas l'inscrire : l'hote (l'application Electron) fournit `startup` a
 *    createTerminal. La console n'en fournit pas.
 */

const { run, runJson, runElevated, psQuote, IS_WINDOWS } = require('../platform');
const { fold } = require('../text');

const ON = new Set(['on', 'oui', 'activer']);
const OFF = new Set(['off', 'non', 'couper', 'desactiver']);

const RUN = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APPROVED = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved';

/** Nom de la valeur Run du Terminal (identifiant de l'application). */
const SELF = 'org.les-z.terminal';

/** Emplacements lus par Windows a l'ouverture de session, et leur interrupteur. */
const SOURCES = [
  { id: 'hkcu-run', scope: 'vous', key: `HKCU:\\${RUN}`, approved: `HKCU:\\${APPROVED}\\Run`, admin: false },
  { id: 'hklm-run', scope: 'tous', key: `HKLM:\\${RUN}`, approved: `HKLM:\\${APPROVED}\\Run`, admin: true },
  { id: 'hklm-run32', scope: 'tous', key: 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', approved: `HKLM:\\${APPROVED}\\Run32`, admin: true },
  { id: 'user-folder', scope: 'vous', folder: 'Startup', approved: `HKCU:\\${APPROVED}\\StartupFolder`, admin: false },
  { id: 'common-folder', scope: 'tous', folder: 'CommonStartup', approved: `HKLM:\\${APPROVED}\\StartupFolder`, admin: true }
];

/** Script : toutes les entrees de demarrage, avec leur etat. */
function listScript() {
  const lines = [
    '$items = New-Object System.Collections.ArrayList',
    // Octet 0 pair (02, 06) : actif ; impair (03, 07) : desactive. Absent : actif.
    'function Approved($path, $name) { $k = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue; if (-not $k) { return $true }; $v = $k.GetValue($name); if ($v -is [byte[]] -and $v.Length -gt 0) { return (($v[0] -band 1) -eq 0) }; return $true }'
  ];
  for (const s of SOURCES) {
    const add = (name, command) => `[void]$items.Add([pscustomobject]@{ source = ${psQuote(s.id)}; name = ${name}; command = [string]${command}; enabled = (Approved ${psQuote(s.approved)} ${name}) })`;
    if (s.key) {
      lines.push(
        `$k = Get-Item -LiteralPath ${psQuote(s.key)} -ErrorAction SilentlyContinue`,
        `if ($k) { foreach ($n in $k.GetValueNames()) { if (-not $n) { continue }; $c = $k.GetValue($n); ${add('$n', '$c')} } }`
      );
    } else {
      lines.push(
        `$d = [Environment]::GetFolderPath(${psQuote(s.folder)})`,
        `if ($d -and (Test-Path -LiteralPath $d)) { foreach ($f in Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue) { if ($f.Name -eq 'desktop.ini') { continue }; $c = $f.FullName; if ($f.Extension -eq '.lnk') { try { $c = (New-Object -ComObject WScript.Shell).CreateShortcut($f.FullName).TargetPath } catch {} }; $n = $f.Name; ${add('$n', '$c')} } }`
      );
    }
  }
  lines.push('@($items)');
  return lines.join('\n');
}

/**
 * Script : desactive ou retablit une entree. Memes octets que le
 * Gestionnaire des taches : 02 = actif, 03 = desactive, suivis de la date de
 * desactivation (FILETIME, 8 octets).
 */
function approvalScript(source, name, enabled) {
  const bytes = enabled
    ? '[byte[]](2,0,0,0,0,0,0,0,0,0,0,0)'
    : '[byte[]](@(3,0,0,0) + [BitConverter]::GetBytes([DateTime]::Now.ToFileTime()))';
  return [
    `if (-not (Test-Path -LiteralPath ${psQuote(source.approved)})) { New-Item -Path ${psQuote(source.approved)} -Force | Out-Null }`,
    // Entre parentheses : en argument, `[byte[]](...)` nu n'est pas lu comme une valeur.
    `Set-ItemProperty -LiteralPath ${psQuote(source.approved)} -Name ${psQuote(name)} -Value (${bytes}) -Type Binary -ErrorAction Stop`
  ].join('\n');
}

async function loadEntries(ctx) {
  return runJson(listScript(), { signal: ctx.signal, timeout: 30000 });
}

const stripLnk = (name) => String(name).replace(/\.lnk$/i, '');
const displayName = (entry) => (entry.name === SELF ? 'TERMINAL (ce Terminal)' : stripLnk(entry.name));
const isSelf = (query) => fold(query) === 'terminal' || String(query).toLowerCase() === SELF;

const scopeOf = (entry) => {
  const source = SOURCES.find((s) => s.id === entry.source);
  return source ? source.scope : 'vous';
};
const scopeLabel = (entry) => (scopeOf(entry) === 'tous' ? 'tous les utilisateurs' : 'vous');

/**
 * L'entree designee : nom exact, sinon unique nom qui contient la recherche.
 * Un meme programme peut etre inscrit deux fois (pour vous, et pour tous les
 * utilisateurs) : `allUsers` (--admin) choisit la seconde, sinon la premiere.
 */
function findEntry(items, query, { allUsers = false } = {}) {
  const q = fold(query);
  const pick = (list) => {
    if (list.length <= 1) return list[0] || null;
    const scoped = list.filter((i) => scopeOf(i) === (allUsers ? 'tous' : 'vous'));
    return scoped.length === 1 ? scoped[0] : null;
  };
  const exact = items.filter((i) => fold(i.name) === q || fold(displayName(i)) === q);
  const near = exact.length ? exact : items.filter((i) => fold(displayName(i)).includes(q));
  if (!near.length) throw new Error(`Programme de demarrage introuvable : ${query}. \`demarrage\` les liste.`);
  const found = pick(near);
  if (found) return found;
  throw new Error(`Plusieurs programmes correspondent a « ${query} » : ${near.map((i) => `${displayName(i)} (${scopeLabel(i)})`).join(', ')}. Precisez le nom.`);
}

async function hostState(ctx) {
  const host = ctx.terminal.startup;
  if (!host) return [ctx.out.dim('Le demarrage du Terminal lui-meme se regle depuis l\'application.')];
  const state = await host.get();
  const blocks = [ctx.out.kv([
    ['Demarrage avec Windows', state.enabled ? 'active' : 'coupe'],
    ['Raccourci global', state.shortcutActive
      ? `${state.shortcut} - fait apparaitre ou cache le Terminal`
      : `${state.shortcut} indisponible : deja pris par une autre application`]
  ])];
  if (state.enabled && state.blocked) {
    blocks.push(ctx.out.warn('Windows l\'a desactive dans le Gestionnaire des taches (onglet Applications de demarrage) : reactivez-le la-bas.'));
  }
  return blocks;
}

async function listing(ctx, filter) {
  const blocks = [];
  if (IS_WINDOWS) {
    let items = await loadEntries(ctx);
    if (filter) items = items.filter((i) => fold(displayName(i)).includes(fold(filter)));
    if (items.length) {
      const active = items.filter((i) => i.enabled).length;
      blocks.push(
        ctx.out.title('Programmes de demarrage', `${active} actif(s) sur ${items.length}`),
        ctx.out.table(
          [
            { key: 'nom', label: 'Nom' },
            { key: 'etat', label: 'Etat' },
            { key: 'pour', label: 'Pour' },
            { key: 'commande', label: 'Commande' }
          ],
          items.map((i) => {
            const command = String(i.command || '');
            return {
              nom: displayName(i),
              etat: i.enabled ? 'actif' : 'desactive',
              pour: scopeLabel(i),
              commande: command.length > 90 ? `${command.slice(0, 87)}...` : command
            };
          })
        ),
        ctx.out.dim('demarrage off <nom> le desactive, demarrage on <nom> le retablit - --admin pour ceux de tous les utilisateurs.'),
        ctx.out.dim('Les services et taches planifiees lances au demarrage n\'y figurent pas : voir service --actifs.')
      );
    } else {
      blocks.push(ctx.out.dim(filter ? `Aucun programme de demarrage ne contient « ${filter} ».` : 'Aucun programme de demarrage.'));
    }
  }
  blocks.push(ctx.out.title('Ce Terminal'), ...(await hostState(ctx)));
  return blocks;
}

async function toggleSelf(ctx, enabled) {
  const host = ctx.terminal.startup;
  if (!host) throw new Error('Le demarrage du Terminal avec Windows se regle depuis l\'application, pas depuis la console.');
  await host.set(enabled);
  return [
    ctx.out.success(enabled
      ? 'Le Terminal se lancera avec Windows, cache pres de l\'horloge.'
      : 'Le Terminal ne se lancera plus avec Windows.'),
    ...(await hostState(ctx))
  ];
}

async function toggleProgram(ctx, query, enabled) {
  if (!IS_WINDOWS) throw new Error('Les programmes de demarrage ne se reglent que sous Windows.');
  const entry = findEntry(await loadEntries(ctx), query, { allUsers: Boolean(ctx.flags.admin) });
  if (entry.name === SELF) return toggleSelf(ctx, enabled);
  const name = displayName(entry);
  if (entry.enabled === enabled) return ctx.out.dim(`${name} est deja ${enabled ? 'actif' : 'desactive'}.`);

  const source = SOURCES.find((s) => s.id === entry.source);
  const script = approvalScript(source, entry.name, enabled);
  if (source.admin) {
    if (!ctx.flags.admin) {
      throw new Error(`${name} est inscrit pour tous les utilisateurs : Windows exige les droits administrateur. Relancez avec --admin (Windows demandera votre autorisation).`);
    }
    ctx.emit(ctx.out.dim('Windows demande l\'autorisation administrateur...'));
    const code = await runElevated(script, { signal: ctx.signal });
    if (code !== 0) throw new Error(`Le reglage a echoue, meme avec les droits administrateur (code ${code}).`);
  } else {
    const { code, stderr } = await run(script, { signal: ctx.signal });
    if (code !== 0) throw new Error(stderr.trim().split('\n')[0] || 'Le reglage a echoue.');
  }

  const after = (await loadEntries(ctx)).find((i) => i.source === entry.source && i.name === entry.name);
  if (!after || after.enabled !== enabled) throw new Error(`Le reglage de ${name} n'a pas pris.`);
  return [
    ctx.out.success(`${name} ${enabled ? 'se lancera' : 'ne se lancera plus'} a l'ouverture de session.`),
    ctx.out.dim(enabled
      ? 'Effet a la prochaine ouverture de session.'
      : `Comme dans le Gestionnaire des taches : l'inscription est gardee, demarrage on ${name} la retablit.`)
  ];
}

const startup = {
  name: 'demarrage',
  aliases: ['startup'],
  category: 'Systeme',
  summary: 'Programmes lances a l\'ouverture de session Windows, et celui du Terminal.',
  usage: 'demarrage [filtre] | demarrage off|on <nom> [--admin] | demarrage off|on',
  details: [
    '  demarrage              les programmes de demarrage, et l\'etat du Terminal',
    '  demarrage off onedrive ne plus lancer OneDrive a l\'ouverture de session',
    '  demarrage on onedrive  le retablir',
    '  demarrage off          ne plus lancer le Terminal avec Windows',
    '  demarrage on           le lancer de nouveau',
    '',
    'Comme le Gestionnaire des taches, desactiver garde l\'inscription du',
    'programme : seul son interrupteur change, et on le retablit a volonte.',
    'Les programmes inscrits pour tous les utilisateurs exigent --admin. Un',
    'programme inscrit deux fois (pour vous, et pour tous) : sans --admin, le',
    'Terminal vise votre inscription ; avec, celle de tous les utilisateurs.',
    '',
    'Lance avec Windows, le Terminal attend cache pres de l\'horloge, et son',
    'raccourci global le fait apparaitre aussitot.'
  ].join('\n'),
  examples: ['demarrage', 'demarrage off onedrive', 'demarrage on onedrive', 'demarrage off'],
  flags: { admin: 'boolean' },
  flagHelp: { admin: 'Regler un programme de tous les utilisateurs (Windows demande l\'autorisation).' },
  complete: ({ tokens, partial }) => (tokens.length <= 1 ? ['on', 'off'].filter((v) => v.startsWith(partial || '')) : []),

  async run(ctx) {
    // Accents et casse ignores : « désactiver » vaut « desactiver ».
    const choice = fold(ctx.args[0] || '');
    if (!ON.has(choice) && !OFF.has(choice)) return listing(ctx, ctx.args.join(' ').trim());

    const enabled = ON.has(choice);
    const target = ctx.args.slice(1).join(' ').trim();
    if (!target || isSelf(target)) return toggleSelf(ctx, enabled);
    return toggleProgram(ctx, target, enabled);
  }
};

module.exports = [startup];
module.exports.internals = { SOURCES, listScript, approvalScript, findEntry, displayName, SELF };
