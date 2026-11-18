import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker source from local public folder or fallback
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
}

/**
 * Converts a base64 Data URL or ArrayBuffer of a PDF into a high-resolution PNG Data URL of the first page.
 * This enables full visual OCR bounding box manipulation, thumbnail snippets, and document viewer previews.
 */
export async function convertPdfToImageDataUrl(
  pdfInput: string | ArrayBuffer | Uint8Array,
  pageNumber: number = 1,
  scale: number = 1.75
): Promise<string> {
  let data: Uint8Array;

  if (typeof pdfInput === 'string') {
    // If it's a data:application/pdf;base64,... string, extract base64 binary
    const base64Data = pdfInput.includes('base64,')
      ? pdfInput.split('base64,')[1]
      : pdfInput;

    const binaryString = atob(base64Data);
    const len = binaryString.length;
    data = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      data[i] = binaryString.charCodeAt(i);
    }
  } else if (pdfInput instanceof Uint8Array) {
    data = pdfInput;
  } else {
    data = new Uint8Array(pdfInput);
  }

  // Load PDF document using pdf.js with safety timeout
  const loadingTask = pdfjsLib.getDocument({
    data,
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
    cMapPacked: true,
  });

  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;
  const targetPage = Math.min(Math.max(1, pageNumber), numPages);

  const page = await pdfDoc.getPage(targetPage);
  const viewport = page.getViewport({ scale });

  // Create canvas for rendering
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context not available for PDF rendering');
  }

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Render PDF page to canvas
  await page.render({
    canvasContext: ctx,
    viewport,
  }).promise;

  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Checks if a string or file represents a PDF document.
 */
export function isPdfDocument(input?: string | null): boolean {
  if (!input) return false;
  return (
    input.startsWith('data:application/pdf') ||
    input.toLowerCase().endsWith('.pdf') ||
    input.includes('application/pdf')
  );
}
