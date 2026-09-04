import { useState, useEffect, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../api/client.js'
import KPICard from '../components/KPICard.jsx'
import GaugeKpi from './home/GaugeKpi.jsx'
import BulletChart from './home/BulletChart.jsx'
import StripFreschezza from './home/StripFreschezza.jsx'
import TabellaSemaforo from './home/TabellaSemaforo.jsx'
import HeatmapOccupancy from './home/HeatmapOccupancy.jsx'
import MixList from './home/MixList.jsx'
import { formatEuro, formatEuroK, formatPerc, formatN, formatDataIt, mostraErrore } from '../utils/format.js'
import { isAdmin } from '../utils/auth.js'

const HOTEL_KEY = 'home_hotel'
const HOTELS = [
  { code: 'GRUPPO', label: 'Gruppo' },
  { code: 'DPH', label: 'Du Parc' },
  { code: 'CLB', label: 'Club Hotel' },
  { code: 'INT', label: 'International' },
]

const styleToggle = (attivo) => ({
  padding: '7px 18px',
  background: attivo ? '#3b82f6' : '#e5e7eb',
  color: attivo ? '#fff' : '#374151',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
})

const styleSezione = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }

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

  if (caricando && !dati) return <p>Caricamento cruscotto…</p>
  if (errore) return <div style={{ padding: '1rem', background: '#fee2e2', borderRadius: 8, color: '#991b1b' }}>{errore}</div>
  if (!dati) return null

  const kpi = dati.kpi_operativi
  const stagione = dati.stagione
  const vsBudget = dati.vs_budget

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Cruscotto {dati.anno}</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {HOTELS.map(h => (
            <button key={h.code} style={styleToggle(hotelCode === h.code)} onClick={() => setHotelCode(h.code)}>
              {h.label}
            </button>
          ))}
        </div>
      </div>

      {stagione && (
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: '1rem' }}>
          Stagione {formatDataIt(stagione.open_date)} – {formatDataIt(stagione.close_date)} ·{' '}
          {stagione.perc_trascorsa}% trascorsa · {stagione.giorni_alla_chiusura} giorni alla chiusura
          {dati.snapshot_date && <> · ultimo snapshot {formatDataIt(dati.snapshot_date)}</>}
        </div>
      )}

      {/* ── Tachimetri principali ── */}
      <div style={{ ...styleSezione, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <GaugeKpi label="Occupancy stagione" dato={kpi?.occupancy ?? { valore: null, soglia: null }} />
        {vsBudget && (
          <>
            <GaugeKpi label="Revenue vs budget" dato={vsBudget.revenue_total}
              formatValue={v => v == null ? '—' : `${v.toFixed(0)}%`} />
            <GaugeKpi label="RevPAR vs budget" dato={vsBudget.revpar}
              formatValue={v => v == null ? '—' : `${v.toFixed(0)}%`} />
            <GaugeKpi label="ADR vs budget" dato={vsBudget.adr}
              formatValue={v => v == null ? '—' : `${v.toFixed(0)}%`} />
          </>
        )}
        <GaugeKpi label="Pickup 7 giorni" dato={dati.pickup_7gg} formatValue={v => v == null ? '—' : formatEuroK(v)} />
        <GaugeKpi label="Contante su incassato" dato={dati.pagamenti?.perc_contante ?? { valore: null, soglia: null }} />
      </div>

      {kpi?.occupancy_per_mese?.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>Occupancy per mese</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
            {kpi.occupancy_per_mese.map(m => (
              <GaugeKpi
                key={m.mese}
                label={m.mese_label}
                dato={m.occupancy}
                sub={`${formatN(m.rooms_sold)} / ${formatN(m.rooms_available)} camere`}
              />
            ))}
          </div>
        </div>
      )}

      {kpi?.adr_per_mese?.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>ADR per mese</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
            {kpi.adr_per_mese.map(m => (
              <GaugeKpi
                key={m.mese}
                label={m.mese_label}
                dato={m.adr}
                formatValue={v => v == null ? '—' : formatEuro(v)}
                sub={`${formatN(m.rooms_sold)} camere vendute`}
              />
            ))}
          </div>
        </div>
      )}

      {!vsBudget && (
        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: -8, marginBottom: '1rem' }}>
          Nessun budget caricato per {dati.anno}: i tachimetri "vs budget" restano vuoti finché non viene inserito.
        </p>
      )}

      {/* ── KPI operativi ── */}
      {kpi && (
        <div className="grid-kpi">
          <KPICard label="Camere vendute" value={formatN(kpi.rooms_sold)} sub={`su ${formatN(kpi.rooms_available)} disponibili`} />
          <KPICard label="Revenue totale" value={formatEuroK(kpi.revenue_total)} />
          <KPICard label="ADR" value={formatEuro(kpi.adr)} />
          <KPICard label="RevPAR" value={formatEuro(kpi.revpar)} />
          <KPICard label="TRevPAR" value={formatEuro(kpi.trevpar)} />
          <KPICard label="RMC" value={formatEuro(kpi.rmc)} />
        </div>
      )}

      {/* ── Ritmo prenotazioni ── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>Ritmo prenotazioni — mese {dati.pace?.mese}/{dati.pace?.anno}</h3>
        {dati.pace?.punti?.length > 1 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dati.pace.punti}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="snapshot_date" tickFormatter={formatDataIt} fontSize={11} />
              <YAxis tickFormatter={v => formatEuroK(v)} fontSize={11} width={70} />
              <Tooltip formatter={v => formatEuro(v)} labelFormatter={formatDataIt} />
              <Line type="monotone" dataKey="otb_revenue" name="OTB cumulato" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Non ci sono ancora abbastanza snapshot per questo mese.</p>
        )}
        {dati.pace_anno_precedente ? (
          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8, marginBottom: 0 }}>
            Stessa distanza dall'apertura stagione, {dati.pace_anno_precedente.anno}: {formatEuroK(dati.pace_anno_precedente.otb_revenue)}
          </p>
        ) : (
          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 8, marginBottom: 0 }}>
            Confronto con l'anno precedente non disponibile (nessuno storico ancora caricato).
          </p>
        )}
      </div>

      {/* ── Mix ricavi ── */}
      <div style={styleSezione}>
        <MixList titolo="Mix canali" items={dati.mix_canali} campo="canale" />
        <MixList titolo="Mix categorie" items={dati.mix_categorie} campo="name" />
      </div>

      {/* ── Cassa ── */}
      <div style={styleSezione}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Cassa</h3>
          <p style={{ fontSize: 13, color: '#374151' }}>
            Tassa di soggiorno incassata (stagione): <strong>{formatEuro(dati.pagamenti?.tassa_soggiorno_incassata_stagione)}</strong>
          </p>
          {dati.commissioni_ota && (
            <p style={{ fontSize: 12, color: '#9ca3af' }}>
              Lordo canali OTA: {formatEuroK(dati.commissioni_ota.lordo_ota)} — commissione stimata {formatEuro(dati.commissioni_ota.commissione_stimata)}.
              {' '}{dati.commissioni_ota.nota}
            </p>
          )}
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Semaforo hotel</h3>
          <TabellaSemaforo righe={dati.semaforo_hotel} />
        </div>
      </div>

      <StripFreschezza dati={dati.freschezza} />

      {/* ── Fascia 2 — solo admin ── */}
      {admin && datiAdmin && (
        <>
          <h2 style={{ marginTop: '2rem', marginBottom: '1rem' }}>Solo admin</h2>

          <div style={{ ...styleSezione, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <GaugeKpi label="Costo lavoro / revenue" dato={datiAdmin.costo_lavoro?.labor_cost_ratio} />
            {datiAdmin.delta_rt_stagione?.RT1 && (
              <GaugeKpi label="Δ RT1 (Du Parc + Club)" dato={datiAdmin.delta_rt_stagione.RT1} formatValue={v => v == null ? '—' : formatEuro(v)} />
            )}
            {datiAdmin.delta_rt_stagione?.RT2 && (
              <GaugeKpi label="Δ RT2 (International)" dato={datiAdmin.delta_rt_stagione.RT2} formatValue={v => v == null ? '—' : formatEuro(v)} />
            )}
          </div>

          <div style={styleSezione}>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Costo del lavoro per struttura</h3>
              <p style={{ fontSize: 11, color: '#9ca3af', marginTop: -6 }}>
                Mesi chiusi coperti: {(datiAdmin.costo_lavoro?.mesi_coperti || []).join(', ') || '—'}
              </p>
              {(datiAdmin.costo_lavoro?.per_struttura || []).map(s => (
                <div key={s.struttura_code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderTop: '1px solid #f1f5f9' }}>
                  <span>{s.struttura_name}</span>
                  <span>{formatEuroK(s.costo_aziendale)} <span style={{ color: '#9ca3af' }}>({s.n_dipendenti} dip.)</span></span>
                </div>
              ))}
            </div>
            {datiAdmin.margine_contribuzione && (
              <div className="card">
                <h3 style={{ marginTop: 0 }}>Margine di contribuzione (parziale)</h3>
                <p style={{ fontSize: 13 }}>
                  Revenue: {formatEuroK(datiAdmin.margine_contribuzione.revenue_periodo)} − costo lavoro:{' '}
                  {formatEuroK(datiAdmin.margine_contribuzione.costo_lavoro)} = <strong>{formatEuroK(datiAdmin.margine_contribuzione.margine)}</strong>{' '}
                  ({formatPerc(datiAdmin.margine_contribuzione.margine_pct)})
                </p>
                <p style={{ fontSize: 11, color: '#9ca3af' }}>{datiAdmin.margine_contribuzione.nota}</p>
              </div>
            )}
          </div>

          <div style={styleSezione}>
            <MixList titolo="Mix trattamento" items={datiAdmin.mix_trattamento} campo="trattamento" coloreDefault="#8b5cf6" />
            <MixList titolo="Mix tipo ospite" items={datiAdmin.mix_tipo_ospite} campo="tipo_ospite" coloreDefault="#ec4899" />
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Occupancy per giorno di stagione</h3>
            <HeatmapOccupancy giorni={datiAdmin.heatmap_occupancy} />
          </div>
        </>
      )}
    </div>
  )
}
