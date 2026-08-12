import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { formatEuro, mostraErrore } from '../utils/format'
import { meseNome, meseAnnoPrecedente, thSt, tdSt, inpSt, campoValore } from '../utils/produzioneHelpers'

const LS_LORDO = 'usali_movimenti_lordo'

const STRUTTURE = [
  { code: 'DPH', label: 'Du Parc' },
  { code: 'CLB', label: 'Club Hotel' },
  { code: 'INT', label: 'International' },
  { code: 'BON', label: 'Buona Onda' },
]

const LS_STRUTTURA = 'usali_movimenti_struttura'

export default function UsaliMovimentiAttivi() {
  const def = meseAnnoPrecedente()
  const [struttura, setStruttura] = useState(() => localStorage.getItem(LS_STRUTTURA) || 'DPH')
  const [anno, setAnno] = useState(def.anno)
  const [mese, setMese] = useState(def.mese)
  const [righe, setRighe] = useState([])
  const [totaleImponibile, setTotaleImponibile] = useState(0)
  const [totaleLordo, setTotaleLordo] = useState(0)
  const [lordo, setLordo] = useState(() => localStorage.getItem(LS_LORDO) === 'true')
  const [loading, setLoading] = useState(false)
  const [modifiche, setModifiche] = useState({}) // riga_code → valore in edit
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState(null)

  const cambiaStruttura = (sc) => {
    setStruttura(sc)
    localStorage.setItem(LS_STRUTTURA, sc)
  }

  const cambiaLordo = (v) => {
    setLordo(v)
    localStorage.setItem(LS_LORDO, String(v))
  }

  const carica = useCallback(async () => {
    setLoading(true)
    setModifiche({})
    try {
      const { data } = await api.get('/usali/movimenti-attivi', { params: { struttura, anno, mese } })
      setRighe(data.righe)
      setTotaleImponibile(data.totale_imponibile)
      setTotaleLordo(data.totale_lordo)
    } catch (e) {
      setMsg({ tipo: 'err', testo: mostraErrore(e) })
    } finally {
      setLoading(false)
    }
  }, [struttura, anno, mese])

  useEffect(() => { carica() }, [carica])

  const navMese = (delta) => {
    let m = mese + delta, y = anno
    if (m > 12) { m = 1; y++ }
    if (m < 1) { m = 12; y-- }
    setMese(m); setAnno(y)
  }

  const valoreVisualizzato = (r) => modifiche[r.riga_code] ?? String(r.imponibile)

  const confermaModifiche = async () => {
    const daSalvare = Object.entries(modifiche)
    if (daSalvare.length === 0) return
    setSalvando(true)
    setMsg(null)
    try {
      for (const [riga_code, valore] of daSalvare) {
        const num = parseFloat(String(valore).replace(',', '.'))
        await api.put('/usali/movimenti-attivi', {
          struttura, anno, mese, riga_code, imponibile: isNaN(num) ? 0 : num,
        })
      }
      setMsg({ tipo: 'ok', testo: 'Valori salvati.' })
      carica()
    } catch (e) {
      setMsg({ tipo: 'err', testo: mostraErrore(e) })
    } finally {
      setSalvando(false)
    }
  }

  // Raggruppa per Reparto, preservando l'ordine di arrivo dal backend
  const gruppi = []
  for (const r of righe) {
    let g = gruppi.find(x => x.reparto === r.reparto)
    if (!g) { g = { reparto: r.reparto, righe: [] }; gruppi.push(g) }
    g.righe.push(r)
  }

  const nModifiche = Object.keys(modifiche).length

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: '1rem' }}>
        {STRUTTURE.map(s => (
          <button key={s.code} onClick={() => cambiaStruttura(s.code)} style={{
            padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: '0.85rem',
            fontWeight: struttura === s.code ? 700 : 400,
            background: struttura === s.code ? '#1e3a5f' : '#f1f5f9',
            color: struttura === s.code ? '#fff' : '#475569',
          }}>{s.label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <button onClick={() => navMese(-1)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9' }}>←</button>
        <span style={{ fontWeight: 700, minWidth: 120, textAlign: 'center' }}>{meseNome(mese)} {anno}</span>
        <button onClick={() => navMese(1)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9' }}>→</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto', background: '#fff7ed', border: '1.5px solid #fdba74', borderRadius: 8, padding: '5px 8px' }}>
          <span style={{ fontSize: '0.85rem', color: '#9a3412', fontWeight: 600 }}>Valori:</span>
          <button onClick={() => cambiaLordo(true)} style={{
            padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: lordo ? 700 : 400,
            background: lordo ? '#ea580c' : 'transparent', color: lordo ? '#fff' : '#9a3412',
          }}>IVA inclusa</button>
          <button onClick={() => cambiaLordo(false)} style={{
            padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: !lordo ? 700 : 400,
            background: !lordo ? '#ea580c' : 'transparent', color: !lordo ? '#fff' : '#9a3412',
          }}>IVA esclusa</button>
        </div>
      </div>

      <p style={{ color: '#64748b', fontSize: '0.82rem', marginTop: 0, marginBottom: '1rem' }}>
        Le righe con badge <span style={{ background: '#dbeafe', color: '#1e40af', padding: '1px 6px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600 }}>AUTO</span> sono calcolate da Produzione/Corrispettivi e non sono modificabili qui.
        Le altre sono da inserire a mano.
      </p>

      {msg && (
        <div style={{
          padding: '0.6rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: '0.85rem',
          background: msg.tipo === 'ok' ? '#dcfce7' : '#fee2e2', color: msg.tipo === 'ok' ? '#166534' : '#991b1b',
        }}>
          {msg.testo}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Caricamento…</p>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 10 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#4a6fa5' }}>
                <th style={{ ...thSt, background: '#4a6fa5', color: '#fff', textAlign: 'left' }}>Reparto</th>
                <th style={{ ...thSt, background: '#4a6fa5', color: '#fff', textAlign: 'left' }}>Conto</th>
                <th style={{ ...thSt, background: '#4a6fa5', color: '#fff', textAlign: 'right' }}>{lordo ? 'Lordo' : 'Imponibile'}</th>
              </tr>
            </thead>
            <tbody>
              {gruppi.map(g => (
                g.righe.map((r, i) => (
                  <tr key={r.riga_code} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ ...tdSt, textAlign: 'left', color: i === 0 ? '#1e293b' : '#cbd5e1' }}>
                      {i === 0 ? g.reparto : ''}
                    </td>
                    <td style={{ ...tdSt, textAlign: 'left' }}>{r.conto}</td>
                    <td style={{ ...tdSt, textAlign: 'right' }}>
                      {r.auto ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ background: '#dbeafe', color: '#1e40af', padding: '1px 6px', borderRadius: 4, fontSize: '0.68rem', fontWeight: 600 }}>AUTO</span>
                          {formatEuro(campoValore(r, lordo))}
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            €
                            <input
                              type="text" inputMode="decimal"
                              value={valoreVisualizzato(r)}
                              onChange={e => setModifiche(prev => ({ ...prev, [r.riga_code]: e.target.value }))}
                              style={{
                                width: 90, padding: '4px 8px', textAlign: 'right', borderRadius: 5,
                                border: `1px solid ${r.riga_code in modifiche ? '#f59e0b' : '#cbd5e1'}`,
                                color: '#b91c1c', fontWeight: 600,
                              }}
                            />
                          </span>
                          {lordo && (
                            <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                              (imponibile — lordo {formatEuro(r.lordo)})
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
        <button onClick={confermaModifiche} disabled={nModifiche === 0 || salvando}
          style={{
            padding: '9px 22px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '0.88rem',
            background: nModifiche === 0 ? '#e2e8f0' : '#1e3a5f', color: nModifiche === 0 ? '#94a3b8' : '#fff',
            cursor: nModifiche === 0 || salvando ? 'not-allowed' : 'pointer',
          }}>
          {salvando ? 'Salvataggio…' : `CONFERMA${nModifiche ? ` (${nModifiche})` : ''}`}
        </button>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b' }}>
          Totale {formatEuro(lordo ? totaleLordo : totaleImponibile)}
        </div>
      </div>
    </div>
  )
}
