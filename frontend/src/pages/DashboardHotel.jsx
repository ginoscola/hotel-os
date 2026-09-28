import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceArea,
} from 'recharts'
import api from '../api/client.js'
import { ExportMenu } from '../components/ExportMenu.jsx'
import NavigazioneSnapshot from '../components/NavigazioneSnapshot.jsx'
import pastReferenceArea from '../components/PastReferenceArea.jsx'
import { useSnapshotConfronto } from '../hooks/useSnapshotConfronto.js'
import {
  formatEuro, formatPerc, formatN, formatData, addDays, calcolaDelta, mostraErrore,
} from '../utils/format.js'
import {
  Badge, Card, KpiTile, Loading, Messaggio, PageHeader, SegmentedControl, SezioneApribile, StatoVuoto,
  Table, Td, Th,
} from '../components/ui'
import { colors, COLORI_REVENUE, STILE_CONFRONTO } from '../styles/tokens.js'

const HOTEL_CODES = ['CLB', 'DPH', 'INT']
const HOTEL_NOMI = { CLB: 'Club Hotel', DPH: 'Hotel Du Parc', INT: 'Hotel International' }

const MESI_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]

function aggregaMensile(giorni) {
  const mesi = {}
  for (const g of giorni) {
    if (!g.data) continue
    const ym = g.data.slice(0, 7)
    if (!mesi[ym]) {
      mesi[ym] = {
        ym, rooms_sold: 0, rooms_available: 0,
        revenue_rooms: 0, revenue_fnb: 0, revenue_extra: 0, revenue_total: 0,
        giorni_presenze: 0,
      }
    }
    const m = mesi[ym]
    m.rooms_sold     += g.rooms_sold     || 0
    m.rooms_available += g.rooms_available || 0
    m.revenue_rooms  += g.revenue_rooms  || 0
    m.revenue_fnb    += g.revenue_fnb    || 0
    m.revenue_extra  += g.revenue_extra  || 0
    m.revenue_total  += g.revenue_total  || 0
    if ((g.rooms_sold || 0) > 0) m.giorni_presenze += 1
  }
  return Object.values(mesi)
    .filter(m => m.rooms_sold > 0)
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .map(m => {
      const [year, month] = m.ym.split('-')
      const label    = `${MESI_IT[parseInt(month) - 1]} ${year}`
      const rs = m.rooms_sold, ra = m.rooms_available, rt = m.revenue_total
      return {
        label,
        giorni:      m.giorni_presenze,
        rooms_sold:  rs,
        rooms_available: ra,
        revenue_rooms:  m.revenue_rooms,
        revenue_fnb:    m.revenue_fnb,
        revenue_extra:  m.revenue_extra,
        revenue_total:  rt,
        occupancy: ra > 0 ? (rs / ra * 100) : null,
        adr:       rs > 0 ? (m.revenue_rooms / rs) : null,
        rmc:       rs > 0 ? (rt / rs) : null,
        revpar:    ra > 0 ? (m.revenue_rooms / ra) : null,
        trevpar:   ra > 0 ? (rt / ra) : null,
        inc_rooms: rt > 0 ? (m.revenue_rooms / rt * 100) : null,
        inc_fnb:   rt > 0 ? (m.revenue_fnb   / rt * 100) : null,
        inc_extra: rt > 0 ? (m.revenue_extra  / rt * 100) : null,
      }
    })
}

/**
 * Allinea i dati di confronto ai giorni correnti.
 * Per "anno precedente": le date di confronto (es. 2025-05-03) vengono
 * spostate di +364 giorni per collimare con le date 2026.
 * Per "settimana precedente": allineamento per data esatta.
 */
