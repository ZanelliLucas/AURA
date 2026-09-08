// Connecteur Developpement (§6). git.push est "Irreversible" (§14.1) :
// la confirmation explicite est geree cote UI avant l'appel a cette API.
const core = require('./core');
const store = require('./store');
const git = require('./connectors/git');
const unity = require('./connectors/unity');

const DEV_FIELDS = ['devRepoPath', 'devUnityEditorPath', 'devUnityProjectPath'];

function getDevConfig() {
  const config = core.loadConfig();
  return {
    repoPath: config.devRepoPath || null,
    unityEditorPath: config.devUnityEditorPath || null,
    unityProjectPath: config.devUnityProjectPath || null
  };
}

function setDevField(key, value) {
  if (!DEV_FIELDS.includes(key)) throw new Error(`Champ inconnu : ${key}.`);
  const config = core.loadConfig();
  config[key] = value;
  core.saveConfig(config);
  return getDevConfig();
}

async function gitStatus() {
  const { repoPath } = getDevConfig();
  if (!repoPath) throw new Error('Chemin du dépôt non configuré.');
  try {
    const result = await git.status(repoPath);
    store.logAction({
      typeAction: 'git.status', sensibilite: 'lecture', statut: 'execute',
      details: { branch: result.branch, fileCount: result.files.length }
    });
    return result;
  } catch (err) {
    store.logAction({ typeAction: 'git.status', sensibilite: 'lecture', statut: 'echoue', details: { error: err.message } });
    throw err;
  }
}

async function gitCommit(message, files) {
  const { repoPath } = getDevConfig();
  if (!repoPath) throw new Error('Chemin du dépôt non configuré.');
  try {
    const result = await git.commit(repoPath, message, files);
    store.logAction({
      typeAction: 'git.commit', sensibilite: 'reversible', statut: 'execute',
      details: { hash: result.hash, message }
    });
    return result;
  } catch (err) {
    store.logAction({ typeAction: 'git.commit', sensibilite: 'reversible', statut: 'echoue', details: { error: err.message } });
    throw err;
  }
}

async function gitPush(remote, branch) {
  const { repoPath } = getDevConfig();
  if (!repoPath) throw new Error('Chemin du dépôt non configuré.');
  try {
    const result = await git.push(repoPath, remote, branch);
    store.logAction({
      typeAction: 'git.push', sensibilite: 'irreversible', statut: 'execute',
      details: { remote: remote || 'origin', branch: branch || null }
    });
    return result;
  } catch (err) {
    store.logAction({ typeAction: 'git.push', sensibilite: 'irreversible', statut: 'echoue', details: { error: err.message } });
    throw err;
  }
}

// unity.build (§6, Reversible)
async function unityBuildAction({ buildTarget, executeMethod, outputPath }) {
  const { unityEditorPath, unityProjectPath } = getDevConfig();
  if (!unityEditorPath || !unityProjectPath) throw new Error('Éditeur ou projet Unity non configuré.');
  try {
    const result = await unity.build({ editorPath: unityEditorPath, projectPath: unityProjectPath, buildTarget, executeMethod, outputPath });
    store.logAction({
      typeAction: 'unity.build', sensibilite: 'reversible', statut: 'execute',
      details: { buildTarget: buildTarget || null, outputPath: outputPath || null }
    });
    return result;
  } catch (err) {
    store.logAction({ typeAction: 'unity.build', sensibilite: 'reversible', statut: 'echoue', details: { error: err.message } });
    throw err;
  }
}

module.exports = { getDevConfig, setDevField, gitStatus, gitCommit, gitPush, unityBuildAction };
