import React, { useEffect, useState } from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  Image as ImageIcon,
  RefreshCw,
  LogOut,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Link2,
  CheckCircle2,
  AlertCircle,
  Download,
  UserCheck,
  Search,
  BookOpen,
  Copy,
  Check,
  Trash2,
} from 'lucide-react';
import {
  DriveAuthUser,
  initAuth,
  googleSignIn,
  googleSignInWithFirebase,
  preloadGoogleIdentityScript,
  logout,
  clearAccessToken,
  getAccessToken,
} from '../services/googleDriveAuth';
import {
  DriveFileItem,
  DRIVE_FOLDER_MIME,
  DRIVE_SHORTCUT_MIME,
  DriveAuthExpiredError,
  listDriveFiles,
  getDriveFileMetadata,
  downloadDriveFileAsFile,
  isSupportedDocumentMime,
} from '../services/googleDriveClient';
import {
  ScannedTemplateRecord,
  ScanProgress,
  scanDriveTemplateFolder,
  buildTemplatesChatReport,
} from '../services/driveTemplateScanner';

interface GoogleDriveBrowserProps {
  onImportFile: (file: File) => void;
  disabled?: boolean;
}

interface FolderBreadcrumb {
  id: string;
  name: string;
}

export const GoogleDriveBrowser: React.FC<GoogleDriveBrowserProps> = ({
  onImportFile,
  disabled = false,
}) => {
  const [user, setUser] = useState<DriveAuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'shared' | 'my_drive'>('shared');
  const [folderStack, setFolderStack] = useState<FolderBreadcrumb[]>([]);
  const [items, setItems] = useState<DriveFileItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [folderLinkInput, setFolderLinkInput] = useState<string>('');
  const [isCheckingLink, setIsCheckingLink] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Scanned bureau template library state
  const [storedTemplates, setStoredTemplates] = useState<ScannedTemplateRecord[]>([]);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [isScanningFolder, setIsScanningFolder] = useState<boolean>(false);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);

  useEffect(() => {
    void preloadGoogleIdentityScript().catch(() => {
      // Fallback button remains available if external script is blocked
    });
    const unsubscribe = initAuth(
      (signedInUser, accessToken) => {
        setUser(signedInUser);
        setToken(accessToken);
      },
      (signedInUser) => {
        setUser(signedInUser);
        setToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // Load previously studied templates from SQLite
  useEffect(() => {
    const loadStored = async () => {
      try {
        const res = await fetch('/api/templates');
        if (!res.ok) return;
        const json = await res.json();
        if (Array.isArray(json.templates) && json.templates.length > 0) {
          setStoredTemplates(json.templates);
        }
      } catch {
        // Silent fallback if no templates stored yet
      }
    };
    void loadStored();
  }, []);

  const loadFiles = async (
    currentToken: string,
    tab: 'shared' | 'my_drive',
    stack: FolderBreadcrumb[],
    query: string
  ) => {
    setIsLoadingFiles(true);
    setStatusMessage(null);
    try {
      const currentFolder = stack[stack.length - 1];
      const files = await listDriveFiles({
        accessToken: currentToken,
        mode: currentFolder ? 'folder' : tab,
        folderId: currentFolder?.id,
        searchQuery: currentFolder ? '' : query,
      });
      setItems(files);
    } catch (err: any) {
      if (err instanceof DriveAuthExpiredError) {
        clearAccessToken();
        setToken(null);
      }
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Не удалось загрузить список файлов Google Диска',
      });
    } finally {
      setIsLoadingFiles(false);
    }
  };

  useEffect(() => {
    if (token) {
      void loadFiles(token, activeTab, folderStack, searchQuery);
    }
  }, [token, activeTab, folderStack]);

  const handleSignIn = async (mode: 'gis' | 'firebase' = 'gis') => {
    setIsLoggingIn(true);
    setStatusMessage(null);
    try {
      const res =
        mode === 'firebase' ? await googleSignInWithFirebase() : await googleSignIn();
      setUser(res.user);
      setToken(res.accessToken);
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Вход через Google отменён или завершился ошибкой',
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setToken(null);
    setItems([]);
    setFolderStack([]);
    setStatusMessage(null);
  };

  const handleCheckByLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !folderLinkInput.trim()) return;
    setIsCheckingLink(true);
    setStatusMessage(null);
    try {
      const meta = await getDriveFileMetadata(token, folderLinkInput);
      const effectiveId =
        meta.mimeType === DRIVE_SHORTCUT_MIME && meta.shortcutDetails?.targetId
          ? meta.shortcutDetails.targetId
          : meta.id;
      const effectiveMime =
        meta.mimeType === DRIVE_SHORTCUT_MIME && meta.shortcutDetails?.targetMimeType
          ? meta.shortcutDetails.targetMimeType
          : meta.mimeType;

      const ownerEmail =
        meta.owners?.[0]?.emailAddress || meta.sharingUser?.emailAddress || 'другой аккаунт';

      if (effectiveMime === DRIVE_FOLDER_MIME) {
        setFolderStack([{ id: effectiveId, name: meta.name }]);
        setStatusMessage({
          type: 'success',
          text: `Доступ подтверждён! Открыта папка «${meta.name}» (владелец: ${ownerEmail}).`,
        });
      } else {
        setStatusMessage({
          type: 'success',
          text: `Доступ к файлу «${meta.name}» (${ownerEmail}) подтверждён! Загружаем в студию...`,
        });
        await handleImportDriveFile(meta);
      }
      setFolderLinkInput('');
    } catch (err: any) {
      if (err instanceof DriveAuthExpiredError) {
        clearAccessToken();
        setToken(null);
      }
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Не удалось проверить доступ по ссылке',
      });
    } finally {
      setIsCheckingLink(false);
    }
  };

  const handleOpenFolder = (item: DriveFileItem) => {
    const targetId =
      item.mimeType === DRIVE_SHORTCUT_MIME && item.shortcutDetails?.targetId
        ? item.shortcutDetails.targetId
        : item.id;
    setFolderStack((prev) => [...prev, { id: targetId, name: item.name }]);
  };

  const handleImportDriveFile = async (item: DriveFileItem) => {
    if (!token || disabled) return;
    setDownloadingId(item.id);
    setStatusMessage(null);
    try {
      const file = await downloadDriveFileAsFile(token, item);
      onImportFile(file);
      setStatusMessage({
        type: 'success',
        text: `Файл «${item.name}» загружен с Google Диска и готов к распознаванию.`,
      });
    } catch (err: any) {
      if (err instanceof DriveAuthExpiredError) {
        clearAccessToken();
        setToken(null);
      }
      setStatusMessage({
        type: 'error',
        text: err?.message || `Ошибка при загрузке «${item.name}»`,
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleScanTemplatesFolder = async (target: {
    folderId: string;
    folderName: string;
    initialMode: 'folder' | 'shared';
  }) => {
    if (!token || isScanningFolder) return;
    setIsScanningFolder(true);
    setStatusMessage(null);
    setScanProgress({
      phase: 'listing',
      current: 0,
      total: 0,
      currentName: target.folderName,
    });

    try {
      const scanned = await scanDriveTemplateFolder({
        accessToken: token,
        folderId: target.folderId,
        folderName: target.folderName,
        initialMode: target.initialMode,
        onProgress: (progress) => setScanProgress(progress),
      });

      const syncRes = await fetch('/api/templates/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates: scanned }),
      });

      if (!syncRes.ok) {
        throw new Error('Не удалось сохранить изученные шаблоны в базу данных');
      }

      setStoredTemplates(scanned);
      setIsTemplatesOpen(true);
      setStatusMessage({
        type: 'success',
        text: `Изучено файлов: ${scanned.length} из папки «${target.folderName}». Справочник сохранён в базу и готов к использованию при переводе.`,
      });
    } catch (err: any) {
      if (err instanceof DriveAuthExpiredError) {
        clearAccessToken();
        setToken(null);
      }
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Ошибка при сканировании папки шаблонов',
      });
    } finally {
      setIsScanningFolder(false);
      setScanProgress(null);
    }
  };

  const handleCopyReportForChat = async () => {
    if (storedTemplates.length === 0) return;
    const report = buildTemplatesChatReport(storedTemplates);
    await navigator.clipboard.writeText(report);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2200);
  };

  const handleDownloadTemplatesJson = () => {
    if (storedTemplates.length === 0) return;
    const blob = new Blob([JSON.stringify(storedTemplates, null, 2)], {
      type: 'application/json',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'linguadoc_templates_library.json';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    }, 500);
  };

  const handleClearStoredTemplates = async () => {
    try {
      await fetch('/api/templates', { method: 'DELETE' });
      setStoredTemplates([]);
      setIsTemplatesOpen(false);
    } catch {
      // Ignore error
    }
  };

  const formatBytes = (sizeStr?: string) => {
    const bytes = Number(sizeStr);
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  };

  const currentFolder = folderStack[folderStack.length - 1];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span>Google Диск — общие папки, шаблоны и файлы</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Проверьте доступ к расшаренным папкам, просканируйте базу шаблонов или загрузите скан/PDF в студию.
          </p>
        </div>

        {token && user ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
              <UserCheck className="h-3.5 w-3.5" />
              <span className="max-w-[180px] truncate">{user.email}</span>
            </span>
            <button
              type="button"
              onClick={() => void loadFiles(token, activeTab, folderStack, searchQuery)}
              disabled={isLoadingFiles || isScanningFolder}
              title="Обновить список"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingFiles ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              title="Выйти из Google-аккаунта"
              className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Выйти</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleSignIn('gis')}
              disabled={isLoggingIn}
              className="inline-flex items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-2xs hover:bg-slate-50 active:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
              </svg>
              <span>
                {isLoggingIn
                  ? 'Подключение...'
                  : user?.email
                  ? `Подключить Диск (${user.email})`
                  : 'Sign in with Google'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void handleSignIn('firebase')}
              disabled={isLoggingIn}
              title="Резервный вход через Firebase Auth"
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
            >
              Firebase
            </button>
          </div>
        )}
      </div>

      {statusMessage && (
        <div
          className={`mt-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs ${
            statusMessage.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {scanProgress && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/80 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="flex items-center justify-between gap-2 font-semibold">
            <span className="flex items-center gap-2 min-w-0">
              <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0 text-amber-600" />
              <span className="truncate">
                {scanProgress.phase === 'listing'
                  ? `Обход папок: ${scanProgress.currentName}...`
                  : `Чтение шаблонов (${scanProgress.current}/${scanProgress.total}): ${scanProgress.currentName}`}
              </span>
            </span>
            {scanProgress.total > 0 && (
              <span className="tabular-nums shrink-0">
                {Math.round((scanProgress.current / scanProgress.total) * 100)}%
              </span>
            )}
          </div>
          {scanProgress.total > 0 && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-amber-200/70 dark:bg-amber-900/50">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{
                  width: `${Math.min(100, Math.round((scanProgress.current / scanProgress.total) * 100))}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {token && (
        <div className="mt-4 space-y-3">
          {/* Mode Tabs + Direct Link Check */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-950 self-start">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('shared');
                  setFolderStack([]);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === 'shared' && folderStack.length === 0
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Доступные мне (от других аккаунтов)
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('my_drive');
                  setFolderStack([]);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === 'my_drive' && folderStack.length === 0
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Мой диск (и ярлыки)
              </button>
            </div>

            {/* Direct Link / Folder ID Checker */}
            <form onSubmit={handleCheckByLink} className="flex flex-1 max-w-lg items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={folderLinkInput}
                  onChange={(e) => setFolderLinkInput(e.target.value)}
                  placeholder="Вставьте ссылку или ID папки/файла с другого аккаунта..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                disabled={isCheckingLink || !folderLinkInput.trim()}
                className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-45 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
              >
                {isCheckingLink ? 'Проверка...' : 'Проверить'}
              </button>
            </form>
          </div>

          {/* Search inside root view + Scan All Shared Action */}
          {folderStack.length === 0 && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadFiles(token, activeTab, folderStack, searchQuery);
                }}
                className="flex flex-1 items-center gap-2"
              >
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Поиск по названию папки или файла..."
                    className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoadingFiles}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  Найти
                </button>
              </form>

              {activeTab === 'shared' && items.length > 0 && (
                <button
                  type="button"
                  disabled={isScanningFolder}
                  onClick={() =>
                    void handleScanTemplatesFolder({
                      folderId: 'shared_root',
                      folderName: 'Доступные мне',
                      initialMode: 'shared',
                    })
                  }
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 shrink-0"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>Изучить все общие шаблоны</span>
                </button>
              )}
            </div>
          )}

          {/* Folder Breadcrumbs + Scan Current Folder */}
          {folderStack.length > 0 && currentFolder && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs dark:bg-slate-950">
              <div className="flex flex-wrap items-center gap-1 min-w-0">
                <button
                  type="button"
                  onClick={() => setFolderStack([])}
                  className="font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                >
                  {activeTab === 'shared' ? 'Доступные мне' : 'Мой диск'}
                </button>
                {folderStack.map((crumb, idx) => (
                  <React.Fragment key={crumb.id}>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                    <button
                      type="button"
                      onClick={() => setFolderStack((prev) => prev.slice(0, idx + 1))}
                      className={`truncate max-w-[200px] ${
                        idx === folderStack.length - 1
                          ? 'font-bold text-slate-900 dark:text-white'
                          : 'font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300'
                      }`}
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>

              <button
                type="button"
                disabled={isScanningFolder}
                onClick={() =>
                  void handleScanTemplatesFolder({
                    folderId: currentFolder.id,
                    folderName: currentFolder.name,
                    initialMode: 'folder',
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 shrink-0"
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>Изучить эту папку как шаблоны</span>
              </button>
            </div>
          )}

          {/* File & Folder List */}
          <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 dark:border-slate-800 dark:divide-slate-800">
            {isLoadingFiles ? (
              <div className="py-8 text-center text-xs text-slate-500">
                Загрузка списка файлов с Google Диска...
              </div>
            ) : items.length === 0 ? (
              <div className="py-8 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
                {folderStack.length > 0
                  ? 'Эта папка пуста.'
                  : activeTab === 'shared'
                  ? 'Расшаренных папок или файлов пока не найдено. Поделитесь папкой с другого аккаунта на этот email или вставьте ссылку выше.'
                  : 'В корне «Моего диска» файлов не найдено.'}
              </div>
            ) : (
              items.map((item) => {
                const targetId =
                  item.mimeType === DRIVE_SHORTCUT_MIME && item.shortcutDetails?.targetId
                    ? item.shortcutDetails.targetId
                    : item.id;
                const effectiveMime =
                  item.mimeType === DRIVE_SHORTCUT_MIME && item.shortcutDetails?.targetMimeType
                    ? item.shortcutDetails.targetMimeType
                    : item.mimeType;
                const isFolder = effectiveMime === DRIVE_FOLDER_MIME;
                const isImage = effectiveMime.startsWith('image/');
                const isDocx =
                  effectiveMime ===
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                  item.name.toLowerCase().endsWith('.docx');
                const canImport = !isFolder && isSupportedDocumentMime(effectiveMime, item.name);
                const ownerEmail =
                  item.owners?.[0]?.emailAddress || item.sharingUser?.emailAddress || '';
                const isDownloading = downloadingId === item.id;

                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-slate-50/80 dark:hover:bg-slate-950/50 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (isFolder) {
                          handleOpenFolder(item);
                        } else if (canImport) {
                          void handleImportDriveFile(item);
                        }
                      }}
                      disabled={!isFolder && !canImport}
                      className="flex flex-1 items-center gap-2.5 min-w-0 text-left disabled:opacity-70"
                    >
                      {isFolder ? (
                        <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                      ) : isImage ? (
                        <ImageIcon className="h-4 w-4 shrink-0 text-sky-500" />
                      ) : isDocx ? (
                        <BookOpen className="h-4 w-4 shrink-0 text-blue-600" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-red-500" />
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {item.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                          {ownerEmail && <span>от {ownerEmail}</span>}
                          {item.mimeType === DRIVE_SHORTCUT_MIME && <span>· Ярлык</span>}
                          {item.size && <span>· {formatBytes(item.size)}</span>}
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isFolder ? (
                        <>
                          <button
                            type="button"
                            disabled={isScanningFolder}
                            onClick={() =>
                              void handleScanTemplatesFolder({
                                folderId: targetId,
                                folderName: item.name,
                                initialMode: 'folder',
                              })
                            }
                            title="Просканировать папку и извлечь шаблоны"
                            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                          >
                            <BookOpen className="h-3 w-3" />
                            <span>Изучить</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenFolder(item)}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            Открыть
                          </button>
                        </>
                      ) : canImport ? (
                        <button
                          type="button"
                          onClick={() => void handleImportDriveFile(item)}
                          disabled={disabled || isDownloading}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-950"
                        >
                          {isDownloading ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3" />
                          )}
                          <span>{isDownloading ? 'Загрузка...' : 'В студию'}</span>
                        </button>
                      ) : isDocx ? (
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                          Шаблон .docx
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">Другой формат</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Stored / Scanned Templates Library Summary */}
      {storedTemplates.length > 0 && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/50">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIsTemplatesOpen((prev) => !prev)}
              className="flex items-center gap-2 text-left text-xs font-bold text-slate-800 dark:text-slate-100"
            >
              <BookOpen className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>База изученных шаблонов бюро ({storedTemplates.length})</span>
              {isTemplatesOpen ? (
                <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              )}
            </button>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleCopyReportForChat()}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                {copiedReport ? (
                  <Check className="h-3 w-3 text-emerald-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                <span>{copiedReport ? 'Сводка скопирована!' : 'Скопировать сводку для чата'}</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadTemplatesJson}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <Download className="h-3 w-3" />
                <span>JSON</span>
              </button>
              <button
                type="button"
                onClick={() => void handleClearStoredTemplates()}
                title="Очистить базу шаблонов"
                className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:bg-slate-900"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {isTemplatesOpen && (
            <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:divide-slate-800">
              {storedTemplates.map((tpl) => {
                const isExpanded = expandedTemplateId === tpl.id;
                return (
                  <div key={tpl.id} className="p-2.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setExpandedTemplateId(isExpanded ? null : tpl.id)}
                      className="flex w-full items-center justify-between gap-2 text-left"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {tpl.fileName}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {tpl.folderPath} · {tpl.kind.toUpperCase()} · полей: {tpl.candidateFields.length}
                          {tpl.tables.length > 0 ? ` · таблиц: ${tpl.tables.length}` : ''}
                        </p>
                      </div>
                      <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 shrink-0">
                        {isExpanded ? 'Скрыть' : 'Детали'}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="mt-2 space-y-1.5 rounded border border-slate-100 bg-slate-50 p-2 text-[11px] dark:border-slate-800 dark:bg-slate-950">
                        {tpl.candidateFields.length > 0 && (
                          <div>
                            <span className="font-semibold text-slate-700 dark:text-slate-300">
                              Найденные поля:
                            </span>{' '}
                            <span className="text-slate-600 dark:text-slate-400">
                              {tpl.candidateFields.map((f) => f.label).join(', ')}
                            </span>
                          </div>
                        )}
                        {tpl.textPreview && (
                          <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] text-slate-600 dark:text-slate-400">
                            {tpl.textPreview}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
