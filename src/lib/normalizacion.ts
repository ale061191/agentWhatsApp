// ============================================================================
// SONIA — NORMALIZACIÓN (fechas + montos) — capa complementaria
// No reemplaza extractMontoBs; la extiende con formatos adicionales.
// ============================================================================

const MESES: Record<string, string> = {
  enero: '01', ene: '01',
  febrero: '02', feb: '02',
  marzo: '03', mar: '03',
  abril: '04', abr: '04',
  mayo: '05', may: '05',
  junio: '06', jun: '06',
  julio: '07', jul: '07',
  agosto: '08', ago: '08',
  septiembre: '09', setiembre: '09', sep: '09', sept: '09',
  octubre: '10', oct: '10',
  noviembre: '11', nov: '11',
  diciembre: '12', dic: '12',
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatearDDMMYYYY(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Normaliza una fecha en texto libre a DD/MM/YYYY.
 * Soporta:
 *  - 20/09/2026, 20-09-2026, 20.09.2026, 20/09, 20-09
 *  - "20 sep 2026", "20 de septiembre de 2026", "septiembre 20"
 *  - "hoy", "mañana", "pasado mañana"
 * Devuelve null si no encuentra fecha.
 */
export function normalizeFechaES(text: string, baseDate = new Date()): string | null {
  if (!text) return null;
  // FIX (15/09/2026): tolerar typos sin espacio tipo "20nde septiembre",
  // "20de septiembre", "20SEP". Separa dígito pegado a letra y normaliza "nde".
  let lower = text.toLowerCase().trim();
  lower = lower
    .replace(/(\d)([a-záéíóúñ]+)/gi, '$1 $2')
    .replace(/\b(\d{1,2})\s*n\s*de\b/gi, '$1 de')
    .replace(/\b(\d{1,2})\s*de\s*([a-záéíóúñ]+)/gi, '$1 de $2');

  // relativos
  if (/\bhoy\b/.test(lower)) return formatearDDMMYYYY(baseDate);
  if (/\bmañana\b/.test(lower)) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 1);
    return formatearDDMMYYYY(d);
  }
  if (/pasado\s+mañana/.test(lower)) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 2);
    return formatearDDMMYYYY(d);
  }

  // 1) numérica: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD/MM, DD-MM
  const numMatch = lower.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
  if (numMatch) {
    const dd = parseInt(numMatch[1], 10);
    const mm = parseInt(numMatch[2], 10);
    let yyyy = numMatch[3] ? parseInt(numMatch[3], 10) : baseDate.getFullYear();
    if (yyyy < 100) yyyy += 2000;
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      return `${pad2(dd)}/${pad2(mm)}/${yyyy}`;
    }
  }

  // 2) "20 de septiembre de 2026" / "20 septiembre 2026" / "20 sep 2026"
  const larga = lower.match(/\b(\d{1,2})\s+(?:de\s+)?([a-záéíóúñ]+)(?:\s+(?:de\s+)?(\d{4}))?/);
  if (larga) {
    const dd = parseInt(larga[1], 10);
    const mesKey = larga[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const mmStr = MESES[mesKey] || MESES[larga[2]];
    if (mmStr && dd >= 1 && dd <= 31) {
      const yyyy = larga[3] ? parseInt(larga[3], 10) : baseDate.getFullYear();
      return `${pad2(dd)}/${mmStr}/${yyyy}`;
    }
  }

  // 3) "septiembre 20" / "septiembre 20, 2026"
  const invertida = lower.match(/\b([a-záéíóúñ]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/);
  if (invertida) {
    const mesKey = invertida[1].normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const mmStr = MESES[mesKey] || MESES[invertida[1]];
    if (mmStr) {
      const dd = parseInt(invertida[2], 10);
      const yyyy = invertida[3] ? parseInt(invertida[3], 10) : baseDate.getFullYear();
      if (dd >= 1 && dd <= 31) return `${pad2(dd)}/${mmStr}/${yyyy}`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Montos extendidos
// ---------------------------------------------------------------------------

const NUMEROS_PALABRA: Array<{ regex: RegExp; value: number }> = [
  { regex: /\bdoce\s*mil\b/i, value: 12000 },
  { regex: /\bseis\s*mil\b/i, value: 6000 },
  { regex: /\bmil\s*doscientos\b/i, value: 1200 },
  { regex: /\bmil\s*y\s*doscientos\b/i, value: 1200 },
];

/**
 * Normaliza montos en Bs con separadores variados:
 * 12.000, 12,000, 12 000, 12000, 12mil, "doce mil", "1.200Bs", "1200 bs."
 */
export function normalizeMontoBs(text: string): number | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  // 1) número + sufijo bs/bolivares (soporta espacios, puntos, comas, nbsp)
  const limpio = lower.replace(/\u00a0/g, ' ');
  const m1 = limpio.match(/(\d{1,3}(?:[.\s,]\d{3})+|\d{4,6})\s*(?:bs\.?|bolivares?|bss?)\b/i);
  if (m1) {
    const digits = m1[1].replace(/[.\s,]/g, '');
    const val = parseInt(digits, 10);
    if (!isNaN(val) && val > 0 && val <= 100000) return val;
  }

  // número suelto + bs pegado: "12.000Bs", "1200bs."
  const m2 = limpio.match(/\b(\d{3,6})\s*bs\.?\b/i);
  if (m2) {
    const val = parseInt(m2[1].replace(/[.\s,]/g, ''), 10);
    if (!isNaN(val) && val > 0) return val;
  }

  // "12mil bs", "12 mil"
  const m3 = limpio.match(/\b(\d{1,3})\s*mil\b/i);
  if (m3) {
    const val = parseInt(m3[1], 10) * 1000;
    if (val > 0 && val <= 100000) return val;
  }

  // palabras
  for (const { regex, value } of NUMEROS_PALABRA) {
    if (regex.test(lower)) return value;
  }

  return null;
}

/**
 * Extracción combinada: primero normalizeMontoBs (nuevo), luego fallback
 * al comportamiento legacy. Mantiene compatibilidad total.
 */
export function extractMontoRobusto(
  text: string,
  legacyExtractor?: (t: string) => number | null
): number | null {
  const nuevo = normalizeMontoBs(text);
  if (nuevo !== null) return nuevo;
  if (legacyExtractor) return legacyExtractor(text);
  return null;
}
