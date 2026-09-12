'use strict';

/**
 * `essai` : controles guides, sans risque, de ce qui ne peut pas se verifier
 * automatiquement - une notification qui arrive vraiment, des touches vraiment
 * recues, une autorisation administrateur vraiment obtenue.
 *
 * Notifications et raccourcis passent par l'hote (l'application Electron) :
 * `selftest` = { info(), notification(signal), waitKey(nom, ms, signal) }.
 * L'essai administrateur, lui, marche aussi depuis la console.
 */

const { runElevated, IS_WINDOWS } = require('../platform');
const { fold } = require('../text');

const WAIT_MS = 20000;

/** Ne modifie rien : sort en code 2 si le processus eleve n'a pas les droits. */
const ADMIN_SCRIPT = [
  '$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())',
  'if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 2 }'
].join('\n');

const TESTS = {
  notification: 'une notification Windows de test, a cliquer (30 s)',
  raccourcis: 'Ctrl+R et Ctrl+Alt+T, a presser (20 s chacun)',
  admin: 'l\'autorisation administrateur, pour une verification qui ne modifie rien'
};

const abortError = () => Object.assign(new Error('Essai interrompu.'), { name: 'AbortError' });

function requireHost(ctx, what) {
  const host = ctx.terminal.selftest;
  if (!host) throw new Error(`${what} se teste depuis l'application, pas depuis la console.`);
  return host;
}

async function testNotification(ctx) {
  const { out } = ctx;
  const host = requireHost(ctx, 'La notification');
  ctx.emit(out.accent('Notification'));
  ctx.emit(out.dim('Une notification de test part : cliquez dessus dans les 30 secondes.'));
  const result = await host.notification(ctx.signal);
  if (ctx.signal && ctx.signal.aborted) throw abortError();
  if (!result.supported) return [out.error('Windows ne prend pas en charge les notifications pour cette application.')];
  if (result.error) return [out.error(`Windows a refuse la notification : ${result.error}.`)];
  if (result.clicked) return [out.success('Notification recue et cliquee : les alertes (serveur arrete, sante du PC) vous parviendront.')];
  return [
    out.warn(result.shown ? 'Windows dit l\'avoir affichee, mais elle n\'a pas ete cliquee a temps.' : 'Aucune notification affichee.'),
    out.dim('Si vous ne l\'avez pas vue : Parametres > Systeme > Notifications - verifiez que TERMINAL est autorise et que « Ne pas deranger » est coupe.')
  ];
}

async function testKeys(ctx) {
  const { out } = ctx;
  const host = requireHost(ctx, 'Les raccourcis');
  const info = host.info();
  const blocks = [];
  ctx.emit(out.accent('Raccourcis'));
  ctx.emit(info.menuFree
    ? out.success('Aucun menu d\'application : Ctrl+R ne peut plus recharger la page.')
    : out.error('Un menu d\'application est actif : Ctrl+R pourrait recharger la page au lieu de chercher.'));

  ctx.emit(out.text('Pressez Ctrl+R dans cette fenetre (20 s)...'));
  const ctrlR = await host.waitKey('ctrl+r', WAIT_MS, ctx.signal);
  if (ctx.signal && ctx.signal.aborted) throw abortError();
  ctx.emit(ctrlR
    ? out.success('Ctrl+R recu par la fenetre : la recherche dans l\'historique fonctionne.')
    : out.warn('Ctrl+R non recu en 20 s.'));

  if (!info.shortcutActive) {
    blocks.push(out.warn(`${info.shortcut} n'est pas actif : une autre application l'a pris au lancement du Terminal.`));
  } else {
    ctx.emit(out.text(`Pressez ${info.shortcut} (20 s) - pendant l'essai, la fenetre ne se cachera pas...`));
    const global = await host.waitKey('ctrl+alt+t', WAIT_MS, ctx.signal);
    if (ctx.signal && ctx.signal.aborted) throw abortError();
    blocks.push(global
      ? out.success(`${info.shortcut} recu : le raccourci global fonctionne, meme Terminal cache.`)
      : out.warn(`${info.shortcut} non recu en 20 s.`));
  }
  return blocks;
}

async function testAdmin(ctx) {
  const { out } = ctx;
  if (!IS_WINDOWS) throw new Error('L\'autorisation administrateur ne se teste que sous Windows.');
  ctx.emit(out.accent('Droits administrateur'));
  ctx.emit(out.dim('Windows va demander l\'autorisation. L\'essai ne modifie rien : il verifie seulement que les droits sont obtenus.'));
  let code;
  try {
    code = await runElevated(ADMIN_SCRIPT, { signal: ctx.signal, timeout: 120000 });
  } catch (err) {
    if (ctx.signal && ctx.signal.aborted) throw abortError();
    return [out.warn(err.message), out.dim('Les actions --admin (service, demarrage, nettoyer) demanderont la meme autorisation.')];
  }
  if (code === 0) return [out.success('Droits administrateur obtenus : les actions --admin fonctionneront.')];
  return [out.error(`Le processus eleve n'a pas obtenu les droits (code ${code}).`)];
}

const RUNNERS = { notification: testNotification, raccourcis: testKeys, admin: testAdmin };

const selftest = {
  name: 'essai',
  aliases: ['selftest'],
  category: 'Terminal',
  summary: 'Controles guides : notification, raccourcis, droits administrateur.',
  usage: 'essai [notification|raccourcis|admin|tout]',
  details: [
    'Ce qui ne se verifie pas automatiquement, verifie avec vous :',
    ...Object.entries(TESTS).map(([name, text]) => `  essai ${name.padEnd(13)} ${text}`),
    '  essai tout          les trois a la suite',
    '',
    'Aucun essai ne modifie le PC.'
  ].join('\n'),
  examples: ['essai', 'essai notification', 'essai tout'],
  complete: ({ tokens, partial }) => (tokens.length <= 1 ? [...Object.keys(TESTS), 'tout'].filter((v) => v.startsWith(partial || '')) : []),

  async run(ctx) {
    const { out } = ctx;
    const which = fold(ctx.args[0] || '');
    if (!which) {
      return [
        out.title('Essais guides'),
        out.kv(Object.entries(TESTS).map(([name, text]) => [`essai ${name}`, text])),
        out.dim('essai tout pour les trois a la suite. Aucun ne modifie le PC.')
      ];
    }
    const names = which === 'tout' ? Object.keys(TESTS) : [which];
    const unknown = names.filter((name) => !RUNNERS[name]);
    if (unknown.length) throw new Error(`Essai inconnu : ${unknown.join(', ')}. Possibles : ${Object.keys(TESTS).join(', ')}, tout.`);

    const blocks = [];
    for (const name of names) {
      const result = await RUNNERS[name](ctx);
      // Les blocs d'un essai s'affichent avant que le suivant ne commence.
      if (names.length > 1) result.forEach((block) => ctx.emit(block));
      else blocks.push(...result);
    }
    return blocks;
  }
};

module.exports = [selftest];
module.exports.internals = { ADMIN_SCRIPT, TESTS };
