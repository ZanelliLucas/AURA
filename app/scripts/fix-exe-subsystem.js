// Hook electron-builder (afterPack) : bascule le sous-systeme PE de
// aura.exe de CONSOLE (celui d'Electron par defaut sur Windows, pense
// pour laisser voir console.log quand lance depuis un terminal) vers
// WINDOWS. Sans ce correctif, Windows peut rattacher la console d'AURA
// au terminal appelant (fonctionnalite "application de terminal par
// defaut" de Windows 11), meme quand le processus est cree avec
// l'indicateur DETACHED_PROCESS - le terminal semble se figer, avec la
// sortie console d'AURA affichee dedans, au lieu de se fermer. Un
// executable en sous-systeme WINDOWS ne demande jamais de console,
// quelle que soit la maniere dont il est lance (confirme en conditions
// reelles avant integration ici).
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function findEditbin() {
  const roots = [
    'C:\\Program Files\\Microsoft Visual Studio',
    'C:\\Program Files (x86)\\Microsoft Visual Studio'
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const found = searchEditbin(root, 0);
    if (found) return found;
  }
  return null;
}

function searchEditbin(dir, depth) {
  if (depth > 12) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === 'editbin.exe' && full.toLowerCase().includes('hostx64\\x64')) {
      return full;
    }
    if (entry.isDirectory()) {
      const found = searchEditbin(full, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  if (!fs.existsSync(exePath)) {
    console.warn(`[fix-exe-subsystem] executable introuvable, ignore : ${exePath}`);
    return;
  }

  const editbin = findEditbin();
  if (!editbin) {
    console.warn('[fix-exe-subsystem] editbin.exe introuvable (Visual Studio Build Tools requis) - sous-systeme CONSOLE conserve, risque de rattachement de console sous Windows 11.');
    return;
  }

  execFileSync(editbin, ['/subsystem:windows', exePath], { stdio: 'inherit' });
  console.log(`[fix-exe-subsystem] sous-systeme bascule en WINDOWS : ${exePath}`);
};
