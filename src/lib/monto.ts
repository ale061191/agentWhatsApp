// Utilidades para detectar y clasificar montos en bolívares

export function extractMontoBs(text: string): number | null {
  const lower = text.toLowerCase();
  
  // Patrones con "bs" o "bolivares"
  const patterns = [
    /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:bs|bolivares?|bss?)\b/i,
    /\b(?:pague?|pagué|transferi|deposite?|ingrese?|envie?|monto|pago)\D*(\d{1,3}(?:[.,]\d{3})*)/i,
    /\b(\d{1,3}(?:[.,]\d{3})*)\s*(?:bs|bolivares?|bss?)/i,
  ];
  
  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) {
      const numStr = match[1].replace(/\./g, '').replace(',', '.');
      const num = parseFloat(numStr);
      if (!isNaN(num) && num > 0) return Math.round(num);
    }
  }
  
  // Palabras clave para montos exactos comunes
  const exactMatches: Record<string, number> = {
    'mil doscientos': 1200,
    'mil dos cientos': 1200,
    '1200': 1200,
    '1.200': 1200,
    'doce mil': 12000,
    '12000': 12000,
    '12.000': 12000,
    'seis mil': 6000,
    '6000': 6000,
    '6.000': 6000,
  };
  
  for (const [key, val] of Object.entries(exactMatches)) {
    if (lower.includes(key)) return val;
  }
  
  // Buscar números sueltos de 4-5 dígitos (probables montos)
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