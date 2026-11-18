import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
}

export interface ExtractedCandidateField {
  label: string;
  sampleValue?: string;
}

export interface ExtractedTemplateStructure {
  paragraphs: string[];
  tables: string[][][];
  candidateFields: ExtractedCandidateField[];
  textPreview: string;
  pageCount: number;
  hasTextLayer: boolean;
}

function cleanText(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function extractParagraphText(pElement: Element): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const local = el.localName || el.nodeName.replace(/^.*:/, '');
      if (local === 't' || local === 'delText' || local === 'instrText') {
        out += el.textContent || '';
        return;
      }
      if (local === 'br' || local === 'cr') {
        out += '\n';
        return;
      }
      if (local === 'tab') {
        out += ' ';
        return;
      }
    }
    for (let i = 0; i < node.childNodes.length; i++) {
      walk(node.childNodes[i]);
    }
  };
  walk(pElement);
  return cleanText(out);
}

function extractCandidateFieldsFromStructure(
  paragraphs: string[],
  tables: string[][][]
): ExtractedCandidateField[] {
  const seen = new Set<string>();
  const candidates: ExtractedCandidateField[] = [];

  const pushCandidate = (labelRaw: string, sampleRaw?: string) => {
    const label = cleanText(labelRaw).replace(/[:：]+$/, '');
    if (!label || label.length < 2 || label.length > 90) return;
    if (/^\d+$/.test(label)) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const sampleValue = sampleRaw ? cleanText(sampleRaw).slice(0, 120) : undefined;
    candidates.push({ label, ...(sampleValue ? { sampleValue } : {}) });
  };

  // 1. Extract label -> sample value pairs from tables (very common in notary templates)
  for (const table of tables) {
    for (const row of table) {
      if (row.length >= 2) {
        const first = row[0] || '';
        const second = row[1] || '';
        if (first && first.length <= 90) {
          pushCandidate(first, second);
        }
      }
    }
  }

  // 2. Extract "Field Label: sample value" lines from paragraphs
  for (const para of paragraphs) {
    const lines = para.split('\n');
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 1 && colonIdx < 75) {
        const left = line.slice(0, colonIdx);
        const right = line.slice(colonIdx + 1);
        if (left && !/^https?$/i.test(left.trim())) {
          pushCandidate(left, right);
        }
      }
    }
  }

  return candidates.slice(0, 45);
}

export async function extractStructureFromDocxArrayBuffer(
  buffer: ArrayBuffer
): Promise<ExtractedTemplateStructure> {
  const zip = await JSZip.loadAsync(buffer);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) {
    throw new Error('Внутри .docx отсутствует word/document.xml');
  }

  const xmlText = await docXmlFile.async('string');
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

  const body =
    xmlDoc.getElementsByTagNameNS('*', 'body')[0] || xmlDoc.getElementsByTagName('w:body')[0];

  const paragraphs: string[] = [];
  const tables: string[][][] = [];

  if (body) {
    for (let i = 0; i < body.childNodes.length; i++) {
      const child = body.childNodes[i];
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      const local = el.localName || el.nodeName.replace(/^.*:/, '');

      if (local === 'p') {
        const text = extractParagraphText(el);
        if (text) paragraphs.push(text);
      } else if (local === 'tbl') {
        const rows: string[][] = [];
        const trElements = el.children;
        for (let r = 0; r < trElements.length; r++) {
          const tr = trElements[r];
          const trName = tr.localName || tr.nodeName.replace(/^.*:/, '');
          if (trName !== 'tr') continue;

          const rowCells: string[] = [];
          for (let c = 0; c < tr.children.length; c++) {
            const tc = tr.children[c];
            const tcName = tc.localName || tc.nodeName.replace(/^.*:/, '');
            if (tcName !== 'tc') continue;

            const cellParas: string[] = [];
            for (let p = 0; p < tc.children.length; p++) {
              const pEl = tc.children[p];
              const pName = pEl.localName || pEl.nodeName.replace(/^.*:/, '');
              if (pName === 'p') {
                const pt = extractParagraphText(pEl);
                if (pt) cellParas.push(pt);
              }
            }
            rowCells.push(cellParas.join('\n'));
          }

          if (rowCells.some((cell) => cell.length > 0)) {
            rows.push(rowCells);
          }
        }
        if (rows.length > 0) {
          tables.push(rows.slice(0, 60));
        }
      }
    }
  }

  const candidateFields = extractCandidateFieldsFromStructure(paragraphs, tables);
  const combinedParts = [
    ...paragraphs.slice(0, 20),
    ...tables.slice(0, 3).map((t) =>
      t
        .slice(0, 18)
        .map((r) => r.join(' | '))
        .join('\n')
    ),
  ];
  const textPreview = combinedParts.join('\n\n').slice(0, 3000);

  return {
    paragraphs: paragraphs.slice(0, 60),
    tables: tables.slice(0, 6),
    candidateFields,
    textPreview,
    pageCount: 1,
    hasTextLayer: true,
  };
}

export async function extractStructureFromPdfArrayBuffer(
  buffer: ArrayBuffer
): Promise<ExtractedTemplateStructure> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
    cMapPacked: true,
  });

  const pdfDoc = await loadingTask.promise;
  const pageCount = pdfDoc.numPages;
  const maxPagesToRead = Math.min(pageCount, 6);
  const paragraphs: string[] = [];

  for (let p = 1; p <= maxPagesToRead; p++) {
    const page = await pdfDoc.getPage(p);
    const textContent = await page.getTextContent();
    const lines: Array<{ y: number; items: Array<{ x: number; text: string }> }> = [];

    for (const rawItem of textContent.items as any[]) {
      const str = typeof rawItem?.str === 'string' ? rawItem.str : '';
      if (!str.trim()) continue;
      const x = Array.isArray(rawItem.transform) ? Number(rawItem.transform[4]) || 0 : 0;
      const y = Array.isArray(rawItem.transform) ? Number(rawItem.transform[5]) || 0 : 0;

      const existingLine = lines.find((l) => Math.abs(l.y - y) < 4);
      if (existingLine) {
        existingLine.items.push({ x, text: str });
      } else {
        lines.push({ y, items: [{ x, text: str }] });
      }
    }

    lines.sort((a, b) => b.y - a.y);
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      const joined = cleanText(line.items.map((it) => it.text).join(' '));
      if (joined) paragraphs.push(joined);
    }
  }

  const totalChars = paragraphs.join('').replace(/\s+/g, '').length;
  const hasTextLayer = totalChars >= 25;
  const candidateFields = hasTextLayer ? extractCandidateFieldsFromStructure(paragraphs, []) : [];
  const textPreview = hasTextLayer
    ? paragraphs.slice(0, 50).join('\n').slice(0, 3000)
    : `[Скан PDF без встроенного текстового слоя · стр.: ${pageCount}]`;

  return {
    paragraphs: paragraphs.slice(0, 80),
    tables: [],
    candidateFields,
    textPreview,
    pageCount,
    hasTextLayer,
  };
}
