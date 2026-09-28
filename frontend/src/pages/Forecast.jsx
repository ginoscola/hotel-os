import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api/client.js'
import { formatEuro, formatDataIt, mostraErrore } from '../utils/format.js'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import pastReferenceArea from '../components/PastReferenceArea.jsx'
import { isAdmin } from '../utils/auth.js'
import {
  Badge, Button, Card, Checkbox, Field, HotelTag, Input, KpiTile, Loading, Messaggio, Modal,
  PageHeader, Paginazione, SectionTitle, SegmentedControl, Select, StatoVuoto, Table, Tabs, Td,
  Textarea, Th, ThOrdinabile, useAvvisi, useConferma,
} from '../components/ui'
import { colors } from '../styles/tokens.js'

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const MESI_LABEL = [
  'Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre',
]

const ANNI = [2024, 2025, 2026, 2027]

// Colori con significato in questa pagina:
//   accent (viola)  = valore derivato dal Maturato inserito a mano (override dell'OTB)
//   primary         = Forecast
//   info (blu)      = serie dati principali nei grafici (OTB, cancellazioni)
const COLORE_SERIE = colors.info
const COLORE_MATURATO = colors.accent

// Recharts colora di default il testo della legenda come la serie — qui si vuole solo il
// quadratino colorato, il testo resta del colore normale.
const legendaNeutra = v => <span style={{ color: colors.text }}>{v}</span>

const TABS = [
  { id: 'riepilogo', label: 'Riepilogo Stagione' },
  { id: 'pace', label: 'Pace Chart' },
  { id: 'maturato', label: 'Maturato' },
  { id: 'cancellazioni', label: 'Cancellazioni' },
  { id: 'importa-cancellazioni', label: 'Importa Welcome' },
]

// ---------------------------------------------------------------------------
// Componente principale
// ---------------------------------------------------------------------------

