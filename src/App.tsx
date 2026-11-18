import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { DocumentUploader } from './components/DocumentUploader';
import { SideBySideStudio } from './components/SideBySideStudio';
import { DocumentTranslationData } from './types/document';

export default function App() {
  const [currentDocument, setCurrentDocument] = useState<DocumentTranslationData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  const saveTimeoutRef = useRef<number | null>(null);

  // Dark mode class sync
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const toggleDarkMode = () => setIsDarkMode((prev) => !prev);

  const persistDocumentToDb = async (doc: DocumentTranslationData, isNew: boolean) => {
    try {
      const url = isNew ? '/api/documents' : `/api/documents/${encodeURIComponent(doc.id)}`;
      const method = isNew ? 'POST' : 'PUT';
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
    } catch (err) {
      console.warn('Failed to persist document to SQLite:', err);
    }
  };

  const handleTranslationComplete = (data: DocumentTranslationData) => {
    setCurrentDocument(data);
    void persistDocumentToDb(data, true);
  };

  const handleUpdateDocument = (updated: DocumentTranslationData) => {
    setCurrentDocument(updated);
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      void persistDocumentToDb(updated, false);
    }, 600);
  };

  const handleOpenSavedDocument = async (id: string) => {
    setOpeningDocId(id);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(id)}`);
      if (!res.ok) {
        throw new Error('Документ не найден');
      }
      const doc: DocumentTranslationData = await res.json();
      setCurrentDocument(doc);
    } catch (err) {
      console.error('Failed to open saved document:', err);
    } finally {
      setOpeningDocId(null);
    }
  };

  const handleNewTranslation = () => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    setCurrentDocument(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex flex-col transition-colors">
      {/* Top Navigation Bar */}
      <Header
        isDarkMode={isDarkMode}
        toggleDarkMode={toggleDarkMode}
        onNewTranslation={handleNewTranslation}
      />

      {/* Main Viewport Content */}
      <main className="flex-1">
        {currentDocument ? (
          <SideBySideStudio
            data={currentDocument}
            onUpdateData={handleUpdateDocument}
            onBackToUpload={handleNewTranslation}
          />
        ) : (
          <DocumentUploader
            onTranslationComplete={handleTranslationComplete}
            onOpenSavedDocument={handleOpenSavedDocument}
            openingDocId={openingDocId}
            isLoading={isLoading}
            setIsLoading={setIsLoading}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-5 dark:border-slate-800 dark:bg-slate-950 transition-colors">
        <div className="mx-auto flex max-w-7xl flex-col sm:flex-row items-center justify-between gap-2 px-4 sm:px-6 lg:px-8 text-xs text-slate-500 dark:text-slate-400">
          <p>© 2026 LinguaDoc Bureau. Автоматизированное бюро переводов документов с выгрузкой в Microsoft Word (.docx).</p>
          <p>Локальное хранение истории переводов в SQLite</p>
        </div>
      </footer>
    </div>
  );
}
