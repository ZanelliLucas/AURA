const SVG_NS = 'http://www.w3.org/2000/svg';
const GRAPH_NODES = window.AURA_GRAPH.NODES;
const GRAPH_RELATIONS = window.AURA_GRAPH.RELATIONS;

const CENTER = { x: 800, y: 500 };
const R_PRINCIPAL = 260;
const R_TOOL = 95;
const VIEW_W = 1600;
const VIEW_H = 1000;

function seededOffset(seed, spread) {
  // Decalage deterministe (pas de vrai hasard) pour un trace organique
  // stable d'un lancement a l'autre, comme dans la maquette de reference.
  const s = Math.sin(seed * 999.7) * 10000;
  return (s - Math.floor(s) - 0.5) * 2 * spread;
}

function seededUnit(seed) {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

// Chemin lisse (Catmull-Rom -> Bezier) passant par une suite de points -
// contrairement a une seule courbe en S, un trace qui serpente vraiment
// (inflexions multiples, comme un tendon ou une riviere), a la maniere
// des references fournies.
function catmullRomPath(points) {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

// Branche organique (tendon serpentant) entre deux points : plusieurs
// points intermediaires ecartes de part et d'autre de l'axe direct, en
// alternance, pour un trace a inflexions multiples plutot qu'un simple
// arc - inspire des references fournies (dendrites/plexus, pas de rayons
// rectilignes ni de simples arcs en S).
function organicBranch(p0, p1, seed, waypointCount = 4) {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist;
  const ny = dx / dist;

  const points = [p0];
  for (let i = 1; i <= waypointCount; i++) {
    const t = i / (waypointCount + 1);
    const baseX = p0.x + dx * t;
    const baseY = p0.y + dy * t;
    const taper = Math.sin(t * Math.PI); // attenue pres des deux extremites
    const swing = seededUnit(seed + i * 5.13) < 0.5 ? -1 : 1;
    const wobble = (0.10 + seededUnit(seed + i * 3.7) * 0.16) * dist * taper * swing;
    points.push({ x: baseX + nx * wobble, y: baseY + ny * wobble });
  }
  points.push(p1);

  return { d: catmullRomPath(points), points };
}

// Insere une veritable boucle (pas seulement un balancement lateral) a
// hauteur d'un point intermediaire : quelques points supplementaires
// disposes en cercle, pour un tendon qui se nouerait sur lui-meme comme
// sur les references (le simple "wobble" ne peut jamais revenir en
// arriere sur l'axe direct, une boucle si).
function insertLoop(points, atIndex, seed, radius) {
  const center = points[atIndex];
  const startAngle = seededUnit(seed) * Math.PI * 2;
  const steps = 5;
  const loopPts = [];
  for (let i = 1; i <= steps; i++) {
    const a = startAngle + (i / steps) * Math.PI * 2;
    loopPts.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
  }
  return points.slice(0, atIndex + 1).concat(loopPts, points.slice(atIndex + 1));
}

// Ajoute une boucle sur une partie des branches seulement (toutes ne
// bouclent pas dans les references non plus) - decision deterministe
// par seed, pas aleatoire a chaque rendu.
function maybeAddLoop(branch, seed, dist) {
  if (seededUnit(seed + 811) > 0.55) return branch;
  const idx = 2 + Math.floor(seededUnit(seed + 233) * Math.max(branch.points.length - 4, 1));
  const radius = dist * (0.05 + seededUnit(seed + 611) * 0.05);
  const points = insertLoop(branch.points, idx, seed + 917, radius);
  return { d: catmullRomPath(points), points };
}

function branchSamplePoints(branch) {
  // Les points intermediaires (hub et noeud exclus) suffisent a tisser
  // le maillage - inutile de resampler la courbe elle-meme.
  return branch.points.slice(1, -1);
}

// Decoupe une branche en N segments qui se chevauchent d'un point, pour
// dessiner un halo qui s'amincit du hub vers l'agent (effet d'epaisseur
// degressive, sans passer par des formes remplies).
function branchSegments(points, count) {
  const spans = points.length - 1;
  const segments = [];
  for (let s = 0; s < count; s++) {
    const start = Math.floor((s / count) * spans);
    const end = Math.floor(((s + 1) / count) * spans);
    segments.push(points.slice(start, end + 1));
  }
  return segments;
}

// Second tendon, plus fin, qui serpente pres du principal sans le suivre
// exactement - effet de fibres torsadees (cable/vigne) plutot qu'un
// simple trait unique, comme dans les references. Meme nombre de points
// que la branche principale : les "barreaux" (buildCableRungs) relient
// les points de meme rang entre les deux.
function braidBranch(p0, p1, seed) {
  return organicBranch(p0, p1, seed + 503, 4);
}

// Troisieme tendon torsade, de l'autre cote du principal - un cable a
// trois brins plutot que deux traits paralleles, pour epaissir le
// tendon et se rapprocher du faisceau de fibres visible sur les
// references (les tendrils y sont clairement tisses de plusieurs fils).
function braidBranch2(p0, p1, seed) {
  return organicBranch(p0, p1, seed + 761, 4);
}

// Petits barreaux entre la branche principale et son fil torsade, sur
// le trace fin (pas les seuls points de controle, trop espaces) - une
// vraie texture de fibres croisees continue le long du tendon, comme
// le tressage visible sur toute la longueur des tendrilles des
// references, plutot que 3-4 barreaux isoles.
function buildCableRungs(branchPoints, braidPoints) {
  const group = el('g', { class: 'cable-rungs' });
  const fineA = sampleCurveFine(branchPoints, 5);
  const fineB = sampleCurveFine(braidPoints, 5);
  const count = Math.min(fineA.length, fineB.length);
  for (let i = 1; i < count - 1; i++) {
    const a = fineA[i];
    const b = fineB[i];
    group.appendChild(el('line', { x1: a.x.toFixed(1), y1: a.y.toFixed(1), x2: b.x.toFixed(1), y2: b.y.toFixed(1), class: 'cable-rung' }));
  }
  return group;
}

// Maillage entre points voisins issus de branches differentes : la
// membrane connective qui tisse les tendons entre eux, comme dans les
// references (texture de plexus dense plutot que des rayons isoles).
// Chaque point rejoint ses K plus proches voisins (pas un seul) pour une
// vraie densite de trame, avec un petit point lumineux a chaque noeud du
// maillage - certains scintillant comme des paquets de donnees actifs.
// Quelques points (ancrages) tissent bien plus de connexions que les
// autres : des noeuds de trame plus denses par endroits, comme les
// amas lumineux bien plus fournis que le reste du plexus dans la
// seconde reference, plutot qu'une densite uniforme partout.
function buildMeshFilaments(points) {
  const group = el('g', { class: 'mesh-filaments' });
  const nodeGroup = el('g', { class: 'mesh-nodes' });
  const MAX_DIST = 235;
  const K = 5;
  const K_ANCHOR = 9;
  const drawn = new Set();

  points.forEach((a, i) => {
    const isAnchor = seededUnit(i * 23.7 + 5) < 0.14;
    const distances = points
      .map((b, j) => ({ b, j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
      .filter((e) => e.j !== i && e.b.branch !== a.branch && e.d < MAX_DIST)
      .sort((e1, e2) => e1.d - e2.d)
      .slice(0, isAnchor ? K_ANCHOR : K);

    distances.forEach(({ b, j }) => {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (drawn.has(key)) return;
      drawn.add(key);
      group.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'mesh-filament' }));
    });

    const isFlare = isAnchor || seededUnit(i * 8.9 + 2) < 0.16;
    const dot = el('circle', {
      cx: a.x.toFixed(1), cy: a.y.toFixed(1), r: isFlare ? 1.6 : 0.9,
      class: isFlare ? 'mesh-node mesh-node-flare' : 'mesh-node'
    });
    if (isFlare) {
      dot.style.animationDelay = `${(seededUnit(i * 4.4) * 5).toFixed(2)}s`;
      dot.style.animationDuration = `${(2 + seededUnit(i * 6.6) * 2.5).toFixed(2)}s`;
    }
    nodeGroup.appendChild(dot);

    // Autour d'un ancrage, le noeud ne suffit pas a lire comme un amas
    // - un halo diffus par-dessus la trame le fait paraitre comme une
    // vraie zone plus dense/lumineuse, a la maniere des amas nettement
    // plus fournis (presque une tache laiteuse) de la seconde reference.
    if (isAnchor) {
      const blob = el('circle', {
        cx: a.x.toFixed(1), cy: a.y.toFixed(1), r: 16, class: 'mesh-cluster-glow'
      });
      nodeGroup.appendChild(blob);
    }
  });

  group.appendChild(nodeGroup);
  return group;
}

// Echantillonne finement la meme courbe que catmullRomPath (au lieu des
// seuls points de controle, trop espaces) pour pouvoir coller la
// poussiere de fond directement sur le trace reel du tendon, y compris
// dans ses boucles - jamais a plusieurs dizaines de pixels d'une ligne
// visible, comme la brume qui longe precisement les dendrites/le plexus
// des references.
function sampleCurveFine(points, perSegment = 7) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      const mt = 1 - t;
      const x = mt * mt * mt * p1.x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * p2.x;
      const y = mt * mt * mt * p1.y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * p2.y;
      out.push({ x, y });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

// Points fins + normale (perpendiculaire au trace a cet endroit), base
// pour disperser la poussiere de fond de part et d'autre d'une courbe.
function dustSource(points, perSegment = 7) {
  const fine = sampleCurveFine(points, perSegment);
  return fine.map((pt, i) => {
    const prev = fine[Math.max(i - 1, 0)];
    const next = fine[Math.min(i + 1, fine.length - 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: pt.x, y: pt.y, nx: -dy / len, ny: dx / len };
  });
}

// Champ de fond : poussiere stellaire, purement decorative, semee le
// long du trace reel des tendons (curveDust) plutot que pres de simples
// points de controle - chaque grain colle a quelques pixels d'une ligne
// visible, jamais flottant seul dans le vide du canevas.
function buildBackgroundField(curveDust) {
  const group = el('g', { class: 'bg-field' });

  curveDust.forEach((pt, i) => {
    if (seededUnit(i * 3.17 + 1) > 0.4) return;
    const nx = pt.nx || 0;
    const ny = pt.ny || 0;
    const side = seededUnit(i * 6.03) < 0.5 ? -1 : 1;
    const offset = (2.5 + seededUnit(i * 5.31) * 13) * side;
    const x = pt.x + nx * offset;
    const y = pt.y + ny * offset;
    const near = Math.abs(offset) < 8;
    const isHero = seededUnit(i * 14.6 + 3) < 0.035;

    const r = isHero ? 1.9 + seededUnit(i * 6.1) * 0.8 : (near ? 0.6 : 0.35) + seededUnit(i * 8.9 + 2) * 0.7;
    const star = el('circle', {
      cx: x.toFixed(1), cy: y.toFixed(1), r: r.toFixed(2),
      class: isHero ? 'bg-star bg-star-hero' : (near ? 'bg-star bg-star-near' : 'bg-star')
    });
    star.style.animationDelay = `${(seededUnit(i * 2.23) * 7).toFixed(2)}s`;
    star.style.animationDuration = `${(4 + seededUnit(i * 9.1) * 5).toFixed(2)}s`;
    group.appendChild(star);
  });

  return group;
}

function layout() {
  const positioned = {};
  const step = (Math.PI * 2) / GRAPH_NODES.length;

  GRAPH_NODES.forEach((node, i) => {
    const angle = i * step + seededOffset(i, 0.06);
    const radius = R_PRINCIPAL + seededOffset(i + 50, 24);
    const x = CENTER.x + Math.cos(angle) * radius;
    const y = CENTER.y + Math.sin(angle) * radius;
    positioned[node.id] = { ...node, x, y, angle };
  });

  GRAPH_NODES.forEach((node) => {
    const p = positioned[node.id];
    const toolSpread = 0.5;
    p.toolPositions = node.tools.map((label, i) => {
      const localAngle = p.angle + (i - (node.tools.length - 1) / 2) * (toolSpread / Math.max(node.tools.length - 1, 1));
      const radius = R_PRINCIPAL + R_TOOL + seededOffset(i * 7 + p.angle * 100, 18);
      return {
        label,
        x: CENTER.x + Math.cos(localAngle) * radius,
        y: CENTER.y + Math.sin(localAngle) * radius
      };
    });
  });

  return positioned;
}

function el(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

// Petite pastille lumineuse qui parcourt une branche en boucle, pour
// donner l'impression d'un flux de donnees circulant reellement dans
// le reseau plutot qu'un graphe statique. direction 'out' = hub -> agent
// (donnees envoyees), 'in' = agent -> hub (donnees remontees) : les deux
// tournent en meme temps sur chaque branche, comme un flux dans les deux
// sens plutot qu'un aller simple.
function addFlowPulse(svg, pathId, seed, kind, direction) {
  const isOut = direction === 'out';
  const dot = el('circle', {
    r: kind === 'core' ? 2.2 : 1.6,
    class: `branch-pulse branch-pulse-${kind} branch-pulse-${direction}`
  });
  const duration = (5.5 + seededUnit(seed) * 4.5).toFixed(2);
  const beginDelay = (seededUnit(seed + 71) * 6).toFixed(2);
  const anim = el('animateMotion', {
    dur: `${duration}s`, begin: `${beginDelay}s`, repeatCount: 'indefinite',
    keyPoints: isOut ? '0;1' : '1;0', keyTimes: '0;1', calcMode: 'linear'
  });
  const mpath = el('mpath', {});
  mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#${pathId}`);
  mpath.setAttribute('href', `#${pathId}`);
  anim.appendChild(mpath);
  dot.appendChild(anim);
  svg.appendChild(dot);
}

function render() {
  const svg = document.getElementById('web');
  svg.innerHTML = '';
  const positioned = layout();
  const nodeList = Object.values(positioned);

  // Branches organiques (tendons courbes) du hub vers chaque agent, et
  // points d'echantillonnage le long de chacune pour tisser le maillage.
  // Calcules avant le fond : la poussiere de fond s'aligne dessus.
  const branches = {};
  const samplePoints = [];
  const curveDust = [];
  nodeList.forEach((p, i) => {
    const seed = i * 13.7 + 5;
    const dist = Math.hypot(p.x - CENTER.x, p.y - CENTER.y);
    const base = organicBranch(CENTER, p, seed);
    const branch = maybeAddLoop(base, seed, dist);
    branch.basePoints = base.points;
    branch.braid = braidBranch(CENTER, p, seed);
    branch.braid2 = braidBranch2(CENTER, p, seed);
    branches[p.id] = branch;
    branchSamplePoints(branch).forEach((pt) => samplePoints.push({ ...pt, branch: p.id }));
    curveDust.push(...dustSource(branch.points), ...dustSource(branch.braid.points), ...dustSource(branch.braid2.points));
  });

  // Halo nebuleux derriere le hub - la masse lumineuse diffuse au coeur
  // du reseau, comme le coeur incandescent d'ou jaillissent les
  // tendrilles dans les references, plutot qu'un point net isole.
  const defs = el('defs', {});
  const gradient = el('radialGradient', { id: 'hub-core-gradient' });
  gradient.appendChild(el('stop', { offset: '0%', 'stop-color': 'rgba(165, 23, 6, 0.5)' }));
  gradient.appendChild(el('stop', { offset: '55%', 'stop-color': 'rgba(165, 23, 6, 0.16)' }));
  gradient.appendChild(el('stop', { offset: '100%', 'stop-color': 'rgba(165, 23, 6, 0)' }));
  defs.appendChild(gradient);
  svg.appendChild(defs);
  svg.appendChild(el('circle', { cx: CENTER.x, cy: CENTER.y, r: 150, class: 'hub-core-glow' }));

  svg.appendChild(buildBackgroundField(curveDust));
  svg.appendChild(buildMeshFilaments(samplePoints));

  // Liens transversaux reels entre agents (§5.6.1)
  const relationGroup = el('g', { class: 'relation-layer' });
  GRAPH_RELATIONS.forEach(([a, b]) => {
    const pa = positioned[a];
    const pb = positioned[b];
    if (!pa || !pb) return;
    const mx = (pa.x + pb.x) / 2 + (pa.y - pb.y) * 0.08;
    const my = (pa.y + pb.y) / 2 + (pb.x - pa.x) * 0.08;
    const path = el('path', {
      d: `M ${pa.x} ${pa.y} Q ${mx} ${my} ${pb.x} ${pb.y}`,
      class: 'link-relation',
      'data-a': a, 'data-b': b
    });
    relationGroup.appendChild(path);
  });
  svg.appendChild(relationGroup);

  // Branches principales : halo qui s'amincit du hub vers l'agent, un
  // second fil torsade plus fin, puis le trait net par-dessus.
  const glowGroup = el('g', { class: 'branch-glow-layer' });
  const braidGroup = el('g', { class: 'branch-braid-layer' });
  const rungGroup = el('g', { class: 'branch-rung-layer' });
  const trunkGroup = el('g', { class: 'branch-layer' });
  nodeList.forEach((p, i) => {
    const branch = branches[p.id];
    glowGroup.appendChild(el('path', { d: branch.d, class: 'link-glow link-glow-halo' }));
    branchSegments(branch.points, 3).forEach((seg, si) => {
      glowGroup.appendChild(el('path', { d: catmullRomPath(seg), class: `link-glow link-glow-${si}` }));
    });
    const braid = branch.braid;
    const braid2 = branch.braid2;
    braidGroup.appendChild(el('path', { d: braid.d, class: 'link-braid' }));
    braidGroup.appendChild(el('path', { d: braid2.d, class: 'link-braid' }));
    rungGroup.appendChild(buildCableRungs(branch.basePoints, braid.points));
    rungGroup.appendChild(buildCableRungs(branch.basePoints, braid2.points));
    // Trace invisible, uniquement support du flux (animateMotion exige
    // un seul <path> continu de bout en bout pour le mpath).
    trunkGroup.appendChild(el('path', { d: branch.d, id: `branch-${p.id}`, class: 'link-pulse-path' }));
    // Trait visible en 3 segments, plus epais pres du hub et plus fin
    // pres de l'agent : le corps du tendon lui-meme s'amincit, pas
    // seulement son halo, comme la silhouette fuselee des tendrilles
    // des references plutot qu'un simple fil d'epaisseur constante.
    branchSegments(branch.points, 3).forEach((seg, si) => {
      trunkGroup.appendChild(el('path', {
        d: catmullRomPath(seg), class: `link link-taper-${si}`, 'data-node': p.id
      }));
    });

    // Ganglions : quelques points plus gros et lumineux a meme la
    // branche (pas seulement dans le maillage), comme les renflements
    // visibles le long des tendons des references. Une partie d'entre
    // eux, plus rares, sont de veritables points chauds (plus gros,
    // pulsants) comme les eclats blancs intenses visibles sur les
    // tendrilles des references, pas seulement une lueur uniforme.
    branch.basePoints.slice(1, -1).forEach((pt, gi) => {
      if (seededUnit(i * 31 + gi * 7 + 61) > 0.45) return;
      const isHot = seededUnit(i * 17 + gi * 11 + 233) < 0.22;
      const ganglion = el('circle', {
        cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: isHot ? 3.4 : 2.2,
        class: isHot ? 'branch-ganglion branch-ganglion-hot' : 'branch-ganglion'
      });
      if (isHot) {
        ganglion.style.animationDelay = `${(seededUnit(i * 4.1 + gi) * 4).toFixed(2)}s`;
      }
      trunkGroup.appendChild(ganglion);
    });
  });
  svg.appendChild(glowGroup);
  svg.appendChild(rungGroup);
  svg.appendChild(braidGroup);
  svg.appendChild(trunkGroup);

  // Noeuds principaux + leurs outils
  nodeList.forEach((p) => {
    const group = el('g', { class: 'node-group', 'data-node': p.id });

    p.toolPositions.forEach((tool, ti) => {
      const twig = organicBranch(p, tool, p.angle * 400 + ti * 19 + 3, 2);
      group.appendChild(el('path', { d: twig.d, class: 'link-tool' }));
      group.appendChild(el('circle', { cx: tool.x, cy: tool.y, r: 3, class: 'node-tool' }));
      const label = el('text', { x: tool.x + 7, y: tool.y + 3, class: 'label label-tool' });
      label.textContent = tool.label;
      group.appendChild(label);
    });

    const circle = el('circle', {
      cx: p.x, cy: p.y, r: p.kind === 'core' ? 8 : 7,
      class: p.kind === 'core' ? 'node-core' : 'node-agent'
    });
    group.appendChild(circle);

    const dx = Math.cos(p.angle) >= 0 ? 12 : -12;
    const label = el('text', {
      x: p.x + dx, y: p.y + 4,
      class: 'label', 'text-anchor': Math.cos(p.angle) >= 0 ? 'start' : 'end'
    });
    label.textContent = p.label;
    group.appendChild(label);

    group.addEventListener('mouseenter', () => setActive(p.id, true));
    group.addEventListener('mouseleave', () => setActive(p.id, false));

    svg.appendChild(group);
  });

  // Flux lumineux le long des branches principales (§ "vivant et
  // dynamique" - un reseau qui respire, pas un graphe fige).
  const pulseGroup = el('g', { class: 'pulse-layer' });
  svg.appendChild(pulseGroup);
  nodeList.forEach((p, i) => {
    addFlowPulse(pulseGroup, `branch-${p.id}`, i * 3.3, p.kind, 'out');
    addFlowPulse(pulseGroup, `branch-${p.id}`, i * 3.3 + 97, p.kind, 'in');
  });

  // Hub central
  const hub = el('g', { class: 'node-group', 'data-node': '__hub' });
  hub.appendChild(el('circle', { cx: CENTER.x, cy: CENTER.y, r: 46, class: 'node-hub-ring' }));
  hub.appendChild(el('circle', { cx: CENTER.x, cy: CENTER.y, r: 46, class: 'node-hub' }));
  const hubLabel = el('text', {
    x: CENTER.x, y: CENTER.y + 5, class: 'label-hub', 'text-anchor': 'middle'
  });
  hubLabel.textContent = 'AURA';
  hub.appendChild(hubLabel);
  svg.appendChild(hub);
}

function setActive(nodeId, active) {
  document.querySelectorAll(`.link[data-node="${nodeId}"]`)
    .forEach((line) => line.classList.toggle('active', active));
  document.querySelectorAll(`.link-relation[data-a="${nodeId}"], .link-relation[data-b="${nodeId}"]`)
    .forEach((path) => path.classList.toggle('active', active));
}

function pulseRandomActivity() {
  if (document.body.classList.contains('estopped')) return;
  const candidates = GRAPH_NODES.map((n) => n.id);
  const id = candidates[Math.floor(Math.random() * candidates.length)];
  setActive(id, true);
  setTimeout(() => setActive(id, false), 900);
}

function startClock() {
  const clockEl = document.getElementById('clock');
  const tick = () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    clockEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}

function renderJournal(entries) {
  const list = document.getElementById('journal-list');
  if (!entries.length) {
    list.textContent = 'Aucune action enregistrée pour l’instant.';
    return;
  }
  list.innerHTML = '';
  entries.forEach((entry) => {
    const div = document.createElement('div');
    div.className = `journal-entry ${entry.statut}`;
    const time = new Date(entry.date).toLocaleTimeString('fr-FR');
    div.innerHTML = `<div class="journal-time">${time} · ${entry.statut}</div>${entry.typeAction}`;
    list.appendChild(div);
  });
}

async function loadJournal() {
  try {
    const entries = await window.aura.getJournal();
    renderJournal(entries);
  } catch {
    document.getElementById('journal-list').textContent = 'Journal indisponible.';
  }
}

const PROVIDER_LABELS = {
  google: 'Gemini (image/vidéo — bientôt)',
  anthropic: 'Claude (conversation & code)'
};

function toggleProviderForm(provider, container) {
  const existing = container.querySelector('.provider-key-form');
  if (existing) existing.remove();

  const form = document.createElement('form');
  form.className = 'provider-key-form';
  form.innerHTML = `<input type="password" placeholder="Clé ${PROVIDER_LABELS[provider]}" autocomplete="off"><button type="submit">OK</button>`;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input');
    const key = input.value.trim();
    if (!key) return;
    try {
      const status = await window.aura.setApiKey(provider, key);
      renderProviders(status.providers);
      journal(`CLE_API_MISE_A_JOUR : ${provider}`);
    } catch (err) {
      journal(`CLE_API_ECHEC : ${err.message}`);
    }
  });
  container.appendChild(form);
  form.querySelector('input').focus();
}

function renderProviders(providers) {
  const list = document.getElementById('provider-list');
  list.innerHTML = '';
  Object.entries(PROVIDER_LABELS).forEach(([id, label]) => {
    const configured = !!providers[id];
    const row = document.createElement('div');
    row.className = 'provider-row';
    row.innerHTML = `<span class="provider-dot ${configured ? 'ok' : ''}"></span><span class="provider-name">${label}</span><button type="button" class="provider-edit" data-provider="${id}">${configured ? 'changer' : 'ajouter'}</button>`;
    list.appendChild(row);
  });
  list.querySelectorAll('.provider-edit').forEach((btn) => {
    btn.addEventListener('click', () => toggleProviderForm(btn.dataset.provider, list));
  });
}

async function loadProviders() {
  try {
    const status = await window.aura.getStatus();
    renderProviders(status.providers);
  } catch {
    document.getElementById('provider-list').textContent = 'Statut indisponible.';
  }
}

function wirePanels() {
  document.getElementById('toggle-projects').addEventListener('click', () => {
    document.getElementById('panel-projects').classList.toggle('open');
  });
  document.getElementById('toggle-context').addEventListener('click', () => {
    const panel = document.getElementById('panel-context');
    const opening = panel.classList.toggle('open');
    if (opening) {
      loadJournal();
      loadProviders();
    }
  });

}

function journal(action) {
  // Trace minimale des decisions d'AURA (§5.9, §12.3 actions_log) en
  // attendant un vrai orchestrateur/backend a brancher ici.
  console.log(`[journal] ${new Date().toISOString()} ${action}`);
}

function wireEmergencyStop() {
  const btn = document.getElementById('estop');
  const label = document.getElementById('estop-label');
  const banner = document.getElementById('estop-banner');
  const input = document.getElementById('message');
  const send = document.getElementById('send');

  btn.addEventListener('click', async () => {
    const stopped = document.body.classList.toggle('estopped');

    banner.hidden = !stopped;
    label.textContent = stopped ? 'REPRENDRE' : 'ARRÊT D’URGENCE';
    input.disabled = stopped;
    send.disabled = stopped;

    if (stopped) {
      document.querySelectorAll('.link.active, .link-relation.active')
        .forEach((el) => el.classList.remove('active'));
      stopSpeaking('arret_urgence');
      stopVoiceListening('arret_urgence');
    }

    journal(stopped ? 'ARRET_URGENCE_ACTIVE : toile et conversation gelees' : 'ARRET_URGENCE_LEVE : reprise normale');

    // Meme bouton, meme etat : suspend aussi les regles AURA AUTONOMY
    // cote backend (§5.9) - une seule source de verite pour "arrete".
    try {
      await window.aura.setEstop(stopped);
      updateAutonomyEstopStatus(stopped);
    } catch { /* backend indisponible, l'UI reste geree localement */ }
  });
}

function updateAutonomyEstopStatus(active) {
  const el = document.getElementById('autonomy-estop-status');
  if (!el) return;
  el.textContent = active ? 'Arrêt d’urgence : ACTIF — règles suspendues' : 'Arrêt d’urgence : inactif';
  el.classList.toggle('estop-active', !!active);
}

function addMessage(role, text) {
  const thread = document.getElementById('thread');
  const bubble = document.createElement('div');
  bubble.className = `msg msg-${role}`;
  bubble.textContent = text;
  thread.appendChild(bubble);
  thread.scrollTop = thread.scrollHeight;
  return bubble;
}

function addPendingMessage() {
  const thread = document.getElementById('thread');
  const bubble = document.createElement('div');
  bubble.className = 'msg msg-aura msg-pending';
  bubble.innerHTML = 'AURA réfléchit<span class="dots"></span>';
  thread.appendChild(bubble);
  thread.scrollTop = thread.scrollHeight;
  return bubble;
}

function wireConversation() {
  const form = document.getElementById('conversation');
  const input = document.getElementById('message');
  const send = document.getElementById('send');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (document.body.classList.contains('estopped')) return;
    const text = input.value.trim();
    if (!text) return;

    setActive('__hub', true);
    input.value = '';
    input.disabled = true;
    send.disabled = true;

    addMessage('user', text);
    const pending = addPendingMessage();

    try {
      const result = await window.aura.sendMessage(text);
      pending.remove();
      addMessage('aura', result.text);
      journal(`MESSAGE_ECHANGE : "${text.slice(0, 60)}"`);
    } catch (err) {
      pending.remove();
      addMessage('error', `AURA ne peut pas répondre : ${err.message}`);
      journal(`MESSAGE_ECHEC : ${err.message}`);
    } finally {
      setActive('__hub', false);
      input.disabled = false;
      send.disabled = false;
      input.focus();
    }
  });
}

