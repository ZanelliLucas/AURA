'use strict';

/**
 * `boitenoire` : ce que faisait le PC juste avant un arret imprevu, d'apres
 * les releves que l'application enregistre toutes les 30 secondes
 * (core/blackbox.js). L'hote (Electron) fournit `blackbox` a createTerminal ;
 * la console n'enregistre rien.
 */

const { runJson, formatDate, IS_WINDOWS } = require('../platform');
const { readRecords, samplesOf, incidents, verdict } = require('../blackbox');
const journal = require('./journal').internals;
const { fold } = require('../text');

const clock = (t) => new Date(t).toLocaleTimeString('fr-FR');

/** Un releve, en ligne de tableau. */
function sampleRow(s) {
  const busiest = (s.top || []).filter((p) => p.c != null).sort((a, b) => b.c - a.c)[0];
  const hungriest = (s.top || []).slice().sort((a, b) => b.m - a.m)[0];
  const heavy = (s.cpu || 0) >= 90 || (s.mem || 0) >= 90;
  return {
    heure: clock(s.t),
    cpu: s.cpu == null ? '-' : `${s.cpu} %`,
    mem: s.mem == null ? '-' : `${s.mem} %`,
    disque: s.disk == null ? '-' : `${s.disk} % libre`,
    actif: busiest ? `${busiest.n} (${busiest.c} %)` : '-',
    gourmand: hungriest ? `${hungriest.n} (${hungriest.m >= 1024 ? `${(hungriest.m / 1024).toFixed(1).replace('.', ',')} Go` : `${hungriest.m} Mo`})` : '-',
    _tone: heavy ? 'warn' : 'ok'
  };
}

function samplesTable(out, samples) {
  return out.table(
    [
      { key: 'heure', label: 'Heure', tone: true },
      { key: 'cpu', label: 'CPU', align: 'right' },
      { key: 'mem', label: 'Memoire', align: 'right' },
      { key: 'disque', label: 'Disque', align: 'right' },
      { key: 'actif', label: 'Plus actif' },
      { key: 'gourmand', label: 'Plus gourmand' }
    ],
    samples.map(sampleRow)
  );
}

/** Instants des arrets imprevus depuis `since` (ms), d'apres le journal. */
async function shutdownTimes(ctx, since) {
  if (!IS_WINDOWS) return [];
  const minutes = Math.max(1, Math.ceil((Date.now() - since) / 60000));
  const events = await runJson(journal.eventsScript(journal.PRESETS.arrets, minutes), { signal: ctx.signal, timeout: 60000 });
  return events.map((e) => new Date(e.time).getTime());
}

const blackbox = {
  name: 'boitenoire',
  aliases: ['blackbox'],
  category: 'Systeme',
  summary: 'Ce que faisait le PC juste avant un arret imprevu : releves toutes les 30 s.',
  usage: 'boitenoire | boitenoire --depuis 15m | boitenoire on|off | boitenoire effacer',
  details: [
    'L\'application releve toutes les 30 secondes la charge du processeur, la',
    'memoire, l\'espace disque et les programmes les plus actifs, et garde 7 jours.',
    '',
    '  boitenoire              pour chaque arret imprevu : le dernier signe de vie,',
    '                          les 10 minutes precedentes et ce qu\'elles disent',
    '  boitenoire --depuis 15m les releves recents',
    '  boitenoire off | on     couper ou relancer l\'enregistrement',
    '  boitenoire effacer      supprimer les releves (confirmation)',
    '',
    'Les releves restent sur ce PC. Ils ne sont pris que quand le Terminal tourne',
    '(il se lance avec Windows, cache pres de l\'horloge).'
  ].join('\n'),
  examples: ['boitenoire', 'boitenoire --depuis 10m', 'boitenoire off'],
  flags: { depuis: 'string' },
  flagHelp: { depuis: 'Afficher les releves de cette periode : 10m, 1h...' },
  short: { d: 'depuis' },
  confirmWhen: ['effacer'],

  async run(ctx) {
    const { out, flags } = ctx;
    const host = ctx.terminal.blackbox;
    if (!host) throw new Error('La boite noire enregistre depuis l\'application, pas depuis la console.');
    const word = fold(ctx.args[0] || '');

    if (word === 'on' || word === 'off') {
      await host.set(word === 'on');
      return out.success(word === 'on' ? 'Boite noire relancee : un releve toutes les 30 s.' : 'Boite noire coupee : plus aucun releve.');
    }
    if (word === 'effacer') {
      await host.clear();
      return out.success('Releves de la boite noire supprimes.');
    }
    if (word) throw new Error(`Usage : ${blackbox.usage}`);

    const state = host.get();
    const records = readRecords(state.file);
    const samples = samplesOf(records);
    const blocks = [];

    const status = !state.enabled
      ? 'coupee - boitenoire on pour la relancer'
      : state.recording ? `active, un releve toutes les ${Math.round(state.intervalMs / 1000)} s` : 'prevue, mais pas en cours (version de developpement ?)';
    blocks.push(out.title('Boite noire', status));
    if (!samples.length) {
      blocks.push(out.dim('Aucun releve pour l\'instant : le premier arrive 30 s apres le lancement du Terminal.'));
      return blocks;
    }
    blocks.push(out.dim(`${samples.length} releves, du ${formatDate(new Date(samples[0].t))} au ${formatDate(new Date(samples[samples.length - 1].t))}.`));

    if (flags.depuis) {
      const since = Date.now() - journal.parsePeriod(flags.depuis) * 60000;
      const recent = samples.filter((s) => s.t >= since).slice(-60);
      if (!recent.length) blocks.push(out.dim('Aucun releve sur cette periode.'));
      else blocks.push(samplesTable(out, recent));
      return blocks;
    }

    const found = incidents(records, await shutdownTimes(ctx, records[0].t));
    if (!found.length) {
      blocks.push(out.success('Aucun arret imprevu depuis le debut de l\'enregistrement : la boite noire servira au prochain.'));
      blocks.push(out.title('Derniers releves'), samplesTable(out, samples.slice(-5)));
      blocks.push(out.dim('boitenoire --depuis 15m pour davantage.'));
      return blocks;
    }

    for (const incident of found.slice(0, 5)) {
      const note = incident.last ? `dernier signe de vie a ${clock(incident.last.t)}` : 'aucun releve avant';
      blocks.push(out.title(`Arret imprevu du ${formatDate(new Date(incident.at))}`, note));
      if (incident.window.length) blocks.push(samplesTable(out, incident.window));
      blocks.push(out.accent(verdict(incident)));
    }
    if (found.length > 5) blocks.push(out.dim(`${found.length - 5} arret(s) plus ancien(s) non affiche(s).`));
    blocks.push(out.dim('Les causes enregistrees par Windows : alimentation. Le journal autour de ces heures : journal --depuis 7j.'));
    return blocks;
  }
};

module.exports = [blackbox];
module.exports.internals = { sampleRow };
