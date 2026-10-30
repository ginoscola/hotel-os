// Confronto Actual vs Budget e Proiezione per un ristorante: come le schede hotel, senza camere e OTB.
import { useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import api from '../../api/client.js'
import pastReferenceArea from '../../components/PastReferenceArea.jsx'
import {
  Badge, Card, KpiTile, Loading, SegmentedControl, StatoVuoto, Table, Td, Th,
} from '../../components/ui'
import { colors } from '../../styles/tokens.js'
import { formatEuro } from '../../utils/format.js'
import { COLORE_ACTUAL, COLORE_BUDGET, TREND, coloreSegno, conSegno, labelSettimana } from './helpers.js'

const MESI = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

const FONTE = {
  consuntivo: { label: 'Consuntivo', tono: 'ok' },
  in_corso:   { label: 'In corso',   tono: 'info' },
  budget:     { label: 'Budget',     tono: 'neutral' },
}

const pct = (v) => `${v.toFixed(1)}%`
const conSegnoEuro = (v) => conSegno(v, formatEuro)

function useRiepilogo(anno, version) {
  const [dati, setDati] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    api.get(`/budget-ristoranti/${anno}?version=${version}`)
      .then(r => setDati(r.data))
      .catch(() => setDati(null))
      .finally(() => setLoading(false))
  }, [anno, version])
  return { dati, loading }
}

const settimaneDi = (dati, codice) => dati.settimane
  .map(s => ({ ...s[codice], week_start: s.week_start, stato: s.stato }))
  .filter(s => s.budget != null || s.consuntivo != null)