async function initConversation() {
  const setupForm = document.getElementById('setup-key');
  const conversationForm = document.getElementById('conversation');
  const apiKeyInput = document.getElementById('api-key');

  const showConversation = () => {
    setupForm.hidden = true;
    conversationForm.hidden = false;
    document.getElementById('message').focus();
  };
  const showSetup = () => {
    setupForm.hidden = false;
    conversationForm.hidden = true;
    apiKeyInput.focus();
  };

  wireConversation();

  setupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = apiKeyInput.value.trim();
    if (!key) return;
    try {
      await window.aura.setApiKey('anthropic', key);
      apiKeyInput.value = '';
      showConversation();
      addMessage('aura', 'Clé API enregistrée. Je t’écoute.');
    } catch (err) {
      addMessage('error', `Impossible d’enregistrer la clé : ${err.message}`);
    }
  });

  try {
    const status = await window.aura.getStatus();
    if (status.configured) {
      showConversation();
    } else {
      showSetup();
    }
  } catch {
    showSetup();
  }
}

// --- Ecrans internes (§16.2 a §16.5) ---------------------------------
// Toutes les vues vivent dans la meme fenetre applicative, jamais une
// page ou fenetre separee (§13.2). showScreen(null) revient a la toile.

function showScreen(name) {
  document.querySelectorAll('.app-screen').forEach((el) => {
    el.hidden = el.id !== `screen-${name}`;
  });
  document.getElementById('panel-projects').classList.remove('open');
  if (name !== 'sysmon') stopSysmonPolling();
  if (name === 'memory') loadMemoryScreen();
  if (name === 'gaming') loadGamingScreen();
  if (name === 'dev') loadDevScreen();
  if (name === 'comm') loadCommScreen();
  if (name === 'sysmon') startSysmonPolling();
  if (name === 'analytics') loadAnalyticsScreen();
  if (name === 'autonomy') loadAutonomyScreen();
  if (name === 'voice') loadVoiceScreen();
  if (name === 'education') loadEducationScreen();
  if (name === 'office') resetOfficeScreen();
  if (name === 'world') {
    initWorldMap();
    setTimeout(() => worldMap && worldMap.invalidateSize(), 0);
  }
}

