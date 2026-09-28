import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import api from '../api/client.js'
import { formatEuro, formatPerc, formatN, mostraErrore } from '../utils/format.js'
import pastReferenceArea from '../components/PastReferenceArea.jsx'
import {
  Badge, Button, Card, Field, FileButton, HotelTag, Input, KpiTile, Loading, Messaggio, Modal,
  PageHeader, SegmentedControl, Select, StatoVuoto, Table, Tabs, Td, Th, useAvvisi,
} from '../components/ui'
import { colors } from '../styles/tokens.js'

// Colori serie grafici Budget vs Actual (uguali in tutti i grafici del modulo)
const COLORE_BUDGET = colors.textSubtle
const COLORE_ACTUAL = colors.info

// Verde se ≥ 0, rosso se < 0, testo normale se null
const coloreSegno = (v) => v == null ? undefined : (v >= 0 ? colors.success : colors.danger)
const conSegno = (v, fmt) => v == null ? '—' : `${v >= 0 ? '+' : ''}${fmt(v)}`

const MESI_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]
const HOTEL_CODES = ['CLB', 'DPH', 'INT']
const HOTEL_NOMI = { CLB: 'Club Hotel', DPH: 'Hotel Du Parc', INT: 'Hotel International' }

// Calcolo KPI budget lato frontend (speculare a budget_calculator.py).
// occupancy: % 0-100 (input); adrFnb/adrExtra: € per camera venduta (input).
// camere_vendute e tutti i KPI sono derivati.
function calcolaKpiFrontend(occupancy, adr, adrFnb, adrExtra, roomsAvail) {
  if (!occupancy || !adr) return {}
  const ra = roomsAvail || 0
  const camere = ra ? Math.round(occupancy / 100 * ra) : null
  if (camere === null) return {}
  const revRooms = camere * adr
  const revFnb   = camere * (adrFnb   || 0)
  const revExtra = camere * (adrExtra  || 0)
  const revTotal = revRooms + revFnb + revExtra
  const sd = (n, d) => d ? n / d : null
  return {
    rooms_sold: camere,
    revenue_rooms: revRooms,
    revenue_fnb: revFnb,
    revenue_extra: revExtra,
    revenue_total: revTotal,
    occupancy,
    revpar:    sd(revRooms, ra),
    trevpar:   sd(revTotal, ra),
    rmc:       sd(revTotal, camere),
    inc_rooms: sd(revRooms * 100, revTotal),
    inc_fnb:   sd(revFnb   * 100, revTotal),
    inc_extra: sd(revExtra * 100, revTotal),
  }
}

// Speculare a calcola_mese_contabile() in Python:
// restituisce {mese (1-12), anno} del mese con più giorni nella settimana.
function calcolaMeseContabile(ws) {
  const conteggi = {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws + 'T00:00:00')
    d.setDate(d.getDate() + i)
    const k = `${d.getFullYear()}-${d.getMonth() + 1}`
    conteggi[k] = (conteggi[k] || 0) + 1
  }
  const [best] = Object.entries(conteggi).sort((a, b) => b[1] - a[1])
  const [anno, mese] = best[0].split('-').map(Number)
  return { mese, anno }
}

// Camere disponibili per una settimana dalla stagione già caricata.
function roomsAvailabileSettimana(ws, stagione) {
  if (!stagione) return null
  const open  = new Date(stagione.open_date  + 'T00:00:00')
  const close = new Date(stagione.close_date + 'T00:00:00')
  let giorni = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws + 'T00:00:00')
    d.setDate(d.getDate() + i)
    if (d >= open && d <= close) giorni++
  }
  return giorni > 0 ? stagione.total_rooms * giorni : null
}

function labelSettimana(ws) {
  const d = new Date(ws + 'T00:00:00')
  const we = new Date(ws + 'T00:00:00')
  we.setDate(we.getDate() + 6)
  const fmt = (dt) => `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}`
  return `${fmt(d)}–${fmt(we)}`
}


// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — Inserimento Budget
// ─────────────────────────────────────────────────────────────────────────────
function TabInserimento({ hotel, anno, version, onVersionChange }) {
  const [settimane, setSettimane] = useState([])   // da GET /budget
  const [stagione, setStagione] = useState(null)    // da GET /hotels/{code}/seasons/{year}
  const [versioni, setVersioni] = useState(['v1'])
  const [localEdit, setLocalEdit] = useState({})    // {ws: {campo: val}}
  const [salvataggio, setSalvataggio] = useState({})
  const [mostraModale, setMostraModale] = useState(false)
  const [nuovaVersione, setNuovaVersione] = useState('')
  const [versSource, setVersSource] = useState('v1')
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  const debRef = useRef({})
  const avvisi = useAvvisi()

  const caricaDati = useCallback(async () => {
    setLoading(true)
    setErrore(null)
    try {
      const [respBudget, respStag, respVers] = await Promise.all([
        api.get(`/budget/${hotel}/${anno}?version=${version}`),
        api.get(`/hotels/${hotel}/seasons/${anno}`).catch(() => ({ data: null })),
        api.get(`/budget/${hotel}/${anno}/versions`).catch(() => ({ data: { versions: ['v1'] } })),
      ])
      setSettimane(respBudget.data || [])
      setStagione(respStag.data)
      setVersioni(respVers.data.versions.length ? respVers.data.versions : ['v1'])
      setLocalEdit({})
    } catch (e) {
      setErrore(mostraErrore(e))
    } finally {
      setLoading(false)
    }
  }, [hotel, anno, version])

  useEffect(() => { caricaDati() }, [caricaDati])

  // Genera tutte le settimane della stagione (incluse quelle senza budget)
  const tutteLeSettimane = useMemo(() => {
    if (!stagione) return settimane
    const open = stagione.open_date
    const close = stagione.close_date
    if (!open || !close) return settimane
    // Calcola primo sabato ≤ open_date
    const d = new Date(open + 'T00:00:00')
    while (d.getDay() !== 6) d.setDate(d.getDate() - 1)
    const weeks = []
    while (d.toISOString().slice(0, 10) <= close) {
      weeks.push(d.toISOString().slice(0, 10))
      d.setDate(d.getDate() + 7)
    }
    const budgetMap = Object.fromEntries(settimane.map(s => [s.week_start, s]))
    return weeks.map(ws => budgetMap[ws] || { week_start: ws, _vuota: true })
  }, [stagione, settimane])

  function handleCellChange(ws, campo, val) {
    setLocalEdit(prev => ({
      ...prev,
      [ws]: { ...(prev[ws] || {}), [campo]: val },
    }))
    // Debounce salvataggio
    clearTimeout(debRef.current[ws])
    debRef.current[ws] = setTimeout(() => salvaSettimana(ws), 500)
  }

  async function salvaSettimana(ws) {
    const entry = settimane.find(s => s.week_start === ws) || {}
    const edit = localEdit[ws] || {}
    const merged = { ...entry, ...edit }
    const occupancy = parseFloat(String((merged.occupancy) || '').replace(',', '.')) || null
    const adr      = parseFloat(String(merged.adr || '').replace(',', '.')) || null
    const adrFnb   = parseFloat(String(merged.adr_fnb || '').replace(',', '.')) || null
    const adrExtra = parseFloat(String(merged.adr_extra || '').replace(',', '.')) || null
    if (!occupancy && !adr) return

    setSalvataggio(p => ({ ...p, [ws]: 'saving' }))
    try {
      await api.put(`/budget/${hotel}/${anno}/${ws}`, {
        version,
        occupancy,
        adr,
        adr_fnb: adrFnb,
        adr_extra: adrExtra,
        notes: merged.notes || null,
      })
      setSalvataggio(p => ({ ...p, [ws]: 'ok' }))
      setTimeout(() => setSalvataggio(p => { const n = { ...p }; delete n[ws]; return n }), 2000)
      // Ricarica solo la riga aggiornata
      const resp = await api.get(`/budget/${hotel}/${anno}/${ws}?version=${version}`)
      setSettimane(prev => {
        const idx = prev.findIndex(s => s.week_start === ws)
        if (idx >= 0) return prev.map((s, i) => i === idx ? resp.data : s)
        return [...prev, resp.data].sort((a, b) => a.week_start.localeCompare(b.week_start))
      })
    } catch {
      setSalvataggio(p => ({ ...p, [ws]: 'err' }))
    }
  }

  async function creaNuovaVersione() {
    try {
      await api.post(`/budget/${hotel}/${anno}/version`, {
        source_version: versSource,
        new_version: nuovaVersione,
      })
      onVersionChange(nuovaVersione)
      setMostraModale(false)
      avvisi.successo(`Versione ${nuovaVersione} creata da ${versSource}`)
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore creazione versione'))
    }
  }

  async function importaExcel(file) {
    const fd = new FormData()
    fd.append('file', file)
    try {
      const resp = await api.post(`/budget/${hotel}/${anno}/import-excel?version=${version}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      avvisi.successo(`Importate ${resp.data.n_righe_salvate} settimane`)
      caricaDati()
    } catch (ex) {
      avvisi.errore(mostraErrore(ex, 'Errore import Excel'))
    }
  }

  // Intestazioni delle colonne editabili: azzurrine per distinguerle da quelle calcolate
  const thInput = { color: colors.infoBg }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <Field label="Versione">
          <Select value={version} onChange={e => onVersionChange(e.target.value)}>
            {versioni.map(v => <option key={v} value={v}>{v}</option>)}
          </Select>
        </Field>
        <Button variant="secondary" onClick={() => setMostraModale(true)}>Nuova versione</Button>
        <FileButton accept=".xlsx" onFile={importaExcel}>Importa da Excel</FileButton>
      </div>

      <Messaggio tipo="err" onChiudi={() => setErrore(null)}>{errore}</Messaggio>
      {loading && <Loading />}

      {!loading && tutteLeSettimane.length > 0 && (
        <>
          <Table compact>
            <thead>
              <tr>
                <Th>Settimana</Th>
                <Th>Mese</Th>
                <Th num>Cam.Disp.</Th>
                <Th num style={thInput}>Occup%*</Th>
                <Th num style={thInput}>ADR Cam.*</Th>
                <Th num style={thInput}>ADR F&B*</Th>
                <Th num style={thInput}>ADR Extra*</Th>
                <Th num>Cam.Vend.</Th>
                <Th num>Inc.F&B%</Th>
                <Th num>RevPAR</Th>
                <Th num>TrevPAR</Th>
                <Th num>Rev.Totale</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {tutteLeSettimane.map((s) => {
                const ws = s.week_start
                const vuota = !!s._vuota
                const edit = localEdit[ws] || {}
                const occupancy = parseFloat(String((edit.occupancy ?? s.occupancy) || '').replace(',', '.')) || null
                const adr      = parseFloat(String((edit.adr ?? s.adr) || '').replace(',', '.')) || null
                const adrFnb   = parseFloat(String((edit.adr_fnb ?? s.adr_fnb) || '').replace(',', '.')) || null
                const adrExtra = parseFloat(String((edit.adr_extra ?? s.adr_extra) || '').replace(',', '.')) || null
                // Per righe senza DB: calcola mese e cam.disp. dal frontend
                const ra = s.rooms_available_budget ?? s.rooms_available
                  ?? roomsAvailabileSettimana(ws, stagione)
                const { mese: mc, anno: ac } = s.mese_contabile
                  ? { mese: s.mese_contabile, anno: s.anno_contabile }
                  : calcolaMeseContabile(ws)
                const kpi    = calcolaKpiFrontend(occupancy, adr, adrFnb, adrExtra, ra)
                const mese   = `${MESI_IT[mc - 1].slice(0, 3)} ${ac}`
                const stato  = salvataggio[ws]
                // Settimana senza budget in DB → attenuata; con budget ma senza occupancy → da compilare
                const classeRiga = vuota ? 'ui-riga-attenuata' : (occupancy ? undefined : 'ui-riga-avviso')

                return (
                  <tr key={ws} className={classeRiga}>
                    <Td style={{ whiteSpace: 'nowrap' }}>{labelSettimana(ws)}</Td>
                    <Td>{mese}</Td>
                    <Td num>{ra ? formatN(ra) : '—'}</Td>
                    {['occupancy', 'adr', 'adr_fnb', 'adr_extra'].map(campo => (
                      <Td key={campo} num style={{ padding: 2 }}>
                        <Input
                          type="number"
                          step="0.01"
                          className="ui-num"
                          value={edit[campo] ?? s[campo] ?? ''}
                          onChange={ev => handleCellChange(ws, campo, ev.target.value)}
                          style={{ width: campo === 'occupancy' ? 64 : 76, padding: '2px 6px', textAlign: 'right' }}
                        />
                      </Td>
                    ))}
                    <Td num style={{ color: colors.textMuted }}>
                      {kpi.rooms_sold != null ? formatN(kpi.rooms_sold) : (s.camere_vendute ? formatN(s.camere_vendute) : '—')}
                    </Td>
                    <Td num style={{ color: colors.textMuted }}>
                      {kpi.inc_fnb != null ? formatPerc(kpi.inc_fnb) : '—'}
                    </Td>
                    <Td num>{kpi.revpar != null ? formatEuro(kpi.revpar) : '—'}</Td>
                    <Td num>{kpi.trevpar != null ? formatEuro(kpi.trevpar) : '—'}</Td>
                    <Td num>{kpi.revenue_total != null ? formatEuro(kpi.revenue_total) : '—'}</Td>
                    <Td center style={{ width: 28 }}>
                      {stato === 'saving' && <span style={{ color: colors.textMuted }} title="Salvataggio…">⟳</span>}
                      {stato === 'ok' && <span style={{ color: colors.success }} title="Salvato">✓</span>}
                      {stato === 'err' && <span style={{ color: colors.danger }} title="Errore nel salvataggio">✗</span>}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
          <div className="ui-text-muted" style={{ marginTop: 6 }}>
            * celle editabili — ADR F&B e ADR Extra sono € per camera venduta — modifiche salvate automaticamente
          </div>
        </>
      )}

      {mostraModale && (
        <Modal
          titolo="Nuova versione budget"
          onChiudi={() => setMostraModale(false)}
          larghezza={380}
          footer={<>
            <Button variant="secondary" onClick={() => setMostraModale(false)}>Annulla</Button>
            <Button onClick={creaNuovaVersione} disabled={!nuovaVersione.trim()}>Crea</Button>
          </>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Copia da versione">
              <Select value={versSource} onChange={e => setVersSource(e.target.value)}>
                {versioni.map(v => <option key={v} value={v}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Nome nuova versione">
              <Input value={nuovaVersione} onChange={e => setNuovaVersione(e.target.value)} placeholder="es. v2" autoFocus />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — Confronto Actual vs Budget
// ─────────────────────────────────────────────────────────────────────────────
function TabConfronto({ hotel, anno, version }) {
  const [dati, setDati] = useState(null)
  const [modalita, setModalita] = useState('settimanale')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    const ep = modalita === 'mensile'
      ? `/budget/${hotel}/${anno}/confronto/mensile?version=${version}`
      : `/budget/${hotel}/${anno}/confronto?version=${version}`
    api.get(ep)
      .then(r => setDati(r.data))
      .catch(() => setDati(null))
      .finally(() => setLoading(false))
  }, [hotel, anno, version, modalita])

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
  if (!dati) return <>{selettore}<StatoVuoto>Nessun dato disponibile.</StatoVuoto></>

  const righe = modalita === 'mensile' ? dati.mesi : dati.settimane
  const totB  = dati.totali_budget || {}
  const totA  = dati.totali_actual || {}

  // Dati grafico
  const grafici = (dati.settimane || []).map(s => ({
    week_start: s.week_start,
    label: s.week_start ? s.week_start.slice(5) : '',
    budget_occ: s.budget?.occupancy,
    actual_occ: s.actual?.occupancy,
    budget_adr: s.budget?.adr,
    actual_adr: s.actual?.adr,
    budget_rev: s.budget?.revenue_total,
    actual_rev: s.actual?.revenue_total,
  })).filter(g => g.budget_occ != null || g.actual_occ != null)

  const scostPct = (b, a) => (b && a) ? ((a - b) / b * 100) : null
  const scostRev = (totA.revenue_total || 0) - (totB.revenue_total || 0)

  // Sotto-intestazione Bdg/Act: più piccola della riga sopra
  const thSub = { fontSize: 'var(--fs-xs)', fontWeight: 500 }

  return (
    <div>
      {selettore}

      {/* KPI riepilogo */}
      <div className="ui-kpi-row">
        <KpiTile label="Budget Revenue" value={formatEuro(totB.revenue_total)} />
        <KpiTile label="Actual Revenue" value={formatEuro(totA.revenue_total)} />
        <KpiTile label="Scostamento €" value={formatEuro(scostRev)} colore={coloreSegno(scostRev)} />
        <KpiTile label="Scostamento %" value={formatPerc(scostPct(totB.revenue_total, totA.revenue_total))} colore={coloreSegno(scostRev)} />
        <KpiTile label="Budget Camere" value={formatN(totB.rooms_sold)} />
        <KpiTile label="Actual Camere" value={formatN(totA.rooms_sold)} />
      </div>

      {/* Tabella confronto */}
      <Table compact style={{ marginBottom: 20 }}>
        <thead>
          <tr>
            <Th rowSpan={2} style={{ verticalAlign: 'bottom' }}>{modalita === 'mensile' ? 'Mese' : 'Settimana'}</Th>
            <Th center colSpan={2}>Cam. Vend.</Th>
            <Th center colSpan={2}>Occup. %</Th>
            <Th center colSpan={2}>ADR</Th>
            <Th center colSpan={2}>RevPAR</Th>
            <Th center colSpan={2}>Rev. Totale</Th>
            <Th num rowSpan={2} style={{ verticalAlign: 'bottom' }}>Δ%</Th>
          </tr>
          <tr>
            {[0, 1, 2, 3, 4].map(k => (
              <FragmentBdgAct key={k} thSub={thSub} />
            ))}
          </tr>
        </thead>
        <tbody>
          {righe.map((r, i) => {
            const b = r.budget || {}
            const a = r.actual || {}
            const sc = r.scostamento
            const sopra = sc?.sopra_budget
            const pct = sc?.percentuale?.revenue_total
            const haAct = r.dati_disponibili !== false && Object.keys(a).length > 0
            return (
              <tr key={i} className={haAct ? undefined : 'ui-riga-attenuata'}>
                <Td style={{ whiteSpace: 'nowrap' }}>
                  {modalita === 'mensile' ? r.label : labelSettimana(r.week_start)}
                </Td>
                <Td num>{formatN(b.rooms_sold)}</Td>
                <Td num>{haAct ? formatN(a.rooms_sold) : '—'}</Td>
                <Td num>{b.occupancy != null ? formatPerc(b.occupancy) : '—'}</Td>
                <Td num>{haAct ? formatPerc(a.occupancy) : '—'}</Td>
                <Td num>{b.adr != null ? formatEuro(b.adr) : '—'}</Td>
                <Td num>{haAct ? formatEuro(a.adr) : '—'}</Td>
                <Td num>{b.revpar != null ? formatEuro(b.revpar) : '—'}</Td>
                <Td num>{haAct ? formatEuro(a.revpar) : '—'}</Td>
                <Td num>{formatEuro(b.revenue_total)}</Td>
                <Td num>{haAct ? formatEuro(a.revenue_total) : '—'}</Td>
                <Td num>
                  {haAct && pct != null
                    ? <span style={{ color: sopra ? colors.success : colors.danger, fontWeight: 600 }}>
                        {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                      </span>
                    : '—'}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>

      {/* Grafici */}
      {grafici.length > 0 && modalita === 'settimanale' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Occupazione %">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={grafici}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={v => `${v}%`} domain={[0, 100]} width={36} />
                <Tooltip formatter={(v, n) => [v != null ? `${v.toFixed(1)}%` : '—', n]} />
                <Legend />
                {pastReferenceArea(grafici, 'week_start', 'label')}
                <Line dataKey="budget_occ" name="Budget" stroke={COLORE_BUDGET} strokeDasharray="4 4" dot={false} />
                <Line dataKey="actual_occ" name="Actual" stroke={COLORE_ACTUAL} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
          <Card title="Revenue Totale">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={grafici} barCategoryGap="15%">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={v => `${(v/1000).toFixed(0)}k`} width={40} />
                <Tooltip formatter={v => v != null ? formatEuro(v) : '—'} />
                <Legend />
                {pastReferenceArea(grafici, 'week_start', 'label')}
                <Bar dataKey="budget_rev" name="Budget" fill={COLORE_BUDGET} />
                <Bar dataKey="actual_rev" name="Actual" fill={COLORE_ACTUAL} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </div>
  )
}

// Coppia di sotto-intestazioni Bdg | Act per una colonna raggruppata
function FragmentBdgAct({ thSub }) {
  return (<><Th num style={thSub}>Bdg</Th><Th num style={thSub}>Act</Th></>)
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3 — Proiezione Fine Stagione
// ─────────────────────────────────────────────────────────────────────────────
const TREND = {
  sopra_budget: { label: 'SOPRA BUDGET', colore: colors.success, tono: 'ok' },
  sotto_budget: { label: 'SOTTO BUDGET', colore: colors.danger,  tono: 'err' },
  in_linea:     { label: 'IN LINEA',     colore: colors.info,    tono: 'info' },
}
const TONO_TIPO_SETTIMANA = { completata: 'ok', proiettata: 'neutral', in_corso: 'info' }

function TabProiezione({ hotel, anno, version }) {
  const [dati, setDati] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get(`/budget/${hotel}/${anno}/proiezione?version=${version}`)
      .then(r => setDati(r.data))
      .catch(() => setDati(null))
      .finally(() => setLoading(false))
  }, [hotel, anno, version])

  if (loading) return <Loading />
  if (!dati) return <StatoVuoto>Nessun budget inserito per questo hotel/anno.</StatoVuoto>

  const bud = dati.stagione_budget_totale || {}
  const proj = dati.stagione_proiezione || {}
  const scostRev = (proj.revenue_total || 0) - (bud.revenue_total || 0)
  const scostPct = bud.revenue_total ? (scostRev / bud.revenue_total * 100) : null
  const trend = TREND[dati.trend] ?? { label: dati.trend, colore: colors.textMuted, tono: 'neutral' }
  const pct = dati.pct_stagione_completata || 0

  return (
    <div>
      {/* Riepilogo principale */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div className="ui-text-muted">Budget totale stagione</div>
            <div className="ui-num" style={{ fontWeight: 700, fontSize: 'var(--fs-xxl)' }}>{formatEuro(bud.revenue_total)}</div>
          </div>
          <div>
            <div className="ui-text-muted">Proiezione fine stagione</div>
            <div className="ui-num" style={{ fontWeight: 700, fontSize: 'var(--fs-xxl)', color: trend.colore }}>
              {formatEuro(proj.revenue_total)}
            </div>
          </div>
          <div>
            <div className="ui-text-muted">Scostamento</div>
            <div className="ui-num" style={{ fontWeight: 700, fontSize: 'var(--fs-xl)', color: trend.colore }}>
              {scostRev > 0 ? '+' : ''}{formatEuro(scostRev)}
              {scostPct != null && ` (${scostPct > 0 ? '+' : ''}${scostPct.toFixed(1)}%)`}
            </div>
          </div>
          <Badge tono={trend.tono} style={{ alignSelf: 'center', fontSize: 'var(--fs-base)', padding: '4px 12px' }}>
            {trend.label}
          </Badge>
        </div>

        {/* Barra avanzamento */}
        <div style={{ marginTop: 16 }}>
          <div className="ui-text-muted" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{dati.settimane_completate} settimane completate su {dati.settimane_totali}</span>
            <span className="ui-num">{pct.toFixed(0)}%</span>
          </div>
          <div style={{ background: colors.border, borderRadius: 4, height: 10, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: trend.colore, transition: 'width 0.5s' }} />
          </div>
        </div>
      </Card>

      {/* KPI budget → proiezione */}
      <div className="ui-kpi-row">
        <KpiTile label="Cam. Vend. Budget" value={formatN(bud.rooms_sold)} sub={`→ ${formatN(proj.rooms_sold)}`} minWidth={170} />
        <KpiTile label="Rev. Camere Budget" value={formatEuro(bud.revenue_rooms)} sub={`→ ${formatEuro(proj.revenue_rooms)}`} minWidth={170} />
        <KpiTile label="Rev. F&B Budget" value={formatEuro(bud.revenue_fnb)} sub={`→ ${formatEuro(proj.revenue_fnb)}`} minWidth={170} />
      </div>

      {/* Tabella dettaglio */}
      <Table compact>
        <thead>
          <tr>
            <Th>Settimana</Th>
            <Th>Tipo</Th>
            <Th num>Budget</Th>
            <Th num>Actual / Proiezione</Th>
            <Th num>Δ€</Th>
          </tr>
        </thead>
        <tbody>
          {(dati.dettaglio || []).map((r, i) => {
            const bRev = r.budget?.revenue_total
            const aRev = r.actual_o_proiezione?.revenue_total
            const delta = (bRev != null && aRev != null) ? aRev - bRev : null
            return (
              <tr key={i} className={r.tipo === 'completata' ? 'ui-riga-ok' : undefined}>
                <Td>{labelSettimana(r.week_start)}</Td>
                <Td><Badge tono={TONO_TIPO_SETTIMANA[r.tipo] ?? 'neutral'}>{r.tipo}</Badge></Td>
                <Td num>{formatEuro(bRev)}</Td>
                <Td num>{formatEuro(aRev)}</Td>
                <Td num style={{ color: coloreSegno(delta) }}>{conSegno(delta, formatEuro)}</Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4 — Budget Gruppo
// ─────────────────────────────────────────────────────────────────────────────
function TabGruppo({ anno, version }) {
  const [conf, setConf] = useState(null)
  const [proj, setProj] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get(`/budget/gruppo/${anno}/confronto?version=${version}`),
      api.get(`/budget/gruppo/${anno}/proiezione?version=${version}`),
    ]).then(([r1, r2]) => {
      setConf(r1.data)
      setProj(r2.data)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [anno, version])

  if (loading) return <Loading />
  if (!conf) return <StatoVuoto>Nessun dato di gruppo disponibile.</StatoVuoto>

  const budGruppo = conf.hotel?.reduce((s, h) => s + (h.budget?.revenue_total || 0), 0)
  const actGruppo = conf.hotel?.reduce((s, h) => s + (h.actual?.revenue_total || 0), 0)

  return (
    <div>
      <div className="ui-kpi-row">
        <KpiTile label="Budget Gruppo" value={formatEuro(budGruppo)} minWidth={180} />
        <KpiTile label="Actual Gruppo" value={formatEuro(actGruppo)} minWidth={180} />
        <KpiTile label="Proiezione Gruppo" value={formatEuro(proj?.proiezione_gruppo_revenue)} minWidth={180} />
      </div>

      <Table style={{ marginBottom: 20 }}>
        <thead>
          <tr>
            <Th>Hotel</Th>
            <Th num>Budget Rev.</Th>
            <Th num>Actual Rev.</Th>
            <Th num>Scostamento €</Th>
            <Th num>Scostamento %</Th>
            <Th num>Proiezione</Th>
          </tr>
        </thead>
        <tbody>
          {(conf.hotel || []).map((h, i) => {
            const bRev = h.budget?.revenue_total
            const aRev = h.actual?.revenue_total
            const sc = aRev != null && bRev != null ? aRev - bRev : null
            const scPct = sc != null && bRev ? (sc / bRev * 100) : null
            const projH = proj?.hotel?.find(p => p.hotel_code === h.hotel_code)
            return (
              <tr key={i}>
                <Td>
                  <HotelTag code={h.hotel_code} />{' '}
                  <span className="ui-text-muted">{h.hotel_name}</span>
                </Td>
                <Td num>{formatEuro(bRev)}</Td>
                <Td num>{aRev != null ? formatEuro(aRev) : '—'}</Td>
                <Td num style={{ color: coloreSegno(sc) }}>{conSegno(sc, formatEuro)}</Td>
                <Td num style={{ color: coloreSegno(scPct) }}>{conSegno(scPct, v => `${v.toFixed(1)}%`)}</Td>
                <Td num>{projH ? formatEuro(projH.proiezione) : '—'}</Td>
              </tr>
            )
          })}
        </tbody>
      </Table>

      {/* Grafico comparativo revenue per hotel */}
      {conf.hotel?.length > 0 && (
        <Card title="Revenue — Budget vs Actual per hotel">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={conf.hotel} margin={{ left: 0, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hotel_code" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={v => `${(v/1000).toFixed(0)}k`} width={42} />
              <Tooltip formatter={v => v != null ? formatEuro(v) : '—'} />
              <Legend />
              <Bar dataKey="budget.revenue_total" name="Budget" fill={COLORE_BUDGET} />
              <Bar dataKey="actual.revenue_total" name="Actual" fill={COLORE_ACTUAL} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principale
// ─────────────────────────────────────────────────────────────────────────────
export default function Budget() {
  const [hotel, setHotel] = useState('DPH')
  const [anno, setAnno] = useState(2026)
  const [version, setVersion] = useState('v1')
  const [tab, setTab] = useState('inserimento')

  const anniDisponibili = [2025, 2026, 2027]
  const tabs = [
    { id: 'inserimento', label: 'Inserimento Budget' },
    { id: 'confronto', label: 'Confronto Actual vs Budget' },
    { id: 'proiezione', label: 'Proiezione Fine Stagione' },
    { id: 'gruppo', label: 'Budget Gruppo' },
  ]

  return (
    <div>
      {/* Selettori hotel / anno / versione nell'intestazione */}
      <PageHeader title="Budget">
        {tab !== 'gruppo' && (
          <SegmentedControl
            value={hotel}
            onChange={setHotel}
            options={HOTEL_CODES.map(c => ({ value: c, label: HOTEL_NOMI[c] }))}
          />
        )}
        <Select value={anno} onChange={e => setAnno(Number(e.target.value))} aria-label="Anno">
          {anniDisponibili.map(a => <option key={a} value={a}>{a}</option>)}
        </Select>
        {tab !== 'inserimento' && (
          <Select value={version} onChange={e => setVersion(e.target.value)} aria-label="Versione">
            <option value="v1">Versione v1</option>
            <option value="v2">Versione v2</option>
          </Select>
        )}
      </PageHeader>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'inserimento' && (
        <TabInserimento hotel={hotel} anno={anno} version={version} onVersionChange={setVersion} />
      )}
      {tab === 'confronto' && (
        <TabConfronto hotel={hotel} anno={anno} version={version} />
      )}
      {tab === 'proiezione' && (
        <TabProiezione hotel={hotel} anno={anno} version={version} />
      )}
      {tab === 'gruppo' && (
        <TabGruppo anno={anno} version={version} />
      )}
    </div>
  )
}
