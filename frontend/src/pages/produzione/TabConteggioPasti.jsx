import { Fragment, useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { STRUTTURE_HOTEL, NOMI, meseNome, thSt, tdSt, inpSt } from '../../utils/produzioneHelpers'

const SOTTOCOLONNE = ['colazione', 'pranzo', 'cena']
const LABEL_SOTTOCOLONNA = { colazione: 'Colazione', pranzo: 'Pranzo', cena: 'Cena' }

// Colazione = trattamento + extra sommati (numero pasti serviti); il dettaglio si vede
// espandendo la colonna. Pranzo/Cena non hanno sotto-categorie da espandere.
function colazioneTotale(agg) {
  return (agg?.colazione || 0) + (agg?.colazione_extra || 0)
}
function valoreSotto(agg, code) {
  return code === 'colazione' ? colazioneTotale(agg) : (agg?.[code] || 0)
}

export default function TabConteggioPasti() {
  const oggi = new Date()
  const [anno, setAnno] = useState(oggi.getFullYear())
  const [struttura, setStruttura] = useState('')
  const [dati, setDati] = useState(null)
  const [loading, setLoading] = useState(false)
  const [espanso, setEspanso] = useState(null) // `${mese}_${sc}` oppure null (dettaglio colazione)

  const strutture = struttura ? [struttura] : STRUTTURE_HOTEL
  const totColonne = 2 + strutture.length * SOTTOCOLONNE.length

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/produzione/report/conteggio-pasti', {
        params: { anno, struttura_code: struttura || undefined },
      })
      setDati(data)
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [anno, struttura])

  useEffect(() => { carica() }, [carica])

  const selSt = { ...inpSt, fontSize: '0.82rem' }
  const bordoGruppo = '3px solid #4a6fa5'
  const bordoSotto = '1px solid #3d6a9a'

  const totaleAnnoSotto = (sc, code) => dati.mesi.reduce((s, mo) => s + valoreSotto(mo.per_struttura[sc], code), 0)

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
        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Clicca su Colazione per il dettaglio trattamento/extra</span>
      </div>

      {loading && <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Caricamento…</p>}

      {dati && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
            <thead>
              {/* Riga 1: strutture */}
              <tr style={{ background: '#1e3a5f', color: '#fff' }}>
                <th style={{ ...thSt, textAlign: 'left' }} rowSpan={2}>Mese</th>
                {strutture.map(sc => (
                  <th key={sc} style={{ ...thSt, borderLeft: bordoGruppo }} colSpan={SOTTOCOLONNE.length}>{NOMI[sc]}</th>
                ))}
                <th style={{ ...thSt, borderLeft: bordoGruppo }} rowSpan={2}>Totale pasti</th>
              </tr>
              {/* Riga 2: colazione/pranzo/cena */}
              <tr style={{ background: '#2d4f7c', color: '#cbd5e1' }}>
                {strutture.map(sc => (
                  SOTTOCOLONNE.map((code, i) => (
                    <th key={`${sc}_${code}`} style={{
                      ...thSt, color: '#cbd5e1', fontSize: '0.75rem', fontWeight: 400,
                      borderLeft: i === 0 ? bordoGruppo : bordoSotto,
                    }}>{LABEL_SOTTOCOLONNA[code]}</th>
                  ))
                ))}
              </tr>
            </thead>
            <tbody>
              {dati.mesi.map((mo, idx) => (
                <Fragment key={mo.mese}>
                  <tr style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                    <td style={{ ...tdSt, textAlign: 'left', fontWeight: 600 }}>{meseNome(mo.mese)}</td>
                    {strutture.map(sc => {
                      const agg = mo.per_struttura[sc]
                      const chiave = `${mo.mese}_${sc}`
                      return SOTTOCOLONNE.map((code, i) => {
                        const v = valoreSotto(agg, code)
                        const cliccabile = code === 'colazione' && v > 0
                        return (
                          <td key={`${sc}_${code}`} style={{
                            ...tdSt, borderLeft: i === 0 ? bordoGruppo : bordoSotto,
                            cursor: cliccabile ? 'pointer' : 'default',
                            color: v ? '#1e293b' : '#e2e8f0',
                            textDecoration: cliccabile ? 'underline dotted' : 'none',
                          }}
                            onClick={() => cliccabile && setEspanso(espanso === chiave ? null : chiave)}
                            title={cliccabile ? 'Clicca per il dettaglio trattamento/extra' : undefined}
                          >
                            {v || '—'}
                          </td>
                        )
                      })
                    })}
                    <td style={{ ...tdSt, fontWeight: 700, borderLeft: bordoGruppo }}>{mo.totale.totale || 0}</td>
                  </tr>
                  {strutture.map(sc => {
                    const chiave = `${mo.mese}_${sc}`
                    if (espanso !== chiave) return null
                    const agg = mo.per_struttura[sc] || {}
                    return (
                      <tr key={chiave}>
                        <td colSpan={totColonne} style={{ padding: '0.5rem 1rem 0.75rem 2rem', background: '#eff6ff' }}>
                          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                            <span style={{ color: '#64748b' }}>{NOMI[sc]} — {meseNome(mo.mese)}:</span>
                            <div><span style={{ color: '#64748b' }}>Colazione trattamento: </span><strong>{agg.colazione || 0}</strong></div>
                            <div><span style={{ color: '#64748b' }}>Colazione extra: </span><strong>{agg.colazione_extra || 0}</strong></div>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
              <tr style={{ background: '#1e3a5f', color: '#fff', fontWeight: 800 }}>
                <td style={{ ...tdSt, background: '#1e3a5f', color: '#fff', textAlign: 'left', borderBottom: 'none' }}>ANNO</td>
                {strutture.map(sc => (
                  SOTTOCOLONNE.map((code, i) => (
                    <td key={`tot_${sc}_${code}`} style={{
                      ...tdSt, background: '#1e3a5f', color: '#fff', borderBottom: 'none',
                      borderLeft: i === 0 ? bordoGruppo : bordoSotto,
                    }}>
                      {totaleAnnoSotto(sc, code) || 0}
                    </td>
                  ))
                ))}
                <td style={{ ...tdSt, background: '#1e3a5f', color: '#fff', borderBottom: 'none', borderLeft: bordoGruppo }}>
                  {dati.totale_anno.totale || 0}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