function closeScreen() {
  document.querySelectorAll('.app-screen').forEach((el) => { el.hidden = true; });
  stopSysmonPolling();
}

function wireScreens() {
  document.querySelectorAll('.module-link').forEach((btn) => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });
  document.querySelectorAll('[data-close-screen]').forEach((btn) => {
    btn.addEventListener('click', closeScreen);
  });
}

function renderMemoryPrefs(prefs) {
  const list = document.getElementById('memory-prefs-list');
  const keys = Object.keys(prefs);
  if (!keys.length) {
    list.textContent = 'Aucune préférence mémorisée.';
    return;
  }
  list.innerHTML = '';
  keys.forEach((key) => {
    const { value, updatedAt } = prefs[key];
    const row = document.createElement('div');
    row.className = 'pref-row';
    row.innerHTML = `
      <div class="pref-key">${key}</div>
      <input class="pref-value" type="text" value="${String(value).replace(/"/g, '&quot;')}">
      <span class="pref-updated">${new Date(updatedAt).toLocaleDateString('fr-FR')}</span>
      <button type="button" class="pref-save" title="Enregistrer">✓</button>
      <button type="button" class="pref-delete" title="Supprimer">✕</button>
    `;
    row.querySelector('.pref-save').addEventListener('click', async () => {
      const newValue = row.querySelector('.pref-value').value;
      await window.aura.setPreference(key, newValue);
      journal(`PREFERENCE_MODIFIEE : ${key}`);
      loadMemoryScreen();
    });
    row.querySelector('.pref-delete').addEventListener('click', async () => {
      await window.aura.deletePreference(key);
      journal(`PREFERENCE_SUPPRIMEE : ${key}`);
      loadMemoryScreen();
    });
    list.appendChild(row);
  });
}

async function loadMemoryScreen() {
  try {
    const prefs = await window.aura.getPreferences();
    renderMemoryPrefs(prefs);
  } catch {
    document.getElementById('memory-prefs-list').textContent = 'Préférences indisponibles.';
  }
}

function wireMemoryScreen() {
  document.getElementById('memory-clear-all').addEventListener('click', async () => {
    if (!confirm('Effacer toutes les préférences mémorisées par AURA ? Cette action est irréversible.')) return;
    try {
      await window.aura.clearMemory();
      journal('MEMOIRE_EFFACEE : préférences remises à zéro');
      loadMemoryScreen();
    } catch (err) {
      journal(`MEMOIRE_EFFACEE_ECHEC : ${err.message}`);
    }
  });
}

// --- AURA WORLD (§9, §16.4) -------------------------------------------
// Carte 2D uniquement (F-18), vue mondiale par defaut (F-19), zoom vers
// un lieu sur demande explicite (F-15) via la geocodification Nominatim
// (service public OpenStreetMap, aucune cle requise). Initialisee au
// premier affichage de l'ecran seulement (pas de chargement de tuiles
// tant que l'utilisateur n'a pas ouvert la carte).
let worldMap = null;

function initWorldMap() {
  if (worldMap) return;

  worldMap = L.map('world-map', {
    center: [20, 0],
    zoom: 2,
    minZoom: 2,
    maxZoom: 18,
    worldCopyJump: true
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(worldMap);
}

async function worldSearch(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
  if (!res.ok) throw new Error(`Service de recherche indisponible (${res.status}).`);
  const results = await res.json();
  if (!results.length) throw new Error('Lieu introuvable.');
  const { lat, lon, display_name } = results[0];
  worldMap.flyTo([parseFloat(lat), parseFloat(lon)], 10, { duration: 1.2 });
  return display_name;
}

function wireWorldMap() {
  document.getElementById('world-search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('world-search-input');
    const query = input.value.trim();
    if (!query) return;
    try {
      const name = await worldSearch(query);
      journal(`CARTE_ZOOM : ${name}`);
    } catch (err) {
      journal(`CARTE_ZOOM_ECHEC : ${err.message}`);
    }
  });
}

// --- AURA Image Lab (§10, §16.5) --------------------------------------
// Traitement local (Canvas 2D), aucune IA requise pour ces fonctions de
// base : agrandissement (reechantillonnage, pas de super-resolution IA),
// nettete, reduction de bruit, lumiere/couleur. L'original n'est jamais
// ecrase (§10.4) - le fichier source n'est jamais reouvert en ecriture,
// l'export demande toujours un nouvel emplacement.

const IL_MAX_DIM = 1400;
const IL_IDENTITY_KERNEL = [0, 0, 0, 0, 1, 0, 0, 0, 0];
const IL_SHARPEN_KERNEL = [0, -1, 0, -1, 5, -1, 0, -1, 0];
const IL_BLUR_KERNEL = [1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9];

let ilBaseCanvas = null;

function ilClamp(v) { return Math.max(0, Math.min(255, v)); }

function ilLerpKernel(from, to, t) {
  return from.map((v, i) => v + (to[i] - v) * t);
}

function ilConvolve3x3(imageData, kernel) {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, k = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const sx = Math.min(width - 1, Math.max(0, x + kx));
          const sy = Math.min(height - 1, Math.max(0, y + ky));
          const idx = (sy * width + sx) * 4;
          const kv = kernel[k++];
          r += src[idx] * kv; g += src[idx + 1] * kv; b += src[idx + 2] * kv;
        }
      }
      const idx = (y * width + x) * 4;
      data[idx] = ilClamp(r); data[idx + 1] = ilClamp(g); data[idx + 2] = ilClamp(b);
    }
  }
  return imageData;
}

function ilAdjustColor(imageData, brightness, contrast, saturation) {
  const data = imageData.data;
  const cf = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const sf = 1 + saturation / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] + brightness, g = data[i + 1] + brightness, b = data[i + 2] + brightness;
    r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * sf; g = gray + (g - gray) * sf; b = gray + (b - gray) * sf;
    data[i] = ilClamp(r); data[i + 1] = ilClamp(g); data[i + 2] = ilClamp(b);
  }
  return imageData;
}

function ilGetControls() {
  return {
    scale: Number(document.getElementById('ctl-scale').value),
    sharpen: Number(document.getElementById('ctl-sharpen').value),
    denoise: Number(document.getElementById('ctl-denoise').value),
    brightness: Number(document.getElementById('ctl-brightness').value),
    contrast: Number(document.getElementById('ctl-contrast').value),
    saturation: Number(document.getElementById('ctl-saturation').value)
  };
}

