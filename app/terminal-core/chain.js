'use strict';

const { tokenize } = require('./parser');

const BACKSLASH = '\\';

/**
 * Enchainements sur une ligne :
 *   a && b     b si a a reussi        a || b     b si a a echoue
 *   a ; b      b dans tous les cas    a | b      la sortie de a passe a b
 *   a > f      sortie ecrite dans f   a >> f     ajoutee a la fin de f
 *
 * Entre guillemets, un operateur reste du texte. Memes regles de guillemets et
 * d'antislash que tokenize (parser.js) : les deux lectures doivent s'accorder.
 */

const escapable = (ch) => ch === '"' || ch === "'" || ch === BACKSLASH || /\s/.test(ch);

/**
 * Texte et operateurs, en alternance : texte, op, texte, op, ..., texte.
 * Les morceaux de texte sont gardes tels quels, guillemets compris : chaque
 * commande les relit ensuite avec ses propres regles.
 * `lenient` : ligne en cours de frappe (completion), rien n'est refuse.
 */
function scan(line, lenient = false) {
  const items = [];
  let text = '';
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === BACKSLASH && quote === '"' && next !== undefined && escapable(next)) { text += ch + next; i += 1; continue; }
      text += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; text += ch; continue; }
    if (ch === BACKSLASH && next !== undefined && /\s/.test(next)) { text += ch + next; i += 1; continue; }

    let op = null;
    if ((ch === '&' && next === '&') || (ch === '|' && next === '|') || (ch === '>' && next === '>')) op = ch + next;
    else if (ch === '|' || ch === ';' || ch === '>') op = ch;
    if (!op) { text += ch; continue; }

    // `2>` et `2>&1` viennent des shells : ici, les erreurs suivent deja la sortie.
    if (!lenient && op[0] === '>' && /(^|\s)\d$/.test(text)) {
      throw new Error('Seules les redirections > et >> sont prises en charge (pas 2> ni 2>&1) : les erreurs sont deja affichees avec la sortie.');
    }
    items.push({ type: 'text', value: text });
    items.push({ type: 'op', value: op });
    text = '';
    i += op.length - 1;
  }
  if (quote && !lenient) throw new Error(`Guillemet ${quote} non ferme.`);
  items.push({ type: 'text', value: text });
  return items;
}

/**
 * Analyse une ligne en groupes executes l'un apres l'autre.
 *
 * @returns {Array<{op: null|'&&'|'||'|';', stages: string[], redirect: null|{mode:'write'|'append', target:string}}>}
 *          `op` : condition pour executer le groupe, d'apres le precedent.
 * @throws si la ligne est mal formee (commande manquante, redirection mal placee...)
 */
function parseChain(line) {
  const items = scan(String(line == null ? '' : line));
  const texts = [];
  const ops = [];
  items.forEach((item, i) => (i % 2 ? ops : texts).push(item.value));

  const missing = (text, before, after) => {
    if (text) return;
    throw new Error(before ? `Commande manquante avant ${before}.` : `Commande manquante apres ${after}.`);
  };

  const groups = [];
  let group = { op: null, stages: [texts[0].trim()], redirect: null };

  for (let k = 0; k < ops.length; k += 1) {
    const op = ops[k];
    const next = texts[k + 1].trim();
    const last = group.stages[group.stages.length - 1];

    if (op === '>' || op === '>>') {
      missing(last, op);
      if (group.redirect) throw new Error('Une seule redirection par commande.');
      if (!next) throw new Error(`Indiquez le fichier apres ${op}.`);
      const tokens = tokenize(next);
      if (tokens.length !== 1) {
        throw new Error(`Un seul fichier apres ${op} : mettez son nom entre guillemets s'il contient des espaces.`);
      }
      group.redirect = { mode: op === '>>' ? 'append' : 'write', target: tokens[0].value };
      continue;
    }

    if (op === '|') {
      missing(last, op);
      if (group.redirect) throw new Error('La redirection se place en fin de commande, apres le dernier |.');
      missing(next, null, op);
      group.stages.push(next);
      continue;
    }

    // && || ;
    missing(last, op);
    groups.push(group);
    group = { op, stages: [next], redirect: null };
  }

  if (group.stages.length > 1 || group.stages[0]) groups.push(group);
  // Un « ; » final est tolere ; `a &&` attend une suite.
  else if (group.op === '&&' || group.op === '||') missing('', null, group.op);
  return groups;
}

/** Une seule commande, sans tube ni redirection : le cas de toujours. */
function isSimple(chain) {
  return chain.length === 1 && chain[0].stages.length === 1 && !chain[0].redirect;
}

/** La ligne contient-elle un operateur hors guillemets ? */
function hasOperators(line) {
  try {
    return scan(String(line || '')).length > 1;
  } catch {
    return false;
  }
}

/**
 * Le morceau en cours de frappe, apres le dernier operateur : c'est lui que
 * Tab complete (`ps | gr` -> `grep`).
 */
function lastSegment(line) {
  const items = scan(String(line || ''), true);
  const segment = items[items.length - 1].value;
  return { segment: segment.replace(/^\s+/, ''), op: items.length > 1 ? items[items.length - 2].value : null };
}

/**
 * `"ps | grep node"` -> `ps | grep node` : une ligne entierement entre
 * guillemets est rendue a son contenu. C'est ainsi qu'on confie un
 * enchainement entier a `watch`, a `alias` ou au shell natif de `run`.
 */
function unquoteWhole(text) {
  const trimmed = String(text || '').trim();
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed[trimmed.length - 1] !== quote || trimmed.length < 2) return trimmed;
  let tokens;
  try { tokens = tokenize(trimmed); } catch { return trimmed; }
  return tokens.length === 1 && tokens[0].quotedStart ? tokens[0].value : trimmed;
}

module.exports = { scan, parseChain, isSimple, hasOperators, lastSegment, unquoteWhole };
