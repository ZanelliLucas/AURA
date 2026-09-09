// Modele de la toile AURA, derive du cahier des charges V0.4
// (branches principales : Groupe B §5 + agents §5.6 ; branches secondaires :
// listes de capacites de chaque section ; liens transversaux : §5.6.1).

const NODES = [
  { id: 'voice', label: 'AURA VOICE', kind: 'core',
    tools: ['Wake word « AURA »', 'Speech-to-Text', 'Text-to-Speech', 'Mode mains libres'] },
  { id: 'vision', label: 'AURA VISION', kind: 'core',
    tools: ['Capture écran', 'OCR', 'Reconnaissance d’objets', 'Image Enhancer'] },
  { id: 'os', label: 'AURA OS', kind: 'core',
    tools: ['Lancer / fermer applications', 'Fichiers autorisés', 'Scripts & commandes', 'Navigation web autonome'] },
  { id: 'analytics', label: 'AURA ANALYTICS', kind: 'core',
    tools: ['Détection d’anomalies', 'Corrélations', 'Prévisions probabilistes'] },
  { id: 'systemMonitor', label: 'AURA SYSTEM MONITOR', kind: 'core',
    tools: ['CPU / GPU / RAM', 'Stockage & réseau', 'Alertes configurables'] },
  { id: 'autonomy', label: 'AURA AUTONOMY', kind: 'core',
    tools: ['Déclencheurs horaire / seuil', 'Tâches récurrentes', 'Mode simulation', 'Arrêt d’urgence'] },
  { id: 'world', label: 'AURA WORLD', kind: 'core',
    tools: ['Carte 2D mondiale', 'Zoom pays / ville', 'Statut des agents', 'Flux d’événements'] },

  { id: 'code', label: 'AURA CODE', kind: 'agent',
    tools: ['Revue & debug', 'Tests', 'Web / Mobile', 'Git', 'Analyse de code statique'] },
  { id: 'data', label: 'AURA DATA', kind: 'agent',
    tools: ['Statistiques', 'Visualisation', 'Nettoyage de données'] },
  { id: 'system', label: 'AURA SYSTEM', kind: 'agent',
    tools: ['Processus', 'Performances du poste'] },
  { id: 'security', label: 'AURA SECURITY', kind: 'agent',
    tools: ['Audit dépendances', 'Scan de secrets', 'Pentest encadré'] },
  { id: 'creative', label: 'AURA CREATIVE', kind: 'agent',
    tools: ['Design graphique', 'Génération d’images', 'Assets 3D'] },
  { id: 'research', label: 'AURA RESEARCH', kind: 'agent',
    tools: ['Recherche web', 'Synthèse d’articles', 'Vérification de faits'] },
  { id: 'home', label: 'AURA HOME', kind: 'agent',
    tools: ['Appareils connectés', 'Automatisations'] },
  { id: 'productivity', label: 'AURA PRODUCTIVITY', kind: 'agent',
    tools: ['Tâches', 'Rappels', 'Planification'] },
  { id: 'education', label: 'AURA EDUCATION', kind: 'agent',
    tools: ['Explications pédagogiques', 'Tutorat personnalisé', 'Traduction'] },
  { id: 'office', label: 'AURA OFFICE', kind: 'agent',
    tools: ['Word / Excel / PowerPoint', 'PDF', 'Tableurs & modèles'] }
];

// Liens transversaux reels entre agents (§5.6.1) - independants des
// branches vers le noeud central. C'est ce qui fait de la toile un vrai
// reseau maille plutot qu'une simple etoile (F-21).
const RELATIONS = [
  ['autonomy', 'systemMonitor'],
  ['autonomy', 'security'],
  ['autonomy', 'home'],
  ['analytics', 'data'],
  ['analytics', 'systemMonitor'],
  ['security', 'code'],
  ['security', 'system'],
  ['creative', 'vision'],
  ['research', 'office'],
  ['education', 'research']
];

window.AURA_GRAPH = { NODES, RELATIONS };
