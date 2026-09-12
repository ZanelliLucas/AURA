'use strict';

/**
 * `watch` : relance une commande a intervalle regulier, jusqu'a Echap.
 * Chaque image commence par un bloc de controle `frame`, qui remplace la
 * precedente a l'ecran ; le moteur n'en garde que la derniere.
 */

const { unquoteWhole } = require('../chain');

/** Commandes qui n'ont pas de sens en boucle. */
const FORBIDDEN = new Set(['watch', 'exit', 'clear']);

/** `watch --toutes 5 ps node` : les options de watch se placent avant la commande. */
function splitWatchFlags(raw) {
  let rest = String(raw || '').trim();
  let every = 2;
  for (;;) {
    const match = /^(?:--toutes|-n)(?:\s+|=)(\S+)\s*/.exec(rest);
    if (!match) break;
    every = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(every)) throw new Error(`--toutes attend un nombre de secondes (recu : ${match[1]}).`);
    rest = rest.slice(match[0].length);
  }
  return { every: Math.min(3600, Math.max(1, every)), line: rest.trim() };
}

/** Attente interrompue net par Echap. */
function pause(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

const clock = () => new Date().toLocaleTimeString('fr-FR');

const watch = {
  name: 'watch',
  aliases: ['surveiller'],
  category: 'Terminal',
  summary: 'Relance une commande a intervalle regulier ; l\'affichage se met a jour sur place.',
  usage: 'watch [--toutes 2] <commande...>',
  details: [
    'La commande est relancee toutes les 2 secondes (--toutes pour changer),',
    'et son resultat remplace le precedent, jusqu\'a Echap.',
    '',
    'Les commandes qui demandent une confirmation (rm, kill, run, service stop...)',
    'ne sont pas relancees en boucle. Les options de watch se placent avant la',
    'commande : tout le reste lui appartient.',
    '',
    'Un enchainement se met entre guillemets : watch "ps | sort cpu -r | head 5"'
  ].join('\n'),
  examples: ['watch ports 3000', 'watch --toutes 5 ps node', 'watch disk', 'watch "ps | sort cpu -r | head 5"'],
  // Le reste de la ligne appartient a la commande relancee.
  passthrough: true,
  flags: { toutes: 'number' },
  flagHelp: { toutes: 'Intervalle en secondes (defaut 2, de 1 a 3600).' },
  short: { n: 'toutes' },

  async run(ctx) {
    const { terminal, out, signal } = ctx;
    if (!signal) throw new Error('watch doit pouvoir etre interrompu : lancez-le depuis le Terminal.');

    const { every, line: typed } = splitWatchFlags(ctx.raw);
    // `watch "ps | grep node"` : un enchainement se confie entre guillemets.
    const line = unquoteWhole(typed);
    if (!line) throw new Error('Indiquez la commande a relancer. Exemple : watch ports 3000');

    const tab = { tab: ctx.tab };
    const stages = terminal.stagesOf(line, 0, ctx.session);
    for (const stage of stages) {
      if (!stage.command) throw new Error(`Commande inconnue : ${stage.name}`);
      if (FORBIDDEN.has(stage.command.name)) throw new Error(`watch ne relance pas ${stage.command.name}.`);
    }
    if (terminal.requiresConfirmation(line, tab)) {
      // La commande en cause, ou a defaut la redirection qui remplace un fichier.
      const sensitive = stages.find((stage) => terminal.requiresConfirmation(stage.text, tab));
      const what = sensitive ? sensitive.command.name : 'ecriture dans un fichier existant';
      throw new Error(`watch ne relance pas une commande sensible (${what}) : elle demande une confirmation a chaque fois.`);
    }

    let rounds = 0;
    while (!signal.aborted) {
      const started = Date.now();
      const frame = [];
      const result = await terminal.execute(line, { record: false, signal, tab: ctx.tab, onBlock: (block) => frame.push(block) });
      if (signal.aborted) break; // image inachevee : on garde la precedente

      rounds += 1;
      ctx.emit(out.control('frame'));
      ctx.emit(out.dim(`watch - ${line} - toutes les ${every} s - ${clock()} - tour ${rounds}${result.ok ? '' : ' - en erreur'} - Echap pour arreter`));
      for (const block of frame) {
        // Les ordres de la commande (effacer, progression...) n'ont pas de sens ici.
        if (block.type !== 'control') ctx.emit(block);
      }
      await pause(Math.max(0, every * 1000 - (Date.now() - started)), signal);
    }
    return out.dim(`Surveillance arretee apres ${rounds} tour${rounds > 1 ? 's' : ''}.`);
  }
};

module.exports = [watch];
module.exports.splitWatchFlags = splitWatchFlags;
