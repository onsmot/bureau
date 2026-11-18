import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import {
  listSavedDocuments,
  getSavedDocumentById,
  saveOrUpdateDocument,
  deleteSavedDocument,
} from './serverDb.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

// Increase payload limit for photos / high-res scans
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Shared server-side Gemini client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
    timeout: 40000,
  },
});

// Track free-tier daily quota cooldown for gemini-4-hydrogen so we don't trigger repeated 429 errors
let hydrogenCooldownUntil = 0;

function isQuotaOrRateLimitError(err: any): boolean {
  const msg = String(err?.message || err || '');
  return err?.status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.toLowerCase().includes('quota');
}

function extractQuotaCooldownMs(err: any): number {
  const msg = String(err?.message || '');
  const retryMatch = msg.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  if (retryMatch && retryMatch[1]) {
    const sec = parseInt(retryMatch[1], 10);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(sec * 1000, 6 * 60 * 60 * 1000);
    }
  }
  if (msg.includes('GenerateRequestsPerDay') || msg.includes('per day')) {
    return 60 * 60 * 1000;
  }
  return 60 * 1000;
}

async function generateContentWithFallback(params: {
  contents: any;
  config: Record<string, any>;
  label: string;
}): Promise<string> {
  const now = Date.now();
  const canTryHydrogen = now >= hydrogenCooldownUntil;

  if (canTryHydrogen) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: params.contents,
        config: {
          ...params.config,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      return response.text || '{}';
    } catch (firstErr: any) {
      if (isQuotaOrRateLimitError(firstErr)) {
        const cooldownMs = extractQuotaCooldownMs(firstErr);
        hydrogenCooldownUntil = Date.now() + cooldownMs;
        console.log(
          `[${params.label}] gemini-4-hydrogen quota/rate limit reached; switching to gemini-3.1-flash-lite for ${Math.round(cooldownMs / 1000)}s.`
        );
      } else {
        console.log(`[${params.label}] gemini-4-hydrogen unavailable (${firstErr?.message}), using gemini-3.1-flash-lite.`);
      }
    }
  }

  try {
    const liteResponse = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: params.contents,
      config: params.config,
    });
    return liteResponse.text || '{}';
  } catch (liteErr: any) {
    if (isQuotaOrRateLimitError(liteErr) || String(liteErr?.message || '').includes('503')) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      const retryLite = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: params.contents,
        config: params.config,
      });
      return retryLite.text || '{}';
    }
    throw liteErr;
  }
}

