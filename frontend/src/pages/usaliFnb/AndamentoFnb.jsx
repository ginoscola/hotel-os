// Andamento mensile di un punto vendita: percentuali di costo e valori per coperto, mese per mese.
import { useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatEuro, formatPerc } from '../../utils/format.js'
import { Card, Field, Select, Table, Td, Th } from '../../components/ui'
import { colors, coloreSerie } from '../../styles/tokens.js'
import { MESI_BREVI } from '../usaliContabile/helpers.jsx'
import { COLONNE, KPI_ANDAMENTO } from './colonne.jsx'

const legendaNeutra = (valore) => <span style={{ color: colors.text }}>{valore}</span>

function Grafico({ dati, serie, formatter, unita }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={dati} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: colors.textMuted }} />
        <YAxis width={52} tick={{ fontSize: 12, fill: colors.textMuted }}
          tickFormatter={v => `${Math.round(v)}${unita}`} />
        <Tooltip formatter={(v, n) => [v == null ? '—' : formatter(v), n]} />
        <Legend formatter={legendaNeutra} />
        {serie.map(([k, label], i) => (
          <Line key={k} dataKey={k} name={label} stroke={coloreSerie(i)} strokeWidth={2}
            dot={{ r: 3 }} connectNulls={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export default function AndamentoFnb({ report }) {
  const [rigaId, setRigaId] = useState(report.righe[0].id)
  const riga = report.righe.find(r => r.id === rigaId) || report.righe[0]

  const dati = useMemo(
    () => riga.mesi.map(m => ({ ...m, label: MESI_BREVI[m.mese - 1] })),
    [riga],
  )
  const conCoperti = riga.mesi.some(m => m.coperti != null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label="Punto vendita">
        <Select value={riga.id} onChange={e => setRigaId(e.target.value)}>
          {report.righe.map(r => (
            <option key={r.id} value={r.id}>{r.tipo === 'sub' ? '   ' : ''}{r.label}{r.stima_costi ? ' (costi stimati)' : ''}</option>
          ))}
        </Select>
      </Field>

      <Card title="Costi in percentuale dei ricavi">
        <Grafico dati={dati} serie={KPI_ANDAMENTO.percentuali} formatter={formatPerc} unita="%" />
      </Card>
      {conCoperti && (
        <Card title="Valori per coperto">
          <Grafico dati={dati} serie={KPI_ANDAMENTO.coperto} formatter={formatEuro} unita=" €" />
        </Card>
      )}

      <Card title={`${riga.label} — mese per mese`}>
        <Table compact>
          <thead>
            <tr>
              <Th>Voce</Th>
              {riga.mesi.map(m => <Th key={m.mese} num>{MESI_BREVI[m.mese - 1]}</Th>)}
              <Th num tot>Periodo</Th>
            </tr>
          </thead>
          <tbody>
            {COLONNE.map(([k, label, render]) => (
              <tr key={k}>
                <Td style={{ whiteSpace: 'nowrap' }}>{label}</Td>
                {riga.mesi.map(m => <Td key={m.mese} num>{render(m[k])}</Td>)}
                <Td num tot>{render(riga.periodo[k])}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div style={{ marginTop: 8, fontSize: 12, color: colors.textMuted }}>
          I costi sono acquisti: un mese con un grosso ordine (o i rifornimenti prima dell'apertura)
          risulta "caro". Per giudicare usare la colonna Periodo.
        </div>
      </Card>
    </div>
  )
}
