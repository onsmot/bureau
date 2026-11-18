import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'linguadoc.sqlite');
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    document_type TEXT NOT NULL,
    source_language TEXT NOT NULL,
    target_language TEXT NOT NULL,
    source_country TEXT NOT NULL,
    document_number TEXT NOT NULL,
    issue_date TEXT NOT NULL DEFAULT '',
    issuing_authority TEXT NOT NULL DEFAULT '',
    certification_formula TEXT NOT NULL DEFAULT '',
    translator_notes TEXT NOT NULL DEFAULT '',
    original_file_name TEXT NOT NULL DEFAULT '',
    preview_url TEXT NOT NULL DEFAULT '',
    fields_count INTEGER NOT NULL DEFAULT 0,
    stamps_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS document_fields (
    id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    field_key TEXT NOT NULL,
    label_original TEXT NOT NULL,
    label_translated TEXT NOT NULL,
    value_original TEXT NOT NULL,
    value_translated TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.95,
    category TEXT NOT NULL DEFAULT 'personal',
    box2d_json TEXT,
    PRIMARY KEY (document_id, id),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS stamps_and_seals (
    id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    seal_type TEXT NOT NULL DEFAULT 'stamp',
    transcription TEXT NOT NULL DEFAULT '',
    translation TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (document_id, id),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
  );
`);

export interface DocumentSummary {
  id: string;
  documentType: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceCountry: string;
  documentNumber: string;
  originalFileName: string;
  fieldsCount: number;
  stampsCount: number;
  timestamp: number;
  updatedAt: number;
}

export function listSavedDocuments(limit: number = 30): DocumentSummary[] {
  const stmt = db.prepare(`
    SELECT
      id,
      document_type AS documentType,
      source_language AS sourceLanguage,
      target_language AS targetLanguage,
      source_country AS sourceCountry,
      document_number AS documentNumber,
      original_file_name AS originalFileName,
      fields_count AS fieldsCount,
      stamps_count AS stampsCount,
      created_at AS timestamp,
      updated_at AS updatedAt
    FROM documents
    ORDER BY updated_at DESC
    LIMIT ?
  `);

  return stmt.all(limit) as unknown as DocumentSummary[];
}

export function getSavedDocumentById(id: string): any | null {
  const docStmt = db.prepare(`
    SELECT
      id,
      document_type AS documentType,
      source_language AS sourceLanguage,
      target_language AS targetLanguage,
      source_country AS sourceCountry,
      document_number AS documentNumber,
      issue_date AS issueDate,
      issuing_authority AS issuingAuthority,
      certification_formula AS certificationFormula,
      translator_notes AS translatorNotes,
      original_file_name AS originalFileName,
      preview_url AS previewUrl,
      created_at AS timestamp,
      updated_at AS updatedAt
    FROM documents
    WHERE id = ?
  `);

  const doc = docStmt.get(id) as any;
  if (!doc) return null;

  const fieldsStmt = db.prepare(`
    SELECT
      id,
      field_key AS key,
      label_original AS labelOriginal,
      label_translated AS labelTranslated,
      value_original AS valueOriginal,
      value_translated AS valueTranslated,
      confidence,
      category,
      box2d_json AS box2dJson
    FROM document_fields
    WHERE document_id = ?
    ORDER BY sort_order ASC
  `);

  const rawFields = fieldsStmt.all(id) as any[];
  const fields = rawFields.map((row) => {
    let box2d: [number, number, number, number] | undefined;
    if (row.box2dJson) {
      try {
        const parsed = JSON.parse(row.box2dJson);
        if (Array.isArray(parsed) && parsed.length === 4) {
          box2d = parsed as [number, number, number, number];
        }
      } catch {
        box2d = undefined;
      }
    }
    return {
      id: row.id,
      key: row.key,
      labelOriginal: row.labelOriginal,
      labelTranslated: row.labelTranslated,
      valueOriginal: row.valueOriginal,
      valueTranslated: row.valueTranslated,
      confidence: row.confidence,
      category: row.category,
      ...(box2d ? { box2d } : {}),
    };
  });

  const stampsStmt = db.prepare(`
    SELECT
      id,
      seal_type AS type,
      transcription,
      translation,
      location
    FROM stamps_and_seals
    WHERE document_id = ?
    ORDER BY sort_order ASC
  `);

  const rawStamps = stampsStmt.all(id) as any[];
  const stampsAndSeals = rawStamps.map((s) => ({
    id: s.id,
    type: s.type,
    transcription: s.transcription,
    translation: s.translation,
    ...(s.location ? { location: s.location } : {}),
  }));

  return {
    ...doc,
    fields,
    stampsAndSeals,
  };
}

export function saveOrUpdateDocument(doc: any): { id: string; updatedAt: number } {
  const now = Date.now();
  const docId = String(doc.id || `doc-${now}`);
  const createdAt = typeof doc.timestamp === 'number' ? doc.timestamp : now;
  const fields = Array.isArray(doc.fields) ? doc.fields : [];
  const stamps = Array.isArray(doc.stampsAndSeals) ? doc.stampsAndSeals : [];

  db.exec('BEGIN');
  try {
    const upsertDoc = db.prepare(`
      INSERT INTO documents (
        id,
        document_type,
        source_language,
        target_language,
        source_country,
        document_number,
        issue_date,
        issuing_authority,
        certification_formula,
        translator_notes,
        original_file_name,
        preview_url,
        fields_count,
        stamps_count,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        document_type = excluded.document_type,
        source_language = excluded.source_language,
        target_language = excluded.target_language,
        source_country = excluded.source_country,
        document_number = excluded.document_number,
        issue_date = excluded.issue_date,
        issuing_authority = excluded.issuing_authority,
        certification_formula = excluded.certification_formula,
        translator_notes = excluded.translator_notes,
        original_file_name = excluded.original_file_name,
        preview_url = CASE
          WHEN excluded.preview_url != '' THEN excluded.preview_url
          ELSE documents.preview_url
        END,
        fields_count = excluded.fields_count,
        stamps_count = excluded.stamps_count,
        updated_at = excluded.updated_at
    `);

    upsertDoc.run(
      docId,
      String(doc.documentType || 'general'),
      String(doc.sourceLanguage || 'Auto-Detect'),
      String(doc.targetLanguage || 'Русский (Russian)'),
      String(doc.sourceCountry || 'Документ'),
      String(doc.documentNumber || 'Б/Н'),
      String(doc.issueDate || ''),
      String(doc.issuingAuthority || ''),
      String(doc.certificationFormula || ''),
      String(doc.translatorNotes || ''),
      String(doc.originalFileName || ''),
      String(doc.previewUrl || ''),
      fields.length,
      stamps.length,
      createdAt,
      now
    );

    db.prepare('DELETE FROM document_fields WHERE document_id = ?').run(docId);
    const insertField = db.prepare(`
      INSERT INTO document_fields (
        id,
        document_id,
        sort_order,
        field_key,
        label_original,
        label_translated,
        value_original,
        value_translated,
        confidence,
        category,
        box2d_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    fields.forEach((f: any, idx: number) => {
      insertField.run(
        String(f.id || `${docId}-f-${idx}`),
        docId,
        idx,
        String(f.key || `field_${idx}`),
        String(f.labelOriginal || ''),
        String(f.labelTranslated || ''),
        String(f.valueOriginal || ''),
        String(f.valueTranslated || ''),
        typeof f.confidence === 'number' ? f.confidence : 0.95,
        String(f.category || 'personal'),
        Array.isArray(f.box2d) && f.box2d.length === 4 ? JSON.stringify(f.box2d) : null
      );
    });

    db.prepare('DELETE FROM stamps_and_seals WHERE document_id = ?').run(docId);
    const insertStamp = db.prepare(`
      INSERT INTO stamps_and_seals (
        id,
        document_id,
        sort_order,
        seal_type,
        transcription,
        translation,
        location
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stamps.forEach((s: any, idx: number) => {
      insertStamp.run(
        String(s.id || `${docId}-seal-${idx}`),
        docId,
        idx,
        String(s.type || 'stamp'),
        String(s.transcription || ''),
        String(s.translation || ''),
        String(s.location || '')
      );
    });

    db.exec('COMMIT');
    return { id: docId, updatedAt: now };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteSavedDocument(id: string): boolean {
  const result = db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}
