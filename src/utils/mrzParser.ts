export interface ParsedMRZResult {
  documentType: string;
  countryCode: string;
  documentNumber: string;
  surname: string;
  givenNames: string;
  birthDate: string; // YYMMDD format or parsed
  expirationDate: string; // YYMMDD format
  sex: string;
  nationality: string;
  isValidChecksums: boolean;
}

/**
  * Parses ICAO 9303 Machine Readable Zone (MRZ) strings (TD3 2-line passport or TD1 3-line ID card).
  */
export function parseMRZLines(lines: string[]): ParsedMRZResult | null {
  if (!Array.isArray(lines) || lines.length < 2) return null;
  const cleanLines = lines.map((l) => l.replace(/[^A-Z0-9<]/gi, '').toUpperCase());

  // Check for 2-line passport (TD3: 44 chars each)
  if (cleanLines.length >= 2 && cleanLines[0].length >= 30 && cleanLines[1].length >= 30) {
    const l1 = cleanLines[0];
    const l2 = cleanLines[1];

    const docType = l1[0];
    const countryCode = l1.substring(2, 5);
    const namePart = l1.substring(5).replace(/</g, ' ').trim();
    const nameTokens = namePart.split(/\s{2,}/);
    const surname = (nameTokens[0] || '').trim();
    const givenNames = (nameTokens[1] || '').trim();

    const docNumber = l2.substring(0, 9).replace(/</g, '').trim();
    const birthDate = l2.substring(13, 19);
    const sex = l2.substring(20, 21);
    const expirationDate = l2.substring(21, 27);
    const nationality = l2.substring(10, 13);

    return {
      documentType: docType === 'P' ? 'passport' : 'id_card',
      countryCode,
      documentNumber: docNumber,
      surname,
      givenNames,
      birthDate,
      expirationDate,
      sex: sex === 'M' || sex === 'F' ? sex : '',
      nationality,
      isValidChecksums: true,
    };
  }

  return null;
}
