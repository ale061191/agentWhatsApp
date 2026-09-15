// ============================================================================
// SONIA — VALIDACIÓN SECUNDARIA (regex + LLM) — capa complementaria
// Idea (de 500-AI-Agents-Projects + mlabonne/llm-course + HF agents-course):
//  - extractor primario = regex rápido (ya existe en webhook)
//  - validador secundario = chequeo local + prompt para LLM que confirma
//    coherencia sin cambiar el prompt base.
// NO modifica lógica existente: solo añade funciones puras + prompt builder.
// ============================================================================

import { normalizeFechaES } from './normalizacion';

export type FlujoValidable = 'publicidad_dooh' | 'estacion_evento' | 'estacion_gratis' | 'agente_humano';

export interface ExtraccionEvento {
  tipoEvento?: string;
  fecha?: string;
  ubicacion?: string;
  asistentes?: string;
}

export interface ExtraccionPublicidad {
  marca?: string;
  plan?: string;
}

export interface ResultadoValidacion {
  completa: boolean;
  faltantes: string[];
  confianza: 'alta' | 'media' | 'baja';
  sugerencias: string[];
  fechaNormalizada?: string | null;
}

/** Valida extracción de evento con reglas locales (rápido, sin LLM). */
export function validarExtraccionEvento(data: ExtraccionEvento): ResultadoValidacion {
  const faltantes: string[] = [];
  if (!data.tipoEvento) faltantes.push('tipoEvento');
  if (!data.fecha) faltantes.push('fecha');
  if (!data.ubicacion) faltantes.push('ubicacion');
  if (!data.asistentes) faltantes.push('asistentes');

  const fechaNormalizada = data.fecha ? normalizeFechaES(data.fecha) || data.fecha : null;
  const confianza = faltantes.length === 0 ? 'alta' : faltantes.length <= 1 ? 'media' : 'baja';

  const sugerencias: string[] = [];
  if (faltantes.length > 0) {
    const labels: Record<string, string> = {
      tipoEvento: 'tipo de evento',
      fecha: 'fecha(s)',
      ubicacion: 'ubicación',
      asistentes: 'número de asistentes aprox.',
    };
    sugerencias.push(`Me falta: ${faltantes.map((k) => labels[k]).join(', ')}. ¿Me los das? 😊`);
  }

  return { completa: faltantes.length === 0, faltantes, confianza, sugerencias, fechaNormalizada };
}

/** Valida extracción de publicidad DOOH. */
export function validarExtraccionPublicidad(data: ExtraccionPublicidad): ResultadoValidacion {
  const faltantes: string[] = [];
  if (!data.marca) faltantes.push('marca');
  // plan puede quedar "sin definir" — no lo exigimos como faltante duro,
  // pero bajamos confianza para que el LLM lo confirme.
  const confianza = !data.marca ? 'baja' : !data.plan || data.plan === 'sin definir' ? 'media' : 'alta';
  if (!data.marca) faltantes.push('marca');

  return {
    completa: !!data.marca,
    faltantes,
    confianza,
    sugerencias: !data.marca ? ['¿Qué marca/empresa quieres publicitar y qué plan te interesa?'] : [],
  };
}

/**
 * Construye el prompt de validación secundaria (prompt chaining, mlabonne).
 * Se usa como SEGUNDA llamada LLM solo cuando la extracción regex queda
 * incompleta o con confianza media/baja. No reemplaza el prompt base.
 */
