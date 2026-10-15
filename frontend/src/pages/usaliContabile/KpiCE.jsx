// KPI del Conto Economico contabile: card principali, grafico mensile Ricavi / GOP / GOP
// cumulato e tabella KPI per mese. KPI per camera solo sui mesi aperti (camere disponibili > 0).
import { useEffect, useMemo, useState } from 'react'
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import api from '../../api/client.js'
import { formatEuro, formatEuroIntero, formatN, formatPerc, mostraErrore } from '../../utils/format.js'
import { Badge, Card, KpiTile, Loading, Messaggio, StatoVuoto, Table, Td, Th } from '../../components/ui'
import { colors, coloreSerie } from '../../styles/tokens.js'
import { Euro, MESI_BREVI } from './helpers.jsx'

const COLORE_RICAVI = coloreSerie(0)
const COLORE_GOP = coloreSerie(1)
const COLORE_CUMULATO = coloreSerie(2)

const legendaNeutra = (valore) => <span style={{ color: colors.text }}>{valore}</span>

const STATO_BADGE = {
  chiuso: <Badge tono="neutral" title="Fuori stagione: solo costi">chiuso</Badge>,
  mancante: <Badge tono="warn" title="In stagione ma senza dati Revenue: KPI per camera non calcolabili">no camere</Badge>,
}

// Righe della tabella mensile: [chiave, etichetta, formatter]
const fEuro = v => <Euro v={v} />
const fEuro2 = v => (v == null ? '—' : formatEuro(v))
const RIGHE_KPI = [
  ['camere_disponibili', 'Camere disponibili', formatN],
  ['camere_vendute', 'Camere vendute', formatN],
  ['presenze', 'Presenze', formatN],
  ['occupazione', 'Occupazione', formatPerc],
  ['adr', 'ADR', fEuro2],
  ['revpar', 'RevPAR', fEuro2],
  ['trevpar', 'TRevPAR', fEuro2],
  ['ricavi', 'Ricavi totali', fEuro],
  ['gop', 'GOP', fEuro],
  ['gop_perc', 'GOP %', formatPerc],
  ['goppar', 'GOPPAR', fEuro2],
  ['cpor', 'CPOR (costi Camere / camera venduta)', fEuro2],
  ['margine_camere_perc', 'Margine reparto Camere %', formatPerc],
  ['costo_personale', 'Costo personale', fEuro],
  ['costo_personale_perc', 'Costo personale % ricavi', formatPerc],
  ['commissioni_perc_ricavi_camere', 'Commissioni % ricavi camere', formatPerc],
  ['food_cost_perc', 'Food cost % ricavi F&B', formatPerc],
  ['beverage_cost_perc', 'Beverage cost % ricavi F&B', formatPerc],
  ['utenze_per_camera_venduta', 'Utenze per camera venduta', fEuro2],
]

function etichettaMesi(mesi) {
  if (!mesi.length) return 'nessun mese con camere'
  return mesi.length === 1 ? MESI_BREVI[mesi[0] - 1] : `${MESI_BREVI[mesi[0] - 1]}–${MESI_BREVI[mesi.at(-1) - 1]}`
}

