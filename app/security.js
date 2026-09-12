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

// Motif personnalise (idee "motifs personnalises", §5) : un simple mot-cle
// litteral (jamais une regex fournie par l'utilisateur - RegExp construite
// a partir d'un mot echappe, pas d'une syntaxe libre, pour ecarter tout
// risque de ReDoS/injection) - suffisant pour reperer le nom d'une cle
// interne a l'organisation que la liste MOTIFS ci-dessus ne peut pas
// connaitre d'avance.
function echapperRegex(texte) {
  return texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validerMotifSecretPersonnalise(motif) {
  if (!motif || !motif.trim()) return 'Motif manquant.';
  const nettoye = motif.trim();
  if (nettoye.length < 4) return 'Motif trop court (4 caractères minimum).';
  if (nettoye.length > 100) return 'Motif trop long.';
  return null;
}

function estDossierExclu(nom, gitignore) {
  return DOSSIERS_EXCLUS.has(nom) || nom.startsWith('.') || gitignore.motifsExacts.has(nom);
}

function estFichierExclu(nom, gitignore) {
  if (gitignore.motifsExacts.has(nom)) return true;
  const ext = path.extname(nom).toLowerCase();
  return gitignore.motifsExtension.has(ext);
}

// Un fichier disparu des resultats parce qu'il tombe desormais sous une
// exclusion (idee "exclure"/.gitignore) n'a pas ete "resolu" au sens ou
// l'entend l'idee "comparaison" - il n'a simplement plus ete lu du tout.
// Reevalue chaque segment du chemin relatif (dossiers puis fichier) avec
// les memes fonctions que le parcours reel, sur les regles actuelles.
function estCheminExclu(fichierRelatif, gitignore) {
  const segments = fichierRelatif.split('/');
  for (let i = 0; i < segments.length - 1; i++) {
    if (estDossierExclu(segments[i], gitignore)) return true;
  }
  return estFichierExclu(segments[segments.length - 1], gitignore);
}

// Lit le .gitignore du dossier analyse (idee 4, retour utilisateur) pour
// exclure aussi ses propres dossiers/extensions de build - en plus des
// exclusions par defaut ci-dessus, pas a leur place (node_modules/.git
// restent exclus meme sans .gitignore). Ne gere qu'un sous-ensemble
// simple de la syntaxe gitignore (noms/extensions litteraux) : pas de
// negation (!motif), pas de motifs a chemin compose (a/b), pas de
// glob complexe - suffisant pour la grande majorite des projets reels
// (node_modules, dist, *.log, .env...), pas un parseur gitignore complet.
// Factorise hors de lireGitignore pour etre reutilisee par les
// exclusions personnalisees (idee "exclure", retour utilisateur) - meme
// syntaxe simple, fusionnee dans les memes Set.
function appliquerMotifs(lignes, motifsExacts, motifsExtension) {
  lignes.forEach((ligneBrute) => {
    const ligne = (ligneBrute || '').trim();
    if (!ligne || ligne.startsWith('#') || ligne.startsWith('!')) return;
    const nettoyee = ligne.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!nettoyee || nettoyee.includes('/')) return;
    if (nettoyee.startsWith('*.') && !nettoyee.slice(2).includes('*')) {
      motifsExtension.add(nettoyee.slice(1));
    } else if (!nettoyee.includes('*')) {
      motifsExacts.add(nettoyee);
    }
  });
}

function lireGitignore(racine) {
  const motifsExacts = new Set();
  const motifsExtension = new Set();
  try {
    const contenu = fs.readFileSync(path.join(racine, '.gitignore'), 'utf8');
    appliquerMotifs(contenu.split('\n'), motifsExacts, motifsExtension);
  } catch { /* pas de .gitignore, ou illisible - exclusions par defaut seulement */ }
  return { motifsExacts, motifsExtension };
}

// Longueur volontairement courte (nom de dossier/fichier ou *.ext, pas un
// chemin) - les chemins composes (a/b) sont deja rejetes silencieusement
// par appliquerMotifs, mais un message explicite ici evite qu'un motif
// tape par erreur disparaisse sans explication.
function validerMotifExclusion(motif) {
  if (!motif || !motif.trim()) return 'Motif manquant.';
  const nettoye = motif.trim();
  if (nettoye.length > 100) return 'Motif trop long.';
  if (nettoye.includes('/') || nettoye.includes('\\')) return 'Les chemins composés ne sont pas supportés (nom de dossier/fichier ou *.ext uniquement).';
  return null;
}

