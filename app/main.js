const { app, BrowserWindow, session, dialog, ipcMain, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { autoUpdater } = require('electron-updater');
const { startServer } = require('./server');
const autonomy = require('./autonomy');
const { createTerminal, fileStorage } = require('./terminal-core');

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

  // Copier un chemin (idee 3) : module clipboard d'Electron plutot que
  // navigator.clipboard cote renderer - setupPermissions() refuse sans
  // exception toute demande de permission, ce qui aurait bloque l'API web.
  ipcMain.handle('security:copy-to-clipboard', (event, texte) => {
    clipboard.writeText(texte || '');
    return { ok: true };
  });

  // Lien vers l'avis de securite d'une vulnerabilite (idee "avis") :
  // shell.openExternal plutot qu'un <a target="_blank"> ou window.open
  // cote renderer (sandboxe, sans navigateur systeme accessible) -
  // n'accepte que https:// (les avis npm/GitHub le sont toujours) pour
  // ecarter un protocole custom (file:, javascript:...) qui detournerait
  // l'ouverture vers autre chose qu'une page web.
  ipcMain.handle('security:open-external', (event, url) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) return { ok: false, error: 'URL invalide.' };
    shell.openExternal(url);
    return { ok: true };
  });
}

// AURA TERMINAL (§5, "j'ai fini de creer mon Terminal") : le moteur
// (app/terminal-core, copie de TERMINAL/core) ne connait ni Electron ni le
// DOM - il recoit une ligne de texte et rend des blocs de sortie
// structures (voir terminal-core/output.js), exactement comme l'a concu le
// projet TERMINAL d'origine pour etre reutilisable par une autre interface
// que la sienne. Vecu comme un pont, sur le meme principe que
// setupSecurityBridge : le moteur tourne ici (seul endroit avec acces au
// disque/systeme), le rendu reste dans le renderer sandboxe.
let terminal = null;

function getTerminal() {
  if (terminal) return terminal;
  terminal = createTerminal({
    cwd: os.homedir(),
    // Stockage propre a AURA (historique/alias/variables/serveurs) - pas
    // partage avec une installation independante de TERMINAL, pour ne
    // jamais faire ecrire deux processus differents dans le meme fichier.
    storage: fileStorage(path.join(app.getPath('userData'), 'terminal-session.json')),
    // `access` : Electron ouvre directement, sans passer par PowerShell -
    // meme opener que l'application TERMINAL d'origine.
    opener: async (target) => {
      if (/^https?:\/\//i.test(target)) {
        await shell.openExternal(target);
        return;
      }
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
    }
    // console/startup/blackbox/healthWatch/selftest volontairement omis
    // (v1) : sans eux, `run` bascule sur sa sortie texte non-interactive
    // (voir terminal-core/commands/shell.js) et `demarrage`/`essai`/
    // `sante suivi`/`boitenoire` renvoient une erreur claire plutot que de
    // planter - fonctionnalites a part entiere, pas des trous caches.
  });
  return terminal;
}

/** Executions en cours, pour pouvoir les interrompre depuis l'interface. */
const terminalRunning = new Map();

function setupTerminalBridge() {
  ipcMain.handle('terminal:boot', () => {
    const term = getTerminal();
    return {
      name: term.name,
      version: term.version,
      banner: term.banner(),
      cwd: term.session.cwd,
      display: term.session.promptLabel(),
      history: term.session.history
    };
  });

  // Diffuse les blocs au fil de l'eau (une recherche sur tout le disque
  // affiche sa progression) - meme principe que terminal:execute dans
  // l'application TERMINAL d'origine (app/main.js).
  ipcMain.handle('terminal:execute', async (event, { id, line } = {}) => {
    const term = getTerminal();
    const controller = new AbortController();
    terminalRunning.set(id, controller);
    try {
      let index = 0;
      const result = await term.execute(line, {
        signal: controller.signal,
        interactive: true,
        onBlock: (block) => {
          if (!event.sender.isDestroyed()) event.sender.send('terminal:block', { id, index: index++, block });
        }
      });
      return {
        ok: result.ok,
        durationMs: result.durationMs,
        command: result.command,
        offset: result.offset || 0,
        cwd: term.session.cwd,
        display: term.session.promptLabel(),
        blocks: result.blocks
      };
    } finally {
      terminalRunning.delete(id);
    }
  });

  ipcMain.on('terminal:abort', (event, id) => {
    const controller = terminalRunning.get(id);
    if (controller) controller.abort();
  });

  ipcMain.handle('terminal:confirmation', (event, line) => getTerminal().confirmation(String(line || '')));

  ipcMain.handle('terminal:complete', async (event, line) => {
    const completions = await getTerminal().complete(String(line || ''));
    return Array.isArray(completions) ? completions.slice(0, 200) : [];
  });

  // Confirmation native pour les commandes marquees "dangereuses" (rm,
  // kill, run...) - meme geste que l'application TERMINAL d'origine,
  // plutot qu'un confirm() web (bloquant le fil du renderer, et deja
  // indisponible dans un contexte sandboxe).
  ipcMain.handle('terminal:confirm', async (event, { title, message, detail } = {}) => {
    const resultat = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Annuler', 'Confirmer'],
      defaultId: 0,
      cancelId: 0,
      title: title || 'Confirmation',
      message: message || 'Confirmer cette action ?',
      detail: detail || ''
    });
    return resultat.response === 1;
  });

  // Chemin cliquable d'un bloc "path"/"table" (idee reprise de TERMINAL) -
  // ouvre l'explorateur, comme security:reveal-file.
  ipcMain.on('terminal:reveal', (event, target) => {
    if (typeof target === 'string' && target) shell.showItemInFolder(target);
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
  setupTerminalBridge();
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
  // Un serveur demarre par `start` (AURA TERMINAL) ne doit pas survivre a
  // la fenetre - meme regle que "exit" dans l'application TERMINAL
  // d'origine, sinon un `npm run dev` lance depuis le Terminal resterait
  // orphelin, port occupe.
  if (terminal) terminal.servers.stopAll();
  app.quit();
});
