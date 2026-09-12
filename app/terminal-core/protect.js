'use strict';

/**
 * Garde-fou : le Terminal ne doit pas pouvoir se tuer lui-meme.
 *
 * `kill` sur son propre PID ou sur son nom (`kill electron`), ou
 * `stop --force` sur un port qu'il tient, fermeraient la fenetre au milieu
 * de la commande. Sont proteges le processus du Terminal et toute sa
 * descendance - fenetres, GPU, processus auxiliaires d'Electron. Font
 * exception les serveurs demarres par `start` et leurs enfants : ils
 * restent arretables.
 *
 * Les commandes `run` / `!` echappent a ce garde-fou : elles passent la
 * main au shell, ou le Terminal ne voit plus ce qui est vise. C'est pour
 * cela qu'elles exigent une confirmation.
 */

const { runJson, IS_WINDOWS } = require('./platform');

/** Table des processus : pid -> pid du parent. */
async function processTable() {
  if (!IS_WINDOWS) return null;
  const rows = await runJson('Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId', { timeout: 15000 });
  const table = new Map();
  for (const row of rows) table.set(Number(row.ProcessId), Number(row.ParentProcessId));
  return table;
}

/** Processus proteges a la racine : pid -> designation pour les messages. */
function protectedRoots() {
  return new Map([[process.pid, 'ce Terminal']]);
}

/**
 * Pourquoi `pid` ne doit pas etre arrete, ou null s'il peut l'etre.
 *
 * @param {number} pid
 * @param {Object} options
 * @param {Map<number,string>} options.roots     processus proteges
 * @param {Map<number,number>|null} options.table pid -> parent (null : racines seules)
 * @param {Set<number>} [options.serverPids]      serveurs demarres par `start`
 * @param {boolean} [options.tree]                l'arret visera toute l'arborescence de `pid`
 */
function protectionReason(pid, { roots, table, serverPids = new Set(), tree = false }) {
  if (roots.has(pid)) return `c'est ${roots.get(pid)}`;
  if (!table) return null;

  // Descendant d'une racine ? On remonte les parents jusqu'a en trouver une,
  // sauf si l'on croise d'abord un serveur lance par `start`.
  const seen = new Set();
  let current = pid;
  while (table.has(current) && !seen.has(current)) {
    seen.add(current);
    if (serverPids.has(current)) break;
    const parent = table.get(current);
    if (roots.has(parent)) return `c'est un processus appartenant a ${roots.get(parent)}`;
    current = parent;
  }

  // Un arret « avec les enfants » (taskkill /T) d'un ANCETRE d'une racine
  // l'emporterait aussi.
  if (tree) {
    for (const [root, label] of roots) {
      const visited = new Set();
      let up = table.get(root);
      while (up != null && !visited.has(up)) {
        visited.add(up);
        if (up === pid) return `l'arreter avec ses enfants arreterait aussi ${label}`;
        up = table.get(up);
      }
    }
  }
  return null;
}

/**
 * Parmi `pids`, ceux qu'il est interdit d'arreter depuis ce Terminal.
 * Sans table des processus (lecture impossible), seul le Terminal lui-meme
 * reste protege : le cas le plus grave reste couvert.
 *
 * @returns {Promise<Array<{pid:number, reason:string}>>}
 */
async function findProtected(ctx, pids, { tree = false } = {}) {
  const roots = protectedRoots();
  let table = null;
  try {
    table = await processTable();
  } catch {
    table = null;
  }
  const running = ctx.terminal && ctx.terminal.servers ? ctx.terminal.servers.running() : [];
  const serverPids = new Set(running.map((entry) => entry.pid));
  return pids
    .map((pid) => ({ pid, reason: protectionReason(pid, { roots, table, serverPids, tree }) }))
    .filter((entry) => entry.reason);
}

module.exports = { processTable, protectedRoots, protectionReason, findProtected };
