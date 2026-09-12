'use strict';

/**
 * Commandes de serveurs : start, stop.
 *
 * Un serveur est enregistre une fois (nom, commande, dossier, port) puis
 * pilote par son nom.
 */

const fs = require('fs');
const path = require('path');
const { isListening, portOwner, killTree } = require('../servers');
const { normalize } = require('../text');
const { findProtected } = require('../protect');

const CATEGORY = 'Serveurs';

/** Cle stable d'un nom : « Mon Serveur » devient « mon-serveur ». */
const keyOf = (name) => normalize(name).replace(/ /g, '-');

// ---------------------------------------------------------------------------
// Resolution et etat
// ---------------------------------------------------------------------------

/** Definition d'un serveur enregistre, par son nom. */
async function resolveServer(name, session) {
  const key = keyOf(name);
  if (!key || !session.servers.has(key)) return null;
  return { key, ...session.servers.get(key) };
}

async function knownServers(session) {
  const list = [];
  for (const key of session.servers.keys()) list.push(await resolveServer(key, session));
  return list;
}

/** Etat observe : demarre ici, lance ailleurs, plante ou arrete. */
async function stateOf(def, manager) {
  const entry = manager.get(def.key);
  if (entry && entry.exitCode === null) {
    const listening = def.port ? await isListening(def.port) : false;
    return { label: listening ? 'en ecoute' : 'demarre', pid: entry.pid, running: true, ours: true };
  }
  if (def.port && await isListening(def.port)) return { label: 'externe', pid: null, running: true, ours: false };
  if (entry && !entry.stopped && entry.exitCode !== 0) {
    return { label: `plante (code ${entry.exitCode})`, pid: null, running: false, ours: false };
  }
  return { label: 'arrete', pid: null, running: false, ours: false };
}

/** `localhost` plutot que 127.0.0.1 : le navigateur essaie aussi l'IPv6. */
const baseUrl = (def) => `http://localhost:${def.port}`;

function leaveIfCurrent(session, key) {
  if (session.server && session.server.key === key) session.server = null;
}