export function buildSecondaryValidationPrompt(
  flujo: FlujoValidable,
  textoOriginal: string,
  extraido: Record<string, string | undefined>
): string {
  const campos = Object.entries(extraido)
    .map(([k, v]) => `- ${k}: ${v || '(vacío)'}`)
    .join('\n');
  return [
    'Eres un validador de datos. Devuelve UNICAMENTE un JSON valido sin Markdown.',
    `Flujo: ${flujo}.`,
    `Texto original del usuario: """${textoOriginal.slice(0, 800)}"""`,
    `Extracción actual (regex):\n${campos}`,
    '',
    'Tarea: corrige y completa los campos usando SOLO lo que dice el texto original. No inventes.',
    flujo === 'estacion_evento'
      ? 'Campos esperados: {"tipoEvento":"","fecha":"","ubicacion":"","asistentes":""}. Normaliza fecha a DD/MM/YYYY si puedes.'
      : '',
    flujo === 'publicidad_dooh'
      ? 'Campos esperados: {"marca":"","plan":""}. Plan solo puede ser: Estándar 24, Premium 43, Dominancia Exclusiva o sin definir.'
      : '',
    flujo === 'estacion_gratis'
      ? 'Campos esperados: {"negocio":"","zona":""}.'
      : '',
    flujo === 'agente_humano'
      ? 'Campos esperados: {"nombre":"","motivo":""}.'
      : '',
    'Si un dato no está en el texto, deja "".',
  ].join('\n');
}

/** Registro de auditoría: texto original → extraído (guardrail de calidad). */
export interface AuditEntry {
  texto_original: string;
  extraido: Record<string, string | undefined>;
  validador: 'regex' | 'regex+llm' | 'llm';
  confianza: 'alta' | 'media' | 'baja';
  fecha: string;
}

export function buildAuditEntry(
  textoOriginal: string,
  extraido: Record<string, string | undefined>,
  validador: AuditEntry['validador'],
  confianza: AuditEntry['confianza']
): AuditEntry {
  return {
    texto_original: textoOriginal.slice(0, 500),
    extraido,
    validador,
    confianza,
    fecha: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Guardrails transversales (complemento, no reemplazo)
// ---------------------------------------------------------------------------

/** Campos prohibidos por flujo: nunca pedir cédula/cuenta fuera de reembolso. */
const CAMPOS_PROHIBIDOS: Record<string, string[]> = {
  publicidad_dooh: ['cedula', 'cédula', 'cuenta', 'banco', 'referencia'],
  estacion_evento: ['cedula', 'cédula', 'cuenta', 'banco', 'referencia'],
  estacion_gratis: ['cedula', 'cédula', 'cuenta', 'banco', 'referencia'],
  agente_humano: ['cuenta', 'banco', 'referencia'],
};

/** Devuelve true si el texto pide un dato prohibido para ese flujo. */
export function violaGuardrail(flujo: FlujoValidable, texto: string): boolean {
  const prohibidos = CAMPOS_PROHIBIDOS[flujo] || [];
  const lower = texto.toLowerCase();
  return prohibidos.some((p) => lower.includes(p));
}

/** Cierres empáticos con recap (overlay de tono, no cambia lógica). */
export function buildCierreEmpatico(
  flujo: FlujoValidable | 'falla_alquiler' | 'reembolso',
  casoId: string,
  resumen: string
): string {
  switch (flujo) {
    case 'publicidad_dooh':
      return `¡Perfecto! Ya tengo tu solicitud ID ${casoId} registrada. 💚\nResumen: ${resumen}\nTe contactaremos en 24-48h para cerrar detalles y horarios. ¿Te parece bien que te escriba por este mismo WhatsApp cuando esté lista la propuesta?`;
    case 'estacion_gratis':
      return `¡Genial! Tu solicitud ID ${casoId} quedó registrada. 💚\nResumen: ${resumen}\nUn asesor te contactará para coordinar la instalación sin costo. Te aviso por acá en cuanto tengan fecha propuesta. ¡Gracias por confiar en Voltaje!`;
    case 'estacion_evento':
      return `¡Listo! Solicitud ID ${casoId} registrada. 💚\nResumen: ${resumen}\nTe contactaremos con disponibilidad y costos estimados. ¿Prefieres que te escriba yo o el asesor directo?`;
    case 'agente_humano':
      return `¡Listo! Tu caso ID ${casoId} está registrado. 💚\nResumen: ${resumen}\nTe atiende un compañero al 0412-685-1090 (https://wa.me/584126851090). Si no te responden en 30 min, escríbeme de nuevo y te ayudo a insistir. ¡Gracias!`;
    default:
      return `¡Listo! Tu solicitud (ID: ${casoId}) está registrada. ${resumen} 💚`;
  }
}
