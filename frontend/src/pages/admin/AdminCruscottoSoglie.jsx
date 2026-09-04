import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client.js'
import { mostraErrore } from '../../utils/format.js'

const NOME_KPI = {
  occupancy: 'Occupancy',
  revenue_stagione_vs_budget: 'Revenue vs budget',
  revpar_vs_budget: 'RevPAR vs budget',
  adr_vs_budget: 'ADR vs budget',
  pickup_7gg: 'Pickup 7 giorni',
  delta_rt_pms: 'Δ RT vs PMS',
  labor_cost_ratio: 'Costo lavoro / revenue',
  perc_ota: '% ricavi da OTA',
  perc_contante: '% incassi in contante',
}

const NOME_DIREZIONE = {
  alto_meglio: 'più alto è meglio',
  basso_meglio: 'più basso è meglio',
  target: 'bidirezionale (scarto da un target)',
}

/** Righe editabili: cutoff rosso/arancio/verde dei tachimetri della Home / Cruscotto gruppo.
 * Solo le soglie di default (hotel_code = NULL) sono seminate ed editabili in questa v1 —
 * il modello supporta override per hotel (colonna hotel_code) per un'estensione futura. */
export default function AdminCruscottoSoglie() {
  const [soglie, setSoglie] = useState([])
  const [modifiche, setModifiche] = useState({})
  const [salvando, setSalvando] = useState(null)
  const [esito, setEsito] = useState(null)
  const [errore, setErrore] = useState(null)

  const carica = useCallback(() => {
    api.get('/home/soglie')
      .then(r => setSoglie(r.data))
      .catch(e => setErrore(mostraErrore(e)))
  }, [])

  useEffect(() => { carica() }, [carica])

  function campo(id, chiave, valore) {
    setModifiche(m => ({ ...m, [id]: { ...(m[id] || {}), [chiave]: valore } }))
  }

  async function salva(s) {
    const mod = modifiche[s.id] || {}
    setSalvando(s.id); setEsito(null)
    try {
      await api.put(`/home/soglie/${s.id}`, {
        soglia_rossa: mod.soglia_rossa ?? s.soglia_rossa,
        soglia_arancione: mod.soglia_arancione ?? s.soglia_arancione,
        target: mod.target ?? s.target,
      })
      setEsito({ tipo: 'ok', msg: 'Soglia aggiornata.' })
      setModifiche(m => { const c = { ...m }; delete c[s.id]; return c })
      carica()
    } catch (e) {
      setEsito({ tipo: 'errore', msg: mostraErrore(e) })
    } finally {
      setSalvando(null)
    }
  }

  if (errore) return <div style={{ padding: '1rem', background: '#fee2e2', borderRadius: 8, color: '#991b1b' }}>{errore}</div>

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Cruscotto — soglie tachimetri</h2>
      <p style={{ color: '#6b7280', fontSize: 13, maxWidth: 720 }}>
        Cutoff rosso / arancio / verde di ogni tachimetro della Home. "Rosso" e "arancio" sono i
        valori di passaggio tra una fascia e la successiva — sopra (o sotto, a seconda della
        direzione) l'arancione la zona è verde.
      </p>

      {esito && (
        <div style={{
          padding: '0.6rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: 13,
          background: esito.tipo === 'ok' ? '#d1fae5' : '#fee2e2',
          color: esito.tipo === 'ok' ? '#065f46' : '#991b1b',
        }}>
          {esito.msg}
        </div>
      )}

      <div className="card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#6b7280', fontSize: 11, textTransform: 'uppercase' }}>
              <th style={{ padding: '6px 8px' }}>KPI</th>
              <th style={{ padding: '6px 8px' }}>Direzione</th>
              <th style={{ padding: '6px 8px' }}>Target</th>
              <th style={{ padding: '6px 8px' }}>Soglia rossa</th>
              <th style={{ padding: '6px 8px' }}>Soglia arancione</th>
              <th style={{ padding: '6px 8px' }} />
            </tr>
          </thead>
          <tbody>
            {soglie.map(s => {
              const mod = modifiche[s.id] || {}
              const sporca = Object.keys(mod).length > 0
              return (
                <tr key={s.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{NOME_KPI[s.kpi_code] || s.kpi_code}</td>
                  <td style={{ padding: '6px 8px', color: '#6b7280' }}>{NOME_DIREZIONE[s.direzione] || s.direzione}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {s.direzione === 'target' ? (
                      <input type="number" defaultValue={s.target ?? 0} style={{ width: 70 }}
                        onChange={e => campo(s.id, 'target', parseFloat(e.target.value))} />
                    ) : '—'}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input type="number" defaultValue={s.soglia_rossa} style={{ width: 80 }}
                      onChange={e => campo(s.id, 'soglia_rossa', parseFloat(e.target.value))} />
                    {' '}{s.unita === 'perc' ? '%' : s.unita === 'euro' ? '€' : ''}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input type="number" defaultValue={s.soglia_arancione} style={{ width: 80 }}
                      onChange={e => campo(s.id, 'soglia_arancione', parseFloat(e.target.value))} />
                    {' '}{s.unita === 'perc' ? '%' : s.unita === 'euro' ? '€' : ''}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <button
                      disabled={!sporca || salvando === s.id}
                      onClick={() => salva(s)}
                      style={{
                        padding: '4px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600,
                        background: sporca ? '#3b82f6' : '#e5e7eb', color: sporca ? '#fff' : '#9ca3af',
                        cursor: sporca ? 'pointer' : 'default',
                      }}
                    >
                      {salvando === s.id ? 'Salvo…' : 'Salva'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
