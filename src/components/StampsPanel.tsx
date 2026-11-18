import React from 'react';
import { Stamp, Plus, Trash2 } from 'lucide-react';
import { StampOrSeal } from '../types/document';

interface StampsPanelProps {
  stamps: StampOrSeal[];
  onChange: (updated: StampOrSeal[]) => void;
}

const STAMP_TYPE_LABELS: { value: StampOrSeal['type']; label: string }[] = [
  { value: 'round_seal', label: 'Круглая печать' },
  { value: 'stamp', label: 'Прямоугольный штамп' },
  { value: 'apostille', label: 'Апостиль' },
  { value: 'signature', label: 'Подпись' },
  { value: 'watermark', label: 'Водяной знак / отметка' },
];

export const StampsPanel: React.FC<StampsPanelProps> = ({ stamps, onChange }) => {
  const handleUpdateStamp = (id: string, patch: Partial<StampOrSeal>) => {
    onChange(stamps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const handleAddStamp = () => {
    const newStamp: StampOrSeal = {
      id: `seal-manual-${Date.now()}`,
      type: 'round_seal',
      transcription: '',
      translation: '',
    };
    onChange([...stamps, newStamp]);
  };

  const handleDeleteStamp = (id: string) => {
    onChange(stamps.filter((s) => s.id !== id));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
            Печати, штампы и отметки
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            Объектов: {stamps.length} · включаются в экспорт Word (.docx)
          </p>
        </div>

        <button
          type="button"
          onClick={handleAddStamp}
          className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 transition-colors"
        >
          <Plus className="h-3 w-3" />
          <span>Добавить</span>
        </button>
      </div>

      {stamps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center dark:border-slate-800 dark:bg-slate-950/40">
          <Stamp className="mx-auto mb-2.5 h-8 w-8 text-slate-400 stroke-1" />
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Печати и штампы не добавлены
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Добавьте оттиск, штамп, апостиль или подпись вручную, глядя на скан слева.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {stamps.map((stamp, idx) => (
            <div
              key={stamp.id}
              className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2.5 dark:border-slate-800 dark:bg-slate-950/50"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
                    #{idx + 1}
                  </span>
                  <select
                    value={stamp.type}
                    onChange={(e) =>
                      handleUpdateStamp(stamp.id, {
                        type: e.target.value as StampOrSeal['type'],
                      })
                    }
                    className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    {STAMP_TYPE_LABELS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteStamp(stamp.id)}
                  title="Удалить печать"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Текст на печати (оригинал / OCR)
                </label>
                <textarea
                  rows={2}
                  value={stamp.transcription}
                  onChange={(e) =>
                    handleUpdateStamp(stamp.id, { transcription: e.target.value })
                  }
                  placeholder="Например: Министерство юстиции, отдел ЗАГС..."
                  className="w-full rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Перевод текста печати (в .docx)
                </label>
                <textarea
                  rows={2}
                  value={stamp.translation}
                  onChange={(e) =>
                    handleUpdateStamp(stamp.id, { translation: e.target.value })
                  }
                  placeholder="Официальный перевод надписи на печати или штампе..."
                  className="w-full rounded-md border border-slate-200 bg-white p-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
