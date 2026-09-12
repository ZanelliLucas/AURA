'use strict';

/**
 * Valide les options de createTerminal et leve une erreur qui liste tous les
 * problemes a la fois, des la creation - plutot qu'une erreur obscure a la
 * premiere commande qui s'en sert.
 */
function validateOptions(options) {
  const problems = [];
  if (options.opener != null && typeof options.opener !== 'function') problems.push('opener doit etre une fonction.');
  if (options.storage != null
    && !(typeof options.storage.load === 'function' && typeof options.storage.save === 'function')) {
    problems.push('storage doit exposer load() et save().');
  }
  if (options.commands != null && !Array.isArray(options.commands)) problems.push('commands doit etre un tableau.');
  if (options.startup != null
    && !(typeof options.startup.get === 'function' && typeof options.startup.set === 'function')) {
    problems.push('startup doit exposer get() et set().');
  }
  if (options.blackbox != null
    && !['get', 'set', 'clear'].every((m) => typeof options.blackbox[m] === 'function')) {
    problems.push('blackbox doit exposer get(), set() et clear().');
  }
  if (options.selftest != null
    && !['info', 'notification', 'waitKey'].every((m) => typeof options.selftest[m] === 'function')) {
    problems.push('selftest doit exposer info(), notification() et waitKey().');
  }
  if (options.healthWatch != null
    && !(typeof options.healthWatch.get === 'function' && typeof options.healthWatch.set === 'function')) {
    problems.push('healthWatch doit exposer get() et set().');
  }
  if (options.console != null && typeof options.console.open !== 'function') {
    problems.push('console doit exposer open().');
  }
  if (problems.length) {
    throw new TypeError(`Options invalides :\n- ${problems.join('\n- ')}`);
  }
}

module.exports = { validateOptions };
