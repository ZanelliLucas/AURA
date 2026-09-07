const { contextBridge } = require('electron');

// Point d'entree pour les futurs echanges renderer <-> AURA CORE
// (orchestrateur, connecteurs). Vide pour l'instant : l'ecran principal
// ne fait encore que du rendu statique.
contextBridge.exposeInMainWorld('aura', {
  version: '0.1.0'
});
