'use strict';

/**
 * `peripheriques` : le materiel que Windows signale en erreur (pilote manquant,
 * desactive, en conflit...), avec le code du probleme explique en clair. Un
 * pilote defaillant est une cause classique de plantages et d'arrets
 * imprevus. Lecture seule, sans droits administrateur (Win32_PnPEntity).
 */

const { runJson, IS_WINDOWS } = require('../platform');
const { fold } = require('../text');

/** Codes de probleme du Gestionnaire de peripheriques (ConfigManagerErrorCode). */
const PROBLEMS = {
  1: 'mal configure',
  3: 'pilote endommage, ou memoire insuffisante',
  10: 'ne peut pas demarrer',
  12: 'conflit de ressources',
  14: 'redemarrage necessaire',
  18: 'pilotes a reinstaller',
  19: 'configuration du registre endommagee',
  21: 'en cours de suppression',
  22: 'desactive',
  24: 'absent, ou pilote manquant',
  28: 'pilote non installe',
  29: 'desactive par le micrologiciel (BIOS)',
  31: 'ne fonctionne pas correctement',
  32: 'pilote desactive',
  37: 'echec de l\'initialisation du pilote',
  38: 'ancien pilote encore en memoire',
  39: 'pilote manquant ou endommage',
  40: 'informations du pilote absentes du registre',
  41: 'pilote charge, materiel introuvable',
  43: 'arrete par Windows apres une erreur',
  45: 'non connecte',
  47: 'pret a etre retire',
  48: 'pilote bloque (incompatible)',
  49: 'registre du systeme trop volumineux',
  52: 'signature du pilote non verifiable'
};

/** Que faire, selon le code. */
const ADVICE = {
  14: 'redemarrez le PC',
  22: 'desactive volontairement ? Sinon, reactivez-le dans le Gestionnaire de peripheriques (devmgmt.msc)',
  28: 'installez son pilote : Windows Update, ou le site du fabricant',
  38: 'redemarrez le PC',
  43: 'debranchez-le puis rebranchez-le ; sinon mettez a jour son pilote',
  45: 'rebranchez-le, ou ignorez-le s\'il n\'est plus utilise'
};
const DEFAULT_ADVICE = 'mettez a jour ou reinstallez son pilote (Gestionnaire de peripheriques : devmgmt.msc)';

const describeProblem = (code) => PROBLEMS[code] || `probleme n°${code}`;
const adviceFor = (code) => ADVICE[code] || DEFAULT_ADVICE;

/** Script : le nombre de peripheriques presents, et ceux en erreur (ou tous). */
function devicesScript({ all = false } = {}) {
  return [
    '$list = @(Get-CimInstance Win32_PnPEntity)',
    `$shown = ${all ? '$list' : '@($list | Where-Object { $_.ConfigManagerErrorCode -ne 0 })'}`,
    '[pscustomobject]@{ total = $list.Count; devices = @($shown | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; class = [string]$_.PNPClass; code = [int]$_.ConfigManagerErrorCode; status = [string]$_.Status; maker = [string]$_.Manufacturer } }) }'
  ].join('\n');
}

const asList = (value) => (Array.isArray(value) ? value : (value == null ? [] : [value]));

const devices = {
  name: 'peripheriques',
  aliases: ['materiel', 'devices'],
  category: 'Systeme',
  summary: 'Materiel en erreur selon Windows : pilote manquant, desactive, en conflit...',
  usage: 'peripheriques | peripheriques --tous [filtre]',
  details: [
    '  peripheriques            le materiel que Windows signale en erreur',
    '  peripheriques --tous     tout le materiel present',
    '  peripheriques --tous usb seulement ce qui contient « usb »',
    '',
    'Chaque probleme est explique, avec ce qu\'il faut faire. Un pilote',
    'defaillant est une cause classique de plantages et d\'arrets imprevus.'
  ].join('\n'),
  examples: ['peripheriques', 'peripheriques --tous', 'peripheriques --tous audio'],
  flags: { tous: 'boolean', limit: 'number' },
  flagHelp: { tous: 'Lister tout le materiel present.', limit: 'Nombre de lignes avec --tous (defaut 100).' },
  short: { n: 'limit' },

  async run(ctx) {
    if (!IS_WINDOWS) throw new Error('La liste du materiel n\'est disponible que sous Windows.');
    const { out, flags } = ctx;
    const data = await runJson(devicesScript({ all: flags.tous }), { asArray: false, signal: ctx.signal, timeout: 60000 });
    const total = Number(data && data.total) || 0;
    let list = asList(data && data.devices);

    if (flags.tous) {
      const filter = ctx.args.join(' ').trim();
      if (filter) list = list.filter((d) => fold(`${d.name} ${d.class} ${d.maker}`).includes(fold(filter)));
      list.sort((a, b) => (a.class || '').localeCompare(b.class || '', 'fr') || (a.name || '').localeCompare(b.name || '', 'fr'));
      const limit = Math.max(1, flags.limit || 100);
      const shown = list.slice(0, limit);
      if (!shown.length) return out.warn(`Aucun peripherique ne contient « ${filter} ».`);
      return [
        out.table(
          [
            { key: 'nom', label: 'Nom' },
            { key: 'classe', label: 'Classe' },
            { key: 'etat', label: 'Etat', tone: true },
            { key: 'fabricant', label: 'Fabricant' }
          ],
          shown.map((d) => ({
            nom: d.name,
            classe: d.class || '-',
            etat: d.code ? describeProblem(d.code) : 'ok',
            fabricant: d.maker || '',
            _tone: d.code ? 'warn' : 'ok'
          }))
        ),
        out.dim(`${shown.length} sur ${list.length} peripherique(s)${filter ? ` contenant « ${filter} »` : ''}${list.length > shown.length ? ' - --limit pour plus' : ''}`)
      ];
    }

    if (!list.length) {
      return [
        out.success(`Aucun peripherique en erreur sur ${total}.`),
        out.dim('peripheriques --tous pour la liste complete du materiel.')
      ];
    }

    const codes = [...new Set(list.map((d) => d.code))];
    return [
      out.table(
        [
          { key: 'nom', label: 'Nom' },
          { key: 'classe', label: 'Classe' },
          { key: 'code', label: 'Code', align: 'right' },
          { key: 'probleme', label: 'Probleme', tone: true }
        ],
        list.map((d) => ({
          nom: d.name,
          classe: d.class || '-',
          code: String(d.code),
          probleme: describeProblem(d.code),
          // Desactive volontairement ou debranche : pas une panne.
          _tone: d.code === 22 || d.code === 45 ? 'dim' : 'warn'
        }))
      ),
      out.dim(`${list.length} en erreur sur ${total} peripheriques.`),
      out.list(codes.map((code) => `Code ${code} (${describeProblem(code)}) : ${adviceFor(code)}.`))
    ];
  }
};

module.exports = [devices];
module.exports.internals = { devicesScript, describeProblem, adviceFor, PROBLEMS };
