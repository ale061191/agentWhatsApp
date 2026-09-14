// Utilidades para detectar y clasificar montos en bolívares

export function extractMontoBs(text: string): number | null {
  const lower = text.toLowerCase();
  
  // Patrones con "bs" o "bolivares" - SOPORTA números con y sin separadores de miles
  const patterns = [
    // 12000, 12.000, 12,000, 6000, 6.000, etc. seguido de bs/bolivares
    /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:bs|bolivares?|bss?)\b/i,
    // "pague 12000", "transferí 12.000", etc.
    /\b(?:pague?|pagué|transferi|deposite?|ingrese?|envie?|monto|pago)\D*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i,
    // Número suelto seguido de bs/bolivares
    /\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:bs|bolivares?|bss?)\b/i,
  ];
  
  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) {
      const numStr = match[1].replace(/\./g, '').replace(',', '.');
      const num = parseFloat(numStr);
      if (!isNaN(num) && num > 0) return Math.round(num);
    }
  }
  
  // Palabras clave para montos exactos comunes - USAR LÍMITES DE PALABRA
  const exactPatterns = [
    { regex: /\b(?:mil\s+doscientos|mil\s+dos\s+cientos|1200|1\.200)\b/, value: 1200 },
    { regex: /\b(?:doce\s+mil|12000|12\.000)\b/, value: 12000 },
    { regex: /\b(?:seis\s+mil|6000|6\.000)\b/, value: 6000 },
  ];
  
  for (const { regex, value } of exactPatterns) {
    if (regex.test(lower)) return value;
  }
  
  // Buscar números sueltos de 4-5 dígitos (probables montos) - CON LÍMITES
  const nums = lower.match(/\b\d{4,5}\b/g);
  if (nums) {
    for (const n of nums) {
      const val = parseInt(n, 10);
      if (val >= 1000 && val <= 20000) return val;
    }
  }
  
  return null;
}

export function clasificarMonto(monto: number): 'cupón_1200' | 'reembolso_real' | 'falla_12000' | 'fuera_rango' {
  if (monto === 1200) return 'cupón_1200';
  if (monto === 12000) return 'falla_12000';
  if (monto >= 1201 && monto <= 11999) return 'reembolso_real';
  return 'fuera_rango';
}

export function generarCasoId(): string {
  return 'CASO-' + Date.now().toString().slice(-8);
}

export function formatearFechaAhora(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}