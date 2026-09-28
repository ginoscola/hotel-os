import { useState, useEffect, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../api/client.js'
import GaugeKpi from './home/GaugeKpi.jsx'
import StripFreschezza from './home/StripFreschezza.jsx'
import TabellaSemaforo from './home/TabellaSemaforo.jsx'
import HeatmapOccupancy from './home/HeatmapOccupancy.jsx'
import MixList from './home/MixList.jsx'
import { formatEuro, formatEuroK, formatPerc, formatN, formatDataIt, mostraErrore } from '../utils/format.js'
import { isAdmin } from '../utils/auth.js'
import { Badge, Card, KpiTile, Loading, Messaggio, PageHeader, SectionTitle, SegmentedControl } from '../components/ui'
import { colors, coloreSerie } from '../styles/tokens.js'

const HOTEL_KEY = 'home_hotel'
const HOTELS = [
  { value: 'GRUPPO', label: 'Gruppo' },
  { value: 'DPH', label: 'Du Parc' },
  { value: 'CLB', label: 'Club Hotel' },
  { value: 'INT', label: 'International' },
]

// Griglie della pagina: riquadri affiancati e fila di tachimetri
const styleSezione = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 24 }
const styleTachimetri = { ...styleSezione, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }
const styleTachimetriMese = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }
const fmtPct = v => v == null ? '—' : `${v.toFixed(0)}%`

