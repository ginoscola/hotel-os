import { Fragment, useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { formatEuro } from '../../utils/format'
import { ExportMenu } from '../../components/ExportMenu.jsx'
import { STRUTTURE_HOTEL, NOMI, meseNome, thSt, tdSt, inpSt, campoValore } from '../../utils/produzioneHelpers'

export default function TabReportMensile({ lordo }) {
  const oggi = new Date()
  const [anno, setAnno] = useState(oggi.getFullYear())
  const [struttura, setStruttura] = useState('')
  const [dati, setDati] = useState(null)
  const [loading, setLoading] = useState(false)
  const [espanso, setEspanso] = useState(null) // `${mese}_${sc}` oppure null

  const strutture = struttura ? [struttura] : STRUTTURE_HOTEL

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/produzione/report/mensile', {
        params: { anno, struttura_code: struttura || undefined },
      })
      setDati(data)
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [anno, struttura])

  useEffect(() => { carica() }, [carica])

  const selSt = { ...inpSt, fontSize: '0.82rem' }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <button onClick={() => setAnno(a => a - 1)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9' }}>←</button>
        <span style={{ fontWeight: 700, minWidth: 60, textAlign: 'center' }}>{anno}</span>
        <button onClick={() => setAnno(a => a + 1)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9' }}>→</button>
        <select value={struttura} onChange={e => setStruttura(e.target.value)} style={selSt}>
          <option value="">Tutte le strutture</option>
          {STRUTTURE_HOTEL.map(sc => <option key={sc} value={sc}>{NOMI[sc]}</option>)}
        </select>
        <div style={{ marginLeft: 'auto' }}>
          <ExportMenu url={`/produzione/export/mensile?anno=${anno}${struttura ? `&struttura_code=${struttura}` : ''}`}
            nome={`produzione_mensile_${anno}`} />
        </div>
      </div>

      {loading && <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Caricamento…</p>}

      {dati && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#1e3a5f', color: '#fff' }}>
                <th style={{ ...thSt, textAlign: 'left' }}>Mese</th>
                {strutture.map(sc => <th key={sc} style={thSt}>{NOMI[sc]}</th>)}
                <th style={thSt}>Totale</th>
              </tr>
            </thead>
            <tbody>
              {dati.mesi.map((mo, idx) => (
                <Fragment key={mo.mese}>
                  <tr style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                    <td style={{ ...tdSt, textAlign: 'left', fontWeight: 600 }}>{meseNome(mo.mese)}</td>
                    {strutture.map(sc => {
                      const v = campoValore(mo.per_struttura[sc]?.totale, lordo)
                      const chiave = `${mo.mese}_${sc}`
                      return (
                        <td key={sc} style={{ ...tdSt, cursor: v ? 'pointer' : 'default', color: v ? '#1e293b' : '#e2e8f0' }}
                          onClick={() => v && setEspanso(espanso === chiave ? null : chiave)}>
                          {v ? formatEuro(v) : '—'}
                        </td>
                      )
                    })}
                    <td style={{ ...tdSt, fontWeight: 700 }}>{formatEuro(campoValore(mo.totale, lordo))}</td>
                  </tr>
                  {strutture.map(sc => {
                    const chiave = `${mo.mese}_${sc}`
                    if (espanso !== chiave) return null
                    const perCat = mo.per_struttura[sc]?.per_categoria || {}
                    return (
                      <tr key={chiave}>
                        <td colSpan={strutture.length + 2} style={{ padding: '0.5rem 1rem 0.75rem 2rem', background: '#eff6ff' }}>
                          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                            {Object.entries(perCat).map(([code, agg]) => (
                              <div key={code}>
                                <span style={{ color: '#64748b' }}>{code}: </span>
                                <strong>{formatEuro(campoValore(agg, lordo))}</strong>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
              {/* background su ogni <td>, non solo sulla <tr>: vedi nota in TabGiornaliera.jsx —
                  qui la parità della riga dipende da quante righe "espanso" sono aperte. */}
              <tr style={{ background: '#1e3a5f', color: '#fff', fontWeight: 800 }}>
                <td style={{ ...tdSt, background: '#1e3a5f', color: '#fff', textAlign: 'left', borderBottom: 'none' }}>ANNO</td>
                {strutture.map(sc => (
                  <td key={sc} style={{ ...tdSt, background: '#1e3a5f', color: '#fff', borderBottom: 'none' }}>
                    {formatEuro(dati.mesi.reduce((s, mo) => s + campoValore(mo.per_struttura[sc]?.totale, lordo), 0))}
                  </td>
                ))}
                <td style={{ ...tdSt, background: '#1e3a5f', color: '#fff', borderBottom: 'none' }}>{formatEuro(campoValore(dati.totale_anno, lordo))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