async function listerFichiers(racine, gitignore) {
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
        if (!estDossierExclu(entree.name, gitignore)) await parcourir(chemin);
      } else if (entree.isFile() && !estFichierExclu(entree.name, gitignore) && EXTENSIONS_TEXTE.has(path.extname(entree.name).toLowerCase())) {
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
  store.addRecentSecurityFolder(dossierCible);

  const gitignore = lireGitignore(dossierCible);
  // Exclusions personnalisees (idee "exclure", retour utilisateur) :
  // fusionnees dans les memes Set que le .gitignore - listerFichiers n'a
  // pas besoin de savoir d'ou vient chaque motif.
  appliquerMotifs(store.getCustomExclusions(dossierCible), gitignore.motifsExacts, gitignore.motifsExtension);
  const fichiers = await listerFichiers(dossierCible, gitignore);
  // Motifs personnalises (idee "motifs personnalises") : ajoutes a la
  // liste fixe, pas a sa place - la regex est reconstruite a chaque scan
  // (les Set/regex globales gardent un lastIndex, mieux vaut une instance
  // fraiche que de la reinitialiser manuellement comme pour MOTIFS).
  const motifsPerso = store.getCustomSecretMotifs(dossierCible).map((m) => ({
    nom: `Motif personnalisé : ${m}`,
    regex: new RegExp(echapperRegex(m), 'gi')
  }));
  const motifsActifs = [...MOTIFS, ...motifsPerso];
  // Faux positifs deja marques par l'utilisateur pour ce dossier (idee 1)
  // - filtres avant meme d'atteindre MAX_RESULTATS, pour qu'ils ne
  // prennent pas la place de vraies nouvelles trouvailles dans le plafond.
  const ignores = new Set(store.getIgnoredFindings(dossierCible));
  let ignoresAppliques = 0;
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
    // split/join : uniformise en '/' meme sur Windows (path.relative y
    // rend des '\\'), coherent avec le chemin du dossier lui-meme affiche
    // avec des '/' dans le champ de saisie.
    const fichierRelatif = path.relative(dossierCible, fichier).split(path.sep).join('/');
    const lignes = contenu.split('\n');
    for (let i = 0; i < lignes.length && resultats.length < MAX_RESULTATS; i++) {
      for (const motif of motifsActifs) {
        motif.regex.lastIndex = 0;
        const match = motif.regex.exec(lignes[i]);
        if (match) {
          if (ignores.has(`${fichierRelatif}::${i + 1}::${motif.nom}`)) {
            ignoresAppliques++;
          } else {
            resultats.push({
              fichier: fichierRelatif,
              ligne: i + 1,
              motif: motif.nom,
              extrait: redigerExtrait(lignes[i], match.index, match[0].length)
            });
          }
          break; // un seul motif signale par ligne suffit a alerter
        }
      }
    }
  }

  // Comparaison avec le scan precedent (idee "comparaison", retour
  // utilisateur) : cle composite identique a celle des ignores, jamais le
  // contenu du secret lui-meme. absent (premier scan de ce dossier) ->
  // pas de comparaison possible, tout serait artificiellement "nouveau".
  const clesActuelles = resultats.map((r) => `${r.fichier}::${r.ligne}::${r.motif}`);
  const clesPrecedentes = store.getLastScanResult('secrets', dossierCible);
  let nouveaux = 0;
  let resolus = 0;
  if (clesPrecedentes) {
    const precedentesSet = new Set(clesPrecedentes);
    const actuellesSet = new Set(clesActuelles);
    resultats.forEach((r, i) => { r.nouveau = !precedentesSet.has(clesActuelles[i]); });
    nouveaux = resultats.filter((r) => r.nouveau).length;
    // Ni un faux positif ignore (idee 1, decision explicite - deja compte
    // a part via ignoresAppliques) ni un chemin desormais exclu (idee
    // "exclure"/.gitignore, plus jamais lu) ne comptent comme "resolu" -
    // sans ca, ignorer/exclure un vrai secret afficherait a tort "resolu".
    resolus = clesPrecedentes.filter((c) => {
      if (actuellesSet.has(c)) return false;
      if (ignores.has(c)) return false;
      const [fichierAncien] = c.split('::');
      return !estCheminExclu(fichierAncien, gitignore);
    }).length;
  }
  store.setLastScanResult('secrets', dossierCible, clesActuelles);

  store.logAction({
    typeAction: 'security.scan_secrets', sensibilite: 'lecture', statut: 'execute',
    details: { dossier: dossierCible, fichiersAnalyses: fichiers.length, trouvailles: resultats.length }
  });
  return {
    fichiersAnalyses: fichiers.length, resultats, tronque: fichiers.length >= MAX_FICHIERS, ignoresAppliques,
    premierScan: !clesPrecedentes, nouveaux, resolus
  };
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
    store.addRecentSecurityFolder(dossierCible);
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
      // Faux positifs deja marques par l'utilisateur pour ce dossier (idee
      // "ignorer une dependance") - meme stockage que les secrets, prefixe
      // "dep::" (voir store.js#clearIgnoredFindings) pour ne jamais se
      // confondre avec une cle fichier::ligne::motif.
      const ignoresDeps = new Set(store.getIgnoredFindings(dossierCible).filter((c) => c.startsWith('dep::')));
      let ignoresAppliques = 0;
      const paquets = [];
      Object.values(rapport.vulnerabilities || {}).forEach((v) => {
        if (ignoresDeps.has(`dep::${v.name}::${v.severity}`)) { ignoresAppliques++; return; }
        // v.via melange des chaines (dependance transitive, sans detail
        // propre) et des objets (l'avis lui-meme, avec url/title) - on ne
        // cherche un lien que parmi ces derniers (idee "avis de securite").
        const avis = Array.isArray(v.via) ? v.via.find((x) => x && typeof x === 'object' && x.url) : null;
        paquets.push({
          nom: v.name,
          gravite: v.severity,
          correctif: v.fixAvailable && v.fixAvailable.name
            ? `${v.fixAvailable.name}@${v.fixAvailable.version}`
            : (v.fixAvailable === true ? 'npm audit fix' : null),
          // isSemVerMajor (idee "avertir avant une mise a jour majeure") :
          // npm le signale quand le correctif implique un saut de version
          // majeure - potentiellement incompatible avec le code existant,
          // contrairement a un correctif mineur/patch toujours sans risque
          // de rupture attendu.
          correctifMajeur: !!(v.fixAvailable && v.fixAvailable.isSemVerMajor),
          avisUrl: avis ? avis.url : null,
          avisTitre: avis ? avis.title : null
        });
      });

      // Comparaison avec l'audit precedent (idee "comparaison") - meme
      // principe que scanSecrets, cle nom::gravite (une remontee de
      // gravite sur le meme paquet compte comme une nouvelle alerte).
      // Un paquet ignore (faux positif) qui disparait des resultats n'est
      // pas "resolu" pour autant - meme logique que scanSecrets/estCheminExclu.
      const clesActuelles = paquets.map((p) => `${p.nom}::${p.gravite}`);
      const clesPrecedentes = store.getLastScanResult('deps', dossierCible);
      let nouveaux = 0;
      let resolus = 0;
      if (clesPrecedentes) {
        const precedentesSet = new Set(clesPrecedentes);
        const actuellesSet = new Set(clesActuelles);
        paquets.forEach((p, i) => { p.nouveau = !precedentesSet.has(clesActuelles[i]); });
        nouveaux = paquets.filter((p) => p.nouveau).length;
        resolus = clesPrecedentes.filter((c) => !actuellesSet.has(c) && !ignoresDeps.has(`dep::${c}`)).length;
      }
      store.setLastScanResult('deps', dossierCible, clesActuelles);

      store.logAction({
        typeAction: 'security.audit_deps', sensibilite: 'lecture', statut: 'execute',
        details: { dossier: dossierCible, total: vulnerabilites.total || 0, gravites: vulnerabilites }
      });
      resolve({ resume: vulnerabilites, paquets, ignoresAppliques, premierScan: !clesPrecedentes, nouveaux, resolus });
    });
  });
}

