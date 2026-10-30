import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import api from '../api/client.js'
import { formatData, formatEuro, formatPerc, formatN, mostraErrore } from '../utils/format.js'
import pastReferenceArea from '../components/PastReferenceArea.jsx'
import { ExportMenu } from '../components/ExportMenu.jsx'
import SpiegazionePrevisione from '../components/SpiegazionePrevisione.jsx'
import TabRistoranti from './budget/TabRistoranti.jsx'
import {
  Badge, Button, Card, Field, FileButton, HotelTag, Input, KpiTile, Loading, Messaggio, Modal,
  PageHeader, SegmentedControl, Select, StatoVuoto, Table, Tabs, Td, Th, useAvvisi, useConferma,
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

const numInput = (v) => parseFloat(String(v || '').replace(',', '.')) || null

// Valori di una riga della tab Inserimento: input (edit locale > DB) + KPI ricalcolati
function valoriRiga(s, edit, stagione) {
  const occupancy = numInput(edit.occupancy ?? s.occupancy)
  const adr       = numInput(edit.adr ?? s.adr)
  const adrFnb    = numInput(edit.adr_fnb ?? s.adr_fnb)
  const adrExtra  = numInput(edit.adr_extra ?? s.adr_extra)
  // Per righe senza DB: cam.disp. dal frontend
  const ra = s.rooms_available_budget ?? s.rooms_available
    ?? roomsAvailabileSettimana(s.week_start, stagione)
  const kpi = calcolaKpiFrontend(occupancy, adr, adrFnb, adrExtra, ra)
  return { occupancy, adr, adrFnb, adrExtra, ra, kpi }
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
  // Ultimi valori digitati, letti dal salvataggio ritardato: lo stato `localEdit` catturato dal
  // setTimeout è quello del render precedente, senza l'ultimo tasto (scrivendo "70" salvava "7")
  const editRef = useRef({})
  const settimaneRef = useRef([])
  settimaneRef.current = settimane
  const avvisi = useAvvisi()
  const conferma = useConferma()
  const [precompilando, setPrecompilando] = useState(false)

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
      editRef.current = {}
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
    // Data locale, non toISOString(): in UTC+1/+2 la mezzanotte del sabato diventerebbe venerdì
    const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    const weeks = []
    while (iso(d) <= close) {
      weeks.push(iso(d))
      d.setDate(d.getDate() + 7)
    }
    const budgetMap = Object.fromEntries(settimane.map(s => [s.week_start, s]))
    return weeks.map(ws => budgetMap[ws] || { week_start: ws, _vuota: true })
  }, [stagione, settimane])

  function handleCellChange(ws, campo, val) {
    editRef.current = {
      ...editRef.current,
      [ws]: { ...(editRef.current[ws] || {}), [campo]: val },
    }
    setLocalEdit(editRef.current)
    // Debounce salvataggio
    clearTimeout(debRef.current[ws])
    debRef.current[ws] = setTimeout(() => salvaSettimana(ws), 500)
  }

  async function salvaSettimana(ws) {
    const entry = settimaneRef.current.find(s => s.week_start === ws) || {}
    const edit = editRef.current[ws] || {}
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

  async function precompilaAnnoPrecedente() {
    const annoPrec = anno - 1
    if (!(await conferma({
      titolo: `Riempire con i dati ${annoPrec}?`,
      messaggio: `Ogni settimana viene compilata con occupazione, ADR, F&B ed Extra per camera ` +
        `realmente registrati nella stessa settimana del ${annoPrec} (statistiche, ultimo snapshot). ` +
        `Versione ${version}. Le settimane senza dati ${annoPrec} restano vuote.`,
      confermaLabel: 'Riempi',
    }))) return
    let sovrascrivi = false
    if (settimane.length > 0) {
      sovrascrivi = await conferma({
        titolo: `${settimane.length} settimane già compilate`,
        messaggio: 'Vuoi sovrascrivere anche quelle con i dati dell\'anno precedente, o riempire solo le settimane vuote?',
        confermaLabel: 'Sovrascrivi tutto',
        annullaLabel: 'Solo le vuote',
        pericolo: true,
      })
    }
    setPrecompilando(true)
    try {
      const { data } = await api.post(
        `/budget/${hotel}/${anno}/precompila-anno-precedente?version=${version}&sovrascrivi=${sovrascrivi}`
      )
      avvisi.successo(`Compilate ${data.n_compilate} settimane con i dati ${annoPrec}`)
      if (data.settimane_senza_dati.length > 0) {
        avvisi.attenzione(
          `Nessun dato ${annoPrec} per ${data.settimane_senza_dati.length} settimane ` +
          `(${data.settimane_senza_dati.map(formatData).join(', ')}): da compilare a mano`
        )
      }
      caricaDati()
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore riempimento da anno precedente'))
    } finally {
      setPrecompilando(false)
    }
  }

  // Riga TOTALE: somme sulla stagione, KPI sui totali (mai media delle settimane)
  const totali = useMemo(() => {
    const t = { ra: 0, rs: 0, rooms: 0, fnb: 0, extra: 0, tot: 0 }
    for (const s of tutteLeSettimane) {
      const { ra, kpi } = valoriRiga(s, localEdit[s.week_start] || {}, stagione)
      t.ra += ra || 0
      if (kpi.rooms_sold == null) continue
      t.rs += kpi.rooms_sold
      t.rooms += kpi.revenue_rooms
      t.fnb += kpi.revenue_fnb
      t.extra += kpi.revenue_extra
      t.tot += kpi.revenue_total
    }
    const sd = (n, d) => d ? n / d : null
    return {
      ...t,
      occupancy: sd(t.rs * 100, t.ra),
      adr: sd(t.rooms, t.rs),
      adrFnb: sd(t.fnb, t.rs),
      adrExtra: sd(t.extra, t.rs),
      incFnb: sd(t.fnb * 100, t.tot),
      revpar: sd(t.rooms, t.ra),
      trevpar: sd(t.tot, t.ra),
    }
  }, [tutteLeSettimane, localEdit, stagione])

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
        <Button variant="secondary" onClick={precompilaAnnoPrecedente} disabled={precompilando}>
          {precompilando ? 'Riempimento…' : `Riempi con dati ${anno - 1}`}
        </Button>
        <div style={{ marginLeft: 'auto' }} title="Il file Excel si può modificare e reimportare con «Importa da Excel»">
          <ExportMenu url={`/budget/${hotel}/${anno}/export?version=${version}`} nome={`Budget_${hotel}_${anno}_${version}`} />
        </div>
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
                const { occupancy, ra, kpi } = valoriRiga(s, edit, stagione)
                const { mese: mc, anno: ac } = s.mese_contabile
                  ? { mese: s.mese_contabile, anno: s.anno_contabile }
                  : calcolaMeseContabile(ws)
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
              <tr className="ui-riga-totale">
                <Td>TOTALE</Td>
                <Td></Td>
                <Td num>{totali.ra ? formatN(totali.ra) : '—'}</Td>
                <Td num>{totali.occupancy != null ? formatPerc(totali.occupancy) : '—'}</Td>
                <Td num>{totali.adr != null ? formatEuro(totali.adr) : '—'}</Td>
                <Td num>{totali.adrFnb != null ? formatEuro(totali.adrFnb) : '—'}</Td>
                <Td num>{totali.adrExtra != null ? formatEuro(totali.adrExtra) : '—'}</Td>
                <Td num>{totali.rs ? formatN(totali.rs) : '—'}</Td>
                <Td num>{totali.incFnb != null ? formatPerc(totali.incFnb) : '—'}</Td>
                <Td num>{totali.revpar != null ? formatEuro(totali.revpar) : '—'}</Td>
                <Td num>{totali.trevpar != null ? formatEuro(totali.trevpar) : '—'}</Td>
                <Td num>{totali.tot ? formatEuro(totali.tot) : '—'}</Td>
                <Td></Td>
              </tr>
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
// Fonte del valore di ogni settimana (vedi _proiezione_hotel in budget.py)
const FONTE_SETTIMANA = {
  consuntivo: { label: 'Consuntivo', tono: 'ok' },
  in_corso:   { label: 'In corso',   tono: 'info' },
  previsione: { label: 'Previsione', tono: 'info' },
  otb:        { label: 'OTB',        tono: 'neutral' },
  budget:     { label: 'Budget',     tono: 'neutral' },
}
const titoloFonte = (r) => {
  if (r.tipo === 'previsione' || r.tipo === 'in_corso') {
    const corr = r.correttivo_pct ? `, correttivo ${r.correttivo_pct > 0 ? '+' : ''}${r.correttivo_pct}%` : ''
    return `OTB + vendite attese dallo storico: ${r.anticipo_giorni} giorni all'arrivo, ${r.n_riferimento} settimane di riferimento${corr}`
  }
  if (r.tipo === 'otb') return 'Settimana in corso senza storico: prenotato attuale'
  if (r.tipo === 'budget') return 'Nessun OTB o storico disponibile: si usa il budget'
  return 'Dati Revenue definitivi'
}

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
            <div className="ui-text-muted">OTB attuale (prenotato)</div>
            <div className="ui-num" style={{ fontWeight: 700, fontSize: 'var(--fs-xl)' }}>
              {formatEuro(dati.stagione_otb?.revenue_total)}
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
            <span>{dati.settimane_completate} settimane chiuse su {dati.settimane_totali}</span>
            <span className="ui-num">{pct.toFixed(0)}%</span>
          </div>
          <div style={{ background: colors.border, borderRadius: 4, height: 10, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: trend.colore, transition: 'width 0.5s' }} />
          </div>
        </div>
      </Card>

      <div className="ui-text-muted" style={{ marginBottom: 12 }}>
        <div style={{ float: 'right', marginLeft: 12 }}><SpiegazionePrevisione /></div>
        {dati.snapshot_otb
          ? <>Prenotato al {formatData(dati.snapshot_otb)}. </>
          : <>Nessun dato Revenue per il {anno}: tutte le settimane usano il budget. </>}
        {dati.anni_storico?.length
          ? <>Settimane future: prenotato + vendite attese in base all'andamento del {dati.anni_storico.join(' e ')} alla stessa distanza dall'arrivo.</>
          : dati.snapshot_otb && <>Nessuno storico degli anni precedenti: le settimane future usano il budget.</>}
        {dati.correttivi?.length > 0 && (
          <div style={{ color: colors.accent, marginTop: 4 }}>
            Correttivi sulle vendite attese:{' '}
            {dati.correttivi.map(c => `${c.mese ? MESI_IT[c.mese - 1] : 'stagione'} ${c.correttivo_pct > 0 ? '+' : ''}${c.correttivo_pct}%`).join(', ')}
            {' '}(Admin → Budget → Previsione fine stagione)
          </div>
        )}
      </div>

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
            <Th>Fonte</Th>
            <Th num>Budget</Th>
            <Th num>OTB</Th>
            <Th num>Consuntivo / Proiezione</Th>
            <Th num>Δ€ vs budget</Th>
          </tr>
        </thead>
        <tbody>
          {(dati.dettaglio || []).map((r, i) => {
            const bRev = r.budget?.revenue_total
            const aRev = r.actual_o_proiezione?.revenue_total
            const delta = (bRev != null && aRev != null) ? aRev - bRev : null
            return (
              <tr key={i} className={r.tipo === 'consuntivo' ? 'ui-riga-ok' : undefined}>
                <Td>{labelSettimana(r.week_start)}</Td>
                <Td>
                  <span title={titoloFonte(r)}>
                    <Badge tono={FONTE_SETTIMANA[r.tipo]?.tono ?? 'neutral'}>{FONTE_SETTIMANA[r.tipo]?.label ?? r.tipo}</Badge>
                  </span>
                </Td>
                <Td num>{formatEuro(bRev)}</Td>
                <Td num>{r.tipo === 'consuntivo' || r.otb == null ? '—' : formatEuro(r.otb.revenue_total)}</Td>
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

  const ristoranti = conf.ristoranti || []
  const budHotel = conf.hotel?.reduce((s, h) => s + (h.budget?.revenue_total || 0), 0)
  const actHotel = conf.hotel?.reduce((s, h) => s + (h.actual?.revenue_total || 0), 0)
  const projHotel = proj?.proiezione_gruppo_revenue
  const budGruppo = budHotel + ristoranti.reduce((s, r) => s + r.budget, 0)
  const actGruppo = actHotel + ristoranti.reduce((s, r) => s + r.consuntivo, 0)
  const projGruppo = projHotel != null ? projHotel + ristoranti.reduce((s, r) => s + r.proiezione, 0) : null
  // Hotel: actual − budget. Ristoranti: solo settimane chiuse (nessun OTB sulle settimane future).
  const scHotel = conf.hotel?.length ? actHotel - budHotel : null
  const scRistoranti = ristoranti.some(r => r.scostamento != null)
    ? ristoranti.reduce((s, r) => s + (r.scostamento || 0), 0) : null
  const scGruppo = scHotel == null && scRistoranti == null ? null : (scHotel || 0) + (scRistoranti || 0)
  const budConfronto = budHotel + ristoranti.reduce((s, r) => s + r.budget_confrontabile, 0)
  const scGruppoPct = scGruppo != null && budConfronto ? scGruppo / budConfronto * 100 : null
  const datiGrafico = [
    ...(conf.hotel || []),
    ...ristoranti.map(r => ({
      hotel_code: r.struttura_code,
      budget: { revenue_total: r.budget },
      actual: { revenue_total: r.consuntivo },
    })),
  ]

  return (
    <div>
      <div className="ui-kpi-row">
        <KpiTile label="Budget Gruppo" value={formatEuro(budGruppo)} minWidth={180} />
        <KpiTile label="Actual Gruppo" value={formatEuro(actGruppo)} minWidth={180} />
        <KpiTile label="Proiezione Gruppo" value={formatEuro(projGruppo)} minWidth={180} />
      </div>

      <Table style={{ marginBottom: 20 }}>
        <thead>
          <tr>
            <Th>Struttura</Th>
            <Th num>Budget Rev.</Th>
            <Th num>Actual Rev.</Th>
            <Th num>Scostamento €</Th>
            <Th num>Scostamento %</Th>
            <Th num>OTB</Th>
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
                <Td num>{projH?.snapshot_otb ? formatEuro(projH.otb) : '—'}</Td>
                <Td num>{projH ? formatEuro(projH.proiezione) : '—'}</Td>
              </tr>
            )
          })}
          {ristoranti.length > 0 && (
            <>
              <tr className="ui-riga-subtotale">
                <Td>Totale hotel</Td>
                <Td num>{formatEuro(budHotel)}</Td>
                <Td num>{formatEuro(actHotel)}</Td>
                <Td num>{conSegno(scHotel, formatEuro)}</Td>
                <Td num>{conSegno(scHotel != null && budHotel ? scHotel / budHotel * 100 : null, v => `${v.toFixed(1)}%`)}</Td>
                <Td num>—</Td>
                <Td num>{formatEuro(projHotel)}</Td>
              </tr>
              {ristoranti.map(r => (
                <tr key={r.struttura_code}>
                  <Td>
                    <HotelTag code={r.struttura_code} />{' '}
                    <span className="ui-text-muted">{r.nome}</span>
                  </Td>
                  <Td num>{formatEuro(r.budget)}</Td>
                  <Td num>{formatEuro(r.consuntivo)}</Td>
                  <Td num style={{ color: coloreSegno(r.scostamento) }}>{conSegno(r.scostamento, formatEuro)}</Td>
                  <Td num style={{ color: coloreSegno(r.scostamento_pct) }}>
                    {conSegno(r.scostamento_pct != null ? r.scostamento_pct * 100 : null, v => `${v.toFixed(1)}%`)}
                  </Td>
                  <Td num>—</Td>
                  <Td num>{formatEuro(r.proiezione)}</Td>
                </tr>
              ))}
              <tr className="ui-riga-totale">
                <Td>Totale gruppo</Td>
                <Td num>{formatEuro(budGruppo)}</Td>
                <Td num>{formatEuro(actGruppo)}</Td>
                <Td num>{conSegno(scGruppo, formatEuro)}</Td>
                <Td num>{conSegno(scGruppoPct, v => `${v.toFixed(1)}%`)}</Td>
                <Td num>—</Td>
                <Td num>{formatEuro(projGruppo)}</Td>
              </tr>
            </>
          )}
        </tbody>
      </Table>
      {ristoranti.length > 0 && (
        <p className="ui-text-muted" style={{ marginTop: -12, marginBottom: 20 }}>
          Ristoranti: consuntivo dai corrispettivi inseriti a mano, scostamento solo sulle settimane chiuse.
          Occupazione, ADR e RevPAR restano calcolati solo sugli hotel.
        </p>
      )}

      {/* Grafico comparativo revenue per struttura */}
      {datiGrafico.length > 0 && (
        <Card title="Revenue — Budget vs Actual per struttura">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={datiGrafico} margin={{ left: 0, right: 20 }}>
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
    { id: 'ristoranti', label: 'Ristoranti' },
  ]

  return (
    <div>
      {/* Selettori hotel / anno / versione nell'intestazione */}
      <PageHeader title="Budget">
        {tab !== 'gruppo' && tab !== 'ristoranti' && (
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
      {tab === 'ristoranti' && (
        <TabRistoranti anno={anno} version={version} />
      )}
    </div>
  )
}
