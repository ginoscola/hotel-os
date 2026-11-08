import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceArea, ReferenceLine, Cell,
} from 'recharts'
import api from '../api/client.js'
import { ExportMenu } from '../components/ExportMenu.jsx'
import NavigazioneSnapshot from '../components/NavigazioneSnapshot.jsx'
import pastReferenceArea from '../components/PastReferenceArea.jsx'
import SpiegazioneWave from '../components/SpiegazioneWave.jsx'
import TooltipConTotale from '../components/TooltipConTotale.jsx'
import { useSnapshotConfronto } from '../hooks/useSnapshotConfronto.js'
import { formatEuro, formatPerc, formatN, formatData, addDays, calcolaDelta, mostraErrore, erroreDaSegnalare } from '../utils/format.js'
import {
  Badge, Card, KpiTile, Loading, Messaggio, PageHeader, SegmentedControl, SezioneApribile, StatoVuoto,
  Table, Td, Th, useAvvisi
} from '../components/ui'
import { colors, coloreSerie, COLORI_REVENUE, STILE_CONFRONTO } from '../styles/tokens.js'

// Indice WAVE (services/wave_hotel.py): calcolato dal backend, qui solo mostrato
const COLORE_WAVE = coloreSerie(4)
const fmtWave = v => (v != null ? formatPerc(v) : '—')

/** Periodo WAVE del mese (aprile e maggio = blocco "inizio"), solo per l'anno della snapshot. */
function wavePeriodoMese(wave, ym) {
  if (!wave) return null
  const [anno, mese] = ym.split('-').map(Number)
  if (anno !== wave.anno) return null
  const codice = mese === 4 || mese === 5 ? 'inizio' : ({ 6: 'giugno', 7: 'luglio', 8: 'agosto', 9: 'settembre' })[mese]
  return wave.periodi.find(p => p.periodo === codice) ?? null
}