export default function HomeCruscotto() {
  const [hotelCode, setHotelCode] = useState(() => localStorage.getItem(HOTEL_KEY) || 'GRUPPO')
  const [dati, setDati] = useState(null)
  const [datiAdmin, setDatiAdmin] = useState(null)
  const [caricando, setCaricando] = useState(true)
  const [errore, setErrore] = useState(null)

  const admin = isAdmin()

  useEffect(() => {
    localStorage.setItem(HOTEL_KEY, hotelCode)
  }, [hotelCode])

  const carica = useCallback(() => {
    setCaricando(true)
    setErrore(null)
    const richieste = [api.get('/home/cruscotto', { params: { hotel_code: hotelCode } })]
    if (admin) richieste.push(api.get('/home/cruscotto/admin', { params: { hotel_code: hotelCode } }))

    Promise.all(richieste)
      .then(([r1, r2]) => {
        setDati(r1.data)
        setDatiAdmin(r2 ? r2.data : null)
      })
      .catch(e => setErrore(mostraErrore(e)))
      .finally(() => setCaricando(false))
  }, [hotelCode, admin])

  useEffect(() => { carica() }, [carica])

  if (caricando && !dati) return <Loading testo="Caricamento cruscotto…" />
  if (errore) return <Messaggio tipo="err">{errore}</Messaggio>
  if (!dati) return null

  const kpi = dati.kpi_operativi
  const stagione = dati.stagione
  const vsBudget = dati.vs_budget

  return (
    <div>
      <PageHeader title={`Cruscotto ${dati.anno}`}>
        <SegmentedControl value={hotelCode} onChange={setHotelCode} options={HOTELS} />
      </PageHeader>

      {stagione && (
        <div className="ui-text-muted" style={{ fontSize: 'var(--fs-base)', marginTop: -8, marginBottom: 16 }}>
          Stagione {formatDataIt(stagione.open_date)} – {formatDataIt(stagione.close_date)} ·{' '}
          {stagione.perc_trascorsa}% trascorsa · {stagione.giorni_alla_chiusura} giorni alla chiusura
          {dati.snapshot_date && <> · ultimo snapshot {formatDataIt(dati.snapshot_date)}</>}
        </div>
      )}

      {/* ── Tachimetri principali ── */}
      <div style={styleTachimetri}>
        <GaugeKpi label="Occupancy stagione" dato={kpi?.occupancy ?? { valore: null, soglia: null }} />
        {vsBudget && (
          <>
            <GaugeKpi label="Revenue vs budget" dato={vsBudget.revenue_total} formatValue={fmtPct} />
            <GaugeKpi label="RevPAR vs budget" dato={vsBudget.revpar} formatValue={fmtPct} />
            <GaugeKpi label="ADR vs budget" dato={vsBudget.adr} formatValue={fmtPct} />
          </>
        )}
        <GaugeKpi label="Pickup 7 giorni" dato={dati.pickup_7gg} formatValue={v => v == null ? '—' : formatEuroK(v)} />
        <GaugeKpi label="Contante su incassato" dato={dati.pagamenti?.perc_contante ?? { valore: null, soglia: null }} />
      </div>

      {kpi?.occupancy_per_mese?.length > 0 && (
        <Card title="Occupancy per mese" style={{ marginBottom: 24 }}>
          <div style={styleTachimetriMese}>
            {kpi.occupancy_per_mese.map(m => (
              <GaugeKpi key={m.mese} label={m.mese_label} dato={m.occupancy}
                sub={`${formatN(m.rooms_sold)} / ${formatN(m.rooms_available)} camere`} />
            ))}
          </div>
        </Card>
      )}

      {kpi?.adr_per_mese?.length > 0 && (
        <Card title="ADR per mese" style={{ marginBottom: 24 }}>
          <div style={styleTachimetriMese}>
            {kpi.adr_per_mese.map(m => (
              <GaugeKpi key={m.mese} label={m.mese_label} dato={m.adr}
                formatValue={v => v == null ? '—' : formatEuro(v)}
                sub={`${formatN(m.rooms_sold)} camere vendute`} />
            ))}
          </div>
        </Card>
      )}

      {!vsBudget && (
        <p className="ui-text-muted" style={{ marginTop: -8, marginBottom: 16 }}>
          Nessun budget caricato per {dati.anno}: i tachimetri "vs budget" restano vuoti finché non viene inserito.
        </p>
      )}

      {/* ── KPI operativi ── */}
      {kpi && (
        <div className="ui-kpi-grid" style={{ marginBottom: 24 }}>
          <KpiTile label="Camere vendute" value={formatN(kpi.rooms_sold)} sub={`su ${formatN(kpi.rooms_available)} disponibili`} />
          <KpiTile label="Revenue totale" value={formatEuroK(kpi.revenue_total)} />
          <KpiTile label="ADR" value={formatEuro(kpi.adr)} />
          <KpiTile label="RevPAR" value={formatEuro(kpi.revpar)} />
          <KpiTile label="TRevPAR" value={formatEuro(kpi.trevpar)} />
          <KpiTile label="RMC" value={formatEuro(kpi.rmc)} />
        </div>
      )}

      {/* ── Ritmo prenotazioni ── */}
      <Card title={`Ritmo prenotazioni — mese ${dati.pace?.mese}/${dati.pace?.anno}`} style={{ marginBottom: 24 }}>
        {dati.pace?.punti?.length > 1 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dati.pace.punti}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.surfaceAlt} />
              <XAxis dataKey="snapshot_date" tickFormatter={formatDataIt} fontSize={11} />
              <YAxis tickFormatter={v => formatEuroK(v)} fontSize={11} width={70} />
              <Tooltip formatter={v => formatEuro(v)} labelFormatter={formatDataIt} />
              <Line type="monotone" dataKey="otb_revenue" name="OTB cumulato" stroke={colors.info} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="ui-text-muted">Non ci sono ancora abbastanza snapshot per questo mese.</p>
        )}
        <p className="ui-text-muted" style={{ marginTop: 8, marginBottom: 0 }}>
          {dati.pace_anno_precedente
            ? <>Stessa distanza dall'apertura stagione, {dati.pace_anno_precedente.anno}: {formatEuroK(dati.pace_anno_precedente.otb_revenue)}</>
            : "Confronto con l'anno precedente non disponibile (nessuno storico ancora caricato)."}
        </p>
      </Card>

      {/* ── Mix ricavi ── */}
      <div style={styleSezione}>
        <MixList titolo="Mix canali" items={dati.mix_canali} campo="canale" />
        <MixList titolo="Mix categorie" items={dati.mix_categorie} campo="name" />
      </div>

      {/* ── Cassa ── */}
      <div style={styleSezione}>
        <Card title="Cassa">
          <p style={{ fontSize: 'var(--fs-base)', color: colors.textSecond, marginTop: 0 }}>
            Tassa di soggiorno incassata (stagione): <strong className="ui-num">{formatEuro(dati.pagamenti?.tassa_soggiorno_incassata_stagione)}</strong>
          </p>
          {dati.commissioni_ota && (
            <p className="ui-text-muted" style={{ marginBottom: 0 }}>
              Lordo canali OTA: {formatEuroK(dati.commissioni_ota.lordo_ota)} — commissione stimata {formatEuro(dati.commissioni_ota.commissione_stimata)}.
              {' '}{dati.commissioni_ota.nota}
            </p>
          )}
        </Card>
        <Card title="Semaforo hotel">
          <TabellaSemaforo righe={dati.semaforo_hotel} />
        </Card>
      </div>

      <StripFreschezza dati={dati.freschezza} />

      {/* ── Fascia 2 — solo admin ── */}
      {admin && datiAdmin && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 32, marginBottom: 16 }}>
            <SectionTitle style={{ margin: 0, fontSize: 'var(--fs-xl)' }}>Dati riservati</SectionTitle>
            <Badge tono="warn">solo admin</Badge>
          </div>

          <div style={styleTachimetri}>
            <GaugeKpi label="Costo lavoro / revenue" dato={datiAdmin.costo_lavoro?.labor_cost_ratio} />
            {datiAdmin.delta_rt_stagione?.RT1 && (
              <GaugeKpi label="Δ RT1 (Du Parc + Club)" dato={datiAdmin.delta_rt_stagione.RT1} formatValue={v => v == null ? '—' : formatEuro(v)} />
            )}
            {datiAdmin.delta_rt_stagione?.RT2 && (
              <GaugeKpi label="Δ RT2 (International)" dato={datiAdmin.delta_rt_stagione.RT2} formatValue={v => v == null ? '—' : formatEuro(v)} />
            )}
          </div>

          <div style={styleSezione}>
            <Card title="Costo del lavoro per struttura">
              <p className="ui-text-muted" style={{ marginTop: -6, fontSize: 'var(--fs-xs)' }}>
                Mesi chiusi coperti: {(datiAdmin.costo_lavoro?.mesi_coperti || []).join(', ') || '—'}
              </p>
              {(datiAdmin.costo_lavoro?.per_struttura || []).map(s => (
                <div key={s.struttura_code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-base)', padding: '4px 0', borderTop: `1px solid ${colors.surfaceAlt}` }}>
                  <span>{s.struttura_name}</span>
                  <span className="ui-num">{formatEuroK(s.costo_aziendale)} <span style={{ color: colors.textSubtle }}>({s.n_dipendenti} dip.)</span></span>
                </div>
              ))}
            </Card>
            {datiAdmin.margine_contribuzione && (
              <Card title="Margine di contribuzione (parziale)">
                <p className="ui-num" style={{ fontSize: 'var(--fs-base)', marginTop: 0 }}>
                  Revenue: {formatEuroK(datiAdmin.margine_contribuzione.revenue_periodo)} − costo lavoro:{' '}
                  {formatEuroK(datiAdmin.margine_contribuzione.costo_lavoro)} = <strong>{formatEuroK(datiAdmin.margine_contribuzione.margine)}</strong>{' '}
                  ({formatPerc(datiAdmin.margine_contribuzione.margine_pct)})
                </p>
                <p className="ui-text-muted" style={{ fontSize: 'var(--fs-xs)', marginBottom: 0 }}>{datiAdmin.margine_contribuzione.nota}</p>
              </Card>
            )}
          </div>

          <div style={styleSezione}>
            <MixList titolo="Mix trattamento" items={datiAdmin.mix_trattamento} campo="trattamento" coloreDefault={coloreSerie(4)} />
            <MixList titolo="Mix tipo ospite" items={datiAdmin.mix_tipo_ospite} campo="tipo_ospite" coloreDefault={coloreSerie(6)} />
          </div>

          <Card title="Occupancy per giorno di stagione">
            <HeatmapOccupancy giorni={datiAdmin.heatmap_occupancy} />
          </Card>
        </>
      )}
    </div>
  )
}
