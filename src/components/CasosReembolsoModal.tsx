'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Search, Download, CreditCard, AlertCircle, Trash2, Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';

interface CasosReembolsoModalProps { isOpen: boolean; onClose: () => void; }

interface CasoReembolso {
  id: string; caso_id?: string; fecha_primer_contacto: string; fecha_registro_caso: string;
  canal: string; agente: string;
  datos_usuario: { nombre_completo: string; cedula: string; telefono: string; numero_cuenta: string; tipo_cuenta: string; };
  evidencias: { captura_historial_operaciones: string; captura_billetera_app: string; captura_movimientos_bancarios: string; };
  estado_caso: string; arreglado_sistema?: boolean; arreglado_administracion?: boolean;
}

type DateFilter = 'all' | 'today' | 'week' | 'month' | 'custom';

export default function CasosReembolsoModal({ isOpen, onClose }: CasosReembolsoModalProps) {
  const [casos, setCasos] = useState<CasoReembolso[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const loadCasos = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
      const response = await fetch('/api/db?action=getCasosReembolso');
      const data = await response.json();
      if (data.casos) {
        const arr: CasoReembolso[] = Object.entries(data.casos).map(([id, caso]: [string, any]) => ({ id, ...caso }));
        arr.sort((a, b) => new Date(b.fecha_registro_caso).getTime() - new Date(a.fecha_registro_caso).getTime());
        setCasos(arr);
      } else { setCasos([]); }
    } catch (e) { console.error('Error loading casos:', e); }
    finally { setLoading(false); }
  }, [isOpen]);

  useEffect(() => { loadCasos(); }, [loadCasos]);

  // Compute resolved status: if either checkbox is checked, it's "Solucionado"
  const isResolved = (caso: CasoReembolso) => caso.arreglado_sistema || caso.arreglado_administracion;

  const getEstadoColor = (caso: CasoReembolso) => {
    if (isResolved(caso)) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
    switch (caso.estado_caso) {
      case 'pendiente_validacion': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'en_validacion': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'aprobado': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'rechazado': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getEstadoLabel = (caso: CasoReembolso) => {
    if (isResolved(caso)) return '✅ Solucionado';
    switch (caso.estado_caso) {
      case 'pendiente_validacion': return 'Pendiente';
      case 'en_validacion': return 'En Validación';
      case 'aprobado': return 'Aprobado';
      case 'rechazado': return 'Rechazado';
      default: return caso.estado_caso;
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const filterByDate = (caso: CasoReembolso): boolean => {
    if (dateFilter === 'all') return true;
    const d = new Date(caso.fecha_registro_caso); const now = new Date();
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

  const casosFiltrados = casos.filter(filterByDate).filter(caso =>
    caso.datos_usuario?.nombre_completo?.toLowerCase().includes(filtro.toLowerCase()) ||
    caso.datos_usuario?.cedula?.includes(filtro) || caso.id.includes(filtro) || caso.caso_id?.includes(filtro)
  );

  const totalPages = Math.max(1, Math.ceil(casosFiltrados.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedCasos = casosFiltrados.slice((safeCurrentPage - 1) * ITEMS_PER_PAGE, safeCurrentPage * ITEMS_PER_PAGE);

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [filtro, dateFilter, customDateFrom, customDateTo]);

  const handleDelete = async (casoId: string) => {
    if (deletingId) return;
    setDeletingId(casoId);
    try {
      await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteCasoReembolso', chatId: casoId }) });
      setCasos(prev => prev.filter(c => c.id !== casoId));
    } catch (e) { console.error('Error deleting caso:', e); }
    finally { setDeletingId(null); }
  };

  const handleToggleField = async (casoId: string, field: 'arreglado_sistema' | 'arreglado_administracion', currentValue: boolean) => {
    const newValue = !currentValue;
    setCasos(prev => prev.map(c => c.id === casoId ? { ...c, [field]: newValue } : c));
    try {
      // Also update estado_caso when resolving
      const caso = casos.find(c => c.id === casoId);
      const otherField = field === 'arreglado_sistema' ? 'arreglado_administracion' : 'arreglado_sistema';
      const willBeResolved = newValue || (caso && (caso as any)[otherField]);
      const updates: any = { [field]: newValue };
      if (willBeResolved) updates.estado_caso = 'solucionado';
      else if (!newValue && !(caso as any)?.[otherField]) updates.estado_caso = 'pendiente_validacion';

      await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateCasoReembolso', chatId: casoId, updates }) });
    } catch (e) {
      console.error('Error updating caso:', e);
      setCasos(prev => prev.map(c => c.id === casoId ? { ...c, [field]: currentValue } : c));
    }
  };

  // ── Export to real .xlsx ──
  const handleExportExcel = () => {
    if (casosFiltrados.length === 0) return;
    const data = casosFiltrados.map(caso => ({
      'ID Caso': caso.caso_id || caso.id,
      'Fecha Registro': formatDate(caso.fecha_registro_caso),
      'Usuario': caso.datos_usuario?.nombre_completo || '-',
      'Cédula': caso.datos_usuario?.cedula || '-',
      'Teléfono': caso.datos_usuario?.telefono || '-',
      'Cuenta': caso.datos_usuario?.numero_cuenta || '-',
      'Tipo Cuenta': caso.datos_usuario?.tipo_cuenta || '-',
      'Evidencia Historial': caso.evidencias?.captura_historial_operaciones ? 'Sí' : 'No',
      'Evidencia Billetera': caso.evidencias?.captura_billetera_app ? 'Sí' : 'No',
      'Evidencia Banco': caso.evidencias?.captura_movimientos_bancarios ? 'Sí' : 'No',
      'Estado': getEstadoLabel(caso),
      'Arreglado Sistema': caso.arreglado_sistema ? 'Sí' : 'No',
      'Arreglado Administración': caso.arreglado_administracion ? 'Sí' : 'No',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    // Auto-size columns
    const colWidths = Object.keys(data[0]).map(key => ({ wch: Math.max(key.length + 2, ...data.map(r => String((r as any)[key]).length + 2)) }));
    ws['!cols'] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Casos Reembolso');
    XLSX.writeFile(wb, `casos_reembolso_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[96vw] xl:max-w-[1400px] max-h-[88vh] bg-[#111317] border border-[rgba(37,211,102,0.25)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ boxShadow: '0 0 60px rgba(37,211,102,0.08)' }}>
        
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-[rgba(37,211,102,0.15)] shrink-0" style={{ padding: '20px 28px' }}>
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#25d366]/15 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-[#39ff14]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Casos de Reembolso</h2>
              <p className="text-xs text-gray-500 mt-0.5">{casos.length} registro{casos.length !== 1 ? 's' : ''} en total</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2.5 hover:bg-white/5 rounded-xl transition-colors">
            <X className="w-5 h-5 text-gray-400 hover:text-white transition-colors" />
          </button>
        </div>

        {/* ── Toolbar ── */}
        <div className="border-b border-[rgba(37,211,102,0.1)] shrink-0" style={{ padding: '16px 28px' }}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input type="text" placeholder="Buscar por nombre, cédula o ID..." value={filtro} onChange={(e) => setFiltro(e.target.value)}
                className="w-full bg-[#0a0b0d] text-white text-sm border border-[rgba(255,255,255,0.08)] focus:border-[#25d366]/50 focus:outline-none focus:ring-1 focus:ring-[#25d366]/20 placeholder-gray-600 transition-all"
                style={{ paddingLeft: '44px', paddingRight: '16px', height: '44px', borderRadius: '8px' }}
              />
            </div>
            {/* Date Filter */}
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
            {/* Export */}
            <button onClick={handleExportExcel} disabled={casosFiltrados.length === 0}
              className="flex items-center gap-2.5 bg-[#25d366]/10 hover:bg-[#25d366]/20 border border-[#25d366]/25 text-sm text-[#25d366] transition-all disabled:opacity-30 disabled:cursor-not-allowed font-medium"
              style={{ padding: '0 20px', height: '44px', borderRadius: '8px' }}>
              <Download className="w-4 h-4" />
              <span>Exportar Excel</span>
            </button>
          </div>
        </div>

        {/* ── Table ── */}
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
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
                  <AlertCircle className="w-8 h-8 text-gray-600" />
                </div>
                <p className="text-gray-400 font-medium text-base">No hay casos registrados</p>
                <p className="text-xs text-gray-600">Los casos aparecerán aquí cuando los usuarios soliciten reembolsos</p>
              </div>
            </div>
          ) : (
            <table className="w-full text-sm" style={{ borderSpacing: '0 4px', borderCollapse: 'separate' }}>
              <thead className="sticky top-0 bg-[#111317] z-10">
                <tr>
                  {['ID', 'FECHA', 'USUARIO', 'CÉDULA', 'TELÉFONO', 'CUENTA', 'TIPO'].map(h => (
                    <th key={h} className="text-left text-[11px] text-gray-500 font-semibold uppercase tracking-widest" style={{ padding: '14px 16px' }}>{h}</th>
                  ))}
                  <th className="text-center text-[11px] text-gray-500 font-semibold uppercase tracking-widest" style={{ padding: '14px 12px' }}>EVIDENCIAS</th>
                  <th className="text-center text-[11px] text-gray-500 font-semibold uppercase tracking-widest" style={{ padding: '14px 12px' }}>ESTADO</th>
                  <th className="text-center text-[11px] text-gray-500 font-semibold uppercase tracking-widest" style={{ padding: '14px 12px', whiteSpace: 'nowrap' }}>ARR. SISTEMA</th>
                  <th className="text-center text-[11px] text-gray-500 font-semibold uppercase tracking-widest" style={{ padding: '14px 12px', whiteSpace: 'nowrap' }}>ARR. ADMIN</th>
                  <th style={{ padding: '14px 12px', width: '50px' }}></th>
                </tr>
              </thead>
              <tbody>
                {paginatedCasos.map(caso => (
                  <tr key={caso.id} className="hover:bg-[rgba(37,211,102,0.04)] transition-colors group rounded-xl"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '16px' }}>
                      <span className="text-[#25d366] font-mono text-xs bg-[#25d366]/10 rounded-lg" style={{ padding: '5px 10px' }}>
                        {(caso.caso_id || caso.id).slice(0, 13)}
                      </span>
                    </td>
                    <td className="text-gray-400 text-xs whitespace-nowrap" style={{ padding: '16px' }}>{formatDate(caso.fecha_registro_caso)}</td>
                    <td style={{ padding: '16px' }}><span className="text-white font-medium">{caso.datos_usuario?.nombre_completo || '-'}</span></td>
                    <td className="text-gray-300 font-mono text-xs" style={{ padding: '16px' }}>{caso.datos_usuario?.cedula || '-'}</td>
                    <td className="text-gray-300 text-xs" style={{ padding: '16px' }}>{caso.datos_usuario?.telefono || '-'}</td>
                    <td style={{ padding: '16px' }}><span className="text-gray-300 font-mono text-xs">{caso.datos_usuario?.numero_cuenta || '-'}</span></td>
                    <td style={{ padding: '16px' }}>
                      <span className={`text-xs rounded-lg ${caso.datos_usuario?.tipo_cuenta === 'Ahorro' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-violet-500/10 text-violet-400'}`}
                        style={{ padding: '4px 10px' }}>
                        {caso.datos_usuario?.tipo_cuenta || '-'}
                      </span>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <div className="flex items-center justify-center gap-2">
                        <span className={`w-3.5 h-3.5 rounded-full ${caso.evidencias?.captura_historial_operaciones ? 'bg-green-500' : 'bg-gray-700'}`} title="Historial App" />
                        <span className={`w-3.5 h-3.5 rounded-full ${caso.evidencias?.captura_billetera_app ? 'bg-blue-500' : 'bg-gray-700'}`} title="Billetera App" />
                        <span className={`w-3.5 h-3.5 rounded-full ${caso.evidencias?.captura_movimientos_bancarios ? 'bg-purple-500' : 'bg-gray-700'}`} title="Banco" />
                      </div>
                    </td>
                    <td className="text-center" style={{ padding: '16px' }}>
                      <span className={`inline-block rounded-full text-xs border font-semibold ${getEstadoColor(caso)}`} style={{ padding: '5px 14px' }}>
                        {getEstadoLabel(caso)}
                      </span>
                    </td>
                    {/* Arreglado por Sistema */}
                    <td className="text-center" style={{ padding: '16px' }}>
                      <label className="inline-flex items-center justify-center cursor-pointer">
                        <input type="checkbox" checked={caso.arreglado_sistema || false}
                          onChange={() => handleToggleField(caso.id, 'arreglado_sistema', caso.arreglado_sistema || false)}
                          className="sr-only peer" />
                        <div className="w-[22px] h-[22px] rounded-md border-2 border-gray-600 peer-checked:border-[#25d366] peer-checked:bg-[#25d366] flex items-center justify-center transition-all cursor-pointer">
                          {caso.arreglado_sistema && (
                            <svg className="w-3.5 h-3.5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </label>
                    </td>
                    {/* Arreglado por Administración */}
                    <td className="text-center" style={{ padding: '16px' }}>
                      <label className="inline-flex items-center justify-center cursor-pointer">
                        <input type="checkbox" checked={caso.arreglado_administracion || false}
                          onChange={() => handleToggleField(caso.id, 'arreglado_administracion', caso.arreglado_administracion || false)}
                          className="sr-only peer" />
                        <div className="w-[22px] h-[22px] rounded-md border-2 border-gray-600 peer-checked:border-orange-400 peer-checked:bg-orange-400 flex items-center justify-center transition-all cursor-pointer">
                          {caso.arreglado_administracion && (
                            <svg className="w-3.5 h-3.5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </label>
                    </td>
                    {/* Delete */}
                    <td className="text-center" style={{ padding: '16px' }}>
                      <button onClick={e => { e.stopPropagation(); handleDelete(caso.id); }} disabled={deletingId === caso.id}
                        className="p-2 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-30"
                        title="Eliminar caso">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination ── */}
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

        {/* ── Footer ── */}
        {!loading && casosFiltrados.length > 0 && (
          <div className="border-t border-[rgba(255,255,255,0.05)] shrink-0 flex items-center justify-between text-xs text-gray-500"
            style={{ padding: '14px 28px' }}>
            <span>Mostrando {((safeCurrentPage - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(safeCurrentPage * ITEMS_PER_PAGE, casosFiltrados.length)} de {casosFiltrados.length} casos</span>
            <div className="flex items-center gap-5">
              <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Historial</span>
              <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Billetera</span>
              <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-purple-500" /> Banco</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}