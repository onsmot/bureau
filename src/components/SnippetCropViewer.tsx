import React, { useState, useEffect, useRef } from 'react';
import { Crop, Loader2, ScanText } from 'lucide-react';
import { DocumentField } from '../types/document';
import { convertPdfToImageDataUrl } from '../utils/pdfRenderer';

interface SnippetCropViewerProps {
  field: DocumentField;
  previewImageUrl?: string;
  isEditing?: boolean;
  onLabelTranslatedChange?: (newVal: string) => void;
  onValueOriginalChange?: (newVal: string) => void;
  onHoverHighlight?: (box2d?: [number, number, number, number]) => void;
  onInspectCrop?: () => void;
  onRunOcr?: () => void;
  actionStatus?: 'ocr' | 'translate' | null;
  index: number;
}

export const SnippetCropViewer: React.FC<SnippetCropViewerProps> = ({
  field,
  previewImageUrl,
  isEditing,
  onLabelTranslatedChange,
  onValueOriginalChange,
  onHoverHighlight,
  onInspectCrop,
  onRunOcr,
  actionStatus = null,
  index,
}) => {
  const [activeImageUrl, setActiveImageUrl] = useState<string | undefined>(
    previewImageUrl && !previewImageUrl.startsWith('data:application/pdf') ? previewImageUrl : undefined
  );
  const [isPdfConverting, setIsPdfConverting] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Auto-convert PDF to image if needed
  useEffect(() => {
    if (!previewImageUrl) {
      setActiveImageUrl(undefined);
      return;
    }

    if (previewImageUrl.startsWith('data:application/pdf')) {
      setIsPdfConverting(true);
      convertPdfToImageDataUrl(previewImageUrl)
        .then((png) => {
          setActiveImageUrl(png);
        })
        .catch((err) => {
          console.warn('PDF conversion error in SnippetCropViewer:', err);
        })
        .finally(() => setIsPdfConverting(false));
    } else {
      setActiveImageUrl(previewImageUrl);
    }
  }, [previewImageUrl]);

  // Compute normalized bounding box (0-1000 scale)
  const box: [number, number, number, number] = field.box2d || [
    Math.min(180 + index * 75, 880),
    120,
    Math.min(225 + index * 75, 930),
    880,
  ];

  const effectiveImage = activeImageUrl || (previewImageUrl && !previewImageUrl.startsWith('data:application/pdf') ? previewImageUrl : undefined);

  // Draw snippet on canvas from image
  useEffect(() => {
    if (!effectiveImage) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = effectiveImage;

    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Extract pixel coordinates from 0-1000 scale
      const [ymin, xmin, ymax, xmax] = box;
      const sx = (xmin / 1000) * img.naturalWidth;
      const sy = (ymin / 1000) * img.naturalHeight;
      const sWidth = Math.max(((xmax - xmin) / 1000) * img.naturalWidth, 10);
      const sHeight = Math.max(((ymax - ymin) / 1000) * img.naturalHeight, 10);

      // Add a slight margin (padding) around the text for readability
      const padX = sWidth * 0.05;
      const padY = sHeight * 0.15;

      const cropX = Math.max(0, sx - padX);
      const cropY = Math.max(0, sy - padY);
      const cropW = Math.min(img.naturalWidth - cropX, sWidth + padX * 2);
      const cropH = Math.min(img.naturalHeight - cropY, sHeight + padY * 2);

      canvas.width = 180;
      canvas.height = 42;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Draw background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

      // Draw subtle top/bottom borders
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, canvas.width, canvas.height);
    };
  }, [effectiveImage, box]);

  const handleMouseEnter = () => {
    if (onHoverHighlight) {
      onHoverHighlight(box);
    }
  };

  const handleMouseLeave = () => {
    if (onHoverHighlight) {
      onHoverHighlight(undefined);
    }
  };

  return (
    <div
      className="group relative flex flex-col gap-1 transition-colors"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Field Label Annotation Header */}
      <div className="w-full">
        {isEditing ? (
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              Перевод названия (Аннотация):
            </span>
            <input
              type="text"
              value={field.labelTranslated}
              onChange={(e) => onLabelTranslatedChange?.(e.target.value)}
              className="w-full rounded border border-blue-400 bg-white px-2 py-1 text-xs font-bold text-slate-900 shadow-2xs dark:border-blue-600 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Например: Супруг (Муж): ФИО"
            />
            {onValueOriginalChange && (
              <div className="pt-0.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Текст оригинала (OCR):
                </span>
                <input
                  type="text"
                  value={field.valueOriginal}
                  onChange={(e) => onValueOriginalChange(e.target.value)}
                  className="w-full rounded border border-amber-300 bg-amber-50/50 px-2 py-0.5 text-xs font-mono text-slate-900 dark:border-amber-800 dark:bg-slate-950 dark:text-slate-100"
                  placeholder="Текст с изображения"
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-baseline justify-between gap-1.5 px-0.5">
            <span className="font-bold text-[11px] text-slate-800 dark:text-slate-100 truncate" title={field.labelTranslated}>
              {field.labelTranslated || field.labelOriginal || 'Без названия'}
            </span>
            {field.labelOriginal && field.labelOriginal !== field.labelTranslated && (
              <span className="text-[10px] text-slate-400 font-normal truncate max-w-[100px] shrink-0" title={`Оригинал: ${field.labelOriginal}`}>
                {field.labelOriginal}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Fluid Snippet Thumbnail Strip */}
      <div
        className="group/thumb relative flex w-full items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-800 dark:bg-slate-950 transition-all hover:border-amber-400 cursor-pointer"
        title={`Выбрать кроп на скане (Y:${box[0]}..${box[2]}, X:${box[1]}..${box[3]})`}
      >
        {effectiveImage ? (
          <canvas
            ref={canvasRef}
            className="h-[32px] flex-1 min-w-0 w-full rounded-xs bg-white object-cover"
          />
        ) : isPdfConverting ? (
          <div className="flex h-[32px] flex-1 min-w-0 items-center justify-center gap-1.5 rounded-xs bg-amber-50 px-2 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <Loader2 className="h-3 w-3 animate-spin text-amber-600" />
            <span>Рендеринг PDF...</span>
          </div>
        ) : (
          <div className="flex h-[32px] flex-1 min-w-0 items-center justify-between rounded-xs bg-slate-50 px-2 text-[11px] font-mono text-slate-800 dark:bg-slate-900 dark:text-slate-200">
            <span className="truncate font-semibold">{field.valueOriginal || field.labelOriginal}</span>
            <span className="ml-1 rounded bg-slate-200/70 px-1 py-0.2 text-[9px] text-slate-500 shrink-0 dark:bg-slate-800">
              PDF
            </span>
          </div>
        )}

        {onInspectCrop && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInspectCrop();
            }}
            title="Открыть свойства кропа в инспекторе"
            className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 shrink-0"
          >
            <Crop className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Compact OCR text line + manual OCR button */}
      <div className="flex items-center justify-between gap-1.5 px-0.5">
        <div
          className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate min-w-0 flex-1"
          title={`OCR: ${field.valueOriginal || 'не указан'} · Координаты Y[${box[0]}..${box[2]}] X[${box[1]}..${box[3]}]`}
        >
          {actionStatus === 'ocr' ? (
            <span className="text-amber-600 dark:text-amber-400 font-semibold">Распознавание OCR...</span>
          ) : (
            <>OCR: {field.valueOriginal || 'не указан'}</>
          )}
        </div>
        {onRunOcr && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRunOcr();
            }}
            disabled={Boolean(actionStatus) || (!effectiveImage && !previewImageUrl)}
            title="Запустить OCR для выделенной области"
            className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
              actionStatus === 'ocr'
                ? 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950/70 dark:text-amber-200'
                : 'border-amber-300/80 bg-amber-50/80 text-amber-800 hover:bg-amber-100 disabled:opacity-45 disabled:cursor-not-allowed dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/60'
            }`}
          >
            {actionStatus === 'ocr' ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <ScanText className="h-2.5 w-2.5" />
            )}
            <span>{actionStatus === 'ocr' ? 'OCR...' : 'OCR'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
