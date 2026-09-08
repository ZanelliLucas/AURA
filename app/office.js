// Connecteur Office (§11.3). Comme AURA EDUCATION, le §15 ne liste pas
// de famille d'actions dediee pour ce module : les noms ci-dessous
// suivent le style etabli (office.<format>_<action>). Chaque fonction
// journalise puis renvoie le document genere en base64 - l'ecriture
// reelle sur disque (boite de dialogue "Enregistrer sous") est geree
// cote renderer/main.js, comme pour l'export d'AURA IMAGE LAB.
const store = require('./store');
const office = require('./connectors/office');

function toBase64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

// office.word_create (§11.3, Reversible)
async function createWord({ title, paragraphs }) {
  if (!title || !title.trim()) throw new Error('Titre du document manquant.');
  const buffer = await office.createWordDocument({ title: title.trim(), paragraphs: paragraphs || [] });
  store.logAction({
    typeAction: 'office.word_create', sensibilite: 'reversible', statut: 'execute',
    details: { title: title.trim(), paragraphs: (paragraphs || []).length }
  });
  return { base64: toBase64(buffer), suggestedName: `${title.trim()}.docx` };
}

// office.excel_create (§11.3, Reversible)
async function createExcel({ sheetName, headers, rows }) {
  if (!rows || !rows.length) throw new Error('Aucune donnée à mettre dans le tableur.');
  const buffer = await office.createExcelWorkbook({ sheetName: sheetName || 'Feuille 1', headers: headers || [], rows });
  store.logAction({
    typeAction: 'office.excel_create', sensibilite: 'reversible', statut: 'execute',
    details: { sheetName: sheetName || 'Feuille 1', rows: rows.length }
  });
  return { base64: toBase64(buffer), suggestedName: `${sheetName || 'tableur'}.xlsx` };
}

// office.excel_financial_template (§11.3, Reversible) : "modeles
// chiffres reutilisables" - formules reelles, pas des valeurs figees.
async function createFinancialTemplate({ title, categories, monthLabels }) {
  if (!categories || !categories.length) throw new Error('Aucune catégorie fournie.');
  if (!monthLabels || !monthLabels.length) throw new Error('Aucune colonne (mois) fournie.');
  const buffer = await office.createFinancialTemplate({
    title: title || 'Modèle financier', categories, monthLabels
  });
  store.logAction({
    typeAction: 'office.excel_financial_template', sensibilite: 'reversible', statut: 'execute',
    details: { title: title || 'Modèle financier', categories: categories.length, months: monthLabels.length }
  });
  return { base64: toBase64(buffer), suggestedName: `${title || 'modele-financier'}.xlsx` };
}

// office.pptx_create (§11.3, Reversible)
async function createPresentation({ title, slides }) {
  if (!title || !title.trim()) throw new Error('Titre de la présentation manquant.');
  if (!slides || !slides.length) throw new Error('Aucune diapositive fournie.');
  const buffer = await office.createPresentation({ title: title.trim(), slides });
  store.logAction({
    typeAction: 'office.pptx_create', sensibilite: 'reversible', statut: 'execute',
    details: { title: title.trim(), slides: slides.length }
  });
  return { base64: toBase64(buffer), suggestedName: `${title.trim()}.pptx` };
}

// office.pdf_merge (§11.3, Reversible)
async function mergePdfs(paths) {
  if (!paths || paths.length < 2) throw new Error('Sélectionne au moins deux fichiers PDF à fusionner.');
  try {
    const buffer = await office.mergePdfFiles(paths);
    store.logAction({
      typeAction: 'office.pdf_merge', sensibilite: 'reversible', statut: 'execute',
      details: { fileCount: paths.length }
    });
    return { base64: toBase64(buffer), suggestedName: 'fusion.pdf' };
  } catch (err) {
    store.logAction({ typeAction: 'office.pdf_merge', sensibilite: 'reversible', statut: 'echoue', details: { error: err.message } });
    throw new Error(`Fusion PDF échouée : ${err.message}`);
  }
}

// office.pdf_read (§11.3, Lecture)
async function readPdf(filePath) {
  if (!filePath) throw new Error('Aucun fichier sélectionné.');
  try {
    const info = await office.readPdfInfo(filePath);
    store.logAction({ typeAction: 'office.pdf_read', sensibilite: 'lecture', statut: 'execute', details: info });
    return info;
  } catch (err) {
    store.logAction({ typeAction: 'office.pdf_read', sensibilite: 'lecture', statut: 'echoue', details: { error: err.message } });
    throw new Error(`Lecture PDF échouée : ${err.message}`);
  }
}

// office.pdf_fill_form (§11.3, Reversible)
async function fillPdfForm({ filePath, fields }) {
  if (!filePath) throw new Error('Aucun fichier sélectionné.');
  if (!fields || !Object.keys(fields).length) throw new Error('Aucun champ à remplir.');
  try {
    const { bytes, filled, skipped } = await office.fillPdfForm(filePath, fields);
    store.logAction({
      typeAction: 'office.pdf_fill_form', sensibilite: 'reversible', statut: 'execute',
      details: { filled, skipped }
    });
    return { base64: toBase64(bytes), suggestedName: 'formulaire-rempli.pdf', filled, skipped };
  } catch (err) {
    store.logAction({ typeAction: 'office.pdf_fill_form', sensibilite: 'reversible', statut: 'echoue', details: { error: err.message } });
    throw new Error(`Remplissage du formulaire échoué : ${err.message}`);
  }
}

module.exports = {
  createWord,
  createExcel,
  createFinancialTemplate,
  createPresentation,
  mergePdfs,
  readPdf,
  fillPdfForm
};
