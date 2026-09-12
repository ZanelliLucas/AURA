const { app, BrowserWindow, session, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { startServer } = require('./server');
const autonomy = require('./autonomy');

// .env local de dev uniquement (cle API pour tester sans passer par
// l'ecran de configuration) - jamais inclus dans le build packagee, voir
// build.files dans package.json.
try {
  require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
} catch {
  // dotenv n'est present qu'en dev (devDependency) - absent en prod, sans consequence
}

let mainWindow = null;
let apiServer = null;

// F-12/F-22 : une seule fenetre applicative a la fois. Plusieurs
// instances concurrentes se disputent le meme dossier utilisateur (port
// HTTP local, cache GPU Chromium) - source de conflits visibles (echecs
// de creation du cache GPU) sans aucun benefice, AURA etant un
// assistant personnel mono-fenetre par nature. La seconde instance
// rend simplement la main a la premiere (focus) et se termine.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'AURA',
    backgroundColor: '#050505',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('console-message', (event) => {
    console.log(`[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Moteur de regles AURA AUTONOMY (§5.9). Intervalle court (bien plus fin
// que les declencheurs eux-memes, exprimes en minutes) pour rester
// reactif sans faire de veritable planification systeme - ne tourne que
// pendant la session (F-22).
let autonomyTickerInterval = null;

function startAutonomyTicker() {
  const tick = () => {
    autonomy.tick().catch((err) => console.log('[autonomy] tick echoue :', err.message));
  };
  tick();
  autonomyTickerInterval = setInterval(tick, 15000);
}

// Refus de toute demande de permission (camera/micro/notifications/etc.
// non utilisees par le contenu charge) - meme posture restrictive que
// le CSP et le serveur local borne a 127.0.0.1.
function setupPermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false);
  });
}

// AURA SECURITY (§5) : seul dialogue natif de l'app - le renderer est en
// sandbox/contextIsolation et ne peut pas l'ouvrir lui-meme (voir
// preload.js#chooseFolder). Choix explicite de l'utilisateur a chaque
// appel, jamais un chemin devine/memorise cote main.
function setupSecurityBridge() {
  ipcMain.handle('security:choose-folder', async () => {
    const resultat = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return resultat.canceled ? null : resultat.filePaths[0];
  });

  // Localiser un fichier trouve par le scan de secrets (idee 3, retour
  // utilisateur) - path.join ici (pas cote renderer, sandboxe, sans acces
  // a Node) pour recomposer le chemin absolu depuis le dossier scanne et
  // le chemin relatif du fichier. Verifie que le fichier existe avant
  // d'ouvrir l'explorateur - un chemin perime (fichier supprime/deplace
  // depuis le scan) ne doit pas echouer silencieusement dans le systeme
  // d'exploitation sans que l'utilisateur comprenne pourquoi.
  ipcMain.handle('security:reveal-file', (event, dossier, fichier) => {
    if (!dossier || !fichier) return { ok: false, error: 'Chemin manquant.' };
    const chemin = path.join(dossier, fichier);
    if (!fs.existsSync(chemin)) return { ok: false, error: 'Fichier introuvable (deplace ou supprime depuis l’analyse).' };
    shell.showItemInFolder(chemin);
    return { ok: true };
  });

  // Exporter le rapport (idee 4, retour utilisateur) : dialogue natif de
  // sauvegarde (meme raison que choose-folder - inaccessible depuis un
  // renderer sandboxe), l'utilisateur choisit lui-meme l'emplacement et
  // confirme via le dialogue de l'OS.
  ipcMain.handle('security:export-report', async (event, contenu) => {
    const resultat = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'aura-security-report.txt',
      filters: [{ name: 'Texte', extensions: ['txt'] }]
    });
    if (resultat.canceled) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(resultat.filePath, contenu, 'utf8');
      return { ok: true, path: resultat.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

app.whenReady().then(async () => {
  try {
    apiServer = await startServer();
  } catch (err) {
    console.error('[server] echec du demarrage de l\'API locale :', err.message);
  }
  setupPermissions();
  setupSecurityBridge();
  createWindow();
  checkForUpdates();
  startAutonomyTicker();
});

// Auto-update (electron-updater). Inactif tant qu'aucune source de
// publication reelle n'est configuree dans build.publish (package.json) :
// sans elle, checkForUpdatesAndNotify() echoue silencieusement (log only),
// sans jamais bloquer ni faire planter la fenetre.
function checkForUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.logger = console;
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.log('[auto-update] pas de source de mise a jour disponible :', err.message);
  });
}

// F-22 : la fenetre applicative est l'unique surface d'AURA. Quand elle se
// ferme, le processus se termine entierement - aucune icone ni tache de
// fond ne doit survivre a la session.
app.on('window-all-closed', () => {
  if (apiServer) apiServer.close();
  if (autonomyTickerInterval) clearInterval(autonomyTickerInterval);
  app.quit();
});
