'use strict';

/** Retire les marques diacritiques (plage 0x0300-0x036F) d'un texte decompose. */
function stripMarks(text) {
  return String(text || '').normalize('NFD').split('')
    .filter((c) => { const code = c.codePointAt(0); return code < 0x0300 || code > 0x036f; })
    .join('');
}

/**
 * Forme comparable d'un nom : minuscules, sans accents, ponctuation ramenee
 * a des espaces. « Mon Serveur ! » devient « mon serveur ».
 *
 * Les marques sont retirees par comparaison de code point plutot que par une
 * plage \u dans une regex, pour eviter toute ambiguite d'echappement.
 */
function normalize(text) {
  return stripMarks(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Minuscules sans accents, ponctuation conservee : « Résumé.PDF » devient
 * « resume.pdf ». Sert a `find`, pour que « resume » trouve « Résumé ».
 */
function fold(text) {
  return stripMarks(text).toLowerCase();
}

module.exports = { normalize, fold };
