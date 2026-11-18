import React from 'react';
import { FileText, Moon, Sun, Plus } from 'lucide-react';

interface HeaderProps {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  onNewTranslation: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isDarkMode,
  toggleDarkMode,
  onNewTranslation,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95 transition-colors">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 sm:gap-4 md:gap-8 px-3 sm:px-6 lg:px-8 overflow-hidden">
        {/* Zone 1: Wordmark */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-sm shrink-0">
            <FileText className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <button
            type="button"
            onClick={onNewTranslation}
            className="text-left text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 hover:opacity-90"
          >
            <span className="hidden min-[380px]:inline">LinguaDoc Bureau</span>
            <span className="min-[380px]:hidden">LinguaDoc</span>
          </button>
        </div>

        {/* Zone 2: Primary workspace label */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
          <span className="whitespace-nowrap shrink-0 font-semibold text-slate-900 dark:text-white underline underline-offset-8 decoration-2 decoration-slate-900 dark:decoration-white">
            Студия перевода
          </span>
        </nav>

        {/* Zone 3: Theme toggle & New document */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={toggleDarkMode}
            aria-label="Переключить тему"
            className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900 transition-colors shrink-0"
          >
            {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={onNewTranslation}
            className="flex items-center gap-1.5 sm:gap-2 rounded-lg bg-slate-900 px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Новый документ</span>
            <span className="sm:hidden">Новый</span>
          </button>
        </div>
      </div>
    </header>
  );
};
