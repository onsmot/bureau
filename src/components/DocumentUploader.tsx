import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  Camera,
  Languages,
  AlertCircle,
  FileText,
  CheckCircle2,
  RefreshCw,
  ArrowRight,
  Clock,
  FolderOpen,
  Trash2,
  SlidersHorizontal,
} from 'lucide-react';
import { DocumentTranslationData } from '../types/document';
import { convertPdfToImageDataUrl } from '../utils/pdfRenderer';
import { enhanceScanImageDataUrl } from '../utils/cropBoxImage';
import { GoogleDriveBrowser } from './GoogleDriveBrowser';

export interface SavedDocumentSummary {
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

interface DocumentUploaderProps {
  onTranslationComplete: (data: DocumentTranslationData) => void;
  onOpenSavedDocument: (id: string) => Promise<void> | void;
  openingDocId?: string | null;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

const TARGET_LANGUAGES = [
  'Русский (Russian)',
  'Английский (English)',
  'Немецкий (German)',
  'Испанский (Spanish)',
  'Французский (French)',
  'Турецкий (Turkish)',
  'Узбекский (Uzbek)',
  'Казахский (Kazakh)',
  'Арабский (Arabic)',
  'Китайский (Chinese)',
  'Итальянский (Italian)',
];

const DOC_TYPE_LABELS: Record<string, string> = {
  birth_certificate: 'Свидетельство о рождении',
  marriage_certificate: 'Свидетельство о браке',
  death_certificate: 'Свидетельство о смерти',
  divorce_certificate: 'Свидетельство о расторжении брака',
  passport: 'Паспорт',
  id_card: 'ID-карта',
  driver_license: 'Водительское удостоверение',
  diploma: 'Диплом / Аттестат',
  general: 'Документ',
};

export const DocumentUploader: React.FC<DocumentUploaderProps> = ({
  onTranslationComplete,
  onOpenSavedDocument,
  openingDocId,
  isLoading,
  setIsLoading,
}) => {
  const [targetLang, setTargetLang] = useState<string>('Русский (Russian)');
  const [selectedDocType, setSelectedDocType] = useState<string>('auto');
  const [enhanceScan, setEnhanceScan] = useState<boolean>(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [renderedPdfImage, setRenderedPdfImage] = useState<string | null>(null);
  const [isRenderingPdf, setIsRenderingPdf] = useState<boolean>(false);
  const [fileName, setFileName] = useState<string>('');
  const [fileMime, setFileMime] = useState<string>('image/jpeg');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState<string>('Подготовка...');

  // Saved history state
  const [historyDocs, setHistoryDocs] = useState<SavedDocumentSummary[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const fetchHistory = async () => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await fetch('/api/documents');
      if (!res.ok) {
        throw new Error('Не удалось загрузить историю переводов');
      }
      const json = await res.json();
      setHistoryDocs(Array.isArray(json.documents) ? json.documents : []);
    } catch (err: any) {
      setHistoryError(err?.message || 'Ошибка загрузки истории');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    void fetchHistory();
  }, []);

  const handleDeleteHistoryItem = async (id: string) => {
    setDeletingDocId(id);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('Не удалось удалить документ');
      }
      setHistoryDocs((prev) => prev.filter((doc) => doc.id !== id));
    } catch (err: any) {
      setHistoryError(err?.message || 'Ошибка при удалении документа');
    } finally {
      setDeletingDocId(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processSelectedFile(file);
  };

  const processSelectedFile = (file: File) => {
    setFileName(file.name);
    let detectedMime = file.type || 'image/jpeg';
    if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
      detectedMime = 'application/pdf';
    } else if (file.name.toLowerCase().endsWith('.png')) {
      detectedMime = 'image/png';
    } else if (file.name.toLowerCase().endsWith('.webp')) {
      detectedMime = 'image/webp';
    } else if (file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg')) {
      detectedMime = 'image/jpeg';
    }
    setFileMime(detectedMime);
    setErrorMessage(null);
    setRenderedPdfImage(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const result = event.target?.result as string;
      setPreviewImage(result);

      if (detectedMime === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        setIsRenderingPdf(true);
        try {
          const pngDataUrl = await convertPdfToImageDataUrl(result);
          setRenderedPdfImage(pngDataUrl);
        } catch (pdfErr: any) {
          console.warn('PDF page render error, falling back to original payload:', pdfErr);
        } finally {
          setIsRenderingPdf(false);
        }
      }
    };
    reader.onerror = () => {
      setErrorMessage('Не удалось прочитать выбранный файл. Попробуйте еще раз.');
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const startTranslation = async (imagePayload?: string, namePayload?: string) => {
    let imageToUse = imagePayload || renderedPdfImage || previewImage;
    let mimeToUse = fileMime;

    if (!imageToUse) {
      setErrorMessage('Пожалуйста, загрузите фотографию или скан документа.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    // Optional contrast & sharpening preprocessing on rasterized images
    const isRasterImage = !imageToUse.startsWith('data:application/pdf');
    if (enhanceScan && isRasterImage) {
      setLoadingStep('Улучшение контраста и резкости скана...');
      try {
        imageToUse = await enhanceScanImageDataUrl(imageToUse);
        mimeToUse = 'image/jpeg';
      } catch (enhErr) {
        console.warn('Scan enhancement skipped due to error:', enhErr);
      }
    }

    if (imageToUse.startsWith('data:image/jpeg')) {
      mimeToUse = 'image/jpeg';
    } else if (imageToUse.startsWith('data:image/png')) {
      mimeToUse = 'image/png';
    } else if (imageToUse.startsWith('data:application/pdf')) {
      mimeToUse = 'application/pdf';
    }

    setLoadingStep('Оптическое распознавание (OCR) и анализ штампов...');
    const stepTimer1 = setTimeout(() => {
      setLoadingStep('Транслитерация и официальный перевод реквизитов...');
    }, 2500);
    const stepTimer2 = setTimeout(() => {
      setLoadingStep('Подготовка структуры документа для студии...');
    }, 5500);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 55000);

    try {
      const response = await fetch('/api/translate-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          imageBase64: imageToUse,
          mimeType: mimeToUse,
          sourceLang: 'Auto-Detect',
          targetLang,
          documentType: selectedDocType,
        }),
      });

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || 'Ошибка при обработке документа.');
      }

