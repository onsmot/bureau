export interface CroppedBoxImage {
  base64: string;
  mimeType: string;
}

/**
 * Applies gentle color-preserving luminance contrast stretching and subtle unsharp masking
 * to improve OCR legibility on low-contrast scans without destroying colored seals or ink.
 */
function enhanceCanvasForOcr(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sharpenAmount: number = 0.35
) {
  if (width < 4 || height < 4) return;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const pixelCount = width * height;

  // Build luminance histogram (ITU-R BT.601)
  const hist = new Uint32Array(256);
  const lum = new Uint8Array(pixelCount);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const y = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    lum[p] = y;
    hist[y]++;
  }

  // Find 2nd and 98th luminance percentiles to ignore dust/glare outliers
  const lowThresh = Math.floor(pixelCount * 0.02);
  const highThresh = Math.floor(pixelCount * 0.98);
  let acc = 0;
  let yMin = 0;
  let yMax = 255;

  for (let b = 0; b < 256; b++) {
    acc += hist[b];
    if (acc >= lowThresh) {
      yMin = b;
      break;
    }
  }
  acc = 0;
  for (let b = 255; b >= 0; b--) {
    acc += hist[b];
    if (acc >= pixelCount - highThresh) {
      yMax = b;
      break;
    }
  }

  const span = Math.max(yMax - yMin, 1);
  // Cap contrast gain at 1.6 so dark text doesn't clip and noise isn't over-amplified
  const rawGain = 255 / span;
  const gain = Math.min(1.6, Math.max(1.0, rawGain));
  const shouldStretch = gain > 1.05 && span < 235;

  if (shouldStretch) {
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const y = lum[p];
      if (y <= 1) continue;
      // Compute stretched target luminance centered around midpoint if gain is capped
      const targetY = Math.max(0, Math.min(255, (y - yMin) * gain));
      const ratio = targetY / y;
      data[i] = Math.max(0, Math.min(255, Math.round(data[i] * ratio)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(data[i + 1] * ratio)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(data[i + 2] * ratio)));
    }
  }

  // Subtle 3x3 unsharp mask on RGB channels
  if (sharpenAmount > 0 && width * height <= 4_500_000) {
    const src = new Uint8ClampedArray(data);
    const stride = width * 4;
    for (let y = 1; y < height - 1; y++) {
      const rowOffset = y * stride;
      for (let x = 1; x < width - 1; x++) {
        const idx = rowOffset + x * 4;
        for (let c = 0; c < 3; c++) {
          const center = src[idx + c];
          const avg =
            (src[idx - stride - 4 + c] +
              src[idx - stride + c] +
              src[idx - stride + 4 + c] +
              src[idx - 4 + c] +
              center +
              src[idx + 4 + c] +
              src[idx + stride - 4 + c] +
              src[idx + stride + c] +
              src[idx + stride + 4 + c]) /
            9;
          const sharpened = center + sharpenAmount * (center - avg);
          data[idx + c] = Math.max(0, Math.min(255, Math.round(sharpened)));
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Optionally enhances a full uploaded scan/photo (contrast normalization + mild sharpening, capped at 2400px)
 * before sending it to the multimodal OCR pipeline.
 */
export async function enhanceScanImageDataUrl(imageUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const maxDim = 2400;
        let outW = img.naturalWidth;
        let outH = img.naturalHeight;
        if (outW > maxDim || outH > maxDim) {
          const scale = maxDim / Math.max(outW, outH);
          outW = Math.round(outW * scale);
          outH = Math.round(outH * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(outW, 1);
        canvas.height = Math.max(outH, 1);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        enhanceCanvasForOcr(ctx, canvas.width, canvas.height, 0.28);
        resolve(canvas.toDataURL('image/jpeg', 0.91));
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => reject(new Error('Не удалось обработать изображение'));
    img.src = imageUrl;
  });
}

/**
 * Crops a normalized [ymin, xmin, ymax, xmax] (0..1000) region from a scan image URL
 * into an enhanced, crisp JPEG data URL suitable for fast single-field OCR.
 */
export async function cropBoundingBoxToBase64(
  imageUrl: string,
  box2d: [number, number, number, number]
): Promise<CroppedBoxImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const [rawYmin, rawXmin, rawYmax, rawXmax] = box2d;
        const ymin = Math.max(0, Math.min(999, rawYmin));
        const xmin = Math.max(0, Math.min(999, rawXmin));
        const ymax = Math.max(ymin + 1, Math.min(1000, rawYmax));
        const xmax = Math.max(xmin + 1, Math.min(1000, rawXmax));

        const sx = (xmin / 1000) * img.naturalWidth;
        const sy = (ymin / 1000) * img.naturalHeight;
        const sWidth = Math.max(((xmax - xmin) / 1000) * img.naturalWidth, 12);
        const sHeight = Math.max(((ymax - ymin) / 1000) * img.naturalHeight, 12);

        // Add slight contextual padding around the bounding box so edge characters aren't clipped
        const padX = Math.max(sWidth * 0.04, 6);
        const padY = Math.max(sHeight * 0.12, 6);

        const cropX = Math.max(0, sx - padX);
        const cropY = Math.max(0, sy - padY);
        const cropW = Math.min(img.naturalWidth - cropX, sWidth + padX * 2);
        const cropH = Math.min(img.naturalHeight - cropY, sHeight + padY * 2);

        // Cap max dimension at 1200px; slightly upscale very tiny crops for better OCR legibility
        let outW = Math.round(cropW);
        let outH = Math.round(cropH);
        if (outH < 80 && outW < 800) {
          const upscale = Math.min(2, 80 / Math.max(outH, 1));
          outW = Math.round(outW * upscale);
          outH = Math.round(outH * upscale);
        }
        const maxDim = 1200;
        if (outW > maxDim || outH > maxDim) {
          const scale = maxDim / Math.max(outW, outH);
          outW = Math.round(outW * scale);
          outH = Math.round(outH * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(outW, 1);
        canvas.height = Math.max(outH, 1);

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

        enhanceCanvasForOcr(ctx, canvas.width, canvas.height, 0.35);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        resolve({ base64: dataUrl, mimeType: 'image/jpeg' });
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      reject(new Error('Не удалось загрузить изображение для вырезки фрагмента'));
    };

    img.src = imageUrl;
  });
}