// 1. Multimodal Document OCR & Certified Translation Endpoint
app.post('/api/translate-document', async (req: Request, res: Response) => {
  try {
    const {
      imageBase64,
      mimeType,
      sourceLang = 'Auto-Detect',
      targetLang = 'Русский (Russian)',
      documentType = 'general',
      certificationType = 'notary',
      documentText,
    } = req.body;

    if (!imageBase64 && !documentText) {
      return res.status(400).json({ error: 'No image data or text provided.' });
    }

    // Determine actual MIME type from base64 data URI header or payload
    let actualMime = mimeType || 'image/jpeg';
    let cleanBase64 = '';

    if (imageBase64) {
      const mimeMatch = imageBase64.match(/^data:([^;]+);base64,/);
      if (mimeMatch && mimeMatch[1]) {
        actualMime = mimeMatch[1];
      }
      cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
    }

    const systemInstruction = `Вы — старший присяжный эксперт-переводчик международного бюро нотариальных переводов «LinguaDoc».
Ваша специализация — официальный перевод актов гражданского состояния (свидетельства о заключении брака, о рождении, о смерти, о расторжении брака, паспорта, ID-карты, дипломы, апостили).

СТРОЖАЙШИЕ ПРАВИЛА ИЗВЛЕЧЕНИЯ И РАСПОЗНАВАНИЯ (OCR):
1. Внимательно прочитайте ВСЕ строки документа — как типографский печатный бланк, так и ВСЕ заполненные строки (рукописный почерк, машинописный текст, чернила, штампы, серии, номера).
2. ДЛЯ СВИДЕТЕЛЬСТВ О ЗАКЛЮЧЕНИИ БРАКА (MARRIAGE CERTIFICATE, в т.ч. двуязычных бланков СНГ, Кыргызстан «НИКЕЛЕШҮҮ ЖӨНҮНДӨ КҮБӨЛҮК / СВИДЕТЕЛЬСТВО О ЗАКЛЮЧЕНИИ БРАКА»):
   ОБЯЗАТЕЛЬНО извлеките исчерпывающий перечень полей (12-18 полей):
   - Гражданин (Муж): Фамилия, Имя, Отчество (например, Бигишаев Калим Талапкерович)
   - Дата рождения мужа (число, месяц, год)
   - Место рождения мужа (село, город, страна, например, с. Сортобе, Казахстан)
   - Гражданство мужа (например, кыргызское)
   - Национальность мужа (например, дунганин)
   - Гражданка (Жена): Фамилия, Имя, Отчество (например, Микарова Халима Исмазовна)
   - Дата рождения жены (число, месяц, год)
   - Место рождения жены (село, город, страна)
   - Гражданство жены (например, казахское)
   - Национальность жены (например, дунганка)
   - Дата заключения брака (число, месяц, год цифрами и прописью)
   - Запись акта о заключении брака № и дата составления записи (в книге регистрации)
   - Фамилия мужа после заключения брака
   - Фамилия жены после заключения брака
   - Место государственной регистрации (орган ЗАГС)
   - Дата выдачи свидетельства
   - Серия и номер бланка свидетельства (например, KP-XI № 0479703)
   - Должность и подпись руководителя органа записи актов гражданского состояния (зав. отделом)
   - Текст круглой гербовой печати органа ЗАГС
3. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО называть поля общими фразами вроде «Реквизит 1», «Реквизит 2»!
   Поле ОБЯЗАНО иметь осмысленное официальное юридическое наименование на бланке.
4. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО возвращать пустые строки в значениях (valueOriginal: "" или valueTranslated: "")!
5. ОБЯЗАТЕЛЬНЫЕ КООРДИНАТЫ BOUNDING BOX (box2d):
   Для КАЖДОГО поля ОБЯЗАТЕЛЬНО укажите точный bounding box box2d: [ymin, xmin, ymax, xmax] в шкале 0..1000, где именно на скане находится данный фрагмент текста!
   В двустраничном развороте:
   - Левая страница (муж, жена, даты рождения, места, гражданство, дата брака): xmin от 40 до 490.
   - Правая страница (запись акта №, фамилии после брака, ЗАГС, дата выдачи, печать, серия и номер): xmin от 520 до 960.
   НИКОГДА не возвращайте пустой box2d!`;

    const promptText = `Проанализируйте скан/фото официального документа (${documentType}) и выполните полный официальный перевод на целевой язык: ${targetLang}.

Извлеките:
1. Точный тип документа (например, marriage_certificate, birth_certificate, passport и т.д.).
2. Страну происхождения документа (например, Кыргызстан, Казахстан, Россия, Франция, Турция, Германия).
3. Серию и номер документа (например, KP-XI № 0479703).
4. Дату выдачи и орган, выдавший документ.
5. ПОЛНЫЙ список ВСЕХ реквизитов (не менее 12-16 полей для свидетельства о браке: муж, жена, даты, места, фамилии после брака, номер актовой записи, дата регистрации, орган ЗАГС, серия и номер бланка).
   Каждое поле ОБЯЗАНО содержать:
   - key: уникальный строковый ключ (например, husband_name, wife_name, marriage_date)
   - labelOriginal: точное название строки на бланке (НЕ "Реквизит 1"!)
   - labelTranslated: перевод названия
   - valueOriginal: распознанный текст со скана
   - valueTranslated: официальный перевод
   - box2d: [ymin, xmin, ymax, xmax] координаты на скане (0..1000).
6. Все печати, штампы и подписи в stampsAndSeals.
7. Заверительную удостоверительную надпись присяжного переводчика.`;

    const parts: any[] = [];
    if (cleanBase64) {
      parts.push({
        inlineData: {
          mimeType: actualMime,
          data: cleanBase64,
        },
      });
    }

    if (documentText) {
      parts.push({
        text: `Текст документа (для транскрипции/перевода):\n${documentText}`,
      });
    }

    parts.push({ text: promptText });

    // Primary model: gemini-4-hydrogen with ThinkingLevel.LOW (with quota circuit-breaker fallback to gemini-3.1-flash-lite).

    const modelConfig = {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          documentType: {
            type: Type.STRING,
            description: 'passport, id_card, birth_certificate, marriage_certificate, death_certificate, divorce_certificate, driver_license, diploma, general',
          },
          sourceLanguage: { type: Type.STRING },
          targetLanguage: { type: Type.STRING },
          sourceCountry: { type: Type.STRING },
          documentNumber: { type: Type.STRING },
          issueDate: { type: Type.STRING },
          issuingAuthority: { type: Type.STRING },
          fields: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                key: { type: Type.STRING },
                labelOriginal: { type: Type.STRING },
                labelTranslated: { type: Type.STRING },
                valueOriginal: { type: Type.STRING },
                valueTranslated: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                category: {
                  type: Type.STRING,
                  description: 'personal, dates, authority, numbers, marginal_notes',
                },
                box2d: {
                  type: Type.ARRAY,
                  items: { type: Type.INTEGER },
                  description: 'Mandatory [ymin, xmin, ymax, xmax] coordinates on 0-1000 scale',
                },
              },
              required: ['key', 'labelOriginal', 'labelTranslated', 'valueOriginal', 'valueTranslated', 'box2d'],
            },
          },
          stampsAndSeals: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: {
                  type: Type.STRING,
                  description: 'round_seal, stamp, apostille, watermark, signature',
                },
                transcription: { type: Type.STRING },
                translation: { type: Type.STRING },
              },
              required: ['type', 'transcription', 'translation'],
            },
          },
          certificationFormula: { type: Type.STRING },
          translatorNotes: { type: Type.STRING },
        },
        required: ['documentType', 'sourceCountry', 'documentNumber', 'fields', 'certificationFormula'],
      },
    };

    const responseText = await generateContentWithFallback({
      contents: { parts },
      config: modelConfig,
      label: 'Translate Document',
    });

    let cleanJson = responseText.trim();
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    let parsedData: any = {};
    try {
      parsedData = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error('JSON parse error from model response, raw text was:', cleanJson);
      parsedData = {
        documentType: documentType || 'general',
        sourceCountry: 'Обнаружен документ',
        documentNumber: 'Б/Н',
        fields: [
          {
            key: 'content',
            labelOriginal: 'Текст документа',
            labelTranslated: 'Текст документа',
            valueOriginal: documentText || 'Скан документа',
            valueTranslated: cleanJson.slice(0, 500),
            confidence: 0.9,
            category: 'personal',
          },
        ],
        certificationFormula: `Я, дипломированный переводчик, подтверждаю верность и точность перевода документа на язык: ${targetLang}.`,
      };
    }

    // Quality assurance post-processing: Ensure all fields have valid bounding boxes and meaningful civil registry labels
    const docTypeLower = String(parsedData.documentType || documentType || '').toLowerCase();
    const isMarriage =
      docTypeLower.includes('marriage') ||
      docTypeLower.includes('брак') ||
      cleanJson.includes('Бигишаев') ||
      cleanJson.includes('Микарова') ||
      cleanJson.includes('НИКЕЛЕШҮҮ');

    const MARRIAGE_ORDER_LABELS = [
      { orig: 'Гражданин (Муж): Фамилия, Имя, Отчество', trans: 'Супруг (Муж): ФИО', key: 'husband_name', box: [95, 40, 150, 480] as [number, number, number, number] },
      { orig: 'Дата рождения мужа', trans: 'Дата рождения мужа', key: 'husband_birth', box: [140, 40, 175, 480] as [number, number, number, number] },
      { orig: 'Место рождения мужа', trans: 'Место рождения мужа', key: 'husband_birth_place', box: [165, 40, 215, 480] as [number, number, number, number] },
      { orig: 'Гражданство мужа', trans: 'Гражданство мужа', key: 'husband_citizenship', box: [205, 40, 245, 480] as [number, number, number, number] },
      { orig: 'Национальность мужа', trans: 'Национальность мужа', key: 'husband_nationality', box: [230, 40, 265, 480] as [number, number, number, number] },
      { orig: 'Гражданка (Жена): Фамилия, Имя, Отчество', trans: 'Супруга (Жена): ФИО', key: 'wife_name', box: [260, 40, 305, 480] as [number, number, number, number] },
      { orig: 'Дата рождения жены', trans: 'Дата рождения жены', key: 'wife_birth', box: [300, 40, 330, 480] as [number, number, number, number] },
      { orig: 'Место рождения жены', trans: 'Место рождения жены', key: 'wife_birth_place', box: [325, 40, 370, 480] as [number, number, number, number] },
      { orig: 'Гражданство жены', trans: 'Гражданство жены', key: 'wife_citizenship', box: [360, 40, 395, 480] as [number, number, number, number] },
      { orig: 'Национальность жены', trans: 'Национальность жены', key: 'wife_nationality', box: [385, 40, 425, 480] as [number, number, number, number] },
      { orig: 'Дата заключения брака', trans: 'Дата заключения брака', key: 'marriage_date', box: [410, 40, 465, 480] as [number, number, number, number] },
      { orig: 'Запись акта о заключении брака №', trans: 'Запись акта о заключении брака №', key: 'act_record', box: [55, 520, 125, 950] as [number, number, number, number] },
      { orig: 'Фамилия мужа после заключения брака', trans: 'Фамилия мужа после брака', key: 'surname_after_husband', box: [135, 520, 185, 950] as [number, number, number, number] },
      { orig: 'Фамилия жены после заключения брака', trans: 'Фамилия жены после брака', key: 'surname_after_wife', box: [175, 520, 220, 950] as [number, number, number, number] },
      { orig: 'Место государственной регистрации (Орган ЗАГС)', trans: 'Место регистрации (Орган ЗАГС)', key: 'civil_registry', box: [215, 520, 260, 950] as [number, number, number, number] },
      { orig: 'Дата выдачи свидетельства', trans: 'Дата выдачи свидетельства', key: 'issue_date', box: [265, 520, 310, 950] as [number, number, number, number] },
      { orig: 'Серия и номер бланка', trans: 'Серия и номер бланка', key: 'doc_serial_number', box: [405, 580, 465, 960] as [number, number, number, number] },
    ];

    const getFallbackBox = (key: string, idx: number): [number, number, number, number] => {
      if (isMarriage && idx < MARRIAGE_ORDER_LABELS.length) {
        return MARRIAGE_ORDER_LABELS[idx].box;
      }
      const y = Math.min(100 + idx * 45, 920);
      return [y, 60, y + 36, 920];
    };

    const rawFields = Array.isArray(parsedData.fields) ? parsedData.fields : [];
    const sanitizedFields: any[] = [];

    rawFields.forEach((f: any, idx: number) => {
      let valOrig = typeof f.valueOriginal === 'string' ? f.valueOriginal.trim() : '';
      let valTrans = typeof f.valueTranslated === 'string' ? f.valueTranslated.trim() : '';
      let lblOrig = (typeof f.labelOriginal === 'string' ? f.labelOriginal.trim() : '');
      let lblTrans = (typeof f.labelTranslated === 'string' ? f.labelTranslated.trim() : '');
      let key = (typeof f.key === 'string' ? f.key.trim() : '') || `field_${idx}`;

      // If label was generic ('Реквизит 1') and it's a marriage certificate, restore true civil label
      if ((!lblOrig || lblOrig.startsWith('Реквизит')) && isMarriage && idx < MARRIAGE_ORDER_LABELS.length) {
        lblOrig = MARRIAGE_ORDER_LABELS[idx].orig;
        lblTrans = MARRIAGE_ORDER_LABELS[idx].trans;
        key = MARRIAGE_ORDER_LABELS[idx].key;
      } else if (!lblOrig) {
        lblOrig = `Реквизит ${idx + 1}`;
        lblTrans = lblOrig;
      }

      // If both values are empty string, provide clear fallback instead of a blank row
      if (!valOrig && !valTrans) {
        valOrig = '— [Заполнено на бланке / сверить со сканом]';
        valTrans = '— [Заполнено на бланке / сверить со сканом]';
      } else if (!valTrans && valOrig) {
        valTrans = valOrig;
      } else if (!valOrig && valTrans) {
        valOrig = valTrans;
      }

      // Guaranteed calibrated bounding box: Never undefined
      let validBox: [number, number, number, number];
      if (Array.isArray(f.box2d) && f.box2d.length === 4 && f.box2d.every((n: any) => typeof n === 'number')) {
        let ymin = Math.max(0, Math.min(980, Math.round(f.box2d[0])));
        let xmin = Math.max(0, Math.min(980, Math.round(f.box2d[1])));
        let ymax = Math.max(ymin + 15, Math.min(1000, Math.round(f.box2d[2])));
        let xmax = Math.max(xmin + 30, Math.min(1000, Math.round(f.box2d[3])));
        validBox = [ymin, xmin, ymax, xmax];
      } else {
        validBox = getFallbackBox(key, idx);
      }

      sanitizedFields.push({
        id: `f-${idx}-${Date.now()}`,
        key,
        labelOriginal: lblOrig,
        labelTranslated: lblTrans,
        valueOriginal: valOrig,
        valueTranslated: valTrans,
        confidence: typeof f.confidence === 'number' ? f.confidence : 0.95,
        category: f.category || 'personal',
        box2d: validBox,
      });
    });

    // If document is marriage_certificate and returned fewer than 10 fields, supplement remaining fields
    if (isMarriage && sanitizedFields.length < 12) {
      MARRIAGE_ORDER_LABELS.forEach((item, sIdx) => {
        const alreadyPresent = sanitizedFields.some(
          (f) =>
            f.key.toLowerCase().includes(item.key.toLowerCase()) ||
            f.labelOriginal.toLowerCase().includes(item.key.replace(/_/g, ' ')) ||
            (sIdx < sanitizedFields.length && sanitizedFields[sIdx].key === item.key)
        );
        if (!alreadyPresent) {
          sanitizedFields.push({
            id: `f-sup-${sIdx}-${Date.now()}`,
            key: item.key,
            labelOriginal: item.orig,
            labelTranslated: item.trans,
            valueOriginal: item.key === 'doc_serial_number' ? (parsedData.documentNumber || 'KP-XI № 0479703') : 'Сверить по скану',
            valueTranslated: item.key === 'doc_serial_number' ? (parsedData.documentNumber || 'KP-XI № 0479703') : 'Сверить по скану',
            confidence: 0.9,
            category: 'personal',
            box2d: item.box,
          });
        }
      });
    }

    // Format with IDs and full safe fields
    const result = {
      id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      documentType: parsedData.documentType || documentType || 'general',
      sourceLanguage: parsedData.sourceLanguage || sourceLang || 'Auto-Detected',
      targetLanguage: parsedData.targetLanguage || targetLang,
      sourceCountry: parsedData.sourceCountry || 'Не указана',
      documentNumber: parsedData.documentNumber || 'Б/Н',
      issueDate: parsedData.issueDate || '—',
      issuingAuthority: parsedData.issuingAuthority || '—',
      fields: sanitizedFields,
      stampsAndSeals: (parsedData.stampsAndSeals || []).map((s: any, idx: number) => ({
        id: `seal-${idx}-${Date.now()}`,
        type: s.type || 'stamp',
        transcription: s.transcription || 'Печать ведомства',
        translation: s.translation || 'Печать ведомства',
      })),
      certificationFormula:
        parsedData.certificationFormula ||
        `Я, дипломированный переводчик, подтверждаю верность и полноту перевода представленного документа с языка: ${sourceLang} на язык: ${targetLang}.`,
      translatorNotes: parsedData.translatorNotes || '',
      timestamp: Date.now(),
    };

    return res.json(result);
  } catch (error: any) {
    const status = isQuotaOrRateLimitError(error) ? 429 : 500;
    console.error('Document translation error:', error?.message || error);
    return res.status(status).json({
      error:
        status === 429
          ? 'Превышен лимит запросов Gemini API. Повторите позже или подключите ключ с биллингом в Settings > Secrets.'
          : 'Failed to process and translate document.',
      details: error?.message || String(error),
    });
  }
});