function mergeConfrontoGiorni(giorni, giorniComp, isAnnoPrecedente) {
  if (!giorniComp || giorniComp.length === 0) return giorni
  const compMap = {}
  giorniComp.forEach(g => {
    const key = isAnnoPrecedente ? addDays(g.data, 364) : g.data
    compMap[key] = g
  })
  return giorni.map(g => {
    const comp = compMap[g.data]
    return {
      ...g,
      occupancy_comp: comp?.occupancy ?? null,
      revenue_rooms_comp: comp?.revenue_rooms ?? null,
      revenue_fnb_comp: comp?.revenue_fnb ?? null,
      revenue_extra_comp: comp?.revenue_extra ?? null,
      revenue_total_comp: comp?.revenue_total ?? null,
    }
  })
}

// Formatta solo le date Sabato (inizio settimana commerciale) per l'asse X
function tickFormatterSabato(isoDate) {
  const d = new Date(isoDate + 'T00:00:00')
  if (d.getDay() === 6) {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  return ''
}


// Etichetta leggibile di una data ISO per i tooltip dei grafici giornalieri
const labelDataTooltip = val => {
  const d = new Date(val + 'T00:00:00')
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

// Colonne standard delle tabelle giornaliere (Dati mensili / Dati giornalieri)
function IntestazioneGiorni() {
  return (
    <thead>
      <tr>
        <Th>Giorno</Th><Th num>Cam. vend.</Th><Th num>PAX</Th><Th num>Occup.</Th><Th num>ADR</Th>
        <Th num>RMC</Th><Th num>RevPAR</Th><Th num>TRevPAR</Th><Th num>Rev. Camere</Th>
        <Th num>Rev. F&B</Th><Th num>Rev. Extra</Th><Th num tot>Rev. Totale</Th>
      </tr>
    </thead>
  )
}
function CelleGiorno({ g }) {
  return (
    <>
      <Td num>{formatN(g.rooms_sold)}</Td>
      <Td num>{formatN(g.pax)}</Td>
      <Td num>{g.occupancy != null ? formatPerc(g.occupancy) : '—'}</Td>
      <Td num>{g.adr != null ? formatEuro(g.adr) : '—'}</Td>
      <Td num>{g.rmc != null ? formatEuro(g.rmc) : '—'}</Td>
      <Td num>{g.revpar != null ? formatEuro(g.revpar) : '—'}</Td>
      <Td num>{g.trevpar != null ? formatEuro(g.trevpar) : '—'}</Td>
      <Td num>{formatEuro(g.revenue_rooms)}</Td>
      <Td num>{formatEuro(g.revenue_fnb)}</Td>
      <Td num>{formatEuro(g.revenue_extra)}</Td>
      <Td num tot>{formatEuro(g.revenue_total)}</Td>
    </>
  )
}

// Colonne standard delle tabelle aggregate (mensili / settimanali)
function IntestazioneAggregati({ prima }) {
  return (
    <thead>
      <tr>
        <Th>{prima}</Th><Th num>Gg.</Th><Th num>Cam. vend.</Th><Th num>Occup. %</Th><Th num>ADR</Th>
        <Th num>RMC</Th><Th num>RevPAR</Th><Th num>TRevPAR</Th><Th num>Inc. Rooms</Th>
        <Th num>Inc. F&B</Th><Th num>Inc. Extra</Th><Th num tot>Rev. Totale</Th>
      </tr>
    </thead>
  )
}
function CelleAggregato({ m }) {
  return (
    <>
      <Td num>{m.giorni}</Td>
      <Td num>{formatN(m.rooms_sold)}</Td>
      <Td num>{m.occupancy != null ? formatPerc(m.occupancy) : '—'}</Td>
      <Td num>{m.adr != null ? formatEuro(m.adr) : '—'}</Td>
      <Td num>{m.rmc != null ? formatEuro(m.rmc) : '—'}</Td>
      <Td num>{m.revpar != null ? formatEuro(m.revpar) : '—'}</Td>
      <Td num>{m.trevpar != null ? formatEuro(m.trevpar) : '—'}</Td>
      <Td num>{m.inc_rooms != null ? formatPerc(m.inc_rooms) : '—'}</Td>
      <Td num>{m.inc_fnb != null ? formatPerc(m.inc_fnb) : '—'}</Td>
      <Td num>{m.inc_extra != null ? formatPerc(m.inc_extra) : '—'}</Td>
      <Td num tot>{formatEuro(m.revenue_total)}</Td>
    </>
  )
}

export default function DashboardHotel() {
  const { hotelCode } = useParams()
  const navigate = useNavigate()
  const [hotel, setHotel] = useState((hotelCode || 'CLB').toUpperCase())

  const [snapshots, setSnapshots] = useState([])
  const [snapIdx, setSnapIdx] = useState(0)

  const [confrontaPrevSett, setConfrontaPrevSett] = useState(false)
  const [confrontaPrevAnno, setConfrontaPrevAnno] = useState(false)

  const [dati, setDati] = useState(null)
  const [datiComp, setDatiComp] = useState(null)
  const [compDisponibile, setCompDisponibile] = useState(true)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)

  const [giornalieriEspansi, setGiornalieriEspansi] = useState(false)

  // Sincronizza hotel state con il parametro URL (navigazione da NavBar)
  useEffect(() => {
    if (hotelCode) setHotel(hotelCode.toUpperCase())
  }, [hotelCode])

  // Carica lista snapshot al cambio hotel
  useEffect(() => {
    setDati(null)
    setDatiComp(null)
    setSnapshots([])
    setSnapIdx(0)
    api.get(`/snapshots/${hotel}`)
      .then(({ data }) => setSnapshots(data.snapshots || []))
      .catch(() => setSnapshots([]))
    setGiornalieriEspansi(false)   // sempre compresso all'apertura, come i "Dati mensili"
  }, [hotel])

  const currentSnap = snapshots[snapIdx] || null

  const compSnap = useSnapshotConfronto({ snapshots, snapIdx, confrontaPrevSett, confrontaPrevAnno })

  // Carica dati dashboard al cambio snapshot o confronto
  const caricaDati = useCallback(async () => {
    if (!currentSnap) return
    setLoading(true)
    setErrore(null)
    try {
      const { data } = await api.get(
        `/dashboard/hotel/${hotel}?snapshot=${currentSnap.snapshot_date}`
      )
      setDati(data)

      const confrontoAttivo = confrontaPrevSett || confrontaPrevAnno
      if (confrontoAttivo && compSnap) {
        try {
          const { data: comp } = await api.get(
            `/dashboard/hotel/${hotel}?snapshot=${compSnap.snapshot_date}`
          )
          setDatiComp(comp)
          setCompDisponibile(true)
        } catch {
          setDatiComp(null)
          setCompDisponibile(false)
        }
      } else {
        setDatiComp(null)
        setCompDisponibile(!confrontoAttivo || !!(confrontoAttivo && compSnap))
      }
    } catch (err) {
      setErrore(mostraErrore(err))
      setDati(null)
    } finally {
      setLoading(false)
    }
  }, [hotel, currentSnap, compSnap, confrontaPrevSett, confrontaPrevAnno])

  useEffect(() => { caricaDati() }, [caricaDati])

  function handleHotelChange(code) {
    setHotel(code)
    navigate(`/dashboard/hotel/${code}`)
  }

  function toggleGiornalieri() {
    setGiornalieriEspansi(v => !v)   // stato solo in-memory, non persistito
  }

  const compLabel = confrontaPrevSett
    ? (compSnap ? compSnap.label : 'sett. prec.')
    : confrontaPrevAnno ? 'anno prec.' : null

  const confrontoAttivo = confrontaPrevSett || confrontaPrevAnno
  const mostraCompNonDisp = confrontoAttivo && !compDisponibile

  return (
    <div>
      <PageHeader title={HOTEL_NOMI[hotel] || hotel} subtitle="Dashboard hotel">
        <SegmentedControl value={hotel} onChange={handleHotelChange}
          options={HOTEL_CODES.map(c => ({ value: c, label: HOTEL_NOMI[c] }))} />
      </PageHeader>

      {/* Navigazione snapshot */}
      {snapshots.length > 0 && currentSnap && (
        <NavigazioneSnapshot
          titolo={`Snapshot ${currentSnap.label}`}
          sottotitolo={`(${snapshots.length} snapshot disponibili)`}
          extra={currentSnap.n_anomalie > 0 && (
            <Badge tono="warn" style={{ marginLeft: 10 }}
              title={`${currentSnap.n_anomalie} anomali${currentSnap.n_anomalie === 1 ? 'a' : 'e'} rilevat${currentSnap.n_anomalie === 1 ? 'a' : 'e'} durante l'import`}>
              ⚠ {currentSnap.n_anomalie} anomali{currentSnap.n_anomalie === 1 ? 'a' : 'e'}
            </Badge>
          )}
          onPrec={() => setSnapIdx(i => i + 1)} disPrec={snapIdx >= snapshots.length - 1}
          onSucc={() => setSnapIdx(i => i - 1)} disSucc={snapIdx <= 0}
          confrontaPrec={confrontaPrevSett} onConfrontaPrec={setConfrontaPrevSett}
          confrontaAnno={confrontaPrevAnno} onConfrontaAnno={setConfrontaPrevAnno}
          confrontoNonDisponibile={mostraCompNonDisp}
        />
      )}

      {snapshots.length === 0 && !loading && (
        <StatoVuoto>Nessuna snapshot disponibile per {HOTEL_NOMI[hotel] || hotel}. Importare prima i file CSV.</StatoVuoto>
      )}

      {loading && <Loading />}
      <Messaggio tipo="err">{errore}</Messaggio>

      {dati && (
        <ContenutoDashboard
          dati={dati}
          datiComp={compDisponibile ? datiComp : null}
          compLabel={compLabel}
          isAnnoPrecedente={confrontaPrevAnno}
          hotel={hotel}
          currentSnap={currentSnap}
          giornalieriEspansi={giornalieriEspansi}
          onToggleGiornalieri={toggleGiornalieri}
        />
      )}
    </div>
  )
}

function CardCorrispettivi({ hotel, data }) {
  const [kpi, setKpi] = useState(null)

  useEffect(() => {
    if (!data) return
    setKpi(null)
    api.get(`/corrispettivi/kpi/giornaliero?data=${data}&struttura_code=${hotel}`)
      .then(r => setKpi(r.data))
      .catch(() => setKpi(null))
  }, [hotel, data])

  if (!kpi || kpi.n_documenti === 0) return null

  return (
    <Card title={`Corrispettivi — ${formatData(data)}`} style={{ marginBottom: 24 }}>
      <div className="ui-kpi-row" style={{ marginBottom: 0 }}>
        <KpiTile label="Documenti" value={kpi.n_documenti} />
        <KpiTile label="Incassato" value={formatEuro(kpi.totale_incassato)} />
        {kpi.totale_sospeso > 0 && <KpiTile label="Sospeso" value={formatEuro(kpi.totale_sospeso)} colore={colors.warning} />}
        {kpi.n_sospesi_aperti > 0 && <KpiTile label="Sospesi aperti" value={kpi.n_sospesi_aperti} colore={colors.danger} />}
      </div>
    </Card>
  )
}

function TabellaAggregatiMensili({ mesi, exportUrl, exportNome, exportSnapshot }) {
  if (!mesi || mesi.length === 0) return null

  const tot = mesi.reduce((acc, m) => {
    acc.rooms_sold      += m.rooms_sold
    acc.rooms_available += m.rooms_available
    acc.revenue_rooms   += m.revenue_rooms
    acc.revenue_fnb     += m.revenue_fnb
    acc.revenue_extra   += m.revenue_extra
    acc.revenue_total   += m.revenue_total
    acc.giorni          += m.giorni
    return acc
  }, { rooms_sold: 0, rooms_available: 0, revenue_rooms: 0, revenue_fnb: 0, revenue_extra: 0, revenue_total: 0, giorni: 0 })

  const { rooms_sold: rs, rooms_available: ra, revenue_total: rt } = tot
  const totKpi = {
    ...tot,
    occupancy: ra > 0 ? (rs / ra * 100) : null,
    adr:       rs > 0 ? (tot.revenue_rooms / rs) : null,
    rmc:       rs > 0 ? (rt / rs) : null,
    revpar:    ra > 0 ? (tot.revenue_rooms / ra) : null,
    trevpar:   ra > 0 ? (rt / ra) : null,
    inc_rooms: rt > 0 ? (tot.revenue_rooms / rt * 100) : null,
    inc_fnb:   rt > 0 ? (tot.revenue_fnb   / rt * 100) : null,
    inc_extra: rt > 0 ? (tot.revenue_extra  / rt * 100) : null,
  }

  return (
    <Card title="Aggregati mensili — intera stagione" style={{ marginBottom: 24 }}
      actions={<ExportMenu url={exportUrl} nome={exportNome} snapshot={exportSnapshot} />}>
      <Table compact>
        <IntestazioneAggregati prima="Mese" />
        <tbody>
          {mesi.map((m, i) => (
            <tr key={i}><Td>{m.label}</Td><CelleAggregato m={m} /></tr>
          ))}
          <tr className="ui-riga-sezione"><Td>TOTALE STAGIONE</Td><CelleAggregato m={totKpi} /></tr>
        </tbody>
      </Table>
    </Card>
  )
}

/**
 * Raggruppa i dati giornalieri per mese solare.
 * Ogni mese contiene le sue righe giornaliere e una riga totale con i KPI
 * ricalcolati sui totali del mese (mai media dei KPI giornalieri).
 */
function aggregaGiorniPerMese(giorni) {
  const mesi = {}
  for (const g of giorni) {
    if (!g.data) continue
    const ym = g.data.slice(0, 7)
    if (!mesi[ym]) mesi[ym] = { ym, giorni: [] }
    mesi[ym].giorni.push(g)
  }
  return Object.values(mesi)
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .map(m => {
      const [year, month] = m.ym.split('-')
      const t = m.giorni.reduce((acc, g) => {
        acc.rooms_sold      += g.rooms_sold      || 0
        acc.rooms_available += g.rooms_available  || 0
        acc.pax             += g.pax             || 0
        acc.revenue_rooms   += g.revenue_rooms   || 0
        acc.revenue_fnb     += g.revenue_fnb     || 0
        acc.revenue_extra   += g.revenue_extra   || 0
        acc.revenue_total   += g.revenue_total   || 0
        return acc
      }, { rooms_sold: 0, rooms_available: 0, pax: 0, revenue_rooms: 0, revenue_fnb: 0, revenue_extra: 0, revenue_total: 0 })
      const { rooms_sold: rs, rooms_available: ra, revenue_rooms: rr, revenue_total: rt } = t
      return {
        ym: m.ym,
        label: `${MESI_IT[parseInt(month) - 1]} ${year}`,
        giorni: m.giorni,
        totale: {
          ...t,
          occupancy: ra > 0 ? (rs / ra * 100) : null,
          adr:       rs > 0 ? (rr / rs) : null,
          rmc:       rs > 0 ? (rt / rs) : null,
          revpar:    ra > 0 ? (rr / ra) : null,
          trevpar:   ra > 0 ? (rt / ra) : null,
        },
      }
    })
}

/**
 * Sezione "Dati mensili": un blocco collassabile per ogni mese della stagione,
 * ciascuno con tutte le righe giornaliere del mese + riga totale.
 * All'apertura della pagina tutti i mesi sono compressi.
 */
function SezioneDatiMensili({ mesi, refStart, refEnd, hotel, snapParam, snapDate }) {
  const [aperti, setAperti] = useState({})
  if (!mesi || mesi.length === 0) return null
  const toggle = ym => setAperti(a => ({ ...a, [ym]: !a[ym] }))

  const urlExportMese = m => {
    const da = m.giorni[0].data
    const a = m.giorni[m.giorni.length - 1].data
    const params = [snapParam, `da=${da}`, `a=${a}`].filter(Boolean).join('&')
    return `/export/hotel/${hotel}/giornaliero?${params}`
  }

  return (
    <Card title="Dati mensili — dettaglio giornaliero per mese" style={{ marginBottom: 24 }}>
      {mesi.map(m => {
        const aperto = !!aperti[m.ym]
        const t = m.totale
        return (
          <div key={m.ym} style={{ marginBottom: 10, border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div onClick={() => toggle(m.ym)} role="button" aria-expanded={aperto}
              style={{
                cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', gap: 12, padding: '8px 14px', background: colors.surfaceAlt,
              }}>
              <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: colors.textMuted, transform: aperto ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
                {m.label}
              </strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="ui-text-muted ui-num">{m.giorni.length} gg · {formatEuro(t.revenue_total)}</span>
                <ExportMenu url={urlExportMese(m)} nome={`${hotel}_giornaliero_${m.ym}`} snapshot={snapDate}
                  onClick={e => e.stopPropagation()} />
              </div>
            </div>
            {aperto && (
              <div style={{ padding: 10 }}>
                <Table compact>
                  <IntestazioneGiorni />
                  <tbody>
                    {m.giorni.map((g, i) => (
                      <tr key={i} className={refStart && g.data >= refStart && g.data <= refEnd ? 'ui-riga-evidenza' : undefined}>
                        <Td>{g.label}</Td><CelleGiorno g={g} />
                      </tr>
                    ))}
                    <tr className="ui-riga-sezione"><Td>TOTALE {m.label}</Td><CelleGiorno g={t} /></tr>
                  </tbody>
                </Table>
              </div>
            )}
          </div>
        )
      })}
    </Card>
  )
}

function ContenutoDashboard({
  dati, datiComp, compLabel, isAnnoPrecedente,
  hotel, currentSnap, giornalieriEspansi, onToggleGiornalieri,
}) {
  const kpi      = dati.kpi_stagione ?? {}
  const kpiComp  = datiComp?.kpi_stagione ?? null
  const giorni   = dati.giorni || []
  const settimane = dati.settimane || []
  const refStart  = dati.settimana_ref_start || null
  const refEnd    = dati.settimana_ref_end || null

  const giorniMerged = useMemo(
    () => mergeConfrontoGiorni(giorni, datiComp?.giorni, isAnnoPrecedente),
    [giorni, datiComp, isAnnoPrecedente]
  )

  const mesiAggregati = useMemo(() => aggregaMensile(giorni), [giorni])
  const mesiGiornalieri = useMemo(() => aggregaGiorniPerMese(giorni), [giorni])

  function kpiDelta(key) { return calcolaDelta(kpi[key], kpiComp?.[key]) }
  function kpiCompV(key, fmt) {
    return kpiComp ? (kpiComp[key] != null ? fmt(kpiComp[key]) : '—') : null
  }

  const snapParam = currentSnap ? `snapshot=${currentSnap.snapshot_date}` : ''
  const snapDate = currentSnap?.snapshot_date || null
  const exportSett = `/export/hotel/${hotel}/settimanale?${snapParam}`
  const exportGiorn = `/export/hotel/${hotel}/giornaliero?${snapParam}`
  const exportMens = `/export/hotel/${hotel}/mensile?${snapParam}`

  // Etichetta intestazione settimana di riferimento
  const refLabel = refStart
    ? (() => {
        const d = new Date(refStart + 'T00:00:00')
        const de = new Date(refEnd + 'T00:00:00')
        const fmt = (dt) => `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}`
        return `${fmt(d)}–${fmt(de)}`
      })()
    : null

  // Area della settimana di riferimento nei grafici giornalieri
  const areaRif = (conEtichetta) => refStart && refEnd && (
    <ReferenceArea x1={refStart} x2={refEnd} fill={colors.info} fillOpacity={conEtichetta ? 0.1 : 0.08}
      label={conEtichetta ? { value: 'Sett. rif.', position: 'insideTopLeft', fontSize: 9, fill: colors.info } : undefined} />
  )

  return (
    <>
      {/* KPI stagione — totali intera stagione nella snapshot */}
      <Card style={{ marginBottom: 24 }}
        title={<span>KPI stagione{' '}
          <span className="ui-text-muted" style={{ fontWeight: 400 }}>
            {dati.periodo_da && dati.periodo_a ? `${formatData(dati.periodo_da)} – ${formatData(dati.periodo_a)}` : ''}
            {compLabel && datiComp && <span style={{ marginLeft: 8 }}>vs. {compLabel}</span>}
          </span>
        </span>}>
        <div className="ui-kpi-grid" style={{ marginBottom: 0 }}>
          {[
            ['Camere vendute', 'rooms_sold', formatN],
            ['Occupazione', 'occupancy', formatPerc],
            ['ADR', 'adr', formatEuro],
            ['RMC', 'rmc', formatEuro],
            ['RevPAR', 'revpar', formatEuro],
            ['TRevPAR', 'trevpar', formatEuro],
            ['Inc. Rooms', 'inc_rooms', formatPerc],
            ['Inc. F&B', 'inc_fnb', formatPerc],
            ['Inc. Extra', 'inc_extra', formatPerc],
            ['Tot. Revenue', 'revenue_total', formatEuro],
          ].map(([label, key, fmt]) => (
            <KpiTile key={key} label={label}
              value={kpi[key] != null ? fmt(kpi[key]) : '—'}
              confronto={kpiCompV(key, fmt)} confrontoLabel={compLabel} delta={kpiDelta(key)} />
          ))}
        </div>
      </Card>

      {/* Grafico occupazione giornaliera — intera stagione */}
      <Card title="Occupazione giornaliera — intera stagione" style={{ marginBottom: 24 }}
        actions={<ExportMenu url={exportGiorn} nome={`${hotel}_giornaliero`} snapshot={snapDate} />}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={giorniMerged} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="data" tickFormatter={tickFormatterSabato} interval={0} tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={v => `${v}%`} domain={[0, 100]} width={40} />
            <Tooltip labelFormatter={labelDataTooltip}
              formatter={(v, n) => [v != null ? `${Number(v).toFixed(1)}%` : '—', n]} />
            <Legend />
            {pastReferenceArea(giorniMerged, 'data', null, currentSnap?.snapshot_date)}
            {areaRif(true)}
            <Line type="monotone" dataKey="occupancy" stroke={colors.info} dot={false} name="Occupazione %" strokeWidth={2} />
            {datiComp && (
              <Line type="monotone" dataKey="occupancy_comp" stroke={colors.info} dot={false}
                name={`Occup. ${compLabel}`} {...STILE_CONFRONTO} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Grafico revenue giornaliero — linee in confronto, barre a tipologia senza confronto */}
      <Card style={{ marginBottom: 24 }}
        title={datiComp ? 'Revenue totale giornaliero — confronto' : 'Revenue giornaliero per tipologia — intera stagione'}
        actions={<ExportMenu url={exportGiorn} nome={`${hotel}_giornaliero`} snapshot={snapDate} />}>
        <ResponsiveContainer width="100%" height={260}>
          {datiComp ? (
            <LineChart data={giorniMerged} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="data" tickFormatter={tickFormatterSabato} interval={0} tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`} width={40} />
              <Tooltip labelFormatter={labelDataTooltip} formatter={v => v != null ? formatEuro(v) : '—'} />
              <Legend />
              {pastReferenceArea(giorniMerged, 'data', null, currentSnap?.snapshot_date)}
              {areaRif(false)}
              <Line dataKey="revenue_total" name="Revenue" stroke={colors.info} dot={false} strokeWidth={2} connectNulls />
              <Line dataKey="revenue_total_comp" name={`Revenue ${compLabel}`} stroke={colors.info}
                dot={false} connectNulls {...STILE_CONFRONTO} />
            </LineChart>
          ) : (
            <BarChart data={giorniMerged} margin={{ top: 4, right: 20, bottom: 4, left: 0 }} barCategoryGap="10%">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="data" tickFormatter={tickFormatterSabato} interval={0} tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`} width={40} />
              <Tooltip labelFormatter={labelDataTooltip} formatter={v => formatEuro(v)} />
              <Legend />
              {pastReferenceArea(giorniMerged, 'data', null, currentSnap?.snapshot_date)}
              {areaRif(false)}
              <Bar dataKey="revenue_rooms" name="Camere" fill={COLORI_REVENUE.camere} stackId="curr" />
              <Bar dataKey="revenue_fnb" name="F&B" fill={COLORI_REVENUE.fnb} stackId="curr" />
              <Bar dataKey="revenue_extra" name="Extra" fill={COLORI_REVENUE.extra} stackId="curr" />
            </BarChart>
          )}
        </ResponsiveContainer>
      </Card>

      {/* Aggregati mensili — intera stagione */}
      <TabellaAggregatiMensili mesi={mesiAggregati}
        exportUrl={exportMens} exportNome={`${hotel}_mensile`} exportSnapshot={snapDate} />

      {/* Tabella aggregati settimanali — intera stagione */}
      {settimane.length > 0 && (
        <Card title="Aggregati settimanali — intera stagione" style={{ marginBottom: 24 }}
          actions={<ExportMenu url={exportSett} nome={`${hotel}_settimanale`} snapshot={snapDate} />}>
          <Table compact>
            <IntestazioneAggregati prima="Settimana" />
            <tbody>
              {settimane.map((s, i) => {
                const isRef = refStart && s.week_start === refStart
                const incompleta = !s.settimana_completa
                return (
                  <tr key={i} className={isRef ? 'ui-riga-evidenza' : undefined}
                    style={{ fontStyle: incompleta ? 'italic' : 'normal', fontWeight: isRef ? 700 : undefined }}>
                    <Td style={{ color: incompleta ? colors.textMuted : undefined }}>
                      {isRef && <span className="ui-dot" style={{ background: colors.info, width: 6, height: 6, marginRight: 6 }} />}
                      {s.label}
                    </Td>
                    <CelleAggregato m={s} />
                  </tr>
                )
              })}
            </tbody>
          </Table>
          <div className="ui-text-muted" style={{ marginTop: 6, fontSize: 'var(--fs-xs)' }}>
            ● = settimana di riferimento della snapshot · <em>corsivo</em> = settimana parziale
          </div>
        </Card>
      )}

      {/* Dati mensili — un blocco collassabile per mese, tra settimanali e giornalieri */}
      <SezioneDatiMensili mesi={mesiGiornalieri} refStart={refStart} refEnd={refEnd}
        hotel={hotel} snapParam={snapParam} snapDate={snapDate} />

      {/* Tabella giornaliera — collassabile */}
      {giorni.length > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <SezioneApribile
            titolo={`Dati giornalieri (${giorni.length} giorni)`}
            aperta={giornalieriEspansi}
            onToggle={onToggleGiornalieri}
            azioni={<ExportMenu url={exportGiorn} nome={`${hotel}_giornaliero`} snapshot={snapDate} />}
          >
            <Table compact>
              <IntestazioneGiorni />
              <tbody>
                {giorni.map((g, i) => (
                  <tr key={i} className={refStart && g.data >= refStart && g.data <= refEnd ? 'ui-riga-evidenza' : undefined}>
                    <Td>{g.label}</Td><CelleGiorno g={g} />
                  </tr>
                ))}
              </tbody>
            </Table>
          </SezioneApribile>
        </Card>
      )}

      {/* Card Corrispettivi — mostra KPI del giorno di riferimento se disponibili */}
      {refStart && <CardCorrispettivi hotel={hotel} data={refStart} />}
    </>
  )
}
