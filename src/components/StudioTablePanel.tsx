import React from 'react';
import { Edit2, Trash2, Plus, Languages, Loader2, ScanEye } from 'lucide-react';
import { DocumentField } from '../types/document';
import { SnippetCropViewer } from './SnippetCropViewer';

interface StudioTablePanelProps {
  fields: DocumentField[];
  previewImageUrl?: string;
  selectedBoxFieldId: string | null;
  editingFieldId: string | null;
  fieldActionStatus: Record<string, 'ocr' | 'translate' | null>;
  fieldActionError: Record<string, string | null>;
  isTouchUI?: boolean;
  onSelectField: (field: DocumentField, jumpToScan?: boolean) => void;
  onSetHighlightBox: (box?: [number, number, number, number]) => void;
  onSetEditingFieldId: (id: string | null) => void;
  onFieldChange: (
    id: string,
    key: 'labelOriginal' | 'labelTranslated' | 'valueOriginal' | 'valueTranslated',
    val: string
  ) => void;
  onInspectCrop: (field: DocumentField) => void;
  onRunFieldOcr: (fieldId: string) => void;
  onRunFieldTranslate: (fieldId: string) => void;
  onDeleteField: (fieldId: string) => void;
  onAddField: () => void;
}

export const StudioTablePanel: React.FC<StudioTablePanelProps> = ({
  fields,
  previewImageUrl,
  selectedBoxFieldId,
  editingFieldId,
  fieldActionStatus,
  fieldActionError,
  isTouchUI = false,
  onSelectField,
  onSetHighlightBox,
  onSetEditingFieldId,
  onFieldChange,
  onInspectCrop,
  onRunFieldOcr,
  onRunFieldTranslate,
  onDeleteField,
  onAddField,
}) => {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {isTouchUI
            ? 'Нажмите на карточку, чтобы перейти к рамке на скане'
            : 'Клик по строке выбирает кроп на скане слева; правки синхронизированы'}
        </p>
        <button
          type="button"
          onClick={onAddField}
          className={`flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 ${
            isTouchUI ? 'px-3 py-1.5 text-xs min-h-[36px] touch-manipulation' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Добавить</span>
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 text-xs">
        {/* Column Header (Desktop) */}
        {!isTouchUI && (
          <div className="hidden sm:grid sm:grid-cols-[minmax(175px,42%)_1fr_64px] sm:gap-3 bg-slate-50/90 px-3 py-2 text-[11px] font-semibold text-slate-600 dark:bg-slate-950 dark:text-slate-400">
            <div>Фрагмент скана (OCR) и реквизит</div>
            <div>Значение перевода</div>
            <div className="text-right">Действия</div>
          </div>
        )}

        {/* Field Rows */}
        {fields.map((field, idx) => {
          const isRowEditing = editingFieldId === field.id;
          const isRowBoxSelected = selectedBoxFieldId === field.id;
          const rowStatus = fieldActionStatus[field.id] || null;
          const rowError = fieldActionError[field.id] || null;

          return (
            <div
              key={field.id}
              onClick={() => onSelectField(field, false)}
              className={`flex flex-col gap-2 px-3 py-2.5 transition-colors ${
                !isTouchUI
                  ? 'sm:grid sm:grid-cols-[minmax(175px,42%)_1fr_64px] sm:gap-3 sm:py-2'
                  : ''
              } ${
                isRowEditing
                  ? 'bg-blue-50/30 dark:bg-blue-950/20 sm:items-start'
                  : isRowBoxSelected
                  ? 'bg-amber-50/50 dark:bg-amber-950/20 sm:items-center'
                  : 'hover:bg-slate-50/70 dark:hover:bg-slate-950/40 sm:items-center'
              }`}
            >
              {/* Visual Snippet Crop & Field Name */}
              <div className="min-w-0">
                <SnippetCropViewer
                  field={field}
                  previewImageUrl={previewImageUrl}
                  isEditing={isRowEditing}
                  onLabelTranslatedChange={(val) => onFieldChange(field.id, 'labelTranslated', val)}
                  onValueOriginalChange={(val) => onFieldChange(field.id, 'valueOriginal', val)}
                  onHoverHighlight={(box) => {
                    onSetHighlightBox(box);
                    if (box) onSelectField(field, false);
                  }}
                  onInspectCrop={() => onInspectCrop(field)}
                  onRunOcr={() => onRunFieldOcr(field.id)}
                  actionStatus={rowStatus}
                  index={idx}
                />
              </div>

              {/* Translated Value + Manual Translate & Inline Actions */}
              <div className="min-w-0 text-slate-800 dark:text-slate-200">
                {isRowEditing ? (
                  <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Значение перевода:
                      </label>
                      <button
                        type="button"
                        onClick={() => onRunFieldTranslate(field.id)}
                        disabled={Boolean(rowStatus) || !field.valueOriginal?.trim()}
                        title="Перевести значение OCR на целевой язык"
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-blue-300/80 bg-blue-50/80 px-2 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-45 disabled:cursor-not-allowed dark:border-blue-800/80 dark:bg-blue-950/40 dark:text-blue-300 touch-manipulation"
                      >
                        {rowStatus === 'translate' ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Languages className="h-3 w-3" />
                        )}
                        <span>{rowStatus === 'translate' ? 'Перевод...' : 'Перевод'}</span>
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={field.valueTranslated}
                      onChange={(e) => onFieldChange(field.id, 'valueTranslated', e.target.value)}
                      className="w-full rounded-md border border-blue-400 bg-white p-2 text-xs font-medium dark:border-blue-600 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onFieldChange(field.id, 'valueTranslated', field.valueOriginal)}
                        className="text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Скопировать оригинал в перевод
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetEditingFieldId(null)}
                        className={`rounded-md bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 ${
                          isTouchUI ? 'inline-flex min-h-[32px] items-center' : 'sm:hidden'
                        }`}
                      >
                        Готово
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs leading-snug text-slate-900 dark:text-slate-100 break-words min-w-0 flex-1">
                        {rowStatus === 'translate' ? (
                          <span className="text-blue-600 dark:text-blue-400 font-medium">
                            Перевод...
                          </span>
                        ) : (
                          field.valueTranslated || (
                            <span className="text-slate-400 font-normal">Нет перевода</span>
                          )
                        )}
                      </span>
                      <div
                        className="flex items-center gap-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isTouchUI && field.box2d && (
                          <button
                            type="button"
                            onClick={() => onSelectField(field, true)}
                            title="Показать рамку на скане"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-amber-300/80 bg-amber-50/80 text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-300 touch-manipulation"
                          >
                            <ScanEye className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRunFieldTranslate(field.id)}
                          disabled={Boolean(rowStatus) || !field.valueOriginal?.trim()}
                          title="Перевести значение OCR на целевой язык"
                          className={`inline-flex shrink-0 items-center gap-1 rounded border font-semibold transition-colors touch-manipulation ${
                            isTouchUI ? 'h-8 px-2 text-[11px]' : 'px-1.5 py-0.5 text-[10px]'
                          } ${
                            rowStatus === 'translate'
                              ? 'border-blue-400 bg-blue-100 text-blue-900 dark:border-blue-700 dark:bg-blue-950/70 dark:text-blue-200'
                              : 'border-blue-300/80 bg-blue-50/80 text-blue-700 hover:bg-blue-100 disabled:opacity-45 disabled:cursor-not-allowed dark:border-blue-800/80 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/60'
                          }`}
                        >
                          {rowStatus === 'translate' ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Languages className="h-3 w-3" />
                          )}
                          <span>{rowStatus === 'translate' ? 'Перевод...' : 'Перевод'}</span>
                        </button>
                        {/* Touch / Mobile-inline Edit & Delete */}
                        <button
                          type="button"
                          onClick={() => onSetEditingFieldId(field.id)}
                          className={`${
                            isTouchUI ? 'inline-flex h-8 w-8 items-center justify-center' : 'sm:hidden p-1'
                          } rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors touch-manipulation`}
                          title="Редактировать"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteField(field.id)}
                          className={`${
                            isTouchUI ? 'inline-flex h-8 w-8 items-center justify-center' : 'sm:hidden p-1'
                          } text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors touch-manipulation`}
                          title="Удалить"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {rowError && (
                      <p className="text-[10px] text-red-600 dark:text-red-400 leading-tight">
                        {rowError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Desktop Actions Column */}
              {!isTouchUI && (
                <div
                  className="hidden sm:flex items-center justify-end gap-1 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onSetEditingFieldId(isRowEditing ? null : field.id)}
                    className={`p-1.5 rounded-md transition-colors ${
                      isRowEditing
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800'
                    }`}
                    title={isRowEditing ? 'Сохранить' : 'Редактировать'}
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteField(field.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-md transition-colors"
                    title="Удалить"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
