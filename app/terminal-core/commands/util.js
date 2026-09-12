'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { formatDuration } = require('../platform');
const { tokenize } = require('../parser');
const { unquoteWhole } = require('../chain');

const CATEGORY = 'Terminal';

const help = {
  name: 'help',
  aliases: ['aide', '?'],
  category: CATEGORY,
  summary: 'Liste les commandes, ou detaille l\'une d\'elles.',
  usage: 'help [commande]',
  examples: ['help', 'help find'],
  complete: ({ partial, terminal }) => terminal.registry.names().filter((n) => n.startsWith(partial)),
  run(ctx) {
    const { out, registry } = ctx;
    const wanted = ctx.args[0];

    if (wanted) {
      const command = registry.get(wanted);
      if (!command) {
        const suggestions = registry.suggest(wanted);
        throw new Error(
          `Commande inconnue : ${wanted}${suggestions.length ? ` (essayez : ${suggestions.join(', ')})` : ''}`
        );
      }

      const blocks = [
        out.title(command.name, command.category),
        out.text(command.summary),
        out.blank(),
        out.text('Usage'),
        out.code(command.usage)
      ];

      if (command.aliases.length) {
        blocks.push(out.dim(`Alias : ${command.aliases.join(', ')}`));
      }
      if (command.details) {
        blocks.push(out.blank(), out.text(command.details, 'dim'));
      }

      const flagNames = Object.keys(command.flags || {});
      if (flagNames.length) {
        blocks.push(out.blank(), out.text('Options'));
        blocks.push(out.kv(flagNames.map((flag) => {
          const synonyms = Object.entries(command.flagAliases || {})
            .filter(([, target]) => target === flag)
            .map(([alias]) => `--${alias}`);
          const text = command.flagHelp[flag] || `(${command.flags[flag]})`;
          return [`--${flag}`, synonyms.length ? `${text} (aussi : ${synonyms.join(', ')})` : text];
        })));
      }
      if (command.examples.length) {
        blocks.push(out.blank(), out.text('Exemples'), out.code(command.examples.join('\n')));
      }
      if (command.acceptsInput) {
        blocks.push(out.blank(), out.dim(`Lit aussi la sortie d'une autre commande, apres un tube : ps | ${command.name}`));
      }
      if (command.dangerous) {
        blocks.push(out.blank(), out.warn('Commande sensible : une confirmation est demandee avant execution.'));
      } else if (command.confirmWhen && command.confirmWhen.length) {
        blocks.push(out.blank(), out.warn(`Confirmation demandee avant : ${command.confirmWhen.map((w) => `${command.name} ${w}`).join(', ')}.`));
      }
      return blocks;
    }

    const blocks = [out.title('Commandes disponibles', `${registry.list().length} au total`)];
    for (const [category, commands] of registry.byCategory()) {
      blocks.push(out.blank(), out.accent(category.toUpperCase()));
      blocks.push(out.kv(commands.map((command) => [command.name, command.summary])));
    }
    blocks.push(out.blank(), out.dim('`help <commande>` pour le detail - Tab pour completer - Fleches pour l\'historique.'));
    blocks.push(out.dim('Enchainer : a && b (si a reussit), a || b (si a echoue), a ; b - Tube : ps | grep node - Fichier : ps > liste.csv, >> pour ajouter.'));
    return blocks;
  }
};

const clear = {
  name: 'clear',
  aliases: ['cls', 'effacer'],
  category: CATEGORY,
  summary: 'Efface l\'ecran.',
  usage: 'clear',
  run: (ctx) => ctx.out.control('clear')
};

