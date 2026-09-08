// Connecteur Developpement - Git (§6).
const { execFile } = require('child_process');

function run(repoPath, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error((stderr || err.message).trim());
        reject(e);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// git.status (§6, Lecture)
async function status(repoPath) {
  // symbolic-ref fonctionne meme sur un depot sans aucun commit (HEAD ne
  // resout alors rien via rev-parse --abbrev-ref, qui echouerait).
  let branch;
  try {
    branch = (await run(repoPath, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim();
  } catch {
    branch = '(HEAD détaché ou aucun commit)';
  }
  const raw = (await run(repoPath, ['status', '--porcelain=v1'])).stdout;
  const files = raw.split('\n').filter(Boolean).map((line) => ({
    status: line.slice(0, 2).trim(),
    path: line.slice(3)
  }));
  return { branch, files, clean: files.length === 0 };
}

// git.commit (§6, Reversible)
async function commit(repoPath, message, files) {
  if (!message || !message.trim()) throw new Error('Message de commit manquant.');
  if (files && files.length) {
    await run(repoPath, ['add', '--', ...files]);
  } else {
    await run(repoPath, ['add', '-A']);
  }
  await run(repoPath, ['commit', '-m', message]);
  const hash = (await run(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
  return { hash, message };
}

// git.push (§6, Irreversible - confirmation geree cote UI avant l'appel)
// git ecrit sa progression/son resultat sur stderr meme en cas de succes.
async function push(repoPath, remote, branch) {
  const args = ['push', remote || 'origin'];
  if (branch) args.push(branch);
  const { stdout, stderr } = await run(repoPath, args);
  return { output: (stderr || stdout).trim() };
}

module.exports = { status, commit, push };
