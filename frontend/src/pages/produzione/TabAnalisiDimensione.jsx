import { useState, useEffect, useCallback } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import api from '../../api/client'
import { formatEuro, formatPerc } from '../../utils/format'
import { ExportMenu } from '../../components/ExportMenu.jsx'
import {
  STRUTTURE_HOTEL, meseNome, primoGiorno, ultimoGiorno, campoValore, meseAnnoPrecedente, OPZIONI_STRUTTURA,
} from '../../utils/produzioneHelpers'
import { Card, Dot, Loading, NavMese, SegmentedControl, StatoVuoto, Table, Td, Th } from '../../components/ui'
import { colors, coloreSerie } from '../../styles/tokens.js'

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

  const totale = dati.reduce((s, d) => s + campoValore(d, lordo), 0)
  const serieChiavi = [...new Set(dati.map(d => d[campo]))]

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
        <NavMese anno={anno} mese={mese} onChange={({ anno: y, mese: m }) => { setAnno(y); setMese(m) }} />
        <SegmentedControl value={struttura} onChange={setStruttura} options={OPZIONI_STRUTTURA} />
        <div style={{ marginLeft: 'auto' }}>
          <ExportMenu
            url={`/produzione/export/${dimensione}?data_da=${da}&data_a=${a}${struttura ? `&struttura_code=${struttura}` : ''}`}
            nome={`produzione_${dimensione}_${anno}_${mese}`}
          />
        </div>
      </div>

      {loading && <Loading />}

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 24 }}>
        {/* Tabella */}
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
          <Table compact>
            <thead>
              <tr>
                <Th>{titolo.replace('Analisi ', '')}</Th>
                {STRUTTURE_HOTEL.map(sc => <Th key={sc} num>{sc}</Th>)}
                <Th num>Totale</Th>
                <Th num>% sul totale</Th>
              </tr>
            </thead>
            <tbody>
              {dati.map((d, idx) => (
                <tr key={d[campo]}>
                  <Td style={{ fontWeight: 600 }}>
                    <Dot colore={coloreSerie(idx)} /> <span style={{ marginLeft: 4 }}>{d[campo]}</span>
                  </Td>
                  {STRUTTURE_HOTEL.map(sc => (
                    <Td key={sc} num>{formatEuro(campoValore(d.per_struttura[sc], lordo))}</Td>
                  ))}
                  <Td num style={{ fontWeight: 700 }}>{formatEuro(campoValore(d, lordo))}</Td>
                  <Td num>{formatPerc(d.pct_totale)}</Td>
                </tr>
              ))}
              {dati.length === 0 && !loading && (
                <tr><Td colSpan={STRUTTURE_HOTEL.length + 3} center muted>Nessun dato per il periodo selezionato</Td></tr>
              )}
              {dati.length > 0 && (
                <tr className="ui-riga-sezione">
                  <Td>TOTALE</Td>
                  {STRUTTURE_HOTEL.map(sc => (
                    <Td key={sc} num>{formatEuro(dati.reduce((s, d) => s + campoValore(d.per_struttura[sc], lordo), 0))}</Td>
                  ))}
                  <Td num>{formatEuro(totale)}</Td>
                  <Td num>100%</Td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>

        {/* Torta distribuzione */}
        <Card style={{ flex: '1 1 320px', minWidth: 280, height: 300 }}>
          {dati.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={dati} dataKey={d => campoValore(d, lordo)} nameKey={campo} cx="50%" cy="50%" outerRadius={90}
                  label={({ percent }) => `${(percent * 100).toFixed(0)}%`}>
                  {dati.map((d, idx) => <Cell key={d[campo]} fill={coloreSerie(idx)} />)}
                </Pie>
                <Tooltip formatter={(v) => formatEuro(v)} />
                <Legend wrapperStyle={{ fontSize: 'var(--fs-xs)' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <StatoVuoto>Nessun dato da visualizzare</StatoVuoto>
          )}
        </Card>
      </div>

      {/* Trend mensile */}
      <Card title={`Trend mensile ${anno}`}>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatEuro(v).replace(',00', '')} />
              <Tooltip formatter={(v) => formatEuro(v)} />
              <Legend wrapperStyle={{ fontSize: 'var(--fs-xs)' }} />
              {serieChiavi.map((s, idx) => (
                <Bar key={s} dataKey={s} stackId="a" fill={coloreSerie(idx)} radius={[2, 2, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  )
}
