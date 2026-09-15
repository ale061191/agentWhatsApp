'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Search, Download, FileText, AlertCircle, Trash2, Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';

interface CasosAtencionModalProps { isOpen: boolean; onClose: () => void; }

interface CasoAtencion {
  id: string;
  caso_id?: string;
  tipo?: string;
  fecha?: string;
  usuario?: string;
  telefono?: string;
  monto?: string;
  observaciones?: string;
  estado?: string;
}

type DateFilter = 'all' | 'today' | 'week' | 'month' | 'custom';
type TipoFilter = 'all' | 'FALLA_ALQUILER' | 'CUPON_CHARGE_GO' | 'REEMBOLSO' | 'PUBLICIDAD_DOOH' | 'ESTACION_GRATIS' | 'ESTACION_EVENTO' | 'AGENTE_HUMANO';

interface MetricasAtencion {
  total: number;
  porTipo: Record<string, number>;
  porEstado: Record<string, number>;
  porDia: Record<string, number>;
}

export default function CasosAtencionModal({ isOpen, onClose }: CasosAtencionModalProps) {
  const [casos, setCasos] = useState<CasoAtencion[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [tipoFilter, setTipoFilter] = useState<TipoFilter>('all');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [showTipoDropdown, setShowTipoDropdown] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [metricas, setMetricas] = useState<MetricasAtencion | null>(null);
  const [showMetricas, setShowMetricas] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const ITEMS_PER_PAGE = 10;

  const loadCasos = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [resCasos, resMet] = await Promise.all([
        fetch('/api/db?action=getCasosAtencion'),
        fetch('/api/db?action=getMetricasAtencion').catch(() => null),
      ]);
      if (!resCasos.ok) {
        // No silenciar: si Firebase bloquea lectura (rules), avisar en UI.
        setLoadError(`No se pudo leer casos_atencion (HTTP ${resCasos.status}). Revisa las reglas de Firebase Realtime Database.`);
        setCasos([]);
        setMetricas({ total: 0, porTipo: {}, porEstado: {}, porDia: {} });
        return;
      }
      const data = await resCasos.json();
      if (data.casos) {
        const arr: CasoAtencion[] = Object.entries(data.casos).map(([id, caso]: [string, any]) => ({ id, ...caso }));
        arr.sort((a, b) => (parseFechaCaso(b.fecha)?.getTime() || 0) - (parseFechaCaso(a.fecha)?.getTime() || 0));
        setCasos(arr);
        // Métricas: preferir servidor, fallback a cálculo local
        try {
          if (resMet) {
            const mData = await (resMet as Response).json();
            if (mData.metricas) setMetricas(mData.metricas);
            else throw new Error('no metricas');
          } else throw new Error('no res');
        } catch {
          const porTipo: Record<string, number> = {};
          const porEstado: Record<string, number> = {};
          const porDia: Record<string, number> = {};
          for (const c of arr) {
            const t = c.tipo || 'SIN_TIPO';
            const e = (c.estado || 'Pendiente').toLowerCase();
            porTipo[t] = (porTipo[t] || 0) + 1;
            porEstado[e] = (porEstado[e] || 0) + 1;
            const m = String(c.fecha || '').match(/(\d{2}\/\d{2}\/\d{4})/);
            const dia = m ? m[1] : 'sin-fecha';
            porDia[dia] = (porDia[dia] || 0) + 1;
          }
          setMetricas({ total: arr.length, porTipo, porEstado, porDia });
        }
      } else {
        setCasos([]);
        setMetricas({ total: 0, porTipo: {}, porEstado: {}, porDia: {} });
      }
    } catch (e) {
      console.error('Error loading casos:', e);
      setLoadError('Error de conexión al cargar casos. Revisa la consola y las reglas de Firebase.');
    } finally {
      setLoading(false);
    }
  }, [isOpen]);

  useEffect(() => { loadCasos(); }, [loadCasos]);

  const getEstadoColor = (caso: CasoAtencion) => {
    const estado = (caso.estado || 'Pendiente').toLowerCase();
    if (estado === 'atendido') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
    if (estado === 'pendiente') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  };

  const getTipoLabel = (tipo?: string) => {
    const map: Record<string, string> = {
      FALLA_ALQUILER: 'Falla Alquiler',
      CUPON_CHARGE_GO: 'Cupón Charge Go',
      REEMBOLSO: 'Reembolso',
      PUBLICIDAD_DOOH: 'Publicidad DOOH',
      ESTACION_GRATIS: 'Estación Gratis',
      ESTACION_EVENTO: 'Estación Evento',
      AGENTE_HUMANO: 'Agente Humano',
    };
    return map[tipo || ''] || tipo || '-';
  };

  const parseFechaCaso = (dateStr?: string): Date | null => {
    if (!dateStr) return null;
    // Formato guardado por el webhook: "DD/MM/YYYY HH:MM" (no lo parsea new Date).
    const m = String(dateStr).match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || '0'), +(m[5] || '0'));
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    const d = parseFechaCaso(dateStr);
    if (!d) return dateStr;
    try {
      return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  const filterByDate = (caso: CasoAtencion): boolean => {
    if (dateFilter === 'all') return true;
    const d = parseFechaCaso(caso.fecha);
    if (!d) return false;
    const now = new Date();
    if (dateFilter === 'today') return d.toDateString() === now.toDateString();
    if (dateFilter === 'week') { const w = new Date(now); w.setDate(w.getDate() - 7); return d >= w; }
    if (dateFilter === 'month') { const m = new Date(now); m.setMonth(m.getMonth() - 1); return d >= m; }
    if (dateFilter === 'custom') {
      const from = customDateFrom ? new Date(customDateFrom) : new Date(0);
      const to = customDateTo ? new Date(customDateTo + 'T23:59:59') : new Date();
      return d >= from && d <= to;
    }
    return true;
  };

  const dateFilterLabels: Record<DateFilter, string> = { all: 'Todas las fechas', today: 'Hoy', week: 'Última semana', month: 'Último mes', custom: 'Personalizado' };
  const tipoFilterLabels: Record<TipoFilter, string> = {
    all: 'Todos los tipos',
    FALLA_ALQUILER: 'Falla Alquiler',
    CUPON_CHARGE_GO: 'Cupón Charge Go',
    REEMBOLSO: 'Reembolso',
    PUBLICIDAD_DOOH: 'Publicidad DOOH',
    ESTACION_GRATIS: 'Estación Gratis',
    ESTACION_EVENTO: 'Estación Evento',
    AGENTE_HUMANO: 'Agente Humano',
  };

  const casosFiltrados = casos.filter(filterByDate).filter(caso =>
    (tipoFilter === 'all' || caso.tipo === tipoFilter) &&
    (
      caso.usuario?.toLowerCase().includes(filtro.toLowerCase()) ||
      caso.id.includes(filtro) ||
      caso.caso_id?.includes(filtro) ||
      caso.observaciones?.toLowerCase().includes(filtro.toLowerCase()) ||
      caso.tipo?.toLowerCase().includes(filtro.toLowerCase())
    )
  );

  const totalPages = Math.max(1, Math.ceil(casosFiltrados.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedCasos = casosFiltrados.slice((safeCurrentPage - 1) * ITEMS_PER_PAGE, safeCurrentPage * ITEMS_PER_PAGE);

  useEffect(() => { setCurrentPage(1); }, [filtro, dateFilter, tipoFilter, customDateFrom, customDateTo]);

  const handleDelete = async (casoId: string) => {
    if (deletingId) return;
    setDeletingId(casoId);
    try {
      await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteCasoAtencion', chatId: casoId }) });
      setCasos(prev => prev.filter(c => c.id !== casoId));
    } catch (e) {
      console.error('Error deleting caso:', e);
    } finally {
      setDeletingId(null);
    }
  };

  const isAtendido = (caso: CasoAtencion) => (caso.estado || 'Pendiente').toLowerCase() === 'atendido';

  const handleToggleAtendido = async (casoId: string, currentlyAtendido: boolean) => {
    const newEstado = currentlyAtendido ? 'Pendiente' : 'Atendido';
    setCasos(prev => prev.map(c => c.id === casoId ? { ...c, estado: newEstado } : c));
    setMetricas(prev => {
      if (!prev) return prev;
      const pen = (prev.porEstado['pendiente'] || 0) + (currentlyAtendido ? 1 : -1);
      const ate = (prev.porEstado['atendido'] || 0) + (currentlyAtendido ? -1 : 1);
      return { ...prev, porEstado: { ...prev.porEstado, pendiente: Math.max(0, pen), atendido: Math.max(0, ate) } };
    });
    try {
      await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateCasoAtencion', chatId: casoId, updates: { estado: newEstado } }) });
    } catch (e) {
      console.error('Error updating atendido:', e);
      const oldEstado = currentlyAtendido ? 'Atendido' : 'Pendiente';
      setCasos(prev => prev.map(c => c.id === casoId ? { ...c, estado: oldEstado } : c));
    }
  };

  const handleExportExcel = () => {
    if (casosFiltrados.length === 0) return;
    const data = casosFiltrados.map(caso => ({
      'ID Caso': caso.caso_id || caso.id,
      'Fecha': formatDate(caso.fecha),
      'Usuario': caso.usuario || '-',
      'Teléfono': caso.telefono || '-',
      'Tipo': getTipoLabel(caso.tipo),
      'Monto': caso.monto || '-',
      'Observaciones': caso.observaciones || '-',
      'Estado': caso.estado || '-',
      'Atendido': isAtendido(caso) ? 'Sí' : 'No',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const colWidths = Object.keys(data[0]).map(key => ({ wch: Math.max(key.length + 2, ...data.map(r => String((r as any)[key]).length + 2)) }));
    ws['!cols'] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Casos Atención');
    XLSX.writeFile(wb, `casos_atencion_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[98vw] max-h-[92vh] bg-[#111317] border border-[rgba(37,211,102,0.25)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ boxShadow: '0 0 60px rgba(37,211,102,0.08)' }}>
        
        <div className="flex items-center justify-between border-b border-[rgba(37,211,102,0.15)] shrink-0" style={{ padding: '20px 28px' }}>
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#25d366]/15 flex items-center justify-center">
              <FileText className="w-5 h-5 text-[#39ff14]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Casos de Atención</h2>
              <p className="text-xs text-gray-500 mt-0.5">{casos.length} registro{casos.length !== 1 ? 's' : ''} en total</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMetricas(v => !v)}
              className="px-4 h-[38px] rounded-lg text-xs font-medium bg-[#25d366]/10 border border-[#25d366]/25 text-[#25d366] hover:bg-[#25d366]/20 transition-all"
            >
              {showMetricas ? 'Ocultar métricas' : 'Ver métricas'}
            </button>
            <button onClick={onClose} className="p-2.5 hover:bg-white/5 rounded-xl transition-colors">
              <X className="w-5 h-5 text-gray-400 hover:text-white transition-colors" />
            </button>
          </div>
        </div>

        {showMetricas && metricas && (
          <div className="border-b border-[rgba(37,211,102,0.1)] shrink-0 bg-[#0d0f12]" style={{ padding: '20px 28px' }}>
            <div className="flex flex-wrap gap-4">
              <div className="rounded-xl bg-white/[0.03] border border-white/10 min-w-[150px] flex flex-col justify-center gap-1.5" style={{ padding: '16px 22px' }}>
                <p className="text-[11px] uppercase tracking-[0.15em] text-gray-500">Total</p>
                <p className="text-2xl font-bold text-white leading-none">{metricas.total}</p>
              </div>
              <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/20 min-w-[150px] flex flex-col justify-center gap-1.5" style={{ padding: '16px 22px' }}>
                <p className="text-[11px] uppercase tracking-[0.15em] text-yellow-500/80">Pendientes</p>
                <p className="text-2xl font-bold text-yellow-400 leading-none">{metricas.porEstado['pendiente'] || 0}</p>
              </div>
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 min-w-[150px] flex flex-col justify-center gap-1.5" style={{ padding: '16px 22px' }}>
                <p className="text-[11px] uppercase tracking-[0.15em] text-emerald-500/80">Atendidos</p>
                <p className="text-2xl font-bold text-emerald-400 leading-none">{metricas.porEstado['atendido'] || 0}</p>
              </div>
              <div className="flex-1 min-w-[240px] rounded-xl bg-white/[0.03] border border-white/10 flex flex-col justify-center gap-2.5" style={{ padding: '16px 22px' }}>
                <p className="text-[11px] uppercase tracking-[0.15em] text-gray-500">Por tipo</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(metricas.porTipo).map(([tipo, n]) => (
                    <span key={tipo} className="text-xs rounded-full bg-[#25d366]/10 border border-[#25d366]/25 text-[#25d366]" style={{ padding: '5px 12px' }}>
                      {getTipoLabel(tipo)}: <b>{n}</b>
                    </span>
                  ))}
                  {Object.keys(metricas.porTipo).length === 0 && <span className="text-xs text-gray-600">Sin datos</span>}
                </div>
              </div>
              <div className="flex-1 min-w-[240px] rounded-xl bg-white/[0.03] border border-white/10 flex flex-col justify-center gap-2.5" style={{ padding: '16px 22px' }}>
                <p className="text-[11px] uppercase tracking-[0.15em] text-gray-500">Últimos días</p>
                <div className="flex items-end gap-2.5" style={{ height: '48px' }}>
                  {Object.entries(metricas.porDia).slice(-7).map(([dia, n]) => {
                    const max = Math.max(1, ...Object.values(metricas.porDia));
                    const h = Math.max(6, Math.round((n / max) * 36));
                    return (
                      <div key={dia} className="flex flex-col items-center justify-end gap-1.5" title={`${dia}: ${n}`}>
                        <div className="w-6 rounded bg-[#25d366]/60" style={{ height: `${h}px` }} />
                        <span className="text-[10px] text-gray-500">{dia.slice(0, 5)}</span>
                      </div>
                    );
                  })}
                  {Object.keys(metricas.porDia).length === 0 && <span className="text-xs text-gray-600">Sin datos</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="border-b border-[rgba(37,211,102,0.1)] shrink-0" style={{ padding: '16px 28px' }}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input type="text" placeholder="Buscar por usuario, ID o tipo..." value={filtro} onChange={(e) => setFiltro(e.target.value)}
                className="w-full bg-[#0a0b0d] text-white text-sm border border-[rgba(255,255,255,0.08)] focus:border-[#25d366]/50 focus:outline-none focus:ring-1 focus:ring-[#25d366]/20 placeholder-gray-600 transition-all"
                style={{ paddingLeft: '44px', paddingRight: '16px', height: '44px', borderRadius: '8px' }}
              />
            </div>

            <div className="relative">
              <button onClick={() => setShowTipoDropdown(!showTipoDropdown)}
                className="flex items-center gap-2.5 bg-[#0a0b0d] border border-[rgba(255,255,255,0.08)] text-sm text-gray-300 hover:border-[#25d366]/30 transition-colors"
                style={{ padding: '0 18px', height: '44px', borderRadius: '8px' }}>
                <FileText className="w-4 h-4 text-[#25d366]" />
                <span>{tipoFilterLabels[tipoFilter]}</span>
                <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
              </button>
              {showTipoDropdown && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-[#1a1d21] border border-[rgba(255,255,255,0.1)] rounded-xl shadow-2xl z-50 overflow-hidden">
                  {(Object.keys(tipoFilterLabels) as TipoFilter[]).map(key => (
                    <button key={key} onClick={() => { setTipoFilter(key); setShowTipoDropdown(false); }}
                      className={`w-full text-left text-sm transition-colors ${tipoFilter === key ? 'bg-[#25d366]/15 text-[#25d366]' : 'text-gray-300 hover:bg-white/5'}`}
                      style={{ padding: '12px 18px' }}>
                      {tipoFilterLabels[key]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative">
              <button onClick={() => setShowDateDropdown(!showDateDropdown)}
                className="flex items-center gap-2.5 bg-[#0a0b0d] border border-[rgba(255,255,255,0.08)] text-sm text-gray-300 hover:border-[#25d366]/30 transition-colors"
                style={{ padding: '0 18px', height: '44px', borderRadius: '8px' }}>
                <Calendar className="w-4 h-4 text-[#25d366]" />
                <span>{dateFilterLabels[dateFilter]}</span>
                <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
              </button>
              {showDateDropdown && (
                <div className="absolute top-full left-0 mt-2 w-60 bg-[#1a1d21] border border-[rgba(255,255,255,0.1)] rounded-xl shadow-2xl z-50 overflow-hidden">
                  {(Object.keys(dateFilterLabels) as DateFilter[]).map(key => (
                    <button key={key} onClick={() => { setDateFilter(key); if (key !== 'custom') setShowDateDropdown(false); }}
                      className={`w-full text-left text-sm transition-colors ${dateFilter === key ? 'bg-[#25d366]/15 text-[#25d366]' : 'text-gray-300 hover:bg-white/5'}`}
                      style={{ padding: '12px 18px' }}>
                      {dateFilterLabels[key]}
                    </button>
                  ))}
                  {dateFilter === 'custom' && (
                    <div className="border-t border-[rgba(255,255,255,0.05)] flex flex-col gap-2.5" style={{ padding: '14px 18px' }}>
                      <input type="date" value={customDateFrom} onChange={e => setCustomDateFrom(e.target.value)}
                        className="w-full px-3 py-2 bg-[#0d0e10] border border-[rgba(255,255,255,0.1)] rounded-lg text-white text-xs focus:outline-none focus:border-[#25d366]/50" />
                      <input type="date" value={customDateTo} onChange={e => setCustomDateTo(e.target.value)}
                        className="w-full px-3 py-2 bg-[#0d0e10] border border-[rgba(255,255,255,0.1)] rounded-lg text-white text-xs focus:outline-none focus:border-[#25d366]/50" />
                      <button onClick={() => setShowDateDropdown(false)}
                        className="w-full py-2 bg-[#25d366]/20 text-[#25d366] text-xs rounded-lg hover:bg-[#25d366]/30 transition-colors font-medium mt-1">
                        Aplicar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button onClick={handleExportExcel} disabled={casosFiltrados.length === 0}
              className="flex items-center gap-2.5 bg-[#25d366]/10 hover:bg-[#25d366]/20 border border-[#25d366]/25 text-sm text-[#25d366] transition-all disabled:opacity-30 disabled:cursor-not-allowed font-medium"
              style={{ padding: '0 20px', height: '44px', borderRadius: '8px' }}>
              <Download className="w-4 h-4" />
              <span>Exportar Excel</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto" style={{ padding: '8px 16px' }}>
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex flex-col items-center gap-4">
                <div className="w-9 h-9 border-2 border-[#25d366]/30 border-t-[#25d366] rounded-full animate-spin" />
                <p className="text-sm text-gray-500">Cargando casos...</p>
              </div>
            </div>
          ) : casosFiltrados.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex flex-col items-center gap-4 text-center max-w-[420px]">
                <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
                  <AlertCircle className="w-8 h-8 text-gray-600" />
                </div>
                <p className="text-gray-400 font-medium text-base">
                  {loadError ? 'No se pudieron cargar los casos' : 'No hay casos registrados'}
                </p>
                <p className="text-xs text-gray-600">
                  {loadError
                    ? loadError
                    : 'Los casos aparecerán aquí cuando los usuarios soliciten atención'}
                </p>
              </div>
            </div>
          ) : (
            <table className="w-full text-sm" style={{ borderSpacing: '0 4px', borderCollapse: 'separate' }}>
              <thead className="sticky top-0 bg-[#111317] z-10">
                <tr>
                  {['ID', 'FECHA', 'USUARIO', 'TELÉFONO', 'TIPO', 'MONTO', 'OBSERVACIONES', 'ESTADO', 'ATENDIDO'].map(h => (
                    <th key={h} className="text-left text-[11px] text-gray-500 font-semibold uppercase tracking-widest" style={{ padding: '14px 14px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedCasos.map(caso => (
                  <tr key={caso.id} className="hover:bg-[rgba(37,211,102,0.04)] transition-colors group rounded-xl"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '14px' }}>
                      <span className="text-[#25d366] font-mono text-xs bg-[#25d366]/10 rounded-lg" style={{ padding: '4px 8px' }}>
                        {(caso.caso_id || caso.id).slice(0, 13)}
                      </span>
                    </td>
                    <td className="text-gray-400 text-xs whitespace-nowrap" style={{ padding: '14px' }}>{formatDate(caso.fecha)}</td>
                    <td style={{ padding: '14px' }}><span className="text-white font-medium">{caso.usuario || '-'}</span></td>
                    <td className="text-gray-300 text-xs" style={{ padding: '14px' }}>{caso.telefono || '-'}</td>
                    <td style={{ padding: '14px' }}><span className="text-gray-300 text-xs">{getTipoLabel(caso.tipo)}</span></td>
                    <td style={{ padding: '14px' }}><span className="text-yellow-400 font-mono text-xs">{caso.monto || '-'}</span></td>
                    <td style={{ padding: '14px' }}>
                      <span className="text-white text-xs">{caso.observaciones || '-'}</span>
                    </td>
                    <td className="text-center" style={{ padding: '14px' }}>
                      <span className={`inline-block rounded-full text-xs border font-semibold ${getEstadoColor(caso)}`} style={{ padding: '4px 12px' }}>
                        {isAtendido(caso) ? '✅ Atendido' : (caso.estado || 'Pendiente')}
                      </span>
                    </td>
                    <td className="text-center" style={{ padding: '14px' }}>
                      <label className="inline-flex items-center justify-center cursor-pointer">
                        <input type="checkbox" checked={isAtendido(caso)}
                          onChange={() => handleToggleAtendido(caso.id, isAtendido(caso))}
                          className="sr-only peer" />
                        <div className="w-[22px] h-[22px] rounded-md border-2 border-gray-600 peer-checked:border-[#25d366] peer-checked:bg-[#25d366] flex items-center justify-center transition-all cursor-pointer">
                          {isAtendido(caso) && (
                            <svg className="w-3.5 h-3.5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && casosFiltrados.length > 0 && totalPages > 1 && (
          <div className="border-t border-[rgba(255,255,255,0.05)] shrink-0 flex items-center justify-center gap-2" style={{ padding: '14px 28px' }}>
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safeCurrentPage === 1}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
              <button key={page} onClick={() => setCurrentPage(page)}
                className={`min-w-[36px] h-[36px] rounded-lg text-sm font-medium transition-all ${
                  page === safeCurrentPage
                    ? 'bg-[#25d366] text-black'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}>
                {page}
              </button>
            ))}
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safeCurrentPage === totalPages}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {!loading && casosFiltrados.length > 0 && (
          <div className="border-t border-[rgba(255,255,255,0.05)] shrink-0 flex items-center justify-between text-xs text-gray-500"
            style={{ padding: '14px 28px' }}>
            <span>Mostrando {((safeCurrentPage - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(safeCurrentPage * ITEMS_PER_PAGE, casosFiltrados.length)} de {casosFiltrados.length} casos</span>
            <div className="flex items-center gap-5">
              <span className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4 accent-[#25d366]" disabled /> Atendido</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
