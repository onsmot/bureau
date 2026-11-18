export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  shared?: boolean;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  sharingUser?: { displayName?: string; emailAddress?: string };
  shortcutDetails?: {
    targetId?: string;
    targetMimeType?: string;
  };
}

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
export const DRIVE_SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

const FILE_FIELDS =
  'files(id,name,mimeType,size,modifiedTime,shared,owners(displayName,emailAddress),sharingUser(displayName,emailAddress),shortcutDetails(targetId,targetMimeType)),nextPageToken';

export class DriveAuthExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriveAuthExpiredError';
  }
}

export function extractDriveIdFromInput(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch?.[1]) return folderMatch[1];
  const fileMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch?.[1]) return fileMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch?.[1]) return idParamMatch[1];
  return trimmed;
}

export function isSupportedDocumentMime(mimeType: string, fileName?: string): boolean {
  const lowerMime = (mimeType || '').toLowerCase();
  const lowerName = (fileName || '').toLowerCase();
  return (
    lowerMime.startsWith('image/') ||
    lowerMime === 'application/pdf' ||
    lowerMime === 'application/vnd.google-apps.document' ||
    lowerName.endsWith('.pdf') ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg') ||
    lowerName.endsWith('.png') ||
    lowerName.endsWith('.webp')
  );
}

async function driveFetch(url: string, accessToken: string): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    throw new DriveAuthExpiredError('Сессия Google Диска истекла. Войдите снова.');
  }
  return res;
}

export async function listDriveFiles(params: {
  accessToken: string;
  mode: 'shared' | 'my_drive' | 'folder';
  folderId?: string;
  searchQuery?: string;
}): Promise<DriveFileItem[]> {
  const { accessToken, mode, folderId, searchQuery } = params;
  const escapedSearch = (searchQuery || '').trim().replace(/'/g, "\\'");

  let q = 'trashed = false';
  if (mode === 'folder' && folderId) {
    q = `'${folderId}' in parents and trashed = false`;
  } else if (mode === 'shared') {
    q = 'sharedWithMe = true and trashed = false';
  } else if (mode === 'my_drive') {
    q = `'root' in parents and trashed = false`;
  }

  if (escapedSearch) {
    q += ` and name contains '${escapedSearch}'`;
  }

  const searchParams = new URLSearchParams({
    q,
    fields: FILE_FIELDS,
    pageSize: '60',
    orderBy: 'folder,modifiedTime desc',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?${searchParams.toString()}`,
    accessToken
  );

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || 'Не удалось получить список файлов Google Диска');
  }

  const json = await res.json();
  return Array.isArray(json.files) ? json.files : [];
}

export async function getDriveFileMetadata(
  accessToken: string,
  fileId: string
): Promise<DriveFileItem> {
  const cleanId = extractDriveIdFromInput(fileId);
  if (!cleanId) {
    throw new Error('Укажите ссылку или ID папки/файла Google Диска');
  }

  const searchParams = new URLSearchParams({
    fields:
      'id,name,mimeType,size,modifiedTime,shared,owners(displayName,emailAddress),sharingUser(displayName,emailAddress),shortcutDetails(targetId,targetMimeType)',
    supportsAllDrives: 'true',
  });

  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}?${searchParams.toString()}`,
    accessToken
  );

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    if (res.status === 404 || res.status === 403) {
      throw new Error(
        'Доступ к этой папке/файлу не обнаружен для текущего аккаунта. Проверьте, что папка расшарена на ваш email.'
      );
    }
    throw new Error(errJson?.error?.message || 'Ошибка проверки папки на Google Диске');
  }

  return res.json();
}

export async function downloadDriveFileAsFile(
  accessToken: string,
  item: DriveFileItem
): Promise<File> {
  const targetId =
    item.mimeType === DRIVE_SHORTCUT_MIME && item.shortcutDetails?.targetId
      ? item.shortcutDetails.targetId
      : item.id;
  const effectiveMime =
    item.mimeType === DRIVE_SHORTCUT_MIME && item.shortcutDetails?.targetMimeType
      ? item.shortcutDetails.targetMimeType
      : item.mimeType;

  const isGoogleDoc = effectiveMime === 'application/vnd.google-apps.document';
  const endpoint = isGoogleDoc
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        targetId
      )}/export?mimeType=application/pdf`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        targetId
      )}?alt=media&supportsAllDrives=true`;

  const res = await driveFetch(endpoint, accessToken);
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `Не удалось скачать файл «${item.name}»`);
  }

  const blob = await res.blob();
  const outMime = isGoogleDoc ? 'application/pdf' : blob.type || effectiveMime || 'application/octet-stream';
  const outName =
    isGoogleDoc && !item.name.toLowerCase().endsWith('.pdf') ? `${item.name}.pdf` : item.name;

  return new File([blob], outName, { type: outMime });
}

export async function downloadDriveFileBuffer(
  accessToken: string,
  fileId: string
): Promise<ArrayBuffer> {
  const endpoint = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}?alt=media&supportsAllDrives=true`;
  const res = await driveFetch(endpoint, accessToken);
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || 'Не удалось скачать содержимое файла');
  }
  return res.arrayBuffer();
}

export async function exportGoogleDocAsDocxBuffer(
  accessToken: string,
  fileId: string
): Promise<ArrayBuffer> {
  const endpoint = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}/export?mimeType=${encodeURIComponent(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )}`;
  const res = await driveFetch(endpoint, accessToken);
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || 'Не удалось экспортировать Google Документ');
  }
  return res.arrayBuffer();
}