function ilSyncLabels() {
  const ctl = ilGetControls();
  document.getElementById('val-scale').textContent = `${ctl.scale} %`;
  document.getElementById('val-sharpen').textContent = ctl.sharpen;
  document.getElementById('val-denoise').textContent = ctl.denoise;
  document.getElementById('val-brightness').textContent = ctl.brightness;
  document.getElementById('val-contrast').textContent = ctl.contrast;
  document.getElementById('val-saturation').textContent = ctl.saturation;
}

function ilSetImage(img) {
  let w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.min(1, IL_MAX_DIM / Math.max(w, h));
  w = Math.round(w * scale); h = Math.round(h * scale);

  ilBaseCanvas = document.createElement('canvas');
  ilBaseCanvas.width = w;
  ilBaseCanvas.height = h;
  ilBaseCanvas.getContext('2d').drawImage(img, 0, 0, w, h);

  const original = document.getElementById('imagelab-canvas-original');
  original.width = w;
  original.height = h;
  original.getContext('2d').drawImage(ilBaseCanvas, 0, 0);

  document.getElementById('imagelab-empty').hidden = true;
  document.getElementById('imagelab-workspace').hidden = false;
  document.getElementById('imagelab-status').textContent = '';

  ['ctl-scale', 'ctl-sharpen', 'ctl-denoise', 'ctl-brightness', 'ctl-contrast', 'ctl-saturation']
    .forEach((id) => { document.getElementById(id).value = id === 'ctl-scale' ? 100 : 0; });
  ilSyncLabels();
  ilApply('vision.enhance_image', { reason: 'chargement initial' });
}

function ilApply(actionType, extraDetails) {
  if (!ilBaseCanvas) return;
  const status = document.getElementById('imagelab-status');
  status.textContent = 'Traitement en cours…';

  // setTimeout plutot que requestAnimationFrame : rAF peut etre fortement
  // retarde/suspendu quand la fenetre n'a pas le focus ou est masquee
  // (throttling par occlusion de Chromium), ce qui laisserait le
  // traitement bloque indefiniment si l'utilisateur change de fenetre.
  setTimeout(() => {
    const ctl = ilGetControls();
    const resultCanvas = document.getElementById('imagelab-canvas-result');
    const outW = Math.round(ilBaseCanvas.width * ctl.scale / 100);
    const outH = Math.round(ilBaseCanvas.height * ctl.scale / 100);
    resultCanvas.width = outW;
    resultCanvas.height = outH;

    const rctx = resultCanvas.getContext('2d', { willReadFrequently: true });
    rctx.imageSmoothingEnabled = true;
    rctx.imageSmoothingQuality = 'high';
    rctx.drawImage(ilBaseCanvas, 0, 0, outW, outH);

    let imageData = rctx.getImageData(0, 0, outW, outH);
    if (ctl.denoise > 0) {
      imageData = ilConvolve3x3(imageData, ilLerpKernel(IL_IDENTITY_KERNEL, IL_BLUR_KERNEL, ctl.denoise / 100));
    }
    if (ctl.sharpen > 0) {
      imageData = ilConvolve3x3(imageData, ilLerpKernel(IL_IDENTITY_KERNEL, IL_SHARPEN_KERNEL, ctl.sharpen / 100));
    }
    if (ctl.brightness || ctl.contrast || ctl.saturation) {
      imageData = ilAdjustColor(imageData, ctl.brightness, ctl.contrast, ctl.saturation);
    }
    rctx.putImageData(imageData, 0, 0);

    status.textContent = `Terminé (${outW}×${outH}px).`;

    if (actionType) {
      window.aura.logAction({
        typeAction: actionType,
        sensibilite: 'reversible',
        statut: 'execute',
        details: { ...ctl, ...extraDetails }
      }).catch(() => {});
    }
  }, 0);
}

function ilReset() {
  ['ctl-scale', 'ctl-sharpen', 'ctl-denoise', 'ctl-brightness', 'ctl-contrast', 'ctl-saturation']
    .forEach((id) => { document.getElementById(id).value = id === 'ctl-scale' ? 100 : 0; });
  ilSyncLabels();
  ilApply(null);
  document.getElementById('imagelab-status').textContent = 'Réinitialisé à l’original.';
}

function ilAutoPreset() {
  document.getElementById('ctl-sharpen').value = 25;
  document.getElementById('ctl-denoise').value = 15;
  document.getElementById('ctl-contrast').value = 8;
  ilSyncLabels();
  ilApply('vision.enhance_image', { mode: 'automatique (preset fixe)' });
}

async function ilExport() {
  const resultCanvas = document.getElementById('imagelab-canvas-result');
  const dataUrl = resultCanvas.toDataURL('image/png');
  const status = document.getElementById('imagelab-status');
  try {
    const { saved, filePath } = await window.aura.saveImage(dataUrl);
    status.textContent = saved ? `Exporté vers ${filePath}` : 'Export annulé.';
    if (saved) {
      window.aura.logAction({
        typeAction: 'vision.export_image',
        sensibilite: 'reversible',
        statut: 'execute',
        details: { filePath }
      }).catch(() => {});
    }
  } catch (err) {
    status.textContent = `Échec de l’export : ${err.message}`;
  }
}

function wireImageLab() {
  document.getElementById('imagelab-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => ilSetImage(img);
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('imagelab-slider').addEventListener('input', (e) => {
    const pct = e.target.value;
    document.getElementById('imagelab-canvas-result').style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    document.getElementById('imagelab-divider').style.left = `${pct}%`;
  });

  ['ctl-scale', 'ctl-sharpen', 'ctl-denoise', 'ctl-brightness', 'ctl-contrast', 'ctl-saturation']
    .forEach((id) => document.getElementById(id).addEventListener('input', ilSyncLabels));

  document.getElementById('imagelab-preview').addEventListener('click', () => {
    const ctl = ilGetControls();
    const actions = [];
    if (ctl.sharpen > 0) actions.push('vision.sharpen_image');
    if (ctl.denoise > 0) actions.push('vision.denoise_image');
    if (ctl.scale !== 100) actions.push('vision.upscale_image');
    ilApply(actions[0] || 'vision.enhance_image');
  });
  document.getElementById('imagelab-auto').addEventListener('click', ilAutoPreset);
  document.getElementById('imagelab-reset').addEventListener('click', ilReset);
  document.getElementById('imagelab-export').addEventListener('click', ilExport);
  document.getElementById('imagelab-new').addEventListener('click', () => {
    ilBaseCanvas = null;
    document.getElementById('imagelab-file').value = '';
    document.getElementById('imagelab-workspace').hidden = true;
    document.getElementById('imagelab-empty').hidden = false;
  });
}

// --- Gaming & Streaming (§8, §16.3) -----------------------------------
// Connecteur gaming strictement en lecture (§18.2). OBS reste de la
// supervision de diffusion, jamais une automatisation du jeu.

const CONNFIELD_LABELS = {
  riotApiKey: 'Clé API Riot',
  steamApiKey: 'Clé API Steam',
  steamId: 'SteamID64',
  obsHost: 'Hôte OBS (ex. 127.0.0.1)',
  obsPort: 'Port OBS (ex. 4455)',
  obsPassword: 'Mot de passe OBS'
};

function renderGamingStatus(status) {
  document.getElementById('dot-riot').classList.toggle('ok', status.riot);
  document.getElementById('label-riot').textContent = status.riot ? 'Clé configurée' : 'Non configuré';
  document.getElementById('dot-steam').classList.toggle('ok', status.steam);
  document.getElementById('label-steam').textContent = status.steam ? 'Configuré' : 'Non configuré';
  document.getElementById('dot-obs').classList.toggle('ok', status.obs.connected);
  document.getElementById('label-obs').textContent = status.obs.connected
    ? 'Connecté'
    : (status.obs.configured ? 'Configuré (non connecté)' : 'Non configuré');
  document.getElementById('obs-connect').hidden = status.obs.connected;
  document.getElementById('obs-disconnect').hidden = !status.obs.connected;
  document.getElementById('obs-controls').hidden = !status.obs.connected;
}

async function loadGamingScreen() {
  try {
    const status = await window.aura.getGamingStatus();
    renderGamingStatus(status);
    if (status.obs.connected) loadObsScenes();
  } catch {
    // API locale indisponible : les indicateurs restent sur leur etat par defaut
  }
}

function renderMatches(matches) {
  const el = document.getElementById('riot-results');
  if (!matches.length) { el.textContent = 'Aucune partie récente.'; return; }
  el.innerHTML = '';
  matches.forEach((m) => {
    const row = document.createElement('div');
    row.className = `match-row ${m.win ? 'win' : 'loss'}`;
    const mins = Math.round(m.gameDurationSec / 60);
    row.innerHTML = `<span>${m.champion} — ${m.win ? 'Victoire' : 'Défaite'}</span><span>${m.kills}/${m.deaths}/${m.assists} · ${mins} min</span>`;
    el.appendChild(row);
  });
}

function renderGames(games) {
  const el = document.getElementById('steam-results');
  if (!games.length) { el.textContent = 'Aucun jeu trouvé.'; return; }
  el.innerHTML = '';
  games.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'game-row';
    row.innerHTML = `<span>${g.name}</span><span>${g.playtimeHours} h</span>`;
    el.appendChild(row);
  });
}

async function loadObsScenes() {
  try {
    const { current, scenes } = await window.aura.obsScenes();
    const el = document.getElementById('obs-scenes');
    el.innerHTML = '';
    scenes.forEach((name) => {
      const row = document.createElement('div');
      row.className = `scene-row ${name === current ? 'current' : ''}`;
      row.textContent = name;
      row.addEventListener('click', async () => {
        try {
          await window.aura.obsSwitchScene(name);
          journal(`OBS_SCENE : ${name}`);
          loadObsScenes();
        } catch (err) {
          journal(`OBS_SCENE_ECHEC : ${err.message}`);
        }
      });
      el.appendChild(row);
    });
  } catch (err) {
    document.getElementById('obs-status').textContent = err.message;
  }
}