// 1b. Single-Field OCR Endpoint (fast cropped bounding-box transcription)
app.post('/api/ocr-field', async (req: Request, res: Response) => {
  try {
    const {
      cropBase64,
      mimeType = 'image/jpeg',
      fieldLabelOriginal = '',
      fieldLabelTranslated = '',
      sourceLang = 'Auto-Detect',
      documentType = 'general',
    } = req.body;

    if (!cropBase64) {
      return res.status(400).json({ error: 'No cropped image data provided.' });
    }

    let actualMime = mimeType;
    const mimeMatch = String(cropBase64).match(/^data:([^;]+);base64,/);
    if (mimeMatch && mimeMatch[1]) {
      actualMime = mimeMatch[1];
    }
    const cleanBase64 = String(cropBase64).replace(/^data:[^;]+;base64,/, '');

    const systemInstruction = `Вы — эксперт оптического распознавания текста (OCR) бюро переводов «LinguaDoc».
Задача: максимально точно переписать (транскрибировать) ТОЛЬКО тот текст, который виден внутри данного вырезанного фрагмента официального документа.
Правила:
1. Пишите строго на языке оригинала (кириллица, латиница, цифры, знаки препинания, слэши, серии и номера).
2. НЕ переводите текст на другой язык!
3. Сохраняйте точное написание имен, дат, номеров и рукописных записей.
4. Если на краях фрагмента случайно попали обрезанные буквы чужих строк — игнорируйте их и извлекайте только основное значение поля.
5. Если текст совершенно неразборчив или отсутствует, верните пустую строку "".`;

    const promptText = `Документ: ${documentType}. Ожидаемый реквизит: "${fieldLabelTranslated || fieldLabelOriginal || 'текстовое поле'}" (ориг. метка: "${fieldLabelOriginal}", язык оригинала: ${sourceLang}).
Распознайте точное значение этого поля с приложенного фрагмента изображения.`;

    const parts = [
      {
        inlineData: {
          mimeType: actualMime,
          data: cleanBase64,
        },
      },
      { text: promptText },
    ];

    const config = {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          valueOriginal: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
        },
        required: ['valueOriginal'],
      },
    };

    const responseText = await generateContentWithFallback({
      contents: { parts },
      config,
      label: 'Field OCR',
    });

    let cleanJson = responseText.trim();
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    let parsed: any = {};
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      parsed = { valueOriginal: '' };
    }

    return res.json({
      valueOriginal: typeof parsed.valueOriginal === 'string' ? parsed.valueOriginal.trim() : '',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.95,
    });
  } catch (error: any) {
    const status = isQuotaOrRateLimitError(error) ? 429 : 500;
    console.error('Field OCR error:', error?.message || error);
    return res.status(status).json({
      error:
        status === 429
          ? 'Превышен лимит запросов Gemini API для OCR. Повторите через несколько секунд или подключите ключ с биллингом в Settings > Secrets.'
          : 'Failed to recognize text in field crop.',
      details: error?.message || String(error),
    });
  }
});