export default function Forecast() {
  const [tabAttiva, setTabAttiva] = useState('riepilogo')
  const [anno, setAnno] = useState(new Date().getFullYear())
  const [hotelSelezionato, setHotelSelezionato] = useState('all')
  const [hotels, setHotels] = useState([])
  const [datiRiepilogo, setDatiRiepilogo] = useState(null)
  const [caricando, setCaricando] = useState(false)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    api.get('/hotels/').then(r => setHotels(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (tabAttiva === 'riepilogo') caricaSummary()
  }, [anno, hotelSelezionato, tabAttiva])

  async function caricaSummary() {
    setCaricando(true)
    setErrore(null)
    try {
      const r = await api.get('/forecast/summary', {
        params: { anno, hotel_code: hotelSelezionato },
      })
      setDatiRiepilogo(r.data)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore nel caricamento dati'))
    } finally {
      setCaricando(false)
    }
  }

  return (
    <div>
      <PageHeader title="Forecast & OTB">
        <Select value={anno} onChange={e => setAnno(Number(e.target.value))} aria-label="Anno">
          {ANNI.map(a => <option key={a} value={a}>{a}</option>)}
        </Select>
        <Select value={hotelSelezionato} onChange={e => setHotelSelezionato(e.target.value)} aria-label="Hotel">
          <option value="all">Tutti gli hotel</option>
          {hotels.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}
        </Select>
      </PageHeader>

      <Tabs tabs={TABS} value={tabAttiva} onChange={setTabAttiva} />

      {tabAttiva === 'riepilogo' && (
        <TabRiepilogo
          dati={datiRiepilogo}
          caricando={caricando}
          errore={errore}
          anno={anno}
          hotelCode={hotelSelezionato}
          hotels={hotels}
          onAggiornato={caricaSummary}
        />
      )}
      {tabAttiva === 'pace' && (
        <TabPace
          anno={anno}
          hotels={hotels}
          hotelIniziale={hotelSelezionato !== 'all' ? hotelSelezionato : ''}
        />
      )}
      {tabAttiva === 'maturato' && (
        <TabMaturato
          anno={anno}
          hotels={hotels}
          hotelSelezionato={hotelSelezionato}
          onAggiornato={caricaSummary}
        />
      )}
      {tabAttiva === 'cancellazioni' && (
        <TabCancellazioni anno={anno} hotelCode={hotelSelezionato} hotels={hotels} />
      )}
      {tabAttiva === 'importa-cancellazioni' && <TabImportaCancellazioni />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 1 — Riepilogo Stagione
// ---------------------------------------------------------------------------

function BadgeDelta({ pct }) {
  if (pct == null) return null
  const pos = pct >= 0
  return <Badge tono={pos ? 'ok' : 'err'}>{pos ? '+' : ''}{pct.toFixed(1)}%</Badge>
}

function TabRiepilogo({ dati, caricando, errore, anno, hotelCode, hotels, onAggiornato }) {
  const [editCell, setEditCell] = useState(null)   // { mese, campo: 'budget'|'pickup' }
  const [editVal, setEditVal] = useState('')
  const [salvataggio, setSalvataggio] = useState({})
  const inputRef = useRef(null)

  useEffect(() => {
    if (editCell && inputRef.current) inputRef.current.focus()
  }, [editCell])

  const isSingle = hotelCode !== 'all'

  function apriEdit(mese, campo, valoreCorrente) {
    if (!isSingle) return
    setEditCell({ mese, campo })
    setEditVal(valoreCorrente != null ? String(valoreCorrente) : '')
  }

  async function salva(mese, campo) {
    const valore = parseFloat(String(editVal).replace(',', '.'))
    if (isNaN(valore)) { setEditCell(null); return }
    setSalvataggio(s => ({ ...s, [mese]: 'saving' }))
    setEditCell(null)
    try {
      if (campo === 'budget') {
        await api.put('/forecast/budget', { hotel_code: hotelCode, anno, mese, budget_revenue: valore })
      } else {
        await api.put('/forecast/pickup-config', { hotel_code: hotelCode, anno, mese, pickup_rate: valore / 100 })
      }
      setSalvataggio(s => ({ ...s, [mese]: 'ok' }))
      setTimeout(() => setSalvataggio(s => { const c = { ...s }; delete c[mese]; return c }), 2000)
      onAggiornato()
    } catch {
      setSalvataggio(s => ({ ...s, [mese]: 'err' }))
      setTimeout(() => setSalvataggio(s => { const c = { ...s }; delete c[mese]; return c }), 3000)
    }
  }

  function handleKeyDown(e, mese, campo) {
    if (e.key === 'Enter') salva(mese, campo)
    if (e.key === 'Escape') setEditCell(null)
  }

  if (caricando) return <Loading />
  if (errore) return <Messaggio tipo="err">{errore}</Messaggio>
  if (!dati) return null

  const vuoto = <span style={{ color: colors.borderStrong }}>—</span>

  return (
    <div>
      {!isSingle && (
        <p className="ui-text-muted" style={{ marginTop: 0, marginBottom: 12 }}>
          Vista consolidata — seleziona un hotel per modificare Budget e Pickup%
        </p>
      )}

      <Table>
        <thead>
          <tr>
            <Th>Mese</Th>
            <Th num>OTB Rev.</Th>
            <Th center title="Data dell'ultimo upload Revenue">Snapshot</Th>
            <Th num title="Maturato manuale inserito (override OTB)">Maturato</Th>
            <Th center title="Clicca per modificare (solo singolo hotel)">{isSingle ? 'Pickup % ✏' : 'Pickup %'}</Th>
            <Th num>Forecast</Th>
            <Th center>{isSingle ? 'Budget ✏' : 'Budget'}</Th>
            <Th num>Consuntivo</Th>
            <Th center>Delta</Th>
          </tr>
        </thead>
        <tbody>
          {dati.mesi.map(r => {
            const stato = salvataggio[r.mese]
            const hasMaturato = r.maturato_revenue != null

            return (
              <tr key={r.mese}>
                {/* Mese */}
                <Td muted={r.is_past} style={{ fontWeight: 600 }}>
                  {r.mese_label}
                  {r.is_past && <span style={{ marginLeft: 4, fontSize: 'var(--fs-xs)', color: colors.borderStrong }}>●</span>}
                </Td>

                {/* OTB */}
                <Td num muted={r.is_past}>{r.otb_revenue != null ? formatEuro(r.otb_revenue) : '—'}</Td>

                {/* Snapshot date */}
                <Td center muted style={{ fontSize: 'var(--fs-sm)' }}>
                  {r.otb_snapshot_date ? formatDataIt(r.otb_snapshot_date) : '—'}
                </Td>

                {/* Maturato */}
                <Td num>
                  {hasMaturato ? (
                    <span style={{ color: COLORE_MATURATO, fontWeight: 600 }} title={r.maturato_al ? `al ${formatDataIt(r.maturato_al)}` : ''}>
                      {formatEuro(r.maturato_revenue)}
                      {r.maturato_al && (
                        <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.7, marginLeft: 4 }}>
                          al {formatDataIt(r.maturato_al)}
                        </span>
                      )}
                    </span>
                  ) : vuoto}
                </Td>

                {/* Pickup % */}
                <Td center>
                  {editCell?.mese === r.mese && editCell.campo === 'pickup' ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                      <input
                        ref={inputRef}
                        className="ui-input ui-num"
                        value={editVal}
                        onChange={e => setEditVal(e.target.value)}
                        onBlur={() => salva(r.mese, 'pickup')}
                        onKeyDown={e => handleKeyDown(e, r.mese, 'pickup')}
                        style={{ width: 64, padding: '2px 6px', textAlign: 'right' }}
                      />
                      <span className="ui-text-muted">%</span>
                    </span>
                  ) : (
                    <span
                      onClick={() => apriEdit(r.mese, 'pickup', r.pickup_rate != null ? r.pickup_rate * 100 : null)}
                      className="ui-num"
                      style={{ cursor: isSingle ? 'pointer' : 'default', color: r.pickup_rate != null ? colors.text : colors.borderStrong }}
                      title={isSingle ? 'Clicca per modificare' : ''}
                    >
                      {r.pickup_rate != null ? `+${(r.pickup_rate * 100).toFixed(1)}%` : '—'}
                    </span>
                  )}
                </Td>

                {/* Forecast */}
                <Td num style={{ fontWeight: r.forecast_revenue != null ? 600 : 400 }}>
                  {r.forecast_revenue != null ? (
                    <span style={{ color: hasMaturato ? COLORE_MATURATO : colors.primary }}>
                      {formatEuro(r.forecast_revenue)}
                    </span>
                  ) : '—'}
                </Td>

                {/* Budget */}
                <Td center>
                  {editCell?.mese === r.mese && editCell.campo === 'budget' ? (
                    <input
                      ref={inputRef}
                      className="ui-input ui-num"
                      value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      onBlur={() => salva(r.mese, 'budget')}
                      onKeyDown={e => handleKeyDown(e, r.mese, 'budget')}
                      style={{ width: 110, padding: '2px 6px', textAlign: 'right' }}
                    />
                  ) : (
                    <span
                      onClick={() => apriEdit(r.mese, 'budget', r.budget_revenue)}
                      className="ui-num"
                      style={{ cursor: isSingle ? 'pointer' : 'default', color: r.budget_revenue != null ? colors.text : colors.borderStrong }}
                      title={isSingle ? 'Clicca per modificare' : ''}
                    >
                      {r.budget_revenue != null ? formatEuro(r.budget_revenue) : '—'}
                    </span>
                  )}
                  {stato === 'saving' && <span style={{ marginLeft: 4, color: colors.textSubtle }} title="Salvataggio…">⟳</span>}
                  {stato === 'ok' && <span style={{ marginLeft: 4, color: colors.success }} title="Salvato">✓</span>}
                  {stato === 'err' && <span style={{ marginLeft: 4, color: colors.danger }} title="Errore nel salvataggio">✗</span>}
                </Td>

                {/* Consuntivo */}
                <Td num>
                  {r.consuntivo_revenue != null
                    ? <strong style={{ color: colors.successText }}>{formatEuro(r.consuntivo_revenue)}</strong>
                    : vuoto}
                </Td>

                {/* Delta */}
                <Td center><BadgeDelta pct={r.delta_pct} /></Td>
              </tr>
            )
          })}

          {/* Riga totale */}
          <tr className="ui-riga-totale">
            <Td>Totale stagione</Td>
            <Td num>{dati.totale_otb != null ? formatEuro(dati.totale_otb) : '—'}</Td>
            <Td></Td>
            <Td></Td>
            <Td></Td>
            <Td num>{dati.totale_forecast != null ? formatEuro(dati.totale_forecast) : '—'}</Td>
            <Td center className="ui-num">{dati.totale_budget != null ? formatEuro(dati.totale_budget) : '—'}</Td>
            <Td num>{dati.totale_consuntivo != null ? formatEuro(dati.totale_consuntivo) : '—'}</Td>
            <Td center>
              {dati.totale_budget > 0 && (dati.totale_consuntivo || dati.totale_forecast) && (() => {
                const v = dati.totale_consuntivo || dati.totale_forecast
                return <BadgeDelta pct={((v - dati.totale_budget) / dati.totale_budget) * 100} />
              })()}
            </Td>
          </tr>
        </tbody>
      </Table>

      <div className="ui-text-muted" style={{ marginTop: 8, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <span>● Mesi passati — Consuntivo reale da modulo Revenue</span>
        <span style={{ color: COLORE_MATURATO }}>■ Forecast in viola = calcolato su Maturato manuale</span>
        {isSingle && <span>✏ Clicca su Budget o Pickup% per modificare — Invio per salvare</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 2 — Pace Chart
// ---------------------------------------------------------------------------

function TabPace({ anno, hotels, hotelIniziale }) {
  const [hotelPace, setHotelPace] = useState(hotelIniziale || '')
  const [mesePace, setMesePace] = useState(new Date().getMonth() + 1)
  const [datiPace, setDatiPace] = useState(null)
  const [caricando, setCaricando] = useState(false)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    if (hotelPace) caricaPace()
  }, [hotelPace, mesePace, anno])

  async function caricaPace() {
    if (!hotelPace) return
    setCaricando(true)
    setErrore(null)
    try {
      const r = await api.get('/forecast/pace', { params: { anno, mese: mesePace, hotel_code: hotelPace } })
      setDatiPace(r.data)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore nel caricamento'))
      setDatiPace(null)
    } finally {
      setCaricando(false)
    }
  }

  const punti = datiPace?.punti || []
  const datiGrafico = punti.map(p => ({ data: formatDataIt(p.snapshot_date), otb: p.otb_revenue }))

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Hotel">
          <Select value={hotelPace} onChange={e => setHotelPace(e.target.value)}>
            <option value="">— seleziona —</option>
            {hotels.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}
          </Select>
        </Field>
        <Field label="Mese target">
          <Select value={mesePace} onChange={e => setMesePace(Number(e.target.value))}>
            {MESI_LABEL.map((nome, i) => <option key={i + 1} value={i + 1}>{nome}</option>)}
          </Select>
        </Field>
      </div>

      {!hotelPace && <StatoVuoto>Seleziona un hotel per visualizzare il Pace Chart</StatoVuoto>}

      {caricando && <Loading />}
      <Messaggio tipo="err">{errore}</Messaggio>

      {datiPace && !caricando && (
        <>
          <div className="ui-kpi-row">
            <KpiTile label="OTB attuale" value={punti.length ? formatEuro(punti[punti.length - 1].otb_revenue) : '—'} colore={COLORE_SERIE} minWidth={180} />
            <KpiTile
              label={datiPace.maturato_revenue != null ? `Maturato al ${formatDataIt(datiPace.maturato_al)}` : 'Maturato manuale'}
              value={datiPace.maturato_revenue != null ? formatEuro(datiPace.maturato_revenue) : 'non inserito'}
              colore={COLORE_MATURATO}
              minWidth={180}
            />
            <KpiTile
              label={`Forecast${datiPace.pickup_rate != null ? ` (pickup +${(datiPace.pickup_rate * 100).toFixed(0)}%)` : ''}`}
              value={datiPace.forecast_revenue != null ? formatEuro(datiPace.forecast_revenue) : '—'}
              colore={colors.primary}
              minWidth={180}
            />
            <KpiTile label="Budget" value={datiPace.budget_revenue != null ? formatEuro(datiPace.budget_revenue) : 'non impostato'} minWidth={180} />
          </div>

          {punti.length === 0 ? (
            <StatoVuoto>
              Nessun dato OTB per {MESI_LABEL[mesePace - 1]} {anno}.<br />
              I dati provengono dagli upload settimanali del modulo Revenue.
            </StatoVuoto>
          ) : (
            <Card title={`Crescita OTB — ${datiPace.mese_label} ${anno} · ${datiPace.hotel_code}`}>
              <p className="ui-text-muted" style={{ marginTop: 0 }}>Ogni punto = un upload settimanale del modulo Revenue</p>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={datiGrafico} margin={{ top: 5, right: 40, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.surfaceAlt} />
                  <XAxis dataKey="data" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11 }} width={55} />
                  <Tooltip formatter={v => formatEuro(v)} labelFormatter={l => `Upload del ${l}`} />
                  <Legend />
                  {pastReferenceArea(datiGrafico, 'data')}
                  <Line type="monotone" dataKey="otb" name="OTB Revenue" stroke={COLORE_SERIE} strokeWidth={2.5} dot={{ r: 5 }} activeDot={{ r: 7 }} />
                  {datiPace.budget_revenue != null && (
                    <ReferenceLine y={datiPace.budget_revenue} stroke={colors.textSecond} strokeDasharray="6 3"
                      label={{ value: `Budget ${formatEuro(datiPace.budget_revenue)}`, position: 'insideTopRight', fontSize: 11, fill: colors.textSecond }} />
                  )}
                  {datiPace.maturato_revenue != null && (
                    <ReferenceLine y={datiPace.maturato_revenue} stroke={COLORE_MATURATO} strokeDasharray="4 4"
                      label={{ value: `Maturato ${formatEuro(datiPace.maturato_revenue)}`, position: 'insideBottomRight', fontSize: 11, fill: COLORE_MATURATO }} />
                  )}
                  {datiPace.forecast_revenue != null && datiPace.pickup_rate != null && (
                    <ReferenceLine y={datiPace.forecast_revenue} stroke={colors.primary} strokeDasharray="4 4"
                      label={{ value: `Forecast ${formatEuro(datiPace.forecast_revenue)}`, position: 'insideTopLeft', fontSize: 11, fill: colors.primary }} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 3 — Maturato manuale
// ---------------------------------------------------------------------------

function TabMaturato({ anno, hotels, hotelSelezionato, onAggiornato }) {
  // Form inserimento
  const [formHotel, setFormHotel] = useState(hotelSelezionato !== 'all' ? hotelSelezionato : '')
  const [formMese, setFormMese] = useState(new Date().getMonth() + 1)
  const [formData, setFormData] = useState(new Date().toISOString().slice(0, 10))
  const [formRevenue, setFormRevenue] = useState('')
  const [formRoomNights, setFormRoomNights] = useState('')
  const [formNote, setFormNote] = useState('')
  const [salvando, setSalvando] = useState(false)
  const avvisi = useAvvisi()
  const conferma = useConferma()

  // Lista maturati inseriti
  const [lista, setLista] = useState([])
  const [eliminando, setEliminando] = useState(null)

  const caricaLista = useCallback(async () => {
    try {
      const r = await api.get('/forecast/maturato', {
        params: { anno, hotel_code: hotelSelezionato },
      })
      setLista(r.data)
    } catch {}
  }, [anno, hotelSelezionato])

  useEffect(() => { caricaLista() }, [caricaLista])

  async function handleSalva(e) {
    e.preventDefault()
    const revenue = parseFloat(String(formRevenue).replace(',', '.'))
    if (!formHotel || isNaN(revenue) || !formData) return
    setSalvando(true)
    try {
      const r = await api.put('/forecast/maturato', {
        hotel_code: formHotel,
        anno,
        mese: formMese,
        data_riferimento: formData,
        maturato_revenue: revenue,
        maturato_room_nights: formRoomNights ? parseInt(formRoomNights) : null,
        note: formNote || null,
      })
      avvisi.successo(`Salvato: ${r.data.mese_label} ${anno} · ${formatEuro(r.data.maturato_revenue)} al ${formatDataIt(r.data.data_riferimento)}`)
      setFormRevenue('')
      setFormRoomNights('')
      setFormNote('')
      caricaLista()
      onAggiornato()
    } catch (err) {
      avvisi.errore(mostraErrore(err, 'Errore durante il salvataggio'))
    } finally {
      setSalvando(false)
    }
  }

  async function handleElimina(id) {
    if (!(await conferma({ titolo: 'Eliminare questo record maturato?', pericolo: true }))) return
    setEliminando(id)
    try {
      await api.delete(`/forecast/maturato/${id}`)
      caricaLista()
      onAggiornato()
    } catch (err) {
      avvisi.errore(mostraErrore(err, 'Errore durante l\'eliminazione'))
    } finally {
      setEliminando(null)
    }
  }

  const pieno = { width: '100%' }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 40 }}>

      {/* Form inserimento */}
      <div>
        <SectionTitle as="h3">Inserisci maturato</SectionTitle>
        <p className="ui-text-muted" style={{ marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
          Il maturato è la revenue confermata su un mese fino alla data indicata.
          Sostituisce l'OTB calcolato automaticamente nel calcolo del forecast.
        </p>

        <form onSubmit={handleSalva} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Hotel *" style={pieno}>
            <Select value={formHotel} onChange={e => setFormHotel(e.target.value)} style={pieno} required>
              <option value="">— seleziona —</option>
              {hotels.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}
            </Select>
          </Field>

          <Field label="Mese *" style={pieno}>
            <Select value={formMese} onChange={e => setFormMese(Number(e.target.value))} style={pieno}>
              {MESI_LABEL.map((nome, i) => <option key={i + 1} value={i + 1}>{nome}</option>)}
            </Select>
          </Field>

          <Field label="Al giorno *" style={pieno}>
            <Input type="date" value={formData} onChange={e => setFormData(e.target.value)} required style={pieno} />
          </Field>

          <Field label="Revenue maturata (€) *" style={pieno}>
            <Input type="text" inputMode="decimal" placeholder="es. 45000.00" value={formRevenue}
              onChange={e => setFormRevenue(e.target.value)} required style={pieno} />
          </Field>

          <Field label="Room nights (opzionale)" style={pieno}>
            <Input type="number" min="0" placeholder="es. 312" value={formRoomNights}
              onChange={e => setFormRoomNights(e.target.value)} style={pieno} />
          </Field>

          <Field label="Note (opzionale)" style={pieno}>
            <Textarea rows={2} value={formNote} onChange={e => setFormNote(e.target.value)}
              placeholder="es. Dato estratto dal PMS il 10/06" style={pieno} />
          </Field>

          <Button type="submit" disabled={salvando || !formHotel || !formRevenue}>
            {salvando ? 'Salvataggio…' : 'Salva maturato'}
          </Button>
        </form>
      </div>

      {/* Lista maturati */}
      <div>
        <SectionTitle as="h3">Maturati inseriti — {anno}</SectionTitle>

        {lista.length === 0 ? (
          <StatoVuoto>Nessun maturato inserito per {anno}.</StatoVuoto>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Hotel</Th>
                <Th>Mese</Th>
                <Th center>Al giorno</Th>
                <Th num>Revenue</Th>
                <Th num>RN</Th>
                <Th>Note</Th>
                <Th center>Azioni</Th>
              </tr>
            </thead>
            <tbody>
              {lista.map(r => (
                <tr key={r.id}>
                  <Td><HotelTag code={r.hotel_code} /></Td>
                  <Td>{r.mese_label}</Td>
                  <Td center style={{ color: colors.textMuted }}>{formatDataIt(r.data_riferimento)}</Td>
                  <Td num style={{ fontWeight: 700, color: COLORE_MATURATO }}>{formatEuro(r.maturato_revenue)}</Td>
                  <Td num style={{ color: colors.textMuted }}>{r.maturato_room_nights ?? '—'}</Td>
                  <Td muted style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.note || ''}>
                    {r.note || '—'}
                  </Td>
                  <Td center>
                    <Button variant="danger-soft" size="sm" onClick={() => handleElimina(r.id)} disabled={eliminando === r.id} title="Elimina">
                      {eliminando === r.id ? '…' : '🗑'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <p className="ui-text-muted" style={{ marginTop: 16 }}>
          Il maturato sovrascrive l'OTB calcolato da daily_revenue nel tab Riepilogo.
          Inserendo un nuovo valore per lo stesso hotel/mese si aggiorna il precedente.
        </p>
      </div>
    </div>
  )
}
// ---------------------------------------------------------------------------
// Tab 4 — Cancellazioni (import Welcome)
// ---------------------------------------------------------------------------

function TabCancellazioni({ anno, hotelCode, hotels }) {
  const [hotelFiltro, setHotelFiltro] = useState(hotelCode || 'all')
  const [canaliDisponibili, setCanaliDisponibili] = useState([])
  const [canaliSelezionati, setCanaliSelezionati] = useState([])
  const [arrivoDa, setArrivoDa] = useState('')
  const [arrivoA, setArrivoA] = useState('')
  const [prenotazioneDa, setPrenotazioneDa] = useState('')
  const [prenotazioneA, setPrenotazioneA] = useState('')
  const [ricercaInput, setRicercaInput] = useState('')
  const [ricerca, setRicerca] = useState('')

  const [dati, setDati] = useState(null)
  const [datiTasso, setDatiTasso] = useState(null)
  const [righe, setRighe] = useState(null)
  const [pagina, setPagina] = useState(1)
  const [errore, setErrore] = useState(null)
  const [caricandoDati, setCaricandoDati] = useState(false)
  const [rigaInModifica, setRigaInModifica] = useState(null)
  const [eliminandoId, setEliminandoId] = useState(null)
  const [ordinaPer, setOrdinaPer] = useState('data_prenotazione')
  const [direzione, setDirezione] = useState('desc')
  const [vistaPeriodo, setVistaPeriodo] = useState(() => localStorage.getItem('cancellazioni_vista_periodo') || 'mensile')
  const [vistaMetrica, setVistaMetrica] = useState(() => localStorage.getItem('cancellazioni_vista_metrica') || 'prenotazioni')
  const avvisi = useAvvisi()
  const conferma = useConferma()

  useEffect(() => {
    localStorage.setItem('cancellazioni_vista_periodo', vistaPeriodo)
  }, [vistaPeriodo])

  useEffect(() => {
    localStorage.setItem('cancellazioni_vista_metrica', vistaMetrica)
  }, [vistaMetrica])

  function ordinaColonna(campo) {
    if (ordinaPer === campo) {
      setDirezione(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setOrdinaPer(campo)
      setDirezione('asc')
    }
  }

  // Debounce della ricerca libera: evita una richiesta per ogni carattere digitato.
  useEffect(() => {
    const t = setTimeout(() => setRicerca(ricercaInput), 400)
    return () => clearTimeout(t)
  }, [ricercaInput])

  // Elenco canali disponibili — NON dipende dai canali selezionati, altrimenti la lista di
  // checkbox si restringerebbe da sola man mano che se ne selezionano.
  useEffect(() => {
    api.get('/prenotazioni-cancellate/canali', {
      params: { anno, hotel_code: hotelFiltro, arrivo_da: arrivoDa || undefined, arrivo_a: arrivoA || undefined, prenotazione_da: prenotazioneDa || undefined, prenotazione_a: prenotazioneA || undefined },
    }).then(r => setCanaliDisponibili(r.data.canali)).catch(() => {})
  }, [anno, hotelFiltro, arrivoDa, arrivoA, prenotazioneDa, prenotazioneA])

  const paramsFiltri = {
    anno,
    hotel_code: hotelFiltro,
    canali: canaliSelezionati.length ? canaliSelezionati.join(',') : undefined,
    arrivo_da: arrivoDa || undefined,
    arrivo_a: arrivoA || undefined,
    prenotazione_da: prenotazioneDa || undefined,
    prenotazione_a: prenotazioneA || undefined,
  }

  const caricaReport = useCallback(async () => {
    setCaricandoDati(true)
    setErrore(null)
    try {
      const r = await api.get('/prenotazioni-cancellate/report', { params: paramsFiltri })
      setDati(r.data)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore nel caricamento'))
      setDati(null)
    } finally {
      setCaricandoDati(false)
    }
  }, [anno, hotelFiltro, canaliSelezionati, arrivoDa, arrivoA, prenotazioneDa, prenotazioneA])

  const caricaTasso = useCallback(async () => {
    try {
      const r = await api.get('/prenotazioni-cancellate/tasso-cancellazione', { params: paramsFiltri })
      setDatiTasso(r.data)
    } catch {
      setDatiTasso(null)
    }
  }, [anno, hotelFiltro, canaliSelezionati, arrivoDa, arrivoA, prenotazioneDa, prenotazioneA])

  const caricaRighe = useCallback(async () => {
    try {
      const r = await api.get('/prenotazioni-cancellate/', {
        params: { ...paramsFiltri, q: ricerca || undefined, ordina_per: ordinaPer, direzione, pagina, per_pagina: 20 },
      })
      setRighe(r.data)
    } catch {}
  }, [anno, hotelFiltro, canaliSelezionati, arrivoDa, arrivoA, prenotazioneDa, prenotazioneA, ricerca, ordinaPer, direzione, pagina])

  useEffect(() => { caricaReport() }, [caricaReport])
  useEffect(() => { caricaTasso() }, [caricaTasso])
  useEffect(() => { caricaRighe() }, [caricaRighe])
  useEffect(() => { setPagina(1) }, [canaliSelezionati, arrivoDa, arrivoA, prenotazioneDa, prenotazioneA, anno, hotelFiltro, ricerca, ordinaPer, direzione])

  async function handleElimina(riga) {
    if (!(await conferma({
      titolo: 'Eliminare la prenotazione?',
      messaggio: `Prenotazione ${riga.numero_prenotazione || riga.id} (${riga.cliente || 'senza nome'}, ${riga.hotel_code}). L'operazione non è reversibile.`,
      pericolo: true,
    }))) return
    setEliminandoId(riga.id)
    try {
      await api.delete(`/prenotazioni-cancellate/${riga.id}?conferma=true`)
      caricaRighe()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setEliminandoId(null)
    }
  }

  const datiGrafico = dati ? dati.per_mese.map(m => ({ mese: m.mese_label, n: m.n, importo: m.importo })) : []
  const datiGraficoArrivo = dati ? dati.per_mese_arrivo.map(m => ({ mese: m.mese_label, n: m.n, importo: m.importo })) : []
  const datiGraficoGiorno = dati ? dati.per_giorno.map(g => ({ giorno: g.data.slice(5), n: g.n, importo: g.importo })) : []
  const datiGraficoGiornoArrivo = dati ? dati.per_giorno_arrivo.map(g => ({ giorno: g.data.slice(5), n: g.n, importo: g.importo })) : []
  const giornaliero = vistaPeriodo === 'giornaliero'
  const fatturato = vistaMetrica === 'fatturato'
  const metricaKey = fatturato ? 'importo' : 'n'
  const metricaNome = fatturato ? 'Importo cancellato' : 'Camere cancellate'
  const metricaFormatter = v => fatturato ? formatEuro(v) : v
  // Stessi due assi degli altri due grafici della tab: mensile/giornaliero e conteggio/importo.
  const datiGraficoTasso = datiTasso
    ? (giornaliero ? datiTasso.per_giorno : datiTasso.per_mese).map(v => ({
        periodo: v.data ? v.data.slice(5) : v.mese_label,
        tasso: fatturato ? v.tasso_importo_pct : v.tasso_pct,
        cancellate: fatturato ? v.totale_cancellato_importo : v.totale_cancellato,
        totale: fatturato ? v.totale_prenotato_importo : v.totale_prenotato,
      }))
    : []
  const tassoPerCanale = Object.fromEntries((datiTasso?.per_canale || []).map(c => [c.canale, c.tasso_pct]))

  // Un grafico della tab: stesso schema per prenotazione/arrivo, a barre (mensile) o linea (giornaliero)
  const grafico = (datiMese, datiGiorno) => (
    <ResponsiveContainer width="100%" height={280}>
      {giornaliero ? (
        <LineChart data={datiGiorno} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.surfaceAlt} />
          <XAxis dataKey="giorno" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={20} />
          <YAxis tick={{ fontSize: 11 }} width={fatturato ? 60 : 40} allowDecimals={false} />
          <Tooltip formatter={metricaFormatter} />
          <Legend formatter={legendaNeutra} />
          <Line type="monotone" dataKey={metricaKey} name={metricaNome} stroke={COLORE_SERIE} strokeWidth={2} dot={false} />
        </LineChart>
      ) : (
        <BarChart data={datiMese} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.surfaceAlt} />
          <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={fatturato ? 60 : 40} allowDecimals={false} />
          <Tooltip formatter={metricaFormatter} />
          <Legend formatter={legendaNeutra} />
          <Bar dataKey={metricaKey} name={metricaNome} fill={COLORE_SERIE} radius={[4, 4, 0, 0]} />
        </BarChart>
      )}
    </ResponsiveContainer>
  )

  const tassoPeriodo = fatturato ? datiTasso?.tasso_importo_pct : datiTasso?.tasso_pct
  const sp = { ordinaPer, direzione, onOrdina: ordinaColonna }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Struttura">
          <Select value={hotelFiltro} onChange={e => setHotelFiltro(e.target.value)}>
            <option value="all">Tutti gli hotel</option>
            {hotels.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}
          </Select>
        </Field>
        <Field label="Canale">
          <Select
            value={canaliSelezionati[0] || ''}
            onChange={e => setCanaliSelezionati(e.target.value ? [e.target.value] : [])}
          >
            <option value="">Tutti</option>
            {canaliDisponibili.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Arrivo da"><Input type="date" value={arrivoDa} onChange={e => setArrivoDa(e.target.value)} /></Field>
        <Field label="Arrivo a"><Input type="date" value={arrivoA} onChange={e => setArrivoA(e.target.value)} /></Field>
        <Field label="Prenotazione da"><Input type="date" value={prenotazioneDa} onChange={e => setPrenotazioneDa(e.target.value)} /></Field>
        <Field label="Prenotazione a"><Input type="date" value={prenotazioneA} onChange={e => setPrenotazioneA(e.target.value)} /></Field>
        <Button
          variant="secondary"
          title={`Imposta le quattro date su 1/10/${anno - 1} – 30/9/${anno}`}
          onClick={() => {
            // Anno commerciale: 1 ottobre dell'anno precedente - 30 settembre di "anno"
            // (coerente con l'ordine ott→set già usato nei grafici mensili di questa tab).
            setArrivoDa(`${anno - 1}-10-01`)
            setArrivoA(`${anno}-09-30`)
            setPrenotazioneDa(`${anno - 1}-10-01`)
            setPrenotazioneA(`${anno}-09-30`)
          }}
        >
          Anno com. {anno}
        </Button>
      </div>

      {caricandoDati && <Loading />}
      <Messaggio tipo="err">{errore}</Messaggio>

      {dati && !caricandoDati && (
        <>
          <div className="ui-kpi-row" style={{ alignItems: 'stretch' }}>
            <KpiTile label="Camere cancellate" value={dati.totale_n} colore={COLORE_SERIE} minWidth={150} />
            <KpiTile label="Importo cancellato" value={formatEuro(dati.totale_importo)} colore={COLORE_SERIE} minWidth={150} />
            <KpiTile label="% Cancellazioni" value={datiTasso?.tasso_pct != null ? `${datiTasso.tasso_pct}%` : '—'} colore={COLORE_SERIE} minWidth={150} />
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, marginLeft: 'auto' }}>
              <SegmentedControl value={vistaPeriodo} onChange={setVistaPeriodo}
                options={[{ value: 'mensile', label: 'Mensile' }, { value: 'giornaliero', label: 'Giornaliero' }]} />
              <SegmentedControl value={vistaMetrica} onChange={setVistaMetrica}
                options={[{ value: 'prenotazioni', label: 'Prenotazioni' }, { value: 'fatturato', label: 'Fatturato' }]} />
            </div>
          </div>

          <Card title={`Per ${giornaliero ? 'giorno' : 'mese'} di prenotazione — ${anno} · ${dati.hotel_code}`} style={{ marginBottom: 20 }}>
            {grafico(datiGrafico, datiGraficoGiorno)}
          </Card>

          <Card title={`Per ${giornaliero ? 'giorno' : 'mese'} di arrivo — ${anno} · ${dati.hotel_code}`} style={{ marginBottom: 20 }}>
            {grafico(datiGraficoArrivo, datiGraficoGiornoArrivo)}
          </Card>

          {datiTasso && (
            <Card
              title={`Tasso di cancellazione per ${giornaliero ? 'giorno' : 'mese'} di prenotazione${fatturato ? ' (su fatturato)' : ' (su numero prenotazioni)'} — ${anno} · ${datiTasso.hotel_code}`}
              style={{ marginBottom: 20 }}
            >
              <p className="ui-text-muted" style={{ margin: '0 0 6px' }}>
                Richiede sia l'import "Disdette" sia "Prenotazioni non disdette" per questo periodo —
                senza il secondo il totale prenotato è incompleto e il tasso risulta gonfiato.
              </p>
              <p style={{ margin: '0 0 16px', fontSize: 'var(--fs-md)', color: COLORE_SERIE, fontWeight: 700 }}>
                Tasso di cancellazione (media periodo {tassoPeriodo != null ? `${tassoPeriodo}%` : 'n/d'})
              </p>
              <ResponsiveContainer width="100%" height={280}>
                {giornaliero ? (
                  <LineChart data={datiGraficoTasso} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.surfaceAlt} />
                    <XAxis dataKey="periodo" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={20} />
                    <YAxis tick={{ fontSize: 11 }} width={45} unit="%" />
                    <Tooltip content={<TooltipTasso fatturato={fatturato} />} />
                    <Legend formatter={legendaNeutra} />
                    <Line type="monotone" dataKey="tasso" name="Tasso cancellazione" stroke={COLORE_SERIE} strokeWidth={2} dot={false} />
                  </LineChart>
                ) : (
                  <BarChart data={datiGraficoTasso} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.surfaceAlt} />
                    <XAxis dataKey="periodo" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={45} unit="%" />
                    <Tooltip content={<TooltipTasso fatturato={fatturato} />} />
                    <Legend formatter={legendaNeutra} />
                    <Bar dataKey="tasso" name="Tasso cancellazione" fill={COLORE_SERIE} radius={[4, 4, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </Card>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
            <div>
              <SectionTitle as="h3">Per struttura</SectionTitle>
              <Table compact>
                <thead><tr><Th>Hotel</Th><Th num>N.</Th><Th num>Importo</Th></tr></thead>
                <tbody>
                  {dati.per_hotel.map(h => (
                    <tr key={h.hotel_code}>
                      <Td><HotelTag code={h.hotel_code} /></Td>
                      <Td num>{h.n}</Td>
                      <Td num>{formatEuro(h.importo)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <div>
              <SectionTitle as="h3">Per canale</SectionTitle>
              <Table compact>
                <thead><tr><Th>Canale</Th><Th num>N.</Th><Th num>% Disdette</Th><Th num>Importo</Th></tr></thead>
                <tbody>
                  {dati.per_canale.map(c => (
                    <tr key={c.canale}>
                      <Td>{c.canale}</Td>
                      <Td num>{c.n}</Td>
                      <Td num style={{ color: COLORE_SERIE }}>
                        {tassoPerCanale[c.canale] != null ? `${tassoPerCanale[c.canale]}%` : '—'}
                      </Td>
                      <Td num>{formatEuro(c.importo)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
            <SectionTitle as="h3" style={{ margin: 0 }}>Dettaglio prenotazioni cancellate</SectionTitle>
            <Input
              type="text"
              placeholder="Cerca su tutti i campi (cliente, camera, codice, importo, data...)"
              value={ricercaInput}
              onChange={e => setRicercaInput(e.target.value)}
              style={{ minWidth: 340 }}
            />
          </div>
          {righe && (
            <>
              <Table compact>
                <thead>
                  <tr>
                    <ThOrdinabile campo="hotel_code" {...sp}>Hotel</ThOrdinabile>
                    <ThOrdinabile campo="canale" {...sp}>Canale</ThOrdinabile>
                    <ThOrdinabile campo="numero_prenotazione" {...sp}>Codice Prenotazione</ThOrdinabile>
                    <ThOrdinabile campo="data_prenotazione" center {...sp}>Data prenotazione</ThOrdinabile>
                    <ThOrdinabile campo="data_cancellazione" center {...sp}>Data cancellazione</ThOrdinabile>
                    <ThOrdinabile campo="arrivo" center {...sp}>Arrivo</ThOrdinabile>
                    <ThOrdinabile campo="partenza" center {...sp}>Partenza</ThOrdinabile>
                    <ThOrdinabile campo="cliente" {...sp}>Cliente</ThOrdinabile>
                    <ThOrdinabile campo="tipo_camera" {...sp}>Camera</ThOrdinabile>
                    <ThOrdinabile campo="importo" num {...sp}>Importo</ThOrdinabile>
                    <Th center>Azioni</Th>
                  </tr>
                </thead>
                <tbody>
                  {righe.righe.map(r => (
                    <tr key={r.id}>
                      <Td><HotelTag code={r.hotel_code} /></Td>
                      <Td>{r.canale}</Td>
                      <Td>
                        {r.numero_prenotazione || <span style={{ color: colors.borderStrong }}>—</span>}
                        {r.modificato_manualmente && (
                          <span title="Corretta manualmente — non verrà mai sovrascritta da un reimport" style={{ marginLeft: 5 }}>✏️</span>
                        )}
                      </Td>
                      <Td center>{formatDataIt(r.data_prenotazione)}</Td>
                      <Td center>
                        {r.data_cancellazione
                          ? formatDataIt(r.data_cancellazione)
                          : <span style={{ color: colors.textSubtle }} title="Data cancellazione non disponibile — mostrata la data in cui questa riga è stata rilevata per la prima volta da un import">
                              ~{formatDataIt(r.data_rilevata)}
                            </span>}
                      </Td>
                      <Td center>{formatDataIt(r.arrivo)}</Td>
                      <Td center>{formatDataIt(r.partenza)}</Td>
                      <Td>{r.cliente}</Td>
                      <Td>{r.tipo_camera}</Td>
                      <Td num style={{ fontWeight: 600 }}>{formatEuro(r.importo)}</Td>
                      <Td center style={{ whiteSpace: 'nowrap' }}>
                        {isAdmin() && (
                          <>
                            <Button variant="secondary" size="sm" onClick={() => setRigaInModifica(r)} title="Modifica" style={{ marginRight: 4 }}>
                              ✏️
                            </Button>
                            <Button variant="danger-soft" size="sm" onClick={() => handleElimina(r)} disabled={eliminandoId === r.id} title="Elimina">
                              {eliminandoId === r.id ? '…' : '🗑'}
                            </Button>
                          </>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Paginazione pagina={righe.pagina} perPagina={righe.per_pagina} totale={righe.totale} onChange={setPagina} />
            </>
          )}
        </>
      )}

      {rigaInModifica && (
        <ModaleModificaCancellazione
          riga={rigaInModifica}
          hotels={hotels}
          onClose={() => setRigaInModifica(null)}
          onSalvato={() => { setRigaInModifica(null); caricaRighe() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modale — modifica prenotazione cancellata
// ---------------------------------------------------------------------------

function ModaleModificaCancellazione({ riga, hotels, onClose, onSalvato }) {
  const [form, setForm] = useState({
    hotel_code: riga.hotel_code || '',
    canale: riga.canale || '',
    canale_vendita: riga.canale_vendita || '',
    codice_ota: riga.codice_ota || '',
    numero_prenotazione: riga.numero_prenotazione || '',
    data_cancellazione: riga.data_cancellazione || '',
    data_prenotazione: riga.data_prenotazione || '',
    arrivo: riga.arrivo || '',
    partenza: riga.partenza || '',
    pax: riga.pax ?? 0,
    cliente: riga.cliente || '',
    email: riga.email || '',
    tipo_camera: riga.tipo_camera || '',
    trattamento: riga.trattamento || '',
    mercato: riga.mercato || '',
    importo: riga.importo ?? 0,
    cancellata: riga.cancellata ?? true,
  })
  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState(null)

  function set(campo, valore) { setForm(f => ({ ...f, [campo]: valore })) }

  async function salva() {
    setSalvando(true)
    setErrore(null)
    try {
      await api.put(`/prenotazioni-cancellate/${riga.id}`, {
        ...form,
        data_cancellazione: form.data_cancellazione || null,
        email: form.email || null,
        trattamento: form.trattamento || null,
        mercato: form.mercato || null,
        numero_prenotazione: form.numero_prenotazione || null,
        pax: Number(form.pax) || 0,
        importo: Number(form.importo) || 0,
      })
      onSalvato()
    } catch (e) {
      setErrore(mostraErrore(e))
    } finally {
      setSalvando(false)
    }
  }

  const campo = (label, key, tipo = 'text') => (
    <Field label={label} style={{ width: '100%' }}>
      <Input type={tipo} value={form[key]} onChange={e => set(key, e.target.value)} style={{ width: '100%' }} />
    </Field>
  )

  return (
    <Modal
      titolo="Modifica prenotazione cancellata"
      onChiudi={salvando ? undefined : onClose}
      larghezza={660}
      chiudiSuSfondo={false}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={salvando}>Annulla</Button>
        <Button onClick={salva} disabled={salvando}>{salvando ? 'Salvataggio…' : 'Salva'}</Button>
      </>}
    >
      <div style={{ whiteSpace: 'normal' }}>
        <Checkbox
          checked={form.cancellata}
          onChange={v => set('cancellata', v)}
          label="Prenotazione cancellata (se disattivato, conta come prenotazione ancora valida nel tasso di cancellazione)"
          style={{ marginBottom: 16 }}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <Field label="Hotel" style={{ width: '100%' }}>
            <Select value={form.hotel_code} onChange={e => set('hotel_code', e.target.value)} style={{ width: '100%' }}>
              {hotels.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}
            </Select>
          </Field>
          {campo('Codice Prenotazione', 'numero_prenotazione')}
          {campo('Canale', 'canale')}
          {campo('Canale vendita', 'canale_vendita')}
          {campo('Codice OTA', 'codice_ota')}
          {campo('Camera', 'tipo_camera')}
          {campo('Data prenotazione', 'data_prenotazione', 'date')}
          {campo('Data cancellazione', 'data_cancellazione', 'date')}
          {campo('Arrivo', 'arrivo', 'date')}
          {campo('Partenza', 'partenza', 'date')}
          {campo('Pax', 'pax', 'number')}
          {campo('Importo (€)', 'importo', 'number')}
          {campo('Cliente', 'cliente')}
          {campo('Email', 'email')}
          {campo('Trattamento', 'trattamento')}
          {campo('Mercato', 'mercato')}
        </div>

        {riga.dati_grezzi && Object.keys(riga.dati_grezzi).length > 0 && (
          <details style={{ marginBottom: 16 }}>
            <summary style={{ cursor: 'pointer', fontSize: 'var(--fs-base)', color: colors.textMuted, fontWeight: 600 }}>
              Dati grezzi dal file (sola lettura, {Object.keys(riga.dati_grezzi).length} campi)
            </summary>
            <Table compact style={{ marginTop: 10 }}>
              <tbody>
                {Object.entries(riga.dati_grezzi).map(([k, v]) => (
                  <tr key={k}>
                    <Td style={{ color: colors.textMuted, fontWeight: 600, whiteSpace: 'nowrap' }}>{k}</Td>
                    <Td>{v === null || v === '' ? '—' : String(v)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </details>
        )}

        <Messaggio tipo="err">{errore}</Messaggio>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Tab 5 — Importa Welcome
// ---------------------------------------------------------------------------

function TabImportaCancellazioni() {
  const [meseUpload, setMeseUpload] = useState('') // '' = intera stagione (nessun filtro/etichetta di mese)
  const [annoUpload, setAnnoUpload] = useState(new Date().getFullYear())
  const [tipoImport, setTipoImport] = useState('disdetta')
  const [sovrascrivi, setSovrascrivi] = useState(false)
  const [caricando, setCaricando] = useState(false)
  const [esitoImport, setEsitoImport] = useState(null)
  const inputRef = useRef(null)
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const [storico, setStorico] = useState(null)
  const [eliminando, setEliminando] = useState(null)

  const caricaStorico = useCallback(async () => {
    try {
      const r = await api.get('/prenotazioni-cancellate/import/storico')
      setStorico(r.data)
    } catch {}
  }, [])

  useEffect(() => { caricaStorico() }, [caricaStorico])

  async function handleUpload(file) {
    if (!file) return
    if (!file.name.toLowerCase().match(/\.(csv|xlsx)$/)) {
      setEsitoImport({ ok: false, msg: 'Seleziona un file CSV o XLSX' })
      return
    }
    setCaricando(true)
    setEsitoImport(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const qsMese = meseUpload ? `&mese=${meseUpload}` : ''
      const onConflict = sovrascrivi ? 'aggiorna' : 'salta'
      const { data } = await api.post(
        `/prenotazioni-cancellate/import?anno=${annoUpload}&tipo=${tipoImport}&on_conflict=${onConflict}${qsMese}`,
        form, { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      setEsitoImport({
        ok: true,
        msg: `Importate ${data.n_inserite} righe`
          + (data.n_aggiornate ? `, aggiornate ${data.n_aggiornate}` : '')
          + ` (${data.n_saltate} già presenti, non toccate).`
          + (data.warning.length ? ' ' + data.warning.join(' ') : ''),
        bloccate: data.messaggi_bloccate || [],
      })
      caricaStorico()
    } catch (err) {
      setEsitoImport({ ok: false, msg: mostraErrore(err) })
    } finally {
      setCaricando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleElimina(id) {
    if (!(await conferma({ titolo: 'Eliminare questo import?', messaggio: 'Verranno eliminate anche tutte le righe collegate.', pericolo: true }))) return
    setEliminando(id)
    try {
      await api.delete(`/prenotazioni-cancellate/import/${id}?conferma=true`)
      caricaStorico()
    } catch (err) {
      avvisi.errore(mostraErrore(err))
    } finally {
      setEliminando(null)
    }
  }

  if (!isAdmin()) {
    return <StatoVuoto>Sezione riservata agli amministratori.</StatoVuoto>
  }

  return (
    <div>
      <p className="ui-text-muted" style={{ marginTop: 0, marginBottom: 16, lineHeight: 1.5, fontSize: 'var(--fs-base)' }}>
        Carica qui l'export Welcome "Elenco Prenotazioni" (o, in formato legacy, "PrenotazioniWeb"
        foglio DISDETTE). Welcome non permette di esportare in un solo file sia le prenotazioni
        cancellate sia quelle ancora valide: per calcolare il tasso di cancellazione servono
        entrambi i file, caricati separatamente con il tipo giusto qui sotto. Ogni riga porta già
        le proprie date reali: "Mese" qui sotto è solo un'etichetta per lo storico import,
        lascialo su "Intera stagione" per un file che copre più mesi o tutti gli hotel insieme.
      </p>

      <Card title="Importa export Welcome" style={{ marginBottom: 32 }}>
        <div style={{ marginBottom: 12 }}>
          <SegmentedControl value={tipoImport} onChange={setTipoImport}
            options={[{ value: 'disdetta', label: 'Disdette' }, { value: 'non_disdetta', label: 'Prenotazioni non disdette' }]} />
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Mese (etichetta, opzionale)">
            <Select value={meseUpload} onChange={e => setMeseUpload(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Intera stagione</option>
              {MESI_LABEL.map((nome, i) => <option key={i + 1} value={i + 1}>{nome}</option>)}
            </Select>
          </Field>
          <Field label="Anno">
            <Select value={annoUpload} onChange={e => setAnnoUpload(Number(e.target.value))}>
              {ANNI.map(a => <option key={a} value={a}>{a}</option>)}
            </Select>
          </Field>
          <label className="ui-btn ui-btn-primary" style={caricando ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
            {caricando ? 'Caricamento…' : 'Scegli file CSV / XLSX…'}
            <input ref={inputRef} type="file" accept=".csv,.xlsx" onChange={e => handleUpload(e.target.files[0])} disabled={caricando} style={{ display: 'none' }} />
          </label>
        </div>
        <Checkbox
          checked={sovrascrivi}
          onChange={setSovrascrivi}
          label="Sovrascrivi prenotazioni già presenti (solo quelle mai modificate a mano — le modificate non vengono mai toccate)"
          style={{ marginTop: 12 }}
        />
        {esitoImport && (
          <div style={{ marginTop: 12 }}>
            <Messaggio tipo={esitoImport.ok ? 'ok' : 'err'} onChiudi={() => setEsitoImport(null)}>{esitoImport.msg}</Messaggio>
          </div>
        )}
        {esitoImport?.bloccate?.length > 0 && (
          <Messaggio tipo="warn">
            <strong>{esitoImport.bloccate.length} prenotazioni non importate perché già modificate a mano:</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
              {esitoImport.bloccate.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </Messaggio>
        )}
      </Card>

      <SectionTitle as="h3">Import effettuati</SectionTitle>
      {storico && (
        storico.length === 0 ? (
          <StatoVuoto>Nessun import ancora effettuato.</StatoVuoto>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>File</Th><Th>Tipo</Th><Th>Mese prenotazione</Th><Th num>Righe valide</Th>
                <Th num>Fuori mese</Th><Th center>Caricato il</Th><Th center>Azioni</Th>
              </tr>
            </thead>
            <tbody>
              {storico.map(imp => (
                <tr key={imp.id}>
                  <Td>{imp.nome_file}</Td>
                  <Td><Badge tono={imp.tipo === 'disdetta' ? 'err' : 'ok'}>{imp.tipo_label}</Badge></Td>
                  <Td>{imp.mese_label} {imp.anno}</Td>
                  <Td num>{imp.n_righe_valide}</Td>
                  <Td num style={{ color: imp.n_righe_fuori_mese ? colors.warning : colors.borderStrong }}>
                    {imp.n_righe_fuori_mese || '—'}
                  </Td>
                  <Td center style={{ color: colors.textMuted }}>{formatDataIt(imp.created_at)}</Td>
                  <Td center>
                    <Button variant="danger-soft" size="sm" onClick={() => handleElimina(imp.id)} disabled={eliminando === imp.id} title="Elimina import">
                      {eliminando === imp.id ? '…' : '🗑'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sottocomponenti
// ---------------------------------------------------------------------------

function TooltipTasso({ active, payload, label, fatturato }) {
  if (!active || !payload || !payload.length) return null
  const p = payload[0].payload
  const fmt = v => fatturato ? formatEuro(v) : v
  return (
    <div style={{
      background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6,
      padding: '6px 10px', fontSize: 'var(--fs-sm)', boxShadow: '0 2px 6px rgba(15,23,42,0.1)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{label}</div>
      <div>Tasso: {p.tasso != null ? `${p.tasso}%` : 'n/d'}</div>
      <div style={{ color: colors.textMuted }}>{fmt(p.cancellate)} cancellat{fatturato ? 'o' : 'e'} su {fmt(p.totale)} prenotat{fatturato ? 'o' : 'e'}</div>
    </div>
  )
}
