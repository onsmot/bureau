import React, { useState, useEffect, useRef } from 'react';
import {
  FileDown,
  Copy,
  Check,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Trash2,
  Plus,
  Stamp,
  FileText,
  ArrowLeft,
  AlertCircle,
  Loader2,
  ScanText,
  ScanEye,
  EyeOff,
  Languages,
  PanelRightClose,
  PanelRightOpen,
  Table2,
  Crop,
  ChevronsRight,
  MousePointer2,
  Hand,
  Maximize,
  SquareDashedMousePointer,
  Monitor,
  Smartphone,
  Tablet,
  Undo2,
  ChevronLeft,
  ChevronRight,
  X,
  Move,
  Lock,
} from 'lucide-react';
import { DocumentTranslationData, DocumentField, StampOrSeal } from '../types/document';
import { downloadDocumentAsDocx } from '../utils/docxGenerator';
import { StampsPanel } from './StampsPanel';
import { CropInspectorPanel } from './CropInspectorPanel';
import { StudioTablePanel } from './StudioTablePanel';
import { convertPdfToImageDataUrl } from '../utils/pdfRenderer';
import { cropBoundingBoxToBase64 } from '../utils/cropBoxImage';
import { useStudioInputMode } from '../hooks/useStudioInputMode';

interface SideBySideStudioProps {
  data: DocumentTranslationData;
  onUpdateData: (updated: DocumentTranslationData) => void;
  onBackToUpload: () => void;
}

type UndoEntry =
  | { type: 'update-box'; fieldId: string; prevBox: [number, number, number, number] }
  | { type: 'remove-drawn'; fieldId: string };