export function ConfrontoRistorante({ codice, anno, version }) {
  const { dati, loading } = useRiepilogo(anno, version)
  const [modalita, setModalita] = useState('settimanale')

  const selettore = (
    <div style={{ marginBottom: 16 }}>
      <SegmentedControl
        value={modalita}
        onChange={setModalita}
        options={[{ value: 'settimanale', label: 'Settimanale' }, { value: 'mensile', label: 'Mensile' }]}
      />
    </div>
  )

  if (loading) return <>{selettore}<Loading /></>
  const settimane = dati ? settimaneDi(dati, codice) : []
  if (settimane.length === 0) return <>{selettore}<StatoVuoto>Nessun dato disponibile.</StatoVuoto></>

  const tot = dati.totali[codice]
  const righe = modalita === 'mensile'
    ? dati.mesi.map(m => ({ chiave: `${m.anno}-${m.mese}`, label: MESI[m.mese], ...m[codice],
        scostamentoPct: m[codice].scostamento_pct }))
        .filter(m => m.budget || m.consuntivo)
    : settimane.map(s => ({ chiave: s.week_start, label: labelSettimana(s.week_start), ...s,
        scostamentoPct: s.scostamento != null && s.budget ? s.scostamento / s.budget : null }))
  const grafico = settimane.map(s => ({
    week_start: s.week_start, label: s.week_start.slice(5), budget: s.budget, actual: s.consuntivo,
  }))

  return (
    <div>
      {selettore}
      <div className="ui-kpi-row">
        <KpiTile label="Budget Revenue" value={formatEuro(tot.budget)} />
        <KpiTile label="Actual Revenue" value={formatEuro(tot.consuntivo)} />
        <KpiTile label="Scostamento €" value={conSegnoEuro(tot.scostamento)} colore={coloreSegno(tot.scostamento)} sub="sulle settimane chiuse" />
        <KpiTile
          label="Scostamento %"
          value={tot.scostamento_pct != null ? conSegno(tot.scostamento_pct * 100, pct) : '—'}
          colore={coloreSegno(tot.scostamento)}
          sub="sulle settimane chiuse"
        />
      </div>
      <p className="ui-text-muted" style={{ marginTop: 0 }}>
        Importi IVA inclusa. Lo scostamento confronta solo le settimane chiuse con budget e consuntivo:
        i ristoranti non hanno un prenotato futuro.
        {codice === 'MMS' && ' Mare Mosso: solo clienti esterni, gli ospiti sono nel F&B del Du Parc.'}
      </p>

      <Table compact style={{ marginBottom: 20 }}>
        <thead>
          <tr>
            <Th>{modalita === 'mensile' ? 'Mese' : 'Settimana'}</Th>
            <Th num>Budget</Th>
            <Th num>Actual</Th>
            <Th num>Δ€</Th>
            <Th num>Δ%</Th>
          </tr>
        </thead>
        <tbody>
          {righe.map(r => (
            <tr key={r.chiave} className={r.consuntivo ? undefined : 'ui-riga-attenuata'}>
              <Td style={{ whiteSpace: 'nowrap' }}>{r.label}</Td>
              <Td num>{r.budget ? formatEuro(r.budget) : '—'}</Td>
              <Td num>{r.consuntivo ? formatEuro(r.consuntivo) : '—'}</Td>
              <Td num style={{ color: coloreSegno(r.scostamento) }}>{conSegnoEuro(r.scostamento)}</Td>
              <Td num style={{ color: coloreSegno(r.scostamento) }}>
                {r.scostamentoPct != null ? conSegno(r.scostamentoPct * 100, pct) : '—'}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {modalita === 'settimanale' && (
        <Card title="Revenue Totale">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={grafico} barCategoryGap="15%">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`} width={40} />
              <Tooltip formatter={v => v != null ? formatEuro(v) : '—'} />
              <Legend />
              {pastReferenceArea(grafico, 'week_start', 'label')}
              <Bar dataKey="budget" name="Budget" fill={COLORE_BUDGET} />
              <Bar dataKey="actual" name="Actual" fill={COLORE_ACTUAL} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  )
}

export function ProiezioneRistorante({ codice, anno, version }) {
  const { dati, loading } = useRiepilogo(anno, version)

  if (loading) return <Loading />
  const settimane = dati ? settimaneDi(dati, codice) : []
  if (settimane.length === 0) return <StatoVuoto>Nessun dato per questo ristorante/anno.</StatoVuoto>

  const tot = dati.totali[codice]
  const scost = tot.budget ? tot.proiezione - tot.budget : null
  const scostPct = scost != null ? scost / tot.budget * 100 : null
  const trend = TREND[tot.trend] ?? { label: 'SENZA BUDGET', colore: colors.textMuted, tono: 'neutral' }
  const avanzamento = tot.settimane_totali ? tot.settimane_chiuse / tot.settimane_totali * 100 : 0

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div className="ui-text-muted">Budget totale stagione</div>
            <div className="ui-num" style={{ fontWeight: 700, fontSize: 'var(--fs-xxl)' }}>{formatEuro(tot.budget)}</div>
          </div>
          <div>
            <div className="ui-text-muted">Proiezione fine stagione</div>
            <div className="ui-num" style={{ fontWeight: 700, fontSize: 'var(--fs-xxl)', color: trend.colore }}>
              {formatEuro(tot.proiezione)}
            </div>
          </div>
          <div>
            <div className="ui-text-muted">Scostamento</div>
            <div className="ui-num" style={{ fontWeight: 700, fontSize: 'var(--fs-xl)', color: trend.colore }}>
              {conSegnoEuro(scost)}
              {scostPct != null && ` (${conSegno(scostPct, pct)})`}
            </div>
          </div>
          <Badge tono={trend.tono} style={{ alignSelf: 'center', fontSize: 'var(--fs-base)', padding: '4px 12px' }}>
            {trend.label}
          </Badge>
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="ui-text-muted" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{tot.settimane_chiuse} settimane chiuse su {tot.settimane_totali}</span>
            <span className="ui-num">{avanzamento.toFixed(0)}%</span>
          </div>
          <div style={{ background: colors.border, borderRadius: 4, height: 10, overflow: 'hidden' }}>
            <div style={{ width: `${avanzamento}%`, height: '100%', background: trend.colore, transition: 'width 0.5s' }} />
          </div>
        </div>
      </Card>

      <p className="ui-text-muted" style={{ marginTop: 0 }}>
        Settimane chiuse: consuntivo. Le altre: budget, perché i ristoranti non hanno prenotazioni da cui stimare le vendite.
        {codice === 'MMS' && ' Mare Mosso: solo clienti esterni, gli ospiti sono nel F&B del Du Parc.'}
      </p>

      <Table compact>
        <thead>
          <tr>
            <Th>Settimana</Th>
            <Th>Fonte</Th>
            <Th num>Budget</Th>
            <Th num>Consuntivo / Proiezione</Th>
            <Th num>Δ€ vs budget</Th>
          </tr>
        </thead>
        <tbody>
          {settimane.map(s => {
            const delta = s.budget != null && s.proiezione != null ? s.proiezione - s.budget : null
            return (
              <tr key={s.week_start} className={s.fonte === 'consuntivo' ? 'ui-riga-ok' : undefined}>
                <Td>{labelSettimana(s.week_start)}</Td>
                <Td><Badge tono={FONTE[s.fonte].tono}>{FONTE[s.fonte].label}</Badge></Td>
                <Td num>{formatEuro(s.budget)}</Td>
                <Td num>{formatEuro(s.proiezione)}</Td>
                <Td num style={{ color: coloreSegno(delta) }}>{conSegnoEuro(delta)}</Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}
