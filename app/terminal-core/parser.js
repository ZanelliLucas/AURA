'use strict';

const BACKSLASH = '\\';

/**
 * Decoupe une ligne en jetons, en respectant les guillemets simples et
 * doubles ainsi que l'echappement par antislash (hors guillemets simples).
 *
 * Attention Windows : un antislash n'echappe QUE devant un espace ou un
 * guillemet. Sans cela `C:\Users\Lucas` deviendrait `C:UsersLucas`.
 *
 * `quotedStart` distingue `"--in=x"` (litteral, un argument) de
 * `--in="x"` (une option dont seule la valeur est entre guillemets).
 *
 * @returns {Array<{value:string, quoted:boolean, quotedStart:boolean}>}
 */
function tokenize(line) {
  const tokens = [];
  let current = '';
  let quote = null;
  let started = false;
  let quoted = false;
  let quotedStart = false;

  const escapable = (ch) => ch === '"' || ch === "'" || ch === BACKSLASH || /\s/.test(ch);

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (ch === BACKSLASH && quote === '"' && i + 1 < line.length && escapable(line[i + 1])) {
        current += line[i + 1];
        i += 1;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      if (!started) quotedStart = true;
      quote = ch;
      started = true;
      quoted = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (started) {
        tokens.push({ value: current, quoted, quotedStart });
        current = '';
        started = false;
        quoted = false;
        quotedStart = false;
      }
      continue;
    }

    if (ch === BACKSLASH && i + 1 < line.length && /\s/.test(line[i + 1])) {
      current += line[i + 1];
      i += 1;
      started = true;
      continue;
    }

    current += ch;
    started = true;
  }

  if (started) tokens.push({ value: current, quoted, quotedStart });
  if (quote) throw new Error(`Guillemet ${quote} non ferme.`);
  return tokens;
}

const TRUE_WORDS = new Set(['1', 'true', 'oui', 'yes', 'on']);
const FALSE_WORDS = new Set(['0', 'false', 'non', 'no', 'off']);

function castValue(raw, kind, flagName) {
  if (kind === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`--${flagName} attend un nombre (recu : ${raw}).`);
    return n;
  }
  if (kind === 'boolean') {
    const low = String(raw).toLowerCase();
    if (TRUE_WORDS.has(low)) return true;
    if (FALSE_WORDS.has(low)) return false;
    throw new Error(`--${flagName} attend oui/non (recu : ${raw}).`);
  }
  if (kind === 'list') return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  return String(raw);
}

/**
 * Analyse une ligne de commande.
 *
 * La specification des options vient de la commande elle-meme
 * (`{ in: 'string', limit: 'number', deep: 'boolean' }`), ce qui permet
 * d'ecrire aussi bien `--in=C:\Users` que `--in C:\Users` sans jamais
 * confondre la valeur avec un argument positionnel.
 *
 * @param {string} line
 * @param {Object<string,string>} spec type attendu par option
 * @param {Object<string,string>} shortMap alias court -> nom long ({ n: 'limit' })
 */
function parse(line, spec = {}, shortMap = {}) {
  const tokens = tokenize(line);
  const args = [];
  const flags = {};
  let onlyPositional = false;

  const setFlag = (name, kind, value) => {
    if (kind === 'list' && Array.isArray(flags[name])) { flags[name] = flags[name].concat(value); return; }
    flags[name] = value;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const { value, quotedStart } = tokens[i];

    if (onlyPositional || quotedStart) { args.push(value); continue; }
    if (value === '--') { onlyPositional = true; continue; }

    const isLong = value.startsWith('--') && value.length > 2;
    const isShort = !isLong && value.startsWith('-') && value.length > 1 && !/^-\d/.test(value);
    if (!isLong && !isShort) { args.push(value); continue; }

    let name;
    let inline = null;

    if (isLong) {
      const body = value.slice(2);
      const eq = body.indexOf('=');
      name = eq === -1 ? body : body.slice(0, eq);
      inline = eq === -1 ? null : body.slice(eq + 1);
    } else {
      const body = value.slice(1);
      const eq = body.indexOf('=');
      const short = eq === -1 ? body : body.slice(0, eq);
      inline = eq === -1 ? null : body.slice(eq + 1);
      name = shortMap[short] || short;
    }

    // `--no-recursif` desactive explicitement une option booleenne.
    if (inline === null && name.startsWith('no-') && spec[name.slice(3)] === 'boolean') {
      flags[name.slice(3)] = false;
      continue;
    }

    const kind = spec[name] || (inline === null ? 'boolean' : 'string');

    if (inline !== null) { setFlag(name, kind, castValue(inline, kind, name)); continue; }
    if (kind === 'boolean') { flags[name] = true; continue; }

    const next = tokens[i + 1];
    if (!next || (!next.quotedStart && /^--?[A-Za-z]/.test(next.value))) {
      throw new Error(`L'option --${name} attend une valeur.`);
    }
    setFlag(name, kind, castValue(next.value, kind, name));
    i += 1;
  }

  return { args, flags };
}

/** Extrait le nom de commande sans analyser le reste (le reste depend du spec). */
function splitCommand(line) {
  const trimmed = String(line).trim();
  if (!trimmed) return { name: '', rest: '' };
  const tokens = tokenize(trimmed);
  const first = tokens[0] ? tokens[0].value : '';
  if (!first) return { name: '', rest: '' };
  const idx = trimmed.indexOf(first);
  const rest = idx === -1 ? '' : trimmed.slice(idx + first.length).trim();
  return { name: first, rest };
}

module.exports = { tokenize, parse, splitCommand };