// Specification "paquet@version" telle que produite par nous-memes
// (fixAvailable.name/version de npm audit, jamais tapee librement par
// l'utilisateur) - validee quand meme avant execFile(shell:true) : ce
// endpoint est atteignable par tout process local capable de parler a
// l'API HTTP (127.0.0.1 seulement, mais sans authentification, comme le
// reste de l'app), et ici la valeur devient un argument de commande
// (pas juste un cwd comme pour l'audit) - un caractere shell (; | & ` )
// glisse dans un argument pourrait sinon executer autre chose que
// "npm install". N'accepte que lettres/chiffres/@/_/./~/- et / - le
// premier caractere accepte aussi '@' (paquets scopes, ex. @babel/core).
const REGEX_SPEC_PAQUET = /^[a-zA-Z0-9@][a-zA-Z0-9@/_.~-]*$/;

// security.fix_dependency (§5, idee 5) : Reversible (pas Lecture) - ca
// modifie reellement package.json/lockfile/node_modules du dossier
// analyse, contrairement au scan et a l'audit qui ne font qu'observer.
function corrigerDependance(dossierCible, correctif) {
  return new Promise((resolve, reject) => {
    if (!dossierCible || !correctif) {
      return reject(new Error('Paramètres manquants.'));
    }
    if (!REGEX_SPEC_PAQUET.test(correctif)) {
      store.logAction({
        typeAction: 'security.fix_dependency', sensibilite: 'reversible', statut: 'echoue',
        details: { dossier: dossierCible, error: 'Spécification de paquet invalide.' }
      });
      return reject(new Error('Spécification de paquet invalide.'));
    }
    execFile('npm', ['install', correctif], {
      cwd: dossierCible, shell: true, timeout: 60000, maxBuffer: 10 * 1024 * 1024
    }, (err, stdout, stderr) => {
      if (err) {
        const error = stderr ? stderr.trim().split('\n')[0] : err.message;
        store.logAction({
          typeAction: 'security.fix_dependency', sensibilite: 'reversible', statut: 'echoue',
          details: { dossier: dossierCible, correctif, error }
        });
        return reject(new Error(error));
      }
      store.logAction({
        typeAction: 'security.fix_dependency', sensibilite: 'reversible', statut: 'execute',
        details: { dossier: dossierCible, correctif }
      });
      resolve({ ok: true, correctif });
    });
  });
}