function completeServers({ partial, session }) {
  const prefix = keyOf(partial);
  return [...session.servers.keys()].filter((k) => k.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

const start = {
  name: 'start',
  aliases: ['demarrer'],
  category: CATEGORY,
  summary: 'Demarre un serveur enregistre.',
  usage: 'start <serveur> | start --ajouter <nom> [--commande "..."] [--dossier <chemin>] [--port <n>] | start --retirer <nom>',
  details: [
    'Sans argument, liste les serveurs connus et leur etat.',
    '',
    'Enregistrer un serveur : start --ajouter <nom> --dossier <chemin> --port <n>',
    'Sans --commande, le script « start » du package.json est utilise (npm start).',
    'Le port permet au Terminal de savoir quand le serveur est pret, et',
    'd\'ouvrir ses pages avec `access`.',
    '',
    'Les serveurs demarres ici sont arretes par `exit` et a la fermeture.'
  ].join('\n'),
  examples: [
    'start',
    'start --ajouter chroma --dossier ~/Downloads/Projet/CHROMA --port 3000',
    'start chroma'
  ],
  flags: { ajouter: 'boolean', retirer: 'boolean', commande: 'string', dossier: 'string', port: 'number', delai: 'number' },
  flagHelp: {
    ajouter: 'Enregistrer un serveur sous le nom donne.',
    retirer: 'Oublier un serveur enregistre.',
    commande: 'Commande de demarrage (defaut : npm start).',
    dossier: 'Dossier du serveur (defaut : dossier courant).',
    port: 'Port d\'ecoute, pour savoir quand il est pret.',
    delai: 'Attente maximale du port, en secondes (defaut 20).'
  },
  complete: completeServers,

  async run(ctx) {
    const { args, flags, session, out, emit } = ctx;
    const manager = ctx.terminal.servers;
    const name = args.join(' ').trim();

    if (flags.ajouter) {
      if (!name) throw new Error('Usage : start --ajouter <nom> [--commande "..."] [--dossier <chemin>] [--port <n>]');
      const key = keyOf(name);
      if (!key) throw new Error('Nom de serveur invalide.');

      const dir = session.resolve(flags.dossier || '.');
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`Dossier introuvable : ${dir}`);

      let command = flags.commande;
      if (!command) {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
          if (pkg.scripts && pkg.scripts.start) command = 'npm start';
        } catch {
          // pas de package.json lisible
        }
        if (!command) {
          throw new Error(`Aucun script « start » dans ${dir}. Indiquez la commande : --commande "node server.js"`);
        }
      }

      const port = flags.port == null ? null : flags.port;
      if (port !== null && !(Number.isInteger(port) && port > 0 && port < 65536)) {
        throw new Error(`Port invalide : ${flags.port}`);
      }

      session.setServer(key, { label: name, command, cwd: dir, port });
      return [
        out.success(`Serveur enregistre : ${name}`),
        out.kv([['Commande', command], ['Dossier', dir], ['Port', port ? String(port) : '(non declare)']]),
        out.dim(`\`start ${key}\` pour le demarrer.`)
      ];
    }

    if (flags.retirer) {
      if (!name) throw new Error('Usage : start --retirer <nom>');
      const key = keyOf(name);
      if (manager.isRunning(key)) throw new Error(`${name} tourne encore : \`stop ${key}\` d'abord.`);
      if (!session.removeServer(key)) throw new Error(`Aucun serveur enregistre sous « ${name} ».`);
      return out.success(`Serveur retire : ${name}`);
    }

    if (!name) {
      const defs = await knownServers(session);
      if (!defs.length) {
        return out.dim('Aucun serveur connu. `start --ajouter <nom> --dossier <chemin> --port <n>` pour en enregistrer un.');
      }
      const rows = [];
      for (const def of defs) {
        const state = await stateOf(def, manager);
        rows.push({
          serveur: def.label,
          etat: state.label,
          port: def.port ? String(def.port) : '-',
          pid: state.pid ? String(state.pid) : '-',
          dossier: def.cwd,
          _full: def.cwd
        });
      }
      return [
        out.table([
          { key: 'serveur', label: 'Serveur' },
          { key: 'etat', label: 'Etat' },
          { key: 'port', label: 'Port', align: 'right' },
          { key: 'pid', label: 'PID', align: 'right' },
          { key: 'dossier', label: 'Dossier', kind: 'path' }
        ], rows),
        out.dim('`start <serveur>` pour demarrer - `access <serveur>` pour y entrer - `stop <serveur>` pour arreter.')
      ];
    }

    const def = await resolveServer(name, session);
    if (!def) throw new Error(`Serveur inconnu : ${name}. \`start\` liste les serveurs connus.`);
    if (manager.isRunning(def.key)) {
      return out.warn(`${def.label} est deja demarre (PID ${manager.get(def.key).pid}).`);
    }

    // Port tenu par le Terminal lui-meme : le message generique conseillerait
    // `stop --force`, que le garde-fou refuserait de toute facon.
    if (def.port && await isListening(def.port)) {
      let owner = null;
      try { owner = await portOwner(def.port); } catch { /* inconnu */ }
      if (owner) {
        const [blocked] = await findProtected(ctx, [owner.pid]);
        if (blocked) throw new Error(`${def.label} tourne deja : ${blocked.reason}.`);
      }
    }

    emit(out.dim(`Demarrage de ${def.label}...`));
    const result = await manager.start(def.key, { ...def, delai: flags.delai }, { signal: ctx.signal });

    const blocks = [];
    if (result.listening) {
      blocks.push(out.success(`${def.label} en ecoute : ${baseUrl(def)} (PID ${result.pid})`));
    } else if (def.port) {
      blocks.push(out.warn(`${def.label} tourne (PID ${result.pid}) mais n'ecoute pas encore sur le port ${def.port}.`));
    } else {
      blocks.push(out.success(`${def.label} demarre (PID ${result.pid}).`));
      blocks.push(out.dim('Aucun port declare : impossible de verifier qu\'il repond.'));
    }
    blocks.push(out.dim(`\`access ${def.key}\` pour y entrer - \`stop ${def.key}\` pour l'arreter.`));
    return blocks;
  }
};

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