      const result: DocumentTranslationData = await response.json();
      result.previewUrl = imageToUse;
      result.originalFileName = namePayload || fileName || 'document_scan.jpg';
      onTranslationComplete(result);
    } catch (err: any) {
      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      clearTimeout(timeoutId);
      console.error(err);
      if (err.name === 'AbortError') {
        setErrorMessage('Время ожидания ответа истекло. Пожалуйста, попробуйте еще раз или выберите другой формат.');
      } else {
        setErrorMessage(err.message || 'Произошла ошибка при обращении к серверу перевода.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (ts: number) => {
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(ts));
    } catch {
      return '';
    }
  };

  const hasRasterPreview = Boolean(
    previewImage &&
      (renderedPdfImage ||
        (!previewImage.startsWith('data:application/pdf') && !fileName.toLowerCase().endsWith('.pdf')))
  );

  return (
    <div className="mx-auto max-w-5xl py-8 px-4 sm:px-6 space-y-8">
      {/* Title & value prop */}
      <div className="text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Студия распознавания и перевода документов
        </h1>
        <p className="mt-3 text-base text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
          Автоматический OCR и структурированный перевод свидетельств, паспортов и справок с фото или PDF с выгрузкой в Microsoft Word (.docx) и точным редактированием областей скана.
        </p>
      </div>

      {/* Main Upload & Target Language Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {/* Upload Zone */}
        <div className="mb-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Скан или фото документа (JPG, PNG, PDF)
            </label>

            {/* Target Language & Document Type Selectors */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="doc-type-select"
                  className="text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap"
                >
                  <span>Тип бланка:</span>
                </label>
                <select
                  id="doc-type-select"
                  value={selectedDocType}
                  onChange={(e) => setSelectedDocType(e.target.value)}
                  disabled={isLoading}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="auto">Автоопределение</option>
                  <option value="passport">Паспорт</option>
                  <option value="id_card">ID-карта</option>
                  <option value="birth_certificate">Свидетельство о рождении</option>
                  <option value="marriage_certificate">Свидетельство о браке</option>
                  <option value="death_certificate">Свидетельство о смерти</option>
                  <option value="divorce_certificate">Свидетельство о расторжении брака</option>
                  <option value="driver_license">Водительские права</option>
                  <option value="diploma">Диплом / Аттестат</option>
                  <option value="general">Общий документ</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label
                  htmlFor="target-lang-select"
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap"
                >
                  <Languages className="h-3.5 w-3.5 text-slate-500" />
                  <span>Перевод на:</span>
                </label>
                <select
                  id="target-lang-select"
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  disabled={isLoading}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {TARGET_LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={handleFileChange}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
          />

          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all ${
              previewImage
                ? 'border-emerald-500 bg-emerald-50/30 dark:border-emerald-600 dark:bg-emerald-950/20'
                : 'border-slate-300 bg-slate-50/50 hover:border-slate-400 hover:bg-slate-100/50 dark:border-slate-700 dark:bg-slate-950/50 dark:hover:border-slate-600'
            }`}
          >
            {previewImage ? (
              <div className="flex flex-col items-center">
                <div className="relative mb-3 max-h-52 max-w-xs overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-950 p-1 flex items-center justify-center">
                  {hasRasterPreview ? (
                    <img
                      src={renderedPdfImage || previewImage}
                      alt="Предпросмотр документа"
                      className="h-auto max-h-48 w-auto object-contain rounded"
                    />
                  ) : isRenderingPdf ? (
                    <div className="flex h-36 w-44 flex-col items-center justify-center rounded-lg bg-amber-50 p-4 text-center text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      <RefreshCw className="h-8 w-8 mb-2 animate-spin text-amber-600 dark:text-amber-400" />
                      <span className="text-xs font-bold">Рендеринг PDF...</span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                        Подготовка листа в высоком разрешении
                      </span>
                    </div>
                  ) : (
                    <div className="flex h-36 w-44 flex-col items-center justify-center rounded-lg bg-red-50 p-4 text-center text-red-700 dark:bg-red-950/40 dark:text-red-300">
                      <FileText className="h-10 w-10 mb-1.5 text-red-600 dark:text-red-400" />
                      <span className="text-xs font-bold uppercase tracking-wider">PDF документ</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 max-w-[150px] truncate">
                        {fileName}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{fileName || 'Документ загружен и готов к распознаванию'}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Нажмите, чтобы заменить файл</p>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 mb-3">
                  <UploadCloud className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Перетащите скан или фото документа сюда
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Поддерживаются форматы JPG, PNG, WEBP, PDF до 50 МБ · Язык оригинала и тип бланка определяются автоматически
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    Выбрать файл
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      cameraInputRef.current?.click();
                    }}
                    className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <span>Сделать снимок</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Optional Scan Preprocessing Toggle (only shown when raster preview is ready) */}
        {hasRasterPreview && (
          <div className="mb-5 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-950/50">
            <label className="flex cursor-pointer items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 select-none">
              <input
                type="checkbox"
                checked={enhanceScan}
                onChange={(e) => setEnhanceScan(e.target.checked)}
                disabled={isLoading}
                className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-0 dark:border-slate-700"
              />
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              <span>
                <span className="font-semibold">Улучшить контраст и резкость фото перед распознаванием</span>
                <span className="hidden sm:inline text-slate-500 dark:text-slate-400">
                  {' '}· полезно для тусклых фотографий с телефона (цвет печатей сохраняется)
                </span>
              </span>
            </label>
          </div>
        )}

        {/* Error notification */}
        {errorMessage && (
          <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Ошибка</p>
              <p className="mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Primary Action Button */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Результат экспортируется в редактируемый документ Microsoft Word (.docx)
          </div>

          <button
            type="button"
            disabled={isLoading || isRenderingPdf || !previewImage}
            onClick={() => startTranslation()}
            className={`flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-all shadow-sm ${
              isLoading || isRenderingPdf || !previewImage
                ? 'cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600'
                : 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100'
            }`}
          >
            {isLoading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>{loadingStep}</span>
              </>
            ) : isRenderingPdf ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>Подготовка PDF...</span>
              </>
            ) : (
              <>
                <span>Распознать и перевести документ</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Google Drive Shared Folder Checker & Importer */}
      <GoogleDriveBrowser onImportFile={processSelectedFile} disabled={isLoading} />

      {/* Saved Translations History (SQLite) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              История переводов
            </h2>
            {!isLoadingHistory && historyDocs.length > 0 && (
              <span className="text-xs text-slate-400 tabular-nums">
                · {historyDocs.length}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => void fetchHistory()}
            disabled={isLoadingHistory}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            <RefreshCw className={`h-3 w-3 ${isLoadingHistory ? 'animate-spin' : ''}`} />
            <span>Обновить</span>
          </button>
        </div>

        {historyError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {historyError}
          </div>
        )}

        {isLoadingHistory ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Загрузка сохранённых документов...
          </div>
        ) : historyDocs.length === 0 ? (
          <div className="py-8 text-center">
            <FileText className="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-700 stroke-1" />
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
              История переводов пока пуста
            </p>
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              Переведённые документы автоматически сохраняются в локальную базу SQLite и будут доступны здесь.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {historyDocs.map((doc) => {
              const typeLabel = DOC_TYPE_LABELS[doc.documentType] || 'Документ';
              const isOpening = openingDocId === doc.id;
              const isDeleting = deletingDocId === doc.id;

              return (
                <div
                  key={doc.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5 first:pt-4 last:pb-1"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {doc.originalFileName || `${typeLabel} (${doc.sourceCountry})`}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {typeLabel} · {doc.sourceCountry} · № {doc.documentNumber}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      <span>{doc.sourceLanguage} → {doc.targetLanguage}</span>
                      <span aria-hidden="true">·</span>
                      <span>Полей: {doc.fieldsCount}</span>
                      <span aria-hidden="true">·</span>
                      <span>Печатей: {doc.stampsCount}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDate(doc.updatedAt || doc.timestamp)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isOpening || isDeleting}
                      onClick={() => void onOpenSavedDocument(doc.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors"
                    >
                      {isOpening ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FolderOpen className="h-3.5 w-3.5" />
                      )}
                      <span>{isOpening ? 'Открытие...' : 'Открыть'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={isOpening || isDeleting}
                      onClick={() => void handleDeleteHistoryItem(doc.id)}
                      title="Удалить из истории"
                      className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-red-900/60 dark:hover:bg-red-950/40 transition-colors"
                    >
                      {isDeleting ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
