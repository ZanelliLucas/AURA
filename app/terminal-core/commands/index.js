'use strict';

/**
 * Commandes livrees d'origine.
 *
 * Pour en ajouter une : creez un module qui exporte un objet commande (ou un
 * tableau d'objets) et ajoutez-le ici. Pour en ajouter une depuis une autre
 * application sans toucher au coeur, utilisez `terminal.register(...)`.
 */
module.exports = [
  ...require('./util'),
  ...require('./files'),
  require('./find'),
  ...require('./system'),
  ...require('./shell'),
  ...require('./servers'),
  ...require('./access'),
  ...require('./desktop'),
  ...require('./services'),
  ...require('./clean'),
  ...require('./journal'),
  ...require('./health'),
  ...require('./devices'),
  ...require('./power'),
  ...require('./blackbox'),
  ...require('./selftest'),
  ...require('./watch'),
  ...require('./filters'),
  ...require('./variables'),
  ...require('./network')
];