const stop = {
  name: 'stop',
  aliases: ['arreter'],
  category: CATEGORY,
  summary: 'Arrete un serveur.',
  usage: 'stop [serveur] [--force] | stop --tous',
  details: [
    'Sans argument, arrete le serveur dans lequel vous etes (`access <serveur>`).',
    '',
    'Un serveur lance en dehors du Terminal n\'est arrete qu\'avec --force :',
    'le processus qui occupe son port est alors termine.'
  ].join('\n'),
  examples: ['stop chroma', 'stop', 'stop --tous', 'stop chroma --force'],
  flags: { force: 'boolean', tous: 'boolean' },
  flagHelp: {
    force: 'Arreter aussi un serveur lance hors du Terminal, via son port.',
    tous: 'Arreter tous les serveurs demarres depuis ce Terminal.'
  },
  complete: completeServers,

  async run(ctx) {
    const { args, flags, session, out } = ctx;
    const manager = ctx.terminal.servers;

    if (flags.tous) {
      const labels = await manager.stopAll();
      session.server = null;
      return labels.length
        ? out.success(`Arrete${labels.length > 1 ? 's' : ''} : ${labels.join(', ')}`)
        : out.dim('Aucun serveur demarre depuis ce Terminal.');
    }

    let name = args.join(' ').trim();
    if (!name && session.server) name = session.server.key;
    if (!name) {
      const running = manager.running();
      if (!running.length) return out.dim('Aucun serveur demarre depuis ce Terminal.');
      throw new Error(`Precisez le serveur a arreter : ${running.map((e) => e.key).join(', ')}.`);
    }

    const key = keyOf(name);
    const entry = manager.get(key);
    const def = (await resolveServer(name, session)) || (entry && { key, ...entry.def });
    const label = def ? def.label : name;

    if (manager.isRunning(key)) {
      await manager.stop(key);
      leaveIfCurrent(session, key);
      return out.success(`${label} arrete.`);
    }

    if (def && def.port && await isListening(def.port)) {
      let owner = null;
      try { owner = await portOwner(def.port); } catch { /* inconnu */ }

      // Le port peut appartenir au Terminal lui-meme : l'arreter « avec ses
      // enfants » fermerait la fenetre au milieu de la commande.
      if (owner) {
        const [blocked] = await findProtected(ctx, [owner.pid], { tree: true });
        if (blocked) {
          throw new Error(`Refus - le port ${def.port} est tenu par ${owner.name} (PID ${owner.pid}) : ${blocked.reason}.`);
        }
      }

      if (!flags.force) {
        throw new Error(
          `${label} tourne en dehors de ce Terminal${owner ? ` (${owner.name}, PID ${owner.pid})` : ''}. `
          + `\`stop ${key} --force\` pour l'arreter quand meme.`
        );
      }
      if (!owner) throw new Error(`Impossible d'identifier le processus qui occupe le port ${def.port}.`);
      await killTree(owner.pid);
      leaveIfCurrent(session, key);
      return out.success(`${label} arrete (${owner.name}, PID ${owner.pid}).`);
    }

    if (!def) throw new Error(`Serveur inconnu : ${name}. \`start\` liste les serveurs connus.`);
    return out.warn(`${label} n'est pas demarre.`);
  }
};

module.exports = [start, stop];
module.exports.resolveServer = resolveServer;
module.exports.stateOf = stateOf;
module.exports.baseUrl = baseUrl;
module.exports.keyOf = keyOf;
