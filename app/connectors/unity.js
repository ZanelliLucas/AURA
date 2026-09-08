// Connecteur Developpement - Unity (§6). Necessite l'Editeur Unity
// installe et, pour produire un vrai binaire, une methode statique de
// build definie dans le projet (convention -executeMethod de Unity) ;
// sans elle, Unity ouvre/ferme simplement le projet en batch mode.
const { spawn } = require('child_process');

function build({ editorPath, projectPath, buildTarget, executeMethod, outputPath, timeoutMs = 10 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    const args = ['-batchmode', '-quit', '-nographics', '-projectPath', projectPath];
    if (buildTarget) args.push('-buildTarget', buildTarget);
    if (executeMethod) args.push('-executeMethod', executeMethod);
    if (outputPath) args.push('-buildOutput', outputPath);

    const child = spawn(editorPath, args);
    let stderr = '';
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Build Unity interrompu apres ${Math.round(timeoutMs / 1000)}s (timeout).`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ exitCode: code, log: stdout.slice(-4000) });
      } else {
        reject(new Error((stderr || stdout).slice(-2000) || `Unity a quitté avec le code ${code}.`));
      }
    });
  });
}

module.exports = { build };
