'use strict';

/**
 * Variables du Terminal : `set PROJET=~/Downloads/Projet`, puis `cd $PROJET`.
 * Partagees par tous les onglets, conservees d'une session a l'autre, et
 * transmises aux programmes lances par `run` (qui les lisent comme toute
 * variable d'environnement : `$env:PROJET` en PowerShell).
 */

const { unquoteWhole } = require('../chain');
const { VARIABLE_NAME } = require('../session');

const CATEGORY = 'Terminal';

const set = {
  name: 'set',
  aliases: ['definir'],
  category: CATEGORY,
  summary: 'Definit, affiche ou liste les variables ($NOM) du Terminal.',
  usage: 'set [NOM[=valeur]]   |   set NOM --supprimer',
  details: [
    'Une variable s\'utilise partout avec $NOM ou ${NOM} : cd $PROJET,',
    'grep $CLIENT --in $DOCS. Entre apostrophes, $ reste du texte (\'5$\').',
    'Les variables du systeme se lisent aussi, avec leur casse : $TEMP, $USERPROFILE.',
    '',
    'Elles valent pour tous les onglets, sont conservees d\'une session a',
    'l\'autre, et les programmes lances par run les recoivent (en PowerShell :',
    '$env:NOM). La variable EDITEUR choisit l\'editeur de `edit`.'
  ].join('\n'),
  // La valeur est prise telle quelle, espaces et tirets compris.
  passthrough: true,
  flags: { supprimer: 'boolean' },
  flagHelp: { supprimer: 'Supprimer la variable nommee.' },
  examples: ['set', 'set PROJET=~/Downloads/Projet', 'cd $PROJET', 'set EDITEUR=notepad', 'set PROJET --supprimer'],
  run(ctx) {
    const { session, out } = ctx;

    if (ctx.flags.supprimer) {
      const name = ctx.args[0];
      if (!name) throw new Error('Indiquez la variable a supprimer : set NOM --supprimer');
      if (!session.removeVariable(name)) throw new Error(`Variable inconnue : ${name}`);
      return out.success(`Variable supprimee : ${name}`);
    }

    const raw = ctx.raw.trim();
    if (!raw) {
      if (!session.variables.size) {
        return out.dim('Aucune variable. Exemple : set PROJET=~/Downloads/Projet, puis cd $PROJET');
      }
      return [
        out.kv([...session.variables.entries()].sort(([a], [b]) => a.localeCompare(b))),
        out.dim('Utilisables partout avec $NOM, et transmises aux programmes lances par run.')
      ];
    }

    const match = /^([^\s=]+)\s*(=)?\s*([\s\S]*)$/.exec(raw);
    const name = match[1];
    if (!VARIABLE_NAME.test(name)) {
      throw new Error(`Nom de variable invalide : ${name}. Lettres, chiffres et _, sans commencer par un chiffre.`);
    }
    const value = unquoteWhole(match[3].trim());

    if (!match[2] && !value) {
      const current = session.variable(name);
      if (current === undefined) throw new Error(`Variable inconnue : ${name}. Pour la definir : set ${name}=valeur`);
      return out.kv([[name, current]]);
    }
    if (!value) throw new Error(`Valeur vide. Pour supprimer la variable : set ${name} --supprimer`);

    session.setVariable(name, value);
    const blocks = [out.success(`${name} = ${value}`)];
    if (Object.keys(process.env).includes(name)) {
      blocks.push(out.dim(`Remplace la variable systeme ${name} pour le Terminal et les programmes qu'il lance.`));
    }
    return blocks;
  }
};

const unset = {
  name: 'unset',
  aliases: ['oublier'],
  category: CATEGORY,
  summary: 'Supprime une variable du Terminal.',
  usage: 'unset <NOM>',
  examples: ['unset PROJET'],
  run(ctx) {
    const [name] = ctx.args;
    if (!name) throw new Error('Indiquez la variable a supprimer. Exemple : unset PROJET');
    if (!ctx.session.removeVariable(name)) throw new Error(`Variable inconnue : ${name}`);
    return ctx.out.success(`Variable supprimee : ${name}`);
  }
};

module.exports = [set, unset];