const history = {
  name: 'history',
  aliases: ['historique'],
  category: CATEGORY,
  summary: 'Affiche ou vide l\'historique des commandes.',
  usage: 'history [--limit 30] [--vider]',
  flags: { limit: 'number', vider: 'boolean' },
  flagHelp: { limit: 'Nombre de lignes affichees (defaut 30).', vider: 'Effacer tout l\'historique.' },
  short: { n: 'limit' },
  run(ctx) {
    if (ctx.flags.vider) {
      ctx.session.clearHistory();
      return ctx.out.success('Historique vide.');
    }

    const all = ctx.session.history;
    if (!all.length) return ctx.out.dim('Historique vide.');

    const limit = Math.max(1, ctx.flags.limit || 30);
    const start = Math.max(0, all.length - limit);
    return ctx.out.kv(all.slice(start).map((line, i) => [String(start + i + 1), line]));
  }
};

const alias = {
  name: 'alias',
  aliases: ['raccourci'],
  category: CATEGORY,
  summary: 'Cree, liste ou supprime un raccourci de commande.',
  usage: 'alias [nom] [= commande] [--supprimer nom]',
  details: [
    'Sans argument, liste les alias existants.',
    'Les alias sont conserves d\'une session a l\'autre.'
  ].join('\n'),
  // La commande enregistree garde ses propres options (`alias ll = ls --tout`).
  passthrough: true,
  flags: { supprimer: 'boolean' },
  flagHelp: { supprimer: 'Supprimer l\'alias nomme.' },
  examples: ['alias', 'alias dl = cd ~/Downloads', 'alias ll = ls --tout', 'alias dl --supprimer'],
  run(ctx) {
    const { session, out } = ctx;

    if (ctx.flags.supprimer) {
      const name = ctx.args[0];
      if (!name) throw new Error('Indiquez l\'alias a supprimer.');
      if (!session.removeAlias(name)) throw new Error(`Alias inconnu : ${name}`);
      return out.success(`Alias supprime : ${name}`);
    }

    if (!ctx.args.length) {
      if (!session.aliases.size) return out.dim('Aucun alias defini. Exemple : alias dl = cd ~/Downloads');
      return out.kv([...session.aliases.entries()]);
    }

    const [name] = ctx.args;
    // Le corps est repris tel quel dans la ligne : ses options (`ls --tout`) et
    // ses guillemets appartiennent a la commande visee, pas a `alias` - les
    // reconstruire depuis les arguments les faisait disparaitre.
    // `alias dl = cd ~/Downloads` et `alias dl cd ~/Downloads` fonctionnent tous deux.
    const raw = ctx.raw.trim();
    // Un enchainement se met entre guillemets (`alias maj = "run git pull && run npm install"`) :
    // sans eux, le `&&` s'appliquerait a la ligne `alias` elle-meme.
    const body = unquoteWhole(raw.slice(raw.indexOf(name) + name.length).trim().replace(/^=\s*/, '').trim());

    if (!body) {
      if (!session.aliases.has(name)) throw new Error(`Alias inconnu : ${name}`);
      return out.kv([[name, session.aliases.get(name)]]);
    }

    if (ctx.registry.has(name)) {
      throw new Error(`« ${name} » est deja une commande : choisissez un autre nom.`);
    }

    session.setAlias(name, body);
    return out.success(`Alias enregistre : ${name} -> ${body}`);
  }
};

const echo = {
  name: 'echo',
  aliases: ['dire'],
  category: CATEGORY,
  summary: 'Affiche le texte donne.',
  usage: 'echo <texte>',
  // Texte affiche tel quel : `echo -n salut` ne perd pas son « -n ».
  passthrough: true,
  run: (ctx) => ctx.out.text(tokenize(ctx.raw).map((token) => token.value).join(' '))
};

const now = {
  name: 'date',
  aliases: ['heure'],
  category: CATEGORY,
  summary: 'Date et heure courantes.',
  usage: 'date',
  run(ctx) {
    const d = new Date();
    return ctx.out.kv([
      ['Date', d.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })],
      ['Heure', d.toLocaleTimeString('fr-FR')],
      ['ISO', d.toISOString()],
      ['Horodatage', String(Math.floor(d.getTime() / 1000))]
    ]);
  }
};

