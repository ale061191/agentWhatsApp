'use client';

import { useState, useEffect } from 'react';
import { X, Search, Filter, Download,Clock, User, CreditCard, FileText, AlertCircle } from 'lucide-react';
import { useStore } from '@/store/useStore';

interface CasosReembolsoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CasoReembolso {
  id: string;
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
}

export default function CasosReembolsoModal({ isOpen, onClose }: CasosReembolsoModalProps) {
  const [casos, setCasos] = useState<CasoReembolso[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('');

  useEffect(() => {
    async function loadCasos() {
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
        }
      } catch (e) {
        console.error('Error loading casos:', e);
      } finally {
        setLoading(false);
      }
    }
    loadCasos();
  }, [isOpen]);

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

  const casosFiltrados = casos.filter(caso => 
    caso.datos_usuario?.nombre_completo?.toLowerCase().includes(filtro.toLowerCase()) ||
    caso.datos_usuario?.cedula?.includes(filtro) ||
    caso.id.includes(filtro)
  );

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-5xl mx-4 max-h-[90vh] bg-[#1a1a1a] border border-[rgba(37,211,102,0.3)] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div 
          className="flex items-center justify-between border-b border-[rgba(37,211,102,0.2)] shrink-0"
          style={{ paddingLeft: '15px', paddingTop: '15px', paddingRight: '15px', paddingBottom: '15px' }}
        >
          <div className="flex items-center gap-3">
            <CreditCard className="w-6 h-6 text-[#39ff14]" />
            <h2 className="text-lg font-bold text-white">Casos de Reembolso</h2>
            <span className="text-sm text-gray-400">({casos.length})</span>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-[rgba(255,255,255,0.1)] rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-4 border-b border-[rgba(37,211,102,0.2)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por nombre, cédula o ID..."
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-[#0d0d0d] text-white text-sm rounded-lg border border-[rgba(37,211,102,0.2)] focus:border-[#25d366] focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="text-center py-8 text-gray-500">Cargando casos...</div>
          ) : casosFiltrados.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <AlertCircle className="w-12 h-12 mx-auto mb-3 text-gray-600" />
              <p>No hay casos de reembolso registrados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#1a1a1a] border-b border-[rgba(37,211,102,0.2)]">
                  <tr>
                    <th className="text-left p-3 text-gray-400 font-medium">ID Caso</th>
                    <th className="text-left p-3 text-gray-400 font-medium">Fecha Registro</th>
                    <th className="text-left p-3 text-gray-400 font-medium">Usuario</th>
                    <th className="text-left p-3 text-gray-400 font-medium">Cédula</th>
                    <th className="text-left p-3 text-gray-400 font-medium">Teléfono</th>
                    <th className="text-left p-3 text-gray-400 font-medium">Cuenta</th>
                    <th className="text-left p-3 text-gray-400 font-medium">Tipo</th>
                    <th className="text-left p-3 text-gray-400 font-medium">Evidencias</th>
                    <th className="text-left p-3 text-gray-400 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {casosFiltrados.map((caso) => (
                    <tr key={caso.id} className="border-b border-[rgba(37,211,102,0.1)] hover:bg-[rgba(37,211,102,0.05)]">
                      <td className="p-3 text-white font-mono text-xs">{caso.id.slice(0, 12)}</td>
                      <td className="p-3 text-gray-400 text-xs">{formatDate(caso.fecha_registro_caso)}</td>
                      <td className="p-3 text-white">{caso.datos_usuario?.nombre_completo || '-'}</td>
                      <td className="p-3 text-gray-300">{caso.datos_usuario?.cedula || '-'}</td>
                      <td className="p-3 text-gray-300">{caso.datos_usuario?.telefono || '-'}</td>
                      <td className="p-3 text-gray-300">{caso.datos_usuario?.numero_cuenta || '-'}</td>
                      <td className="p-3 text-gray-300">{caso.datos_usuario?.tipo_cuenta || '-'}</td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          {caso.evidencias?.captura_historial_operaciones && (
                            <span className="w-2 h-2 rounded-full bg-green-500" title="Historial"></span>
                          )}
                          {caso.evidencias?.captura_billetera_app && (
                            <span className="w-2 h-2 rounded-full bg-blue-500" title="Billetera"></span>
                          )}
                          {caso.evidencias?.captura_movimientos_bancarios && (
                            <span className="w-2 h-2 rounded-full bg-purple-500" title="Banco"></span>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded-full text-xs border ${getEstadoColor(caso.estado_caso)}`}>
                          {getEstadoLabel(caso.estado_caso)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}