export const SideBySideStudio: React.FC<SideBySideStudioProps> = ({
  data,
  onUpdateData,
  onBackToUpload,
}) => {
  const {
    layoutMode,
    isTouchUI,
    orientation,
    override: inputOverride,
    setOverride: setInputOverride,
  } = useStudioInputMode();

  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [rotation, setRotation] = useState<number>(0);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);
  const [rightPanelTab, setRightPanelTab] = useState<'fields' | 'stamps' | 'crop'>('fields');
  const [phoneTab, setPhoneTab] = useState<'scan' | 'fields' | 'stamps' | 'crop'>('scan');
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(460);
  const [isResizingPanel, setIsResizingPanel] = useState<boolean>(false);
  const [boxDraft, setBoxDraft] = useState<[number, number, number, number] | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [downloadNotification, setDownloadNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [copiedToast, setCopiedToast] = useState<boolean>(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [highlightBox, setHighlightBox] = useState<[number, number, number, number] | undefined>(undefined);
  const [selectedBoxFieldId, setSelectedBoxFieldId] = useState<string | null>(null);
  const [editableBoxFieldId, setEditableBoxFieldId] = useState<string | null>(null);
  const [showAllBoxes, setShowAllBoxes] = useState<boolean>(true);
  const [fieldActionStatus, setFieldActionStatus] = useState<Record<string, 'ocr' | 'translate' | null>>({});
  const [fieldActionError, setFieldActionError] = useState<Record<string, string | null>>({});
  const [inlineDragBox, setInlineDragBox] = useState<{
    fieldId: string;
    box: [number, number, number, number];
  } | null>(null);
  const [scanBaseSize, setScanBaseSize] = useState<{ width: number; height: number } | null>(null);
  const [activeTool, setActiveTool] = useState<'select' | 'hand' | 'draw'>('select');
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [isPinching, setIsPinching] = useState<boolean>(false);
  const [drawingBox, setDrawingBox] = useState<[number, number, number, number] | null>(null);
  const [undoCount, setUndoCount] = useState<number>(0);
  const [contextMenu, setContextMenu] = useState<{
    fieldId: string;
    x: number;
    y: number;
  } | null>(null);

  const scanContainerRef = useRef<HTMLDivElement>(null);
  const scanImgRef = useRef<HTMLImageElement>(null);
  const justFinishedDrawRef = useRef<boolean>(false);
  const justFinishedPanRef = useRef<boolean>(false);
  const lastTouchTapRef = useRef<{ fieldId: string; time: number; x: number; y: number } | null>(null);
  const boxUndoStackRef = useRef<UndoEntry[]>([]);
  const pendingZoomScrollRef = useRef<{
    relX: number;
    relY: number;
    vpX: number;
    vpY: number;
    prevZoom: number;
  } | null>(null);

  const activeTouchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{
    startDist: number;
    startZoom: number;
    startMidX: number;
    startMidY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);

  const drawDragRef = useRef<{
    startX: number;
    startY: number;
    startNormX: number;
    startNormY: number;
    currentBox: [number, number, number, number];
    hasMoved: boolean;
  } | null>(null);
  const panDragRef = useRef<{
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
    hasMoved: boolean;
  } | null>(null);
  const inlineDragRef = useRef<{
    fieldId: string;
    handle: 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'w' | 'e';
    startX: number;
    startY: number;
    startBox: [number, number, number, number];
    currentBox: [number, number, number, number];
    baseWidth: number;
    baseHeight: number;
    scale: number;
    rotation: number;
    hasMoved: boolean;
  } | null>(null);

  const effectiveTool: 'select' | 'hand' | 'draw' =
    isTouchUI && activeTool === 'hand'
      ? 'select'
      : isSpacePressed && !isTouchUI
      ? 'hand'
      : activeTool;

  // Keep latest data in ref so sequential async OCR -> Translate updates never clobber each other
  const dataRef = useRef<DocumentTranslationData>(data);
  dataRef.current = data;
  const manuallyEditedFieldIdsRef = useRef<Record<string, boolean>>({});
  const zoomLevelRef = useRef<number>(zoomLevel);
  zoomLevelRef.current = zoomLevel;
  const isTouchUIRef = useRef<boolean>(isTouchUI);
  isTouchUIRef.current = isTouchUI;

  useEffect(() => {
    manuallyEditedFieldIdsRef.current = {};
    boxUndoStackRef.current = [];
    lastTouchTapRef.current = null;
    setUndoCount(0);
    setSelectedBoxFieldId(null);
    setEditableBoxFieldId(null);
    setHighlightBox(undefined);
    setContextMenu(null);
  }, [data.id]);

  // Convert raw PDF to image data URL if necessary
  const [resolvedImageUrl, setResolvedImageUrl] = useState<string | undefined>(
    data.previewUrl && !data.previewUrl.startsWith('data:application/pdf') ? data.previewUrl : undefined
  );
  const resolvedImageUrlRef = useRef<string | undefined>(resolvedImageUrl);
  resolvedImageUrlRef.current = resolvedImageUrl;
  const [isPdfRendering, setIsPdfRendering] = useState<boolean>(false);

  useEffect(() => {
    setScanBaseSize(null);
    if (!data.previewUrl) {
      setResolvedImageUrl(undefined);
      return;
    }

    if (data.previewUrl.startsWith('data:application/pdf')) {
      setIsPdfRendering(true);
      convertPdfToImageDataUrl(data.previewUrl)
        .then((png) => {
          setResolvedImageUrl(png);
        })
        .catch((err) => {
          console.warn('PDF rendering in SideBySideStudio failed:', err);
        })
        .finally(() => setIsPdfRendering(false));
    } else {
      setResolvedImageUrl(data.previewUrl);
    }
  }, [data.previewUrl]);

  const effectivePreviewUrl = resolvedImageUrl || data.previewUrl;

  const selectedBoxField = selectedBoxFieldId
    ? data.fields.find((f) => f.id === selectedBoxFieldId)
    : undefined;

  useEffect(() => {
    if (selectedBoxField?.box2d && selectedBoxField.box2d.length === 4) {
      setBoxDraft([...selectedBoxField.box2d] as [number, number, number, number]);
    } else {
      setBoxDraft(null);
    }
  }, [selectedBoxFieldId, selectedBoxField?.box2d?.[0], selectedBoxField?.box2d?.[1], selectedBoxField?.box2d?.[2], selectedBoxField?.box2d?.[3]]);

  useEffect(() => {
    if (zoomLevel !== 100 || rotation !== 0) return;
    const img = scanImgRef.current;
    if (!img) return;
    const observer = new ResizeObserver(() => {
      if (scanImgRef.current && zoomLevel === 100 && rotation === 0 && scanImgRef.current.offsetWidth > 0) {
        setScanBaseSize({
          width: scanImgRef.current.offsetWidth,
          height: scanImgRef.current.offsetHeight,
        });
      }
    });
    observer.observe(img);
    return () => observer.disconnect();
  }, [zoomLevel, rotation, effectivePreviewUrl, layoutMode, phoneTab, isRightPanelOpen]);

  // Apply zoom-to-cursor scroll compensation right after zoomLevel updates
  useEffect(() => {
    const pending = pendingZoomScrollRef.current;
    const container = scanContainerRef.current;
    if (!pending || !container) return;
    pendingZoomScrollRef.current = null;
    const ratio = zoomLevel / Math.max(1, pending.prevZoom);
    window.requestAnimationFrame(() => {
      container.scrollLeft = Math.max(0, pending.relX * ratio - pending.vpX);
      container.scrollTop = Math.max(0, pending.relY * ratio - pending.vpY);
    });
  }, [zoomLevel]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [contextMenu]);

  // Desktop split-pane width splitter drag
  const panelResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const resize = panelResizeRef.current;
      if (!resize) return;
      const delta = resize.startX - e.clientX;
      const maxAllowed =
        typeof window !== 'undefined'
          ? Math.min(720, Math.max(340, window.innerWidth - 360))
          : 720;
      const nextWidth = Math.max(320, Math.min(maxAllowed, resize.startWidth + delta));
      setRightPanelWidth(nextWidth);
    };
    const onUp = () => {
      if (panelResizeRef.current) {
        panelResizeRef.current = null;
        setIsResizingPanel(false);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const startPanelResize = (e: React.PointerEvent) => {
    e.preventDefault();
    panelResizeRef.current = { startX: e.clientX, startWidth: rightPanelWidth };
    setIsResizingPanel(true);
  };

  const toggleRailTab = (tab: 'fields' | 'stamps' | 'crop') => {
    if (isRightPanelOpen && rightPanelTab === tab) {
      setIsRightPanelOpen(false);
    } else {
      setRightPanelTab(tab);
      setIsRightPanelOpen(true);
    }
  };

  const updateFieldData = (fieldId: string, patch: Partial<DocumentField>) => {
    const current = dataRef.current;
    const nextFields = current.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f));
    const nextData: DocumentTranslationData = { ...current, fields: nextFields };
    dataRef.current = nextData;
    onUpdateData(nextData);
  };

  const pushUndo = (entry: UndoEntry) => {
    boxUndoStackRef.current = [...boxUndoStackRef.current.slice(-19), entry];
    setUndoCount(boxUndoStackRef.current.length);
  };

  const handleUndoBoxChange = () => {
    const stack = boxUndoStackRef.current;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    boxUndoStackRef.current = stack.slice(0, -1);
    setUndoCount(boxUndoStackRef.current.length);

    if (last.type === 'update-box') {
      updateFieldData(last.fieldId, { box2d: last.prevBox });
      setSelectedBoxFieldId(last.fieldId);
      setHighlightBox(last.prevBox);
      setBoxDraft(last.prevBox);
    } else if (last.type === 'remove-drawn') {
      const current = dataRef.current;
      const nextData = {
        ...current,
        fields: current.fields.filter((f) => f.id !== last.fieldId),
      };
      dataRef.current = nextData;
      onUpdateData(nextData);
      if (selectedBoxFieldId === last.fieldId) {
        setSelectedBoxFieldId(null);
        setEditableBoxFieldId(null);
        setHighlightBox(undefined);
      } else if (editableBoxFieldId === last.fieldId) {
        setEditableBoxFieldId(null);
      }
    }
  };

  const scrollBoxIntoView = (box?: [number, number, number, number]) => {
    if (!box || !scanContainerRef.current || !scanImgRef.current) return;
    const container = scanContainerRef.current;
    const imgRect = scanImgRef.current.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const centerYFrac = (box[0] + box[2]) / 2000;
    const centerXFrac = (box[1] + box[3]) / 2000;
    const targetClientX = imgRect.left + imgRect.width * centerXFrac;
    const targetClientY = imgRect.top + imgRect.height * centerYFrac;

    const targetLeft =
      container.scrollLeft + (targetClientX - containerRect.left) - container.clientWidth / 2;
    const targetTop =
      container.scrollTop + (targetClientY - containerRect.top) - container.clientHeight / 2;

    container.scrollTo({
      left: Math.max(0, targetLeft),
      top: Math.max(0, targetTop),
      behavior: 'smooth',
    });
  };

  const stepFieldSelection = (direction: -1 | 1) => {
    const fieldsWithBox = dataRef.current.fields;
    if (fieldsWithBox.length === 0) return;
    const currentIndex = selectedBoxFieldId
      ? fieldsWithBox.findIndex((f) => f.id === selectedBoxFieldId)
      : -1;
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : fieldsWithBox.length - 1
        : (currentIndex + direction + fieldsWithBox.length) % fieldsWithBox.length;
    const nextField = fieldsWithBox[nextIndex];
    if (!nextField) return;
    setSelectedBoxFieldId(nextField.id);
    setEditableBoxFieldId(isTouchUIRef.current ? null : nextField.id);
    if (nextField.box2d) {
      setHighlightBox(nextField.box2d);
      window.requestAnimationFrame(() => scrollBoxIntoView(nextField.box2d));
    }
  };

  const resolveScanImageUrl = async (): Promise<string | undefined> => {
    if (resolvedImageUrlRef.current) return resolvedImageUrlRef.current;
    const preview = dataRef.current.previewUrl;
    if (!preview) return undefined;
    if (preview.startsWith('data:application/pdf')) {
      const rendered = await convertPdfToImageDataUrl(preview);
      resolvedImageUrlRef.current = rendered;
      setResolvedImageUrl(rendered);
      return rendered;
    }
    return preview;
  };

  // Run single-field OCR (and optional translation in the same call to save API quota)
  const runFieldOcr = async (
    fieldId: string,
    overrideBox?: [number, number, number, number],
    options?: { includeTranslation?: boolean }
  ): Promise<string | null> => {
    const field = dataRef.current.fields.find((f) => f.id === fieldId);
    if (!field) return null;

    const includeTranslation = Boolean(options?.includeTranslation);
    const targetBox: [number, number, number, number] =
      overrideBox || field.box2d || [0, 0, 1000, 1000];

    setFieldActionStatus((prev) => ({ ...prev, [fieldId]: 'ocr' }));
    setFieldActionError((prev) => ({ ...prev, [fieldId]: null }));

    try {
      const imageUrl = await resolveScanImageUrl();
      if (!imageUrl) {
        throw new Error('Изображение скана недоступно для OCR');
      }

      const { base64, mimeType } = await cropBoundingBoxToBase64(imageUrl, targetBox);

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 35000);

      let response: Response;
      try {
        response = await fetch('/api/ocr-field', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            cropBase64: base64,
            mimeType,
            fieldLabelOriginal: field.labelOriginal,
            fieldLabelTranslated: field.labelTranslated,
            sourceLang: dataRef.current.sourceLanguage,
            targetLang: dataRef.current.targetLanguage || 'Русский (Russian)',
            documentType: dataRef.current.documentType,
            includeTranslation,
          }),
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Ошибка OCR распознавания');
      }

      const recognized = typeof json.valueOriginal === 'string' ? json.valueOriginal : '';
      const translated =
        includeTranslation && typeof json.valueTranslated === 'string'
          ? json.valueTranslated
          : undefined;
      updateFieldData(fieldId, {
        valueOriginal: recognized,
        ...(translated !== undefined ? { valueTranslated: translated } : {}),
        ...(typeof json.confidence === 'number' ? { confidence: json.confidence } : {}),
      });
      return recognized;
    } catch (err: any) {
      const msg =
        err?.name === 'AbortError'
          ? 'Превышено время ожидания OCR'
          : err?.message || 'Ошибка при распознавании OCR';
      setFieldActionError((prev) => ({ ...prev, [fieldId]: msg }));
      return null;
    } finally {
      setFieldActionStatus((prev) => (prev[fieldId] === 'ocr' ? { ...prev, [fieldId]: null } : prev));
    }
  };

  // Run single-field translation from current or newly extracted OCR text
  const runFieldTranslate = async (
    fieldId: string,
    overrideValueOriginal?: string
  ): Promise<string | null> => {
    const field = dataRef.current.fields.find((f) => f.id === fieldId);
    if (!field) return null;

    const sourceText =
      overrideValueOriginal !== undefined ? overrideValueOriginal : field.valueOriginal;
    if (!sourceText || !sourceText.trim()) {
      setFieldActionError((prev) => ({
        ...prev,
        [fieldId]: 'Сначала распознайте или введите текст OCR',
      }));
      return null;
    }

    setFieldActionStatus((prev) => ({ ...prev, [fieldId]: 'translate' }));
    setFieldActionError((prev) => ({ ...prev, [fieldId]: null }));

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 35000);

      let response: Response;
      try {
        response = await fetch('/api/translate-field', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            valueOriginal: sourceText,
            fieldLabelOriginal: field.labelOriginal,
            fieldLabelTranslated: field.labelTranslated,
            sourceLang: dataRef.current.sourceLanguage,
            targetLang: dataRef.current.targetLanguage || 'Русский (Russian)',
            documentType: dataRef.current.documentType,
          }),
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Ошибка перевода поля');
      }

      const translated = typeof json.valueTranslated === 'string' ? json.valueTranslated : '';
      updateFieldData(fieldId, { valueTranslated: translated });
      return translated;
    } catch (err: any) {
      const msg =
        err?.name === 'AbortError'
          ? 'Превышено время ожидания перевода'
          : err?.message || 'Ошибка при переводе поля';
      setFieldActionError((prev) => ({ ...prev, [fieldId]: msg }));
      return null;
    } finally {
      setFieldActionStatus((prev) =>
        prev[fieldId] === 'translate' ? { ...prev, [fieldId]: null } : prev
      );
    }
  };

  // Single combined request: OCR + Translation in one call to conserve Gemini API RPM quota
  const runAutoOcrThenTranslate = async (
    fieldId: string,
    newBox: [number, number, number, number]
  ) => {
    await runFieldOcr(fieldId, newBox, { includeTranslation: true });
  };

  // Update bounding box coordinates and auto-trigger OCR -> Translation if coordinates changed & field wasn't manually edited
  const handleUpdateFieldBox = (
    fieldId: string,
    newBox: [number, number, number, number],
    updatedValues?: { valueOriginal?: string; valueTranslated?: string }
  ) => {
    const prevField = dataRef.current.fields.find((f) => f.id === fieldId);
    const prevBox = prevField?.box2d;
    const didBoxChange =
      !prevBox ||
      prevBox[0] !== newBox[0] ||
      prevBox[1] !== newBox[1] ||
      prevBox[2] !== newBox[2] ||
      prevBox[3] !== newBox[3];

    if (didBoxChange && prevBox && prevBox.length === 4) {
      pushUndo({ type: 'update-box', fieldId, prevBox: [...prevBox] as [number, number, number, number] });
    }

    updateFieldData(fieldId, {
      box2d: newBox,
      ...(updatedValues?.valueOriginal !== undefined ? { valueOriginal: updatedValues.valueOriginal } : {}),
      ...(updatedValues?.valueTranslated !== undefined ? { valueTranslated: updatedValues.valueTranslated } : {}),
    });
    setHighlightBox(newBox);
    setSelectedBoxFieldId(fieldId);

    if (didBoxChange && !manuallyEditedFieldIdsRef.current[fieldId]) {
      void runAutoOcrThenTranslate(fieldId, newBox);
    }
  };

  const handleUpdateFieldBoxRef = useRef(handleUpdateFieldBox);
  handleUpdateFieldBoxRef.current = handleUpdateFieldBox;

  const handleUndoRef = useRef(handleUndoBoxChange);
  handleUndoRef.current = handleUndoBoxChange;

  const stepFieldRef = useRef(stepFieldSelection);
  stepFieldRef.current = stepFieldSelection;

  // Global pointer listeners for smooth inline drag & resize of bounding boxes on the main scan
  useEffect(() => {
    const computeNewBox = (
      drag: NonNullable<typeof inlineDragRef.current>,
      clientX: number,
      clientY: number
    ): [number, number, number, number] => {
      const screenDx = clientX - drag.startX;
      const screenDy = clientY - drag.startY;
      const unscaledDx = screenDx / drag.scale;
      const unscaledDy = screenDy / drag.scale;

      // Map screen delta back into unrotated image coordinate space
      const rot = ((drag.rotation % 360) + 360) % 360;
      let localDx = unscaledDx;
      let localDy = unscaledDy;
      if (rot === 90) {
        localDx = unscaledDy;
        localDy = -unscaledDx;
      } else if (rot === 180) {
        localDx = -unscaledDx;
        localDy = -unscaledDy;
      } else if (rot === 270) {
        localDx = -unscaledDy;
        localDy = unscaledDx;
      }

      const dx = (localDx / drag.baseWidth) * 1000;
      const dy = (localDy / drag.baseHeight) * 1000;
      const [ymin, xmin, ymax, xmax] = drag.startBox;
      const boxW = xmax - xmin;
      const boxH = ymax - ymin;

      if (drag.handle === 'move') {
        const newXmin = Math.max(0, Math.min(1000 - boxW, xmin + dx));
        const newYmin = Math.max(0, Math.min(1000 - boxH, ymin + dy));
        return [
          Math.round(newYmin),
          Math.round(newXmin),
          Math.round(newYmin + boxH),
          Math.round(newXmin + boxW),
        ];
      }
      if (drag.handle === 'nw') {
        const newYmin = Math.max(0, Math.min(ymax - 12, ymin + dy));
        const newXmin = Math.max(0, Math.min(xmax - 12, xmin + dx));
        return [Math.round(newYmin), Math.round(newXmin), ymax, xmax];
      }
      if (drag.handle === 'ne') {
        const newYmin = Math.max(0, Math.min(ymax - 12, ymin + dy));
        const newXmax = Math.max(xmin + 12, Math.min(1000, xmax + dx));
        return [Math.round(newYmin), xmin, ymax, Math.round(newXmax)];
      }
      if (drag.handle === 'se') {
        const newYmax = Math.max(ymin + 12, Math.min(1000, ymax + dy));
        const newXmax = Math.max(xmin + 12, Math.min(1000, xmax + dx));
        return [ymin, xmin, Math.round(newYmax), Math.round(newXmax)];
      }
      if (drag.handle === 'sw') {
        const newYmax = Math.max(ymin + 12, Math.min(1000, ymax + dy));
        const newXmin = Math.max(0, Math.min(xmax - 12, xmin + dx));
        return [ymin, Math.round(newXmin), Math.round(newYmax), xmax];
      }
      if (drag.handle === 'n') {
        const newYmin = Math.max(0, Math.min(ymax - 12, ymin + dy));
        return [Math.round(newYmin), xmin, ymax, xmax];
      }
      if (drag.handle === 's') {
        const newYmax = Math.max(ymin + 12, Math.min(1000, ymax + dy));
        return [ymin, xmin, Math.round(newYmax), xmax];
      }
      if (drag.handle === 'w') {
        const newXmin = Math.max(0, Math.min(xmax - 12, xmin + dx));
        return [ymin, Math.round(newXmin), ymax, xmax];
      }
      const newXmax = Math.max(xmin + 12, Math.min(1000, xmax + dx));
      return [ymin, xmin, ymax, Math.round(newXmax)];
    };

    const onPointerMove = (e: PointerEvent) => {
      const drag = inlineDragRef.current;
      if (!drag) return;

      if (!drag.hasMoved) {
        const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
        if (dist < 4) return;
        drag.hasMoved = true;
      }

      e.preventDefault();
      const nextBox = computeNewBox(drag, e.clientX, e.clientY);
      drag.currentBox = nextBox;
      setInlineDragBox({ fieldId: drag.fieldId, box: nextBox });
      setBoxDraft(nextBox);
    };

    const onPointerUp = () => {
      const drag = inlineDragRef.current;
      if (!drag) return;
      inlineDragRef.current = null;
      setInlineDragBox(null);

      if (drag.hasMoved) {
        const [sy0, sx0, sy1, sx1] = drag.startBox;
        const [ny0, nx0, ny1, nx1] = drag.currentBox;
        if (sy0 !== ny0 || sx0 !== nx0 || sy1 !== ny1 || sx1 !== nx1) {
          handleUpdateFieldBoxRef.current(drag.fieldId, drag.currentBox);
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  // Keyboard shortcuts (Desktop: V/H/B, Space, Tab/Shift+Tab, Ctrl+Z, Esc) and pointer pan handlers
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isTypingTarget(e.target)) {
        e.preventDefault();
        handleUndoRef.current();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        stepFieldRef.current(e.shiftKey ? -1 : 1);
      } else if (e.key === 'v' || e.key === 'V' || e.key === 'м' || e.key === 'М') {
        setActiveTool('select');
      } else if (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') {
        setActiveTool('hand');
      } else if (e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И') {
        setActiveTool('draw');
      } else if (e.key === 'Escape') {
        setContextMenu(null);
        if (drawDragRef.current) {
          drawDragRef.current = null;
          setDrawingBox(null);
        } else {
          setEditableBoxFieldId(null);
          setActiveTool('select');
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    const onWindowBlur = () => {
      setIsSpacePressed(false);
      panDragRef.current = null;
      setIsPanning(false);
      drawDragRef.current = null;
      setDrawingBox(null);
      activeTouchPointersRef.current.clear();
      pinchStateRef.current = null;
      setIsPinching(false);
    };

    const onPanMove = (e: PointerEvent) => {
      const pan = panDragRef.current;
      const container = scanContainerRef.current;
      if (!pan || !container) return;

      if (!pan.hasMoved) {
        const dist = Math.hypot(e.clientX - pan.startX, e.clientY - pan.startY);
        if (dist < 4) return;
        pan.hasMoved = true;
        setIsPanning(true);
      }

      e.preventDefault();
      container.scrollLeft = pan.startScrollLeft - (e.clientX - pan.startX);
      container.scrollTop = pan.startScrollTop - (e.clientY - pan.startY);
    };

    const onPanUp = () => {
      if (panDragRef.current) {
        const didPan = panDragRef.current.hasMoved;
        panDragRef.current = null;
        setIsPanning(false);
        if (didPan) {
          justFinishedPanRef.current = true;
          window.requestAnimationFrame(() => {
            justFinishedPanRef.current = false;
          });
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('pointermove', onPanMove);
    window.addEventListener('pointerup', onPanUp);
    window.addEventListener('pointercancel', onPanUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('pointermove', onPanMove);
      window.removeEventListener('pointerup', onPanUp);
      window.removeEventListener('pointercancel', onPanUp);
    };
  }, []);

  const clientPointToNorm = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const imgElem = scanImgRef.current;
    if (!imgElem || imgElem.offsetWidth === 0 || imgElem.offsetHeight === 0) return null;
    const rect = imgElem.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const scale = zoomLevel / 100;
    const ux = (clientX - cx) / scale;
    const uy = (clientY - cy) / scale;

    const rot = ((rotation % 360) + 360) % 360;
    let lx = ux;
    let ly = uy;
    if (rot === 90) {
      lx = uy;
      ly = -ux;
    } else if (rot === 180) {
      lx = -ux;
      ly = -uy;
    } else if (rot === 270) {
      lx = -uy;
      ly = ux;
    }

    const baseW = imgElem.offsetWidth;
    const baseH = imgElem.offsetHeight;
    const xNorm = Math.max(0, Math.min(1000, Math.round(((lx + baseW / 2) / baseW) * 1000)));
    const yNorm = Math.max(0, Math.min(1000, Math.round(((ly + baseH / 2) / baseH) * 1000)));
    return { x: xNorm, y: yNorm };
  };

  const clientPointToNormRef = useRef(clientPointToNorm);
  clientPointToNormRef.current = clientPointToNorm;

  const finalizeDrawnBox = (finalBox: [number, number, number, number]) => {
    const current = dataRef.current;
    const newField: DocumentField = {
      id: `f-draw-${Date.now()}`,
      key: `custom_${Date.now()}`,
      labelOriginal: `Область ${current.fields.length + 1}`,
      labelTranslated: `Область ${current.fields.length + 1}`,
      valueOriginal: '',
      valueTranslated: '',
      confidence: 1.0,
      category: 'personal',
      box2d: finalBox,
    };
    pushUndo({ type: 'remove-drawn', fieldId: newField.id });
    const nextData: DocumentTranslationData = {
      ...current,
      fields: [...current.fields, newField],
    };
    dataRef.current = nextData;
    onUpdateData(nextData);
    setShowAllBoxes(true);
    setSelectedBoxFieldId(newField.id);
    setEditableBoxFieldId(newField.id);
    setHighlightBox(finalBox);
    setBoxDraft(finalBox);
    setActiveTool('select');
    void runAutoOcrThenTranslate(newField.id, finalBox);
  };

  const finalizeDrawnBoxRef = useRef(finalizeDrawnBox);
  finalizeDrawnBoxRef.current = finalizeDrawnBox;

  useEffect(() => {
    const onDrawMove = (e: PointerEvent) => {
      const drag = drawDragRef.current;
      if (!drag) return;

      if (!drag.hasMoved) {
        const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
        if (dist < 4) return;
        drag.hasMoved = true;
      }

      e.preventDefault();
      const pt = clientPointToNormRef.current(e.clientX, e.clientY);
      if (!pt) return;

      const ymin = Math.min(drag.startNormY, pt.y);
      const xmin = Math.min(drag.startNormX, pt.x);
      const ymax = Math.max(drag.startNormY, pt.y);
      const xmax = Math.max(drag.startNormX, pt.x);
      const nextBox: [number, number, number, number] = [ymin, xmin, ymax, xmax];
      drag.currentBox = nextBox;
      setDrawingBox(nextBox);
    };

    const onDrawUp = () => {
      const drag = drawDragRef.current;
      if (!drag) return;
      drawDragRef.current = null;
      setDrawingBox(null);

      if (drag.hasMoved) {
        const [ymin, xmin, ymax, xmax] = drag.currentBox;
        if (ymax - ymin >= 6 && xmax - xmin >= 6) {
          justFinishedDrawRef.current = true;
          window.requestAnimationFrame(() => {
            justFinishedDrawRef.current = false;
          });
          finalizeDrawnBoxRef.current(drag.currentBox);
        }
      }
    };

    window.addEventListener('pointermove', onDrawMove);
    window.addEventListener('pointerup', onDrawUp);
    window.addEventListener('pointercancel', onDrawUp);
    return () => {
      window.removeEventListener('pointermove', onDrawMove);
      window.removeEventListener('pointerup', onDrawUp);
      window.removeEventListener('pointercancel', onDrawUp);
    };
  }, []);

  // Touch pinch-to-zoom & 2-finger pan listeners on scan container
  useEffect(() => {
    const onTouchMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !activeTouchPointersRef.current.has(e.pointerId)) return;
      activeTouchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const pinch = pinchStateRef.current;
      const container = scanContainerRef.current;
      if (activeTouchPointersRef.current.size === 2 && pinch && container) {
        e.preventDefault();
        const pts = Array.from(activeTouchPointersRef.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;

        if (pinch.startDist > 10) {
          const rawZoom = Math.round(pinch.startZoom * (dist / pinch.startDist));
          const clampedZoom = Math.max(50, Math.min(350, rawZoom));
          if (Math.abs(clampedZoom - zoomLevelRef.current) >= 3) {
            captureScanBaseSize();
            setZoomLevel(clampedZoom);
          }
        }
        container.scrollLeft = Math.max(0, pinch.startScrollLeft - (midX - pinch.startMidX));
        container.scrollTop = Math.max(0, pinch.startScrollTop - (midY - pinch.startMidY));
      }
    };

    const onTouchEnd = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      activeTouchPointersRef.current.delete(e.pointerId);
      if (activeTouchPointersRef.current.size < 2 && pinchStateRef.current) {
        pinchStateRef.current = null;
        setIsPinching(false);
      }
    };

    window.addEventListener('pointermove', onTouchMove, { passive: false });
    window.addEventListener('pointerup', onTouchEnd);
    window.addEventListener('pointercancel', onTouchEnd);
    return () => {
      window.removeEventListener('pointermove', onTouchMove);
      window.removeEventListener('pointerup', onTouchEnd);
      window.removeEventListener('pointercancel', onTouchEnd);
    };
  }, []);

  const handleScanDrawStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const canDrawHere =
      effectiveTool === 'draw' || (isTouchUI && e.pointerType === 'pen');
    if (!canDrawHere || e.button !== 0 || isRawPdf) return;
    if (activeTouchPointersRef.current.size >= 2) return;
    const pt = clientPointToNorm(e.clientX, e.clientY);
    if (!pt) return;
    e.preventDefault();
    const initialBox: [number, number, number, number] = [pt.y, pt.x, pt.y, pt.x];
    drawDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startNormX: pt.x,
      startNormY: pt.y,
      currentBox: initialBox,
      hasMoved: false,
    };
  };

  const handleScanPanStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = scanContainerRef.current;
    if (e.pointerType === 'touch' && container) {
      activeTouchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activeTouchPointersRef.current.size === 2) {
        // Cancel any 1-finger box drag/draw when a second finger touches down for pinch-zoom
        inlineDragRef.current = null;
        setInlineDragBox(null);
        drawDragRef.current = null;
        setDrawingBox(null);

        const pts = Array.from(activeTouchPointersRef.current.values());
        pinchStateRef.current = {
          startDist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
          startZoom: zoomLevelRef.current,
          startMidX: (pts[0].x + pts[1].x) / 2,
          startMidY: (pts[0].y + pts[1].y) / 2,
          startScrollLeft: container.scrollLeft,
          startScrollTop: container.scrollTop,
        };
        setIsPinching(true);
        return;
      }
    }

    const isMiddleClick = e.button === 1;
    const isPenDraw = isTouchUI && e.pointerType === 'pen';
    const canMousePan =
      e.pointerType !== 'touch' &&
      !isPenDraw &&
      (effectiveTool === 'hand' ||
        isMiddleClick ||
        (effectiveTool === 'select' && e.button === 0));
    if (!canMousePan || !container) return;
    if (effectiveTool === 'hand' || isMiddleClick) {
      e.preventDefault();
    }
    panDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: container.scrollLeft,
      startScrollTop: container.scrollTop,
      hasMoved: false,
    };
  };

  const startInlineBoxDrag = (
    e: React.PointerEvent,
    fieldId: string,
    box: [number, number, number, number],
    handle: 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'w' | 'e'
  ) => {
    if (effectiveTool === 'hand' || e.button === 2) return;
    if (e.pointerType === 'touch') {
      activeTouchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (activeTouchPointersRef.current.size >= 2) return;
    e.preventDefault();
    e.stopPropagation();

    const imgElem = scanImgRef.current;
    if (!imgElem || imgElem.offsetWidth === 0 || imgElem.offsetHeight === 0) return;

    setContextMenu(null);
    setSelectedBoxFieldId(fieldId);
    setEditableBoxFieldId(fieldId);
    setHighlightBox(box);

    inlineDragRef.current = {
      fieldId,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startBox: [...box] as [number, number, number, number],
      currentBox: [...box] as [number, number, number, number],
      baseWidth: imgElem.offsetWidth,
      baseHeight: imgElem.offsetHeight,
      scale: zoomLevel / 100,
      rotation,
      hasMoved: false,
    };
  };

  const isRawPdf = Boolean(
    !resolvedImageUrl &&
      (data.previewUrl?.startsWith('data:application/pdf') ||
        data.originalFileName?.toLowerCase().endsWith('.pdf'))
  );

  // Zoom and rotate handlers
  const captureScanBaseSize = () => {
    const img = scanImgRef.current;
    if (img && img.offsetWidth > 0 && img.offsetHeight > 0 && zoomLevelRef.current === 100 && rotation === 0) {
      setScanBaseSize({ width: img.offsetWidth, height: img.offsetHeight });
    }
  };

  const handleZoomIn = () => {
    captureScanBaseSize();
    setZoomLevel((prev) => Math.min(prev + 25, 350));
  };
  const handleZoomOut = () => {
    captureScanBaseSize();
    setZoomLevel((prev) => Math.max(prev - 25, 50));
  };

  // Zoom-to-cursor on Ctrl+Wheel / Meta+Wheel
  useEffect(() => {
    const container = scanContainerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        captureScanBaseSize();
        const rect = container.getBoundingClientRect();
        const vpX = e.clientX - rect.left;
        const vpY = e.clientY - rect.top;
        const relX = container.scrollLeft + vpX;
        const relY = container.scrollTop + vpY;
        const prevZoom = zoomLevelRef.current;
        const nextZoom =
          e.deltaY < 0 ? Math.min(prevZoom + 25, 350) : Math.max(prevZoom - 25, 50);

        if (nextZoom !== prevZoom) {
          pendingZoomScrollRef.current = { relX, relY, vpX, vpY, prevZoom };
          setZoomLevel(nextZoom);
        }
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, [layoutMode, phoneTab]);

  const handleRotate = () => {
    captureScanBaseSize();
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleResetView = () => {
    setZoomLevel(100);
    setRotation(0);
    if (scanContainerRef.current) {
      scanContainerRef.current.scrollTo({ top: 0, left: 0 });
    }
  };

  // Field editing (supports editing both translated and original OCR values)
  const handleFieldChange = (
    id: string,
    keyToUpdate: 'labelOriginal' | 'labelTranslated' | 'valueOriginal' | 'valueTranslated',
    newVal: string
  ) => {
    updateFieldData(id, { [keyToUpdate]: newVal });
  };

  const handleDeleteField = (id: string) => {
    const current = dataRef.current;
    const nextData = { ...current, fields: current.fields.filter((f) => f.id !== id) };
    dataRef.current = nextData;
    onUpdateData(nextData);
    if (selectedBoxFieldId === id) {
      setSelectedBoxFieldId(null);
      setEditableBoxFieldId(null);
      setHighlightBox(undefined);
    } else if (editableBoxFieldId === id) {
      setEditableBoxFieldId(null);
    }
  };

  const handleAddField = () => {
    const current = dataRef.current;
    const newField: DocumentField = {
      id: `f-manual-${Date.now()}`,
      key: `custom_${Date.now()}`,
      labelOriginal: 'Новый реквизит',
      labelTranslated: 'Новый реквизит',
      valueOriginal: '',
      valueTranslated: '',
      confidence: 1.0,
      category: 'personal',
    };
    const nextData = { ...current, fields: [...current.fields, newField] };
    dataRef.current = nextData;
    onUpdateData(nextData);
    setEditingFieldId(newField.id);
  };

  // Stamp editing
  const handleStampsChange = (updatedStamps: StampOrSeal[]) => {
    const current = dataRef.current;
    const nextData = { ...current, stampsAndSeals: updatedStamps };
    dataRef.current = nextData;
    onUpdateData(nextData);
  };

  // Word Export with user feedback
  const handleExportDocx = async () => {
    try {
      setIsExporting(true);
      setDownloadNotification(null);
      const filename = await downloadDocumentAsDocx(data);
      setDownloadNotification({
        type: 'success',
        message: `Файл Word «${filename}» успешно сформирован и скачан! Проверьте папку загрузок.`,
      });
      setTimeout(() => setDownloadNotification(null), 6000);
    } catch (err: any) {
      console.error('Word export error:', err);
      setDownloadNotification({
        type: 'error',
        message: `Не удалось скачать Word: ${err?.message || 'ошибка при формировании файла'}. Вы можете скопировать готовый текст кнопкой «Копировать текст».`,
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Copy all translated text
  const handleCopyText = () => {
    let fullText = `ОФИЦИАЛЬНЫЙ ПЕРЕВОД: ${data.documentType.toUpperCase()}\n`;
    fullText += `Страна: ${data.sourceCountry}\nНомер документа: ${data.documentNumber}\n\n`;
    data.fields.forEach((f) => {
      fullText += `${f.labelTranslated}: ${f.valueTranslated}\n`;
    });
    if (data.stampsAndSeals.length > 0) {
      fullText += `\nПЕЧАТИ И ШТАМПЫ:\n`;
      data.stampsAndSeals.forEach((s) => {
        fullText += `[${s.type.toUpperCase()}]: ${s.translation}\n`;
      });
    }

    navigator.clipboard.writeText(fullText);
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 2000);
  };

  const cycleInputOverride = () => {
    const next =
      inputOverride === 'auto' ? 'mouse' : inputOverride === 'mouse' ? 'touch' : 'auto';
    setInputOverride(next);
  };

  const inputModeLabel =
    inputOverride === 'auto'
      ? layoutMode === 'desktop'
        ? 'Авто: Мышь'
        : layoutMode === 'tablet'
        ? 'Авто: Планшет'
        : 'Авто: Сенсор'
      : inputOverride === 'mouse'
      ? 'Мышь'
      : 'Сенсор';

  const handleSelectFieldFromTable = (field: DocumentField, jumpToScan?: boolean) => {
    if (field.box2d) {
      setSelectedBoxFieldId(field.id);
      setEditableBoxFieldId(isTouchUI ? null : field.id);
      setHighlightBox(field.box2d);
      if (jumpToScan && layoutMode === 'phone') {
        setPhoneTab('scan');
      }
      window.requestAnimationFrame(() => scrollBoxIntoView(field.box2d));
    }
  };

  const handleInspectCropFromTable = (field: DocumentField) => {
    setSelectedBoxFieldId(field.id);
    if (field.box2d) setHighlightBox(field.box2d);
    if (layoutMode === 'phone') {
      setPhoneTab('crop');
    } else {
      setRightPanelTab('crop');
      setIsRightPanelOpen(true);
    }
  };

  // Shared Scan Viewport + Bounding Boxes (rendered inside desktop, tablet, and phone scan tab)
  const renderScanViewport = () => {
    const touchHandleScale = 1 / Math.max(0.6, zoomLevel / 100);
    const shouldLockTouchScroll =
      effectiveTool === 'draw' || effectiveTool === 'hand' || isPinching;

    return (
      <div
        ref={scanContainerRef}
        onPointerDown={handleScanPanStart}
        className={`relative z-0 isolate block flex-1 min-w-0 min-h-0 overflow-auto ${
          layoutMode === 'phone'
            ? 'p-3'
            : layoutMode === 'tablet'
            ? 'p-6 sm:p-10'
            : 'p-12 lg:p-16'
        } ${
          shouldLockTouchScroll
            ? 'touch-none'
            : isTouchUI
            ? 'touch-pan-x touch-pan-y'
            : ''
        } ${
          effectiveTool === 'hand'
            ? isPanning
              ? 'cursor-grabbing select-none'
              : 'cursor-grab select-none'
            : effectiveTool === 'draw'
            ? 'cursor-crosshair select-none'
            : isPanning
            ? 'cursor-grabbing select-none'
            : !isTouchUI
            ? 'cursor-grab'
            : 'cursor-default'
        }`}
      >
        <div
          onPointerDown={handleScanDrawStart}
          className="min-w-full min-h-full flex flex-col items-center justify-center"
        >
          {isPdfRendering ? (
            <div className="m-auto flex flex-col items-center justify-center p-8 text-center text-amber-700 dark:text-amber-300">
              <Loader2 className="h-10 w-10 mb-3 animate-spin text-amber-600 dark:text-amber-400" />
              <p className="font-semibold text-sm">Генерация предпросмотра PDF...</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
                Отрисовка первого листа документа в высоком разрешении для визуальной сверки
              </p>
            </div>
          ) : effectivePreviewUrl ? (
            isRawPdf ? (
              <div className="m-auto h-[620px] w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
                <object data={data.previewUrl} type="application/pdf" className="h-full w-full">
                  <div className="flex h-full flex-col items-center justify-center p-6 text-center text-slate-500">
                    <FileText className="h-14 w-14 mb-3 text-red-500" />
                    <p className="font-semibold text-sm text-slate-800 dark:text-slate-200">
                      Оригинальный документ PDF
                    </p>
                    <p className="text-xs text-slate-400 mt-1 max-w-sm">
                      {data.originalFileName || 'Файл PDF'}. Все реквизиты извлечены в таблицу.
                    </p>
                    <a
                      href={data.previewUrl}
                      download={data.originalFileName || 'document_original.pdf'}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      <span>Скачать исходный PDF</span>
                    </a>
                  </div>
                </object>
              </div>
            ) : (() => {
              const scale = zoomLevel / 100;
              const isTransformed = zoomLevel !== 100 || rotation !== 0;
              const isQuarterTurn = rotation % 180 === 90;
              const sizerWidth =
                isTransformed && scanBaseSize
                  ? Math.round((isQuarterTurn ? scanBaseSize.height : scanBaseSize.width) * scale)
                  : undefined;
              const sizerHeight =
                isTransformed && scanBaseSize
                  ? Math.round((isQuarterTurn ? scanBaseSize.width : scanBaseSize.height) * scale)
                  : undefined;

              return (
                <div
                  className={`${
                    layoutMode === 'phone' ? 'my-3' : 'my-6 sm:my-10 md:my-12'
                  } mx-auto flex shrink-0 items-center justify-center`}
                  style={
                    sizerWidth && sizerHeight
                      ? { width: `${sizerWidth}px`, height: `${sizerHeight}px` }
                      : undefined
                  }
                >
                  <div
                    onClick={() => {
                      if (justFinishedDrawRef.current) {
                        justFinishedDrawRef.current = false;
                        return;
                      }
                      if (justFinishedPanRef.current) {
                        justFinishedPanRef.current = false;
                        return;
                      }
                      if (effectiveTool === 'select') {
                        setEditableBoxFieldId(null);
                        setSelectedBoxFieldId(null);
                        lastTouchTapRef.current = null;
                      }
                    }}
                    style={{
                      ...(isTransformed && scanBaseSize
                        ? { width: `${scanBaseSize.width}px`, height: `${scanBaseSize.height}px` }
                        : {}),
                      transform: `scale(${scale}) rotate(${rotation}deg)`,
                      transition: isPinching ? 'none' : 'transform 0.15s ease-out',
                    }}
                    className="relative inline-block shrink-0 origin-center select-none"
                  >
                    <img
                      ref={scanImgRef}
                      src={resolvedImageUrl || data.previewUrl}
                      alt="Original document"
                      onLoad={() => {
                        if (zoomLevel === 100 && rotation === 0 && scanImgRef.current) {
                          setScanBaseSize({
                            width: scanImgRef.current.offsetWidth,
                            height: scanImgRef.current.offsetHeight,
                          });
                        }
                      }}
                      className={
                        isTransformed && scanBaseSize
                          ? 'w-full h-full rounded shadow-sm object-contain block pointer-events-none'
                          : 'max-h-[650px] w-auto max-w-full rounded shadow-sm object-contain block pointer-events-none'
                      }
                    />

                    {/* Bounding boxes */}
                    {showAllBoxes &&
                      data.fields.map((f) => {
                        if (!f.box2d) return null;
                        const isDraggingThis = inlineDragBox?.fieldId === f.id;
                        const isEditableBox = editableBoxFieldId === f.id;
                        const isSelected = selectedBoxFieldId === f.id || isEditableBox;
                        const activeBox = isDraggingThis
                          ? inlineDragBox.box
                          : isSelected && boxDraft
                          ? boxDraft
                          : f.box2d;
                        const isHighlighted =
                          isSelected ||
                          (highlightBox && highlightBox[0] === f.box2d[0] && highlightBox[1] === f.box2d[1]);

                        const top = activeBox[0] / 10;
                        const left = activeBox[1] / 10;
                        const height = Math.max((activeBox[2] - activeBox[0]) / 10, 1.8);
                        const width = Math.max((activeBox[3] - activeBox[1]) / 10, 3.5);

                        return (
                          <div
                            key={`box-${f.id}`}
                            onPointerDown={(e) => {
                              if (isEditableBox) {
                                startInlineBoxDrag(e, f.id, activeBox, 'move');
                              }
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (justFinishedPanRef.current) {
                                justFinishedPanRef.current = false;
                                return;
                              }
                              setContextMenu(null);

                              if (isTouchUI) {
                                const now = Date.now();
                                const prevTap = lastTouchTapRef.current;
                                const isDoubleTap =
                                  Boolean(prevTap) &&
                                  prevTap!.fieldId === f.id &&
                                  now - prevTap!.time < 420 &&
                                  Math.hypot(e.clientX - prevTap!.x, e.clientY - prevTap!.y) < 42;

                                setSelectedBoxFieldId(f.id);
                                setHighlightBox(activeBox);

                                if (isDoubleTap) {
                                  lastTouchTapRef.current = null;
                                  setEditableBoxFieldId(f.id);
                                } else {
                                  lastTouchTapRef.current = {
                                    fieldId: f.id,
                                    time: now,
                                    x: e.clientX,
                                    y: e.clientY,
                                  };
                                  if (editableBoxFieldId !== f.id) {
                                    setEditableBoxFieldId(null);
                                  }
                                }
                              } else {
                                setSelectedBoxFieldId(f.id);
                                setEditableBoxFieldId(f.id);
                                setHighlightBox(activeBox);
                              }
                            }}
                            onDoubleClick={(e) => {
                              if (isTouchUI) return;
                              e.stopPropagation();
                              setSelectedBoxFieldId(f.id);
                              setEditableBoxFieldId(f.id);
                              setHighlightBox(activeBox);
                              setRightPanelTab('crop');
                              setIsRightPanelOpen(true);
                            }}
                            onContextMenu={(e) => {
                              if (isTouchUI) return;
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedBoxFieldId(f.id);
                              setEditableBoxFieldId(f.id);
                              setHighlightBox(activeBox);
                              setContextMenu({ fieldId: f.id, x: e.clientX, y: e.clientY });
                            }}
                            className={`group/box absolute rounded ${
                              effectiveTool === 'hand' || effectiveTool === 'draw'
                                ? 'pointer-events-none'
                                : isEditableBox
                                ? isDraggingThis
                                  ? 'transition-none cursor-grabbing touch-none'
                                  : 'transition-all cursor-move touch-none'
                                : isTouchUI
                                ? 'transition-all cursor-pointer touch-pan-x touch-pan-y'
                                : 'transition-all cursor-pointer'
                            } ${
                              isEditableBox
                                ? 'border-2 border-emerald-500 bg-emerald-400/20 shadow-[0_0_16px_rgba(16,185,129,0.6)] z-30'
                                : isHighlighted
                                ? 'border-2 border-amber-400 bg-amber-400/25 shadow-[0_0_15px_rgba(251,191,36,0.75)] z-20'
                                : 'border border-amber-500/60 bg-amber-400/10 hover:bg-amber-400/25 hover:border-amber-500 z-10'
                            }`}
                            style={{
                              top: `${top}%`,
                              left: `${left}%`,
                              height: `${height}%`,
                              width: `${width}%`,
                            }}
                          >
                            {isEditableBox && isTouchUI && (
                              <>
                                {/* Visible touch-friendly circular corner handles with 40x40px hit targets */}
                                {(
                                  [
                                    { handle: 'nw' as const, pos: '-top-5 -left-5' },
                                    { handle: 'ne' as const, pos: '-top-5 -right-5' },
                                    { handle: 'se' as const, pos: '-bottom-5 -right-5' },
                                    { handle: 'sw' as const, pos: '-bottom-5 -left-5' },
                                  ]
                                ).map(({ handle, pos }) => (
                                  <div
                                    key={handle}
                                    onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, handle)}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ transform: `scale(${touchHandleScale})` }}
                                    className={`absolute ${pos} flex h-10 w-10 items-center justify-center touch-none z-40`}
                                  >
                                    <span className="h-3.5 w-3.5 rounded-full border-2 border-emerald-600 bg-white shadow-md" />
                                  </div>
                                ))}
                                {/* Wide edge strips for comfortable touch resizing */}
                                <div
                                  onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'n')}
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute -top-3 left-3 right-3 h-5 opacity-0 touch-none z-30"
                                />
                                <div
                                  onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 's')}
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute -bottom-3 left-3 right-3 h-5 opacity-0 touch-none z-30"
                                />
                                <div
                                  onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'w')}
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute -left-3 top-3 bottom-3 w-5 opacity-0 touch-none z-30"
                                />
                                <div
                                  onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'e')}
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute -right-3 top-3 bottom-3 w-5 opacity-0 touch-none z-30"
                                />
                              </>
                            )}

                            {isEditableBox && !isTouchUI && (
                              <>
                                {/* Desktop mouse invisible corner & edge resize zones with directional cursors */}
                                <div
                                  onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'nw')}
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute -top-1.5 -left-1.5 h-3 w-3 opacity-0 cursor-nwse-resize touch-none z-40"
                                />
                                <div
                                  onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'ne')}
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute -top-1.5 -right-1.5 h-3 w-3 opacity-0 cursor-nesw-resize touch-none z-40"
                                />
                                <div
                                  onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'se')}
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute -bottom-1.5 -right-1.5 h-3 w-3 opacity-0 cursor-nwse-resize touch-none z-40"
                                />
                                <div
                                  onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'sw')}
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute -bottom-1.5 -left-1.5 h-3 w-3 opacity-0 cursor-nesw-resize touch-none z-40"
                                />
                                <div
                                  onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'n')}
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute -top-1.5 left-2 right-2 h-3 opacity-0 cursor-ns-resize touch-none z-40"
                                />
                                <div
                                  onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 's')}
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute -bottom-1.5 left-2 right-2 h-3 opacity-0 cursor-ns-resize touch-none z-40"
                                />
                                <div
                                  onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'w')}
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute -left-1.5 top-2 bottom-2 w-3 opacity-0 cursor-ew-resize touch-none z-40"
                                />
                                <div
                                  onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'e')}
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute -right-1.5 top-2 bottom-2 w-3 opacity-0 cursor-ew-resize touch-none z-40"
                                />
                              </>
                            )}
                          </div>
                        );
                      })}

                    {/* Highlight custom box */}
                    {highlightBox && !selectedBoxFieldId && (
                      <div
                        className="absolute rounded border-2 border-amber-500 bg-amber-400/25 shadow-lg transition-all z-20 pointer-events-none"
                        style={{
                          top: `${highlightBox[0] / 10}%`,
                          left: `${highlightBox[1] / 10}%`,
                          height: `${Math.max((highlightBox[2] - highlightBox[0]) / 10, 2)}%`,
                          width: `${Math.max((highlightBox[3] - highlightBox[1]) / 10, 4)}%`,
                        }}
                      />
                    )}

                    {/* Live preview rectangle while drawing a new bounding box */}
                    {drawingBox && (
                      <div
                        className="absolute rounded border-2 border-dashed border-sky-500 bg-sky-400/20 shadow-[0_0_12px_rgba(14,165,233,0.45)] z-40 pointer-events-none"
                        style={{
                          top: `${drawingBox[0] / 10}%`,
                          left: `${drawingBox[1] / 10}%`,
                          height: `${Math.max((drawingBox[2] - drawingBox[0]) / 10, 0.5)}%`,
                          width: `${Math.max((drawingBox[3] - drawingBox[1]) / 10, 0.5)}%`,
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="m-auto flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <FileText className="h-16 w-16 mb-2 stroke-1" />
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {data.originalFileName || 'Электронная форма документа'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                Текстовый оригинал без графического файла. Все реквизиты синхронизированы в таблице перевода.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Shared Inline Field Editor (Desktop Bottom Bar / Tablet Bottom Bar / Phone Bottom Sheet)
  const renderSelectedFieldEditor = (compactSheet: boolean) => {
    if (!selectedBoxField) {
      if (compactSheet) return null;
      return (
        <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
          <span>
            {isTouchUI
              ? 'Тап — выбор поля, двойной тап — править рамку; остальное пространство свободно листается'
              : 'Перетаскивание по полотну — панорамирование; клик по рамке — правка позиции/размера, ПКМ — меню'}
          </span>
          <span className="hidden sm:inline tabular-nums">
            Полей: {data.fields.length} · Печатей: {data.stampsAndSeals.length}
          </span>
        </div>
      );
    }

    const activeIdx = data.fields.findIndex((f) => f.id === selectedBoxField.id);
    const isBoxGeometryUnlocked = editableBoxFieldId === selectedBoxField.id;

    return (
      <div className="space-y-2">
        {(compactSheet || isTouchUI) && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-200 tabular-nums">
                {activeIdx + 1}
              </span>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                {selectedBoxField.labelTranslated || selectedBoxField.labelOriginal}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() =>
                  setEditableBoxFieldId(isBoxGeometryUnlocked ? null : selectedBoxField.id)
                }
                title={
                  isBoxGeometryUnlocked
                    ? 'Зафиксировать рамку и свободно перемещаться по скану'
                    : 'Разблокировать рамку для перетаскивания (или двойной тап по рамке)'
                }
                aria-pressed={isBoxGeometryUnlocked}
                className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold touch-manipulation transition-colors ${
                  isBoxGeometryUnlocked
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200'
                    : 'border-slate-200 bg-slate-50 text-slate-700 active:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                {isBoxGeometryUnlocked ? (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    <span>Готово</span>
                  </>
                ) : (
                  <>
                    <Move className="h-3.5 w-3.5" />
                    <span className="hidden min-[380px]:inline">Рамка</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => stepFieldSelection(-1)}
                title="Предыдущее поле"
                aria-label="Предыдущее поле"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 active:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 touch-manipulation"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => stepFieldSelection(1)}
                title="Следующее поле"
                aria-label="Следующее поле"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 active:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 touch-manipulation"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              {compactSheet && (
                <>
                  <button
                    type="button"
                    onClick={() => setPhoneTab('crop')}
                    title="Свойства кропа"
                    aria-label="Свойства кропа"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 active:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 touch-manipulation"
                  >
                    <Crop className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteField(selectedBoxField.id)}
                    title="Удалить поле"
                    aria-label="Удалить поле"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 active:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400 touch-manipulation"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedBoxFieldId(null);
                      setEditableBoxFieldId(null);
                    }}
                    title="Снять выделение"
                    aria-label="Закрыть панель поля"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 touch-manipulation"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <div className={`grid grid-cols-1 ${compactSheet ? 'gap-2' : 'md:grid-cols-2 gap-2.5'}`}>
          <div className="flex items-center gap-1.5 min-w-0">
            <textarea
              rows={1}
              value={selectedBoxField.valueOriginal}
              onChange={(e) => {
                manuallyEditedFieldIdsRef.current[selectedBoxField.id] = true;
                handleFieldChange(selectedBoxField.id, 'valueOriginal', e.target.value);
              }}
              placeholder="Текст оригинала (OCR)"
              aria-label="Текст оригинала (OCR)"
              className={`${
                isTouchUI ? 'h-10 min-h-[40px] text-sm sm:text-xs' : 'h-9 min-h-[36px] text-xs'
              } flex-1 min-w-0 resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono leading-tight text-slate-900 focus:border-amber-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100`}
            />
            <button
              type="button"
              onClick={() => void runFieldOcr(selectedBoxField.id)}
              disabled={Boolean(fieldActionStatus[selectedBoxField.id])}
              aria-label="Распознать OCR"
              title="Распознать OCR"
              className={`inline-flex ${
                isTouchUI ? 'h-10 w-10' : 'h-9 w-9'
              } shrink-0 touch-manipulation items-center justify-center rounded-lg border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200`}
            >
              {fieldActionStatus[selectedBoxField.id] === 'ocr' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScanText className="h-4 w-4" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-1.5 min-w-0">
            <textarea
              rows={1}
              value={selectedBoxField.valueTranslated}
              onChange={(e) => {
                manuallyEditedFieldIdsRef.current[selectedBoxField.id] = true;
                handleFieldChange(selectedBoxField.id, 'valueTranslated', e.target.value);
              }}
              placeholder="Значение перевода"
              aria-label="Значение перевода"
              className={`${
                isTouchUI ? 'h-10 min-h-[40px] text-sm sm:text-xs' : 'h-9 min-h-[36px] text-xs'
              } flex-1 min-w-0 resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-medium leading-tight text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100`}
            />
            <button
              type="button"
              onClick={() => void runFieldTranslate(selectedBoxField.id)}
              disabled={
                Boolean(fieldActionStatus[selectedBoxField.id]) ||
                !selectedBoxField.valueOriginal?.trim()
              }
              aria-label="Перевести"
              title="Перевести"
              className={`inline-flex ${
                isTouchUI ? 'h-10 w-10' : 'h-9 w-9'
              } shrink-0 touch-manipulation items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200`}
            >
              {fieldActionStatus[selectedBoxField.id] === 'translate' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Languages className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {fieldActionError[selectedBoxField.id] && (
          <p className="text-[11px] text-red-600 dark:text-red-400">
            {fieldActionError[selectedBoxField.id]}
          </p>
        )}
      </div>
    );
  };

  // Input Mode Toggle Button
  const renderInputModeButton = (compact?: boolean) => (
    <button
      type="button"
      onClick={cycleInputOverride}
      title={`Режим управления: ${inputModeLabel} (нажмите для переключения: Авто / Мышь / Сенсор)`}
      className="flex shrink-0 touch-manipulation items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors"
    >
      {layoutMode === 'desktop' ? (
        <Monitor className="h-3.5 w-3.5 text-slate-500" />
      ) : layoutMode === 'tablet' ? (
        <Tablet className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
      ) : (
        <Smartphone className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
      )}
      {!compact && <span>{inputModeLabel}</span>}
    </button>
  );

  // Floating Touch Toolbar (used on Phone when scanning & on Tablet scan pane)
  const renderTouchToolbarPill = () => (
    <div
      role="toolbar"
      aria-label="Сенсорные инструменты холста"
      onPointerDown={(e) => e.stopPropagation()}
      className="pointer-events-auto inline-flex items-center gap-1 rounded-2xl border border-slate-200/90 bg-white/95 p-1 shadow-lg backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95 touch-manipulation select-none"
    >
      <button
        type="button"
        onClick={() => setActiveTool('select')}
        aria-label="Выбор рамки"
        aria-pressed={effectiveTool === 'select'}
        className={`flex h-10 w-10 items-center justify-center rounded-xl touch-manipulation transition-colors ${
          effectiveTool === 'select'
            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
            : 'text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800'
        }`}
      >
        <MousePointer2 className="h-4 w-4 pointer-events-none" />
      </button>

      <button
        type="button"
        onClick={() => setActiveTool(effectiveTool === 'draw' ? 'select' : 'draw')}
        aria-label="Нарисовать б-бокс"
        aria-pressed={effectiveTool === 'draw'}
        className={`flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold touch-manipulation transition-colors ${
          effectiveTool === 'draw'
            ? 'bg-sky-600 text-white shadow-xs'
            : 'text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-slate-800'
        }`}
      >
        <SquareDashedMousePointer className="h-4 w-4 pointer-events-none" />
        <span className="hidden min-[380px]:inline">Б-бокс</span>
      </button>

      <div className="mx-0.5 h-6 w-px bg-slate-200 dark:bg-slate-700" />

      {layoutMode === 'tablet' && (
        <>
          <button
            type="button"
            onClick={handleZoomOut}
            aria-label="Уменьшить"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800 touch-manipulation"
          >
            <ZoomOut className="h-4 w-4 pointer-events-none" />
          </button>
          <span className="px-1 text-[11px] font-mono font-semibold tabular-nums text-slate-500 dark:text-slate-400">
            {zoomLevel}%
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            aria-label="Увеличить"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800 touch-manipulation"
          >
            <ZoomIn className="h-4 w-4 pointer-events-none" />
          </button>
        </>
      )}

      <button
        type="button"
        onClick={handleRotate}
        aria-label="Повернуть"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800 touch-manipulation"
      >
        <RotateCw className="h-4 w-4 pointer-events-none" />
      </button>

      <button
        type="button"
        onClick={() => setShowAllBoxes((prev) => !prev)}
        aria-pressed={showAllBoxes}
        aria-label="Показать или скрыть рамки OCR"
        className={`flex h-10 w-10 items-center justify-center rounded-xl touch-manipulation transition-colors ${
          showAllBoxes
            ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200'
            : 'text-slate-500 active:bg-slate-100 dark:text-slate-400 dark:active:bg-slate-800'
        }`}
      >
        {showAllBoxes ? (
          <ScanEye className="h-4 w-4 pointer-events-none" />
        ) : (
          <EyeOff className="h-4 w-4 pointer-events-none" />
        )}
      </button>

      <button
        type="button"
        onClick={handleResetView}
        aria-label="Сброс вида"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 active:bg-slate-100 dark:text-slate-400 dark:active:bg-slate-800 touch-manipulation"
      >
        <Maximize className="h-4 w-4 pointer-events-none" />
      </button>

      {undoCount > 0 && (
        <button
          type="button"
          onClick={handleUndoBoxChange}
          aria-label="Отменить изменение рамки"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800 touch-manipulation"
        >
          <Undo2 className="h-4 w-4 pointer-events-none" />
        </button>
      )}
    </div>
  );

  // Notification Banner
  const renderNotificationBanner = () =>
    downloadNotification ? (
      <div
        className={`mx-3 sm:mx-4 mt-2 flex items-center justify-between rounded-lg p-2.5 text-xs font-medium shadow-sm transition-all ${
          downloadNotification.type === 'success'
            ? 'border border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
            : 'border border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {downloadNotification.type === 'success' ? (
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
          )}
          <span className="truncate">{downloadNotification.message}</span>
        </div>
        <button
          type="button"
          onClick={() => setDownloadNotification(null)}
          className="text-xs font-bold opacity-60 hover:opacity-100 ml-3 shrink-0"
        >
          ✕
        </button>
      </div>
    ) : null;

  // =========================================================================
  // INTERFACE 2A: MOBILE PHONE TOUCH UI (< 768px)
  // =========================================================================
  if (layoutMode === 'phone') {
    return (
      <div className="flex w-full h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-slate-100 dark:bg-slate-950">
        {renderNotificationBanner()}

        {/* Ultra-compact 1-row phone document header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-2.5 py-2 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onBackToUpload}
              aria-label="Назад к загрузке"
              className="flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 active:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                {data.sourceCountry} · № {data.documentNumber}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                {data.sourceLanguage} → {data.targetLanguage}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {renderInputModeButton(true)}
            <button
              type="button"
              onClick={handleCopyText}
              aria-label="Копировать весь перевод"
              className="flex h-9 w-9 touch-manipulation items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 active:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            >
              {copiedToast ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={handleExportDocx}
              disabled={isExporting}
              className="flex h-9 touch-manipulation items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 text-xs font-bold text-white shadow-xs active:bg-slate-800 dark:bg-white dark:text-slate-950"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span>{isExporting ? '...' : '.docx'}</span>
            </button>
          </div>
        </div>

        {/* Phone Main Body (switches cleanly between Scan, Table, Stamps, Crop) */}
        <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden">
          {phoneTab === 'scan' && (
            <>
              <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden bg-slate-200/70 dark:bg-slate-950">
                {renderScanViewport()}

                {/* Floating Thumb-Zone Touch Toolbar (above Bottom Sheet or Tab Bar) */}
                <div className="pointer-events-none absolute inset-x-0 bottom-2.5 z-20 flex justify-center px-2">
                  {renderTouchToolbarPill()}
                </div>
              </div>

              {/* Selected Box Bottom Sheet Card (thumb-zone field verification + ‹ Prev / Next ›) */}
              {selectedBoxField && (
                <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-2.5 shadow-[0_-6px_20px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-900">
                  {renderSelectedFieldEditor(true)}
                </div>
              )}
            </>
          )}

          {phoneTab === 'fields' && (
            <div className="flex-1 overflow-y-auto bg-white p-3 dark:bg-slate-900">
              <StudioTablePanel
                fields={data.fields}
                previewImageUrl={effectivePreviewUrl}
                selectedBoxFieldId={selectedBoxFieldId}
                editingFieldId={editingFieldId}
                fieldActionStatus={fieldActionStatus}
                fieldActionError={fieldActionError}
                isTouchUI={true}
                onSelectField={handleSelectFieldFromTable}
                onSetHighlightBox={setHighlightBox}
                onSetEditingFieldId={setEditingFieldId}
                onFieldChange={handleFieldChange}
                onInspectCrop={handleInspectCropFromTable}
                onRunFieldOcr={(id) => void runFieldOcr(id)}
                onRunFieldTranslate={(id) => void runFieldTranslate(id)}
                onDeleteField={handleDeleteField}
                onAddField={handleAddField}
              />
            </div>
          )}

          {phoneTab === 'stamps' && (
            <div className="flex-1 overflow-y-auto bg-white p-3 dark:bg-slate-900">
              <StampsPanel stamps={data.stampsAndSeals} onChange={handleStampsChange} />
            </div>
          )}

          {phoneTab === 'crop' && (
            <div className="flex-1 overflow-y-auto bg-white p-3 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setPhoneTab('scan')}
                className="mb-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200 touch-manipulation"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Назад к скану</span>
              </button>
              <CropInspectorPanel
                field={selectedBoxField}
                boxDraft={boxDraft}
                previewImageUrl={effectivePreviewUrl}
                actionStatus={selectedBoxField ? fieldActionStatus[selectedBoxField.id] || null : null}
                onDraftChange={(nextBox) => setBoxDraft(nextBox)}
                onApplyBox={(fieldId, newBox) => handleUpdateFieldBox(fieldId, newBox)}
              />
            </div>
          )}
        </div>

        {/* Bottom Phone Thumb Navigation Bar */}
        <nav
          aria-label="Навигация студии"
          className="grid shrink-0 grid-cols-3 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 select-none"
        >
          <button
            type="button"
            onClick={() => setPhoneTab('scan')}
            className={`flex h-14 touch-manipulation flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
              phoneTab === 'scan' || phoneTab === 'crop'
                ? 'text-slate-900 bg-amber-50/70 border-t-2 border-amber-500 dark:text-white dark:bg-amber-950/20'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <ScanEye className="h-4 w-4" />
            <span>Скан</span>
          </button>

          <button
            type="button"
            onClick={() => setPhoneTab('fields')}
            className={`flex h-14 touch-manipulation flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
              phoneTab === 'fields'
                ? 'text-slate-900 bg-amber-50/70 border-t-2 border-amber-500 dark:text-white dark:bg-amber-950/20'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Table2 className="h-4 w-4" />
            <span>Таблица ({data.fields.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setPhoneTab('stamps')}
            className={`flex h-14 touch-manipulation flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
              phoneTab === 'stamps'
                ? 'text-slate-900 bg-amber-50/70 border-t-2 border-amber-500 dark:text-white dark:bg-amber-950/20'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Stamp className="h-4 w-4" />
            <span>Печати ({data.stampsAndSeals.length})</span>
          </button>
        </nav>
      </div>
    );
  }

  // =========================================================================
  // INTERFACE 2B: ADAPTIVE TABLET TOUCH UI (768px - 1279px, Landscape/Portrait Split)
  // =========================================================================
  if (layoutMode === 'tablet') {
    const isLandscape = orientation === 'landscape';

    return (
      <div className="flex w-full h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-slate-100 dark:bg-slate-950">
        {renderNotificationBanner()}

        {/* Tablet Studio Top Bar */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onBackToUpload}
              className="flex h-9 shrink-0 touch-manipulation items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 active:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Назад</span>
            </button>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                Студия проверки перевода
              </h2>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate tabular-nums">
                <span className="font-medium text-slate-700 dark:text-slate-300">{data.sourceCountry}</span>
                <span>·</span>
                <span>{data.sourceLanguage} → {data.targetLanguage}</span>
                <span>·</span>
                <span>№ {data.documentNumber}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {renderInputModeButton(false)}
            <button
              type="button"
              onClick={() => setIsRightPanelOpen((prev) => !prev)}
              className="flex h-9 touch-manipulation items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            >
              {isRightPanelOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
              <span>{isRightPanelOpen ? 'Скрыть панель' : 'Таблица'}</span>
            </button>
            <button
              type="button"
              onClick={handleCopyText}
              className="flex h-9 touch-manipulation items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            >
              {copiedToast ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedToast ? 'Скопировано!' : 'Копировать'}</span>
            </button>
            <button
              type="button"
              onClick={handleExportDocx}
              disabled={isExporting}
              className="flex h-9 touch-manipulation items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white shadow-sm dark:bg-white dark:text-slate-950"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span>{isExporting ? 'Создание...' : 'Word (.docx)'}</span>
            </button>
          </div>
        </div>

        {/* Orientation-Adaptive Split Workspace */}
        <div className={`flex flex-1 min-h-0 overflow-hidden ${isLandscape ? 'flex-row' : 'flex-col'}`}>
          {/* Scan Pane */}
          <div
            className={`relative flex flex-col min-w-0 min-h-0 bg-slate-200/70 dark:bg-slate-950 ${
              isRightPanelOpen
                ? isLandscape
                  ? 'flex-1 border-r border-slate-200 dark:border-slate-800'
                  : 'h-[52%] shrink-0 border-b border-slate-200 dark:border-slate-800'
                : 'flex-1'
            }`}
          >
            <div className="relative flex flex-1 min-h-0 overflow-hidden">
              {renderScanViewport()}
              {/* Floating bottom touch toolbar inside scan pane */}
              <div className="pointer-events-none absolute inset-x-0 bottom-2.5 z-20 flex justify-center px-3">
                {renderTouchToolbarPill()}
              </div>
            </div>

            {/* Bottom Field Editor inside Tablet Scan Pane */}
            <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-2 text-[11px] dark:border-slate-800 dark:bg-slate-900">
              {renderSelectedFieldEditor(false)}
            </div>
          </div>

          {/* Adaptive Tabbed Panel (Right in Landscape, Bottom in Portrait) */}
          {isRightPanelOpen && (
            <aside
              className={`flex flex-col min-w-0 min-h-0 bg-white dark:bg-slate-900 ${
                isLandscape ? 'w-[44%] max-w-[460px] shrink-0' : 'flex-1'
              }`}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-950/80">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setRightPanelTab('fields')}
                    className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold touch-manipulation transition-colors ${
                      rightPanelTab === 'fields'
                        ? 'bg-white text-slate-900 shadow-2xs ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-700'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Table2 className="h-3.5 w-3.5" />
                    <span>Таблица ({data.fields.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightPanelTab('stamps')}
                    className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold touch-manipulation transition-colors ${
                      rightPanelTab === 'stamps'
                        ? 'bg-white text-slate-900 shadow-2xs ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-700'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Stamp className="h-3.5 w-3.5" />
                    <span>Печати ({data.stampsAndSeals.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightPanelTab('crop')}
                    className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold touch-manipulation transition-colors ${
                      rightPanelTab === 'crop'
                        ? 'bg-white text-slate-900 shadow-2xs ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-700'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Crop className="h-3.5 w-3.5" />
                    <span>Кроп</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {rightPanelTab === 'stamps' ? (
                  <StampsPanel stamps={data.stampsAndSeals} onChange={handleStampsChange} />
                ) : rightPanelTab === 'crop' ? (
                  <CropInspectorPanel
                    field={selectedBoxField}
                    boxDraft={boxDraft}
                    previewImageUrl={effectivePreviewUrl}
                    actionStatus={selectedBoxField ? fieldActionStatus[selectedBoxField.id] || null : null}
                    onDraftChange={(nextBox) => setBoxDraft(nextBox)}
                    onApplyBox={(fieldId, newBox) => handleUpdateFieldBox(fieldId, newBox)}
                  />
                ) : (
                  <StudioTablePanel
                    fields={data.fields}
                    previewImageUrl={effectivePreviewUrl}
                    selectedBoxFieldId={selectedBoxFieldId}
                    editingFieldId={editingFieldId}
                    fieldActionStatus={fieldActionStatus}
                    fieldActionError={fieldActionError}
                    isTouchUI={true}
                    onSelectField={handleSelectFieldFromTable}
                    onSetHighlightBox={setHighlightBox}
                    onSetEditingFieldId={setEditingFieldId}
                    onFieldChange={handleFieldChange}
                    onInspectCrop={handleInspectCropFromTable}
                    onRunFieldOcr={(id) => void runFieldOcr(id)}
                    onRunFieldTranslate={(id) => void runFieldTranslate(id)}
                    onDeleteField={handleDeleteField}
                    onAddField={handleAddField}
                  />
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // INTERFACE 1: DESKTOP MOUSE + KEYBOARD UI (Split-Pane Studio)
  // =========================================================================
  const contextMenuField = contextMenu
    ? data.fields.find((f) => f.id === contextMenu.fieldId)
    : undefined;

  return (
    <div className="flex w-full flex-col">
      {renderNotificationBanner()}

      {/* Compact Desktop Studio Document Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6 py-2.5 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToUpload}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Назад</span>
          </button>

          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
              Студия проверки перевода
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              <span className="font-medium text-slate-700 dark:text-slate-300">{data.sourceCountry}</span>
              <span aria-hidden="true">·</span>
              <span>{data.sourceLanguage} → {data.targetLanguage}</span>
              <span aria-hidden="true">·</span>
              <span>№ {data.documentNumber}</span>
            </div>
          </div>
        </div>

        {/* Input Mode Toggle + Export & Copy Actions */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {renderInputModeButton(false)}

          <button
            type="button"
            onClick={handleCopyText}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            {copiedToast ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copiedToast ? 'Скопировано!' : 'Копировать текст'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportDocx}
            disabled={isExporting}
            className="flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 transition-colors"
          >
            <FileDown className="h-3.5 w-3.5" />
            <span>{isExporting ? 'Создание .docx...' : 'Скачать в Word (.docx)'}</span>
          </button>
        </div>
      </div>

      {/* Desktop Split-Pane Studio Canvas + Right Panel + Far-Right Rail */}
      <div className="flex w-full h-[calc(100vh-8rem)] min-h-[540px] overflow-hidden">
        {/* Left/Center Document Artboard & Bottom Field Bar */}
        <div className="flex flex-1 min-w-0 min-h-0 flex-col bg-slate-100 dark:bg-slate-950">
          <div className="relative flex flex-1 min-h-[300px] overflow-hidden bg-slate-200/70 dark:bg-slate-950">
            {/* Left Vertical Mouse Toolbar */}
            <div
              role="toolbar"
              aria-label="Инструменты холста"
              onPointerDown={(e) => e.stopPropagation()}
              className="relative z-20 flex w-11 shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-r border-slate-200 bg-slate-50 py-2.5 px-1 dark:border-slate-800 dark:bg-slate-900 select-none"
            >
              <button
                type="button"
                onClick={() => setActiveTool('select')}
                title="Курсор (V) — выбор и редактирование рамок OCR"
                aria-pressed={effectiveTool === 'select'}
                className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  effectiveTool === 'select'
                    ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-950'
                    : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`}
              >
                <MousePointer2 className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => setActiveTool('hand')}
                title="Рука (H или удерживайте Пробел) — перетаскивание скана"
                aria-pressed={effectiveTool === 'hand'}
                className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  effectiveTool === 'hand'
                    ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-950'
                    : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`}
              >
                <Hand className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => setActiveTool('draw')}
                title="Нарисовать б-бокс (B) — выделить новую прямоугольную область в любом месте"
                aria-pressed={effectiveTool === 'draw'}
                className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  effectiveTool === 'draw'
                    ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-950'
                    : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`}
              >
                <SquareDashedMousePointer className="h-4 w-4" />
              </button>

              <div className="my-0.5 h-px w-6 shrink-0 bg-slate-200 dark:bg-slate-800" />

              <button
                type="button"
                onClick={handleZoomIn}
                aria-label="Увеличить"
                title="Увеличить масштаб (или Ctrl+Колесо к курсору)"
                className="flex h-7 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
              >
                <ZoomIn className="h-4 w-4" />
              </button>

              <span
                className="text-[9px] font-mono font-semibold tabular-nums text-slate-500 dark:text-slate-400 leading-none py-0.5"
                title="Текущий масштаб"
              >
                {zoomLevel}%
              </span>

              <button
                type="button"
                onClick={handleZoomOut}
                aria-label="Уменьшить"
                title="Уменьшить масштаб"
                className="flex h-7 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
              >
                <ZoomOut className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={handleRotate}
                aria-label="Повернуть"
                title="Повернуть на 90 градусов"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
              >
                <RotateCw className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => setShowAllBoxes((prev) => !prev)}
                aria-pressed={showAllBoxes}
                aria-label={`Рамки OCR: ${showAllBoxes ? 'Вкл' : 'Выкл'}`}
                title={`Рамки OCR: ${showAllBoxes ? 'Вкл' : 'Выкл'} — показать или скрыть рамки всех распознанных полей на скане`}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all ${
                  showAllBoxes
                    ? 'border border-amber-300 bg-amber-50 text-amber-900 shadow-2xs dark:border-amber-700 dark:bg-amber-950/70 dark:text-amber-200'
                    : 'text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`}
              >
                {showAllBoxes ? <ScanEye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={handleResetView}
                aria-label="Сброс"
                title="Сброс масштаба и поворота"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
              >
                <Maximize className="h-4 w-4" />
              </button>

              {undoCount > 0 && (
                <>
                  <div className="my-0.5 h-px w-6 shrink-0 bg-slate-200 dark:bg-slate-800" />
                  <button
                    type="button"
                    onClick={handleUndoBoxChange}
                    aria-label="Отменить (Ctrl+Z)"
                    title="Отменить изменение рамки (Ctrl+Z)"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
                  >
                    <Undo2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>

            {renderScanViewport()}
          </div>

          {/* Bottom Artboard Editor Bar */}
          <div className="border-t border-slate-200 bg-white px-3 sm:px-4 py-2 text-[11px] dark:border-slate-800 dark:bg-slate-900">
            {renderSelectedFieldEditor(false)}
          </div>
        </div>

        {/* In-Flow Desktop Split-Pane Right Panel (never covers the scan!) */}
        {isRightPanelOpen && (
          <aside
            style={{ width: `${rightPanelWidth}px` }}
            className="relative flex shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
          >
            {/* Draggable Left-Edge Width Splitter */}
            <div
              role="separator"
              aria-orientation="vertical"
              onPointerDown={startPanelResize}
              onDoubleClick={() => setRightPanelWidth(460)}
              title="Потяните за левый край для изменения ширины панели (двойной клик — сброс)"
              className="group/splitter absolute inset-y-0 left-0 z-20 flex w-2 -translate-x-1/2 cursor-col-resize items-center justify-center select-none touch-none"
            >
              <div
                className={`h-12 w-1 rounded-full transition-colors ${
                  isResizingPanel
                    ? 'bg-amber-500'
                    : 'bg-slate-300/80 group-hover/splitter:bg-amber-400 dark:bg-slate-700 dark:group-hover/splitter:bg-amber-500'
                }`}
              />
            </div>

            {/* Panel Header */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3.5 py-2 dark:border-slate-800 dark:bg-slate-950/80 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {rightPanelTab === 'fields' && <Table2 className="h-3.5 w-3.5 text-slate-500 shrink-0" />}
                {rightPanelTab === 'stamps' && <Stamp className="h-3.5 w-3.5 text-slate-500 shrink-0" />}
                {rightPanelTab === 'crop' && <Crop className="h-3.5 w-3.5 text-slate-500 shrink-0" />}
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 truncate">
                  {rightPanelTab === 'fields'
                    ? `Таблица реквизитов (${data.fields.length})`
                    : rightPanelTab === 'stamps'
                    ? `Печати и штампы (${data.stampsAndSeals.length})`
                    : 'Свойства кропа'}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIsRightPanelOpen(false)}
                title="Свернуть панель в правую рейку"
                className="flex items-center justify-center rounded p-1 text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
            </div>

            {/* Independently Scrollable Panel Body */}
            <div className="flex-1 overflow-y-auto p-3.5">
              {rightPanelTab === 'stamps' ? (
                <StampsPanel stamps={data.stampsAndSeals} onChange={handleStampsChange} />
              ) : rightPanelTab === 'crop' ? (
                <CropInspectorPanel
                  field={selectedBoxField}
                  boxDraft={boxDraft}
                  previewImageUrl={effectivePreviewUrl}
                  actionStatus={selectedBoxField ? fieldActionStatus[selectedBoxField.id] || null : null}
                  onDraftChange={(nextBox) => setBoxDraft(nextBox)}
                  onApplyBox={(fieldId, newBox) => handleUpdateFieldBox(fieldId, newBox)}
                />
              ) : (
                <StudioTablePanel
                  fields={data.fields}
                  previewImageUrl={effectivePreviewUrl}
                  selectedBoxFieldId={selectedBoxFieldId}
                  editingFieldId={editingFieldId}
                  fieldActionStatus={fieldActionStatus}
                  fieldActionError={fieldActionError}
                  isTouchUI={false}
                  onSelectField={handleSelectFieldFromTable}
                  onSetHighlightBox={setHighlightBox}
                  onSetEditingFieldId={setEditingFieldId}
                  onFieldChange={handleFieldChange}
                  onInspectCrop={handleInspectCropFromTable}
                  onRunFieldOcr={(id) => void runFieldOcr(id)}
                  onRunFieldTranslate={(id) => void runFieldTranslate(id)}
                  onDeleteField={handleDeleteField}
                  onAddField={handleAddField}
                />
              )}
            </div>
          </aside>
        )}

        {/* Far-Right Vertical Icon Rail (Desktop) */}
        <nav
          aria-label="Боковая панель инструментов"
          className="flex w-12 shrink-0 flex-col items-center justify-between border-l border-slate-200 bg-slate-50 py-2.5 dark:border-slate-800 dark:bg-slate-950 select-none"
        >
          <div className="flex flex-col items-center gap-1.5 w-full px-1">
            <button
              type="button"
              onClick={() => toggleRailTab('fields')}
              title="Таблица реквизитов"
              className={`relative flex w-full flex-col items-center justify-center gap-0.5 rounded-lg py-2 text-[9px] font-semibold transition-colors ${
                isRightPanelOpen && rightPanelTab === 'fields'
                  ? 'bg-white text-slate-900 shadow-2xs ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-700'
                  : 'text-slate-500 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Table2 className="h-4 w-4" />
              <span>Таблица</span>
              <span className="text-[8px] opacity-70 tabular-nums">{data.fields.length}</span>
            </button>

            <button
              type="button"
              onClick={() => toggleRailTab('stamps')}
              title="Печати, штампы и отметки"
              className={`relative flex w-full flex-col items-center justify-center gap-0.5 rounded-lg py-2 text-[9px] font-semibold transition-colors ${
                isRightPanelOpen && rightPanelTab === 'stamps'
                  ? 'bg-white text-slate-900 shadow-2xs ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-700'
                  : 'text-slate-500 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Stamp className="h-4 w-4" />
              <span>Печати</span>
              <span className="text-[8px] opacity-70 tabular-nums">{data.stampsAndSeals.length}</span>
            </button>

            <button
              type="button"
              onClick={() => toggleRailTab('crop')}
              title="Свойства кропа и координат"
              className={`relative flex w-full flex-col items-center justify-center gap-0.5 rounded-lg py-2 text-[9px] font-semibold transition-colors ${
                isRightPanelOpen && rightPanelTab === 'crop'
                  ? 'bg-white text-slate-900 shadow-2xs ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-700'
                  : 'text-slate-500 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Crop className="h-4 w-4" />
              <span>Кроп</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsRightPanelOpen((prev) => !prev)}
            title={isRightPanelOpen ? 'Свернуть панель' : 'Развернуть панель'}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            {isRightPanelOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>
        </nav>
      </div>

      {/* Desktop Right-Click Context Menu on Bounding Boxes */}
      {contextMenu && contextMenuField && (
        <div
          style={{
            top: Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 180),
            left: Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 210),
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed z-50 w-48 rounded-xl border border-slate-200 bg-white p-1.5 text-xs shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate border-b border-slate-100 dark:border-slate-800 mb-1">
            {contextMenuField.labelTranslated || contextMenuField.labelOriginal}
          </div>
          <button
            type="button"
            onClick={() => {
              const id = contextMenuField.id;
              setContextMenu(null);
              void runFieldOcr(id);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-medium text-slate-700 hover:bg-amber-50 hover:text-amber-900 dark:text-slate-200 dark:hover:bg-amber-950/40"
          >
            <ScanText className="h-3.5 w-3.5 text-amber-600" />
            <span>Распознать OCR</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const id = contextMenuField.id;
              setContextMenu(null);
              void runFieldTranslate(id);
            }}
            disabled={!contextMenuField.valueOriginal?.trim()}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-900 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-blue-950/40"
          >
            <Languages className="h-3.5 w-3.5 text-blue-600" />
            <span>Перевести значение</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              setRightPanelTab('crop');
              setIsRightPanelOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Crop className="h-3.5 w-3.5 text-slate-500" />
            <span>Свойства кропа</span>
          </button>
          <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
          <button
            type="button"
            onClick={() => {
              const id = contextMenuField.id;
              setContextMenu(null);
              handleDeleteField(id);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Удалить рамку</span>
          </button>
        </div>
      )}
    </div>
  );
};
