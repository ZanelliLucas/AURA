'use strict';

/**
 * `access` : ouvrir une donnee, quelle qu'elle soit.
 *
 * Ordre de resolution, du plus explicite au plus general :
 *   1. adresse web          https://...        -> navigateur
 *   2. chemin de serveur    /api/status        -> page du serveur courant
 *   3. serveur enregistre   chroma             -> on entre dans le serveur
 *   4. fichier ou dossier   rapport.pdf        -> application par defaut
 *
 * Un nom de serveur passe avant un fichier du meme nom : `access ./chroma`
 * force le fichier.
 */

const fs = require('fs');
const { normalize } = require('../text');
const { resolveServer, stateOf, baseUrl, keyOf } = require('./servers');
const { completePath } = require('./files');

const access = {
  name: 'access',
  aliases: ['acceder'],
  category: 'Acces',
  summary: 'Ouvre une donnee : page web, serveur, fichier ou dossier.',
  usage: 'access <donnee> | access /chemin | access --journal | access --sortir',
  details: [
    'Selon ce que vous donnez :',
    '  https://exemple.org     ouvre la page dans le navigateur',
    '  chroma                  entre dans le serveur « chroma »',
    '  /api/status             ouvre cette page du serveur ou vous etes',
    '  rapport.pdf             ouvre le fichier avec son application',
    '  3                       ouvre le 3e resultat de la derniere recherche',
    '',
    'Dans un serveur, l\'invite affiche son nom. `access` seul ouvre sa page',
    'd\'accueil, `access --journal` montre sa sortie, `access --sortir` en ressort',
    'sans l\'arreter.'
  ].join('\n'),
  examples: ['access https://example.org', 'access chroma', 'access /api/status', 'access ~/Documents/rapport.pdf'],
  flags: { journal: 'boolean', lignes: 'number', sortir: 'boolean' },
  flagHelp: {
    journal: 'Afficher la sortie du serveur (courant, ou nomme).',
    lignes: 'Lignes de journal affichees (defaut 40).',
    sortir: 'Sortir du serveur courant, sans l\'arreter.'
  },
  short: { n: 'lignes' },

  async complete(ctx) {
    const { partial, session } = ctx;
    const prefix = normalize(partial).replace(/ /g, '-');
    const servers = [...session.servers.keys()].filter((k) => k.startsWith(prefix));
    const files = await completePath(false)(ctx);
    return [...new Set([...servers, ...files])];
  },

  async run(ctx) {
    const { args, flags, session, out, terminal } = ctx;
    const text = args.join(' ').trim();
    const current = session.server;

    if (flags.sortir) {
      if (!current) throw new Error('Vous n\'etes dans aucun serveur.');
      session.server = null;
      return out.success(`Sorti de ${current.label}. Il continue de tourner.`);
    }

    if (flags.journal) {
      const key = text ? keyOf(text) : current && current.key;
      if (!key) throw new Error('Precisez le serveur : access <serveur> --journal');
      const logs = terminal.servers.logs(key);
      if (!logs) throw new Error(`« ${text || key} » n'a pas ete demarre depuis ce Terminal : sa sortie n'est pas disponible.`);
      const count = Math.max(1, flags.lignes || 40);
      return [
        out.title('Journal', key),
        out.code(logs.slice(-count).join('\n') || '(aucune sortie)')
      ];
    }

    if (!text) {
      if (current) {
        const def = await resolveServer(current.key, session);
        if (!def || !def.port) throw new Error(`${current.label} n'a pas de port declare : aucune page a ouvrir.`);
        const url = baseUrl(def);
        await terminal.open(url);
        return out.success(`Ouvert : ${url}`);
      }
      return [out.text('Que voulez-vous ouvrir ?'), out.code(access.details)];
    }

    // 1. Adresse web
    if (/^https?:\/\//i.test(text)) {
      await terminal.open(text);
      return out.success(`Ouvert : ${text}`);
    }

    // 2. Page du serveur courant
    if (current && text.startsWith('/')) {
      const def = await resolveServer(current.key, session);
      if (!def || !def.port) throw new Error(`${current.label} n'a pas de port declare : aucune page a ouvrir.`);
      const url = `${baseUrl(def)}${text}`;
      await terminal.open(url);
      return out.success(`Ouvert : ${url}`);
    }

    // 3. Serveur : on y entre
    const server = await resolveServer(text, session);
    if (server) {
      const state = await stateOf(server, terminal.servers);
      session.server = { key: server.key, label: server.label };
      const pairs = [['Etat', state.label]];
      if (server.port) pairs.push(['Adresse', baseUrl(server)]);
      if (state.pid) pairs.push(['PID', String(state.pid)]);
      pairs.push(['Dossier', server.cwd]);
      return [
        out.success(`Dans le serveur ${server.label}.`),
        out.kv(pairs),
        out.dim(state.running
          ? '`access /chemin` ouvre une page - `access --journal` montre sa sortie - `stop` l\'arrete - `access --sortir` en ressort.'
          : `Il est arrete : \`start ${server.key}\` pour le demarrer.`)
      ];
    }

    // 4. Fichier ou dossier, ou resultat numerote de la derniere recherche
    const full = session.resolveTarget(text);
    if (fs.existsSync(full)) {
      await terminal.open(full);
      return out.success(`Ouvert : ${full}`);
    }

    throw new Error(`Rien a ouvrir pour « ${text} » : ni page web, ni serveur, ni fichier.`);
  }
};

module.exports = [access];
