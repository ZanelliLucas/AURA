// AURA SECURITY (§5.8, §18.2). Volet defensif (audit, secrets, journal)
// sans restriction particuliere - toujours en lecture sur les projets
// configures localement. Le volet reconnaissance reseau (pentest_scan)
// reste strictement borne : cible locale par defaut, toute autre cible
// exige une confirmation explicite d'autorisation (systeme propre, CTF,
// ou bug bounty couvert par une autorisation ecrite - §18.2). Aucune
// fonction d'exploitation, de contournement ou d'automatisation de
// triche n'est implementee ici, conformement au perimetre du cahier des
// charges.
const core = require('./core');
const store = require('./store');
const sec = require('./connectors/security');

function projectPath() {
  const config = core.loadConfig();
  if (!config.devRepoPath) throw new Error('Aucun projet configuré (voir AURA CODE).');
  return config.devRepoPath;
}

// security.check_dependencies (§15, Lecture)
async function checkDependencies() {
  const dir = projectPath();
  try {
    const audit = await sec.npmAudit(dir);
    const summary = audit.metadata?.vulnerabilities || {};
    store.logAction({
      typeAction: 'security.check_dependencies', sensibilite: 'lecture', statut: 'execute',
      details: summary
    });
    return summary;
  } catch (err) {
    store.logAction({
      typeAction: 'security.check_dependencies', sensibilite: 'lecture', statut: 'echoue',
      details: { error: err.message }
    });
    throw new Error(`Audit des dépendances impossible : ${err.message}`);
  }
}

// security.audit_project (§15, Lecture) - detection de secrets exposes.
async function auditProject() {
  const dir = projectPath();
  const result = sec.scanSecrets(dir);
  store.logAction({
    typeAction: 'security.audit_project', sensibilite: 'lecture', statut: 'execute',
    details: { filesScanned: result.filesScanned, findings: result.findings.length }
  });
  return result;
}

// security.scan_logs (§15, Lecture) - anomalies dans le journal d'AURA
// lui-meme (echec repete d'un type d'action).
function scanLogs() {
  const journal = store.getJournal(500);
  const byType = {};
  journal.forEach((e) => {
    byType[e.typeAction] = byType[e.typeAction] || { total: 0, failed: 0 };
    byType[e.typeAction].total++;
    if (e.statut === 'echoue') byType[e.typeAction].failed++;
  });
  const suspicious = Object.entries(byType)
    .filter(([, v]) => v.total >= 3 && v.failed / v.total >= 0.5)
    .map(([typeAction, v]) => ({ typeAction, ...v, failureRatePercent: Math.round((v.failed / v.total) * 100) }));

  store.logAction({
    typeAction: 'security.scan_logs', sensibilite: 'lecture', statut: 'execute',
    details: { totalActions: journal.length, suspicious: suspicious.length }
  });
  return { totalActions: journal.length, suspicious };
}

const AUTHORIZED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

// security.pentest_scan (§15, §5.8, §18.2)
async function pentestScan({ host, authorized }) {
  const target = (host || '127.0.0.1').trim();
  if (!AUTHORIZED_HOSTS.has(target) && !authorized) {
    throw new Error('Cible externe : confirmation d’autorisation requise (système propre, CTF, ou bug bounty couvert par une autorisation écrite).');
  }
  const results = await sec.portScan(target);
  const open = results.filter((r) => r.open);
  store.logAction({
    typeAction: 'security.pentest_scan', sensibilite: 'sensible', statut: 'execute',
    details: { target, openPorts: open.map((r) => r.port) }
  });
  return { target, results };
}

module.exports = { checkDependencies, auditProject, scanLogs, pentestScan };
