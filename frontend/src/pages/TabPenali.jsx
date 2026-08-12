import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { ExportMenu } from '../components/ExportMenu'
import { formatEuro, mostraErrore } from '../utils/format'
import { STRUTTURE_HOTEL, thSt, tdSt, inpSt, fmtD } from '../utils/corrispettiviHelpers'

const TIPO_LABEL = { scontrino: 'Scontrino', fattura: 'Fattura' }

export default function TabPenali({ refreshKey }) {
  const [filtri, setFiltri] = useState({ data_da: '', data_a: '', struttura_code: '', numero: '' })
  const [docs, setDocs] = useState([])
  const [totale, setTotale] = useState(0)
  const [totaleImporto, setTotaleImporto] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)

  const PER_PAGE = 50

  const carica = useCallback(async () => {
    setLoading(true)
    setErrore(null)
    try {
      const params = { page, per_page: PER_PAGE, ...filtri }
      Object.keys(params).forEach(k => !params[k] && params[k] !== 0 && delete params[k])
      const { data } = await api.get('/corrispettivi/penali', { params })
      setDocs(data.documenti || [])
      setTotale(data.totale || 0)
      setTotaleImporto(data.totale_importo ?? null)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore caricamento'))
    } finally {
      setLoading(false)
    }
  }, [page, filtri, refreshKey])

  useEffect(() => { carica() }, [carica])

  const totPages = Math.ceil(totale / PER_PAGE)

  const exportParams = new URLSearchParams(filtri)
  Array.from(exportParams.keys()).forEach(k => !exportParams.get(k) && exportParams.delete(k))
  const exportUrl = `/corrispettivi/export/penali?${exportParams.toString()}`

  return (
    <div>
      {/* Filtri */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem', alignItems: 'flex-end' }}>
        {[['data_da', 'Dal', 'date'], ['data_a', 'Al', 'date']].map(([k, l, t]) => (
          <label key={k}>
            <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 3 }}>{l}</span>
            <input type={t} value={filtri[k]} onChange={e => { setFiltri(f => ({ ...f, [k]: e.target.value })); setPage(1) }}
              style={inpSt} />
          </label>
        ))}
        <label>
          <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 3 }}>Struttura</span>
          <select value={filtri.struttura_code} onChange={e => { setFiltri(f => ({ ...f, struttura_code: e.target.value })); setPage(1) }}
            style={inpSt}>
            <option value="">Tutte</option>
            {STRUTTURE_HOTEL.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 3 }}>N. documento</span>
          <input value={filtri.numero} onChange={e => { setFiltri(f => ({ ...f, numero: e.target.value })); setPage(1) }}
            placeholder="es. 1042" style={{ ...inpSt, width: 90 }} />
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.82rem', color: '#64748b', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <span>{loading ? 'Caricamento…' : `${totale} penali trovate`}</span>
        {!loading && totaleImporto !== null && (
          <span style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 5, padding: '2px 10px', color: '#991b1b', fontWeight: 700, fontSize: '0.82rem' }}>
            Totale filtrato: {formatEuro(totaleImporto)}
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          <ExportMenu url={exportUrl} nome="corrispettivi_penali" />
        </span>
      </div>
      {errore && <p style={{ color: '#ef4444', fontSize: '0.85rem' }}>{errore}</p>}

      {!loading && docs.length === 0 && !errore && (
        <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Nessuna penale trovata per i filtri selezionati.</p>
      )}

      {!loading && docs.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: '#1e3a5f', color: '#fff' }}>
                {['Data', 'N. Documento', 'Tipo', 'Struttura', 'Intestatario', 'Importo', 'Ann.'].map(h => (
                  <th key={h} style={{ ...thSt, color: '#fff', ...(h === 'Intestatario' ? { textAlign: 'left' } : {}) }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map((d, idx) => (
                <tr key={d.id} style={{
                  background: d.annullato ? '#fef9f9' : idx % 2 === 0 ? '#fff' : '#f8fafc',
                  opacity: d.annullato ? 0.65 : 1,
                }}>
                  <td style={{ ...tdSt, color: '#475569' }}>{fmtD(d.data_documento)}</td>
                  <td style={tdSt}>{d.numero}{d.suffisso ? <span style={{ color: '#94a3b8' }}> {d.suffisso}</span> : null}</td>
                  <td style={{ ...tdSt, color: '#64748b' }}>{TIPO_LABEL[d.tipo] || d.tipo}</td>
                  <td style={{ ...tdSt, fontWeight: 600 }}>{d.struttura_code}</td>
                  <td style={{ ...tdSt, textAlign: 'left', color: '#334155' }}>{d.intestazione || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                  <td style={{ ...tdSt, color: d.totale_lordo < 0 ? '#ef4444' : '#1e293b', fontWeight: 600 }}>
                    {formatEuro(d.totale_lordo || 0)}
                  </td>
                  <td style={{ ...tdSt, textAlign: 'center', color: d.annullato ? '#ef4444' : '#94a3b8' }}>
                    {d.annullato ? '✗' : ''}
                  </td>
                </tr>
              ))}
              <tr style={{ background: '#f1f5f9', borderTop: '2px solid #cbd5e1' }}>
                <td colSpan={5} style={{ ...tdSt, textAlign: 'right', color: '#475569', fontWeight: 600, fontSize: '0.75rem' }}>
                  Totale pagina ({docs.length} doc.):
                </td>
                <td style={{ ...tdSt, fontWeight: 700, color: '#1e293b' }}>
                  {formatEuro(docs.reduce((s, d) => s + (d.totale_lordo || 0), 0))}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Paginazione */}
      {totPages > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setPage(1)} disabled={page === 1} style={{ ...inpSt, cursor: 'pointer' }}>«</button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ ...inpSt, cursor: 'pointer' }}>‹</button>
          <span style={{ fontSize: '0.82rem', color: '#64748b' }}>Pag. {page} / {totPages}</span>
          <button onClick={() => setPage(p => Math.min(totPages, p + 1))} disabled={page === totPages} style={{ ...inpSt, cursor: 'pointer' }}>›</button>
          <button onClick={() => setPage(totPages)} disabled={page === totPages} style={{ ...inpSt, cursor: 'pointer' }}>»</button>
        </div>
      )}
    </div>
  )
}
