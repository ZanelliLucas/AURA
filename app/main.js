const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { startServer } = require('./server');

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

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Boite de dialogue native "Enregistrer sous" pour l'export d'image
// (AURA IMAGE LAB, §10.4 : l'original n'est jamais ecrase, l'export
// demande toujours un nouvel emplacement). Interaction OS directe, pas
// une action d'AURA CORE : IPC plutot que l'API HTTP locale.
ipcMain.handle('dialog:save-image', async (event, dataUrl) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter l’image améliorée',
    defaultPath: 'aura-image-amelioree.png',
    filters: [{ name: 'Image PNG', extensions: ['png'] }]
  });
  if (canceled || !filePath) return { saved: false };
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return { saved: true, filePath };
});

app.whenReady().then(async () => {
  try {
    apiServer = await startServer();
  } catch (err) {
    console.error('[server] echec du demarrage de l\'API locale :', err.message);
  }
  createWindow();
  checkForUpdates();
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
  app.quit();
});