function wireGamingScreen() {
  document.querySelectorAll('[data-connfield]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.connfield;
      const value = prompt(CONNFIELD_LABELS[key] || key);
      if (value === null) return;
      try {
        const status = await window.aura.setGamingConfig(key, value);
        renderGamingStatus(status);
        journal(`CONNECTEUR_CONFIG : ${key}`);
      } catch (err) {
        journal(`CONNECTEUR_CONFIG_ECHEC : ${err.message}`);
      }
    });
  });

  document.getElementById('riot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const gameName = document.getElementById('riot-name').value.trim();
    const tagLine = document.getElementById('riot-tag').value.trim();
    const region = document.getElementById('riot-region').value;
    if (!gameName || !tagLine) return;
    const el = document.getElementById('riot-results');
    el.textContent = 'Chargement…';
    try {
      renderMatches(await window.aura.fetchRiotMatches(gameName, tagLine, region));
    } catch (err) {
      el.textContent = err.message;
    }
  });

  document.getElementById('steam-load').addEventListener('click', async () => {
    const el = document.getElementById('steam-results');
    el.textContent = 'Chargement…';
    try {
      renderGames(await window.aura.fetchSteamGames());
    } catch (err) {
      el.textContent = err.message;
    }
  });

  document.getElementById('obs-connect').addEventListener('click', async () => {
    const status = document.getElementById('obs-status');
    status.textContent = 'Connexion…';
    try {
      await window.aura.obsConnect();
      status.textContent = 'Connecté.';
      loadGamingScreen();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.getElementById('obs-disconnect').addEventListener('click', async () => {
    await window.aura.obsDisconnect();
    loadGamingScreen();
  });

  document.getElementById('obs-overlay-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const sourceName = document.getElementById('obs-source-name').value.trim();
    const text = document.getElementById('obs-overlay-text').value;
    if (!sourceName) return;
    try {
      await window.aura.obsUpdateOverlay(sourceName, text);
      journal(`OBS_OVERLAY : ${sourceName}`);
    } catch (err) {
      document.getElementById('obs-status').textContent = err.message;
    }
  });

  document.getElementById('obs-start-stream').addEventListener('click', async () => {
    if (!confirm('Démarrer la diffusion en direct maintenant ?')) return;
    try {
      await window.aura.obsStartStream();
      journal('OBS_STREAM_DEMARRE');
    } catch (err) {
      document.getElementById('obs-status').textContent = err.message;
    }
  });
}

// --- Connecteur Productivite (§7) -------------------------------------
// task.create / task.complete / reminder.schedule. Les rappels ne sont
// verifies que pendant qu'une session AURA est ouverte (F-22, §5.9) -
// aucune surveillance hors session.

function renderTasks(tasks) {
  const list = document.getElementById('tasks-list');
  const active = tasks.filter((t) => t.status !== 'completed');
  const completed = tasks.filter((t) => t.status === 'completed');
  const ordered = [...active, ...completed];
  if (!ordered.length) { list.textContent = 'Aucune tâche.'; return; }
  list.innerHTML = '';
  ordered.forEach((task) => {
    const row = document.createElement('div');
    row.className = `task-row ${task.status === 'completed' ? 'completed' : ''}`;
    row.innerHTML = `
      <input type="checkbox" ${task.status === 'completed' ? 'checked disabled' : ''}>
      <span class="task-priority-dot ${task.priority}"></span>
      <span class="task-title">${task.title}</span>
      ${task.dueDate ? `<span class="task-due">${task.dueDate}</span>` : ''}
      <button type="button" class="row-delete" title="Supprimer">✕</button>
    `;
    if (task.status !== 'completed') {
      row.querySelector('input[type="checkbox"]').addEventListener('change', async () => {
        try {
          await window.aura.completeTask(task.id);
          journal(`TACHE_TERMINEE : ${task.title}`);
          loadTasks();
        } catch (err) {
          journal(`TACHE_ECHEC : ${err.message}`);
        }
      });
    }
    row.querySelector('.row-delete').addEventListener('click', async () => {
      await window.aura.deleteTask(task.id);
      loadTasks();
    });
    list.appendChild(row);
  });
}

async function loadTasks() {
  try {
    renderTasks(await window.aura.getTasks());
  } catch {
    document.getElementById('tasks-list').textContent = 'Tâches indisponibles.';
  }
}

function renderReminders(reminders) {
  const list = document.getElementById('reminders-list');
  const active = reminders.filter((r) => r.active);
  if (!active.length) { list.textContent = 'Aucun rappel.'; return; }
  list.innerHTML = '';
  active
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .forEach((reminder) => {
      const row = document.createElement('div');
      row.className = 'reminder-row';
      const when = new Date(reminder.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      const recur = reminder.recurring === 'daily' ? ' ↻ jour' : reminder.recurring === 'weekly' ? ' ↻ semaine' : '';
      row.innerHTML = `
        <span class="task-title">${reminder.text}</span>
        <span class="task-due">${when}${recur}</span>
        <button type="button" class="row-delete" title="Supprimer">✕</button>
      `;
      row.querySelector('.row-delete').addEventListener('click', async () => {
        await window.aura.deleteReminder(reminder.id);
        loadReminders();
      });
      list.appendChild(row);
    });
}

async function loadReminders() {
  try {
    renderReminders(await window.aura.getReminders());
  } catch {
    document.getElementById('reminders-list').textContent = 'Rappels indisponibles.';
  }
}

async function checkDueReminders() {
  try {
    const fired = await window.aura.checkDueReminders();
    fired.forEach((reminder) => {
      if (!reminder) return;
      try { new Notification('AURA — Rappel', { body: reminder.text }); } catch { /* notifications indisponibles */ }
      journal(`RAPPEL_DECLENCHE : ${reminder.text}`);
    });
    if (fired.length) loadReminders();
  } catch {
    // API locale indisponible - reessaiera au prochain intervalle
  }
}

function wireProductivity() {
  document.getElementById('task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('task-title').value.trim();
    if (!title) return;
    const dueDate = document.getElementById('task-due').value || null;
    const priority = document.getElementById('task-priority').value;
    try {
      await window.aura.createTask({ title, dueDate, priority });
      document.getElementById('task-title').value = '';
      document.getElementById('task-due').value = '';
      journal(`TACHE_CREEE : ${title}`);
      loadTasks();
    } catch (err) {
      journal(`TACHE_CREATION_ECHEC : ${err.message}`);
    }
  });

  document.getElementById('reminder-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = document.getElementById('reminder-text').value.trim();
    const at = document.getElementById('reminder-at').value;
    const recurring = document.getElementById('reminder-recurring').value || null;
    if (!text || !at) return;
    try {
      await window.aura.createReminder({ text, at: new Date(at).toISOString(), recurring });
      document.getElementById('reminder-text').value = '';
      document.getElementById('reminder-at').value = '';
      journal(`RAPPEL_PROGRAMME : ${text}`);
      loadReminders();
    } catch (err) {
      journal(`RAPPEL_CREATION_ECHEC : ${err.message}`);
    }
  });
}

// --- AURA CODE (§6) ---------------------------------------------------
// git.push est "Irreversible" (§14.1) : confirmation explicite avant
// l'appel. Le connecteur gaming reste en lecture (§18.2) ; ici, commit
// et push agissent reellement sur le depot configure - à utiliser avec
// discernement.

const DEVFIELD_LABELS = {
  devRepoPath: 'Chemin du dépôt Git (dossier local)',
  devUnityEditorPath: 'Chemin complet vers Unity.exe',
  devUnityProjectPath: 'Chemin du projet Unity'
};

function renderDevStatus(config) {
  document.getElementById('dot-dev-repo').classList.toggle('ok', !!config.repoPath);
  document.getElementById('label-dev-repo').textContent = config.repoPath || 'Dépôt non configuré';
  const unityOk = !!(config.unityEditorPath && config.unityProjectPath);
  document.getElementById('dot-dev-unity').classList.toggle('ok', unityOk);
  document.getElementById('label-dev-unity').textContent = unityOk
    ? 'Éditeur et projet configurés'
    : 'Non configuré';
}

async function loadDevScreen() {
  try {
    renderDevStatus(await window.aura.getDevConfig());
  } catch {
    // API locale indisponible
  }
}

function renderGitStatus(result) {
  const el = document.getElementById('git-status-result');
  if (!result.files.length) {
    el.innerHTML = `<div>Branche <strong>${result.branch}</strong> — aucun changement.</div>`;
    return;
  }
  el.innerHTML = `<div>Branche <strong>${result.branch}</strong> — ${result.files.length} changement(s) :</div>`;
  result.files.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'file-status-row';
    row.innerHTML = `<span class="file-status-code">${f.status}</span><span class="file-status-path">${f.path}</span>`;
    el.appendChild(row);
  });
}

function wireDevScreen() {
  document.querySelectorAll('[data-devfield]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.devfield;
      const value = prompt(DEVFIELD_LABELS[key] || key);
      if (value === null) return;
      try {
        renderDevStatus(await window.aura.setDevConfig(key, value));
        journal(`DEV_CONFIG : ${key}`);
      } catch (err) {
        journal(`DEV_CONFIG_ECHEC : ${err.message}`);
      }
    });
  });

  document.getElementById('git-status-btn').addEventListener('click', async () => {
    const el = document.getElementById('git-status-result');
    el.textContent = 'Vérification…';
    try {
      renderGitStatus(await window.aura.gitStatus());
    } catch (err) {
      el.textContent = err.message;
    }
  });

  document.getElementById('git-commit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('git-commit-message').value.trim();
    if (!message) return;
    const status = document.getElementById('git-status-message');
    try {
      const result = await window.aura.gitCommit(message);
      status.textContent = `Commit créé : ${result.hash.slice(0, 8)}`;
      document.getElementById('git-commit-message').value = '';
      journal(`GIT_COMMIT : ${result.hash.slice(0, 8)}`);
      document.getElementById('git-status-btn').click();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.getElementById('git-push-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const remote = document.getElementById('git-push-remote').value.trim() || 'origin';
    const branch = document.getElementById('git-push-branch').value.trim() || null;
    if (!confirm(`Publier les commits locaux sur "${remote}"${branch ? ` (${branch})` : ''} ? Action irréversible.`)) return;
    const status = document.getElementById('git-status-message');
    status.textContent = 'Push en cours…';
    try {
      const result = await window.aura.gitPush(remote, branch);
      status.textContent = result.output || 'Push terminé.';
      journal(`GIT_PUSH : ${remote}`);
    } catch (err) {
      status.textContent = err.message;
      journal(`GIT_PUSH_ECHEC : ${err.message}`);
    }
  });

  document.getElementById('unity-build-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const buildTarget = document.getElementById('unity-build-target').value;
    const outputPath = document.getElementById('unity-output-path').value.trim() || null;
    const status = document.getElementById('unity-status');
    status.textContent = 'Build en cours (cela peut prendre plusieurs minutes)…';
    try {
      const result = await window.aura.unityBuild({ buildTarget, outputPath });
      status.textContent = `Build terminé (code ${result.exitCode}).`;
      journal('UNITY_BUILD');
    } catch (err) {
      status.textContent = err.message;
      journal(`UNITY_BUILD_ECHEC : ${err.message}`);
    }
  });
}

// --- Communication (§3 : mail/Discord) --------------------------------
// Apercu obligatoire avant tout envoi (F-09) : toute modification du
// texte apres l'apercu l'invalide et desactive "Envoyer" jusqu'au
// prochain apercu, pour garantir qu'on n'envoie jamais autre chose que
// ce qui a ete relu.

const COMMFIELD_LABELS = {
  smtpHost: 'Hôte SMTP (ex. smtp.gmail.com)',
  smtpPort: 'Port SMTP (ex. 587)',
  smtpUser: 'Adresse email',
  smtpPass: 'Mot de passe (application) SMTP',
  discordWebhookUrl: 'URL du webhook Discord'
};

function renderCommStatus(status) {
  document.getElementById('dot-comm-mail').classList.toggle('ok', status.mail);
  document.getElementById('label-comm-mail').textContent = status.mail ? 'Configuré' : 'Non configuré';
  document.getElementById('dot-comm-discord').classList.toggle('ok', status.discord);
  document.getElementById('label-comm-discord').textContent = status.discord ? 'Configuré' : 'Non configuré';
}

async function loadCommScreen() {
  try {
    renderCommStatus(await window.aura.getCommStatus());
  } catch {
    // API locale indisponible
  }
}

function invalidatePreview(previewId, buttonId) {
  document.getElementById(previewId).hidden = true;
  document.getElementById(buttonId).disabled = true;
}

function wireCommScreen() {
  document.querySelectorAll('[data-commfield]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.commfield;
      const value = prompt(COMMFIELD_LABELS[key] || key);
      if (value === null) return;
      try {
        renderCommStatus(await window.aura.setCommConfig(key, value));
        journal(`COMM_CONFIG : ${key}`);
      } catch (err) {
        journal(`COMM_CONFIG_ECHEC : ${err.message}`);
      }
    });
  });

  document.getElementById('mail-preview-btn').addEventListener('click', () => {
    const to = document.getElementById('mail-to').value.trim();
    const subject = document.getElementById('mail-subject').value.trim();
    const body = document.getElementById('mail-body').value;
    const status = document.getElementById('mail-status');
    if (!to) { status.textContent = 'Destinataire manquant.'; return; }
    status.textContent = '';
    const preview = document.getElementById('mail-preview');
    preview.innerHTML = `<span class="preview-label">Aperçu</span><strong>À :</strong> ${to}\n<strong>Objet :</strong> ${subject}\n\n${body}`;
    preview.hidden = false;
    document.getElementById('mail-send-btn').disabled = false;
  });

  document.getElementById('mail-send-btn').addEventListener('click', async () => {
    const to = document.getElementById('mail-to').value.trim();
    const subject = document.getElementById('mail-subject').value.trim();
    const body = document.getElementById('mail-body').value;
    if (!confirm(`Envoyer cet email à ${to} ?`)) return;
    const status = document.getElementById('mail-status');
    status.textContent = 'Envoi…';
    try {
      await window.aura.mailSend({ to, subject, body });
      status.textContent = 'Email envoyé.';
      journal(`MAIL_ENVOYE : ${to}`);
      invalidatePreview('mail-preview', 'mail-send-btn');
    } catch (err) {
      status.textContent = err.message;
      journal(`MAIL_ECHEC : ${err.message}`);
    }
  });

  document.getElementById('discord-preview-btn').addEventListener('click', () => {
    const content = document.getElementById('discord-content').value;
    const status = document.getElementById('discord-status');
    if (!content.trim()) { status.textContent = 'Message vide.'; return; }
    status.textContent = '';
    const preview = document.getElementById('discord-preview');
    preview.innerHTML = `<span class="preview-label">Aperçu</span>${content}`;
    preview.hidden = false;
    document.getElementById('discord-send-btn').disabled = false;
  });

  document.getElementById('discord-send-btn').addEventListener('click', async () => {
    const content = document.getElementById('discord-content').value;
    if (!confirm('Envoyer ce message sur Discord ?')) return;
    const status = document.getElementById('discord-status');
    status.textContent = 'Envoi…';
    try {
      await window.aura.discordSend(content);
      status.textContent = 'Message envoyé.';
      journal('DISCORD_ENVOYE');
      invalidatePreview('discord-preview', 'discord-send-btn');
    } catch (err) {
      status.textContent = err.message;
      journal(`DISCORD_ECHEC : ${err.message}`);
    }
  });

  ['mail-to', 'mail-subject', 'mail-body'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => invalidatePreview('mail-preview', 'mail-send-btn'));
  });
  document.getElementById('discord-content').addEventListener('input', () => invalidatePreview('discord-preview', 'discord-send-btn'));
}