export default function KpiCE({ struttura, segmentoId, anno, meseDa, meseA }) {
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let annullato = false
    setLoading(true)
    setErrore(null)
    api.get('/usali/contabile/kpi', {
      params: { struttura, anno, mese_da: meseDa, mese_a: meseA, ...(segmentoId ? { segmento_id: segmentoId } : {}) },
    })
      .then(r => { if (!annullato) setDati(r.data) })
      .catch(e => { if (!annullato) { setErrore(mostraErrore(e)); setDati(null) } })
      .finally(() => { if (!annullato) setLoading(false) })
    return () => { annullato = true }
  }, [struttura, segmentoId, anno, meseDa, meseA])

  const grafico = useMemo(() => (dati?.mensili || []).map(m => ({
    mese: MESI_BREVI[m.mese - 1],
    ricavi: m.ricavi, gop: m.gop, gop_cumulato: m.gop_cumulato,
  })), [dati])

  const repartiPersonale = useMemo(() => {
    const s = new Set()
    ;(dati?.mensili || []).forEach(m => Object.keys(m.personale_per_reparto || {}).forEach(r => s.add(r)))
    Object.keys(dati?.periodo?.personale_per_reparto || {}).forEach(r => s.add(r))
    return [...s]
  }, [dati])

  if (loading && !dati) return <Loading />
  if (errore) return <Messaggio>{errore}</Messaggio>
  if (!dati) return null
  if (!dati.mensili.some(m => m.importato)) {
    return <StatoVuoto>Nessun dato importato per {struttura} nel periodo selezionato.</StatoVuoto>
  }

  const p = dati.periodo
  const subCamere = `per camera: ${etichettaMesi(dati.mesi_per_camera)}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {dati.mesi_senza_produzione.length > 0 && (
        <Messaggio tipo="warn">
          Mancano i dati Revenue (camere disponibili/vendute) per {dati.mesi_senza_produzione
            .map(m => MESI_BREVI[m - 1]).join(', ')}: i KPI per camera di quei mesi restano vuoti e
          sono esclusi dai KPI per camera di periodo.
        </Messaggio>
      )}
      {dati.segmento && (
        <Messaggio tipo="info">
          Importi del segmento «{dati.segmento.nome}»; camere e presenze sono quelle dell'intera struttura.
        </Messaggio>
      )}

      <div className="ui-kpi-row">
        <KpiTile label="GOP" value={formatEuroIntero(p.gop)} sub={`ricavi ${formatEuroIntero(p.ricavi)}`} size="lg" />
        <KpiTile label="GOP %" value={formatPerc(p.gop_perc)} sub="sui ricavi totali" size="lg" />
        <KpiTile label="GOPPAR" value={p.goppar == null ? '—' : formatEuro(p.goppar)} sub={subCamere} size="lg" />
        <KpiTile label="ADR" value={p.adr == null ? '—' : formatEuro(p.adr)} sub={subCamere} size="lg" />
        <KpiTile label="RevPAR" value={p.revpar == null ? '—' : formatEuro(p.revpar)} sub={subCamere} size="lg" />
        <KpiTile label="Occupazione" value={formatPerc(p.occupazione)} sub={subCamere} size="lg" />
        <KpiTile label="Costo personale %" value={formatPerc(p.costo_personale_perc)}
          sub={formatEuroIntero(p.costo_personale)} size="lg" />
      </div>

      <Card title="Ricavi, GOP e GOP cumulato per mese">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={grafico} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
            <XAxis dataKey="mese" tick={{ fontSize: 12, fill: colors.textMuted }} />
            <YAxis tickFormatter={v => `${Math.round(v / 1000)}k`} width={48}
              tick={{ fontSize: 12, fill: colors.textMuted }} />
            <Tooltip formatter={(v, n) => [v == null ? '—' : formatEuroIntero(v), n]} />
            <Legend formatter={legendaNeutra} />
            <ReferenceLine y={0} stroke={colors.borderStrong} />
            <Bar dataKey="ricavi" name="Ricavi" fill={COLORE_RICAVI} radius={[4, 4, 0, 0]} />
            <Bar dataKey="gop" name="GOP" fill={COLORE_GOP} radius={[4, 4, 0, 0]} />
            <Line dataKey="gop_cumulato" name="GOP cumulato (da gennaio)" stroke={COLORE_CUMULATO}
              strokeWidth={2} dot={{ r: 4 }} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <Card title="KPI per mese">
        <Table compact>
          <thead>
            <tr>
              <Th style={{ minWidth: 240 }}>KPI</Th>
              {dati.mensili.map(m => (
                <Th key={m.mese} num>
                  {MESI_BREVI[m.mese - 1]}
                  {m.importato && STATO_BADGE[m.stato_produzione] && (
                    <div style={{ marginTop: 2 }}>{STATO_BADGE[m.stato_produzione]}</div>
                  )}
                </Th>
              ))}
              <Th num tot>Periodo</Th>
            </tr>
          </thead>
          <tbody>
            {RIGHE_KPI.map(([k, label, fmt]) => (
              <tr key={k}>
                <Td>{label}</Td>
                {dati.mensili.map(m => <Td key={m.mese} num>{fmt(m[k])}</Td>)}
                <Td num tot>{fmt(p[k])}</Td>
              </tr>
            ))}
            {repartiPersonale.length > 0 && (
              <tr className="ui-riga-sezione"><Td colSpan={dati.mensili.length + 2}>Costo personale per reparto</Td></tr>
            )}
            {repartiPersonale.map(rep => (
              <tr key={rep}>
                <Td style={{ paddingLeft: 26 }}>{rep}</Td>
                {dati.mensili.map(m => (
                  <Td key={m.mese} num>{m.importato ? formatEuroIntero(m.personale_per_reparto?.[rep] ?? 0) : '—'}</Td>
                ))}
                <Td num tot>{formatEuroIntero(p.personale_per_reparto?.[rep] ?? 0)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="ui-text-muted" style={{ marginTop: 8 }}>
          KPI per camera (occupazione, ADR, RevPAR, TRevPAR, GOPPAR, CPOR, utenze) calcolati solo sui mesi con
          camere disponibili; nel periodo sono rapporti tra totali dei mesi aperti, mai medie. Camere e presenze
          dal modulo Revenue; importi dalla contabilità. Costi in positivo.
        </p>
      </Card>
    </div>
  )
}
