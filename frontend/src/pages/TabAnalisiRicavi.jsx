/**
 * TabAnalisiRicavi — Analisi ricavi mensili per trattamento e reparto.
 * Caricamento CSV (auto-detect trattamenti/reparti), tabelle editabili inline,
 * vista per hotel e vista gruppo, toggle dettaglio/macrocategorie.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer } from 'recharts'
import api from '../api/client'
import { formatEuro, mostraErrore } from '../utils/format'
import {
  Badge, Button, Card, Checkbox, Dot, DropZone, HotelTag, Input, Loading, Messaggio, SectionTitle,
  SegmentedControl, Select, StatoVuoto, Table, Tabs, Td, Th, useAvvisi, useConferma,
} from '../components/ui'
import { colors, PALETTE_CATEGORICA, coloreSerie } from '../styles/tokens.js'

const MESI = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
              'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

// Il CSV Passbi è sempre IVA inclusa e non riporta l'aliquota: con "IVA esclusa" si scorpora
// un'IVA presunta al 10% su tutto (stima — avviso sotto il toggle in Corrispettivi.jsx).
// Le % restano invariate (aliquota uniforme). revenue_module non toccato (non viene da Passbi).
// Stessa regola dell'export backend (_scorpora_iva_presunta in analisi_ricavi.py).
export const ALIQUOTA_IVA_PRESUNTA = 0.10
const K_IVA = 1 + ALIQUOTA_IVA_PRESUNTA
const CHIAVI_IMPORTO = ['valore', 'totale', 'totale_trattamenti', 'totale_reparti']

function scorporaRiga(r) {
  const out = { ...r }
  for (const c of CHIAVI_IMPORTO) if (out[c] != null) out[c] = out[c] / K_IVA
  if (out.per_hotel) {
    out.per_hotel = Object.fromEntries(Object.entries(out.per_hotel).map(([h, v]) => [h, v / K_IVA]))
  }
  return out
}

function vistaIva(dati, lordo) {
  if (!dati || lordo) return dati
  const out = scorporaRiga(dati)
  if (out.trattamenti) out.trattamenti = out.trattamenti.map(scorporaRiga)
  if (out.reparti) out.reparti = out.reparti.map(scorporaRiga)
  // Tabella ripartita sui Corrispettivi: il backend dà già il netto REALE (IVA per categoria,
  // come Riepilogo Fatturati IVA esclusa) — si usa quello, non lo scorporo presunto al 10%
  if (out.netto_corrispettivi) Object.assign(out, out.netto_corrispettivi)
  return out
}

// Valore digitato in cella → valore da salvare (in DB sempre IVA inclusa)
const aLordo = (v, lordo) => (lordo ? v : Math.round(v * K_IVA * 100) / 100)

const _oggi = new Date()
const MESE_DEFAULT = _oggi.getMonth() === 0 ? 12 : _oggi.getMonth()
const ANNO_DEFAULT = _oggi.getMonth() === 0 ? _oggi.getFullYear() - 1 : _oggi.getFullYear()

function pctFmt(v) {
  if (v == null) return '—'
  return v.toFixed(1) + '%'
}

// ── Colori categorie trattamento (ripiego se non configurati in Admin) ────────
// Stesse tinte di sempre (RO giallo, BB blu, HB verde, FB arancio, AI rosso), prese dalla
// palette validata dell'app.
const CATEGORIA_COLORI = {
  RO: PALETTE_CATEGORICA[2], BB: PALETTE_CATEGORICA[0], HB: PALETTE_CATEGORICA[1],
  FB: PALETTE_CATEGORICA[7], AI: PALETTE_CATEGORICA[5],
}

// ── Colori voci (usata da tabella e torta) ────────────────────────────────────
function assegnaColori(voci) {
  let idx = 0
  return voci.filter(v => v.valore > 0).map(v => {
    const chiave = v.codice || v.categoria || v.reparto || ''
    // Priorità: colore salvato in DB → colore per categoria → palette generica
    const colore = v.colore || CATEGORIA_COLORI[v.categoria] || coloreSerie(idx++)
    return { ...v, _colore: colore, _chiave: chiave }
  })
}

// ── Grafico a torta ───────────────────────────────────────────────────────────
function TortaRicavi({ voci, totale }) {
  if (!voci || !voci.length || !totale) return null

  const dati = assegnaColori(voci).map(v => ({
    name: v.nome_display || v.categoria || v.reparto || v.codice || '—',
    value: v.valore,
    colore: v._colore,
  }))

  if (!dati.length) return null

  return (
    <Card style={{ marginTop: 16 }}>
      <ResponsiveContainer width="100%" height={420}>
        <PieChart>
          <Pie data={dati} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={160} innerRadius={72}>
            {dati.map((d, i) => <Cell key={i} fill={d.colore} />)}
          </Pie>
          <ReTooltip formatter={(val, name) => [formatEuro(val), name]} contentStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </Card>
  )
}

function categoriaBadge(cat) {
  if (!cat) return <span style={{ color: colors.textSubtle }}>—</span>
  return <Badge colore={CATEGORIA_COLORI[cat] || colors.textMuted}>{cat}</Badge>
}

// ── Componente cella valore editabile ─────────────────────────────────────────
function CellaValore({ valore, modificato, onSalva, disabled }) {
  const [editing, setEditing] = useState(false)
  const [tmp, setTmp] = useState('')
  const ref = useRef()

  const avvia = () => {
    if (disabled) return
    setTmp(String(valore).replace('.', ','))
    setEditing(true)
    setTimeout(() => ref.current?.select(), 10)
  }
  const conferma = () => {
    const num = parseFloat(tmp.replace(',', '.'))
    if (!isNaN(num) && num !== valore) onSalva(num)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        className="ui-input ui-num"
        value={tmp}
        onChange={e => setTmp(e.target.value)}
        onBlur={conferma}
        onKeyDown={e => { if (e.key === 'Enter') conferma(); if (e.key === 'Escape') setEditing(false) }}
        style={{ width: 100, textAlign: 'right', padding: '1px 6px' }}
      />
    )
  }
  return (
    <span
      onClick={avvia}
      title={disabled ? '' : 'Clicca per modificare'}
      style={{ cursor: disabled ? 'default' : 'pointer', color: modificato ? colors.warning : undefined,
               borderBottom: disabled ? 'none' : `1px dashed ${colors.borderStrong}` }}>
      {formatEuro(valore)}
      {modificato && <span title="Modificato manualmente" style={{ marginLeft: 4 }}>✏️</span>}
    </span>
  )
}

// ── Tabella Trattamenti ───────────────────────────────────────────────────────
function TabellaTrattamenti({ hotelCode, anno, mese, meseFine, isAdmin, mostraDelta, vistaDettaglio, lordo }) {
  const [datiRaw, setDati] = useState(null)
  const dati = vistaIva(datiRaw, lordo)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  const avvisi = useAvvisi()

  const carica = useCallback(async () => {
    if (!hotelCode || !anno || !mese) return
    setLoading(true)
    setErrore(null)
    try {
      const params = { hotel_code: hotelCode, anno, mese }
      if (meseFine && meseFine !== mese) params.mese_fine = meseFine
      const r = await api.get('/analisi-ricavi/trattamenti', { params })
      setDati(r.data)
    } catch (e) {
      setErrore(mostraErrore(e))
    } finally {
      setLoading(false)
    }
  }, [hotelCode, anno, mese, meseFine])

  useEffect(() => { carica() }, [carica])

  const aggiornaValore = async (id, nuovoValore) => {
    try {
      await api.put(`/analisi-ricavi/trattamenti/${id}`, { valore: aLordo(nuovoValore, lordo) })
      carica()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    }
  }

  if (loading) return <Loading />
  if (errore) return <Messaggio tipo="err">{errore}</Messaggio>
  if (!dati || !dati.trattamenti.length) return <StatoVuoto>Nessun dato per questo periodo.</StatoVuoto>

  // Vista macro-categorie: aggrega per categoria
  let righe = dati.trattamenti
  if (!vistaDettaglio) {
    const bycat = {}
    for (const t of righe) {
      const k = t.categoria || 'Non classificato'
      if (!bycat[k]) bycat[k] = { categoria: k, valore: 0, pct: 0, items: [] }
      bycat[k].valore += t.valore
      bycat[k].items.push(t)
    }
    const tot = Object.values(bycat).reduce((s, v) => s + v.valore, 0)
    righe = Object.values(bycat).map(v => ({
      ...v, pct: tot > 0 ? (v.valore / tot * 100) : 0,
    })).sort((a, b) => b.valore - a.valore)
  }

  const righeCon = assegnaColori(righe)

  return (
    <div>
      <Table compact>
        <thead>
          <tr>
            {vistaDettaglio && <Th>Codice</Th>}
            <Th>{vistaDettaglio ? 'Nome' : 'Categoria'}</Th>
            {vistaDettaglio && <Th center>Cat.</Th>}
            <Th num>Valore</Th>
            <Th num>%</Th>
            {mostraDelta && dati.revenue_module && <Th num>Δ Revenue</Th>}
          </tr>
        </thead>
        <tbody>
          {righeCon.map(t => (
            <tr key={vistaDettaglio ? t.codice : t.categoria}>
              {vistaDettaglio && (
                <Td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Dot colore={t._colore} />
                    <code style={{ fontSize: 'var(--fs-sm)' }}>{t.codice}</code>
                  </span>
                </Td>
              )}
              <Td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {!vistaDettaglio && <Dot colore={t._colore} />}
                  {vistaDettaglio ? (t.nome_display || t.codice) : t.categoria}
                </span>
              </Td>
              {vistaDettaglio && <Td center>{categoriaBadge(t.categoria)}</Td>}
              <Td num>
                {vistaDettaglio ? (
                  <CellaValore
                    valore={t.valore}
                    modificato={t.modificato_manualmente}
                    onSalva={v => aggiornaValore(t.id, v)}
                    disabled={!isAdmin}
                  />
                ) : formatEuro(t.valore)}
              </Td>
              <Td num style={{ color: colors.textMuted }}>{pctFmt(t.pct)}</Td>
              {mostraDelta && dati.revenue_module && <Td num>—</Td>}
            </tr>
          ))}
          <tr className="ui-riga-sezione">
            {vistaDettaglio && <Td />}
            <Td>Totale</Td>
            {vistaDettaglio && <Td />}
            <Td num>{formatEuro(dati.totale)}</Td>
            <Td num>100%</Td>
            {mostraDelta && dati.revenue_module && <Td />}
          </tr>
        </tbody>
      </Table>
      {dati.n_non_classificati > 0 && (
        <p style={{ color: colors.warningText, fontSize: 'var(--fs-sm)', marginTop: 6 }}>
          ⚠ {dati.n_non_classificati} codic{dati.n_non_classificati > 1 ? 'i' : 'e'} non classificat{dati.n_non_classificati > 1 ? 'i' : 'o'} — configurare in Admin → Classificazione Trattamenti
        </p>
      )}
      <TortaRicavi voci={righe} totale={dati.totale} />
    </div>
  )
}

// ── Tabella Reparti ───────────────────────────────────────────────────────────
function TabellaReparti({ hotelCode, anno, mese, meseFine, isAdmin, mostraDelta, lordo }) {
  const [datiRaw, setDati] = useState(null)
  const dati = vistaIva(datiRaw, lordo)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  const avvisi = useAvvisi()

  const carica = useCallback(async () => {
    if (!hotelCode || !anno || !mese) return
    setLoading(true)
    setErrore(null)
    try {
      const params = { hotel_code: hotelCode, anno, mese }
      if (meseFine && meseFine !== mese) params.mese_fine = meseFine
      const r = await api.get('/analisi-ricavi/reparti', { params })
      setDati(r.data)
    } catch (e) {
      setErrore(mostraErrore(e))
    } finally {
      setLoading(false)
    }
  }, [hotelCode, anno, mese, meseFine])

  useEffect(() => { carica() }, [carica])

  const aggiorna = async (id, nuovoValore) => {
    try {
      await api.put(`/analisi-ricavi/reparti/${id}`, { valore: aLordo(nuovoValore, lordo) })
      carica()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    }
  }

  if (loading) return <Loading />
  if (errore) return <Messaggio tipo="err">{errore}</Messaggio>
  if (!dati || !dati.reparti.length) return <StatoVuoto>Nessun dato per questo periodo.</StatoVuoto>

  const rev = dati.revenue_module
  const deltaRev = mostraDelta && rev ? rev.revenue_totale : null
  const repartiCon = assegnaColori(dati.reparti.map(r => ({ ...r, nome_display: r.reparto })))

  return (
    <div>
      <Table compact>
        <thead>
          <tr>
            <Th>Reparto</Th>
            <Th num>Valore</Th>
            <Th num>%</Th>
            {mostraDelta && rev && <Th num>Rev. Module</Th>}
            {mostraDelta && rev && <Th num>Δ</Th>}
          </tr>
        </thead>
        <tbody>
          {repartiCon.map(r => (
            <tr key={r.reparto}>
              <Td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Dot colore={r._colore} />{r.reparto}
                </span>
              </Td>
              <Td num>
                <CellaValore
                  valore={r.valore}
                  modificato={r.modificato_manualmente}
                  onSalva={v => aggiorna(r.id, v)}
                  disabled={!isAdmin}
                />
              </Td>
              <Td num style={{ color: colors.textMuted }}>{pctFmt(r.pct)}</Td>
              {mostraDelta && rev && <Td num>—</Td>}
              {mostraDelta && rev && <Td num>—</Td>}
            </tr>
          ))}
          <tr className="ui-riga-sezione">
            <Td>Totale</Td>
            <Td num>{formatEuro(dati.totale)}</Td>
            <Td num>100%</Td>
            {mostraDelta && rev && <Td num>{formatEuro(rev.revenue_totale)}</Td>}
            {mostraDelta && rev && (
              <Td num style={{ color: dati.totale > rev.revenue_totale ? colors.success : colors.danger }}>
                {formatEuro(dati.totale - rev.revenue_totale)}
              </Td>
            )}
          </tr>
        </tbody>
      </Table>
      {mostraDelta && rev && (
        <p className="ui-text-muted" style={{ marginTop: 6 }}>
          Confronto con Revenue module: camere {formatEuro(rev.revenue_rooms)} · F&B {formatEuro(rev.revenue_fnb)} · Extra {formatEuro(rev.revenue_extra)}
        </p>
      )}
      <TortaRicavi voci={dati.reparti.map(r => ({ ...r, nome_display: r.reparto }))} totale={dati.totale} />
    </div>
  )
}

// ── Sub-tab Import ─────────────────────────────────────────────────────────────
function SubtabImport({ hotels, isAdmin }) {
  const [hotelCode, setHotelCode] = useState(hotels[0]?.code || '')
  const [anno, setAnno] = useState(ANNO_DEFAULT)
  const [mese, setMese] = useState(MESE_DEFAULT)
  const [files, setFiles] = useState([])
  const [isTest, setIsTest] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(null)
  const [storico, setStorico] = useState([])
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const caricaStorico = useCallback(async () => {
    try {
      const r = await api.get('/analisi-ricavi/import/storico')
      setStorico(r.data)
    } catch (e) { /* ignora */ }
  }, [])

  useEffect(() => { caricaStorico() }, [caricaStorico])

  const aggiungiFile = f => setFiles(prev => [...prev, f].slice(0, 2))

  const rimuoviFile = i => setFiles(prev => prev.filter((_, j) => j !== i))

  const importa = async (sovrascrivi = false) => {
    if (!files.length) return avvisi.attenzione('Selezionare almeno 1 file CSV')
    if (!hotelCode) return avvisi.attenzione('Selezionare un hotel')
    setLoading(true)
    setMsg(null)
    const fd = new FormData()
    fd.append('hotel_code', hotelCode)
    fd.append('anno', anno)
    fd.append('mese', mese)
    fd.append('is_test', isTest)
    files.forEach(f => fd.append('files', f))
    try {
      const endpoint = sovrascrivi ? '/analisi-ricavi/import/sovrascrivi' : '/analisi-ricavi/import'
      const r = await api.post(endpoint, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const d = r.data
      setMsg({ tipo: 'ok', testo: `Import completato: ${d.n_trattamenti} trattamenti, ${d.n_reparti} reparti.` })
      setFiles([])
      caricaStorico()
    } catch (e) {
      if (e.response?.status === 409) {
        // Dati già presenti per il periodo: chiede conferma e ritenta in modalità sovrascrittura
        const info = e.response.data.detail || e.response.data
        const dettaglio = info?.n_trattamenti != null ? ` (${info.n_trattamenti} trattamenti, ${info.n_reparti} reparti)` : ''
        setLoading(false)
        const ok = await conferma({
          titolo: 'Sovrascrivere i dati esistenti?',
          messaggio: `${info?.messaggio || 'Esistono già dati per questo periodo.'}${dettaglio}`,
          confermaLabel: 'Sovrascrivi',
          pericolo: true,
        })
        if (ok) await importa(true)
      } else {
        setMsg({ tipo: 'err', testo: mostraErrore(e) })
      }
    } finally {
      setLoading(false)
    }
  }

  const elimina = async (id) => {
    if (!(await conferma({ titolo: 'Eliminare questo import?', messaggio: 'Verranno eliminati anche tutti i dati collegati.', pericolo: true }))) return
    try {
      await api.delete(`/analisi-ricavi/import/${id}?conferma=true`)
      setStorico(prev => prev.filter(s => s.id !== id))
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    }
  }

  if (!isAdmin) return <StatoVuoto>Solo gli amministratori possono importare dati.</StatoVuoto>

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {/* Form import */}
      <Card title="Carica CSV ricavi" style={{ flex: '0 0 380px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Select value={hotelCode} onChange={e => setHotelCode(e.target.value)} style={{ flex: 1 }} aria-label="Hotel">
            {hotels.map(h => <option key={h.code} value={h.code}>{h.code}</option>)}
          </Select>
          <Select value={mese} onChange={e => setMese(+e.target.value)} style={{ flex: 1.5 }} aria-label="Mese">
            {MESI.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </Select>
          <Input type="number" value={anno} onChange={e => setAnno(+e.target.value)}
                 min={2024} max={2030} style={{ width: 76, textAlign: 'center' }} aria-label="Anno" />
        </div>

        {/* Istruzioni origine file */}
        <Messaggio tipo="info">
          <strong>Da dove scaricare i file:</strong><br />
          Passbi → Dashboard → Ricavi Tipo Trattamento<br />
          • <em>Dettaglio ricavi trattamento</em><br />
          • <em>Dettaglio ricavi per trattamento</em><br />
          ⏱ Da scaricare ogni fine mese per ogni hotel.<br />
          📄 Formato CSV con separatore <code>;</code>
        </Messaggio>

        <DropZone
          accept=".csv"
          multiple
          onFile={aggiungiFile}
          titolo="Trascina qui i 2 file CSV oppure clicca per selezionarli"
          sottotitolo="Auto-rileva trattamenti e reparti"
        />

        {/* File selezionati */}
        {files.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {files.map((f, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                                    padding: '4px 0', borderBottom: `1px solid ${colors.border}` }}>
                <span>📄 {f.name}</span>
                <Button variant="danger-soft" size="sm" onClick={() => rimuoviFile(i)} aria-label="Rimuovi file">✕</Button>
              </div>
            ))}
          </div>
        )}

        <Checkbox checked={isTest} onChange={setIsTest} label="Dati di test" style={{ marginBottom: 12 }} />

        <Button onClick={() => importa(false)} disabled={loading || !files.length} style={{ width: '100%' }}>
          {loading ? 'Import in corso…' : 'Importa'}
        </Button>

        {msg && <div style={{ marginTop: 12 }}><Messaggio tipo={msg.tipo} onChiudi={() => setMsg(null)}>{msg.testo}</Messaggio></div>}
      </Card>

      {/* Storico import */}
      <div style={{ flex: 1, minWidth: 320 }}>
        <SectionTitle as="h3">Storico import</SectionTitle>
        {storico.length === 0 ? (
          <StatoVuoto>Nessun import effettuato.</StatoVuoto>
        ) : (
          <Table compact>
            <thead>
              <tr>
                <Th>Hotel</Th><Th>Periodo</Th><Th num>Tratt.</Th><Th num>Rep.</Th><Th>Data</Th><Th />
              </tr>
            </thead>
            <tbody>
              {storico.map(s => (
                <tr key={s.id}>
                  <Td>
                    <HotelTag code={s.hotel_code} />
                    {s.is_test && <Badge tono="warn" style={{ marginLeft: 4 }}>TEST</Badge>}
                  </Td>
                  <Td>{s.mese_nome} {s.anno}</Td>
                  <Td num>{s.n_trattamenti}</Td>
                  <Td num>{s.n_reparti}</Td>
                  <Td muted>{s.created_at ? new Date(s.created_at).toLocaleDateString('it-IT') : '—'}</Td>
                  <Td center>
                    <Button variant="danger-soft" size="sm" onClick={() => elimina(s.id)} title="Elimina">🗑</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  )
}

// ── Vista Gruppo ───────────────────────────────────────────────────────────────
function VistGruppo({ anno, mese, meseFine, vistaDettaglio, lordo }) {
  const [datiRaw, setDati] = useState(null)
  const dati = vistaIva(datiRaw, lordo)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    if (!anno || !mese) return
    setLoading(true)
    const params = { anno, mese }
    if (meseFine && meseFine !== mese) params.mese_fine = meseFine
    api.get('/analisi-ricavi/gruppo', { params })
      .then(r => setDati(r.data))
      .catch(e => setErrore(mostraErrore(e)))
      .finally(() => setLoading(false))
  }, [anno, mese, meseFine])

  if (loading) return <Loading testo="Caricamento gruppo…" />
  if (errore) return <Messaggio tipo="err">{errore}</Messaggio>
  if (!dati) return null

  // Colonne: hotel (dati Passbi) + ristoranti MMS/BON (solo incasso manuale Corrispettivi,
  // valorizzato nella riga reparto dedicata; nei trattamenti sempre '—')
  const ristoranti = dati.ristoranti_codes || []
  const hotels = [...dati.hotel_codes, ...ristoranti]

  // Tabella trattamenti gruppo con colonne per hotel
  const trattAmostare = vistaDettaglio
    ? dati.trattamenti
    : (() => {
        const bycat = {}
        for (const t of dati.trattamenti) {
          const k = t.categoria || 'Non classificato'
          if (!bycat[k]) bycat[k] = { categoria: k, valore: 0, per_hotel: {} }
          bycat[k].valore += t.valore
          for (const h of hotels) {
            bycat[k].per_hotel[h] = (bycat[k].per_hotel[h] || 0) + (t.per_hotel?.[h] || 0)
          }
        }
        const tot = Object.values(bycat).reduce((s, v) => s + v.valore, 0)
        return Object.values(bycat).map(v => ({
          ...v, pct: tot > 0 ? (v.valore / tot * 100) : 0,
        })).sort((a, b) => b.valore - a.valore)
      })()

  return (
    <div>
      <SectionTitle as="h3">Trattamenti — Gruppo (fonte PassBI)</SectionTitle>
      {trattAmostare.length === 0 ? (
        <StatoVuoto>Nessun dato per questo periodo.</StatoVuoto>
      ) : (
        <Table compact>
          <thead>
            <tr>
              <Th>{vistaDettaglio ? 'Codice' : 'Categoria'}</Th>
              {vistaDettaglio && <Th center>Cat.</Th>}
              {hotels.map(h => <Th key={h} num>{h}</Th>)}
              <Th num tot>Totale</Th>
              <Th num>%</Th>
            </tr>
          </thead>
          <tbody>
            {trattAmostare.map(t => {
              const label = vistaDettaglio ? (t.nome_display || t.codice) : t.categoria
              return (
                <tr key={label}>
                  <Td>{label}</Td>
                  {vistaDettaglio && <Td center>{categoriaBadge(t.categoria)}</Td>}
                  {hotels.map(h => (
                    <Td key={h} num style={{ color: colors.textMuted }}>{t.per_hotel?.[h] ? formatEuro(t.per_hotel[h]) : '—'}</Td>
                  ))}
                  <Td num tot>{formatEuro(t.valore)}</Td>
                  <Td num style={{ color: colors.textMuted }}>{pctFmt(t.pct)}</Td>
                </tr>
              )
            })}
            <tr className="ui-riga-sezione">
              <Td>Totale</Td>
              {vistaDettaglio && <Td />}
              {hotels.map(h => (
                <Td key={h} num>
                  {ristoranti.includes(h) ? '—' : formatEuro(dati.trattamenti.filter(t => t.per_hotel?.[h]).reduce((s, t) => s + (t.per_hotel[h] || 0), 0))}
                </Td>
              ))}
              <Td num tot>{formatEuro(dati.totale_trattamenti)}</Td>
              <Td num>100%</Td>
            </tr>
          </tbody>
        </Table>
      )}

      <SectionTitle as="h3" style={{ marginTop: 24 }}>Reparti — Gruppo (fonte PassBI)</SectionTitle>
      {dati.reparti.length === 0 ? (
        <StatoVuoto>Nessun dato.</StatoVuoto>
      ) : (
        <Table compact>
          <thead>
            <tr>
              <Th>Reparto</Th>
              {hotels.map(h => <Th key={h} num>{h}</Th>)}
              <Th num tot>Totale</Th>
              <Th num>%</Th>
            </tr>
          </thead>
          <tbody>
            {dati.reparti.map(r => (
              <tr key={r.reparto}>
                <Td>{r.reparto}</Td>
                {hotels.map(h => (
                  <Td key={h} num style={{ color: colors.textMuted }}>{r.per_hotel?.[h] ? formatEuro(r.per_hotel[h]) : '—'}</Td>
                ))}
                <Td num tot>{formatEuro(r.valore)}</Td>
                <Td num style={{ color: colors.textMuted }}>{pctFmt(r.pct)}</Td>
              </tr>
            ))}
            <tr className="ui-riga-sezione">
              <Td>Totale</Td>
              {hotels.map(h => (
                <Td key={h} num>{formatEuro(dati.reparti.reduce((s, r) => s + (r.per_hotel?.[h] || 0), 0))}</Td>
              ))}
              <Td num tot>{formatEuro(dati.totale_reparti)}</Td>
              <Td num>100%</Td>
            </tr>
          </tbody>
        </Table>
      )}

      <SectionTitle as="h3" style={{ marginTop: 24 }}>Reparti — Gruppo ripartiti sui Corrispettivi</SectionTitle>
      <p className="ui-text-muted" style={{ marginTop: 0, marginBottom: 8 }}>
        Il totale di ogni hotel è quello dei Corrispettivi del periodo (come in Riepilogo Fatturati:
        senza tassa di soggiorno), ripartito tra i reparti secondo le % Passbi di quell'hotel.
        MMS e BON invariati. Con IVA esclusa usa l'IVA reale dei documenti, non la stima al 10%.
      </p>
      {!dati.reparti_corrispettivi?.length ? (
        <StatoVuoto>Nessun dato.</StatoVuoto>
      ) : (
        <Table compact>
          <thead>
            <tr>
              <Th>Reparto</Th>
              {hotels.map(h => <Th key={h} num>{h}</Th>)}
              <Th num tot>Totale</Th>
              <Th num>%</Th>
            </tr>
          </thead>
          <tbody>
            {dati.reparti_corrispettivi.map(r => (
              <tr key={r.reparto}>
                <Td>{r.reparto}</Td>
                {hotels.map(h => (
                  <Td key={h} num style={{ color: colors.textMuted }}>{r.per_hotel?.[h] ? formatEuro(r.per_hotel[h]) : '—'}</Td>
                ))}
                <Td num tot>{formatEuro(r.valore)}</Td>
                <Td num style={{ color: colors.textMuted }}>{pctFmt(r.pct)}</Td>
              </tr>
            ))}
            <tr className="ui-riga-sezione">
              <Td>Totale Corrispettivi</Td>
              {hotels.map(h => (
                <Td key={h} num>{formatEuro(dati.corrispettivi_per_struttura?.[h] || 0)}</Td>
              ))}
              <Td num tot>{formatEuro(dati.totale_reparti_corrispettivi)}</Td>
              <Td num>100%</Td>
            </tr>
          </tbody>
        </Table>
      )}
    </div>
  )
}

// ── Navigazione mese con frecce ───────────────────────────────────────────────
function mesePrecedente(mese, anno) {
  if (mese === 1) return { mese: 12, anno: anno - 1 }
  return { mese: mese - 1, anno }
}
function meseSuccessivo(mese, anno) {
  if (mese === 12) return { mese: 1, anno: anno + 1 }
  return { mese: mese + 1, anno }
}

// ── Componente principale ──────────────────────────────────────────────────────
export default function TabAnalisiRicavi({ hotels, isAdmin, lordo = true }) {
  const [showImport, setShowImport] = useState(false)
  const [hotelSel, setHotelSel] = useState(
    () => localStorage.getItem('ar_hotel') || 'GRUPPO'
  )
  const [anno, setAnno] = useState(ANNO_DEFAULT)
  const [mese, setMese] = useState(MESE_DEFAULT)
  const [meseFine, setMeseFine] = useState(MESE_DEFAULT)
  const [rangeMode, setRangeMode] = useState(false)
  const [vistaDettaglio, setVistaDettaglio] = useState(true)
  const [mostraDelta, setMostraDelta] = useState(false)
  const avvisi = useAvvisi()

  const cambiaHotel = c => { setHotelSel(c); localStorage.setItem('ar_hotel', c) }
  const isGruppo = hotelSel === 'GRUPPO'

  // Navigazione ← indietro di un mese
  const navIndietro = () => {
    if (rangeMode) {
      // Scaliamo entrambi di 1 mese; l'anno cambia solo se mese = 1
      const newMese = mese === 1 ? 12 : mese - 1
      const newFine = meseFine === 1 ? 12 : meseFine - 1
      if (mese === 1) setAnno(a => a - 1)
      setMese(newMese)
      setMeseFine(newFine)
    } else {
      const prev = mesePrecedente(mese, anno)
      setMese(prev.mese)
      setAnno(prev.anno)
    }
  }

  // Navigazione → avanti di un mese
  const navAvanti = () => {
    if (rangeMode) {
      const newMese = mese === 12 ? 1 : mese + 1
      const newFine = meseFine === 12 ? 1 : meseFine + 1
      if (meseFine === 12) setAnno(a => a + 1)
      setMese(newMese)
      setMeseFine(newFine)
    } else {
      const next = meseSuccessivo(mese, anno)
      setMese(next.mese)
      setAnno(next.anno)
    }
  }

  // Quando si attiva il range mode, meseFine parte dal mese corrente
  const toggleRange = val => {
    setRangeMode(val)
    if (val) setMeseFine(mese)
  }

  // Se meseFine finisce prima di mese, aggiusta
  const meseFineEff = rangeMode ? Math.max(mese, meseFine) : mese

  const opzioniHotel = [
    ...hotels.map(h => ({ value: h.code, label: h.code })),
    { value: 'GRUPPO', label: 'Gruppo' },
  ]
  const sep = <div style={{ width: 1, height: 28, background: colors.border }} />

  const esportaExcel = async () => {
    try {
      const params = { hotel_code: hotelSel, anno, mese, vista_dettaglio: vistaDettaglio, lordo }
      if (rangeMode && meseFineEff !== mese) params.mese_fine = meseFineEff
      const res = await api.get('/analisi-ricavi/export', { params, responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `analisi_ricavi_${hotelSel}_${anno}_${String(mese).padStart(2, '0')}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore export'))
    }
  }

  const sottoTab = [{ id: 'analisi', label: 'Analisi' }, ...(isAdmin ? [{ id: 'import', label: 'Import' }] : [])]

  return (
    <div>
      <Tabs size="sm" tabs={sottoTab} value={showImport ? 'import' : 'analisi'} onChange={id => setShowImport(id === 'import')} />

      {showImport ? (
        <SubtabImport hotels={hotels} isAdmin={isAdmin} />
      ) : (
        <>
          {/* Barra controlli */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <SegmentedControl value={hotelSel} onChange={cambiaHotel} options={opzioniHotel} />
            {sep}

            {/* Navigazione mese/anno (con eventuale range) */}
            <Button variant="secondary" size="sm" onClick={navIndietro} aria-label="Indietro di un mese">◀</Button>
            <Select value={mese} onChange={e => setMese(+e.target.value)} aria-label="Mese">
              {MESI.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </Select>
            {rangeMode && (
              <>
                <span style={{ color: colors.textSubtle }}>—</span>
                <Select value={meseFineEff} onChange={e => setMeseFine(+e.target.value)} aria-label="Mese fine">
                  {MESI.slice(1).map((m, i) => (
                    <option key={i+1} value={i+1} disabled={i+1 < mese}>{m}</option>
                  ))}
                </Select>
              </>
            )}
            <Input type="number" value={anno} onChange={e => setAnno(+e.target.value)}
                   min={2024} max={2030} style={{ width: 80, textAlign: 'center' }} aria-label="Anno" />
            <Button variant="secondary" size="sm" onClick={navAvanti} aria-label="Avanti di un mese">▶</Button>
            {sep}

            <Checkbox checked={rangeMode} onChange={toggleRange} label="Range" />
            <SegmentedControl value={vistaDettaglio} onChange={setVistaDettaglio}
              options={[{ value: true, label: 'Dettaglio' }, { value: false, label: 'Macrocategorie' }]} />
            {!isGruppo && <Checkbox checked={mostraDelta} onChange={setMostraDelta} label="Δ Revenue" />}

            <Button variant="secondary" size="sm" onClick={esportaExcel} style={{ marginLeft: 'auto' }}>⬇ Esporta Excel</Button>
          </div>

          {/* Contenuto */}
          {isGruppo ? (
            <VistGruppo anno={anno} mese={mese} meseFine={meseFineEff} vistaDettaglio={vistaDettaglio} lordo={lordo} />
          ) : (
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 320 }}>
                <SectionTitle as="h3">Trattamenti — {hotelSel}</SectionTitle>
                <TabellaTrattamenti
                  hotelCode={hotelSel} anno={anno} mese={mese} meseFine={meseFineEff}
                  isAdmin={isAdmin} mostraDelta={mostraDelta} vistaDettaglio={vistaDettaglio} lordo={lordo}
                />
              </div>
              <div style={{ flex: 1, minWidth: 280 }}>
                <SectionTitle as="h3">Reparti — {hotelSel}</SectionTitle>
                <TabellaReparti
                  hotelCode={hotelSel} anno={anno} mese={mese} meseFine={meseFineEff}
                  isAdmin={isAdmin} mostraDelta={mostraDelta} lordo={lordo}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
