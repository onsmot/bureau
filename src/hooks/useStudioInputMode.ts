import { useState, useEffect } from 'react';

export type StudioLayoutMode = 'desktop' | 'tablet' | 'phone';
export type StudioInputOverride = 'auto' | 'mouse' | 'touch';
export type StudioOrientation = 'portrait' | 'landscape';

const STORAGE_KEY = 'linguadoc_studio_input_mode';

function readInitialOverride(): StudioInputOverride {
  if (typeof window === 'undefined') return 'auto';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'mouse' || saved === 'touch' || saved === 'auto') {
      return saved;
    }
  } catch {
    // Ignore storage errors
  }
  return 'auto';
}

export interface StudioInputModeState {
  layoutMode: StudioLayoutMode;
  isTouchUI: boolean;
  isCoarsePointer: boolean;
  orientation: StudioOrientation;
  viewportWidth: number;
  override: StudioInputOverride;
  setOverride: (next: StudioInputOverride) => void;
}

export function useStudioInputMode(): StudioInputModeState {
  const [override, setOverrideState] = useState<StudioInputOverride>(readInitialOverride);
  const [isCoarsePointer, setIsCoarsePointer] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(pointer: coarse)').matches;
  });
  const [viewport, setViewport] = useState<{ width: number; height: number }>(() => {
    if (typeof window === 'undefined') return { width: 1280, height: 800 };
    return { width: window.innerWidth, height: window.innerHeight };
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mq = window.matchMedia?.('(pointer: coarse)');
    const onMqChange = (e: MediaQueryListEvent) => setIsCoarsePointer(e.matches);
    if (mq) {
      setIsCoarsePointer(mq.matches);
      mq.addEventListener?.('change', onMqChange);
    }

    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', onResize);

    return () => {
      mq?.removeEventListener?.('change', onMqChange);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const setOverride = (next: StudioInputOverride) => {
    setOverrideState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage errors
    }
  };

  const orientation: StudioOrientation =
    viewport.width >= viewport.height ? 'landscape' : 'portrait';

  let layoutMode: StudioLayoutMode;
  if (override === 'mouse') {
    layoutMode = 'desktop';
  } else if (override === 'touch') {
    layoutMode = viewport.width < 768 ? 'phone' : 'tablet';
  } else {
    if (viewport.width < 768) {
      layoutMode = 'phone';
    } else if (viewport.width < 1024 || (isCoarsePointer && viewport.width < 1280)) {
      layoutMode = 'tablet';
    } else {
      layoutMode = 'desktop';
    }
  }

  const isTouchUI = layoutMode !== 'desktop';

  return {
    layoutMode,
    isTouchUI,
    isCoarsePointer,
    orientation,
    viewportWidth: viewport.width,
    override,
    setOverride,
  };
}