// Correctif generique (idee "correctif generique") : certaines
// vulnerabilites n'ont pas de "paquet@version" precis a proposer
// (fixAvailable === true sans nom/version, ex. correctif transitif) mais
// restent corrigeables via "npm audit fix" lui-meme - jusqu'ici affichees
// comme "correctif : npm audit fix" sans aucun bouton pour l'appliquer.
// Reversible (comme corrigerDependance), aucun argument utilisateur a
// valider (commande fixe, seul le cwd varie).
function corrigerAuditGenerique(dossierCible) {
  return new Promise((resolve, reject) => {
    if (!dossierCible || !dossierCible.trim()) {
      return reject(new Error('Dossier manquant.'));
    }
    execFile('npm', ['audit', 'fix'], {
      cwd: dossierCible, shell: true, timeout: 60000, maxBuffer: 10 * 1024 * 1024
    }, (err, stdout, stderr) => {
      // npm audit fix sort avec un code non-zero des qu'il reste des
      // vulnerabilites apres coup (typiquement celles necessitant --force,
      // qu'on ne veut surtout pas passer automatiquement ici) - meme piege
      // que npm audit --json dans auditerDependances ci-dessus : le code de
      // sortie seul ne dit pas si la commande a echoue. stdout non vide ->
      // npm a bien tourne et produit son rapport, meme partiel.
      if (err && !stdout) {
        const error = `npm audit fix indisponible (${err.code === 'ETIMEDOUT' ? 'délai dépassé' : (stderr || err.message).trim().split('\n')[0]})`;
        store.logAction({
          typeAction: 'security.fix_dependency', sensibilite: 'reversible', statut: 'echoue',
          details: { dossier: dossierCible, correctif: 'npm audit fix', error }
        });
        return reject(new Error(error));
      }
      store.logAction({
        typeAction: 'security.fix_dependency', sensibilite: 'reversible', statut: 'execute',
        details: { dossier: dossierCible, correctif: 'npm audit fix' }
      });
      resolve({ ok: true });
    });
  });
}

