import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  Legend, ResponsiveContainer, Cell,
} from 'recharts'
import api from '../api/client'
import { formatEuro, mostraErrore } from '../utils/format'
import { STRUTTURE_HOTEL, STRUTTURE_MANUALI, NOMI, NOME_CAT, thSt, tdSt, inpSt } from '../utils/corrispettiviHelpers'

const COLORI_STRUTTURA = {
  DPH: '#1e3a5f', CLB: '#0ea5e9', INT: '#6366f1',
  MMS: '#f59e0b', BON: '#10b981',
}
const COL_HOTEL_TOT  = '#94a3b8'
const COL_RIST_TOT   = '#fbbf24'
const COL_GEN_TOT    = '#334155'

const annoCorrente = new Date().getFullYear()
const meseCorrente = new Date().getMonth() + 1

export default function TabFatturati({ lordo }) {
  const [anno, setAnno] = useState(annoCorrente)
  const [dati, setDati] = useState(null)
  const [datiPag, setDatiPag] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  // drill-down: { sc, mese } oppure null
  const [drillDown, setDrillDown] = useState(null)
  // grafico: 'struttura' | 'gruppo'
  const [vistaGrafico, setVistaGrafico] = useState('struttura')
  // raggruppamento grafico struttura: 'struttura' (mesi dentro ogni struttura) | 'mese' (strutture affiancate per mese)
  const [raggruppaPer, setRaggruppaPer] = useState('struttura')
  const [apriTs, setApriTs] = useState(false)
  const [apriControllo, setApriControllo] = useState(false)

  const carica = useCallback(async () => {
    setLoading(true)
    setErrore(null)
    setDrillDown(null)
    try {
      const [r1, r2] = await Promise.all([
        api.get('/corrispettivi/report/fatturati', { params: { anno, lordo } }),
        api.get('/corrispettivi/report/pagamenti', { params: { anno } }),
      ])
      setDati(r1.data)
      setDatiPag(r2.data)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore nel caricamento'))
    } finally {
      setLoading(false)
    }
  }, [anno, lordo])

  useEffect(() => { carica() }, [carica])

  if (loading) return <p style={{ color: '#94a3b8', padding: '2rem 0' }}>Caricamento…</p>
  if (errore)  return <p style={{ color: '#ef4444' }}>{errore}</p>
  if (!dati)   return null

  const strutture = dati.strutture || []
  const mesi      = dati.mesi || []
  const totAnno   = dati.totale_anno || {}
  const strutHotel = strutture.filter(s => STRUTTURE_HOTEL.includes(s))
  const strutRist  = strutture.filter(s => STRUTTURE_MANUALI.includes(s))

  const fmtV = (v) => (v && v !== 0) ? formatEuro(v) : <span style={{ color: '#cbd5e1' }}>—</span>

  // Toggle cella drill-down
  const toggleDrill = (sc, mese) => {
    if (drillDown && drillDown.sc === sc && drillDown.mese === mese) {
      setDrillDown(null)
    } else {
      setDrillDown({ sc, mese })
    }
  }

  // Dati drill-down correnti
  const drillDati = drillDown
    ? (drillDown.mese === 'totale'
        ? totAnno.per_struttura?.[drillDown.sc]
        : mesi.find(m => m.mese === drillDown.mese)?.per_struttura?.[drillDown.sc])
    : null

  // ── Dati grafico ────────────────────────────────────────────────────────────
  // Vista "per struttura, mesi dentro": un punto per (struttura, mese)
  const datiGraficoPers = strutture.flatMap(s =>
    mesi.map(m => ({
      nome: m.nome_mese.slice(0, 3),
      struttura: s,
      valore: m.per_struttura?.[s]?.totale || 0,
    }))
  )
  // Vista "per mese, strutture affiancate": un punto per mese, una Bar per struttura
  const datiGraficoMese = mesi.map(m => {
    const entry = { nome: m.nome_mese.slice(0, 3) }
    strutture.forEach(s => { entry[s] = m.per_struttura?.[s]?.totale || 0 })
    return entry
  })
  const datiGrafico = vistaGrafico === 'struttura'
    ? (raggruppaPer === 'struttura' ? datiGraficoPers : datiGraficoMese)
    : mesi.map(m => ({ nome: m.nome_mese.slice(0, 3), Hotel: m.totale_hotel || 0, Ristoranti: m.totale_ristoranti || 0 }))

  const stileColonnaTot = {
    background: '#f1f5f9', fontWeight: 600,
  }

  return (
    <div>
      {/* Selettore anno */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 600 }}>Anno:</label>
          <select value={anno} onChange={e => setAnno(Number(e.target.value))}
            style={{ ...inpSt, padding: '5px 10px' }}>
            {[2024, 2025, 2026, 2027].map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        {mesi.length > 0 && (
          <>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              {mesi.length} {mesi.length === 1 ? 'mese' : 'mesi'} con dati
            </span>
            <button onClick={async () => {
              try {
                const res = await api.get('/corrispettivi/export/fatturati', {
                  params: { anno, lordo },
                  responseType: 'blob',
                })
                const url = URL.createObjectURL(res.data)
                const a = document.createElement('a')
                a.href = url
                a.download = `corrispettivi_fatturati_${anno}.xlsx`
                a.click()
                URL.revokeObjectURL(url)
              } catch (e) {
                alert(mostraErrore(e, 'Errore export'))
              }
            }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 6, background: '#16a34a', color: '#fff', fontWeight: 600, fontSize: '0.82rem', border: 'none', cursor: 'pointer' }}>
              ⬇ Esporta Excel
            </button>
          </>
        )}
      </div>

      {mesi.length === 0 ? (
        <p style={{ color: '#94a3b8', fontStyle: 'italic' }}>Nessun dato per l'anno {anno}.</p>
      ) : (
        <>
          {/* ── Tabella principale ─────────────────────────────────────────── */}
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', color: '#1e293b', fontWeight: 700, letterSpacing: '0.02em' }}>
            Totale Corrispettivi
          </h3>
          <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
            <table style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th style={{ ...thSt, textAlign: 'left', minWidth: 90 }}>Mese</th>
                  {strutHotel.map(s => (
                    <th key={s} style={{ ...thSt, color: '#fff', background: COLORI_STRUTTURA[s] }}>{s}</th>
                  ))}
                  {strutHotel.length > 0 && (
                    <th style={{ ...thSt, background: '#475569', color: '#fff' }}>Tot. Hotel</th>
                  )}
                  {strutRist.map(s => (
                    <th key={s} style={{ ...thSt, color: '#fff', background: COLORI_STRUTTURA[s] }}>{s}</th>
                  ))}
                  {strutRist.length > 0 && (
                    <th style={{ ...thSt, background: '#78350f', color: '#fff' }}>Tot. Rist.</th>
                  )}
                  <th style={{ ...thSt, background: '#1e293b', color: '#fff' }}>TOTALE</th>
                </tr>
              </thead>
              <tbody>
                {mesi.map(m => {
                  const isMeseCorrente = anno === annoCorrente && m.mese === meseCorrente
                  const rowBg = isMeseCorrente ? '#eff6ff' : undefined
                  return (
                    <tr key={m.mese} style={rowBg ? { background: rowBg } : undefined}>
                      <td style={{ ...tdSt, textAlign: 'left', fontWeight: isMeseCorrente ? 700 : 400, background: rowBg, color: isMeseCorrente ? '#1d4ed8' : undefined }}>
                        {m.nome_mese}
                        {isMeseCorrente && <span style={{ marginLeft: 5, fontSize: '0.7rem', background: '#dbeafe', color: '#1d4ed8', padding: '1px 5px', borderRadius: 4, verticalAlign: 'middle' }}>▶</span>}
                      </td>
                      {strutHotel.map(s => {
                        const val = m.per_struttura?.[s]?.totale
                        const attivo = drillDown?.sc === s && drillDown?.mese === m.mese
                        return (
                          <td key={s} onClick={() => toggleDrill(s, m.mese)}
                            style={{ ...tdSt, background: attivo ? '#dbeafe' : rowBg, cursor: 'pointer', borderBottom: attivo ? '2px solid #3b82f6' : undefined }}>
                            {fmtV(val)}
                          </td>
                        )
                      })}
                      {strutHotel.length > 0 && (
                        <td style={{ ...tdSt, ...stileColonnaTot, background: rowBg || stileColonnaTot.background }}>
                          {fmtV(m.totale_hotel)}
                        </td>
                      )}
                      {strutRist.map(s => {
                        const val = m.per_struttura?.[s]?.totale
                        const attivo = drillDown?.sc === s && drillDown?.mese === m.mese
                        return (
                          <td key={s} onClick={() => toggleDrill(s, m.mese)}
                            style={{ ...tdSt, background: attivo ? '#fef9c3' : rowBg, cursor: 'pointer', borderBottom: attivo ? '2px solid #eab308' : undefined }}>
                            {fmtV(val)}
                          </td>
                        )
                      })}
                      {strutRist.length > 0 && (
                        <td style={{ ...tdSt, ...stileColonnaTot, background: rowBg || stileColonnaTot.background }}>
                          {fmtV(m.totale_ristoranti)}
                        </td>
                      )}
                      <td style={{ ...tdSt, fontWeight: 700, background: rowBg || '#f8fafc' }}>
                        {fmtV(m.totale_generale)}
                      </td>
                    </tr>
                  )
                })}

                {/* Riga TOTALE ANNO */}
                <tr className="riga-totale">
                  <td style={{ ...tdSt, textAlign: 'left', background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>TOTALE ANNO</td>
                  {strutHotel.map(s => {
                    const attivo = drillDown?.sc === s && drillDown?.mese === 'totale'
                    return (
                      <td key={s} onClick={() => toggleDrill(s, 'totale')}
                        style={{ background: attivo ? '#1d4ed8' : '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {formatEuro(totAnno.per_struttura?.[s]?.totale || 0)}
                      </td>
                    )
                  })}
                  {strutHotel.length > 0 && (
                    <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right' }}>
                      {formatEuro(totAnno.totale_hotel || 0)}
                    </td>
                  )}
                  {strutRist.map(s => {
                    const attivo = drillDown?.sc === s && drillDown?.mese === 'totale'
                    return (
                      <td key={s} onClick={() => toggleDrill(s, 'totale')}
                        style={{ background: attivo ? '#1d4ed8' : '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {formatEuro(totAnno.per_struttura?.[s]?.totale || 0)}
                      </td>
                    )
                  })}
                  {strutRist.length > 0 && (
                    <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right' }}>
                      {formatEuro(totAnno.totale_ristoranti || 0)}
                    </td>
                  )}
                  <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 800, textAlign: 'right' }}>
                    {formatEuro(totAnno.totale_generale || 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Drill-down categorie ───────────────────────────────────────── */}
          {drillDown && drillDati && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.5rem', maxWidth: 480 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#1e293b' }}>
                  <span style={{ color: COLORI_STRUTTURA[drillDown.sc] || '#1e3a5f', fontWeight: 700 }}>{drillDown.sc}</span>
                  {' — '}
                  {drillDown.mese === 'totale' ? 'Totale Anno' : (mesi.find(m => m.mese === drillDown.mese)?.nome_mese || '')}
                </h4>
                <button onClick={() => setDrillDown(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.1rem', padding: '0 4px' }}>✕</button>
              </div>
              <table style={{ width: '100%' }}>
                <tbody>
                  {['arrangiamenti', 'penali', 'shop', 'altro'].map(cat => {
                    const v = drillDati[cat] || 0
                    if (v === 0) return null
                    return (
                      <tr key={cat}>
                        <td style={{ ...tdSt, textAlign: 'left', color: '#475569' }}>{NOME_CAT[cat]}</td>
                        <td style={{ ...tdSt, fontWeight: 600 }}>{formatEuro(v)}</td>
                      </tr>
                    )
                  })}
                  <tr style={{ borderTop: '2px solid #e2e8f0' }}>
                    <td style={{ ...tdSt, textAlign: 'left', fontWeight: 700 }}>Totale ricavi</td>
                    <td style={{ ...tdSt, fontWeight: 700 }}>{formatEuro(drillDati.totale || 0)}</td>
                  </tr>
                  {(drillDati.tassa_soggiorno || 0) > 0 && (
                    <tr>
                      <td style={{ ...tdSt, textAlign: 'left', color: '#94a3b8', fontStyle: 'italic', fontSize: '0.75rem' }}>
                        Tassa soggiorno (transito, esclusa dal totale)
                      </td>
                      <td style={{ ...tdSt, color: '#94a3b8', fontStyle: 'italic', fontSize: '0.75rem' }}>
                        {formatEuro(drillDati.tassa_soggiorno)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Tabella Tassa di Soggiorno ─────────────────────────────────── */}
          {strutHotel.length > 0 && (
            <>
              <h3 onClick={() => setApriTs(v => !v)}
                style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', color: '#1e293b', fontWeight: 700, letterSpacing: '0.02em', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{apriTs ? '▾' : '▸'}</span>
                Totale Tassa di Soggiorno
                <span style={{ marginLeft: 4, fontSize: '0.75rem', color: '#94a3b8', fontWeight: 400, fontStyle: 'italic' }}>
                  (transito Comune — esclusa dal corrispettivo)
                </span>
              </h3>
              {apriTs && (
                <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
                  <table style={{ minWidth: 500 }}>
                    <thead>
                      <tr>
                        <th style={{ ...thSt, textAlign: 'left', minWidth: 90 }}>Mese</th>
                        {strutHotel.map(s => (
                          <th key={s} style={{ ...thSt, color: '#fff', background: COLORI_STRUTTURA[s] }}>{s}</th>
                        ))}
                        <th style={{ ...thSt, background: '#475569', color: '#fff' }}>Tot. Hotel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mesi.map(m => {
                        const isMeseCorrente = anno === annoCorrente && m.mese === meseCorrente
                        const rowBg = isMeseCorrente ? '#eff6ff' : undefined
                        const totTs = strutHotel.reduce((acc, s) => acc + (m.per_struttura?.[s]?.tassa_soggiorno || 0), 0)
                        return (
                          <tr key={m.mese} style={rowBg ? { background: rowBg } : undefined}>
                            <td style={{ ...tdSt, textAlign: 'left', fontWeight: isMeseCorrente ? 700 : 400, background: rowBg, color: isMeseCorrente ? '#1d4ed8' : undefined }}>
                              {m.nome_mese}
                              {isMeseCorrente && <span style={{ marginLeft: 5, fontSize: '0.7rem', background: '#dbeafe', color: '#1d4ed8', padding: '1px 5px', borderRadius: 4, verticalAlign: 'middle' }}>▶</span>}
                            </td>
                            {strutHotel.map(s => (
                              <td key={s} style={{ ...tdSt, background: rowBg }}>
                                {fmtV(m.per_struttura?.[s]?.tassa_soggiorno)}
                              </td>
                            ))}
                            <td style={{ ...tdSt, ...stileColonnaTot, background: rowBg || stileColonnaTot.background }}>
                              {fmtV(totTs)}
                            </td>
                          </tr>
                        )
                      })}
                      <tr className="riga-totale">
                        <td style={{ ...tdSt, textAlign: 'left', background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>TOTALE ANNO</td>
                        {strutHotel.map(s => (
                          <td key={s} style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {formatEuro(totAnno.per_struttura?.[s]?.tassa_soggiorno || 0)}
                          </td>
                        ))}
                        <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 800, textAlign: 'right' }}>
                          {formatEuro(strutHotel.reduce((acc, s) => acc + (totAnno.per_struttura?.[s]?.tassa_soggiorno || 0), 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Riepilogo di controllo ──────────────────────────────────────── */}
              <h3 onClick={() => setApriControllo(v => !v)}
                style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', color: '#1e293b', fontWeight: 700, letterSpacing: '0.02em', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{apriControllo ? '▾' : '▸'}</span>
                Riepilogo di controllo
                <span style={{ marginLeft: 4, fontSize: '0.75rem', color: '#94a3b8', fontWeight: 400, fontStyle: 'italic' }}>
                  (il Totale Lordo deve coincidere con i corrispettivi giornalieri)
                </span>
              </h3>
              {apriControllo && (
                <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
                  <table style={{ minWidth: 420 }}>
                    <thead>
                      <tr>
                        <th style={{ ...thSt, textAlign: 'left', minWidth: 90 }}>Mese</th>
                        <th style={{ ...thSt, background: '#334155', color: '#fff' }}>Corrispettivo</th>
                        <th style={{ ...thSt, background: '#0f766e', color: '#fff' }}>+ Tassa Soggiorno</th>
                        <th style={{ ...thSt, background: '#1e3a5f', color: '#fff' }}>= Totale Lordo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mesi.map(m => {
                        const isMeseCorrente = anno === annoCorrente && m.mese === meseCorrente
                        const rowBg = isMeseCorrente ? '#eff6ff' : undefined
                        const tsGenerale = strutture.reduce((acc, s) => acc + (m.per_struttura?.[s]?.tassa_soggiorno || 0), 0)
                        const totLordo = (m.totale_generale || 0) + tsGenerale
                        return (
                          <tr key={m.mese} style={rowBg ? { background: rowBg } : undefined}>
                            <td style={{ ...tdSt, textAlign: 'left', fontWeight: isMeseCorrente ? 700 : 400, background: rowBg, color: isMeseCorrente ? '#1d4ed8' : undefined }}>
                              {m.nome_mese}
                              {isMeseCorrente && <span style={{ marginLeft: 5, fontSize: '0.7rem', background: '#dbeafe', color: '#1d4ed8', padding: '1px 5px', borderRadius: 4, verticalAlign: 'middle' }}>▶</span>}
                            </td>
                            <td style={{ ...tdSt, background: rowBg }}>{formatEuro(m.totale_generale || 0)}</td>
                            <td style={{ ...tdSt, background: rowBg, color: '#0f766e', fontWeight: 500 }}>{fmtV(tsGenerale)}</td>
                            <td style={{ ...tdSt, background: rowBg, fontWeight: 700 }}>{formatEuro(totLordo)}</td>
                          </tr>
                        )
                      })}
                      <tr className="riga-totale">
                        <td style={{ ...tdSt, textAlign: 'left', background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>TOTALE ANNO</td>
                        <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right' }}>
                          {formatEuro(totAnno.totale_generale || 0)}
                        </td>
                        <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right' }}>
                          {formatEuro(strutture.reduce((acc, s) => acc + (totAnno.per_struttura?.[s]?.tassa_soggiorno || 0), 0))}
                        </td>
                        <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 800, textAlign: 'right' }}>
                          {formatEuro(
                            (totAnno.totale_generale || 0) +
                            strutture.reduce((acc, s) => acc + (totAnno.per_struttura?.[s]?.tassa_soggiorno || 0), 0)
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── Tabella tipi di pagamento ──────────────────────────────────── */}
          {datiPag && datiPag.tipi?.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem', color: '#1e293b', fontWeight: 700 }}>
                Forme di pagamento {anno}
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 500 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thSt, textAlign: 'left', minWidth: 140 }}>Tipo pagamento</th>
                      {datiPag.mesi.map(m => (
                        <th key={m.mese} style={{ ...thSt }}>{m.nome_mese.slice(0, 3)}</th>
                      ))}
                      <th style={{ ...thSt, background: '#1e293b' }}>TOTALE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datiPag.tipi.map((tipo, idx) => {
                      const isSpeciale = tipo === 'Caparra' || tipo === 'Sospeso' || tipo === 'MMS / BON (manuale)'
                      const bgBase = idx % 2 === 0 ? '#fff' : '#f8fafc'
                      const borderTop = isSpeciale ? '1px solid #e2e8f0' : undefined
                      return (
                      <tr key={tipo} style={{ background: bgBase, borderTop }}>
                        <td style={{ ...tdSt, textAlign: 'left', background: bgBase, fontWeight: isSpeciale ? 600 : 500, color: isSpeciale ? '#64748b' : '#374151', fontStyle: isSpeciale ? 'italic' : undefined }}>{tipo}</td>
                        {datiPag.mesi.map(m => {
                          const v = datiPag.per_tipo[tipo]?.[String(m.mese)] || 0
                          return (
                            <td key={m.mese} style={{ ...tdSt, background: bgBase }}>
                              {v ? formatEuro(v) : <span style={{ color: '#e2e8f0' }}>—</span>}
                            </td>
                          )
                        })}
                        <td style={{ ...tdSt, fontWeight: 700, background: idx % 2 === 0 ? '#f1f5f9' : '#e8edf3' }}>
                          {formatEuro(datiPag.totale_anno[tipo] || 0)}
                        </td>
                      </tr>
                    )})}
                    {/* Riga totale */}
                    <tr className="riga-totale">
                      <td style={{ ...tdSt, textAlign: 'left', background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>TOTALE</td>
                      {datiPag.mesi.map(m => (
                        <td key={m.mese} style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {formatEuro(datiPag.totale_mese[String(m.mese)] || 0)}
                        </td>
                      ))}
                      <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 800, textAlign: 'right' }}>
                        {formatEuro(Object.values(datiPag.totale_anno).reduce((a, v) => a + v, 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Grafico ────────────────────────────────────────────────────── */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#1e293b', fontWeight: 700 }}>
                Fatturato mensile {anno}
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                {vistaGrafico === 'struttura' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: '#64748b', cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={raggruppaPer === 'struttura'}
                      onChange={e => setRaggruppaPer(e.target.checked ? 'struttura' : 'mese')}
                      style={{ cursor: 'pointer' }} />
                    Raggruppa per struttura
                  </label>
                )}
                <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 7, padding: '3px 4px', gap: 2 }}>
                  {[
                    { id: 'struttura', label: 'Per struttura' },
                    { id: 'gruppo', label: 'Hotel vs Ristoranti' },
                  ].map(v => (
                    <button key={v.id} onClick={() => setVistaGrafico(v.id)}
                      style={{
                        padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
                        fontSize: '0.78rem', fontWeight: vistaGrafico === v.id ? 700 : 400,
                        background: vistaGrafico === v.id ? '#1e3a5f' : 'transparent',
                        color: vistaGrafico === v.id ? '#fff' : '#64748b',
                      }}>{v.label}</button>
                  ))}
                </div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={datiGrafico} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                {vistaGrafico === 'struttura' && raggruppaPer === 'struttura' ? (
                  <XAxis dataKey="nome" height={42}
                    tick={(props) => {
                      const { x, y, payload, index } = props
                      const nMesi = mesi.length
                      const sIdx = Math.floor(index / nMesi)
                      const mIdx = index % nMesi
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <text x={0} dy={14} textAnchor="middle" fill="#64748b" fontSize={10}>{payload.value}</text>
                        </g>
                      )
                    }}
                  />
                ) : (
                  <XAxis dataKey="nome" tick={{ fontSize: 11, fill: '#64748b' }} />
                )}
                <YAxis tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                  tick={{ fontSize: 11, fill: '#64748b' }} />
                {vistaGrafico === 'struttura' && raggruppaPer === 'struttura' ? (
                  <ReTooltip formatter={(v, _n, props) => [formatEuro(v), NOMI[props.payload?.struttura] || props.payload?.struttura]} />
                ) : (
                  <ReTooltip formatter={(v, name) => [formatEuro(v), name]} />
                )}
                {vistaGrafico === 'struttura' && raggruppaPer === 'struttura' ? (
                  <Bar dataKey="valore" radius={[3, 3, 0, 0]}>
                    {datiGraficoPers.map((entry, i) => (
                      <Cell key={i} fill={COLORI_STRUTTURA[entry.struttura] || '#94a3b8'} />
                    ))}
                  </Bar>
                ) : vistaGrafico === 'struttura' ? (
                  <>
                    <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
                    {strutture.map(s => (
                      <Bar key={s} dataKey={s} name={NOMI[s] || s}
                        fill={COLORI_STRUTTURA[s] || '#94a3b8'} radius={[3, 3, 0, 0]} />
                    ))}
                  </>
                ) : (
                  <>
                    <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
                    <Bar key="Hotel" dataKey="Hotel" name="Hotel" fill={COL_HOTEL_TOT} radius={[3, 3, 0, 0]} />
                    <Bar key="Ristoranti" dataKey="Ristoranti" name="Ristoranti" fill={COL_RIST_TOT} radius={[3, 3, 0, 0]} />
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
            {vistaGrafico === 'struttura' && raggruppaPer === 'struttura' && (
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                {strutture.map(s => (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: COLORI_STRUTTURA[s] || '#94a3b8', display: 'inline-block' }} />
                    <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{NOMI[s] || s}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
