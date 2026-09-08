// Connecteur AURA SECURITY (§5.8, §18.2). Volet defensif uniquement dans
// ce module (audit, secrets, journaux) + reconnaissance reseau non
// destructive (scan de ports TCP + banniere, jamais d'exploitation).
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

// security.check_dependencies : s'appuie sur `npm audit`, deja standard
// et sans danger - aucune reimplementation d'une base de vulnerabilites.
function npmAudit(projectPath) {
  return new Promise((resolve, reject) => {
    // shell:true necessaire : npm est un script .cmd sur Windows, pas un
    // executable direct (meme contrainte que npx, deja rencontree dans
    // scripts/publish-release.js).
    execFile('npm', ['audit', '--json'], {
      cwd: projectPath, maxBuffer: 20 * 1024 * 1024, shell: true
    }, (err, stdout) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(err ? err.message : 'Réponse npm audit illisible.'));
      }
    });
  });
}

// security.audit_project : detection de secrets accidentellement exposes.
// Motifs courants uniquement, jamais de tentative d'utiliser les secrets
// trouves - la correspondance est immediatement tronquee (redact()).
const SECRET_PATTERNS = [
  { name: 'Clé AWS', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'Clé privée', regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Clé Anthropic', regex: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'Token GitHub', regex: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: 'Clé/secret générique', regex: /(api[_-]?key|secret[_-]?key|access[_-]?token)["']?\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/gi }
];

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.cache']);
const MAX_FILE_SIZE = 2 * 1024 * 1024;

function redact(secret) {
  return secret.length <= 8 ? '***' : `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

function scanSecrets(projectPath, maxFiles = 3000) {
  const findings = [];
  let scanned = 0;

  function walk(dir) {
    if (scanned >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (scanned >= maxFiles) return;
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.size > MAX_FILE_SIZE) continue;
      scanned++;
      let content;
      try {
        content = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      SECRET_PATTERNS.forEach((p) => {
        const matches = content.match(p.regex);
        if (matches) {
          matches.forEach((m) => findings.push({
            file: path.relative(projectPath, full),
            pattern: p.name,
            preview: redact(m)
          }));
        }
      });
    }
  }

  walk(projectPath);
  return { filesScanned: scanned, findings };
}

// security.pentest_scan : reconnaissance non destructive uniquement -
// connexion TCP + lecture passive de banniere, jamais d'envoi de charge
// ni de tentative d'exploitation.
const COMMON_PORTS = [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 3306, 3389, 5432, 6379, 8080, 8443, 27017];

function scanPort(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let banner = '';
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ port, open, banner: banner ? banner.slice(0, 120) : null });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.once('data', (d) => { banner = d.toString('utf8', 0, Math.min(d.length, 200)); finish(true); });
      setTimeout(() => finish(true), 300);
    });
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function portScan(host, ports = COMMON_PORTS) {
  const results = [];
  for (const port of ports) {
    results.push(await scanPort(host, port));
  }
  return results;
}

module.exports = { npmAudit, scanSecrets, portScan, COMMON_PORTS };