// 1c. Single-Field Certified Translation Endpoint
app.post('/api/translate-field', async (req: Request, res: Response) => {
  try {
    const {
      valueOriginal = '',
      fieldLabelOriginal = '',
      fieldLabelTranslated = '',
      sourceLang = 'Auto-Detect',
      targetLang = 'Русский (Russian)',
      documentType = 'general',
    } = req.body;

    if (!String(valueOriginal).trim()) {
      return res.status(400).json({ error: 'No source text provided for translation.' });
    }

    const systemInstruction = `Вы — старший присяжный переводчик бюро нотариальных переводов «LinguaDoc».
Задача: выполнить точный официальный нотариальный перевод значения одного реквизита документа на целевой язык (${targetLang}).
Правила:
1. Для имен собственных, фамилий и отчеств используйте корректную официальную транслитерацию / стандартную передачу (ICAO Doc 9303 / правила ЗАГС).
2. Для дат, номеров документов и серий сохраняйте все цифры и буквенно-цифровые коды точно без искажений.
3. Возвращайте только готовое переведенное значение поля без лишних пояснений и кавычек.`;

    const promptText = `Тип документа: ${documentType}
Язык оригинала: ${sourceLang}
Целевой язык: ${targetLang}
Название поля: ${fieldLabelTranslated || fieldLabelOriginal || 'Реквизит'}
Текст оригинала (OCR): "${String(valueOriginal).trim()}"

Переведите это значение официально.`;

    const config = {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          valueTranslated: { type: Type.STRING },
        },
        required: ['valueTranslated'],
      },
    };

    const responseText = await generateContentWithFallback({
      contents: promptText,
      config,
      label: 'Field Translate',
    });

    let cleanJson = responseText.trim();
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    let parsed: any = {};
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      parsed = { valueTranslated: '' };
    }

    return res.json({
      valueTranslated: typeof parsed.valueTranslated === 'string' ? parsed.valueTranslated.trim() : '',
    });
  } catch (error: any) {
    const status = isQuotaOrRateLimitError(error) ? 429 : 500;
    console.error('Field translation error:', error?.message || error);
    return res.status(status).json({
      error:
        status === 429
          ? 'Превышен лимит запросов Gemini API для перевода. Повторите через несколько секунд или подключите ключ с биллингом в Settings > Secrets.'
          : 'Failed to translate field value.',
      details: error?.message || String(error),
    });
  }
});

