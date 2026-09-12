'use strict';

/**
 * Commandes de tube : elles travaillent sur la sortie d'une autre commande.
 *
 *   ps | sort memoire --inverse | head 5
 *
 * Une « ligne » est une ligne de tableau, de texte ou de sortie de programme :
 * un tableau trie ou raccourci reste un tableau (voir core/pipe.js).
 */

const { units, rebuild } = require('../pipe');
const { fold } = require('../text');

const CATEGORY = 'Terminal';

/** Les lignes recues, ou une erreur qui montre comment s'en servir. */
function received(ctx, example) {
  if (!ctx.input) throw new Error(`${ctx.command.name} lit la sortie d'une autre commande, apres un tube : ${example}`);
  return units(ctx.input);
}

function countArg(ctx, fallback) {
  const raw = ctx.args[0];
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Nombre de lignes attendu (recu : ${raw}).`);
  return n;
}

const head = {
  name: 'head',
  aliases: ['tete', 'premiers'],
  category: CATEGORY,
  summary: 'Garde les premieres lignes de la sortie d\'une commande.',
  usage: '... | head [n]',
  details: 'Lignes d\'un tableau, d\'un texte ou d\'une sortie de programme : 10 par defaut.',
  examples: ['ps | head 5', 'grep contrat | head 3'],
  acceptsInput: true,
  run(ctx) {
    const all = received(ctx, 'ps | head 5');
    return rebuild(all.slice(0, countArg(ctx, 10)));
  }
};

const tail = {
  name: 'tail',
  aliases: ['queue', 'derniers'],
  category: CATEGORY,
  summary: 'Garde les dernieres lignes de la sortie d\'une commande.',
  usage: '... | tail [n]',
  details: '10 lignes par defaut. Pour la fin d\'un fichier : cat <fichier> --fin.',
  examples: ['journal | tail 5', 'run git log --oneline | tail 3'],
  acceptsInput: true,
  run(ctx) {
    const all = received(ctx, 'journal | tail 5');
    return rebuild(all.slice(Math.max(0, all.length - countArg(ctx, 10))));
  }
};

const SIZE_UNITS = { o: 1, ko: 1024, mo: 1024 ** 2, go: 1024 ** 3, to: 1024 ** 4 };
const SPACES = /[\s\u00a0\u202f]/g;

/**
 * Valeur numerique d'une cellule : « 1,5 Go », « 12 % », « 1 234 ». null pour
 * du texte. Sans cela, « 900 Mo » passerait apres « 1,2 Go ».
 */
function numericValue(text) {
  const value = String(text).trim();
  const size = /^(-?[\d\s\u00a0\u202f]+(?:[.,]\d+)?)\s*(o|ko|mo|go|to)$/i.exec(value);
  if (size) return Number(size[1].replace(SPACES, '').replace(',', '.')) * SIZE_UNITS[size[2].toLowerCase()];
  const number = /^(-?[\d\s\u00a0\u202f]*\d(?:[.,]\d+)?)\s*%?$/.exec(value);
  if (number) return Number(number[1].replace(SPACES, '').replace(',', '.'));
  return null;
}

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

/** Nombres entre eux, texte entre eux ; les nombres d'abord. */
function compareValues(a, b) {
  const x = numericValue(a);
  const y = numericValue(b);
  if (x !== null && y !== null) return x - y;
  if (x !== null) return -1;
  if (y !== null) return 1;
  return collator.compare(a, b);
}

/** La colonne demandee : nom exact (accents et casse ignores), sinon debut unique. */
function findColumn(columns, wanted) {
  const target = fold(wanted);
  const exact = columns.find((c) => fold(c.key) === target || fold(c.label) === target);
  if (exact) return exact;
  const starts = columns.filter((c) => fold(c.label).startsWith(target) || fold(c.key).startsWith(target));
  return starts.length === 1 ? starts[0] : null;
}

const sort = {
  name: 'sort',
  aliases: ['trier'],
  category: CATEGORY,
  summary: 'Trie la sortie d\'une commande, par colonne pour un tableau.',
  usage: '... | sort [colonne] [--inverse]',
  details: [
    'Sans colonne : la premiere. Le debut du nom suffit (`sort mem`).',
    'Nombres, tailles (Ko, Mo, Go) et pourcentages sont compares comme des',
    'valeurs ; le texte dans l\'ordre alphabetique, accents compris.'
  ].join('\n'),
  flags: { inverse: 'boolean' },
  flagAliases: { reverse: 'inverse' },
  flagHelp: { inverse: 'Du plus grand au plus petit.' },
  short: { r: 'inverse' },
  examples: ['ps | sort memoire --inverse | head 5', 'ls | sort taille -r'],
  acceptsInput: true,
  run(ctx) {
    const all = received(ctx, 'ps | sort memoire --inverse');
    const wanted = ctx.args.join(' ').trim();

    const columnOf = new Map();
    for (const unit of all) {
      if (unit.block.type !== 'table' || columnOf.has(unit.block)) continue;
      const { columns } = unit.block;
      const column = wanted ? findColumn(columns, wanted) : columns[0];
      if (!column) throw new Error(`Colonne inconnue : ${wanted}. Colonnes : ${columns.map((c) => c.label).join(', ')}.`);
      columnOf.set(unit.block, column);
    }

    const valueOf = (unit) => {
      const column = columnOf.get(unit.block);
      if (!column) return unit.text;
      const value = unit.value[column.key];
      return value == null ? '' : String(value);
    };
    const sign = ctx.flags.inverse ? -1 : 1;
    return rebuild(all.slice().sort((a, b) => sign * compareValues(valueOf(a), valueOf(b))));
  }
};

const wc = {
  name: 'wc',
  aliases: ['compter'],
  category: CATEGORY,
  summary: 'Compte les lignes de la sortie d\'une commande.',
  usage: '... | wc',
  examples: ['ps | grep chrome | wc', 'find *.pdf | wc'],
  acceptsInput: true,
  run(ctx) {
    const count = received(ctx, 'ps | grep chrome | wc').length;
    return ctx.out.text(`${count} ligne${count > 1 ? 's' : ''}`);
  }
};

module.exports = [head, tail, sort, wc];
module.exports.numericValue = numericValue;
