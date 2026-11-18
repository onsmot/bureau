export type DocumentType =
  | 'passport'
  | 'id_card'
  | 'birth_certificate'
  | 'marriage_certificate'
  | 'death_certificate'
  | 'divorce_certificate'
  | 'driver_license'
  | 'diploma'
  | 'general';

export interface DocumentField {
  id: string;
  key: string;
  labelOriginal: string;
  labelTranslated: string;
  valueOriginal: string;
  valueTranslated: string;
  confidence: number;
  category: 'personal' | 'dates' | 'authority' | 'numbers' | 'marginal_notes';
  box2d?: [number, number, number, number]; // [ymin, xmin, ymax, xmax] in 0-1000 normalized coordinates
  cropSnippetUrl?: string; // Optional direct cropped image URL or data URI
}

export interface StampOrSeal {
  id: string;
  type: 'round_seal' | 'stamp' | 'apostille' | 'watermark' | 'signature';
  transcription: string;
  translation: string;
  location?: string;
}

export interface DocumentTranslationData {
  id: string;
  documentType: DocumentType;
  sourceLanguage: string;
  targetLanguage: string;
  sourceCountry: string;
  documentNumber: string;
  issueDate: string;
  issuingAuthority: string;
  fields: DocumentField[];
  stampsAndSeals: StampOrSeal[];
  certificationFormula: string;
  translatorNotes?: string;
  originalFileName?: string;
  previewUrl?: string;
  timestamp: number;
}
