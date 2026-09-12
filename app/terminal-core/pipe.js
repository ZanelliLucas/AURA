'use strict';

const os = require('os');

/**
 * Blocs dans un tube (`ps | grep node`) et vers un fichier (`ps > liste.csv`).
 *
 * Un tube transmet des blocs, pas du texte : un tableau filtre par grep reste
 * un tableau, avec ses colonnes et ses numeros de resultat. Les commandes qui
 * lisent un tube travaillent sur des « lignes » : les lignes d'un tableau, d'un
 * texte ou d'une sortie de programme, les paires d'une fiche, les puces d'une liste.
 */

/** Blocs qui portent des donnees. */
const DATA = new Set(['text', 'code', 'kv', 'list', 'path', 'table']);

/**
 * Ce qui passe dans un tube : les donnees. Pas la decoration (titres, filets,
 * jauges), ni les indications grises (« Tapez open 3... »), ni les erreurs
 * et avertissements, que le moteur affiche directement.
 */
function pipeData(blocks) {
  return (blocks || []).filter((block) => block && DATA.has(block.type)
    && !(block.type === 'text' && ['dim', 'error', 'warn'].includes(block.tone)));
}

const cell = (row, column) => {
  // Colonne de chemins : le chemin complet, plus utile hors de l'ecran.
  const value = column.kind === 'path' && row._full ? row._full : row[column.key];
  return value == null ? '' : String(value);
};

/** Lignes d'un bloc : `{ value, text }`, `value` etant ce que le bloc contient. */
function unitsOf(block) {
  switch (block.type) {
    case 'table':
      return block.rows.map((row) => ({ value: row, text: block.columns.map((c) => cell(row, c)).join('  ') }));
    case 'text':
    case 'code':
      return block.text.split('\n').map((line) => ({ value: line, text: line }));
    case 'kv':
      return block.pairs.map((pair) => ({ value: pair, text: `${pair[0]}  ${pair[1]}` }));
    case 'list':
      return block.items.map((item) => ({ value: item, text: item }));
    case 'path':
      return [{ value: block.path, text: block.path }];
    default:
      return [];
  }
}

/** Toutes les lignes des blocs, chacune avec son bloc d'origine. */
function units(blocks) {
  const all = [];
  for (const block of pipeData(blocks)) {
    for (const unit of unitsOf(block)) all.push({ ...unit, block });
  }
  return all;
}

/** Remet des lignes en blocs : les lignes voisines d'un meme bloc s'y retrouvent. */
function rebuild(list) {
  const blocks = [];
  let group = null;
  const flush = () => {
    if (!group) return;
    const { block, values } = group;
    switch (block.type) {
      case 'table': blocks.push({ ...block, rows: values }); break;
      case 'text':
      case 'code': blocks.push({ ...block, text: values.join('\n') }); break;
      case 'kv': blocks.push({ ...block, pairs: values }); break;
      case 'list': blocks.push({ ...block, items: values }); break;
      default: blocks.push(block);
    }
    group = null;
  };
  for (const unit of list) {
    if (!group || group.block !== unit.block) {
      flush();
      group = { block: unit.block, values: [] };
    }
    group.values.push(unit.value);
  }
  flush();
  return blocks;
}

// --- Vers un fichier ------------------------------------------------------------

function alignTable(block) {
  const columns = block.columns.map((column) => {
    const cells = block.rows.map((row) => cell(row, column));
    return { column, cells, size: Math.max(column.label.length, ...cells.map((c) => c.length)) };
  });
  const line = (values) => values
    .map((value, i) => (columns[i].column.align === 'right' ? value.padStart(columns[i].size) : value.padEnd(columns[i].size)))
    .join('  ')
    .trimEnd();
  return [
    line(columns.map((c) => c.column.label)),
    ...block.rows.map((_, r) => line(columns.map((c) => c.cells[r])))
  ];
}

/** Texte brut, comme a l'ecran : tableaux alignes, fiches en colonnes. */
function toText(blocks) {
  const lines = [];
  for (const block of pipeData(blocks)) {
    if (block.type === 'table') lines.push(...alignTable(block));
    else if (block.type === 'kv') {
      const size = Math.max(0, ...block.pairs.map(([k]) => k.length));
      lines.push(...block.pairs.map(([k, v]) => `${k.padEnd(size)}  ${v}`));
    } else if (block.type === 'list') lines.push(...block.items.map((item) => `- ${item}`));
    else lines.push(...unitsOf(block).map((u) => u.text));
  }
  return lines.length ? lines.join(os.EOL) + os.EOL : '';
}

/** Champ CSV : entre guillemets s'il contient le separateur, un guillemet ou un saut de ligne. */
function csvField(value) {
  const text = String(value);
  return /[;"\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV pour Excel en francais : separateur « ; ». Les tableaux gardent leurs
 * colonnes ; le reste donne une colonne unique. `header: false` pour ajouter
 * a un fichier qui a deja ses titres (`>>`).
 */
function toCsv(blocks, { header = true } = {}) {
  const lines = [];
  for (const block of pipeData(blocks)) {
    if (block.type === 'table') {
      if (header) lines.push(block.columns.map((c) => csvField(c.label)).join(';'));
      for (const row of block.rows) lines.push(block.columns.map((c) => csvField(cell(row, c))).join(';'));
    } else if (block.type === 'kv') {
      for (const [k, v] of block.pairs) lines.push(`${csvField(k)};${csvField(v)}`);
    } else {
      for (const unit of unitsOf(block)) lines.push(csvField(unit.text));
    }
  }
  return lines.length ? lines.join('\r\n') + '\r\n' : '';
}

module.exports = { pipeData, units, rebuild, toText, toCsv };
