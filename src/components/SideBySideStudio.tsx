import React, { useState, useEffect, useRef } from 'react';
import {
  Download,
  Copy,
  Check,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Edit2,
  Trash2,
  Plus,
  Stamp,
  FileText,
  FileCheck2,
  CornerUpLeft,
  AlertCircle,
  RefreshCw,
  Eye,
  Languages,
  PanelRightClose,
  PanelRightOpen,
  Table2,
  Crop,
  ChevronsRight,
  MousePointer2,
  Hand,
  Maximize2,
} from 'lucide-react';
import { DocumentTranslationData, DocumentField, StampOrSeal } from '../types/document';
import { downloadDocumentAsDocx } from '../utils/docxGenerator';
import { SnippetCropViewer } from './SnippetCropViewer';
import { StampsPanel } from './StampsPanel';
import { CropInspectorPanel } from './CropInspectorPanel';
import { convertPdfToImageDataUrl } from '../utils/pdfRenderer';
import { cropBoundingBoxToBase64 } from '../utils/cropBoxImage';

interface SideBySideStudioProps {
  data: DocumentTranslationData;
  onUpdateData: (updated: DocumentTranslationData) => void;
  onBackToUpload: () => void;
}

export const SideBySideStudio: React.FC<SideBySideStudioProps> = ({
  data,
  onUpdateData,
  onBackToUpload,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [rotation, setRotation] = useState<number>(0);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);
  const [rightPanelTab, setRightPanelTab] = useState<'fields' | 'stamps' | 'crop'>('fields');
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(500);
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
  const [showAllBoxes, setShowAllBoxes] = useState<boolean>(true);
  const [fieldActionStatus, setFieldActionStatus] = useState<Record<string, 'ocr' | 'translate' | null>>({});
  const [fieldActionError, setFieldActionError] = useState<Record<string, string | null>>({});
  const [inlineDragBox, setInlineDragBox] = useState<{
    fieldId: string;
    box: [number, number, number, number];
  } | null>(null);
  const [scanBaseSize, setScanBaseSize] = useState<{ width: number; height: number } | null>(null);
  const [activeTool, setActiveTool] = useState<'select' | 'hand'>('select');
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);

  const scanContainerRef = useRef<HTMLDivElement>(null);
  const scanImgRef = useRef<HTMLImageElement>(null);
  const panDragRef = useRef<{
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);
  const inlineDragRef = useRef<{
    fieldId: string;
    handle: 'move' | 'nw' | 'ne' | 'se' | 'sw';
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

  const effectiveTool: 'select' | 'hand' = isSpacePressed ? 'hand' : activeTool;

  // Keep latest data in ref so sequential async OCR -> Translate updates never clobber each other
  const dataRef = useRef<DocumentTranslationData>(data);
  dataRef.current = data;

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
  }, [zoomLevel, rotation, effectivePreviewUrl]);

  // Adobe-style panel width splitter drag
  const panelResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const resize = panelResizeRef.current;
      if (!resize) return;
      const delta = resize.startX - e.clientX;
      const maxAllowed = typeof window !== 'undefined' ? Math.min(760, Math.max(340, window.innerWidth - 56)) : 760;
      const nextWidth = Math.max(340, Math.min(maxAllowed, resize.startWidth + delta));
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

  // Run single-field OCR from the cropped bounding box region
  const runFieldOcr = async (
    fieldId: string,
    overrideBox?: [number, number, number, number]
  ): Promise<string | null> => {
    const field = dataRef.current.fields.find((f) => f.id === fieldId);
    if (!field) return null;

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
      const timeoutId = window.setTimeout(() => controller.abort(), 30000);

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
            documentType: dataRef.current.documentType,
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
      updateFieldData(fieldId, {
        valueOriginal: recognized,
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
      const timeoutId = window.setTimeout(() => controller.abort(), 30000);

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

  // Sequential chain: OCR first, then Translate
  const runAutoOcrThenTranslate = async (
    fieldId: string,
    newBox: [number, number, number, number]
  ) => {
    const ocrText = await runFieldOcr(fieldId, newBox);
    if (ocrText !== null && ocrText.trim().length > 0) {
      await runFieldTranslate(fieldId, ocrText);
    }
  };

  // Update bounding box coordinates and auto-trigger OCR -> Translation if coordinates changed
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

    updateFieldData(fieldId, {
      box2d: newBox,
      ...(updatedValues?.valueOriginal !== undefined ? { valueOriginal: updatedValues.valueOriginal } : {}),
      ...(updatedValues?.valueTranslated !== undefined ? { valueTranslated: updatedValues.valueTranslated } : {}),
    });
    setHighlightBox(newBox);
    setSelectedBoxFieldId(fieldId);

    if (didBoxChange) {
      void runAutoOcrThenTranslate(fieldId, newBox);
    }
  };

  const handleUpdateFieldBoxRef = useRef(handleUpdateFieldBox);
  handleUpdateFieldBoxRef.current = handleUpdateFieldBox;

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
      // sw
      const newYmax = Math.max(ymin + 12, Math.min(1000, ymax + dy));
      const newXmin = Math.max(0, Math.min(xmax - 12, xmin + dx));
      return [ymin, Math.round(newXmin), Math.round(newYmax), xmax];
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

  // Keyboard shortcuts (V = Cursor, H = Hand, Space hold = temporary Hand) and pointer pan handlers
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
      } else if (e.key === 'v' || e.key === 'V' || e.key === 'м' || e.key === 'М') {
        setActiveTool('select');
      } else if (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') {
        setActiveTool('hand');
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
    };

    const onPanMove = (e: PointerEvent) => {
      const pan = panDragRef.current;
      const container = scanContainerRef.current;
      if (!pan || !container) return;
      e.preventDefault();
      container.scrollLeft = pan.startScrollLeft - (e.clientX - pan.startX);
      container.scrollTop = pan.startScrollTop - (e.clientY - pan.startY);
    };

    const onPanUp = () => {
      if (panDragRef.current) {
        panDragRef.current = null;
        setIsPanning(false);
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

  const handleScanPanStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const isMiddleClick = e.button === 1;
    if (effectiveTool !== 'hand' && !isMiddleClick) return;
    const container = scanContainerRef.current;
    if (!container) return;
    e.preventDefault();
    panDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: container.scrollLeft,
      startScrollTop: container.scrollTop,
    };
    setIsPanning(true);
  };

  const startInlineBoxDrag = (
    e: React.PointerEvent,
    fieldId: string,
    box: [number, number, number, number],
    handle: 'move' | 'nw' | 'ne' | 'se' | 'sw'
  ) => {
    if (effectiveTool === 'hand') return;
    e.preventDefault();
    e.stopPropagation();

    const imgElem = scanImgRef.current;
    if (!imgElem || imgElem.offsetWidth === 0 || imgElem.offsetHeight === 0) return;

    setSelectedBoxFieldId(fieldId);
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
    if (img && img.offsetWidth > 0 && img.offsetHeight > 0 && zoomLevel === 100 && rotation === 0) {
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

  useEffect(() => {
    const container = scanContainerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        captureScanBaseSize();
        if (e.deltaY < 0) {
          setZoomLevel((prev) => Math.min(prev + 25, 350));
        } else {
          setZoomLevel((prev) => Math.max(prev - 25, 50));
        }
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, []);
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

  // Stamp editing via right slide-over drawer
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

  return (
    <div className="flex w-full flex-col pr-12">
      {/* Download / Error Notification Banner */}
      {downloadNotification && (
        <div
          className={`mx-4 mt-3 flex items-center justify-between rounded-lg p-3 text-xs font-medium shadow-sm transition-all ${
            downloadNotification.type === 'success'
              ? 'border border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
              : 'border border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {downloadNotification.type === 'success' ? (
              <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
            )}
            <span>{downloadNotification.message}</span>
          </div>
          <button
            onClick={() => setDownloadNotification(null)}
            className="text-xs font-bold opacity-60 hover:opacity-100 ml-3"
          >
            ✕
          </button>
        </div>
      )}

      {/* Compact Studio Document Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6 py-2.5 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBackToUpload}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <CornerUpLeft className="h-3.5 w-3.5" />
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

        {/* Export & Copy Actions */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={handleCopyText}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            {copiedToast ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copiedToast ? 'Скопировано!' : 'Копировать текст'}</span>
          </button>

          <button
            onClick={handleExportDocx}
            disabled={isExporting}
            className="flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{isExporting ? 'Создание .docx...' : 'Скачать в Word (.docx)'}</span>
          </button>
        </div>
      </div>

      {/* Studio Artboard Canvas */}
      <div className="flex flex-col w-full h-[calc(100vh-8rem)] min-h-[540px] overflow-hidden">
        {/* Document Artboard & Interactive Crop Canvas */}
        <div className="flex flex-1 min-w-0 min-h-0 flex-col bg-slate-100 dark:bg-slate-950">
          {/* Artboard Options Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 sm:px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 min-w-0">
              <FileCheck2 className="h-4 w-4 text-slate-500 shrink-0" />
              <span className="truncate">Оригинал (Скан / Фото)</span>
              {data.originalFileName && (
                <span className="hidden sm:inline text-[11px] font-normal text-slate-400 truncate max-w-[200px]">
                  · {data.originalFileName}
                </span>
              )}
            </div>

            {/* Viewer Controls */}
            <div className="flex items-center gap-1">
              <button
                onClick={handleZoomOut}
                aria-label="Уменьшить"
                className="p-1 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="text-[11px] font-mono tabular-nums text-slate-500 px-1">{zoomLevel}%</span>
              <button
                onClick={handleZoomIn}
                aria-label="Увеличить"
                className="p-1 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleRotate}
                aria-label="Повернуть"
                className="p-1 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 ml-1"
                title="Повернуть на 90 градусов"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowAllBoxes(!showAllBoxes)}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-all ${
                  showAllBoxes
                    ? 'border border-amber-300 bg-amber-50 text-amber-900 shadow-2xs dark:border-amber-700 dark:bg-amber-950/70 dark:text-amber-200'
                    : 'border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
                }`}
                title="Показать или скрыть рамки всех распознанных полей на скане"
              >
                <Eye className="h-3 w-3" />
                <span>Рамки OCR: {showAllBoxes ? 'Вкл' : 'Выкл'}</span>
              </button>
              <button
                onClick={handleResetView}
                className="text-[10px] text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 px-1.5"
              >
                Сброс
              </button>
            </div>
          </div>

          {/* Document Preview Canvas + Left Artboard Tools Bar */}
          <div className="relative flex flex-1 min-h-0 min-h-[440px] overflow-hidden bg-slate-200/70 dark:bg-slate-950">
            {/* Left Artboard Toolbar (Cursor & Hand tools) */}
            <div
              role="toolbar"
              aria-label="Инструменты холста"
              className="z-10 flex w-11 shrink-0 flex-col items-center gap-1.5 border-r border-slate-200 bg-slate-50 py-2.5 px-1 dark:border-slate-800 dark:bg-slate-900 select-none"
            >
              <button
                type="button"
                onClick={() => setActiveTool('select')}
                title="Курсор (V) — выбор и редактирование рамок OCR"
                aria-pressed={effectiveTool === 'select'}
                className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
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
                className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                  effectiveTool === 'hand'
                    ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-950'
                    : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`}
              >
                <Hand className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable Scan Viewport */}
            <div
              ref={scanContainerRef}
              onPointerDown={handleScanPanStart}
              className={`relative block flex-1 min-w-0 min-h-0 overflow-auto p-16 ${
                effectiveTool === 'hand'
                  ? isPanning
                    ? 'cursor-grabbing select-none'
                    : 'cursor-grab select-none'
                  : 'cursor-default'
              }`}
            >
              <div className="min-w-full min-h-full flex flex-col items-center justify-center">
            {isPdfRendering ? (
              <div className="m-auto flex flex-col items-center justify-center p-8 text-center text-amber-700 dark:text-amber-300">
                <RefreshCw className="h-10 w-10 mb-3 animate-spin text-amber-600 dark:text-amber-400" />
                <p className="font-semibold text-sm">Генерация предпросмотра PDF...</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
                  Отрисовка первого листа документа в высоком разрешении для визуальной сверки
                </p>
              </div>
            ) : effectivePreviewUrl ? (
              isRawPdf ? (
                <div className="m-auto h-[620px] w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
                  <object
                    data={data.previewUrl}
                    type="application/pdf"
                    className="h-full w-full"
                  >
                    <div className="flex h-full flex-col items-center justify-center p-6 text-center text-slate-500">
                      <FileText className="h-14 w-14 mb-3 text-red-500" />
                      <p className="font-semibold text-sm text-slate-800 dark:text-slate-200">
                        Оригинальный документ PDF
                      </p>
                      <p className="text-xs text-slate-400 mt-1 max-w-sm">
                        {data.originalFileName || 'Файл PDF'}. Все реквизиты извлечены в таблицу справа.
                      </p>
                      <a
                        href={data.previewUrl}
                        download={data.originalFileName || 'document_original.pdf'}
                        className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        <Download className="h-3.5 w-3.5" />
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
                    className="my-12 mx-auto flex shrink-0 items-center justify-center"
                    style={
                      sizerWidth && sizerHeight
                        ? { width: `${sizerWidth}px`, height: `${sizerHeight}px` }
                        : undefined
                    }
                  >
                    <div
                      onClick={() => {
                        if (effectiveTool !== 'hand') {
                          setSelectedBoxFieldId(null);
                        }
                      }}
                      style={{
                        ...(isTransformed && scanBaseSize
                          ? { width: `${scanBaseSize.width}px`, height: `${scanBaseSize.height}px` }
                          : {}),
                        transform: `scale(${scale}) rotate(${rotation}deg)`,
                        transition: 'transform 0.15s ease-out',
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

                  {/* All field bounding boxes rendered on the scan (draggable & corner-resizable inline) */}
                  {showAllBoxes &&
                    data.fields.map((f) => {
                      if (!f.box2d) return null;
                      const isDraggingThis = inlineDragBox?.fieldId === f.id;
                      const isSelected = selectedBoxFieldId === f.id;
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
                          onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'move')}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedBoxFieldId(f.id);
                            setHighlightBox(activeBox);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setSelectedBoxFieldId(f.id);
                            setHighlightBox(activeBox);
                            setRightPanelTab('crop');
                            setIsRightPanelOpen(true);
                          }}
                          className={`group/box absolute rounded touch-none ${
                            effectiveTool === 'hand'
                              ? 'pointer-events-none'
                              : isDraggingThis
                              ? 'transition-none cursor-grabbing'
                              : 'transition-all cursor-grab'
                          } ${
                            isHighlighted
                              ? 'border-2 border-amber-400 bg-amber-400/30 shadow-[0_0_15px_rgba(251,191,36,0.85)] z-30'
                              : 'border border-amber-500/60 bg-amber-400/10 hover:bg-amber-400/25 hover:border-amber-500 z-10'
                          }`}
                          style={{
                            top: `${top}%`,
                            left: `${left}%`,
                            height: `${height}%`,
                            width: `${width}%`,
                          }}
                          title={`${f.labelTranslated}: ${f.valueOriginal} (перетащите для сдвига, углы для размера, 2× клик — крупное окно)`}
                        >
                          {/* Label badge on the box + quick button to open full modal */}
                          <div
                            className={`absolute -top-5 left-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-bold shadow-xs whitespace-nowrap transition-opacity ${
                              isHighlighted
                                ? 'bg-amber-500 text-slate-950 opacity-100 z-40'
                                : 'bg-slate-900/80 text-amber-300 opacity-0 group-hover/box:opacity-100 pointer-events-none'
                            }`}
                          >
                            <span>{f.labelTranslated}</span>
                            {isSelected && (
                              <>
                                <span className="font-mono tabular-nums text-[8px] opacity-80">
                                  [{activeBox[0]}..{activeBox[2]}, {activeBox[1]}..{activeBox[3]}]
                                </span>
                                <button
                                  type="button"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedBoxFieldId(f.id);
                                    setHighlightBox(activeBox);
                                    setRightPanelTab('crop');
                                    setIsRightPanelOpen(true);
                                  }}
                                  title="Открыть крупное окно настройки области OCR"
                                  className="ml-0.5 inline-flex items-center justify-center rounded bg-slate-950/20 p-0.5 text-slate-950 hover:bg-slate-950/35 cursor-pointer"
                                >
                                  <Maximize2 className="h-2.5 w-2.5" />
                                </button>
                              </>
                            )}
                          </div>

                          {/* Corner resize handles when selected (visually hidden, drag-to-resize preserved) */}
                          {isSelected && (
                            <>
                              <div
                                onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'nw')}
                                onClick={(e) => e.stopPropagation()}
                                title="Изменить левый верхний угол"
                                className="absolute -top-1.5 -left-1.5 h-3 w-3 opacity-0 cursor-nwse-resize touch-none z-40"
                              />
                              <div
                                onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'ne')}
                                onClick={(e) => e.stopPropagation()}
                                title="Изменить правый верхний угол"
                                className="absolute -top-1.5 -right-1.5 h-3 w-3 opacity-0 cursor-nesw-resize touch-none z-40"
                              />
                              <div
                                onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'se')}
                                onClick={(e) => e.stopPropagation()}
                                title="Изменить правый нижний угол"
                                className="absolute -bottom-1.5 -right-1.5 h-3 w-3 opacity-0 cursor-nwse-resize touch-none z-40"
                              />
                              <div
                                onPointerDown={(e) => startInlineBoxDrag(e, f.id, activeBox, 'sw')}
                                onClick={(e) => e.stopPropagation()}
                                title="Изменить левый нижний угол"
                                className="absolute -bottom-1.5 -left-1.5 h-3 w-3 opacity-0 cursor-nesw-resize touch-none z-40"
                              />
                            </>
                          )}
                        </div>
                      );
                    })}

                  {/* Highlight custom box if not already rendered */}
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
          </div>

          {/* Bottom Artboard Transform Bar (always visible under scan) */}
          <div className="border-t border-slate-200 bg-white px-3 sm:px-4 py-2 text-[11px] dark:border-slate-800 dark:bg-slate-900">
            {selectedBoxField && boxDraft ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                  <span className="font-bold text-slate-900 dark:text-slate-100 truncate max-w-[200px]">
                    {selectedBoxField.labelTranslated || selectedBoxField.labelOriginal}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
                  {(['Y₁', 'X₁', 'Y₂', 'X₂'] as const).map((axisLabel, axisIdx) => (
                    <label key={axisLabel} className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                      <span>{axisLabel}</span>
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        value={boxDraft[axisIdx]}
                        onChange={(e) => {
                          const parsed = Math.max(0, Math.min(1000, Number(e.target.value) || 0));
                          setBoxDraft((prev) => {
                            if (!prev) return prev;
                            const next: [number, number, number, number] = [...prev];
                            next[axisIdx] = parsed;
                            return next;
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && boxDraft) {
                            const ymin = Math.max(0, Math.min(985, Math.min(boxDraft[0], boxDraft[2] - 10)));
                            const xmin = Math.max(0, Math.min(985, Math.min(boxDraft[1], boxDraft[3] - 10)));
                            const ymax = Math.max(ymin + 10, Math.min(1000, boxDraft[2]));
                            const xmax = Math.max(xmin + 10, Math.min(1000, boxDraft[3]));
                            handleUpdateFieldBox(selectedBoxField.id, [ymin, xmin, ymax, xmax]);
                          }
                        }}
                        className="w-12 rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-center font-mono text-[11px] text-slate-900 focus:border-amber-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </label>
                  ))}

                  <button
                    type="button"
                    onClick={() => {
                      const ymin = Math.max(0, Math.min(985, Math.min(boxDraft[0], boxDraft[2] - 10)));
                      const xmin = Math.max(0, Math.min(985, Math.min(boxDraft[1], boxDraft[3] - 10)));
                      const ymax = Math.max(ymin + 10, Math.min(1000, boxDraft[2]));
                      const xmax = Math.max(xmin + 10, Math.min(1000, boxDraft[3]));
                      handleUpdateFieldBox(selectedBoxField.id, [ymin, xmin, ymax, xmax]);
                    }}
                    className="rounded bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-slate-950 hover:bg-amber-400 transition-colors"
                    title="Применить новые координаты рамки и запустить OCR + перевод"
                  >
                    Применить + OCR
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRightPanelTab('crop');
                      setIsRightPanelOpen(true);
                    }}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    title="Открыть инспектор кропа в правой панели"
                  >
                    Свойства кропа
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span>Клик по рамке — выбор и правка кропа, перетаскивание — сдвиг, углы — размер</span>
                <span className="hidden sm:inline tabular-nums">Полей: {data.fields.length} · Печатей: {data.stampsAndSeals.length}</span>
              </div>
            )}
          </div>
        </div>

        {/* Fixed Right Off-Canvas Drawer (slides cleanly over the right side, left of the 48px vertical rail) */}
        <aside
          aria-hidden={!isRightPanelOpen}
          style={{ width: `min(${rightPanelWidth}px, calc(100vw - 3rem))` }}
          className={`fixed top-16 bottom-0 right-12 z-30 flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl ${
            !isResizingPanel ? 'transition-[transform,opacity] duration-300 ease-out' : ''
          } ${
            isRightPanelOpen
              ? 'translate-x-0 opacity-100 pointer-events-auto'
              : 'translate-x-[calc(100%+3rem)] opacity-0 pointer-events-none'
          }`}
        >
          {/* Draggable Left-Edge Width Splitter */}
          <div
            role="separator"
            aria-orientation="vertical"
            onPointerDown={startPanelResize}
            onDoubleClick={() => setRightPanelWidth(500)}
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

          {/* Off-Canvas Drawer Header */}
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
              <StampsPanel
                stamps={data.stampsAndSeals}
                onChange={handleStampsChange}
              />
            ) : rightPanelTab === 'crop' ? (
              <CropInspectorPanel
                field={selectedBoxField}
                boxDraft={boxDraft}
                previewImageUrl={effectivePreviewUrl}
                actionStatus={selectedBoxField ? fieldActionStatus[selectedBoxField.id] || null : null}
                actionError={selectedBoxField ? fieldActionError[selectedBoxField.id] || null : null}
                onDraftChange={(nextBox) => setBoxDraft(nextBox)}
                onApplyBox={(fieldId, newBox) => handleUpdateFieldBox(fieldId, newBox)}
                onFieldTextChange={(fieldId, key, val) => handleFieldChange(fieldId, key, val)}
                onRunOcr={(fieldId) => void runFieldOcr(fieldId)}
                onRunTranslate={(fieldId) => void runFieldTranslate(fieldId)}
              />
            ) : (
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Клик по строке выбирает кроп на скане слева; правки синхронизированы
                  </p>
                  <button
                    onClick={handleAddField}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Добавить</span>
                  </button>
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {/* Column Header (Desktop / Tablet) */}
                  <div className="hidden sm:grid sm:grid-cols-[minmax(175px,42%)_1fr_64px] sm:gap-3 bg-slate-50/90 px-3 py-2 text-[11px] font-semibold text-slate-600 dark:bg-slate-950 dark:text-slate-400">
                    <div>Фрагмент скана (OCR) и реквизит</div>
                    <div>Значение перевода</div>
                    <div className="text-right">Действия</div>
                  </div>

                  {/* Field Rows */}
                  {data.fields.map((field, idx) => {
                    const isRowEditing = editingFieldId === field.id;
                    const isRowBoxSelected = selectedBoxFieldId === field.id;
                    const rowStatus = fieldActionStatus[field.id] || null;
                    const rowError = fieldActionError[field.id] || null;
                    return (
                      <div
                        key={field.id}
                        onClick={() => {
                          if (field.box2d) {
                            setSelectedBoxFieldId(field.id);
                            setHighlightBox(field.box2d);
                          }
                        }}
                        className={`flex flex-col gap-1.5 px-2.5 py-2 sm:grid sm:grid-cols-[minmax(175px,42%)_1fr_64px] sm:gap-3 sm:px-3 sm:py-2 transition-colors ${
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
                        previewImageUrl={effectivePreviewUrl}
                        isEditing={isRowEditing}
                        onLabelTranslatedChange={(val) => handleFieldChange(field.id, 'labelTranslated', val)}
                        onValueOriginalChange={(val) => handleFieldChange(field.id, 'valueOriginal', val)}
                        onHoverHighlight={(box) => {
                          setHighlightBox(box);
                          if (box) setSelectedBoxFieldId(field.id);
                        }}
                        onInspectCrop={() => {
                          setSelectedBoxFieldId(field.id);
                          if (field.box2d) setHighlightBox(field.box2d);
                          setRightPanelTab('crop');
                          setIsRightPanelOpen(true);
                        }}
                        onRunOcr={() => void runFieldOcr(field.id)}
                        actionStatus={rowStatus}
                        index={idx}
                      />
                    </div>

                    {/* Translated Value + Manual Translate & Inline Actions */}
                    <div className="min-w-0 text-slate-800 dark:text-slate-200">
                      {isRowEditing ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                              Значение перевода:
                            </label>
                            <button
                              type="button"
                              onClick={() => void runFieldTranslate(field.id)}
                              disabled={Boolean(rowStatus) || !field.valueOriginal?.trim()}
                              title="Перевести значение OCR на целевой язык"
                              className="inline-flex shrink-0 items-center gap-1 rounded border border-blue-300/80 bg-blue-50/80 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-45 disabled:cursor-not-allowed dark:border-blue-800/80 dark:bg-blue-950/40 dark:text-blue-300"
                            >
                              {rowStatus === 'translate' ? (
                                <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                              ) : (
                                <Languages className="h-2.5 w-2.5" />
                              )}
                              <span>{rowStatus === 'translate' ? 'Перевод...' : 'Перевод'}</span>
                            </button>
                          </div>
                          <textarea
                            rows={2}
                            value={field.valueTranslated}
                            onChange={(e) => handleFieldChange(field.id, 'valueTranslated', e.target.value)}
                            className="w-full rounded-md border border-blue-400 bg-white p-2 text-xs font-medium dark:border-blue-600 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                          />
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => handleFieldChange(field.id, 'valueTranslated', field.valueOriginal)}
                              className="text-[10px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                            >
                              Скопировать оригинал в перевод
                            </button>
                            <div className="flex sm:hidden items-center gap-1">
                              <button
                                onClick={() => setEditingFieldId(null)}
                                className="rounded-md bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              >
                                Готово
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="font-semibold text-xs leading-snug text-slate-900 dark:text-slate-100 break-words min-w-0 flex-1">
                              {rowStatus === 'translate' ? (
                                <span className="text-blue-600 dark:text-blue-400 font-medium">
                                  Перевод...
                                </span>
                              ) : (
                                field.valueTranslated || <span className="text-slate-400 font-normal">Нет перевода</span>
                              )}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => void runFieldTranslate(field.id)}
                                disabled={Boolean(rowStatus) || !field.valueOriginal?.trim()}
                                title="Перевести значение OCR на целевой язык"
                                className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                                  rowStatus === 'translate'
                                    ? 'border-blue-400 bg-blue-100 text-blue-900 dark:border-blue-700 dark:bg-blue-950/70 dark:text-blue-200'
                                    : 'border-blue-300/80 bg-blue-50/80 text-blue-700 hover:bg-blue-100 disabled:opacity-45 disabled:cursor-not-allowed dark:border-blue-800/80 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/60'
                                }`}
                              >
                                {rowStatus === 'translate' ? (
                                  <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                                ) : (
                                  <Languages className="h-2.5 w-2.5" />
                                )}
                                <span>{rowStatus === 'translate' ? 'Перевод...' : 'Перевод'}</span>
                              </button>
                              {/* Mobile-only inline Edit/Delete */}
                              <button
                                onClick={() => setEditingFieldId(field.id)}
                                className="sm:hidden p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"
                                title="Редактировать"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteField(field.id)}
                                className="sm:hidden p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors"
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
                    <div className="hidden sm:flex items-center justify-end gap-1 shrink-0">
                      <button
                        onClick={() => setEditingFieldId(isRowEditing ? null : field.id)}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteField(field.id);
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-md transition-colors"
                        title="Удалить"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                      );
                    })}
                  </div>
                </div>
              )}
          </div>
        </aside>

        {/* Always-Visible Adobe-Style Far-Right Vertical Icon Rail (anchored on right edge across all viewports) */}
        <nav
          aria-label="Боковая панель инструментов"
          className="fixed top-16 bottom-0 right-0 z-30 flex w-12 flex-col items-center justify-between border-l border-slate-200 bg-slate-50 py-2.5 dark:border-slate-800 dark:bg-slate-950 select-none"
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

    </div>
  );
};