// --- AURA SYSTEM MONITOR (§5.7) ---------------------------------------
// Purement de l'observation (niveau OBSERVE, §14.2) : jamais d'action,
// jamais de confirmation. Ne sonde que pendant que l'ecran est ouvert -
// une surveillance continue en arriere-plan serait le role d'AURA
// AUTONOMY (§5.9), pas encore construit.

let sysmonInterval = null;

function bar(percent, dangerAt = 90) {
  const pct = Math.min(100, Math.max(0, percent || 0));
  const cls = pct >= dangerAt ? '' : 'ok';
  return `<span class="bar-track"><span class="bar-fill ${cls}" style="width:${pct}%"></span></span>`;
}

function renderSysmon(snap) {
  document.getElementById('sysmon-cpu').innerHTML = `
    <div>${snap.cpu.model} (${snap.cpu.cores} cœurs, ${snap.cpu.speedGhz} GHz)</div>
    <div class="sysmon-metric">Charge ${bar(snap.cpu.loadPercent)}${snap.cpu.loadPercent}%</div>
    ${snap.cpu.temperatureC !== null ? `<div class="sysmon-metric">Température${bar(snap.cpu.temperatureC, 85)}${snap.cpu.temperatureC}°C</div>` : '<div>Température indisponible</div>'}
  `;

  document.getElementById('sysmon-mem').innerHTML = `
    <div class="sysmon-metric">Utilisée${bar(snap.memory.usedPercent)}${snap.memory.usedPercent}%</div>
    <div>${snap.memory.usedGB} Go / ${snap.memory.totalGB} Go</div>
  `;

  document.getElementById('sysmon-gpu').innerHTML = snap.gpu.length
    ? snap.gpu.map((g) => `
      <div>${g.model}</div>
      ${g.loadPercent !== null ? `<div class="sysmon-metric">Charge${bar(g.loadPercent)}${g.loadPercent}%</div>` : ''}
      ${g.temperatureC !== null ? `<div class="sysmon-metric">Température${bar(g.temperatureC, 85)}${g.temperatureC}°C</div>` : ''}
      <div>VRAM : ${g.memoryUsedMB ?? '?'} / ${g.vramMB} Mo</div>
    `).join('<hr style="border-color:rgba(245,246,247,0.08); margin:8px 0;">')
    : 'Aucun GPU détecté.';

  document.getElementById('sysmon-disks').innerHTML = snap.disks.map((d) => `
    <div class="sysmon-metric">${d.mount}${bar(d.usedPercent)}${d.usedPercent}%</div>
    <div>${d.usedGB} Go / ${d.sizeGB} Go</div>
  `).join('');

  document.getElementById('sysmon-net').innerHTML = snap.network.length
    ? snap.network.map((n) => `<div>${n.iface} : ↓ ${n.rxKBs} Ko/s · ↑ ${n.txKBs} Ko/s</div>`).join('')
    : 'Aucune interface active.';

  document.getElementById('sysmon-procs').innerHTML = snap.topProcesses.map((p) =>
    `<div class="sysmon-metric">${p.name}<span>${p.cpuPercent}% CPU</span></div>`
  ).join('');
}

function renderThresholds(thresholds) {
  document.getElementById('sysmon-thresholds').textContent =
    `CPU ≥ ${thresholds.cpuPercent}% · RAM ≥ ${thresholds.ramPercent}% · Disque ≥ ${thresholds.diskPercent}%`;
}

function renderAlerts(alerts) {
  const el = document.getElementById('sysmon-alerts');
  if (!alerts.length) { el.textContent = 'Aucune alerte.'; return; }
  el.innerHTML = '';
  alerts.forEach((alert) => {
    const row = document.createElement('div');
    row.className = `alert-row ${alert.statut === 'acquittee' ? 'acquittee' : ''}`;
    const when = new Date(alert.date).toLocaleTimeString('fr-FR');
    row.innerHTML = `<span>${when} — ${alert.cause}</span>`;
    if (alert.statut !== 'acquittee') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'row-delete';
      btn.title = 'Acquitter';
      btn.textContent = '✓';
      btn.addEventListener('click', async () => {
        await window.aura.acknowledgeAlert(alert.id);
        loadSysmonAlerts();
      });
      row.appendChild(btn);
    }
    el.appendChild(row);
  });
}

async function loadSysmonAlerts() {
  try { renderAlerts(await window.aura.getSystemAlerts()); } catch { /* API indisponible */ }
}

async function pollSysmon() {
  try {
    const { snapshot, newAlerts } = await window.aura.getSystemSnapshot();
    renderSysmon(snapshot);
    if (newAlerts.length) { loadSysmonAlerts(); speakNewAlerts(newAlerts); }
  } catch {
    document.getElementById('sysmon-cpu').textContent = 'Système indisponible.';
  }
}

function startSysmonPolling() {
  pollSysmon();
  loadSysmonAlerts();
  window.aura.getSystemThresholds().then(renderThresholds).catch(() => {});
  stopSysmonPolling();
  sysmonInterval = setInterval(pollSysmon, 4000);
}

function stopSysmonPolling() {
  if (sysmonInterval) { clearInterval(sysmonInterval); sysmonInterval = null; }
}

const THRESHOLD_LABELS = {
  cpuPercent: 'Seuil d’alerte CPU (%)',
  ramPercent: 'Seuil d’alerte RAM (%)',
  diskPercent: 'Seuil d’alerte disque (%)'
};

function wireSysmonScreen() {
  document.querySelectorAll('[data-threshold]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.threshold;
      const value = prompt(THRESHOLD_LABELS[key] || key);
      if (value === null || Number.isNaN(Number(value))) return;
      try {
        renderThresholds(await window.aura.setSystemThreshold(key, value));
        journal(`SEUIL_MODIFIE : ${key} = ${value}`);
      } catch (err) {
        journal(`SEUIL_ECHEC : ${err.message}`);
      }
    });
  });
}

// --- AURA ANALYTICS (§5.5) ---------------------------------------------
// Fusionne des donnees deja reelles d'autres modules. Toute prevision
// affiche sa confiance et un rappel explicite qu'il ne s'agit pas d'une
// certitude (§5.5).

function trendLabel(t) {
  if (!t) return '—';
  const arrow = t.direction === 'hausse' ? '↗' : t.direction === 'baisse' ? '↘' : '→';
  return `${arrow} ${t.direction} (ajustement ${Math.round(t.confidence * 100)}%)`;
}

function renderMetricCard(elId, data) {
  const el = document.getElementById(elId);
  if (!data) { el.textContent = 'Pas assez de données.'; return; }
  el.innerHTML = `
    <div>Moyenne : ${data.mean}% (${data.min}–${data.max}%)</div>
    <div>Écart-type : ${data.stdDev}</div>
    <div>Tendance : ${trendLabel(data.trend)}</div>
    <div style="font-size:10px; margin-top:4px;">${data.count} échantillons</div>
  `;
}

function renderCorrelation(value) {
  const el = document.getElementById('analytics-correlation');
  if (value === null) { el.textContent = 'Pas assez de données.'; return; }
  const abs = Math.abs(value);
  const interp = abs < 0.2 ? 'aucun lien apparent' : abs < 0.5 ? 'lien faible' : abs < 0.8 ? 'lien modéré' : 'lien fort';
  const sign = value > 0 ? ' (positif)' : value < 0 ? ' (négatif)' : '';
  el.innerHTML = `<div>Coefficient : ${value}</div><div>${interp}${sign}</div>`;
}

function renderProductivity(p) {
  document.getElementById('analytics-productivity').innerHTML = p.totalTasks
    ? `<div>${p.completedTasks}/${p.totalTasks} tâches terminées</div><div>${p.completionRatePercent}% de complétion</div>`
    : 'Aucune tâche enregistrée.';
}

function renderJournalStats(j) {
  const top = Object.entries(j.byType).sort((a, b) => b[1] - a[1]).slice(0, 5);
  document.getElementById('analytics-journal').innerHTML = `
    <div>${j.totalActions} actions · ${j.failureRatePercent}% d’échec</div>
    ${top.map(([type, count]) => `<div>${type} : ${count}</div>`).join('')}
  `;
}