/** Totali di una lista di aggregati (mesi o settimane) con KPI ricalcolati sui totali, mai medie. */
function totaliAggregati(righe) {
  const tot = righe.reduce((acc, m) => {
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
  return {
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
}

const HOTEL_CODES = ['CLB', 'DPH', 'INT']
const HOTEL_NOMI = { CLB: 'Club Hotel', DPH: 'Hotel Du Parc', INT: 'Hotel International' }
// Array vuoto condiviso per i dati mancanti: `x || []` ne creava uno nuovo a ogni disegno e
// faceva ricalcolare inutilmente i useMemo che lo usano. Mai modificarlo sul posto.
const VUOTO = []

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
        ym: m.ym,
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
      rmc_comp: comp?.rmc ?? null,
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
        <Th>Giorno</Th><Th num>Cam. vend.</Th><Th num>PAX</Th><Th num>Occup.</Th><Th num>ADR PMS</Th>
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
        <Th>{prima}</Th><Th num>Gg.</Th><Th num>Cam. vend.</Th><Th num>Occup. %</Th><Th num>ADR PMS</Th>
        <Th num>RMC</Th><Th num>RevPAR</Th><Th num>TRevPAR</Th><Th num>Inc. Rooms</Th>
        <Th num>Inc. F&B</Th><Th num>Inc. Extra</Th><Th num tot>Rev. Totale</Th>
        <Th num>WAVE <SpiegazioneWave /></Th>
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
  const avvisi = useAvvisi()
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
      .catch(e => { setSnapshots([]); const m = erroreDaSegnalare(e); if (m) avvisi.errore(m) })
    setGiornalieriEspansi(false)   // sempre compresso all'apertura, come i "Dati mensili"
  }, [hotel, avvisi])

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

/**
 * Separa consuntivo e prenotato alla data della snapshot: una settimana è `futura` se non è ancora finita prima di
 * quella data (contiene prenotato). I valori di `chiave` delle future passano in `{chiave}_fut` (linea tratteggiata),
 * che parte dall'ultimo punto chiuso per non lasciare un buco tra le due linee.
 */
function separaPrenotato(righe, chiave, snapshotDate) {
  const out = righe.map(r => {
    const futura = !!snapshotDate && (r.fine ?? addDays(r.week_start, 6)) >= snapshotDate
    return { ...r, futura, [chiave]: futura ? null : r[chiave], [`${chiave}_fut`]: futura ? r[chiave] : null }
  })
  const primaFutura = out.findIndex(r => r.futura && r[`${chiave}_fut`] != null)
  if (primaFutura > 0) {
    for (let i = primaFutura - 1; i >= 0; i--) {
      if (out[i][chiave] != null) { out[i][`${chiave}_fut`] = out[i][chiave]; break }
    }
  }
  return out
}

/**
 * Scarto in euro dal 100% WAVE: una riga per il blocco "Inizio stagione" (apr+mag) + una per ogni settimana di
 * giugno–settembre; `cumulato` = scarto accumulato da inizio stagione (ultimo punto = scarto di stagione).
 */
function righeScartoWave(wave) {
  if (!wave) return []
  const righe = []
  let cum = 0
  const inizio = wave.periodi.find(p => p.periodo === 'inizio')
  if (inizio?.riferimento != null) {
    cum = (inizio.valore ?? 0) - inizio.riferimento
    righe.push({ week_start: `${wave.anno}-05-01`, label: 'Apr+mag', fine: `${wave.anno}-05-31`, scarto: cum, cumulato: cum })
  }
  for (const s of wave.settimane) {
    if (s.riferimento == null) continue
    const scarto = (s.valore ?? 0) - s.riferimento
    cum += scarto
    righe.push({ week_start: s.week_start, scarto, cumulato: cum })
  }
  return righe
}

function GraficoScartoWave({ wave, waveComp, compLabel, isAnnoPrecedente, snapshotDate }) {
  const dati = useMemo(() => {
    const comp = {}
    for (const r of righeScartoWave(waveComp)) {
      const k = r.label ? 'inizio' : (isAnnoPrecedente ? addDays(r.week_start, 364) : r.week_start)
      comp[k] = r.cumulato
    }
    const fmt = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
    return separaPrenotato(righeScartoWave(wave).map(r => ({
      ...r, label: r.label ?? `${fmt(r.week_start)}–${fmt(addDays(r.week_start, 6))}`,
      cumulato_comp: comp[r.label ? 'inizio' : r.week_start] ?? null,
    })), 'cumulato', snapshotDate)
  }, [wave, waveComp, isAnnoPrecedente, snapshotDate])
  if (!dati.length) return null
  const ultima = dati[dati.length - 1]
  const finale = ultima.cumulato ?? ultima.cumulato_fut
  const conPrenotato = dati.some(r => r.futura)
  const euroK = v => `${(v / 1000).toFixed(0)}k`
  return (
    <Card style={{ marginBottom: 24 }}
      title={<span>Distanza dal 100% WAVE, in euro <SpiegazioneWave /></span>}>
      <div className="ui-text-muted" style={{ marginBottom: 8 }}>
        Barre = incassato − 100% WAVE di ogni settimana (verde sopra, rosso sotto); la prima è il blocco aprile+maggio.
        Linea = scarto accumulato da inizio stagione{conPrenotato ? ', tratteggiata e barre chiare = con il prenotato di questa snapshot, non un risultato: il calo si riduce con le nuove prenotazioni' : ''}: {conPrenotato ? 'con il prenotato' : 'a fine stagione'}{' '}
        <strong style={{ color: finale >= 0 ? colors.success : colors.danger }}>
          {finale > 0 ? '+' : ''}{formatEuro(finale)}
        </strong>. Importi netti IVA, senza tassa di soggiorno.
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={dati} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
          <YAxis tickFormatter={euroK} width={52} />
          <Tooltip formatter={(v, n) => [v != null ? formatEuro(v) : '—', n]} />
          <Legend />
          {pastReferenceArea(dati, 'week_start', 'label', snapshotDate)}
          <ReferenceLine y={0} stroke={colors.textMuted} />
          <Bar dataKey="scarto" name="Scarto della settimana" legendType="none">
            {dati.map(r => <Cell key={r.week_start} fill={r.scarto >= 0 ? colors.success : colors.danger} fillOpacity={r.futura ? 0.2 : 0.55} />)}
          </Bar>
          <Line dataKey="cumulato" name="Scarto accumulato" stroke={colors.text} strokeWidth={3} dot={{ r: 2 }} />
          {conPrenotato && (
            <Line dataKey="cumulato_fut" name="Con il prenotato" stroke={colors.text} strokeWidth={2}
              strokeDasharray="5 4" dot={false} />
          )}
          {waveComp && (
            <Line dataKey="cumulato_comp" name={`Scarto accumulato ${compLabel}`} stroke={colors.text} dot={false}
              connectNulls {...STILE_CONFRONTO} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}

/** Incassato vs 100% WAVE per periodo e stagione, con lo scarto in euro (netto IVA, senza tassa). */
function TabellaScartoWave({ wave }) {
  const righe = [...wave.periodi, { periodo: 'stagione', etichetta: 'Stagione', ...wave.stagione }]
  return (
    <Table compact style={{ marginTop: 12 }}>
      <thead>
        <tr>
          <Th>Periodo</Th><Th num>Incassato</Th><Th num>100% WAVE</Th><Th num>Scarto</Th><Th num>WAVE</Th>
          <Th>Anno del record</Th>
        </tr>
      </thead>
      <tbody>
        {righe.map(p => {
          const scarto = p.valore != null && p.riferimento != null ? p.valore - p.riferimento : null
          return (
            <tr key={p.periodo} className={p.periodo === 'stagione' ? 'ui-riga-sezione' : undefined}>
              <Td>{p.etichetta}</Td>
              <Td num>{p.valore != null ? formatEuro(p.valore) : '—'}</Td>
              <Td num>{p.riferimento != null ? formatEuro(p.riferimento) : '—'}</Td>
              <Td num style={{ color: scarto == null ? undefined : scarto >= 0 ? colors.success : colors.danger }}>
                {scarto != null ? `${scarto > 0 ? '+' : ''}${formatEuro(scarto)}` : '—'}
              </Td>
              <Td num>{fmtWave(p.wave)}</Td>
              <Td>{p.periodo === 'stagione' ? 'somma dei migliori' : (p.anno_record ?? '—')}</Td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

function TabellaAggregatiMensili({ mesi, wave, exportUrl, exportNome, exportSnapshot }) {
  if (!mesi || mesi.length === 0) return null
  const totKpi = totaliAggregati(mesi)

  // Aprile e maggio consecutivi: una sola cella WAVE (blocco "Inizio stagione")
  const cellaWave = (m, i) => {
    const mese = Number(m.ym.slice(5))
    const prec = mesi[i - 1], succ = mesi[i + 1]
    if (mese === 5 && prec && prec.ym === `${m.ym.slice(0, 4)}-04`) return null
    const unita = mese === 4 && succ && succ.ym === `${m.ym.slice(0, 4)}-05`
    const p = wavePeriodoMese(wave, m.ym)
    return (
      <Td num rowSpan={unita ? 2 : undefined} style={unita ? { verticalAlign: 'middle' } : undefined}
        title={p && p.periodo === 'inizio' ? 'Inizio stagione (aprile + maggio)' : undefined}>
        {fmtWave(p?.wave)}
      </Td>
    )
  }

  return (
    <Card title="Aggregati mensili — intera stagione" style={{ marginBottom: 24 }}
      actions={<ExportMenu url={exportUrl} nome={exportNome} snapshot={exportSnapshot} />}>
      <Table compact>
        <IntestazioneAggregati prima="Mese" />
        <tbody>
          {mesi.map((m, i) => (
            <tr key={i}><Td>{m.label}</Td><CelleAggregato m={m} />{cellaWave(m, i)}</tr>
          ))}
          <tr className="ui-riga-sezione">
            <Td>TOTALE STAGIONE</Td><CelleAggregato m={totKpi} /><Td num>{fmtWave(wave?.stagione?.wave)}</Td>
          </tr>
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

// Categorie di Statistiche Produzione che formano il F&B; alloggio = camera; il resto = extra
const CATEGORIE_FNB = ['colazione', 'colazione_extra', 'pranzo', 'cena']

/** Camera, F&B ed extra di una riga giornaliera di /produzione/report/giornaliero. */
function valoriProduzione(riga) {
  let camera = 0, fnb = 0
  for (const [code, v] of Object.entries(riga.per_categoria)) {
    if (code === 'alloggio') camera += v.lordo
    else if (CATEGORIE_FNB.includes(code) || code.startsWith('bar_')) fnb += v.lordo
  }
  return { camera, fnb, extra: riga.totale.lordo - camera - fnb }
}

/**
 * Grafico ADR da Statistiche Produzione + retta media e card "Valore per camera venduta", con lo stesso toggle giornaliero/settimanale.
 * I valori di Statistiche valgono solo sui giorni già trascorsi alla snapshot e con righe importate;
 * in settimana le camere vendute si sommano sugli stessi giorni dei ricavi.
 * La retta media (RMC) non dipende da come Welcome divide il pacchetto: i confronti stanno su di essa.
 */
function GraficiValoreCamera({
  hotel, giorni, settimane, settimaneComp, isAnnoPrecedente, compLabel, snapDate, refStart, areaRif,
  exportGiorn, exportSett,
}) {
  const [vista, setVista] = useState(() => localStorage.getItem('hotel_adr_vista') || 'giornaliero')
  const [produzione, setProduzione] = useState({})
  const [erroreProduzione, setErroreProduzione] = useState(null)

  const dataDa = giorni[0]?.data
  const dataA = giorni[giorni.length - 1]?.data

  useEffect(() => {
    if (!dataDa || !dataA) return
    let annullato = false
    setProduzione({})
    setErroreProduzione(null)
    api.get('/produzione/report/giornaliero', {
      params: { data_da: dataDa, data_a: dataA, struttura_code: hotel },
    })
      .then(({ data }) => {
        if (!annullato) setProduzione(Object.fromEntries(data.map(r => [r.data, valoriProduzione(r)])))
      })
      .catch(err => { if (!annullato) setErroreProduzione(mostraErrore(err)) })
    return () => { annullato = true }
  }, [hotel, dataDa, dataA])

  function cambiaVista(v) {
    setVista(v)
    localStorage.setItem('hotel_adr_vista', v)
  }

  const { datiGiorni, datiSettimane, stagione } = useMemo(() => {
    const perCamera = (somma) => ({
      camera: somma.camera / somma.camere,
      fnb: somma.fnb / somma.camere,
      extra: somma.extra / somma.camere,
    })
    const accumula = (somma, v, camere) => {
      somma.camera += v.camera
      somma.fnb += v.fnb
      somma.extra += v.extra
      somma.camere += camere
    }
    const vuota = () => ({ camera: 0, fnb: 0, extra: 0, camere: 0 })
    const valido = g => produzione[g.data] && g.rooms_sold > 0 && (!snapDate || g.data < snapDate)

    const comp = {}
    for (const c of settimaneComp || []) comp[isAnnoPrecedente ? addDays(c.week_start, 364) : c.week_start] = c
    const inizi = settimane.map(s => s.week_start)
    const perSettimana = {}
    const totale = vuota()
    for (const g of giorni) {
      if (!valido(g)) continue
      accumula(totale, produzione[g.data], g.rooms_sold)
      const ws = inizi.filter(i => i <= g.data).pop()
      if (!ws) continue
      perSettimana[ws] = perSettimana[ws] || vuota()
      accumula(perSettimana[ws], produzione[g.data], g.rooms_sold)
    }
    return {
      datiGiorni: giorni.map(g => ({
        ...g,
        ...(valido(g) ? perCamera({ ...produzione[g.data], camere: g.rooms_sold }) : {}),
      })),
      datiSettimane: settimane.map(s => ({
        week_start: s.week_start,
        rmc: s.rmc,
        rmc_comp: comp[s.week_start]?.rmc ?? null,
        ...(perSettimana[s.week_start] ? perCamera(perSettimana[s.week_start]) : {}),
      })),
      stagione: totale.camere > 0 ? perCamera(totale) : null,
    }
  }, [giorni, settimane, settimaneComp, isAnnoPrecedente, produzione, snapDate])

  const settimanale = vista === 'settimanale'
  const dati = settimanale ? datiSettimane : datiGiorni
  const chiave = settimanale ? 'week_start' : 'data'
  const etichettaPeriodo = v => (settimanale ? `Settimana dal ${labelDataTooltip(v)}` : labelDataTooltip(v))
  const datiConValori = dati.filter(d => d.camera != null)
  const toggleVista = (
    <SegmentedControl value={vista} onChange={cambiaVista}
      options={[{ value: 'giornaliero', label: 'Giornaliero' }, { value: 'settimanale', label: 'Settimanale' }]} />
  )

  return (
    <>
      <Card title={`ADR da Statistiche Produzione e retta media ${settimanale ? 'settimanali' : 'giornalieri'} — intera stagione`}
        style={{ marginBottom: 24 }}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {toggleVista}
            <ExportMenu url={settimanale ? exportSett : exportGiorn}
              nome={`${hotel}_${settimanale ? 'settimanale' : 'giornaliero'}`} snapshot={snapDate} />
          </div>
        }>
        <div className="ui-text-muted" style={{ marginBottom: 8 }}>
          <strong>Retta media</strong> = ricavo totale ÷ camere vendute: copre anche il prenotato e non dipende da come
          Welcome divide il pacchetto, quindi è il riferimento stabile nel tempo e i confronti sono su questa linea.{' '}
          <strong>ADR da Statistiche Produzione</strong> = alloggio ÷ camere vendute, solo sui giorni già trascorsi: resta
          confrontabile tra anni finché non cambiano le quote pasti di Welcome. È diverso dall'<strong>ADR PMS</strong> delle
          tessere e delle tabelle, che toglie i pasti al valore fisso di Welcome e non va confrontato tra anni.
          Spiaggia e parcheggio prenotati con Mr Preno risultano spesso sulla prima notte: nel giornaliero creano picchi
          agli arrivi nella retta media, nel settimanale si assorbono quasi del tutto.
        </div>
        {erroreProduzione && (
          <Messaggio tipo="warn">Dati di Statistiche non disponibili: {erroreProduzione}</Messaggio>
        )}
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={dati} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={chiave} tickFormatter={tickFormatterSabato} interval={0} tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={v => `${v} €`} domain={['auto', 'auto']} width={52} />
            <Tooltip labelFormatter={etichettaPeriodo}
              formatter={(v, n) => [v != null ? formatEuro(v) : '—', n]} />
            <Legend />
            {pastReferenceArea(dati, chiave, null, snapDate)}
            {settimanale
              ? refStart && <ReferenceLine x={refStart} stroke={colors.info} strokeDasharray="3 3"
                  label={{ value: 'Sett. rif.', position: 'insideTopLeft', fontSize: 9, fill: colors.info }} />
              : areaRif(true)}
            <Line type="monotone" dataKey="rmc" stroke={coloreSerie(4)} dot={settimanale} name="Retta media" strokeWidth={2} />
            <Line type="monotone" dataKey="camera" stroke={coloreSerie(3)} dot={settimanale}
              name="ADR da Statistiche Produzione" strokeWidth={2} />
            {compLabel && (
              <Line type="monotone" dataKey="rmc_comp" stroke={coloreSerie(4)} dot={false}
                name={`Retta media ${compLabel}`} {...STILE_CONFRONTO} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {stagione && (
        <Card title="Valore per camera venduta (Statistiche Produzione)" style={{ marginBottom: 24 }} actions={toggleVista}>
          <div className="ui-text-muted" style={{ marginBottom: 8 }}>
            Ricavi di Statistiche Produzione (IVA inclusa) ÷ camere vendute, solo sui giorni già trascorsi con dati
            importati. F&amp;B = pasti e bar; Extra = spiaggia, parcheggio e altri servizi. La divisione del pacchetto è
            quella delle righe di addebito di Welcome.
          </div>
          <div className="ui-kpi-row" style={{ marginBottom: 12 }}>
            <KpiTile label="Camera" value={formatEuro(stagione.camera)} />
            <KpiTile label="F&B" value={formatEuro(stagione.fnb)} />
            <KpiTile label="Extra" value={formatEuro(stagione.extra)} />
            <KpiTile label="Totale" value={formatEuro(stagione.camera + stagione.fnb + stagione.extra)} />
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={datiConValori} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={chiave} tickFormatter={tickFormatterSabato} interval={0} tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `${v} €`} width={52} />
              <Tooltip content={<TooltipConTotale labelFormatter={etichettaPeriodo} />} />
              <Legend />
              {pastReferenceArea(datiConValori, chiave, null, snapDate)}
              <Bar dataKey="camera" stackId="valore" fill={COLORI_REVENUE.camere} name="Camera" />
              <Bar dataKey="fnb" stackId="valore" fill={COLORI_REVENUE.fnb} name="F&B" />
              <Bar dataKey="extra" stackId="valore" fill={COLORI_REVENUE.extra} name="Extra" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </>
  )
}

function ContenutoDashboard({
  dati, datiComp, compLabel, isAnnoPrecedente,
  hotel, currentSnap, giornalieriEspansi, onToggleGiornalieri,
}) {
  const kpi      = dati.kpi_stagione ?? {}
  const kpiComp  = datiComp?.kpi_stagione ?? null
  const giorni   = dati.giorni || VUOTO
  const settimane = dati.settimane || VUOTO
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

  // WAVE: stagione, settimana di riferimento (in aprile/maggio vale il blocco "Inizio stagione")
  const waveStagione = dati.wave?.stagione?.wave ?? null
  const waveStagioneComp = datiComp?.wave?.stagione?.wave ?? null
  const inizio = dati.wave?.periodi.find(p => p.periodo === 'inizio') ?? null
  const waveSettRif = (() => {
    const s = settimane.find(x => x.week_start === refStart)
    if (s?.wave != null) return { wave: s.wave, nota: s.wave_riferimento != null ? `rif. ${formatEuro(s.wave_riferimento)}` : null }
    const mese = refStart ? Number(refStart.slice(5, 7)) : null
    if (mese === 4 || mese === 5) return { wave: inizio?.wave ?? null, nota: 'Inizio stagione (apr+mag)' }
    return { wave: null, nota: refStart ? 'fuori dai periodi WAVE' : null }
  })()
  // Settimane del grafico: giugno–settembre intero dal backend (anche dopo la chiusura, incasso zero) + quelle
  // con dati; il progressivo dell'ultima settimana = WAVE di stagione
  const settimaneWave = useMemo(() => {
    const comp = {}
    for (const c of datiComp?.wave?.settimane || []) comp[isAnnoPrecedente ? addDays(c.week_start, 364) : c.week_start] = c
    const occ = Object.fromEntries(settimane.map(s => [s.week_start, s]))
    const ws = new Set([...settimane.map(s => s.week_start), ...(dati.wave?.settimane || []).map(s => s.week_start)])
    const w = Object.fromEntries((dati.wave?.settimane || []).map(s => [s.week_start, s]))
    const fmt = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
    return separaPrenotato([...ws].sort().map(k => ({
      week_start: k, label: occ[k]?.label ?? `${fmt(k)}–${fmt(addDays(k, 6))}`,
      occupancy: occ[k]?.occupancy ?? null,
      wave: w[k]?.wave ?? null, progressivo: w[k]?.progressivo ?? null,
      progressivo_comp: comp[k]?.progressivo ?? null,
    })), 'progressivo', currentSnap?.snapshot_date)
  }, [settimane, dati.wave, datiComp, isAnnoPrecedente, currentSnap?.snapshot_date])
  const waveConPrenotato = settimaneWave.some(s => s.progressivo_fut != null)
  const maxWave = Math.max(100, ...settimaneWave.flatMap(s => [s.wave ?? 0, s.progressivo_comp ?? 0, s.occupancy ?? 0]))
  const totSettimane = useMemo(() => totaliAggregati(settimane), [settimane])

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
            ['ADR PMS', 'adr', formatEuro],
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
          <KpiTile label={<>WAVE stagione <SpiegazioneWave /></>}
            value={fmtWave(waveStagione)} colore={COLORE_WAVE}
            sub={dati.wave?.stagione?.riferimento != null
              ? `${formatEuro(dati.wave.stagione.valore)} su ${formatEuro(dati.wave.stagione.riferimento)} (netto IVA)`
              : 'nessun riferimento'}
            confronto={datiComp ? fmtWave(waveStagioneComp) : null} confrontoLabel={compLabel}
            delta={calcolaDelta(waveStagione, waveStagioneComp)} />
          <KpiTile label={<>WAVE sett. {refLabel ?? 'rif.'} <SpiegazioneWave /></>}
            value={fmtWave(waveSettRif.wave)} colore={COLORE_WAVE} sub={waveSettRif.nota} />
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

      {/* ADR, retta media e valore per camera venduta — giornaliero o settimanale */}
      <GraficiValoreCamera hotel={hotel} giorni={giorniMerged} settimane={settimane} settimaneComp={datiComp?.settimane}
        isAnnoPrecedente={isAnnoPrecedente} compLabel={datiComp ? compLabel : null} snapDate={snapDate}
        refStart={refStart} areaRif={areaRif} exportGiorn={exportGiorn} exportSett={exportSett} />

      {/* WAVE settimanale: barre WAVE + linea occupazione sulla stessa scala % */}
      {dati.wave && (
        <Card style={{ marginBottom: 24 }}
          title={<span>WAVE settimanale e occupazione <SpiegazioneWave /></span>}
          actions={<ExportMenu url={exportSett} nome={`${hotel}_settimanale`} snapshot={snapDate} />}>
          <div className="ui-text-muted" style={{ marginBottom: 8 }}>
            La linea <strong>WAVE stagione progressivo</strong> è il totale incassato fino a quella settimana ÷ il
            totale del 100% fino a lì (inizio stagione compreso): l'ultimo punto è il WAVE di stagione
            ({fmtWave(waveStagione)}). Le barre sono le singole settimane, solo come dettaglio: pesano tutte uguale a
            vista, ma agosto vale molti più euro di settembre. Aprile e maggio senza barre (contano come blocco).
            {waveConPrenotato && ' Linea tratteggiata e barre chiare = settimane non ancora finite alla data della snapshot: confrontano il prenotato con un risultato finale, quindi sono basse per costruzione e salgono con le nuove prenotazioni.'}
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={settimaneWave} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
              <YAxis tickFormatter={v => `${v}%`} domain={[0, Math.ceil(maxWave / 20) * 20]} width={44} />
              <Tooltip formatter={(v, n) => [fmtWave(v), n]} />
              <Legend />
              {pastReferenceArea(settimaneWave, 'week_start', 'label', currentSnap?.snapshot_date)}
              <ReferenceLine y={100} stroke={colors.textMuted} strokeDasharray="2 2" />
              <Bar dataKey="wave" name="WAVE settimana %" fill={COLORE_WAVE} fillOpacity={0.3}>
                {settimaneWave.map(s => <Cell key={s.week_start} fill={COLORE_WAVE} fillOpacity={s.futura ? 0.12 : 0.3} />)}
              </Bar>
              <Line dataKey="occupancy" name="Occupazione %" stroke={colors.info} dot={false} strokeWidth={1.5} />
              <Line dataKey="progressivo" name="WAVE stagione progressivo %" stroke={COLORE_WAVE} strokeWidth={3}
                dot={{ r: 2 }} connectNulls />
              {waveConPrenotato && (
                <Line dataKey="progressivo_fut" name="Con il prenotato %" stroke={COLORE_WAVE} strokeWidth={2}
                  strokeDasharray="5 4" dot={false} connectNulls />
              )}
              {datiComp && (
                <Line dataKey="progressivo_comp" name={`WAVE progressivo ${compLabel}`} stroke={COLORE_WAVE}
                  dot={false} connectNulls {...STILE_CONFRONTO} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
          <TabellaScartoWave wave={dati.wave} />
        </Card>
      )}

      {dati.wave && (
        <GraficoScartoWave wave={dati.wave} waveComp={datiComp?.wave ?? null} compLabel={compLabel}
          isAnnoPrecedente={isAnnoPrecedente} snapshotDate={currentSnap?.snapshot_date} />
      )}

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
              <Tooltip content={<TooltipConTotale labelFormatter={labelDataTooltip} />} />
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
      <TabellaAggregatiMensili mesi={mesiAggregati} wave={dati.wave}
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
                    <Td num>{fmtWave(s.wave)}</Td>
                  </tr>
                )
              })}
              <tr className="ui-riga-sezione">
                <Td>TOTALE STAGIONE</Td><CelleAggregato m={totSettimane} /><Td num>{fmtWave(waveStagione)}</Td>
              </tr>
            </tbody>
          </Table>
          <div className="ui-text-muted" style={{ marginTop: 6, fontSize: 'var(--fs-xs)' }}>
            ● = settimana di riferimento della snapshot · <em>corsivo</em> = settimana parziale ·
            WAVE solo sui giorni di giugno–settembre (aprile e maggio nel blocco "Inizio stagione")
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
