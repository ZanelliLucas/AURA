// Connecteur AURA OFFICE (§11.3). Generation/edition de documents en
// local via des bibliotheques pures JS (docx, exceljs, pptxgenjs,
// pdf-lib) - aucun service cloud, aucune dependance a une installation
// de Microsoft Office. Chaque fonction retourne un Buffer ; l'export
// vers un emplacement choisi par l'utilisateur est gere cote main.js
// (boite de dialogue native, meme principe que l'export d'AURA IMAGE LAB).
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');
const ExcelJS = require('exceljs');
const PptxGenJS = require('pptxgenjs');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');

// Word / Excel / PowerPoint : "Creation et edition de documents,
// tableurs et presentations" (§11.3).

async function createWordDocument({ title, paragraphs }) {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
        ...paragraphs.map((p) => new Paragraph({ text: p }))
      ]
    }]
  });
  return Packer.toBuffer(doc);
}

async function createExcelWorkbook({ sheetName, headers, rows }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName || 'Feuille 1');
  if (headers?.length) {
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true };
  }
  rows.forEach((row) => sheet.addRow(row));
  sheet.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      max = Math.max(max, String(cell.value ?? '').length + 2);
    });
    col.width = max;
  });
  return workbook.xlsx.writeBuffer();
}

// "Tableurs & modeles financiers -- feuilles de calcul et modeles
// chiffres reutilisables" (§11.3) : modele budgetaire avec de vraies
// formules (somme par categorie, total general), pas des valeurs figees.
async function createFinancialTemplate({ title, categories, monthLabels }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title || 'Modèle financier');

  const headerRow = ['Catégorie', ...monthLabels, 'Total'];
  sheet.addRow(headerRow);
  sheet.getRow(1).font = { bold: true };

  const firstDataRow = 2;
  categories.forEach((category, idx) => {
    const rowNum = firstDataRow + idx;
    const monthCols = monthLabels.map((_, i) => 0);
    const rowValues = [category, ...monthCols];
    sheet.addRow(rowValues);
    const firstMonthCol = 2;
    const lastMonthCol = firstMonthCol + monthLabels.length - 1;
    const startLetter = sheet.getColumn(firstMonthCol).letter;
    const endLetter = sheet.getColumn(lastMonthCol).letter;
    sheet.getCell(rowNum, lastMonthCol + 1).value = { formula: `SUM(${startLetter}${rowNum}:${endLetter}${rowNum})` };
  });

  const totalRow = firstDataRow + categories.length;
  sheet.getCell(totalRow, 1).value = 'Total';
  sheet.getRow(totalRow).font = { bold: true };
  for (let col = 2; col <= monthLabels.length + 2; col++) {
    const letter = sheet.getColumn(col).letter;
    sheet.getCell(totalRow, col).value = { formula: `SUM(${letter}${firstDataRow}:${letter}${totalRow - 1})` };
  }

  sheet.columns.forEach((col) => { col.width = 16; });
  return workbook.xlsx.writeBuffer();
}

async function createPresentation({ title, slides }) {
  const pres = new PptxGenJS();

  const titleSlide = pres.addSlide();
  titleSlide.addText(title, { x: 0.5, y: 2, w: 9, h: 1.5, fontSize: 32, bold: true, align: 'center' });

  slides.forEach((slide) => {
    const s = pres.addSlide();
    s.addText(slide.heading, { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 24, bold: true });
    if (slide.bullets?.length) {
      s.addText(
        slide.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.5, y: 1.3, w: 9, h: 4.5, fontSize: 18 }
      );
    }
  });

  return pres.write({ outputType: 'nodebuffer' });
}

// PDF : "Lecture, fusion, remplissage de formulaires, export" (§11.3).

async function mergePdfFiles(paths) {
  const merged = await PDFDocument.create();
  for (const filePath of paths) {
    const bytes = fs.readFileSync(filePath);
    const source = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return Buffer.from(await merged.save());
}

async function readPdfInfo(filePath) {
  const bytes = fs.readFileSync(filePath);
  const doc = await PDFDocument.load(bytes);
  return {
    pageCount: doc.getPageCount(),
    title: doc.getTitle() || null,
    author: doc.getAuthor() || null,
    creationDate: doc.getCreationDate()?.toISOString() || null
  };
}

async function fillPdfForm(filePath, fields) {
  const bytes = fs.readFileSync(filePath);
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const filled = [];
  const skipped = [];
  for (const [name, value] of Object.entries(fields)) {
    try {
      form.getTextField(name).setText(String(value));
      filled.push(name);
    } catch {
      skipped.push(name);
    }
  }
  return { bytes: Buffer.from(await doc.save()), filled, skipped };
}

module.exports = {
  createWordDocument,
  createExcelWorkbook,
  createFinancialTemplate,
  createPresentation,
  mergePdfFiles,
  readPdfInfo,
  fillPdfForm
};
