import { useState, useEffect, useCallback } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import api from '../../api/client'
import { formatEuro, formatPerc } from '../../utils/format'
import { ExportMenu } from '../../components/ExportMenu.jsx'
import {
  STRUTTURE_HOTEL, NOMI, meseNome, primoGiorno, ultimoGiorno,
  thSt, tdSt, inpSt, PALETTE_CATEGORICA, campoValore, meseAnnoPrecedente,
} from '../../utils/produzioneHelpers'

/** Tabella/grafici per una singola dimensione di analisi (canale, trattamento, tipo ospite).
 * Riusata da TabCanali/TabTrattamenti/TabTipoOspite — stessa aggregazione, cambia solo il campo. */
export default function TabAnalisiDimensione({ dimensione, campo, titolo, lordo }) {
  const def = meseAnnoPrecedente()
  const [anno, setAnno] = useState(def.anno)
  const [mese, setMese] = useState(def.mese)
  const [struttura, setStruttura] = useState('')
  const [dati, setDati] = useState([])
  const [trend, setTrend] = useState([])
  const [loading, setLoading] = useState(false)

  const da = primoGiorno(anno, mese)
  const a = ultimoGiorno(anno, mese)

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/produzione/report/${dimensione}`, {
        params: { data_da: da, data_a: a, struttura_code: struttura || undefined },
      })
      const chiave = dimensione === 'canali' ? 'per_canale' : dimensione === 'trattamenti' ? 'per_trattamento' : 'per_tipo_ospite'
      setDati(data[chiave] || [])
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [dimensione, da, a, struttura])

  useEffect(() => { carica() }, [carica])

  // Trend mensile sull'anno selezionato (12 chiamate parallele)
  useEffect(() => {
    const chiave = dimensione === 'canali' ? 'per_canale' : dimensione === 'trattamenti' ? 'per_trattamento' : 'per_tipo_ospite'
    Promise.all(
      Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
        api.get(`/produzione/report/${dimensione}`, {
          params: { data_da: primoGiorno(anno, m), data_a: ultimoGiorno(anno, m), struttura_code: struttura || undefined },
        }).then(r => ({ mese: m, righe: r.data[chiave] || [] })).catch(() => ({ mese: m, righe: [] }))
      )
    ).then(risultati => {
      const punti = risultati.map(({ mese: m, righe }) => {
        const punto = { mese: meseNome(m).slice(0, 3) }
        righe.forEach(r => { punto[r[campo]] = campoValore(r, lordo) })
        return punto
      })
      setTrend(punti)
    })
  }, [dimensione, campo, anno, struttura, lordo])

  const navMese = (delta) => {
    let m = mese + delta, y = anno
    if (m > 12) { m = 1; y++ }
    if (m < 1) { m = 12; y-- }
    setMese(m); setAnno(y)
  }

  const totale = dati.reduce((s, d) => s + campoValore(d, lordo), 0)
  const serieChiavi = [...new Set(dati.map(d => d[campo]))]

  const selSt = { ...inpSt, fontSize: '0.82rem' }

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: '0 0 12px' }}>{titolo}</h2>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <button onClick={() => navMese(-1)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9' }}>←</button>
        <span style={{ fontWeight: 700, minWidth: 120, textAlign: 'center' }}>{meseNome(mese)} {anno}</span>
        <button onClick={() => navMese(1)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9' }}>→</button>
        <select value={struttura} onChange={e => setStruttura(e.target.value)} style={selSt}>
          <option value="">Tutte le strutture</option>
          {STRUTTURE_HOTEL.map(sc => <option key={sc} value={sc}>{NOMI[sc]}</option>)}
        </select>
        <div style={{ marginLeft: 'auto' }}>
          <ExportMenu
            url={`/produzione/export/${dimensione}?data_da=${da}&data_a=${a}${struttura ? `&struttura_code=${struttura}` : ''}`}
            nome={`produzione_${dimensione}_${anno}_${mese}`}
          />
        </div>
      </div>

      {loading && <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Caricamento…</p>}

      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {/* Tabella */}
        <div style={{ flex: '1 1 380px', overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#1e3a5f', color: '#fff' }}>
                <th style={{ ...thSt, textAlign: 'left' }}>{titolo.replace('Analisi ', '')}</th>
                {STRUTTURE_HOTEL.map(sc => <th key={sc} style={thSt}>{sc}</th>)}
                <th style={thSt}>Totale</th>
                <th style={thSt}>% sul totale</th>
              </tr>
            </thead>
            <tbody>
              {dati.map((d, idx) => (
                <tr key={d[campo]} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                  <td style={{ ...tdSt, textAlign: 'left', fontWeight: 600 }}>
                    <span style={{
                      display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
                      background: PALETTE_CATEGORICA[idx % PALETTE_CATEGORICA.length], marginRight: 6,
                    }} />
                    {d[campo]}
                  </td>
                  {STRUTTURE_HOTEL.map(sc => (
                    <td key={sc} style={tdSt}>{formatEuro(campoValore(d.per_struttura[sc], lordo))}</td>
                  ))}
                  <td style={{ ...tdSt, fontWeight: 700 }}>{formatEuro(campoValore(d, lordo))}</td>
                  <td style={tdSt}>{formatPerc(d.pct_totale)}</td>
                </tr>
              ))}
              {dati.length === 0 && !loading && (
                <tr><td colSpan={STRUTTURE_HOTEL.length + 3} style={{ ...tdSt, textAlign: 'center', color: '#94a3b8' }}>Nessun dato per il periodo selezionato</td></tr>
              )}
            </tbody>
            {dati.length > 0 && (
              <tfoot>
                {/* background esplicito su ogni <td> (non solo sulla <tr>): vedi nota in
                    TabGiornaliera.jsx — qui innocuo oggi (unico figlio di <tfoot>, sempre
                    posizione dispari) ma reso comunque robusto per coerenza. */}
                <tr style={{ background: '#f1f5f9', fontWeight: 700 }}>
                  <td style={{ ...tdSt, background: '#f1f5f9', textAlign: 'left' }}>TOTALE</td>
                  {STRUTTURE_HOTEL.map(sc => (
                    <td key={sc} style={{ ...tdSt, background: '#f1f5f9' }}>
                      {formatEuro(dati.reduce((s, d) => s + campoValore(d.per_struttura[sc], lordo), 0))}
                    </td>
                  ))}
                  <td style={{ ...tdSt, background: '#f1f5f9' }}>{formatEuro(totale)}</td>
                  <td style={{ ...tdSt, background: '#f1f5f9' }}>100%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Torta distribuzione */}
        <div style={{ flex: '1 1 320px', minWidth: 280, height: 280 }}>
          {dati.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={dati} dataKey={d => campoValore(d, lordo)} nameKey={campo} cx="50%" cy="50%" outerRadius={90}
                  label={({ percent }) => `${(percent * 100).toFixed(0)}%`}>
                  {dati.map((d, idx) => (
                    <Cell key={d[campo]} fill={PALETTE_CATEGORICA[idx % PALETTE_CATEGORICA.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatEuro(v)} />
                <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: '0.85rem' }}>
              Nessun dato da visualizzare
            </div>
          )}
        </div>
      </div>

      {/* Trend mensile */}
      <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: '0 0 10px' }}>Trend mensile {anno}</h3>
      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatEuro(v).replace(',00', '')} />
            <Tooltip formatter={(v) => formatEuro(v)} />
            <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
            {serieChiavi.map((s, idx) => (
              <Bar key={s} dataKey={s} stackId="a" fill={PALETTE_CATEGORICA[idx % PALETTE_CATEGORICA.length]} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
