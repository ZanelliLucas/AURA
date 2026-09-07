#!/usr/bin/env node
// Lanceur (F-12) : ouvre la fenetre applicative AURA depuis n'importe quel
// terminal, puis rend la main immediatement. Rien ne tourne avant cet appel
// (F-22) - ce script est le seul point d'entree.
const { spawn } = require('child_process');
const path = require('path');

const electronPath = require('electron');
const appPath = path.join(__dirname, '..');

const child = spawn(electronPath, [appPath], {
  detached: true,
  stdio: 'ignore',
  windowsHide: false
});
child.unref();