// Historique (idee 5) : reutilise le journal d'actions existant plutot
// qu'un stockage dedie - filtre juste les entrees security.* sur une
// fenetre plus large que les 20 dernieres entrees globales
// (store.getJournal, utilisees par le panneau Activite), pour ne pas
// se faire evincer par des actions d'autres pages entre deux analyses.
function getHistory() {
  return store.getJournal(200).filter((e) => e.typeAction.startsWith('security.'));
}

// Aperçu sur les dossiers recents (idee "apercu multi-dossiers") : combien
// de resultats le DERNIER scan de chaque dossier avait trouve, sans
// relancer aucune analyse - store.getLastScanResult ne stocke deja que les
// cles des resultats (voir scanSecrets/auditerDependances), leur nombre
// suffit ici. null (jamais scanne avec cet outil) distingue "pas de
// probleme connu" de "inconnu" - le rendu ne doit pas afficher "0" dans
// ce second cas comme s'il s'agissait d'un scan propre.
function getRecentFoldersResume() {
  return store.getRecentSecurityFolders().map((dossier) => {
    const secretsScan = store.getLastScanResult('secrets', dossier);
    const depsScan = store.getLastScanResult('deps', dossier);
    return {
      dossier,
      secrets: secretsScan ? secretsScan.length : null,
      deps: depsScan ? depsScan.length : null
    };
  });
}

// Exclusions personnalisees (idee "exclure") - purement du confort d'UI
// (comme les dossiers recents/faux positifs) : validees ici pour donner
// un message clair, jamais journalisees (n'analysent/modifient rien).
function ajouterExclusion(dossier, motif) {
  const error = validerMotifExclusion(motif);
  if (error) throw new Error(error);
  return store.addCustomExclusion(dossier, motif.trim());
}

// Faux positif cote dependances (idee "ignorer une dependance") - meme
// principe que ignoreFinding pour les secrets : purement du confort d'UI,
// pas journalise. Cle prefixee "dep::" (voir store.js#clearIgnoredFindings).
function ignoreDependency(dossier, nom, gravite) {
  return store.ignoreFinding(dossier, `dep::${nom}::${gravite}`);
}

// Motif de secret personnalise (idee "motifs personnalises") - meme
// principe que ajouterExclusion : validation ici, stockage dans store.js.
function ajouterMotifSecret(dossier, motif) {
  const error = validerMotifSecretPersonnalise(motif);
  if (error) throw new Error(error);
  return store.addCustomSecretMotif(dossier, motif.trim());
}

const MAX_COMMITS_HISTORIQUE = 200; // au-dela, un historique Git devient trop long a lire d'un coup (§ meme logique que MAX_FICHIERS)
const MAX_RESULTATS_HISTORIQUE = 100;

