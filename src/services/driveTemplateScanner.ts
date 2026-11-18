import {
  DriveFileItem,
  DRIVE_FOLDER_MIME,
  DRIVE_SHORTCUT_MIME,
  DriveAuthExpiredError,
  listDriveFiles,
  downloadDriveFileBuffer,
  exportGoogleDocAsDocxBuffer,
} from './googleDriveClient';
import {
  ExtractedCandidateField,
  extractStructureFromDocxArrayBuffer,
  extractStructureFromPdfArrayBuffer,
} from '../utils/templateExtractor';

export interface ScannedTemplateRecord {
  id: string;
  sourceFolderId: string;
  sourceFolderName: string;
  folderPath: string;
  fileName: string;
  mimeType: string;
  kind: 'docx' | 'google_doc' | 'pdf' | 'image' | 'text' | 'other';
  pageCount: number;
  hasTextLayer: boolean;
  candidateFields: ExtractedCandidateField[];
  paragraphs: string[];
  tables: string[][][];
  textPreview: string;
  ownerEmail?: string;
}

export interface ScanProgress {
  phase: 'listing' | 'extracting';
  current: number;
  total: number;
  currentName: string;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

function resolveTarget(item: DriveFileItem): { id: string; mimeType: string } {
  if (item.mimeType === DRIVE_SHORTCUT_MIME && item.shortcutDetails?.targetId) {
    return {
      id: item.shortcutDetails.targetId,
      mimeType: item.shortcutDetails.targetMimeType || item.mimeType,
    };
  }
  return { id: item.id, mimeType: item.mimeType };
}

function classifyTemplateKind(
  mimeType: string,
  fileName: string
): ScannedTemplateRecord['kind'] {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = fileName.toLowerCase();
  if (lowerMime === GOOGLE_DOC_MIME) return 'google_doc';
  if (lowerMime === DOCX_MIME || lowerName.endsWith('.docx')) return 'docx';
  if (lowerMime === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (lowerMime.startsWith('image/') || /\.(jpg|jpeg|png|webp|tif|tiff)$/i.test(lowerName)) {
    return 'image';
  }
  if (lowerMime.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(lowerName)) {
    return 'text';
  }
  return 'other';
}

export async function scanDriveTemplateFolder(params: {
  accessToken: string;
  folderId: string;
  folderName: string;
  initialMode?: 'folder' | 'shared';
  maxDepth?: number;
  maxFiles?: number;
  onProgress?: (progress: ScanProgress) => void;
}): Promise<ScannedTemplateRecord[]> {
  const {
    accessToken,
    folderId,
    folderName,
    initialMode = 'folder',
    maxDepth = 3,
    maxFiles = 75,
    onProgress,
  } = params;

  const visitedFolders = new Set<string>();
  const discoveredFiles: Array<{
    item: DriveFileItem;
    targetId: string;
    effectiveMime: string;
    folderPath: string;
  }> = [];

  const collectFolder = async (
    currentFolderId: string,
    currentPath: string,
    depth: number,
    mode: 'folder' | 'shared'
  ) => {
    if (discoveredFiles.length >= maxFiles) return;
    const visitKey = `${mode}:${currentFolderId}`;
    if (visitedFolders.has(visitKey)) return;
    visitedFolders.add(visitKey);

    onProgress?.({
      phase: 'listing',
      current: discoveredFiles.length,
      total: discoveredFiles.length,
      currentName: currentPath || folderName,
    });

    const children = await listDriveFiles({
      accessToken,
      mode,
      folderId: mode === 'folder' ? currentFolderId : undefined,
    });

    for (const child of children) {
      if (discoveredFiles.length >= maxFiles) break;
      const resolved = resolveTarget(child);

      if (resolved.mimeType === DRIVE_FOLDER_MIME) {
        if (depth < maxDepth) {
          const nextPath = currentPath ? `${currentPath} / ${child.name}` : child.name;
          await collectFolder(resolved.id, nextPath, depth + 1, 'folder');
        }
      } else {
        discoveredFiles.push({
          item: child,
          targetId: resolved.id,
          effectiveMime: resolved.mimeType,
          folderPath: currentPath || folderName,
        });
      }
    }
  };

  await collectFolder(folderId, initialMode === 'shared' ? '' : folderName, 0, initialMode);

  const results: ScannedTemplateRecord[] = [];

  for (let i = 0; i < discoveredFiles.length; i++) {
    const entry = discoveredFiles[i];
    const kind = classifyTemplateKind(entry.effectiveMime, entry.item.name);
    const ownerEmail =
      entry.item.owners?.[0]?.emailAddress || entry.item.sharingUser?.emailAddress || undefined;

    onProgress?.({
      phase: 'extracting',
      current: i + 1,
      total: discoveredFiles.length,
      currentName: entry.item.name,
    });

    let candidateFields: ExtractedCandidateField[] = [];
    let paragraphs: string[] = [];
    let tables: string[][][] = [];
    let textPreview = '';
    let pageCount = 1;
    let hasTextLayer = false;

    try {
      if (kind === 'google_doc') {
        const buffer = await exportGoogleDocAsDocxBuffer(accessToken, entry.targetId);
        const extracted = await extractStructureFromDocxArrayBuffer(buffer);
        ({ candidateFields, paragraphs, tables, textPreview, pageCount, hasTextLayer } =
          extracted);
      } else if (kind === 'docx') {
        const buffer = await downloadDriveFileBuffer(accessToken, entry.targetId);
        const extracted = await extractStructureFromDocxArrayBuffer(buffer);
        ({ candidateFields, paragraphs, tables, textPreview, pageCount, hasTextLayer } =
          extracted);
      } else if (kind === 'pdf') {
        const buffer = await downloadDriveFileBuffer(accessToken, entry.targetId);
        const extracted = await extractStructureFromPdfArrayBuffer(buffer);
        ({ candidateFields, paragraphs, tables, textPreview, pageCount, hasTextLayer } =
          extracted);
      } else if (kind === 'text') {
        const buffer = await downloadDriveFileBuffer(accessToken, entry.targetId);
        const rawText = new TextDecoder('utf-8').decode(buffer).trim();
        paragraphs = rawText
          .split(/\n+/)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 60);
        textPreview = rawText.slice(0, 3000);
        hasTextLayer = Boolean(rawText);
      } else if (kind === 'image') {
        textPreview = `[Графический образец / скан: ${entry.item.name}]`;
      } else {
        textPreview = `[Файл формата ${entry.effectiveMime}]`;
      }
    } catch (err: any) {
      if (err instanceof DriveAuthExpiredError) {
        throw err;
      }
      textPreview = `[Не удалось прочитать содержимое: ${err?.message || 'ошибка'}]`;
    }

    results.push({
      id: entry.targetId,
      sourceFolderId: folderId,
      sourceFolderName: folderName,
      folderPath: entry.folderPath,
      fileName: entry.item.name,
      mimeType: entry.effectiveMime,
      kind,
      pageCount,
      hasTextLayer,
      candidateFields,
      paragraphs,
      tables,
      textPreview,
      ...(ownerEmail ? { ownerEmail } : {}),
    });
  }

  return results;
}

export function buildTemplatesChatReport(templates: ScannedTemplateRecord[]): string {
  const header = `# Отчёт по шаблонам бюро (${templates.length} файлов)\n`;
  const sections = templates.map((tpl, idx) => {
    const fieldsLine =
      tpl.candidateFields.length > 0
        ? `Поля (${tpl.candidateFields.length}): ${tpl.candidateFields
            .map((f) => f.label)
            .slice(0, 20)
            .join('; ')}`
        : '';
    const tablesInfo =
      tpl.tables.length > 0
        ? `Таблиц: ${tpl.tables.length} (строк в 1-й таблице: ${tpl.tables[0]?.length || 0})`
        : '';
    const previewSnippet = tpl.textPreview
      ? tpl.textPreview.replace(/\n+/g, ' / ').slice(0, 320)
      : '';

    return [
      `## ${idx + 1}. [${tpl.folderPath}] ${tpl.fileName} (${tpl.kind}, стр.: ${tpl.pageCount})`,
      fieldsLine,
      tablesInfo,
      previewSnippet ? `Фрагмент: ${previewSnippet}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });

  return `${header}\n${sections.join('\n\n')}`;
}
