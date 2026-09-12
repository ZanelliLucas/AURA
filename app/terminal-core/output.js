'use strict';

// Blocs de sortie structures. Le moteur ne produit JAMAIS de HTML ni de codes
// ANSI : il decrit ce qu'il veut afficher, et chaque facade (Electron,
// console) le rend a sa maniere. C'est ce qui rend le coeur reutilisable.

/** Tons disponibles pour un bloc texte. */
const TONES = ['normal', 'dim', 'accent', 'error', 'success', 'warn'];

const text = (value, tone = 'normal') => ({ type: 'text', text: String(value), tone });
const dim = (value) => text(value, 'dim');
const accent = (value) => text(value, 'accent');
const error = (value) => text(value, 'error');
const success = (value) => text(value, 'success');
const warn = (value) => text(value, 'warn');

/** Titre de section, rendu en capitales avec un filet rouge. */
const title = (label, note = '') => ({ type: 'title', label: String(label), note: String(note) });

/** Ligne vide / filet horizontal. */
const blank = () => ({ type: 'blank' });
const rule = () => ({ type: 'rule' });

/**
 * Tableau.
 * @param {Array<{key:string,label?:string,align?:'left'|'right'}>} columns
 * @param {Array<Object>} rows
 */
const table = (columns, rows, opts = {}) => ({
  type: 'table',
  columns: columns.map((c) => ({ align: 'left', label: c.key, ...c })),
  rows,
  ...opts
});

/** Liste a puces. */
const list = (items) => ({ type: 'list', items: items.map(String) });

/** Paires cle / valeur alignees (fiche d'identite, infos systeme...). */
const kv = (pairs) => ({ type: 'kv', pairs: pairs.map(([k, v]) => [String(k), String(v)]) });

/** Barre de progression / jauge (0..1). Utilisee par le HUD systeme. */
const gauge = (label, ratio, note = '') => ({
  type: 'gauge',
  label: String(label),
  ratio: Math.max(0, Math.min(1, Number(ratio) || 0)),
  note: String(note)
});

/** Chemin cliquable (la facade decide si elle en fait un lien). */
const path = (value, meta = {}) => ({ type: 'path', path: String(value), meta });

/** Bloc de code / sortie brute d'un programme externe. */
const code = (value, lang = '') => ({ type: 'code', text: String(value), lang });

/**
 * Console d'un programme interactif (`run python`) : la facade l'affiche et y
 * branche le clavier. `id` designe la console chez l'hote qui l'a ouverte.
 */
const terminalConsole = (id, title = '') => ({ type: 'console', id: String(id), title: String(title) });

/**
 * Ordre adresse a l'interface plutot qu'a l'utilisateur (effacer l'ecran,
 * quitter...). Les facades qui ne savent pas les traiter les ignorent.
 */
const control = (action, payload = {}) => ({ type: 'control', action, payload });

module.exports = { TONES, text, dim, accent, error, success, warn, title, blank, rule, table, list, kv, gauge, path, code, console: terminalConsole, control };