// Scan de l'historique Git (idee "scanner l'historique Git", §5) : le scan
// normal ne regarde que les fichiers presents aujourd'hui - un secret
// ajoute puis retire du code reste invisible pour toujours sans regarder
// aussi les commits passes. Reste une heuristique legere (comme scanSecrets
// ci-dessus, pas un remplacement de gitleaks) : uniquement les lignes
// AJOUTEES (diff -U0) des N derniers commits de la branche courante,
// jamais l'historique complet --all (couteux sur un gros depot).
function scannerHistoriqueGit(dossierCible) {
  return new Promise((resolve, reject) => {
    if (!dossierCible || !dossierCible.trim()) {
      return reject(new Error('Dossier manquant.'));
    }
    if (!fs.existsSync(path.join(dossierCible, '.git'))) {
      const error = 'Ce dossier n’est pas un dépôt Git (pas de dossier .git).';
      store.logAction({ typeAction: 'security.scan_git_history', sensibilite: 'lecture', statut: 'echoue', details: { error } });
      return reject(new Error(error));
    }
    // -U0 : aucune ligne de contexte, uniquement les lignes changees -
    // reduit fortement la taille de la sortie et les faux positifs venant
    // de lignes de contexte inchangees. execFile (pas exec) : le dossier
    // passe en cwd, jamais interpole dans une commande.
    execFile('git', ['log', '--no-color', '-p', '-U0', `--max-count=${MAX_COMMITS_HISTORIQUE}`], {
      cwd: dossierCible, shell: true, timeout: 30000, maxBuffer: 20 * 1024 * 1024
    }, (err, stdout) => {
      if (err && !stdout) {
        const error = `Lecture de l’historique Git impossible (${err.code === 'ETIMEDOUT' ? 'délai dépassé' : err.message}).`;
        store.logAction({ typeAction: 'security.scan_git_history', sensibilite: 'lecture', statut: 'echoue', details: { error } });
        return reject(new Error(error));
      }
      const gitignore = lireGitignore(dossierCible);
      appliquerMotifs(store.getCustomExclusions(dossierCible), gitignore.motifsExacts, gitignore.motifsExtension);
      const motifsPerso = store.getCustomSecretMotifs(dossierCible).map((m) => ({
        nom: `Motif personnalisé : ${m}`,
        regex: new RegExp(echapperRegex(m), 'gi')
      }));
      const motifsActifs = [...MOTIFS, ...motifsPerso];

      const resultats = [];
      const vus = new Set();
      let commitActuel = null;
      let messageActuel = '';
      let fichierActuel = null;
      const lignes = stdout.split('\n');
      for (let i = 0; i < lignes.length && resultats.length < MAX_RESULTATS_HISTORIQUE; i++) {
        const ligne = lignes[i];
        if (ligne.startsWith('commit ')) {
          commitActuel = ligne.slice(7, 14);
          messageActuel = '';
          fichierActuel = null;
          continue;
        }
        if (!messageActuel && commitActuel && ligne.startsWith('    ')) {
          messageActuel = ligne.trim();
          continue;
        }
        const matchDiff = /^diff --git a\/.+ b\/(.+)$/.exec(ligne);
        if (matchDiff) {
          fichierActuel = matchDiff[1];
          continue;
        }
        // +++ : en-tete de fichier du hunk, pas une ligne ajoutee - a
        // exclure explicitement (elle commence aussi par '+').
        if (!ligne.startsWith('+') || ligne.startsWith('+++')) continue;
        if (!fichierActuel || !commitActuel) continue;
        if (!EXTENSIONS_TEXTE.has(path.extname(fichierActuel).toLowerCase())) continue;
        if (estCheminExclu(fichierActuel, gitignore)) continue;
        const contenuLigne = ligne.slice(1);
        for (const motif of motifsActifs) {
          motif.regex.lastIndex = 0;
          const match = motif.regex.exec(contenuLigne);
          if (match) {
            const cle = `${commitActuel}::${fichierActuel}::${motif.nom}`;
            if (!vus.has(cle)) {
              vus.add(cle);
              resultats.push({
                commit: commitActuel, message: messageActuel, fichier: fichierActuel,
                motif: motif.nom, extrait: redigerExtrait(contenuLigne, match.index, match[0].length)
              });
            }
            break;
          }
        }
      }

      store.logAction({
        typeAction: 'security.scan_git_history', sensibilite: 'lecture', statut: 'execute',
        details: { dossier: dossierCible, resultats: resultats.length }
      });
      resolve({ resultats, tronque: resultats.length >= MAX_RESULTATS_HISTORIQUE });
    });
  });
}

module.exports = {
  scanSecrets,
  auditerDependances,
  corrigerDependance,
  corrigerAuditGenerique,
  scannerHistoriqueGit,
  getRecentFolders: () => store.getRecentSecurityFolders(),
  getRecentFoldersResume,
  ignoreFinding: (dossier, fichier, ligne, motif) => store.ignoreFinding(dossier, `${fichier}::${ligne}::${motif}`),
  clearIgnoredFindings: (dossier) => store.clearIgnoredFindings(dossier),
  ignoreDependency,
  clearIgnoredDependencies: (dossier) => store.clearIgnoredDependencies(dossier),
  getHistory,
  getExclusions: (dossier) => store.getCustomExclusions(dossier),
  addExclusion: ajouterExclusion,
  removeExclusion: (dossier, motif) => store.removeCustomExclusion(dossier, motif),
  getSecretMotifs: (dossier) => store.getCustomSecretMotifs(dossier),
  addSecretMotif: ajouterMotifSecret,
  removeSecretMotif: (dossier, motif) => store.removeCustomSecretMotif(dossier, motif)
};
