import React, { useEffect, useRef } from 'react';
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Crop,
  Eye,
} from 'lucide-react';
import { DocumentField } from '../types/document';

interface CropInspectorPanelProps {
  field?: DocumentField;
  boxDraft: [number, number, number, number] | null;
  previewImageUrl?: string;
  actionStatus: 'ocr' | 'translate' | null;
  onDraftChange: (nextBox: [number, number, number, number]) => void;
  onApplyBox: (fieldId: string, newBox: [number, number, number, number]) => void;
}

export const CropInspectorPanel: React.FC<CropInspectorPanelProps> = ({
  field,
  boxDraft,
  previewImageUrl,
  actionStatus,
  onDraftChange,
  onApplyBox,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeBox = boxDraft || field?.box2d || [150, 150, 250, 550];

  useEffect(() => {
    if (!previewImageUrl || !field || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = previewImageUrl;
    img.onload = () => {
      const [ymin, xmin, ymax, xmax] = activeBox;
      const sx = (xmin / 1000) * img.naturalWidth;
      const sy = (ymin / 1000) * img.naturalHeight;
      const sWidth = Math.max(((xmax - xmin) / 1000) * img.naturalWidth, 8);
      const sHeight = Math.max(((ymax - ymin) / 1000) * img.naturalHeight, 8);

      canvas.width = 440;
      canvas.height = 112;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
    };
  }, [previewImageUrl, field, activeBox[0], activeBox[1], activeBox[2], activeBox[3]]);

  if (!field) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center dark:border-slate-800 dark:bg-slate-950/40">
        <Crop className="mx-auto mb-2.5 h-8 w-8 text-slate-400 stroke-1" />
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          Выберите рамку на скане или строку в таблице
        </p>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          Здесь отобразится увеличенный живой фрагмент кропа, точные координаты и кнопки сдвига.
        </p>
      </div>
    );
  }

  const nudge = (dY: number, dX: number) => {
    const [ymin, xmin, ymax, xmax] = activeBox;
    const w = xmax - xmin;
    const h = ymax - ymin;
    const ny = Math.max(0, Math.min(1000 - h, ymin + dY));
    const nx = Math.max(0, Math.min(1000 - w, xmin + dX));
    onDraftChange([ny, nx, ny + h, nx + w]);
  };

  const resizeBox = (dHeight: number, dWidth: number) => {
    const [ymin, xmin, ymax, xmax] = activeBox;
    const ny = Math.max(0, Math.min(ymax - 12, Math.round(ymin - dHeight / 2)));
    const nyMax = Math.min(1000, Math.max(ny + 12, Math.round(ymax + dHeight / 2)));
    const nx = Math.max(0, Math.min(xmax - 12, Math.round(xmin - dWidth / 2)));
    const nxMax = Math.min(1000, Math.max(nx + 12, Math.round(xmax + dWidth / 2)));
    onDraftChange([ny, nx, nyMax, nxMax]);
  };

  const commitBox = () => {
    const ymin = Math.max(0, Math.min(985, Math.min(activeBox[0], activeBox[2] - 10)));
    const xmin = Math.max(0, Math.min(985, Math.min(activeBox[1], activeBox[3] - 10)));
    const ymax = Math.max(ymin + 10, Math.min(1000, activeBox[2]));
    const xmax = Math.max(xmin + 10, Math.min(1000, activeBox[3]));
    onApplyBox(field.id, [ymin, xmin, ymax, xmax]);
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
          {field.labelTranslated || field.labelOriginal}
        </h3>
        {field.labelOriginal && field.labelOriginal !== field.labelTranslated && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {field.labelOriginal}
          </p>
        )}
      </div>

      {/* Live magnified crop preview */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
          <span className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
            <Eye className="h-3.5 w-3.5 text-amber-500" />
            <span>Живой фрагмент кропа</span>
          </span>
          <span className="font-mono">
            {activeBox[3] - activeBox[1]}×{activeBox[2] - activeBox[0]}
          </span>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-100 p-1.5 dark:border-slate-800 dark:bg-slate-950">
          <canvas
            ref={canvasRef}
            className="h-[88px] w-full rounded border border-slate-200 bg-white object-contain dark:border-slate-800"
          />
        </div>
      </div>

      {/* Coordinates & Nudge Transform Controls */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-3 dark:border-slate-800 dark:bg-slate-950/50">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
            Координаты области (0..1000)
          </span>
          <button
            type="button"
            onClick={commitBox}
            disabled={Boolean(actionStatus)}
            className="rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors"
          >
            Применить + OCR
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2 tabular-nums">
          {(['Y₁ (верх)', 'X₁ (лево)', 'Y₂ (низ)', 'X₂ (право)'] as const).map((label, idx) => (
            <label key={label} className="block space-y-1">
              <span className="block text-[10px] text-slate-500 dark:text-slate-400">{label}</span>
              <input
                type="number"
                min={0}
                max={1000}
                value={activeBox[idx]}
                onChange={(e) => {
                  const val = Math.max(0, Math.min(1000, Number(e.target.value) || 0));
                  const next: [number, number, number, number] = [...activeBox] as [number, number, number, number];
                  next[idx] = val;
                  onDraftChange(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitBox();
                }}
                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-center font-mono text-xs text-slate-900 focus:border-amber-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={() => nudge(-12, 0)}
            className="flex items-center justify-center rounded border border-slate-200 bg-white py-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            title="Сдвинуть вверх"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => nudge(12, 0)}
            className="flex items-center justify-center rounded border border-slate-200 bg-white py-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            title="Сдвинуть вниз"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => nudge(0, -12)}
            className="flex items-center justify-center rounded border border-slate-200 bg-white py-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            title="Сдвинуть влево"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => nudge(0, 12)}
            className="flex items-center justify-center rounded border border-slate-200 bg-white py-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            title="Сдвинуть вправо"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => resizeBox(0, 24)}
            className="rounded border border-slate-200 bg-white py-1 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            + Шире
          </button>
          <button
            type="button"
            onClick={() => resizeBox(0, -24)}
            className="rounded border border-slate-200 bg-white py-1 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            - Уже
          </button>
          <button
            type="button"
            onClick={() => resizeBox(16, 0)}
            className="rounded border border-slate-200 bg-white py-1 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            + Выше
          </button>
          <button
            type="button"
            onClick={() => resizeBox(-16, 0)}
            className="rounded border border-slate-200 bg-white py-1 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            - Ниже
          </button>
        </div>
      </div>
    </div>
  );
};
