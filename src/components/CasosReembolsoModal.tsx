'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Search, Download, CreditCard, AlertCircle, Trash2, Calendar, ChevronDown } from 'lucide-react';

interface CasosReembolsoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CasoReembolso {
  id: string;
  caso_id?: string;
  fecha_primer_contacto: string;
  fecha_registro_caso: string;
  canal: string;
  agente: string;
  datos_usuario: {
    nombre_completo: string;
    cedula: string;
    telefono: string;
    numero_cuenta: string;
    tipo_cuenta: string;
  };
  evidencias: {
    captura_historial_operaciones: string;
    captura_billetera_app: string;
    captura_movimientos_bancarios: string;
  };
  estado_caso: string;
  arreglado_sistema?: boolean;
  arreglado_administracion?: boolean;
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

  const loadCasos = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
      const response = await fetch('/api/db?action=getCasosReembolso');
      const data = await response.json();
      if (data.casos) {
        const casosArray: CasoReembolso[] = Object.entries(data.casos).map(([id, caso]: [string, any]) => ({
          id,
          ...caso,
        }));
        casosArray.sort((a, b) => new Date(b.fecha_registro_caso).getTime() - new Date(a.fecha_registro_caso).getTime());
        setCasos(casosArray);
      } else {
        setCasos([]);
      }
    } catch (e) {
      console.error('Error loading casos:', e);
    } finally {
      setLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    loadCasos();
  }, [loadCasos]);

  const getEstadoColor = (estado: string) => {
    switch (estado) {
      case 'pendiente_validacion': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'en_validacion': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'aprobado': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'rechazado': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getEstadoLabel = (estado: string) => {
    switch (estado) {
      case 'pendiente_validacion': return 'Pendiente';
      case 'en_validacion': return 'En Validación';
      case 'aprobado': return 'Aprobado';
      case 'rechazado': return 'Rechazado';
      default: return estado;
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-VE', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // ── Date filter logic ──
  const filterByDate = (caso: CasoReembolso): boolean => {
    if (dateFilter === 'all') return true;
    const casoDate = new Date(caso.fecha_registro_caso);
    const now = new Date();

    if (dateFilter === 'today') {
      return casoDate.toDateString() === now.toDateString();
    }
    if (dateFilter === 'week') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return casoDate >= weekAgo;
    }
    if (dateFilter === 'month') {
      const monthAgo = new Date(now);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return casoDate >= monthAgo;
    }
    if (dateFilter === 'custom') {
      const from = customDateFrom ? new Date(customDateFrom) : new Date(0);
      const to = customDateTo ? new Date(customDateTo + 'T23:59:59') : new Date();
      return casoDate >= from && casoDate <= to;
    }
    return true;
  };

  const dateFilterLabels: Record<DateFilter, string> = {
    all: 'Todas las fechas',
    today: 'Hoy',
    week: 'Última semana',
    month: 'Último mes',
    custom: 'Personalizado',
  };

  // ── Text filter ──
  const casosFiltrados = casos
    .filter(filterByDate)
    .filter(caso =>
      caso.datos_usuario?.nombre_completo?.toLowerCase().includes(filtro.toLowerCase()) ||
      caso.datos_usuario?.cedula?.includes(filtro) ||
      caso.id.includes(filtro) ||
      caso.caso_id?.includes(filtro)
    );

  // ── Delete a case ──
  const handleDelete = async (casoId: string) => {
    if (deletingId) return;
    setDeletingId(casoId);
    try {
      await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteCasoReembolso', chatId: casoId }),
      });
      setCasos(prev => prev.filter(c => c.id !== casoId));
    } catch (e) {
      console.error('Error deleting caso:', e);
    } finally {
      setDeletingId(null);
    }
  };

  // ── Toggle checkbox (arreglado_sistema / arreglado_administracion) ──
  const handleToggleField = async (casoId: string, field: 'arreglado_sistema' | 'arreglado_administracion', currentValue: boolean) => {
    const newValue = !currentValue;
    // Optimistic update
    setCasos(prev => prev.map(c => c.id === casoId ? { ...c, [field]: newValue } : c));
    try {
      await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateCasoReembolso',
          chatId: casoId,
          updates: { [field]: newValue },
        }),
      });
    } catch (e) {
      console.error('Error updating caso:', e);
      // Revert on error
      setCasos(prev => prev.map(c => c.id === casoId ? { ...c, [field]: currentValue } : c));
    }
  };

  // ── Export to Excel (CSV) ──
  const handleExportExcel = () => {
    if (casosFiltrados.length === 0) return;

    const headers = [
      'ID Caso',
      'Fecha Registro',
      'Usuario',
      'Cédula',
      'Teléfono',
      'Cuenta',
      'Tipo Cuenta',
      'Evidencia Historial',
      'Evidencia Billetera',
      'Evidencia Banco',
      'Estado',
      'Arreglado Sistema',
      'Arreglado Administración',
    ];

    const rows = casosFiltrados.map(caso => [
      caso.caso_id || caso.id,
      formatDate(caso.fecha_registro_caso),
      caso.datos_usuario?.nombre_completo || '-',
      caso.datos_usuario?.cedula || '-',
      caso.datos_usuario?.telefono || '-',
      caso.datos_usuario?.numero_cuenta || '-',
      caso.datos_usuario?.tipo_cuenta || '-',
      caso.evidencias?.captura_historial_operaciones ? 'Sí' : 'No',
      caso.evidencias?.captura_billetera_app ? 'Sí' : 'No',
      caso.evidencias?.captura_movimientos_bancarios ? 'Sí' : 'No',
      getEstadoLabel(caso.estado_caso),
      caso.arreglado_sistema ? 'Sí' : 'No',
      caso.arreglado_administracion ? 'Sí' : 'No',
    ]);

    // BOM for UTF-8 Excel compatibility
    const BOM = '\uFEFF';
    const csvContent = BOM + [
      headers.join(';'),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `casos_reembolso_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-[95vw] xl:max-w-7xl mx-4 max-h-[90vh] bg-[#111317] border border-[rgba(37,211,102,0.25)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ boxShadow: '0 0 60px rgba(37,211,102,0.08)' }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-[rgba(37,211,102,0.15)] px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#25d366]/15 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-[#39ff14]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Casos de Reembolso</h2>
              <p className="text-xs text-gray-500">{casos.length} registro{casos.length !== 1 ? 's' : ''} en total</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400 hover:text-white transition-colors" />
          </button>
        </div>

        {/* ── Toolbar: Search + Filters + Export ── */}
        <div className="px-6 py-4 border-b border-[rgba(37,211,102,0.1)] shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="Buscar por nombre, cédula o ID..."
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-[#0a0b0d] text-white text-sm rounded-lg border border-[rgba(255,255,255,0.08)] focus:border-[#25d366]/50 focus:outline-none focus:ring-1 focus:ring-[#25d366]/20 placeholder-gray-600 transition-all"
              />
            </div>

            {/* Date Filter Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowDateDropdown(!showDateDropdown)}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#0a0b0d] border border-[rgba(255,255,255,0.08)] rounded-lg text-sm text-gray-300 hover:border-[#25d366]/30 transition-colors"
              >
                <Calendar className="w-4 h-4 text-[#25d366]" />
                <span>{dateFilterLabels[dateFilter]}</span>
                <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
              </button>
              {showDateDropdown && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-[#1a1d21] border border-[rgba(255,255,255,0.1)] rounded-xl shadow-xl z-50 overflow-hidden">
                  {(Object.keys(dateFilterLabels) as DateFilter[]).map((key) => (
                    <button
                      key={key}
                      onClick={() => { setDateFilter(key); if (key !== 'custom') setShowDateDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                        dateFilter === key 
                          ? 'bg-[#25d366]/15 text-[#25d366]' 
                          : 'text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      {dateFilterLabels[key]}
                    </button>
                  ))}
                  {dateFilter === 'custom' && (
                    <div className="px-4 py-3 border-t border-[rgba(255,255,255,0.05)] flex flex-col gap-2">
                      <input
                        type="date"
                        value={customDateFrom}
                        onChange={(e) => setCustomDateFrom(e.target.value)}
                        className="w-full px-3 py-1.5 bg-[#0d0e10] border border-[rgba(255,255,255,0.1)] rounded-md text-white text-xs focus:outline-none focus:border-[#25d366]/50"
                      />
                      <input
                        type="date"
                        value={customDateTo}
                        onChange={(e) => setCustomDateTo(e.target.value)}
                        className="w-full px-3 py-1.5 bg-[#0d0e10] border border-[rgba(255,255,255,0.1)] rounded-md text-white text-xs focus:outline-none focus:border-[#25d366]/50"
                      />
                      <button
                        onClick={() => setShowDateDropdown(false)}
                        className="w-full py-1.5 bg-[#25d366]/20 text-[#25d366] text-xs rounded-md hover:bg-[#25d366]/30 transition-colors font-medium"
                      >
                        Aplicar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Export Button */}
            <button
              onClick={handleExportExcel}
              disabled={casosFiltrados.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#25d366]/10 hover:bg-[#25d366]/20 border border-[#25d366]/25 rounded-lg text-sm text-[#25d366] transition-all disabled:opacity-30 disabled:cursor-not-allowed font-medium"
            >
              <Download className="w-4 h-4" />
              <span>Exportar Excel</span>
            </button>
          </div>
        </div>

        {/* ── Table ── */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-[#25d366]/30 border-t-[#25d366] rounded-full animate-spin" />
                <p className="text-sm text-gray-500">Cargando casos...</p>
              </div>
            </div>
          ) : casosFiltrados.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center">
                  <AlertCircle className="w-7 h-7 text-gray-600" />
                </div>
                <p className="text-gray-400 font-medium">No hay casos registrados</p>
                <p className="text-xs text-gray-600">Los casos aparecerán aquí cuando los usuarios soliciten reembolsos</p>
              </div>
            </div>
          ) : (
            <div className="px-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#111317] z-10">
                  <tr className="border-b border-[rgba(255,255,255,0.06)]">
                    <th className="text-left px-4 py-3.5 text-xs text-gray-500 font-semibold uppercase tracking-wider">ID</th>
                    <th className="text-left px-4 py-3.5 text-xs text-gray-500 font-semibold uppercase tracking-wider">Fecha</th>
                    <th className="text-left px-4 py-3.5 text-xs text-gray-500 font-semibold uppercase tracking-wider">Usuario</th>
                    <th className="text-left px-4 py-3.5 text-xs text-gray-500 font-semibold uppercase tracking-wider">Cédula</th>
                    <th className="text-left px-4 py-3.5 text-xs text-gray-500 font-semibold uppercase tracking-wider">Teléfono</th>
                    <th className="text-left px-4 py-3.5 text-xs text-gray-500 font-semibold uppercase tracking-wider">Cuenta</th>
                    <th className="text-left px-4 py-3.5 text-xs text-gray-500 font-semibold uppercase tracking-wider">Tipo</th>
                    <th className="text-center px-4 py-3.5 text-xs text-gray-500 font-semibold uppercase tracking-wider">Evidencias</th>
                    <th className="text-center px-4 py-3.5 text-xs text-gray-500 font-semibold uppercase tracking-wider">Estado</th>
                    <th className="text-center px-3 py-3.5 text-xs text-gray-500 font-semibold uppercase tracking-wider whitespace-nowrap">Arr. Sistema</th>
                    <th className="text-center px-3 py-3.5 text-xs text-gray-500 font-semibold uppercase tracking-wider whitespace-nowrap">Arr. Admin</th>
                    <th className="text-center px-3 py-3.5 text-xs text-gray-500 font-semibold uppercase tracking-wider w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {casosFiltrados.map((caso) => (
                    <tr 
                      key={caso.id} 
                      className="border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(37,211,102,0.04)] transition-colors group"
                    >
                      <td className="px-4 py-3.5">
                        <span className="text-[#25d366] font-mono text-xs bg-[#25d366]/8 px-2 py-1 rounded-md">
                          {(caso.caso_id || caso.id).slice(0, 12)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-gray-400 text-xs whitespace-nowrap">{formatDate(caso.fecha_registro_caso)}</td>
                      <td className="px-4 py-3.5">
                        <span className="text-white font-medium">{caso.datos_usuario?.nombre_completo || '-'}</span>
                      </td>
                      <td className="px-4 py-3.5 text-gray-300 font-mono text-xs">{caso.datos_usuario?.cedula || '-'}</td>
                      <td className="px-4 py-3.5 text-gray-300 text-xs">{caso.datos_usuario?.telefono || '-'}</td>
                      <td className="px-4 py-3.5">
                        <span className="text-gray-300 font-mono text-xs">{caso.datos_usuario?.numero_cuenta || '-'}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`text-xs px-2 py-0.5 rounded-md ${
                          caso.datos_usuario?.tipo_cuenta === 'Ahorro' 
                            ? 'bg-cyan-500/10 text-cyan-400' 
                            : 'bg-violet-500/10 text-violet-400'
                        }`}>
                          {caso.datos_usuario?.tipo_cuenta || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-center gap-1.5">
                          <span 
                            className={`w-3 h-3 rounded-full ${caso.evidencias?.captura_historial_operaciones ? 'bg-green-500' : 'bg-gray-700'}`} 
                            title="Historial App"
                          />
                          <span 
                            className={`w-3 h-3 rounded-full ${caso.evidencias?.captura_billetera_app ? 'bg-blue-500' : 'bg-gray-700'}`} 
                            title="Billetera App"
                          />
                          <span 
                            className={`w-3 h-3 rounded-full ${caso.evidencias?.captura_movimientos_bancarios ? 'bg-purple-500' : 'bg-gray-700'}`} 
                            title="Movimientos Bancarios"
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-xs border font-medium ${getEstadoColor(caso.estado_caso)}`}>
                          {getEstadoLabel(caso.estado_caso)}
                        </span>
                      </td>
                      {/* Arreglado por Sistema */}
                      <td className="px-3 py-3.5 text-center">
                        <label className="inline-flex items-center justify-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={caso.arreglado_sistema || false}
                            onChange={() => handleToggleField(caso.id, 'arreglado_sistema', caso.arreglado_sistema || false)}
                            className="sr-only peer"
                          />
                          <div className="w-5 h-5 rounded-md border-2 border-gray-600 peer-checked:border-[#25d366] peer-checked:bg-[#25d366] flex items-center justify-center transition-all">
                            {caso.arreglado_sistema && (
                              <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        </label>
                      </td>
                      {/* Arreglado por Administración */}
                      <td className="px-3 py-3.5 text-center">
                        <label className="inline-flex items-center justify-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={caso.arreglado_administracion || false}
                            onChange={() => handleToggleField(caso.id, 'arreglado_administracion', caso.arreglado_administracion || false)}
                            className="sr-only peer"
                          />
                          <div className="w-5 h-5 rounded-md border-2 border-gray-600 peer-checked:border-orange-400 peer-checked:bg-orange-400 flex items-center justify-center transition-all">
                            {caso.arreglado_administracion && (
                              <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        </label>
                      </td>
                      {/* Delete button */}
                      <td className="px-3 py-3.5 text-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(caso.id); }}
                          disabled={deletingId === caso.id}
                          className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-30"
                          title="Eliminar caso"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Footer summary ── */}
        {!loading && casosFiltrados.length > 0 && (
          <div className="px-6 py-3 border-t border-[rgba(255,255,255,0.05)] shrink-0 flex items-center justify-between text-xs text-gray-500">
            <span>Mostrando {casosFiltrados.length} de {casos.length} casos</span>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Historial
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Billetera
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-500" /> Banco
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}