function renderAnomaliesList(anoms) {
  const el = document.getElementById('analytics-anomalies');
  const all = [
    ...anoms.cpu.map((a) => ({ ...a, metric: 'CPU' })),
    ...anoms.ram.map((a) => ({ ...a, metric: 'RAM' })),
    ...anoms.gpu.map((a) => ({ ...a, metric: 'GPU' }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  if (!all.length) { el.textContent = 'Aucune anomalie détectée.'; return; }
  el.innerHTML = all.slice(0, 10)
    .map((a) => `<div>${new Date(a.at).toLocaleTimeString('fr-FR')} — ${a.metric} à ${a.value}% (z=${a.zScore})</div>`)
    .join('');
}

function renderPredictionsHistory(predictions) {
  const el = document.getElementById('predictions-history');
  if (!predictions.length) { el.textContent = ''; return; }
  el.innerHTML = '<div style="margin-top:10px; color:var(--dim);">Historique récent :</div>' +
    predictions.slice(0, 5)
      .map((p) => `<div>${p.metric} → ${p.predictedValue}% (confiance ${Math.round(p.confidence * 100)}%, ${new Date(p.date).toLocaleString('fr-FR')})</div>`)
      .join('');
}

async function loadAnalyticsScreen() {
  try {
    const summary = await window.aura.getAnalyticsSummary();
    renderMetricCard('analytics-cpu', summary.system.cpu);
    renderMetricCard('analytics-ram', summary.system.ram);
    renderMetricCard('analytics-gpu', summary.system.gpu);
    renderCorrelation(summary.system.cpuGpuCorrelation);
    renderProductivity(summary.productivity);
    renderJournalStats(summary.journal);
  } catch {
    document.getElementById('analytics-cpu').textContent = 'Analytics indisponible.';
  }
  try {
    renderAnomaliesList(await window.aura.getAnalyticsAnomalies());
  } catch {
    // pas grave, section laissee vide
  }
  try {
    renderPredictionsHistory(await window.aura.getPredictions());
  } catch {
    // pas grave, section laissee vide
  }
}

function wireAnalyticsScreen() {
  document.getElementById('forecast-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const metric = document.getElementById('forecast-metric').value;
    const steps = document.getElementById('forecast-steps').value;
    const result = document.getElementById('forecast-result');
    result.hidden = false;
    result.innerHTML = 'Calcul…';
    try {
      const prediction = await window.aura.getForecast(metric, steps);
      result.innerHTML = `<span class="preview-label">Prévision (${metric}, +${steps})</span>` +
        `${prediction.predictedValue}% — confiance ${Math.round(prediction.confidence * 100)}%\n` +
        `Basé sur ${prediction.sourceCount} échantillons. À prendre avec prudence, pas une certitude.`;
      journal(`ANALYTICS_FORECAST : ${metric} = ${prediction.predictedValue}%`);
      renderPredictionsHistory(await window.aura.getPredictions());
    } catch (err) {
      result.innerHTML = err.message;
    }
  });
}

// --- AURA SECURITY (§5.8, §18.2) ---------------------------------------
// Volet defensif toujours en lecture (aucune confirmation). La
// reconnaissance reseau reste bornee cote UI : hors localhost, la case
// d'autorisation doit etre cochee avant de pouvoir soumettre le formulaire.

function wireSecurityScreen() {
  document.getElementById('sec-deps-btn').addEventListener('click', async () => {
    const el = document.getElementById('sec-deps-result');
    el.textContent = 'Analyse en cours…';
    try {
      const v = await window.aura.checkDependencies();
      el.innerHTML = `<div>Total : ${v.total}</div><div>Critique : ${v.critical} · Haute : ${v.high} · Moyenne : ${v.moderate} · Faible : ${v.low}</div>`;
      journal(`SECURITY_DEPENDENCIES : ${v.total} vulnérabilité(s)`);
    } catch (err) {
      el.textContent = err.message;
    }
  });

  document.getElementById('sec-secrets-btn').addEventListener('click', async () => {
    const el = document.getElementById('sec-secrets-result');
    el.textContent = 'Scan en cours…';
    try {
      const r = await window.aura.auditSecrets();
      if (!r.findings.length) {
        el.innerHTML = `<div>${r.filesScanned} fichiers scannés — aucun secret détecté.</div>`;
      } else {
        el.innerHTML = `<div>${r.filesScanned} fichiers scannés — ${r.findings.length} résultat(s) :</div>` +
          r.findings.slice(0, 15).map((f) => `<div class="file-status-row"><span class="file-status-code">${f.pattern}</span><span class="file-status-path">${f.file} (${f.preview})</span></div>`).join('');
      }
      journal(`SECURITY_AUDIT : ${r.findings.length} résultat(s)`);
    } catch (err) {
      el.textContent = err.message;
    }
  });

  document.getElementById('sec-logs-btn').addEventListener('click', async () => {
    const el = document.getElementById('sec-logs-result');
    el.textContent = 'Analyse en cours…';
    try {
      const r = await window.aura.scanSecurityLogs();
      el.innerHTML = !r.suspicious.length
        ? `<div>${r.totalActions} actions analysées — rien d’inhabituel.</div>`
        : `<div>${r.totalActions} actions analysées :</div>` +
          r.suspicious.map((s) => `<div>${s.typeAction} : ${s.failed}/${s.total} échecs (${s.failureRatePercent}%)</div>`).join('');
      journal(`SECURITY_LOGS : ${r.suspicious.length} type(s) suspect(s)`);
    } catch (err) {
      el.textContent = err.message;
    }
  });

  document.getElementById('pentest-host').addEventListener('input', updatePentestGate);
  document.getElementById('pentest-authorized').addEventListener('change', updatePentestGate);

  document.getElementById('pentest-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const host = document.getElementById('pentest-host').value.trim() || '127.0.0.1';
    const authorized = document.getElementById('pentest-authorized').checked;
    const localTarget = ['127.0.0.1', 'localhost', '::1'].includes(host);
    if (!localTarget && !authorized) return;
    if (!localTarget && !confirm(`Scanner ${host} ? Tu confirmes que c’est autorisé (système propre, CTF, ou bug bounty écrit).`)) return;

    const el = document.getElementById('pentest-result');
    el.textContent = 'Scan en cours…';
    try {
      const { target, results } = await window.aura.pentestScan(host, authorized);
      const open = results.filter((r) => r.open);
      el.innerHTML = open.length
        ? `<div>${target} — ${open.length} port(s) ouvert(s) :</div>` + open.map((r) => `<div>Port ${r.port}${r.banner ? ` — ${r.banner}` : ''}</div>`).join('')
        : `<div>${target} — aucun port courant ouvert.</div>`;
      journal(`SECURITY_PENTEST : ${target} (${open.length} port(s) ouvert(s))`);
    } catch (err) {
      el.textContent = err.message;
    }
  });

  updatePentestGate();
}

function updatePentestGate() {
  const host = document.getElementById('pentest-host').value.trim() || '127.0.0.1';
  const authorized = document.getElementById('pentest-authorized').checked;
  const localTarget = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const submitBtn = document.querySelector('#pentest-form button[type="submit"]');
  submitBtn.disabled = !localTarget && !authorized;
}

// --- AURA AUTONOMY (§5.9) ---------------------------------------------
// Regles limitees a des actions sures (§14.1 lecture/reversible) : pas
// de file d'approbation a construire, l'"escalade vers l'utilisateur"
// pour le reste consiste simplement a ne jamais les exposer ici.

function describeTrigger(trigger) {
  if (trigger.type === 'interval') return `Toutes les ${trigger.minutes} min`;
  if (trigger.type === 'daily') return `Chaque jour à ${trigger.time}`;
  if (trigger.type === 'threshold') {
    const op = trigger.operator === 'below' ? '<' : '>';
    return `${trigger.metric.toUpperCase()} ${op} ${trigger.value}%`;
  }
  return trigger.type;
}

function describeAction(action) {
  if (action.type === 'notify') return `Notifier : "${action.params?.message || ''}"`;
  if (action.type === 'task.create') return `Créer tâche : "${action.params?.title || ''}"`;
  if (action.type === 'system.snapshot') return 'Instantané système';
  return action.type;
}

function renderRulesList(rules) {
  const list = document.getElementById('rules-list');
  if (!rules.length) { list.textContent = 'Aucune règle.'; return; }
  list.innerHTML = '';
  rules.forEach((rule) => {
    const row = document.createElement('div');
    row.className = `task-row ${rule.enabled ? '' : 'completed'}`;
    const lastRun = rule.lastRunAt ? new Date(rule.lastRunAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais';
    row.innerHTML = `
      <input type="checkbox" ${rule.enabled ? 'checked' : ''} title="Activer/désactiver">
      <span class="task-title">${rule.name} — ${describeTrigger(rule.trigger)} → ${describeAction(rule.action)} <span class="muted small">[${rule.mode === 'active' ? 'active' : 'simulation'}]</span></span>
      <span class="task-due">Dernière exécution : ${lastRun}</span>
      <button type="button" class="row-delete" title="Supprimer">✕</button>
    `;
    row.querySelector('input[type="checkbox"]').addEventListener('change', async () => {
      await window.aura.toggleRule(rule.id);
      journal(`AUTONOMY_REGLE_${rule.enabled ? 'DESACTIVEE' : 'ACTIVEE'} : ${rule.name}`);
      loadAutonomyScreen();
    });
    row.querySelector('.row-delete').addEventListener('click', async () => {
      await window.aura.deleteRule(rule.id);
      journal(`AUTONOMY_REGLE_SUPPRIMEE : ${rule.name}`);
      loadAutonomyScreen();
    });
    list.appendChild(row);
  });
}

async function loadAutonomyScreen() {
  try {
    renderRulesList(await window.aura.getRules());
  } catch {
    document.getElementById('rules-list').textContent = 'Règles indisponibles.';
  }
  try {
    const { active } = await window.aura.getEstop();
    updateAutonomyEstopStatus(active);
  } catch { /* backend indisponible */ }
}

function wireAutonomyScreen() {
  const triggerType = document.getElementById('rule-trigger-type');
  const actionType = document.getElementById('rule-action-type');

  triggerType.addEventListener('change', () => {
    document.querySelectorAll('.rule-trigger-fields').forEach((el) => { el.hidden = true; });
    document.getElementById(`trigger-${triggerType.value}`).hidden = false;
  });

  actionType.addEventListener('change', () => {
    document.querySelectorAll('.rule-action-fields').forEach((el) => { el.hidden = true; });
    const el = document.getElementById(`action-${actionType.value === 'task.create' ? 'task' : actionType.value}`);
    if (el) el.hidden = false;
  });

  document.getElementById('rule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('rule-name').value.trim();
    if (!name) return;

    let trigger;
    if (triggerType.value === 'interval') {
      trigger = { type: 'interval', minutes: Number(document.getElementById('rule-interval-minutes').value) || 30 };
    } else if (triggerType.value === 'daily') {
      trigger = { type: 'daily', time: document.getElementById('rule-daily-time').value || '09:00' };
    } else {
      trigger = {
        type: 'threshold',
        metric: document.getElementById('rule-threshold-metric').value,
        operator: document.getElementById('rule-threshold-operator').value,
        value: Number(document.getElementById('rule-threshold-value').value) || 90
      };
    }

    let action;
    if (actionType.value === 'notify') {
      action = { type: 'notify', params: { message: document.getElementById('rule-action-message').value.trim() || name } };
    } else if (actionType.value === 'task.create') {
      action = { type: 'task.create', params: { title: document.getElementById('rule-action-title').value.trim() || name } };
    } else {
      action = { type: 'system.snapshot', params: {} };
    }

    const mode = document.getElementById('rule-mode').value;

    try {
      await window.aura.createRule({ name, trigger, action, mode });
      journal(`AUTONOMY_REGLE_CREEE : ${name} (${mode})`);
      e.target.reset();
      triggerType.dispatchEvent(new Event('change'));
      actionType.dispatchEvent(new Event('change'));
      loadAutonomyScreen();
    } catch (err) {
      journal(`AUTONOMY_REGLE_ECHEC : ${err.message}`);
    }
  });
}

// --- AURA VOICE (§5.2, §15) --------------------------------------------
// TTS reel (voix Windows locales, Web Speech API). STT sans fournisseur
// branche : la capture micro (MediaRecorder) est reelle, la transcription
// ne l'est pas encore - voir voice.js cote backend.

let voiceMicStream = null;
let voiceMediaRecorder = null;
let voiceListenStartedAt = null;

function populateVoiceSelect(selected) {
  const select = document.getElementById('voice-tts-select');
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const frenchFirst = [...voices].sort((a, b) => (b.lang.startsWith('fr') ? 1 : 0) - (a.lang.startsWith('fr') ? 1 : 0));
  select.innerHTML = '<option value="">Voix par défaut du système</option>' +
    frenchFirst.map((v) => `<option value="${v.name}">${v.name} (${v.lang})</option>`).join('');
  if (selected) select.value = selected;
}

// Interrompt une synthese en cours (§5.2 "detection des interruptions") :
// utilisee avant toute nouvelle parole, qu'elle vienne d'un test manuel
// ou d'une alerte prioritaire.
function stopSpeaking(reason) {
  if (!window.speechSynthesis || !window.speechSynthesis.speaking) return;
  window.speechSynthesis.cancel();
  window.aura.logVoiceStop(reason || 'interruption_barge_in').catch(() => {});
}

function speak(text) {
  if (!window.speechSynthesis || !text || !text.trim()) return;
  stopSpeaking('nouvelle_synthese');
  window.aura.getVoiceConfig().then((cfg) => {
    const utter = new SpeechSynthesisUtterance(text.trim());
    if (cfg.ttsVoice) {
      const voice = window.speechSynthesis.getVoices().find((v) => v.name === cfg.ttsVoice);
      if (voice) utter.voice = voice;
    }
    utter.lang = 'fr-FR';
    window.speechSynthesis.speak(utter);
  });
  window.aura.logVoiceSpeak(text.trim()).catch(() => {});
}

async function speakNewAlerts(alerts) {
  try {
    const cfg = await window.aura.getVoiceConfig();
    if (!cfg.speakAlerts || !alerts.length) return;
    speak(alerts.map((a) => a.cause).join('. '));
  } catch { /* preferences indisponibles, pas de lecture vocale */ }
}

async function loadVoiceScreen() {
  populateVoiceSelect();
  if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => populateVoiceSelect(document.getElementById('voice-tts-select').value);

  try {
    const cfg = await window.aura.getVoiceConfig();
    document.getElementById('voice-wakeword').value = cfg.wakeWord;
    document.getElementById('voice-mic-enabled').checked = cfg.micEnabled;
    document.getElementById('voice-hands-free').checked = cfg.handsFree;
    document.getElementById('voice-speak-alerts').checked = cfg.speakAlerts;
    populateVoiceSelect(cfg.ttsVoice);
    document.getElementById('voice-stt-status').textContent =
      `Fournisseur STT : ${cfg.sttProvider === 'non_configure' ? 'non configuré.' : cfg.sttProvider}`;
    document.getElementById('voice-listen-btn').disabled = !cfg.micEnabled;
  } catch {
    document.getElementById('voice-stt-status').textContent = 'Préférences vocales indisponibles.';
  }
}

async function stopVoiceListening(reason) {
  if (!voiceMediaRecorder) return;
  voiceMediaRecorder.stop();
  if (reason) {
    try { await window.aura.logVoiceStop(reason); } catch { /* pas bloquant */ }
  }
}

function wireVoiceScreen() {
  document.getElementById('voice-wakeword').addEventListener('change', async (e) => {
    await window.aura.setVoiceConfig('wakeWord', e.target.value.trim() || 'AURA');
    journal(`VOICE_MOT_ACTIVATION : ${e.target.value.trim()}`);
  });

  document.getElementById('voice-mic-enabled').addEventListener('change', async (e) => {
    await window.aura.setVoiceConfig('micEnabled', e.target.checked);
    document.getElementById('voice-listen-btn').disabled = !e.target.checked;
    if (!e.target.checked) stopVoiceListening('micro_desactive');
    journal(`VOICE_MICRO_${e.target.checked ? 'ACTIVE' : 'DESACTIVE'}`);
  });

  document.getElementById('voice-hands-free').addEventListener('change', (e) => {
    window.aura.setVoiceConfig('handsFree', e.target.checked);
  });

  document.getElementById('voice-speak-alerts').addEventListener('change', (e) => {
    window.aura.setVoiceConfig('speakAlerts', e.target.checked);
  });

  document.getElementById('voice-tts-select').addEventListener('change', (e) => {
    window.aura.setVoiceConfig('ttsVoice', e.target.value);
  });

  document.getElementById('voice-speak-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = document.getElementById('voice-speak-text').value;
    speak(text);
    document.getElementById('voice-speak-status').textContent = 'AURA parle…';
  });

  document.getElementById('voice-listen-btn').addEventListener('click', async () => {
    const btn = document.getElementById('voice-listen-btn');
    const status = document.getElementById('voice-listen-status');

    if (voiceMediaRecorder && voiceMediaRecorder.state === 'recording') {
      await stopVoiceListening('utilisateur');
      return;
    }

    stopSpeaking('nouvelle_ecoute');
    status.textContent = 'Demande d’accès au microphone…';
    try {
      voiceMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      status.textContent = `Micro indisponible : ${err.message}`;
      try { await window.aura.logVoiceListen({ error: `Accès micro refusé : ${err.message}` }); } catch { /* pas bloquant */ }
      return;
    }

    voiceMediaRecorder = new MediaRecorder(voiceMicStream);
    const chunks = [];
    voiceListenStartedAt = Date.now();
    voiceMediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    voiceMediaRecorder.onstop = async () => {
      const durationMs = Date.now() - voiceListenStartedAt;
      voiceMicStream.getTracks().forEach((t) => t.stop());
      voiceMicStream = null;
      voiceMediaRecorder = null;
      btn.textContent = 'Écouter';
      status.textContent = `Capture reçue (${(durationMs / 1000).toFixed(1)} s) — aucun fournisseur STT configuré, transcription indisponible.`;
      try {
        await window.aura.logVoiceListen({ durationMs, error: 'Aucun fournisseur STT configuré — capture reçue, non transcrite.' });
      } catch (err) {
        status.textContent = err.message;
      }
    };
    voiceMediaRecorder.start();
    btn.textContent = 'Arrêter l’écoute';
    status.textContent = 'En écoute…';
  });
}

