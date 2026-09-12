// AURA SECURITY (§5) - lecture seule (OBSERVE, §14.2) : analyse un dossier
// de projet local choisi par l'utilisateur (secrets en clair, dependances
// vulnerables). Ne modifie jamais les fichiers analyses. Ne fait pas de
// "pentest" (hors perimetre : ca vise des systemes tiers, pas le propre
// projet de l'utilisateur - un assistant personnel passif n'a rien a
// faire a scanner/exploiter des cibles externes).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const store = require('./store');

const DOSSIERS_EXCLUS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', 'vendor']);
const EXTENSIONS_TEXTE = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.env', '.yml', '.yaml', '.py', '.rb',
  '.php', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.cs', '.sh', '.ps1',
  '.txt', '.md', '.html', '.css', '.xml', '.ini', '.cfg', '.conf', '.toml'
]);
const TAILLE_MAX_FICHIER = 1024 * 1024; // 1 Mo - au-dela, tres probablement pas un fichier de code/config
const MAX_FICHIERS = 5000; // garde-fou si l'utilisateur pointe par erreur un dossier enorme
const MAX_RESULTATS = 200;

// Heuristiques courantes - pas exhaustif, un scanner de secrets attrape
// les cas evidents, il ne remplace pas un outil dedie (gitleaks, etc.).
const MOTIFS = [
  { nom: 'Clé AWS Access Key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { nom: 'Clé privée', regex: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { nom: 'Token GitHub', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { nom: 'Token Slack', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { nom: 'Clé API Google', regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { nom: 'Clé API Anthropic', regex: /\bsk-ant-[A-Za-z0-9\-_]{20,}\b/g },
  { nom: 'Clé API OpenAI', regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { nom: 'Jeton JWT', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  // ['"]? apres le nom du champ : couvre aussi bien un objet JS/YAML/.env
  // (password: '...') qu'une cle JSON entre guillemets ("secret_key": "...").
  { nom: 'Affectation générique de secret', regex: /\b(api[_-]?key|secret[_-]?key|access[_-]?token|password|passwd)['"]?\s*[:=]\s*['"][^'"\s]{8,}['"]/gi }
];

function estDossierExclu(nom) {
  return DOSSIERS_EXCLUS.has(nom) || nom.startsWith('.');
}

async function listerFichiers(racine) {
  const fichiers = [];
  async function parcourir(dossier) {
    if (fichiers.length >= MAX_FICHIERS) return;
    let entrees;
    try {
      entrees = await fs.promises.readdir(dossier, { withFileTypes: true });
    } catch {
      return; // dossier illisible (permissions) - ignore plutot que faire echouer tout le scan
    }
    for (const entree of entrees) {
      if (fichiers.length >= MAX_FICHIERS) return;
      if (entree.isSymbolicLink()) continue; // evite les boucles et les sorties du dossier choisi
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) {
        if (!estDossierExclu(entree.name)) await parcourir(chemin);
      } else if (entree.isFile() && EXTENSIONS_TEXTE.has(path.extname(entree.name).toLowerCase())) {
        fichiers.push(chemin);
      }
    }
  }
  await parcourir(racine);
  return fichiers;
}

// Ne journalise/affiche jamais le secret en clair - juste assez de
// contexte pour le localiser dans le fichier, le reste masque.
function redigerExtrait(ligne, indexMatch, longueurMatch) {
  const debut = Math.max(0, indexMatch - 10);
  const fin = Math.min(ligne.length, indexMatch + longueurMatch + 10);
  const avant = ligne.slice(debut, indexMatch);
  const apres = ligne.slice(indexMatch + longueurMatch, fin);
  return `${debut > 0 ? '…' : ''}${avant}[MASQUÉ]${apres}${fin < ligne.length ? '…' : ''}`;
}

async function scanSecrets(dossierCible) {
  if (!dossierCible || !dossierCible.trim()) {
    store.logAction({ typeAction: 'security.scan_secrets', sensibilite: 'lecture', statut: 'echoue', details: { error: 'Dossier manquant.' } });
    throw new Error('Dossier manquant.');
  }
  let stat;
  try {
    stat = await fs.promises.stat(dossierCible);
  } catch {
    store.logAction({ typeAction: 'security.scan_secrets', sensibilite: 'lecture', statut: 'echoue', details: { error: 'Dossier introuvable.' } });
    throw new Error('Dossier introuvable.');
  }
  if (!stat.isDirectory()) {
    store.logAction({ typeAction: 'security.scan_secrets', sensibilite: 'lecture', statut: 'echoue', details: { error: 'Le chemin indiqué n\'est pas un dossier.' } });
    throw new Error('Le chemin indiqué n\'est pas un dossier.');
  }

  const fichiers = await listerFichiers(dossierCible);
  const resultats = [];
  for (const fichier of fichiers) {
    if (resultats.length >= MAX_RESULTATS) break;
    let contenu;
    try {
      const infos = await fs.promises.stat(fichier);
      if (infos.size > TAILLE_MAX_FICHIER) continue;
      contenu = await fs.promises.readFile(fichier, 'utf8');
    } catch {
      continue; // fichier illisible/binaire malgre son extension - ignore
    }
    const lignes = contenu.split('\n');
    for (let i = 0; i < lignes.length && resultats.length < MAX_RESULTATS; i++) {
      for (const motif of MOTIFS) {
        motif.regex.lastIndex = 0;
        const match = motif.regex.exec(lignes[i]);
        if (match) {
          resultats.push({
            // split/join : uniformise en '/' meme sur Windows (path.relative
            // y rend des '\\'), coherent avec le chemin du dossier lui-meme
            // affiche avec des '/' dans le champ de saisie.
            fichier: path.relative(dossierCible, fichier).split(path.sep).join('/'),
            ligne: i + 1,
            motif: motif.nom,
            extrait: redigerExtrait(lignes[i], match.index, match[0].length)
          });
          break; // un seul motif signale par ligne suffit a alerter
        }
      }
    }
  }

  store.logAction({
    typeAction: 'security.scan_secrets', sensibilite: 'lecture', statut: 'execute',
    details: { dossier: dossierCible, fichiersAnalyses: fichiers.length, trouvailles: resultats.length }
  });
  return { fichiersAnalyses: fichiers.length, resultats, tronque: fichiers.length >= MAX_FICHIERS };
}

// npm audit --json sort avec un code de sortie non-zero des qu'il trouve
// au moins une vulnerabilite - ce n'est PAS un echec de l'outil, juste sa
// facon de signaler "des vulnerabilites existent" (utile en CI). Le JSON
// utile est toujours sur stdout : on tente de le parser avant de regarder
// le code de sortie, plutot que de rejeter des que err est non-null.
function auditerDependances(dossierCible) {
  return new Promise((resolve, reject) => {
    if (!dossierCible || !dossierCible.trim()) {
      store.logAction({ typeAction: 'security.audit_deps', sensibilite: 'lecture', statut: 'echoue', details: { error: 'Dossier manquant.' } });
      return reject(new Error('Dossier manquant.'));
    }
    if (!fs.existsSync(path.join(dossierCible, 'package.json'))) {
      const error = 'Aucun package.json trouvé dans ce dossier.';
      store.logAction({ typeAction: 'security.audit_deps', sensibilite: 'lecture', statut: 'echoue', details: { error } });
      return reject(new Error(error));
    }
    // execFile (jamais exec) : le dossier passe en cwd, jamais interpole
    // dans une chaine de commande - shell:true necessaire sur Windows
    // (npm est un .cmd, non executable directement) mais commande/args
    // ici sont des litteraux fixes, jamais derives de l'entree utilisateur.
    execFile('npm', ['audit', '--json'], {
      cwd: dossierCible, shell: true, timeout: 30000, maxBuffer: 10 * 1024 * 1024
    }, (err, stdout) => {
      let rapport;
      try {
        rapport = JSON.parse(stdout);
      } catch {
        const error = err ? `npm audit indisponible (${err.code === 'ETIMEDOUT' ? 'délai dépassé' : err.message})` : 'Réponse de npm audit illisible.';
        store.logAction({ typeAction: 'security.audit_deps', sensibilite: 'lecture', statut: 'echoue', details: { error } });
        return reject(new Error(error));
      }
      const vulnerabilites = (rapport.metadata && rapport.metadata.vulnerabilities) || {};
      const paquets = Object.values(rapport.vulnerabilities || {}).map((v) => ({
        nom: v.name,
        gravite: v.severity,
        correctif: v.fixAvailable && v.fixAvailable.name
          ? `${v.fixAvailable.name}@${v.fixAvailable.version}`
          : (v.fixAvailable === true ? 'npm audit fix' : null)
      }));
      store.logAction({
        typeAction: 'security.audit_deps', sensibilite: 'lecture', statut: 'execute',
        details: { dossier: dossierCible, total: vulnerabilites.total || 0, gravites: vulnerabilites }
      });
      resolve({ resume: vulnerabilites, paquets });
    });
  });
}

module.exports = { scanSecrets, auditerDependances };
