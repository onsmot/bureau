import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  AlignmentType,
  Header,
  Footer,
  PageNumber,
} from 'docx';
import { DocumentTranslationData } from '../types/document';

// Safe browser-native file download with multiple fallback strategies
function saveBlob(blob: Blob, filename: string) {
  try {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.target = '_self';
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      try {
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
        window.URL.revokeObjectURL(url);
      } catch {
        // Safe cleanup
      }
    }, 1000);
  } catch (err) {
    console.error('Failed to trigger download via object URL, using reader fallback:', err);
    try {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const link = document.createElement('a');
          link.href = reader.result;
          link.download = filename;
          link.target = '_self';
          document.body.appendChild(link);
          link.click();
          setTimeout(() => {
            if (document.body.contains(link)) {
              document.body.removeChild(link);
            }
          }, 1000);
        }
      };
      reader.readAsDataURL(blob);
    } catch (readerErr) {
      console.error('All download methods failed:', readerErr);
      throw new Error('Не удалось автоматически сохранить файл. Разрешите скачивание в настройках браузера.');
    }
  }
}

export async function generateDocx(
  data: DocumentTranslationData,
  _translatorName?: string,
  _licenseNumber?: string,
  _includeNotaryBlock?: boolean
): Promise<Blob> {
  const safeSourceCountry = (data.sourceCountry || 'ДОКУМЕНТ').toUpperCase();
  const safeSourceLang = (data.sourceLanguage || 'ИНОСТРАННЫЙ ЯЗЫК').toUpperCase();
  const safeTargetLang = (data.targetLanguage || 'РУССКИЙ ЯЗЫК').toUpperCase();
  const safeDocNum = data.documentNumber || 'Б/Н';

  // Table rows with alternating background
  const tableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: 3600, type: WidthType.DXA },
          shading: { fill: '0F172A' },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Реквизит оригинала / Field',
                  bold: true,
                  color: 'FFFFFF',
                  size: 20,
                  font: 'Times New Roman',
                }),
              ],
            }),
          ],
        }),
        new TableCell({
          width: { size: 5400, type: WidthType.DXA },
          shading: { fill: '0F172A' },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Перевод на русский язык / Translation',
                  bold: true,
                  color: 'FFFFFF',
                  size: 20,
                  font: 'Times New Roman',
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ];

  // Add field rows (ensure non-empty text)
  const fields = data.fields && data.fields.length > 0 ? data.fields : [
    {
      id: 'default-f',
      key: 'general_text',
      labelOriginal: 'Текст документа',
      labelTranslated: 'Текст документа',
      valueOriginal: 'Данные документа',
      valueTranslated: 'Данные документа',
      confidence: 1.0,
      category: 'personal' as const,
    },
  ];

  fields.forEach((field, index) => {
    const isEven = index % 2 === 0;
    const bgFill = isEven ? 'F8FAFC' : 'FFFFFF';
    const labelText = String(field.labelTranslated || field.labelOriginal || '').trim() || `Реквизит ${index + 1}`;
    const valueText = String(field.valueTranslated || field.valueOriginal || '').trim() || '—';

    tableRows.push(
      new TableRow({
        children: [
          new TableCell({
            width: { size: 3600, type: WidthType.DXA },
            shading: { fill: bgFill },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: labelText,
                    bold: true,
                    size: 20,
                    font: 'Times New Roman',
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 5400, type: WidthType.DXA },
            shading: { fill: bgFill },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: valueText,
                    size: 20,
                    font: 'Times New Roman',
                  }),
                ],
              }),
            ],
          }),
        ],
      })
    );
  });

  // Stamps paragraphs
  const stampsParagraphs: Paragraph[] = [];
  if (data.stampsAndSeals && data.stampsAndSeals.length > 0) {
    stampsParagraphs.push(
      new Paragraph({
        spacing: { before: 240, after: 120 },
        children: [
          new TextRun({
            text: 'ПЕЧАТИ, ШТАМПЫ И ОСОБЫЕ ОТМЕТКИ / SEALS AND ENDORSEMENTS',
            bold: true,
            size: 22,
            font: 'Times New Roman',
          }),
        ],
      })
    );

    data.stampsAndSeals.forEach((seal, idx) => {
      const sealType = String(seal.type || 'STAMP').toUpperCase();
      const sealText = String(seal.translation || seal.transcription || 'Текст печати').trim() || 'Текст печати';
      stampsParagraphs.push(
        new Paragraph({
          spacing: { after: 100 },
          children: [
            new TextRun({
              text: `[${idx + 1}] `,
              bold: true,
              size: 20,
              font: 'Times New Roman',
            }),
            new TextRun({
              text: `[${sealType}] `,
              italics: true,
              color: '475569',
              size: 19,
              font: 'Times New Roman',
            }),
            new TextRun({
              text: sealText,
              size: 20,
              font: 'Times New Roman',
            }),
          ],
        })
      );
    });
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: 'БЮРО ПЕРЕВОДОВ «LINGUADOC»  ·  ОФИЦИАЛЬНЫЙ СЕРТИФИЦИРОВАННЫЙ ПЕРЕВОД',
                    size: 16,
                    color: '94A3B8',
                    font: 'Times New Roman',
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: 'Стр. ',
                    size: 16,
                    color: '94A3B8',
                    font: 'Times New Roman',
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    color: '94A3B8',
                    font: 'Times New Roman',
                  }),
                  new TextRun({
                    text: ' из ',
                    size: 16,
                    color: '94A3B8',
                    font: 'Times New Roman',
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 16,
                    color: '94A3B8',
                    font: 'Times New Roman',
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          // Title
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: 'ПЕРЕВОД ОФИЦИАЛЬНОГО ДОКУМЕНТА',
                bold: true,
                size: 24,
                font: 'Times New Roman',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            children: [
              new TextRun({
                text: `(Перевод выполнен с языка: ${safeSourceLang} на: ${safeTargetLang})`,
                italics: true,
                size: 20,
                color: '475569',
                font: 'Times New Roman',
              }),
            ],
          }),

          // Emblem & Country
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: `[Государственный герб / National Emblem]`,
                italics: true,
                size: 18,
                color: '64748B',
                font: 'Times New Roman',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: `${safeSourceCountry} · ${safeDocNum}`,
                bold: true,
                size: 22,
                font: 'Times New Roman',
              }),
            ],
          }),

          // Document fields table
          new Table({
            width: { size: 9000, type: WidthType.DXA },
            rows: tableRows,
          }),

          // Stamps and seals
          ...stampsParagraphs,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  return blob;
}

export async function downloadDocumentAsDocx(
  data: DocumentTranslationData,
  translatorName?: string,
  licenseNumber?: string,
  includeNotaryBlock?: boolean
): Promise<string> {
  if (!data) {
    throw new Error('Данные для формирования документа отсутствуют.');
  }
  const blob = await generateDocx(data, translatorName, licenseNumber, includeNotaryBlock);
  if (!blob || blob.size === 0) {
    throw new Error('Ошибка генерации: сформированный файл пуст.');
  }
  const cleanType = (data.documentType || 'document').replace(/[^a-zA-Z0-9_\u0400-\u04FF]/g, '_');
  const cleanNum = (data.documentNumber || 'doc').replace(/[^a-zA-Z0-9_\u0400-\u04FF]/g, '_');
  const filename = `${cleanType}_${cleanNum}_perevod.docx`;
  saveBlob(blob, filename);
  return filename;
}