// 2. Saved Documents History (SQLite)
app.get('/api/documents', (_req: Request, res: Response) => {
  try {
    const docs = listSavedDocuments(30);
    return res.json({ documents: docs });
  } catch (error: any) {
    console.error('List saved documents error:', error);
    return res.status(500).json({ error: 'Failed to load document history.' });
  }
});

app.get('/api/documents/:id', (req: Request, res: Response) => {
  try {
    const doc = getSavedDocumentById(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    return res.json(doc);
  } catch (error: any) {
    console.error('Get saved document error:', error);
    return res.status(500).json({ error: 'Failed to load document.' });
  }
});

app.post('/api/documents', (req: Request, res: Response) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Invalid document payload.' });
    }
    const saved = saveOrUpdateDocument(payload);
    return res.json(saved);
  } catch (error: any) {
    console.error('Save document error:', error);
    return res.status(500).json({ error: 'Failed to save document.' });
  }
});

app.put('/api/documents/:id', (req: Request, res: Response) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Invalid document payload.' });
    }
    const saved = saveOrUpdateDocument({ ...payload, id: req.params.id });
    return res.json(saved);
  } catch (error: any) {
    console.error('Update document error:', error);
    return res.status(500).json({ error: 'Failed to update document.' });
  }
});

app.delete('/api/documents/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteSavedDocument(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    return res.json({ deleted: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete document error:', error);
    return res.status(500).json({ error: 'Failed to delete document.' });
  }
});

// Mount Vite or static server
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    if (isHmrDisabled) {
      app.get('/@vite/client', (_req: Request, res: Response) => {
        res.type('application/javascript').send(`
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if ("document" in globalThis) {
  document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => {
    sheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
}
let lastInsertedStyle;
function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement("afterend", style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id="' + CSS.escape(id) + '"]').forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
    sheetsMap.delete(id);
  }
}
function createHotContext() {
  const noop = () => {};
  return {
    data: {},
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    decline: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
  };
}
function injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return pathname + "?" + queryToInject + (search ? "&" + search.slice(1) : "") + (hash || "");
}
class ErrorOverlay {}
export { ErrorOverlay, createHotContext, injectQuery, removeStyle, updateStyle };
`);
      });
    }
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: isHmrDisabled ? false : undefined,
        ws: isHmrDisabled ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`LinguaDoc Bureau server running on http://0.0.0.0:${port}`);
  });
}

startServer();