const uuid = {
  name: 'uuid',
  category: CATEGORY,
  summary: 'Genere un ou plusieurs identifiants uniques.',
  usage: 'uuid [nombre]',
  run(ctx) {
    const count = Math.min(50, Math.max(1, Number(ctx.args[0]) || 1));
    return ctx.out.code(Array.from({ length: count }, () => crypto.randomUUID()).join('\n'));
  }
};

const hash = {
  name: 'hash',
  aliases: ['empreinte'],
  category: CATEGORY,
  summary: 'Calcule l\'empreinte d\'un texte ou d\'un fichier.',
  usage: 'hash <texte|fichier> [--algo sha256] [--fichier]',
  flags: { algo: 'string', fichier: 'boolean' },
  flagHelp: { algo: 'md5, sha1, sha256 (defaut) ou sha512.', fichier: 'Traiter l\'argument comme un chemin de fichier.' },
  examples: ['hash "mot de passe"', 'hash archive.zip --fichier --algo md5'],
  async run(ctx) {
    const input = ctx.args.join(' ');
    if (!input) throw new Error('Indiquez un texte ou un fichier.');

    const algo = (ctx.flags.algo || 'sha256').toLowerCase();
    if (!crypto.getHashes().includes(algo)) throw new Error(`Algorithme inconnu : ${algo}`);

    const target = ctx.session.resolve(input);
    const asFile = ctx.flags.fichier || (fs.existsSync(target) && fs.statSync(target).isFile());

    if (asFile) {
      if (!fs.existsSync(target)) throw new Error(`Fichier introuvable : ${target}`);
      const digest = await new Promise((resolve, reject) => {
        const stream = fs.createReadStream(target);
        const hasher = crypto.createHash(algo);
        stream.on('error', reject);
        stream.on('data', (chunk) => hasher.update(chunk));
        stream.on('end', () => resolve(hasher.digest('hex')));
      });
      return ctx.out.kv([['Fichier', target], [algo.toUpperCase(), digest]]);
    }

    return ctx.out.kv([[algo.toUpperCase(), crypto.createHash(algo).update(input, 'utf8').digest('hex')]]);
  }
};

const about = {
  name: 'about',
  aliases: ['apropos', 'version'],
  category: CATEGORY,
  summary: 'Informations sur le Terminal.',
  usage: 'about',
  run(ctx) {
    const uptime = (Date.now() - ctx.session.startedAt) / 1000;
    return [
      ctx.out.title(ctx.terminal.name, `v${ctx.terminal.version}`),
      ctx.out.kv([
        ['Commandes', String(ctx.registry.list().length)],
        ['Session ouverte depuis', formatDuration(uptime)],
        ['Dossier courant', ctx.session.cwd],
        ['Node', process.versions.node]
      ])
    ];
  }
};

const exit = {
  name: 'exit',
  aliases: ['quitter'],
  category: CATEGORY,
  summary: 'Ferme l\'onglet ; au dernier, arrete les serveurs demarres ici puis ferme le Terminal.',
  usage: 'exit',
  details: [
    'Avec plusieurs onglets, seul celui-ci se ferme : les serveurs continuent.',
    'Pour sortir d\'un serveur sans rien arreter ni fermer : access --sortir.'
  ].join('\n'),
  async run(ctx) {
    const tabs = ctx.terminal.openTabs;
    const tab = ctx.tab || 'main';
    if (tabs && tabs.size > 1 && tabs.has(tab)) {
      ctx.terminal.closeTab(tab);
      return ctx.out.control('close-tab');
    }
    const stopped = ctx.terminal.servers ? await ctx.terminal.servers.stopAll() : [];
    ctx.session.server = null;
    if (stopped.length) {
      ctx.emit(ctx.out.success(`Arrete${stopped.length > 1 ? 's' : ''} : ${stopped.join(', ')}`));
    }
    return ctx.out.control('exit');
  }
};

module.exports = [help, clear, history, alias, echo, now, uuid, hash, about, exit];
