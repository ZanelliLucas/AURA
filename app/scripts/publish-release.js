#!/usr/bin/env node
'use strict';

// Publie une nouvelle release GitHub pour AURA : build electron-builder,
// puis publication manuelle des artefacts via `gh` plutot que le
// --publish integre d'electron-builder, qui cree des releases dupliquees
// en brouillon sur cette configuration (course entre l'upload de l'exe et
// celui du blockmap, chacun tentant de creer la release s'il ne la trouve
// pas encore - constate et documente le 07/09/2026).
//
// Usage :
//   npm run release            (echoue si la version courante est deja publiee)
//   npm run release -- --force (supprime puis recree la release existante)
//
// Prealable : `gh auth login` doit avoir ete fait une fois sur la machine.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(APP_DIR, 'dist');
const REPO = 'ZanelliLucas/AURA';

const force = process.argv.slice(2).includes('--force');

function quoteArg(arg) {
  // Avec shell:true sur Windows, Node concatene les arguments sans les
  // echapper (cf. DEP0190) : un argument contenant un espace serait
  // scinde en plusieurs arguments par cmd.exe si on ne le quote pas
  // nous-memes.
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function run(cmd, args) {
  const quoted = args.map(quoteArg);
  console.log(`\n> ${cmd} ${quoted.join(' ')}`);
  // shell:true est necessaire sur Windows pour resoudre les .cmd (npx, gh
  // installes via npm/winget n'exposent pas toujours un .exe direct).
  execFileSync(cmd, quoted, { stdio: 'inherit', cwd: APP_DIR, shell: true });
}

function runQuiet(cmd, args) {
  return execFileSync(cmd, args, { cwd: APP_DIR }).toString();
}

function releaseExists(tag) {
  try {
    execFileSync('gh', ['release', 'view', tag, '--repo', REPO], { stdio: 'ignore', cwd: APP_DIR, shell: true });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
  const version = pkg.version;
  const tag = `v${version}`;

  console.log(`=== Publication AURA ${tag} sur ${REPO} ===`);

  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore', cwd: APP_DIR, shell: true });
  } catch {
    console.error('\ngh n\'est pas authentifie sur cette machine. Lance `gh auth login` puis reessaie.');
    process.exit(1);
  }

  if (releaseExists(tag)) {
    if (!force) {
      console.error(`\nLa release ${tag} existe deja sur ${REPO}.`);
      console.error('Augmente "version" dans app/package.json avant de publier, ou relance avec --force pour ecraser celle-ci.');
      process.exit(1);
    }
    console.log(`\n--force : suppression de la release existante ${tag}...`);
    run('gh', ['release', 'delete', tag, '--repo', REPO, '--yes', '--cleanup-tag']);
  }

  console.log('\n--- Build electron-builder ---');
  run('npx', ['electron-builder']);

  const latestYmlPath = path.join(DIST_DIR, 'latest.yml');
  if (!fs.existsSync(latestYmlPath)) {
    console.error(`\nlatest.yml introuvable dans ${DIST_DIR} - le build a-t-il reussi ?`);
    process.exit(1);
  }

  const latestYml = fs.readFileSync(latestYmlPath, 'utf8');
  const pathMatch = latestYml.match(/^path:\s*(.+)$/m);
  if (!pathMatch) {
    console.error('\nImpossible de lire le champ "path" dans latest.yml.');
    process.exit(1);
  }

  // Nom attendu par electron-updater (tirets) vs nom reellement ecrit sur
  // disque par electron-builder (espaces, issu du productName) : on publie
  // une copie sous le nom attendu pour que la release et latest.yml
  // s'accordent.
  const expectedExeName = pathMatch[1].trim();
  const builtExePath = path.join(DIST_DIR, `AURA Setup ${version}.exe`);
  const builtBlockmapPath = `${builtExePath}.blockmap`;

  if (!fs.existsSync(builtExePath)) {
    console.error(`\nInstalleur introuvable : ${builtExePath}`);
    process.exit(1);
  }

  const publishExePath = path.join(DIST_DIR, expectedExeName);
  const publishBlockmapPath = path.join(DIST_DIR, `${expectedExeName}.blockmap`);
  fs.copyFileSync(builtExePath, publishExePath);
  fs.copyFileSync(builtBlockmapPath, publishBlockmapPath);

  // --notes (comme --title) passe en argument direct via shell:true peut
  // se faire mal decouper par cmd.exe selon son contenu ; un fichier evite
  // tout probleme de quoting.
  const notesPath = path.join(DIST_DIR, 'release-notes.txt');
  fs.writeFileSync(notesPath, `Release ${version}.\n`);

  console.log(`\n--- Publication de ${tag} ---`);
  run('gh', [
    'release', 'create', tag,
    publishExePath, publishBlockmapPath, latestYmlPath,
    '--repo', REPO,
    '--title', `AURA ${version}`,
    '--notes-file', notesPath
  ]);

  console.log(`\nOK : https://github.com/${REPO}/releases/tag/${tag}`);
}

main();