// --- AURA EDUCATION (§11.2) --------------------------------------------
// Explications pedagogiques, traduction, tutorat personnalise - tous
// appuyes sur Claude (meme cle que la conversation generale, §5.1).

function renderProgressList(entries) {
  const list = document.getElementById('edu-progress-list');
  if (!entries.length) { list.textContent = 'Aucun suivi enregistré.'; return; }
  list.innerHTML = '';
  [...entries].reverse().forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'task-row';
    const when = new Date(entry.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    row.innerHTML = `<span class="task-title">${entry.topic} <span class="muted small">[${entry.level || '—'}]</span> — ${entry.note}</span><span class="task-due">${when}</span>`;
    list.appendChild(row);
  });
}

async function loadEducationScreen() {
  try {
    renderProgressList(await window.aura.getProgress());
  } catch {
    document.getElementById('edu-progress-list').textContent = 'Historique indisponible.';
  }
}

function wireEducationScreen() {
  document.getElementById('edu-explain-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const topic = document.getElementById('edu-explain-topic').value.trim();
    const level = document.getElementById('edu-explain-level').value;
    const result = document.getElementById('edu-explain-result');
    result.hidden = false;
    result.textContent = 'AURA réfléchit…';
    try {
      const { text } = await window.aura.explainConcept(topic, level);
      result.textContent = text;
      journal(`EDUCATION_EXPLICATION : ${topic}`);
    } catch (err) {
      result.textContent = err.message;
    }
  });

  document.getElementById('edu-translate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = document.getElementById('edu-translate-text').value.trim();
    const targetLang = document.getElementById('edu-translate-target').value.trim();
    const sourceLang = document.getElementById('edu-translate-source').value.trim();
    const result = document.getElementById('edu-translate-result');
    result.hidden = false;
    result.textContent = 'Traduction en cours…';
    try {
      const { text: translated } = await window.aura.translateText(text, targetLang, sourceLang);
      result.textContent = translated;
      journal(`EDUCATION_TRADUCTION : vers ${targetLang}`);
    } catch (err) {
      result.textContent = err.message;
    }
  });

  document.getElementById('edu-tutor-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const topic = document.getElementById('edu-tutor-topic').value.trim();
    const level = document.getElementById('edu-tutor-level').value;
    const note = document.getElementById('edu-tutor-note').value.trim();
    const status = document.getElementById('edu-tutor-status');
    try {
      await window.aura.logTutorEntry(topic, level, note);
      status.textContent = 'Suivi enregistré.';
      journal(`EDUCATION_TUTORAT : ${topic}`);
      e.target.reset();
      document.getElementById('edu-tutor-level').value = 'intermédiaire';
      loadEducationScreen();
    } catch (err) {
      status.textContent = err.message;
    }
  });
}

// --- AURA OFFICE (§11.3) ------------------------------------------------
// Generation de documents Word/Excel/PowerPoint et lecture/fusion/
// remplissage de PDF, entierement en local (docx/exceljs/pptxgenjs/
// pdf-lib cote backend), sans Microsoft Office installe.

let officePdfMergePaths = [];
let officePdfFillPath = null;

async function saveGeneratedFile({ base64, suggestedName }, filters, statusEl) {
  try {
    const result = await window.aura.saveBinaryFile(base64, suggestedName, filters, 'Enregistrer sous');
    statusEl.textContent = result.saved ? `Enregistré : ${result.filePath}` : 'Export annulé.';
    if (result.saved) journal(`OFFICE_EXPORT : ${result.filePath}`);
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

function parseCsvLine(line) {
  return line.split(',').map((cell) => cell.trim());
}

function parsePptxSlides(text) {
  return text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean).map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const [heading, ...rest] = lines;
    return { heading, bullets: rest.map((l) => l.replace(/^-\s*/, '')) };
  });
}

function resetOfficeScreen() {
  officePdfMergePaths = [];
  officePdfFillPath = null;
  document.getElementById('office-pdf-merge-selection').textContent = 'Aucun fichier sélectionné.';
  document.getElementById('office-pdf-merge-btn').disabled = true;
  document.getElementById('office-pdf-fill-selection').textContent = 'Aucun fichier sélectionné.';
  document.getElementById('office-pdf-fill-btn').disabled = true;
}

function wireOfficeScreen() {
  document.getElementById('office-word-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('office-word-title').value.trim();
    const paragraphs = document.getElementById('office-word-paragraphs').value.split('\n').map((p) => p.trim()).filter(Boolean);
    const status = document.getElementById('office-word-status');
    status.textContent = 'Génération…';
    try {
      const doc = await window.aura.createWordDoc(title, paragraphs);
      journal(`OFFICE_WORD_CREE : ${title}`);
      await saveGeneratedFile(doc, [{ name: 'Document Word', extensions: ['docx'] }], status);
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.getElementById('office-excel-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const sheetName = document.getElementById('office-excel-sheet').value.trim() || 'Feuille 1';
    const headersRaw = document.getElementById('office-excel-headers').value.trim();
    const headers = headersRaw ? parseCsvLine(headersRaw) : [];
    const rows = document.getElementById('office-excel-rows').value.split('\n').map((l) => l.trim()).filter(Boolean).map(parseCsvLine);
    const status = document.getElementById('office-excel-status');
    status.textContent = 'Génération…';
    try {
      const doc = await window.aura.createExcelSheet(sheetName, headers, rows);
      journal(`OFFICE_EXCEL_CREE : ${sheetName}`);
      await saveGeneratedFile(doc, [{ name: 'Classeur Excel', extensions: ['xlsx'] }], status);
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.getElementById('office-financial-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('office-financial-title').value.trim() || 'Budget';
    const categories = document.getElementById('office-financial-categories').value.split('\n').map((l) => l.trim()).filter(Boolean);
    const monthLabels = parseCsvLine(document.getElementById('office-financial-months').value.trim()).filter(Boolean);
    const status = document.getElementById('office-financial-status');
    status.textContent = 'Génération…';
    try {
      const doc = await window.aura.createFinancialTemplate(title, categories, monthLabels);
      journal(`OFFICE_MODELE_FINANCIER_CREE : ${title}`);
      await saveGeneratedFile(doc, [{ name: 'Classeur Excel', extensions: ['xlsx'] }], status);
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.getElementById('office-pptx-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('office-pptx-title').value.trim();
    const slides = parsePptxSlides(document.getElementById('office-pptx-slides').value);
    const status = document.getElementById('office-pptx-status');
    status.textContent = 'Génération…';
    try {
      const doc = await window.aura.createPresentation(title, slides);
      journal(`OFFICE_PPTX_CREE : ${title}`);
      await saveGeneratedFile(doc, [{ name: 'Présentation PowerPoint', extensions: ['pptx'] }], status);
    } catch (err) {
      status.textContent = err.message;
    }
  });

  const pdfFilters = [{ name: 'Document PDF', extensions: ['pdf'] }];

  document.getElementById('office-pdf-pick-merge').addEventListener('click', async () => {
    const { paths } = await window.aura.pickFiles(true, pdfFilters, 'Choisir des PDF à fusionner');
    if (paths.length) officePdfMergePaths = paths;
    document.getElementById('office-pdf-merge-selection').textContent =
      officePdfMergePaths.length ? `${officePdfMergePaths.length} fichier(s) sélectionné(s).` : 'Aucun fichier sélectionné.';
    document.getElementById('office-pdf-merge-btn').disabled = officePdfMergePaths.length < 2;
  });

  document.getElementById('office-pdf-merge-btn').addEventListener('click', async () => {
    const status = document.getElementById('office-pdf-merge-status');
    status.textContent = 'Fusion en cours…';
    try {
      const doc = await window.aura.mergePdfs(officePdfMergePaths);
      journal(`OFFICE_PDF_FUSIONNE : ${officePdfMergePaths.length} fichiers`);
      await saveGeneratedFile(doc, pdfFilters, status);
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.getElementById('office-pdf-pick-read').addEventListener('click', async () => {
    const result = document.getElementById('office-pdf-read-result');
    const { paths } = await window.aura.pickFiles(false, pdfFilters, 'Choisir un PDF à lire');
    if (!paths.length) return;
    result.textContent = 'Lecture…';
    try {
      const info = await window.aura.readPdfInfo(paths[0]);
      result.innerHTML = `<div>${paths[0]}</div><div>${info.pageCount} page(s)${info.title ? ` — "${info.title}"` : ''}${info.author ? ` — ${info.author}` : ''}</div>`;
      journal(`OFFICE_PDF_LU : ${info.pageCount} page(s)`);
    } catch (err) {
      result.textContent = err.message;
    }
  });

  document.getElementById('office-pdf-pick-fill').addEventListener('click', async () => {
    const { paths } = await window.aura.pickFiles(false, pdfFilters, 'Choisir un PDF à formulaire');
    if (paths.length) officePdfFillPath = paths[0];
    document.getElementById('office-pdf-fill-selection').textContent = officePdfFillPath || 'Aucun fichier sélectionné.';
    document.getElementById('office-pdf-fill-btn').disabled = !officePdfFillPath;
  });

  document.getElementById('office-pdf-fill-btn').addEventListener('click', async () => {
    const status = document.getElementById('office-pdf-fill-status');
    const fields = {};
    document.getElementById('office-pdf-fill-fields').value.split('\n').forEach((line) => {
      const idx = line.indexOf('=');
      if (idx > 0) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    if (!Object.keys(fields).length) { status.textContent = 'Aucun champ à remplir.'; return; }
    status.textContent = 'Remplissage…';
    try {
      const doc = await window.aura.fillPdfForm(officePdfFillPath, fields);
      journal(`OFFICE_PDF_FORMULAIRE_REMPLI : ${doc.filled.length} champ(s)`);
      if (doc.skipped.length) status.textContent = `Champs introuvables ignorés : ${doc.skipped.join(', ')}`;
      await saveGeneratedFile(doc, pdfFilters, status);
    } catch (err) {
      status.textContent = err.message;
    }
  });
}

render();
startClock();
wirePanels();
wireScreens();
wireMemoryScreen();
wireWorldMap();
wireImageLab();
wireGamingScreen();
wireProductivity();
wireDevScreen();
wireCommScreen();
wireSysmonScreen();
wireAnalyticsScreen();
wireSecurityScreen();
wireAutonomyScreen();
wireVoiceScreen();
wireEducationScreen();
wireOfficeScreen();
wireEmergencyStop();
initConversation();
loadTasks();
loadReminders();
setInterval(pulseRandomActivity, 2600);
setInterval(checkDueReminders, 30000);
