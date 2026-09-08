// Hook electron-builder (afterPack). Deux corrections liees au meme
// probleme : "launched AURA" (lanceur personnel, F-12/F-22) laissait
// parfois Windows Terminal garder l'onglet ouvert au lieu de se
// refermer apres le lancement detache d'AURA.
//
// 1) Bascule le sous-systeme PE de aura.exe de CONSOLE (celui
//    d'Electron par defaut sur Windows, pense pour laisser voir
//    console.log quand lance depuis un terminal) vers WINDOWS. Sans ce
//    correctif, la sortie console d'AURA pouvait s'afficher dans le
//    terminal appelant au lieu de rester invisible.
// 2) Compile aura-launcher.exe (source : aura-launcher-src/AuraLauncher.cs)
//    - un lanceur natif minimal qui appelle CreateProcess avec
//    DETACHED_PROCESS + CREATE_BREAKAWAY_FROM_JOB. Compile une seule
//    fois ici plutot qu'a chaque invocation via Add-Type dans le
//    profil PowerShell : evite le cout (et la variabilite - antivirus
//    scannant un assembly fraichement compile en memoire) d'une
//    compilation a chaud a chaque lancement.
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function findUnderProgramFiles(predicate) {
  const roots = [
    'C:\\Program Files\\Microsoft Visual Studio',
    'C:\\Program Files (x86)\\Microsoft Visual Studio'
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const found = searchDir(root, 0, predicate);
    if (found) return found;
  }
  return null;
}

function searchDir(dir, depth, predicate) {
  if (depth > 12) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && predicate(full, entry.name)) return full;
    if (entry.isDirectory()) {
      const found = searchDir(full, depth + 1, predicate);
      if (found) return found;
    }
  }
  return null;
}

function findEditbin() {
  return findUnderProgramFiles((full, name) => name.toLowerCase() === 'editbin.exe' && full.toLowerCase().includes('hostx64\\x64'));
}

function findCsc() {
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function fixSubsystem(exePath) {
  const editbin = findEditbin();
  if (!editbin) {
    console.warn('[fix-exe-subsystem] editbin.exe introuvable (Visual Studio Build Tools requis) - sous-systeme CONSOLE conserve, risque de rattachement de console sous Windows 11.');
    return;
  }
  execFileSync(editbin, ['/subsystem:windows', exePath], { stdio: 'inherit' });
  console.log(`[fix-exe-subsystem] sous-systeme bascule en WINDOWS : ${exePath}`);
}

function buildLauncher(appOutDir) {
  const csc = findCsc();
  if (!csc) {
    console.warn('[fix-exe-subsystem] csc.exe introuvable (.NET Framework requis) - aura-launcher.exe non genere, launched AURA restera indisponible.');
    return;
  }
  const source = path.join(__dirname, '..', 'aura-launcher-src', 'AuraLauncher.cs');
  const output = path.join(appOutDir, 'aura-launcher.exe');
  execFileSync(csc, ['/nologo', '/target:winexe', `/out:${output}`, source], { stdio: 'inherit' });
  console.log(`[fix-exe-subsystem] aura-launcher.exe compile : ${output}`);
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  if (!fs.existsSync(exePath)) {
    console.warn(`[fix-exe-subsystem] executable introuvable, ignore : ${exePath}`);
    return;
  }

  fixSubsystem(exePath);
  buildLauncher(context.appOutDir);
};
