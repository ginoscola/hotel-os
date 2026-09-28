import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminUtenti from './AdminUtenti.jsx'
import AdminCentriDiCosto from './AdminCentriDiCosto.jsx'
import AdminBackup from './admin/AdminBackup.jsx'
import AdminCruscottoSoglie from './admin/AdminCruscottoSoglie.jsx'
import AdminUiKit from './admin/AdminUiKit.jsx'
import api from '../api/client.js'
import {
  Badge, Button, Card, Checkbox, Field, Input, KpiTile, Loading, Messaggio, PageHeader, SegmentedControl, Select,
  StatoVuoto, Table, Td, Th, useAvvisi, useConferma,
} from '../components/ui'
import { colors } from '../styles/tokens.js'
import { mostraErrore } from '../utils/format.js'
import { APP_VERSION, APP_VERSION_DATE } from '../version.js'

const SEZIONI = [
  {
    gruppo: 'Comune',
    voci: [
      { id: 'utenti',   label: 'Utenti' },
      { id: 'stagioni', label: 'Stagioni operative' },
      { id: 'moduli',   label: 'Gestione moduli' },
    ],
  },
  {
    gruppo: 'Home / Cruscotto',
    voci: [
      { id: 'home-soglie', label: 'Soglie tachimetri' },
    ],
  },
  {
    gruppo: 'Revenue',
    voci: [
      { id: 'revenue-import', label: 'Import massivo' },
      { id: 'revenue-test',   label: 'Dati di test' },
    ],
  },
  {
    gruppo: 'Dipendenti',
    voci: [
      { id: 'dip-cc',     label: 'Centri di costo' },
      { id: 'dip-colori', label: 'Colori CC' },
      { id: 'dip-test',   label: 'Dati di test' },
    ],
  },
  {
    gruppo: 'Corrispettivi',
    voci: [
      { id: 'corr-tipi-doc',        label: 'Tipi documento' },
      { id: 'corr-pagamenti',       label: 'Tipi pagamento' },
      { id: 'corr-classificazione', label: 'Classif. trattamenti' },
      { id: 'corr-rt-stampanti',    label: 'Stampanti RT' },
    ],
  },
  {
    gruppo: 'USALI',
    voci: [
      { id: 'usali-kpi', label: 'Range KPI' },
      { id: 'usali-cc',  label: 'Mappatura costi lavoro' },
      { id: 'usali-movimenti', label: 'Righe Movimenti Attivi' },
    ],
  },
  {
    gruppo: 'Statistiche Produzione',
    voci: [
      { id: 'prod-categorie', label: 'Categorie' },
      { id: 'prod-mapping',   label: 'Mapping dettagli' },
    ],
  },
  {
    gruppo: 'Sistema',
    voci: [
      { id: 'sistema-debug', label: 'Debug & diagnostica' },
      { id: 'backup',        label: 'Backup' },
      { id: 'ui-kit',        label: 'Libreria UI' },
    ],
  },
]

const LS_COLLASSATE = 'admin_sidebar_collassate'

function gruppoDi(sezione) {
  return SEZIONI.find(s => s.voci.some(v => v.id === sezione))?.gruppo
}

export default function AdminUnificato() {
  const [params, setParams] = useSearchParams()
  const sezione = params.get('s') || 'utenti'

  const [collassate, setCollassate] = useState(() => {
    const salvato = localStorage.getItem(LS_COLLASSATE)
    if (salvato !== null) {
      try { return new Set(JSON.parse(salvato)) } catch { /* ignora e usa il default sotto */ }
    }
    // Default: tutti i gruppi chiusi tranne quello della sezione corrente (così la voce
    // attiva resta visibile anche al primo accesso, prima che l'utente tocchi qualcosa).
    return new Set(SEZIONI.map(s => s.gruppo).filter(g => g !== gruppoDi(sezione)))
  })

  const salvaCollassate = (set) => {
    setCollassate(set)
    localStorage.setItem(LS_COLLASSATE, JSON.stringify([...set]))
  }

  // Se si arriva a una sezione il cui gruppo è chiuso (es. link diretto da un'altra pagina),
  // lo riapre — senza toccare lo stato aperto/chiuso degli altri gruppi.
  useEffect(() => {
    const gruppo = gruppoDi(sezione)
    if (gruppo && collassate.has(gruppo)) {
      const next = new Set(collassate)
      next.delete(gruppo)
      salvaCollassate(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sezione])

  const toggleGruppo = (gruppo) => {
    const next = new Set(collassate)
    if (next.has(gruppo)) next.delete(gruppo)
    else next.add(gruppo)
    salvaCollassate(next)
  }

  const espandiTutto = () => salvaCollassate(new Set())
  const comprimiTutto = () => salvaCollassate(new Set(SEZIONI.map(s => s.gruppo)))

  function vai(id) {
    setParams({ s: id })
  }

  return (
    <div style={{ display: 'flex', gap: 0, minHeight: 'calc(100vh - 120px)' }}>

      {/* ── Sidebar ── */}
      <aside className="ui-admin-sidebar">
        <div style={{ display: 'flex', gap: 6, padding: '0 14px 10px' }}>
          <Button variant="secondary" size="sm" onClick={espandiTutto} style={{ flex: 1 }}>Espandi</Button>
          <Button variant="secondary" size="sm" onClick={comprimiTutto} style={{ flex: 1 }}>Comprimi</Button>
        </div>

        {SEZIONI.map(({ gruppo, voci }) => {
          const aperto = !collassate.has(gruppo)
          return (
            <div key={gruppo} style={{ marginBottom: 4 }}>
              <button type="button" className="ui-admin-gruppo" onClick={() => toggleGruppo(gruppo)} aria-expanded={aperto}>
                <span>{gruppo}</span>
                <span style={{ fontSize: 9, transform: aperto ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
              </button>
              {aperto && voci.map(({ id, label }) => (
                <button key={id} type="button" onClick={() => vai(id)}
                  className={`ui-admin-voce${sezione === id ? ' attiva' : ''}`}>
                  {label}
                </button>
              ))}
            </div>
          )
        })}

        {/* ── Versione ── */}
        <div className="ui-text-muted" style={{ marginTop: 'auto', padding: '16px 18px 12px', borderTop: `1px solid ${colors.border}`, fontSize: 'var(--fs-xs)', lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600 }}>HotelOS v{APP_VERSION}</div>
          <div>{APP_VERSION_DATE}</div>
        </div>
      </aside>

      {/* ── Contenuto ── */}
      <div style={{ flex: 1, minWidth: 0, padding: '4px 0 24px 32px' }}>
        <Contenuto sezione={sezione} />
      </div>
    </div>
  )
}

function Contenuto({ sezione }) {
  if (sezione === 'utenti')        return <AdminUtenti />
  if (sezione === 'stagioni')      return <GestioneStagioni />
  if (sezione === 'moduli')        return <GestioneModuli />
  if (sezione === 'home-soglie')   return <AdminCruscottoSoglie />
  if (sezione === 'revenue-import') return <RevenueImportMassivo />
  if (sezione === 'revenue-test')  return <RevenueDatiTest />
  if (sezione === 'dip-cc')           return <DipCentriDiCosto />
  if (sezione === 'dip-colori')       return <DipColoriCC />
  if (sezione === 'dip-test')         return <DipDatiTest />
  if (sezione === 'corr-tipi-doc')    return <CorrTipiDocumento />
  if (sezione === 'corr-pagamenti')   return <CorrTipiPagamento />
  if (sezione === 'corr-classificazione') return <CorrClassificazioneTrattamenti />
  if (sezione === 'corr-rt-stampanti')    return <CorrStampantiRT />
  if (sezione === 'usali-kpi')            return <UsaliKpiConfig />
  if (sezione === 'usali-cc')             return <UsaliCCMapping />
  if (sezione === 'usali-movimenti')       return <UsaliMovimentiRighe />
  if (sezione === 'prod-categorie')       return <ProdCategorie />
  if (sezione === 'prod-mapping')         return <ProdMappingDettagli />
  if (sezione === 'sistema-debug')        return <SistemaDebug />
  if (sezione === 'backup')               return <AdminBackup />
  if (sezione === 'ui-kit')               return <AdminUiKit />
  return <Placeholder sezione={sezione} />
}

// ---------------------------------------------------------------------------
// Stagioni operative
// ---------------------------------------------------------------------------

function GestioneStagioni() {
  const ANNO_CORRENTE = 2026
  const [anno, setAnno] = useState(ANNO_CORRENTE)
  const [hotels, setHotels] = useState([])
  const [stagioni, setStagioni] = useState({})
  const [form, setForm] = useState({})
  const [salvando, setSalvando] = useState({})
  const [esiti, setEsiti] = useState({})
  const [loadingAnno, setLoadingAnno] = useState(false)

  useEffect(() => {
    api.get('/hotels/').then(({ data }) => setHotels(data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!hotels.length) return
    setLoadingAnno(true)
    Promise.all(
      hotels.map(h =>
        api.get(`/hotels/${h.code}/seasons/${anno}`)
          .then(({ data }) => ({ code: h.code, stagione: data }))
          .catch(() => ({ code: h.code, stagione: null }))
      )
    ).then(results => {
      const newStagioni = {}
      const newForm = {}
      results.forEach(({ code, stagione }) => {
        const hotel = hotels.find(h => h.code === code)
        newStagioni[code] = stagione
        newForm[code] = stagione
          ? { open_date: stagione.open_date, close_date: stagione.close_date, total_rooms: String(stagione.total_rooms), notes: stagione.notes || '' }
          : { open_date: '', close_date: '', total_rooms: String(hotel?.default_rooms || ''), notes: '' }
      })
      setStagioni(newStagioni)
      setForm(newForm)
      setEsiti({})
      setLoadingAnno(false)
    })
  }, [anno, hotels])

  function aggiornaForm(code, campo, valore) {
    setForm(prev => ({ ...prev, [code]: { ...prev[code], [campo]: valore } }))
  }

  async function salva(code) {
    const f = form[code]
    if (!f.open_date || !f.close_date || !f.total_rooms) return
    setSalvando(prev => ({ ...prev, [code]: true }))
    setEsiti(prev => ({ ...prev, [code]: null }))
    try {
      await api.post(`/hotels/${code}/seasons`, {
        season_year: anno, open_date: f.open_date, close_date: f.close_date,
        total_rooms: Number(f.total_rooms), notes: f.notes || null,
      })
      const { data } = await api.get(`/hotels/${code}/seasons/${anno}`)
      setStagioni(prev => ({ ...prev, [code]: data }))
      setEsiti(prev => ({ ...prev, [code]: { ok: true, msg: 'Salvato' } }))
    } catch (err) {
      setEsiti(prev => ({ ...prev, [code]: { ok: false, msg: mostraErrore(err) } }))
    } finally {
      setSalvando(prev => ({ ...prev, [code]: false }))
    }
  }

  return (
    <div>
      <PageHeader title="Stagioni operative">
        <Select value={anno} onChange={e => setAnno(Number(e.target.value))} aria-label="Anno">
          {[2024, 2025, 2026, 2027].map(y => <option key={y}>{y}</option>)}
        </Select>
      </PageHeader>
      {loadingAnno && <Loading />}
      {hotels.length > 0 && (
        <Table compact>
          <thead>
            <tr><Th>Hotel</Th><Th>Apertura</Th><Th>Chiusura</Th><Th num>Camere</Th><Th>Note</Th><Th /></tr>
          </thead>
          <tbody>
            {hotels.map(h => {
              const f = form[h.code] || {}
              const esito = esiti[h.code]
              const nonConfigurata = stagioni[h.code] == null
              return (
                <tr key={h.code}>
                  <Td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {h.name}
                    {nonConfigurata && <Badge tono="warn" style={{ marginLeft: 6 }}>non configurata</Badge>}
                  </Td>
                  <Td><Input type="date" value={f.open_date || ''} onChange={e => aggiornaForm(h.code, 'open_date', e.target.value)} /></Td>
                  <Td><Input type="date" value={f.close_date || ''} onChange={e => aggiornaForm(h.code, 'close_date', e.target.value)} /></Td>
                  <Td num>
                    <Input type="number" value={f.total_rooms || ''} onChange={e => aggiornaForm(h.code, 'total_rooms', e.target.value)}
                      min="1" max="999" className="ui-num" style={{ width: 72, textAlign: 'right' }} />
                  </Td>
                  <Td>
                    <Input type="text" value={f.notes || ''} onChange={e => aggiornaForm(h.code, 'notes', e.target.value)}
                      placeholder="facoltativo" style={{ width: '100%', minWidth: 110 }} />
                  </Td>
                  <Td style={{ whiteSpace: 'nowrap' }}>
                    <Button size="sm" onClick={() => salva(h.code)} disabled={salvando[h.code] || !f.open_date || !f.close_date}>
                      {salvando[h.code] ? '…' : 'Salva'}
                    </Button>
                    {esito && (
                      <span style={{ marginLeft: 8, fontSize: 'var(--fs-xs)', fontWeight: 600, color: esito.ok ? colors.success : colors.danger }}>
                        {esito.msg}
                      </span>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Gestione moduli
// ---------------------------------------------------------------------------

function GestioneModuli() {
  const [moduli, setModuli] = useState([])
  const [permessi, setPermessi] = useState({})
  const [nomi, setNomi] = useState({})
  const [loading, setLoading] = useState(true)
  const avvisi = useAvvisi()

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const { data: moduliBase } = await api.get('/modules/')
      const dettagli = await Promise.all(
        moduliBase.map(m => api.get(`/modules/${m.code}`).then(r => r.data).catch(() => null))
      ).then(res => res.filter(Boolean))
      setModuli(dettagli)
      setNomi(Object.fromEntries(dettagli.map(m => [m.code, m.name])))
      const mappa = {}
      dettagli.forEach(m => {
        mappa[m.code] = {}
        ;(m.permessi || []).forEach(p => { mappa[m.code][p.ruolo] = { ...p } })
      })
      setPermessi(mappa)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carica() }, [carica])

  async function toggleAttivo(modulo) {
    try {
      await api.put(`/modules/admin/${modulo.code}`, { attivo: !modulo.attivo })
      avvisi.successo(`${modulo.name}: ${modulo.attivo ? 'disattivato' : 'attivato'}`)
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function salvaPermesso(code, ruolo) {
    const p = permessi[code]?.[ruolo]
    if (!p) return
    try {
      await api.put(`/modules/admin/${code}/permissions/${ruolo}`, {
        puo_vedere: p.puo_vedere, puo_modificare: p.puo_modificare, puo_importare: p.puo_importare,
      })
      avvisi.successo(`Permessi ${ruolo} salvati`)
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  function setPermesso(code, ruolo, campo, val) {
    setPermessi(prev => ({
      ...prev,
      [code]: { ...prev[code], [ruolo]: { ...prev[code]?.[ruolo], [campo]: val } },
    }))
  }

  async function rinominaModulo(code) {
    const nuovoNome = (nomi[code] || '').trim()
    if (!nuovoNome) return
    try {
      await api.put(`/modules/admin/${code}`, { name: nuovoNome })
      avvisi.successo('Nome salvato')
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function sposta(idx, dir) {
    const nuovoOrdine = [...moduli]
    const target = idx + dir
    if (target < 0 || target >= nuovoOrdine.length) return
    ;[nuovoOrdine[idx], nuovoOrdine[target]] = [nuovoOrdine[target], nuovoOrdine[idx]]
    await api.put('/modules/admin/ordine', { ordine: nuovoOrdine.map(m => m.code) })
    carica()
  }

  const ruoli = ['admin', 'viewer']
  const campi = [
    { key: 'puo_vedere', label: 'Vede' },
    { key: 'puo_modificare', label: 'Modifica' },
    { key: 'puo_importare', label: 'Importa' },
  ]

  return (
    <div>
      <PageHeader title="Gestione moduli" />
      {loading ? <Loading /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {moduli.map((m, idx) => (
            // Bordo sinistro nel colore del modulo (lo stesso della NavBar)
            <Card key={m.code} style={{ boxShadow: `inset 4px 0 0 ${m.colore || colors.textSubtle}`, background: m.attivo ? colors.surface : colors.surfaceSoft }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 22 }}>{m.icon}</span>
                <Input
                  value={nomi[m.code] ?? m.name}
                  onChange={e => setNomi(n => ({ ...n, [m.code]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && rinominaModulo(m.code)}
                  style={{ fontWeight: 700, fontSize: 'var(--fs-md)', width: 230 }}
                  aria-label="Nome modulo"
                />
                {(nomi[m.code] ?? m.name) !== m.name && (
                  <Button size="sm" onClick={() => rinominaModulo(m.code)}>Salva nome</Button>
                )}
                <Badge tono={m.attivo ? 'ok' : 'neutral'}>{m.attivo ? 'Attivo' : 'Disattivato'}</Badge>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <Button variant="secondary" size="sm" onClick={() => sposta(idx, -1)} disabled={idx === 0} aria-label="Sposta su">↑</Button>
                  <Button variant="secondary" size="sm" onClick={() => sposta(idx, 1)} disabled={idx === moduli.length - 1} aria-label="Sposta giù">↓</Button>
                  <Button variant={m.attivo ? 'danger-soft' : 'secondary'} size="sm" onClick={() => toggleAttivo(m)}>
                    {m.attivo ? 'Disattiva' : 'Attiva'}
                  </Button>
                </div>
              </div>
              <Table compact>
                <thead>
                  <tr>
                    <Th>Ruolo</Th>
                    {campi.map(c => <Th key={c.key} center>{c.label}</Th>)}
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {ruoli.map(ruolo => {
                    const p = permessi[m.code]?.[ruolo] || { puo_vedere: false, puo_modificare: false, puo_importare: false }
                    return (
                      <tr key={ruolo}>
                        <Td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{ruolo}</Td>
                        {campi.map(c => (
                          <Td key={c.key} center>
                            <input type="checkbox" checked={!!p[c.key]} aria-label={`${ruolo} ${c.label}`}
                              onChange={e => setPermesso(m.code, ruolo, c.key, e.target.checked)} />
                          </Td>
                        ))}
                        <Td center><Button variant="secondary" size="sm" onClick={() => salvaPermesso(m.code, ruolo)}>Salva</Button></Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Revenue — Import massivo
// ---------------------------------------------------------------------------

function RevenueImportMassivo() {
  return (
    <div>
      <PageHeader title="Import massivo" />
      <Card style={{ maxWidth: 640 }}>
        <p className="ui-text-muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 'var(--fs-md)' }}>
          Importa in blocco tutte le coppie di file CSV/Excel da una cartella del server.
        </p>
        <a href="/import/bulk" className="ui-btn ui-btn-primary" style={{ textDecoration: 'none' }}>Vai all'Import massivo →</a>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Revenue — Dati di test
// ---------------------------------------------------------------------------

function RevenueDatiTest() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const caricaStats = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/test-stats')
      setStats(data)
    } catch { setStats(null) }
  }, [])

  useEffect(() => { caricaStats() }, [caricaStats])

  async function handleCancella() {
    if (!(await conferma({
      titolo: 'Cancellare tutti i dati di test Revenue?',
      messaggio: `Verranno eliminati ${stats.righe_revenue} righe revenue e ${stats.sessioni_import} sessioni import di test. L'operazione non è reversibile.`,
      confermaLabel: 'Sì, cancella',
      pericolo: true,
    }))) return
    setLoading(true)
    try {
      const { data } = await api.delete('/admin/test-data')
      avvisi.successo(data.messaggio)
      await caricaStats()
    } catch (err) {
      avvisi.errore(mostraErrore(err))
    } finally { setLoading(false) }
  }

  return (
    <div>
      <PageHeader title="Dati di test — Revenue" />
      <Card style={{ maxWidth: 720 }}>
        {stats && (
          <div className="ui-kpi-row">
            <StatBox label="Righe revenue di test" value={stats.righe_revenue} />
            <StatBox label="Sessioni import di test" value={stats.sessioni_import} />
            <StatBox label="Totale record di test" value={stats.totale} highlight />
          </div>
        )}
        {stats?.totale === 0 && <p className="ui-text-muted" style={{ margin: 0 }}>Nessun dato di test presente nel database.</p>}
        {stats?.totale > 0 && (
          <Button variant="danger" onClick={handleCancella} disabled={loading}>
            {loading ? 'Cancellazione in corso…' : 'Cancella dati di test'}
          </Button>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dipendenti — Centri di costo
// ---------------------------------------------------------------------------

function DipCentriDiCosto() {
  return <AdminCentriDiCosto />
}

// ---------------------------------------------------------------------------
// Dipendenti — Colori CC
// ---------------------------------------------------------------------------

// Palette automatica per reparti senza colore personalizzato — DEVE restare identica a quella
// in Dipendenti.jsx (stesso hash → stesso colore), altrimenti l'anteprima qui non corrisponde.
const _CC_PALETTE = [
  '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4',
  '#f97316', '#84cc16', '#ec4899', '#6366f1', '#14b8a6',
]
function _hashCC(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
function _hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '')
  return { r: parseInt(h.slice(0, 2), 16) || 136, g: parseInt(h.slice(2, 4), 16) || 136, b: parseInt(h.slice(4, 6), 16) || 136 }
}

function DipColoriCC() {
  const [albero, setAlbero] = useState([])
  const [colori, setColori] = useState(null)
  const [modificato, setModificato] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const avvisi = useAvvisi()

  useEffect(() => {
    api.get('/cost-centers/albero').then(r => setAlbero(r.data)).catch(() => {})
    api.get('/config/cc-colori/mappa').then(r => setColori(r.data)).catch(() => {})
  }, [])

  const hexPerNome = (nome) => {
    const v = colori?.[nome]
    if (v && /^#[0-9a-fA-F]{6}$/i.test(v)) return v
    return _CC_PALETTE[_hashCC(nome) % _CC_PALETTE.length]
  }

  const badgeDaHex = (hex, tintPct) => {
    const { r, g, b } = _hexToRgb(hex)
    const bg = (c) => Math.round(c + (255 - c) * tintPct)
    const dark = (c) => Math.round(c * 0.48)
    return {
      background: `rgb(${bg(r)}, ${bg(g)}, ${bg(b)})`,
      border: `1px solid rgba(${r}, ${g}, ${b}, 0.38)`,
      color: `rgb(${dark(r)}, ${dark(g)}, ${dark(b)})`,
      padding: '1px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
    }
  }

  async function salva() {
    setSalvando(true)
    try {
      await api.put('/config/cc-colori/mappa', colori)
      setModificato(false)
      avvisi.successo('Colori salvati correttamente.')
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore nel salvataggio.'))
    } finally { setSalvando(false) }
  }

  if (colori === null) return <Loading />

  const nomiDB = [...new Set(
    albero.flatMap(st => (st.categorie || []).flatMap(cat => (cat.reparti || []).map(r => (r.name || '').toLowerCase().trim()))).filter(Boolean)
  )].sort()
  const nomiExtra = Object.keys(colori).filter(k => !nomiDB.includes(k)).sort()
  const tuttiNomi = [...nomiDB, ...nomiExtra]
  const imposta = (nome, valore) => { setColori(p => ({ ...p, [nome]: valore })); setModificato(true) }

  return (
    <div>
      <PageHeader title="Colori centri di costo">
        <Button onClick={salva} disabled={!modificato || salvando}>{salvando ? 'Salvataggio…' : '💾 Salva colori'}</Button>
      </PageHeader>
      <p className="ui-text-muted" style={{ fontSize: 'var(--fs-base)', marginTop: -8 }}>
        Scegli il colore base di ogni tipo di reparto. Le strutture usano varianti graduate automaticamente.
        I reparti senza colore personalizzato (<em>auto</em>) usano un colore generato automaticamente.
      </p>
      {modificato && <Messaggio tipo="warn">Ci sono modifiche non salvate.</Messaggio>}

      <Table compact>
        <thead>
          <tr><Th>Reparto</Th><Th center>Colore base</Th><Th>Hex</Th><Th>Anteprima strutture →</Th><Th /></tr>
        </thead>
        <tbody>
          {tuttiNomi.map(nome => {
            const hex = hexPerNome(nome)
            const isCustom = Object.prototype.hasOwnProperty.call(colori, nome) && /^#[0-9a-fA-F]{6}$/i.test(colori[nome])
            return (
              <tr key={nome}>
                <Td style={{ fontWeight: 600, minWidth: 110 }}>
                  {nome}
                  {!isCustom && <Badge style={{ marginLeft: 6 }}>auto</Badge>}
                </Td>
                <Td center style={{ width: 60 }}>
                  <input type="color" value={hex} onChange={e => imposta(nome, e.target.value)} aria-label={`Colore ${nome}`}
                    style={{ width: 36, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer', padding: 2, background: 'none' }} />
                </Td>
                <Td style={{ width: 100 }}>
                  <Input type="text" value={hex} maxLength={7} spellCheck={false}
                    onChange={e => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) imposta(nome, e.target.value) }}
                    style={{ width: 86, fontFamily: 'monospace', padding: '3px 6px' }} />
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[['CLB', 0.55], ['DPH', 0.72], ['INT', 0.85], ['COMUNE', 0.94]].map(([st, t]) => (
                      <span key={st} style={badgeDaHex(hex, t)}>{st}</span>
                    ))}
                  </div>
                </Td>
                <Td center style={{ width: 110 }}>
                  {isCustom ? (
                    <Button variant="ghost" size="sm" onClick={() => { setColori(p => { const c = { ...p }; delete c[nome]; return c }); setModificato(true) }}>ripristina</Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => imposta(nome, hex)}>personalizza</Button>
                  )}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dipendenti — Dati di test
// ---------------------------------------------------------------------------

function DipDatiTest() {
  const [stats, setStats] = useState(null)
  const [cancellando, setCancellando] = useState(false)
  const [elimImport, setElimImport]   = useState(true)
  const [elimDip, setElimDip]         = useState(false)
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    api.get('/dipendenti/admin/test-stats').then(r => setStats(r.data)).catch(() => {})
  }, [])

  useEffect(() => { carica() }, [carica])

  async function elimina() {
    if (!elimImport) { avvisi.attenzione('Seleziona almeno "Import di test" per procedere.'); return }
    const messaggio = elimDip
      ? `Verranno eliminati ${stats.payroll_imports} import di test e ${stats.dipendenti_orfani} dipendenti senza altri dati.`
      : `Verranno eliminati ${stats.payroll_imports} import di test. Le anagrafiche e le classificazioni CC dei dipendenti saranno mantenute.`
    if (!(await conferma({ titolo: 'Eliminare i dati di test selezionati?', messaggio, pericolo: true }))) return
    setCancellando(true)
    try {
      const { data } = await api.delete(`/dipendenti/admin/test-data?elimina_dipendenti=${elimDip}`)
      avvisi.successo(data.messaggio)
      await carica()
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore nella cancellazione.'))
    } finally { setCancellando(false) }
  }

  const nessunTest = stats && stats.payroll_imports === 0
  // Opzione con titolo in grassetto e descrizione sotto
  const opzione = (titolo, descrizione) => (
    <span>
      <span style={{ display: 'block', fontWeight: 600, color: colors.text }}>{titolo}</span>
      <span style={{ display: 'block', fontSize: 'var(--fs-sm)', color: colors.textMuted, marginTop: 2 }}>{descrizione}</span>
    </span>
  )

  return (
    <div>
      <PageHeader title="Dati di test — Dipendenti" />
      <Card style={{ maxWidth: 820 }}>
        {stats && (
          <div className="ui-kpi-row">
            {[
              { label: 'Import di test',        value: stats.payroll_imports },
              { label: 'Voci di costo',         value: stats.payroll_entries },
              { label: 'Record mensili',        value: stats.employee_monthly },
              { label: 'Dip. senza altri dati', value: stats.dipendenti_orfani },
            ].map(st => <StatBox key={st.label} label={st.label} value={st.value} highlight={st.value > 0} />)}
          </div>
        )}

        {nessunTest && <p className="ui-text-muted" style={{ margin: 0 }}>Nessun dato di test presente.</p>}

        {!nessunTest && stats && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
              <Checkbox checked={elimImport} onChange={setElimImport} style={{ alignItems: 'flex-start' }}
                label={opzione(
                  `Import di test (${stats.payroll_imports} import, ${stats.payroll_entries} voci, ${stats.employee_monthly} record mensili)`,
                  'Elimina i file importati come test e tutti i dati economici collegati.',
                )} />
              <div style={{ opacity: stats.dipendenti_orfani === 0 ? 0.5 : 1, pointerEvents: stats.dipendenti_orfani === 0 ? 'none' : undefined }}>
                <Checkbox checked={elimDip} onChange={setElimDip} style={{ alignItems: 'flex-start' }}
                  label={opzione(
                    `Anagrafiche dipendenti senza altri dati (${stats.dipendenti_orfani} dipendenti)`,
                    'Elimina i dipendenti che esistono solo negli import di test. Se un dipendente ha anche dati reali, viene mantenuto insieme alle sue classificazioni CC.',
                  )} />
              </div>
            </div>
            <Button variant="danger" onClick={elimina} disabled={cancellando || !elimImport}>
              {cancellando ? 'Cancellazione in corso…' : '🗑️ Elimina selezionati'}
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}

// Riquadro numerico dei pannelli "Dati di test" (highlight = totale, in ambra)
function StatBox({ label, value, highlight }) {
  return <KpiTile label={label} value={value} colore={highlight ? colors.warningText : undefined} minWidth={150} />
}

// ---------------------------------------------------------------------------
// Corrispettivi — helpers condivisi
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Corrispettivi — Tipi documento (sola consultazione)
// ---------------------------------------------------------------------------
// Non esiste una tabella configurabile: la classificazione è una regola fissa dell'import
// (TIPI_SCONTRINO / TIPI_FATTURA / PREFISSO_A_STRUTTURA in corrispettivi_excel_parser.py),
// legata alle regole fiscali. Renderla modificabile da qui rischierebbe di cambiare cosa entra
// nei totali trasmessi ad AdE — per questo il pannello la mostra soltanto. Se cambia la regola
// nel parser, aggiornare anche questa tabella.

const REGOLE_TIPO_DOCUMENTO = [
  { suffisso: 'SC', tipo: 'Scontrino', tono: 'ok', trattamento: 'Registro corrispettivi (cassa RT → Agenzia delle Entrate). Entra nei totali.' },
  { suffisso: 'SCA', tipo: 'Scontrino', tono: 'ok', trattamento: 'Come SC. Entra nei totali.' },
  { suffisso: 'F', tipo: 'Fattura', tono: 'info', trattamento: 'Registro fatture (SDI). Entra nei totali, separata dagli scontrini.' },
  { suffisso: 'CP', tipo: 'Escluso', tono: 'neutral', trattamento: "Caparra: salvata solo per controllo, esclusa dai totali per non contare due volte l'IVA." },
  { suffisso: 'FD', tipo: 'Escluso', tono: 'neutral', trattamento: 'Come CP: salvata per controllo, esclusa dai totali.' },
  { suffisso: 'altri', tipo: 'Escluso', tono: 'neutral', trattamento: 'Qualunque altro suffisso: salvato per controllo, escluso dai totali.' },
]

function CorrTipiDocumento() {
  return (
    <div>
      <PageHeader title="Tipi documento — Corrispettivi" />
      <Messaggio tipo="info">
        La classificazione dei documenti importati da Welcome è una <strong>regola fissa</strong> legata
        alle norme fiscali: qui è mostrata in sola consultazione. Il suffisso del documento ha la forma
        <code> prefisso-tipo</code>: il prefisso indica la struttura (<strong>D</strong> = Du Parc,
        {' '}<strong>C</strong> = Club Hotel, <strong>I</strong> = International), il tipo decide come viene trattato.
      </Messaggio>
      <Table compact style={{ maxWidth: 820 }}>
        <thead>
          <tr><Th>Tipo nel suffisso</Th><Th>Classificato come</Th><Th>Trattamento</Th></tr>
        </thead>
        <tbody>
          {REGOLE_TIPO_DOCUMENTO.map(r => (
            <tr key={r.suffisso}>
              <Td><code style={{ fontWeight: 700 }}>{r.suffisso}</code></Td>
              <Td><Badge tono={r.tono}>{r.tipo}</Badge></Td>
              <Td>{r.trattamento}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="ui-text-muted" style={{ marginTop: 10 }}>
        Esempio: <code>D-SC</code> = scontrino del Du Parc, <code>I-F</code> = fattura dell'International,
        {' '}<code>C-CP</code> = caparra del Club Hotel (esclusa).
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Corrispettivi — Tipi pagamento
// ---------------------------------------------------------------------------
// Tabella tipi_pagamento (endpoint /lookup/tipi-pagamento): alimenta SOLO la tendina "Forma di
// pagamento" nella modifica documento di Scontrini/Fatture. I report (Forme di pagamento, Cassa,
// % contante in Home) usano una mappatura fissa nel codice (METODO_A_CATEGORIA_INCASSO), quindi
// modificare questa tabella non cambia nessun totale. Nessuna cancellazione: solo attiva/disattiva.

function CorrTipiPagamento() {
  const [tipiPag, setTipiPag] = useState([])
  const [loading, setLoading] = useState(true)
  const [nuovo, setNuovo] = useState({ codice: '', descrizione: '', categoria: '' })
  const [salvando, setSalvando] = useState(false)
  const avvisi = useAvvisi()

  const carica = useCallback(() => {
    setLoading(true)
    api.get('/lookup/tipi-pagamento', { params: { solo_attivi: false } })
      .then(r => setTipiPag(r.data))
      .catch(e => avvisi.errore(mostraErrore(e)))
      .finally(() => setLoading(false))
  }, [avvisi])
  useEffect(() => { carica() }, [carica])

  const categorie = [...new Set(tipiPag.map(t => t.categoria).filter(Boolean))]

  async function toggleAttivo(t) {
    try {
      await api.put(`/lookup/tipi-pagamento/${t.id}`, { attivo: !t.attivo })
      avvisi.successo(t.attivo ? `${t.descrizione} disattivato` : `${t.descrizione} attivato`)
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function aggiungi() {
    if (!nuovo.codice.trim()) { avvisi.attenzione('Il codice è obbligatorio'); return }
    setSalvando(true)
    try {
      const ordine = tipiPag.reduce((m, t) => Math.max(m, t.ordine || 0), 0) + 1
      await api.post('/lookup/tipi-pagamento', {
        codice: nuovo.codice.trim(),
        descrizione: nuovo.descrizione.trim() || nuovo.codice.trim(),
        categoria: nuovo.categoria.trim(),
        ordine,
      })
      setNuovo({ codice: '', descrizione: '', categoria: '' })
      avvisi.successo('Tipo pagamento aggiunto')
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
    finally { setSalvando(false) }
  }

  return (
    <div>
      <PageHeader title="Tipi pagamento — Corrispettivi" />
      <Messaggio tipo="info">
        Elenco delle forme di pagamento proposte nella tendina <strong>Modifica documento</strong> di
        Scontrini e Fatture. Non influisce sui totali dei report (Forme di pagamento, Cassa), che usano
        una regola fissa. Le voci non si cancellano: si disattivano, e spariscono dalla tendina.
      </Messaggio>

      {loading ? <Loading /> : (
        <Table compact style={{ maxWidth: 760, marginBottom: 20 }}>
          <thead>
            <tr><Th>Codice</Th><Th>Descrizione</Th><Th>Categoria</Th><Th center>Stato</Th><Th></Th></tr>
          </thead>
          <tbody>
            {tipiPag.map(t => (
              <tr key={t.id} className={t.attivo ? undefined : 'ui-riga-attenuata'}>
                <Td><code>{t.codice}</code></Td>
                <Td>{t.descrizione}</Td>
                <Td>{t.categoria || '—'}</Td>
                <Td center><Badge tono={t.attivo ? 'ok' : 'neutral'}>{t.attivo ? 'Attivo' : 'Disattivato'}</Badge></Td>
                <Td center>
                  <Button size="sm" variant="secondary" onClick={() => toggleAttivo(t)}>
                    {t.attivo ? 'Disattiva' : 'Attiva'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Card title="Aggiungi forma di pagamento" style={{ maxWidth: 760 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Codice *">
            <Input value={nuovo.codice} onChange={e => setNuovo(n => ({ ...n, codice: e.target.value }))}
              placeholder="es. PayPal" style={{ width: 150 }} />
          </Field>
          <Field label="Descrizione">
            <Input value={nuovo.descrizione} onChange={e => setNuovo(n => ({ ...n, descrizione: e.target.value }))}
              placeholder="uguale al codice se vuota" style={{ width: 200 }} />
          </Field>
          <Field label="Categoria">
            <Input value={nuovo.categoria} onChange={e => setNuovo(n => ({ ...n, categoria: e.target.value }))}
              list="categorie-pagamento" placeholder="es. Carta di credito" style={{ width: 180 }} />
            <datalist id="categorie-pagamento">
              {categorie.map(c => <option key={c} value={c} />)}
            </datalist>
          </Field>
          <Button onClick={aggiungi} disabled={salvando}>{salvando ? 'Salvataggio…' : '+ Aggiungi'}</Button>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Corrispettivi — Classificazione trattamenti (Analisi Ricavi)
// ---------------------------------------------------------------------------

const CATEGORIE_DISPONIBILI = ['RO', 'BB', 'HB', 'FB', 'AI', 'Altro']

function CorrClassificazioneTrattamenti() {
  const [righe, setRighe] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState({})  // codice → {nome_display, categoria, escludi, ordine}
  const [saving, setSaving] = useState(null)
  const avvisi = useAvvisi()

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/analisi-ricavi/classificazione')
      setRighe(r.data)
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setLoading(false)
    }
  }, [avvisi])

  useEffect(() => { carica() }, [carica])

  const avviaEdit = (r) => {
    setEditing(prev => ({
      ...prev,
      [r.codice]: { nome_display: r.nome_display, categoria: r.categoria || '',
                    escludi: r.escludi, ordine: r.ordine, colore: r.colore || '' },
    }))
  }
  const cancellaEdit = (codice) => {
    setEditing(prev => { const n = { ...prev }; delete n[codice]; return n })
  }
  const aggiornaEdit = (codice, campo, valore) => {
    setEditing(prev => ({ ...prev, [codice]: { ...prev[codice], [campo]: valore } }))
  }

  const salva = async (codice) => {
    setSaving(codice)
    try {
      const body = editing[codice]
      await api.put(`/analisi-ricavi/classificazione/${encodeURIComponent(codice)}`, {
        ...body,
        categoria: body.categoria || null,
        ordine: Number(body.ordine),
        colore: body.colore || null,
      })
      avvisi.successo(`Classificazione '${codice}' salvata.`)
      cancellaEdit(codice)
      carica()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <Loading />

  const nonClassificati = righe.filter(r => !r.categoria && !r.escludi)

  return (
    <div>
      <PageHeader title="Classificazione trattamenti" />
      <p className="ui-text-muted" style={{ fontSize: 'var(--fs-base)', marginTop: -8 }}>
        Mappa i codici di trattamento (listino) alle macrocategorie usate nell'Analisi Ricavi.
        I codici marcati come "Escludi" vengono redistribuiti proporzionalmente tra gli altri.
      </p>

      {nonClassificati.length > 0 && (
        <Messaggio tipo="warn">
          {nonClassificati.length} codic{nonClassificati.length > 1 ? 'i' : 'e'} non classificat{nonClassificati.length > 1 ? 'i' : 'o'}:{' '}
          {nonClassificati.map(r => <strong key={r.codice}>{r.codice} </strong>)}
        </Messaggio>
      )}

      <Table compact>
        <thead>
          <tr>
            <Th>Codice</Th><Th>Nome display</Th><Th>Categoria</Th><Th center>Escludi</Th>
            <Th center>Ordine</Th><Th>Colore</Th><Th />
          </tr>
        </thead>
        <tbody>
          {righe.map(r => {
            const ed = editing[r.codice]
            return (
              <tr key={r.codice} className={ed ? 'ui-riga-evidenza' : undefined}>
                <Td>
                  <code>{r.codice}</code>
                  {r.escludi && !ed && <Badge tono="err" style={{ marginLeft: 6 }}>escluso</Badge>}
                </Td>
                <Td>
                  {ed ? (
                    <Input value={ed.nome_display} onChange={e => aggiornaEdit(r.codice, 'nome_display', e.target.value)} style={{ width: '95%' }} />
                  ) : r.nome_display}
                </Td>
                <Td>
                  {ed ? (
                    <Select value={ed.categoria || ''} onChange={e => aggiornaEdit(r.codice, 'categoria', e.target.value)}>
                      <option value="">— nessuna —</option>
                      {CATEGORIE_DISPONIBILI.map(c => <option key={c} value={c}>{c}</option>)}
                    </Select>
                  ) : (r.categoria ? <Badge tono="info">{r.categoria}</Badge> : <span style={{ color: colors.textSubtle }}>—</span>)}
                </Td>
                <Td center>
                  {ed ? (
                    <input type="checkbox" checked={ed.escludi} onChange={e => aggiornaEdit(r.codice, 'escludi', e.target.checked)} aria-label="Escludi" />
                  ) : (r.escludi ? '✓' : '')}
                </Td>
                <Td center>
                  {ed ? (
                    <Input type="number" value={ed.ordine} onChange={e => aggiornaEdit(r.codice, 'ordine', e.target.value)}
                      style={{ width: 64, textAlign: 'center', padding: '3px 6px' }} />
                  ) : r.ordine}
                </Td>
                <Td>
                  {ed ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <label style={{ cursor: 'pointer', display: 'inline-flex', position: 'relative' }} title="Seleziona colore">
                        <span style={{ width: 22, height: 22, borderRadius: 4, display: 'inline-block', background: ed.colore || colors.border, border: `1px solid ${colors.borderStrong}` }} />
                        <input type="color" value={ed.colore || colors.primary} onChange={e => aggiornaEdit(r.codice, 'colore', e.target.value)}
                          style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
                      </label>
                      <Input type="text" value={ed.colore} onChange={e => aggiornaEdit(r.codice, 'colore', e.target.value)}
                        placeholder="#rrggbb" maxLength={7} spellCheck={false} style={{ width: 84, fontFamily: 'monospace', padding: '3px 6px' }} />
                    </span>
                  ) : (
                    r.colore
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 14, height: 14, borderRadius: 3, background: r.colore, border: `1px solid ${colors.borderStrong}`, display: 'inline-block' }} />
                          <code style={{ fontSize: 'var(--fs-sm)' }}>{r.colore}</code>
                        </span>
                      : <span className="ui-text-muted">auto</span>
                  )}
                </Td>
                <Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {ed ? (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button size="sm" onClick={() => salva(r.codice)} disabled={saving === r.codice}>{saving === r.codice ? '…' : 'Salva'}</Button>
                      <Button variant="secondary" size="sm" onClick={() => cancellaEdit(r.codice)} aria-label="Annulla">✕</Button>
                    </div>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => avviaEdit(r)}>Modifica</Button>
                  )}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// USALI / Produzione — Categorie
// ---------------------------------------------------------------------------

function ProdCategorie() {
  const [righe, setRighe] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState({}) // id → {name, descrizione, includi_report, colore, attivo}
  const [saving, setSaving] = useState(null)
  const [nuovo, setNuovo] = useState({ code: '', name: '' })
  const avvisi = useAvvisi()

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/produzione/categorie')
      setRighe(r.data)
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setLoading(false)
    }
  }, [avvisi])

  useEffect(() => { carica() }, [carica])

  const avviaEdit = (r) => {
    setEditing(prev => ({
      ...prev,
      [r.id]: {
        name: r.name, descrizione: r.descrizione || '', includi_report: r.includi_report,
        colore: r.colore || '', attivo: r.attivo,
        tariffa_riferimento: r.tariffa_riferimento != null ? String(r.tariffa_riferimento) : '',
      },
    }))
  }
  const cancellaEdit = (id) => setEditing(prev => { const n = { ...prev }; delete n[id]; return n })
  const aggiornaEdit = (id, campo, valore) => setEditing(prev => ({ ...prev, [id]: { ...prev[id], [campo]: valore } }))

  const salva = async (id) => {
    setSaving(id)
    try {
      const body = editing[id]
      await api.put(`/produzione/categorie/${id}`, {
        ...body, colore: body.colore || null,
        tariffa_riferimento: body.tariffa_riferimento === '' ? null : Number(body.tariffa_riferimento),
      })
      avvisi.successo('Categoria salvata')
      cancellaEdit(id)
      carica()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setSaving(null)
    }
  }

  const toggleAttivo = async (r) => {
    try {
      await api.put(`/produzione/categorie/${r.id}`, { attivo: !r.attivo })
      avvisi.successo(r.attivo ? 'Categoria disattivata' : 'Categoria attivata')
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  const sposta = async (idx, delta) => {
    const altro = righe[idx + delta]
    const questo = righe[idx]
    if (!altro) return
    try {
      await Promise.all([
        api.put(`/produzione/categorie/${questo.id}`, { ordine: altro.ordine }),
        api.put(`/produzione/categorie/${altro.id}`, { ordine: questo.ordine }),
      ])
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  const creaCategoria = async () => {
    if (!nuovo.code || !nuovo.name) { avvisi.attenzione('Codice e nome obbligatori'); return }
    try {
      await api.post('/produzione/categorie', {
        code: nuovo.code.trim().toLowerCase().replace(/\s+/g, '_'),
        name: nuovo.name.trim(),
        ordine: righe.length ? Math.max(...righe.map(r => r.ordine)) + 1 : 0,
      })
      setNuovo({ code: '', name: '' })
      avvisi.successo('Categoria creata')
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  if (loading) return <Loading />

  return (
    <div>
      <PageHeader title="Categorie Produzione" />
      <p className="ui-text-muted" style={{ fontSize: 'var(--fs-base)', marginTop: -8, maxWidth: 900 }}>
        Categorie di ricavo usate nell'import di Statistiche Produzione (Quota Alloggio, Colazione, ecc.).
        Le categorie disattivate vengono mappate su "altro" nei nuovi import. "Includi nei report" = false
        salva comunque la riga nel DB ma la esclude da tutte le aggregazioni (usato per Riassetto).
        "Tariffa €" è usata solo dalle voci di mapping "assegna per prezzo" (es. Parcheggio Hotel/Esterno):
        se cambia la tariffa stagionale, si aggiorna qui senza toccare codice.
      </p>

      <Table compact>
        <thead>
          <tr>
            <Th center>Ordine</Th><Th>Codice</Th><Th>Nome</Th><Th center>Includi report</Th>
            <Th num>Tariffa €</Th><Th>Colore</Th><Th center>Stato</Th><Th />
          </tr>
        </thead>
        <tbody>
          {righe.map((r, i) => {
            const ed = editing[r.id]
            return (
              <tr key={r.id} className={ed ? 'ui-riga-evidenza' : r.attivo ? undefined : 'ui-riga-attenuata'}>
                <Td center style={{ whiteSpace: 'nowrap' }}>
                  <Button variant="ghost" size="sm" onClick={() => sposta(i, -1)} disabled={i === 0} aria-label="Sposta su" style={{ padding: '2px 6px' }}>▲</Button>
                  <Button variant="ghost" size="sm" onClick={() => sposta(i, 1)} disabled={i === righe.length - 1} aria-label="Sposta giù" style={{ padding: '2px 6px' }}>▼</Button>
                </Td>
                <Td><code>{r.code}</code></Td>
                <Td>
                  {ed ? <Input value={ed.name} onChange={e => aggiornaEdit(r.id, 'name', e.target.value)} style={{ width: '95%' }} /> : r.name}
                </Td>
                <Td center>
                  {ed ? (
                    <input type="checkbox" checked={ed.includi_report} onChange={e => aggiornaEdit(r.id, 'includi_report', e.target.checked)} aria-label="Includi nei report" />
                  ) : (r.includi_report ? '✓' : <span style={{ color: colors.textSubtle }}>—</span>)}
                </Td>
                <Td num>
                  {ed ? (
                    <Input type="number" step="0.01" min="0" value={ed.tariffa_riferimento} className="ui-num"
                      onChange={e => aggiornaEdit(r.id, 'tariffa_riferimento', e.target.value)}
                      placeholder="—" title="Tariffa unitaria per l'assegnazione a prezzo (es. 20.00 €/notte)"
                      style={{ width: 80, textAlign: 'right', padding: '3px 6px' }} />
                  ) : (r.tariffa_riferimento != null ? `${r.tariffa_riferimento.toFixed(2)} €` : <span style={{ color: colors.textSubtle }}>—</span>)}
                </Td>
                <Td><CampoColore modifica={!!ed} valore={ed ? ed.colore : r.colore} onChange={v => aggiornaEdit(r.id, 'colore', v)} /></Td>
                <Td center>
                  <button type="button" onClick={() => toggleAttivo(r)} title={r.attivo ? 'Clicca per disattivare' : 'Clicca per attivare'}
                    className={`ui-badge ${r.attivo ? 'ui-badge-ok' : 'ui-badge-err'}`} style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {r.attivo ? 'attiva' : 'disattivata'}
                  </button>
                </Td>
                <Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {ed ? (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button size="sm" onClick={() => salva(r.id)} disabled={saving === r.id}>{saving === r.id ? '…' : 'Salva'}</Button>
                      <Button variant="secondary" size="sm" onClick={() => cancellaEdit(r.id)} aria-label="Annulla">✕</Button>
                    </div>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => avviaEdit(r)}>Modifica</Button>
                  )}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>

      <Card title="Nuova categoria" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Codice">
            <Input value={nuovo.code} onChange={e => setNuovo(v => ({ ...v, code: e.target.value }))} placeholder="es. spiaggia" style={{ width: 160 }} />
          </Field>
          <Field label="Nome">
            <Input value={nuovo.name} onChange={e => setNuovo(v => ({ ...v, name: e.target.value }))} placeholder="es. Spiaggia" style={{ width: 190 }} />
          </Field>
          <Button onClick={creaCategoria}>+ Aggiungi</Button>
        </div>
      </Card>
    </div>
  )
}

// Colore di una voce: in lettura swatch + codice (o "auto"), in modifica selettore + campo hex
function CampoColore({ modifica, valore, onChange }) {
  if (modifica) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <label style={{ cursor: 'pointer', display: 'inline-flex', position: 'relative' }} title="Seleziona colore">
          <span style={{ width: 22, height: 22, borderRadius: 4, display: 'inline-block', background: valore || colors.border, border: `1px solid ${colors.borderStrong}` }} />
          <input type="color" value={valore || colors.primary} onChange={e => onChange(e.target.value)}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
        </label>
        <Input type="text" value={valore} onChange={e => onChange(e.target.value)} placeholder="#rrggbb" maxLength={7}
          spellCheck={false} style={{ width: 84, fontFamily: 'monospace', padding: '3px 6px' }} />
      </span>
    )
  }
  return valore
    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 14, height: 14, borderRadius: 3, background: valore, border: `1px solid ${colors.borderStrong}`, display: 'inline-block' }} />
        <code style={{ fontSize: 'var(--fs-sm)' }}>{valore}</code>
      </span>
    : <span className="ui-text-muted">auto</span>
}

// ---------------------------------------------------------------------------
// USALI / Produzione — Mapping dettaglio -> categoria
// ---------------------------------------------------------------------------

function ProdMappingDettagli() {
  const [righe, setRighe] = useState([])
  const [categorie, setCategorie] = useState([])
  const [daSmistare, setDaSmistare] = useState([])
  const [loadingSmistare, setLoadingSmistare] = useState(true)
  const [smistaCat, setSmistaCat] = useState({}) // dettaglio_originale → categoria_id scelta
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState({}) // id → {categoria_id, categoria_da_prezzo, conta_come_pasto}
  const [nuovo, setNuovo] = useState({ dettaglio_originale: '', categoria_id: '', categoria_da_prezzo: false, conta_come_pasto: false })
  const [ricalcolando, setRicalcolando] = useState(false)
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const [rMap, rCat] = await Promise.all([
        api.get('/produzione/mapping-dettagli'),
        api.get('/produzione/categorie'),
      ])
      setRighe(rMap.data)
      setCategorie(rCat.data.filter(c => c.attivo))
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setLoading(false)
    }
  }, [avvisi])

  const caricaSmistare = useCallback(async () => {
    setLoadingSmistare(true)
    try {
      const r = await api.get('/produzione/altro-da-smistare')
      setDaSmistare(r.data)
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setLoadingSmistare(false)
    }
  }, [avvisi])

  useEffect(() => { carica(); caricaSmistare() }, [carica, caricaSmistare])

  const salvaCategoria = async (r) => {
    const ed = editing[r.id]
    try {
      await api.put(`/produzione/mapping-dettagli/${r.id}`, {
        dettaglio_originale: r.dettaglio_originale,
        categoria_id: Number(ed.categoria_id),
        categoria_da_prezzo: ed.categoria_da_prezzo,
        conta_come_pasto: ed.conta_come_pasto,
      })
      avvisi.successo('Mapping aggiornato')
      setEditing(prev => { const n = { ...prev }; delete n[r.id]; return n })
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  const elimina = async (r) => {
    if (!(await conferma({
      titolo: `Rimuovere il mapping per "${r.dettaglio_originale}"?`,
      messaggio: 'Le nuove righe con questo testo ricadranno su "Altro".',
      confermaLabel: 'Rimuovi',
      pericolo: true,
    }))) return
    try {
      await api.delete(`/produzione/mapping-dettagli/${r.id}`)
      avvisi.successo('Mapping rimosso')
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  const crea = async () => {
    if (!nuovo.dettaglio_originale || !nuovo.categoria_id) { avvisi.attenzione('Testo e categoria obbligatori'); return }
    try {
      await api.post('/produzione/mapping-dettagli', {
        dettaglio_originale: nuovo.dettaglio_originale.trim(),
        categoria_id: Number(nuovo.categoria_id),
        categoria_da_prezzo: nuovo.categoria_da_prezzo,
        conta_come_pasto: nuovo.conta_come_pasto,
      })
      setNuovo({ dettaglio_originale: '', categoria_id: '', categoria_da_prezzo: false, conta_come_pasto: false })
      avvisi.successo('Mapping creato')
      carica()
      caricaSmistare()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  const ricalcolaCategorie = async () => {
    if (!(await conferma({
      titolo: 'Ricalcolare le categorie di tutte le righe già importate?',
      messaggio: 'Riassegna la categoria di TUTTE le righe già importate in base al mapping attuale (utile dopo aver smistato una voce da "Altro" a una categoria specifica).',
      confermaLabel: 'Ricalcola',
    }))) return
    setRicalcolando(true)
    try {
      const { data } = await api.post('/produzione/ricalcola-categorie')
      avvisi.successo(`Ricalcolo completato: ${data.n_righe_aggiornate} righe aggiornate su ${data.n_righe_esaminate} esaminate.`)
      caricaSmistare()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
    finally { setRicalcolando(false) }
  }

  const assegnaSmistata = async (voce) => {
    const categoria_id = smistaCat[voce.dettaglio_originale]
    if (!categoria_id) { avvisi.attenzione('Seleziona una categoria prima di assegnare'); return }
    try {
      await api.post('/produzione/mapping-dettagli', {
        dettaglio_originale: voce.dettaglio_originale,
        categoria_id: Number(categoria_id),
        categoria_da_prezzo: false,
      })
      avvisi.successo(`"${voce.dettaglio_originale}" smistata`)
      carica()
      caricaSmistare()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  if (loading) return <Loading />

  const chiudiEdit = (id) => setEditing(prev => { const n = { ...prev }; delete n[id]; return n })
  const aggiornaEdit = (id, campo, valore) => setEditing(prev => ({ ...prev, [id]: { ...prev[id], [campo]: valore } }))

  return (
    <div>
      <PageHeader title="Mapping dettagli Produzione">
        <Button variant="secondary" onClick={ricalcolaCategorie} disabled={ricalcolando}>
          {ricalcolando ? 'Ricalcolo in corso…' : 'Ricalcola categorie righe esistenti'}
        </Button>
      </PageHeader>
      <p className="ui-text-muted" style={{ fontSize: 'var(--fs-base)', marginTop: -8, maxWidth: 900 }}>
        Collega il testo esatto della colonna "Articolo" dell'export Welcome (StatisticheProduzione.xlsx)
        alla categoria di ricavo. Il confronto è case-insensitive. Un testo non presente in questa lista
        ricade automaticamente su "Altro" — nessuna modifica al codice necessaria per aggiungere,
        rimuovere o rimappare una voce (es. se Welcome rinomina "Parcheggio Area Hotel" l'anno prossimo).
        "Assegna per prezzo" ignora il testo e sceglie la categoria in base a un multiplo esatto
        della "Tariffa €" della categoria (vedi tab Categorie) — usato per "Parcheggio extra", dove
        lo stesso testo può indicare sia Parcheggio Hotel (20€) sia Esterno (13€) a seconda dei giorni.
        "Conta come pasto" marca le voci che rappresentano un pasto vero, una a persona/pasto (es.
        "Quota Cena", "Quota Colazione") — usato dalla tab "Conteggio pasti" di Statistiche Produzione
        per non contare anche i singoli piatti/bevande/coperti mappati nella stessa categoria
        colazione/pranzo/cena solo per finalità di ricavo (es. il ristorante Maremosso per Du Parc).
      </p>
      <Messaggio tipo="info">
        Il mapping si applica automaticamente solo alle righe importate DOPO la modifica. Usa
        "Ricalcola categorie righe esistenti" (in alto a destra) per applicarlo retroattivamente anche
        alle righe già in archivio.
      </Messaggio>

      <Card title='Da smistare — voci ancora in "Altro"' style={{ marginBottom: 20, boxShadow: `inset 4px 0 0 ${colors.warning}` }}>
        <p className="ui-text-muted" style={{ marginTop: -6 }}>
          Ordinate per importo totale (dati reali, tutti gli import), così si parte da quelle che valgono di più.
        </p>
        {loadingSmistare ? <Loading /> : daSmistare.length === 0 ? (
          <p style={{ color: colors.successText, fontWeight: 600, margin: 0 }}>✓ Nessuna voce da smistare.</p>
        ) : (
          <Table compact>
            <thead><tr><Th>Testo Welcome</Th><Th num>N. righe</Th><Th num>Totale lordo</Th><Th /></tr></thead>
            <tbody>
              {daSmistare.slice(0, 30).map(v => (
                <tr key={v.dettaglio_originale}>
                  <Td><code>{v.dettaglio_originale}</code></Td>
                  <Td num>{v.n_righe}</Td>
                  <Td num style={{ fontWeight: 600 }}>{v.totale_lordo.toFixed(2)} €</Td>
                  <Td style={{ textAlign: 'right' }}>
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <Select value={smistaCat[v.dettaglio_originale] || ''} aria-label="Categoria"
                        onChange={e => setSmistaCat(prev => ({ ...prev, [v.dettaglio_originale]: e.target.value }))}>
                        <option value="">— categoria —</option>
                        {categorie.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </Select>
                      <Button size="sm" onClick={() => assegnaSmistata(v)}>Assegna</Button>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Table compact>
        <thead>
          <tr><Th>Testo Welcome (Articolo)</Th><Th>Categoria</Th><Th center>Assegna per prezzo</Th><Th center>Conta come pasto</Th><Th /></tr>
        </thead>
        <tbody>
          {righe.map(r => {
            const ed = editing[r.id]
            return (
              <tr key={r.id} className={ed ? 'ui-riga-evidenza' : undefined}>
                <Td><code>{r.dettaglio_originale}</code></Td>
                <Td>
                  {ed ? (
                    <Select value={ed.categoria_id} onChange={e => aggiornaEdit(r.id, 'categoria_id', e.target.value)} aria-label="Categoria">
                      {categorie.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  ) : <Badge tono="info">{r.categoria_name}</Badge>}
                </Td>
                <Td center>
                  {ed ? (
                    <input type="checkbox" checked={ed.categoria_da_prezzo} onChange={e => aggiornaEdit(r.id, 'categoria_da_prezzo', e.target.checked)} aria-label="Assegna per prezzo" />
                  ) : (r.categoria_da_prezzo ? <Badge tono="warn">per prezzo</Badge> : <span style={{ color: colors.textSubtle }}>—</span>)}
                </Td>
                <Td center>
                  {ed ? (
                    <input type="checkbox" checked={ed.conta_come_pasto} onChange={e => aggiornaEdit(r.id, 'conta_come_pasto', e.target.checked)} aria-label="Conta come pasto" />
                  ) : (r.conta_come_pasto ? <Badge tono="ok">pasto</Badge> : <span style={{ color: colors.textSubtle }}>—</span>)}
                </Td>
                <Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {ed ? (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button size="sm" onClick={() => salvaCategoria(r)}>Salva</Button>
                      <Button variant="secondary" size="sm" onClick={() => chiudiEdit(r.id)} aria-label="Annulla">✕</Button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button variant="secondary" size="sm"
                        onClick={() => setEditing(prev => ({ ...prev, [r.id]: { categoria_id: r.categoria_id, categoria_da_prezzo: r.categoria_da_prezzo, conta_come_pasto: r.conta_come_pasto } }))}>
                        Modifica
                      </Button>
                      <Button variant="danger-soft" size="sm" onClick={() => elimina(r)}>Rimuovi</Button>
                    </div>
                  )}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>

      <Card title="Nuovo mapping" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Testo esatto">
            <Input value={nuovo.dettaglio_originale} onChange={e => setNuovo(v => ({ ...v, dettaglio_originale: e.target.value }))}
              placeholder='es. "Servizio Spiaggia"' style={{ width: 230 }} />
          </Field>
          <Field label="Categoria">
            <Select value={nuovo.categoria_id} onChange={e => setNuovo(v => ({ ...v, categoria_id: e.target.value }))} style={{ width: 170 }}>
              <option value="">— categoria —</option>
              {categorie.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Checkbox checked={nuovo.categoria_da_prezzo} onChange={v => setNuovo(n => ({ ...n, categoria_da_prezzo: v }))} label="assegna per prezzo" style={{ alignSelf: 'center' }} />
          <Checkbox checked={nuovo.conta_come_pasto} onChange={v => setNuovo(n => ({ ...n, conta_come_pasto: v }))} label="conta come pasto" style={{ alignSelf: 'center' }} />
          <Button onClick={crea}>+ Aggiungi</Button>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Corrispettivi — Stampanti RT
// ---------------------------------------------------------------------------

function CorrStampantiRT() {
  const [stampanti, setStampanti] = useState([])
  const [hotels, setHotels] = useState([])
  const [loading, setLoading] = useState(true)
  const [nuovoNome, setNuovoNome] = useState('')
  const [nuovoIp, setNuovoIp] = useState('')
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    setLoading(true)
    const [dStampanti, dHotels] = await Promise.all([
      api.get('/rt-printers/').then(r => r.data).catch(() => []),
      api.get('/hotels/').then(r => r.data).catch(() => []),
    ])
    setStampanti(dStampanti); setHotels(dHotels); setLoading(false)
  }, [])
  useEffect(() => { carica() }, [carica])

  async function aggiungi() {
    if (!nuovoNome || !nuovoIp) { avvisi.attenzione('Nome e IP obbligatori'); return }
    try {
      await api.post('/rt-printers/', { nome: nuovoNome, ip: nuovoIp })
      setNuovoNome(''); setNuovoIp('')
      avvisi.successo('Stampante aggiunta'); carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function elimina(id) {
    if (!(await conferma({
      titolo: 'Eliminare questa stampante?',
      messaggio: 'Gli hotel associati resteranno senza RT configurato.',
      pericolo: true,
    }))) return
    try { await api.delete(`/rt-printers/${id}`); avvisi.successo('Stampante eliminata'); carica() }
    catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function associa(hotelCode, printerId) {
    try {
      await api.put(`/rt-printers/hotels/${hotelCode}`, { printer_id: printerId ? Number(printerId) : null })
      avvisi.successo('Associazione aggiornata'); carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <PageHeader title="Stampanti RT — Corrispettivi" />
      <p className="ui-text-muted" style={{ fontSize: 'var(--fs-base)', marginTop: -8 }}>
        Registratori telematici Epson FP-81 II. Più hotel possono condividere la stessa stampante
        (es. Du Parc + Club Hotel): basta associarli allo stesso IP.
      </p>
      {loading ? <Loading /> : (
        <>
          <Table compact style={{ marginBottom: 16 }}>
            <thead><tr><Th>Nome</Th><Th>IP</Th><Th>Hotel associati</Th><Th /></tr></thead>
            <tbody>
              {stampanti.map(st => (
                <tr key={st.id}>
                  <Td style={{ fontWeight: 600 }}>{st.nome}</Td>
                  <Td><code>{st.ip}</code></Td>
                  <Td style={{ color: colors.textMuted }}>{st.hotels.join(', ') || '—'}</Td>
                  <Td center><Button variant="danger-soft" size="sm" onClick={() => elimina(st.id)}>Elimina</Button></Td>
                </tr>
              ))}
              {stampanti.length === 0 && <tr><Td colSpan={4} center muted>Nessuna stampante configurata</Td></tr>}
            </tbody>
          </Table>

          <Card title="Aggiungi stampante" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Nome">
                <Input value={nuovoNome} onChange={e => setNuovoNome(e.target.value)} placeholder="es. Du Parc / Club Hotel" style={{ width: 230 }} />
              </Field>
              <Field label="IP">
                <Input value={nuovoIp} onChange={e => setNuovoIp(e.target.value)} placeholder="es. 192.168.100.134" style={{ width: 170, fontFamily: 'monospace' }} />
              </Field>
              <Button onClick={aggiungi}>+ Aggiungi</Button>
            </div>
          </Card>

          <h3 className="ui-section-title">Associazione hotel → stampante</h3>
          <Table compact>
            <thead><tr><Th>Hotel</Th><Th>Stampante RT</Th></tr></thead>
            <tbody>
              {hotels.map(h => (
                <tr key={h.code}>
                  <Td style={{ fontWeight: 600 }}>{h.code} — {h.name}</Td>
                  <Td>
                    <Select value={h.rt_printer?.id || ''} onChange={e => associa(h.code, e.target.value)} aria-label={`Stampante di ${h.name}`}>
                      <option value="">— Nessuna —</option>
                      {stampanti.map(st => <option key={st.id} value={st.id}>{st.nome} ({st.ip})</option>)}
                    </Select>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  )
}

function Placeholder({ sezione }) {
  const tutti = SEZIONI.flatMap(g => g.voci)
  const voce = tutti.find(v => v.id === sezione)
  return <StatoVuoto>[{voce?.label ?? sezione}] — sezione da implementare</StatoVuoto>
}

// ---------------------------------------------------------------------------
// USALI — Mappatura CC → voce costo lavoro
// ---------------------------------------------------------------------------

const VOCE_OPTIONS = [
  { value: 'camere', label: 'Camere' },
  { value: 'fnb',    label: 'F&B' },
  { value: null,     label: 'Altri reparti (default)' },
]

function UsaliCCMapping() {
  const [albero, setAlbero] = useState([])
  const [mapping, setMapping] = useState({})
  const [salvando, setSalvando] = useState(false)
  const [modificato, setModificato] = useState(false)
  const avvisi = useAvvisi()

  useEffect(() => {
    Promise.all([
      api.get('/cost-centers/albero'),
      api.get('/usali/cc-mapping'),
    ]).then(([ra, rm]) => {
      setAlbero(ra.data)
      setMapping(rm.data)
    }).catch(e => avvisi.errore(mostraErrore(e)))
  }, [avvisi])

  function setVoce(ccCode, val) {
    setModificato(true)
    setMapping(prev => {
      const next = { ...prev }
      if (val === null) delete next[ccCode]
      else next[ccCode] = val
      return next
    })
  }

  async function salva() {
    setSalvando(true)
    try {
      await api.put('/usali/cc-mapping', mapping)
      setModificato(false)
      avvisi.successo('Mappatura salvata.')
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally { setSalvando(false) }
  }

  if (!albero.length) return <Loading />

  return (
    <div style={{ maxWidth: 820 }}>
      <PageHeader title="Mappatura costi del lavoro">
        <Button onClick={salva} disabled={salvando}>{salvando ? 'Salvataggio…' : 'Salva mappatura'}</Button>
      </PageHeader>
      <p className="ui-text-muted" style={{ fontSize: 'var(--fs-base)', marginTop: -8 }}>
        Assegna ogni Centro di Costo a una voce USALI. I costi vengono letti automaticamente
        dal modulo Dipendenti. Senza assegnazione → <strong>Altri reparti</strong>.
      </p>
      {modificato && <Messaggio tipo="warn">Ci sono modifiche non salvate.</Messaggio>}

      {albero.map(struttura => (
        <div key={struttura.code} className="ui-card" style={{ padding: 0, marginBottom: 20, overflow: 'hidden' }}>
          {/* Header struttura con assegnazione rapida di tutti i CC */}
          <div style={{ background: colors.primary, color: '#fff', padding: '8px 14px', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>{struttura.name} <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.7, fontWeight: 400 }}>({struttura.code})</span></span>
            <div style={{ display: 'flex', gap: 4 }}>
              {VOCE_OPTIONS.map(o => (
                <Button key={String(o.value)} variant="secondary" size="sm" onClick={() => {
                  const allCodes = [struttura.code,
                    ...struttura.categorie.flatMap(c => [c.code, ...c.reparti.map(r => r.code)])]
                  allCodes.forEach(cc => setVoce(cc, o.value))
                }}>
                  Tutti {o.label}
                </Button>
              ))}
            </div>
          </div>

          {struttura.categorie.map(cat => (
            <div key={cat.code}>
              <ToggleRigaCC code={cat.code} name={cat.name} tipo="categoria"
                voce={mapping[cat.code] ?? null} onChange={v => setVoce(cat.code, v)} />
              {cat.reparti.map(rep => (
                <ToggleRigaCC key={rep.code} code={rep.code} name={rep.name} tipo="reparto"
                  voce={mapping[rep.code] ?? null} onChange={v => setVoce(rep.code, v)} indent />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function ToggleRigaCC({ code, name, tipo, voce, onChange, indent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '5px 14px', paddingLeft: indent ? 32 : 14,
      background: tipo === 'categoria' ? colors.surfaceSoft : colors.surface,
      borderBottom: `1px solid ${colors.surfaceAlt}`,
    }}>
      <span style={{ flex: 1, color: colors.textSecond, fontWeight: tipo === 'categoria' ? 600 : 400 }}>
        {tipo === 'reparto' && <span style={{ color: colors.borderStrong, marginRight: 6 }}>└</span>}
        {name}
        <code style={{ fontSize: 'var(--fs-xs)', color: colors.textSubtle, marginLeft: 6 }}>{code}</code>
      </span>
      <SegmentedControl value={voce} onChange={onChange} options={VOCE_OPTIONS} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// USALI — Range KPI
// ---------------------------------------------------------------------------

const KPI_CODES = ['ebitdar_pct', 'fnb_cost_pct', 'lavoro_pct', 'utenze_pct']
const KPI_LABELS = {
  ebitdar_pct: 'EBITDAR su ricavi',
  fnb_cost_pct: 'F&B cost su ricavi',
  lavoro_pct: 'Costo del lavoro su ricavi',
  utenze_pct: 'Costo energetico su ricavi',
}

function UsaliKpiConfig() {
  const [config, setConfig] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [modificato, setModificato] = useState(false)
  const avvisi = useAvvisi()

  useEffect(() => {
    api.get('/usali/kpi-config').then(r => setConfig(r.data)).catch(e => avvisi.errore(mostraErrore(e)))
  }, [avvisi])

  function aggiornaRange(tipo, kpiCode, campo, valore) {
    setModificato(true)
    setConfig(prev => ({
      ...prev,
      [tipo]: { ...prev[tipo], [kpiCode]: { ...prev[tipo][kpiCode], [campo]: valore } },
    }))
  }

  async function salva() {
    setSalvando(true)
    try {
      await api.put('/usali/kpi-config', config)
      setModificato(false)
      avvisi.successo('Range KPI salvati.')
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setSalvando(false)
    }
  }

  if (!config) return <Loading />

  const tipi = [
    { id: 'hotel', label: 'Hotel (DPH / CLB / INT)' },
    { id: 'ristoranti', label: 'Ristoranti (MMS / BON)' },
  ]
  const campoPerc = (id, kpiCode, campo, valore) => (
    <Input type="number" min={0} max={100} step={0.5} value={valore ?? ''} className="ui-num"
      onChange={e => aggiornaRange(id, kpiCode, campo, parseFloat(e.target.value))}
      style={{ width: 76, textAlign: 'center', padding: '3px 6px' }} />
  )

  return (
    <div style={{ maxWidth: 720 }}>
      <PageHeader title="Range KPI USALI">
        <Button onClick={salva} disabled={salvando}>{salvando ? 'Salvataggio…' : 'Salva range'}</Button>
      </PageHeader>
      <p className="ui-text-muted" style={{ fontSize: 'var(--fs-base)', marginTop: -8 }}>
        I range definiscono la zona verde (●) del semaforo nella pagina USALI.
        Sotto il minimo → arancione; sopra il massimo → rosso.
      </p>
      {modificato && <Messaggio tipo="warn">Ci sono modifiche non salvate.</Messaggio>}

      {tipi.map(({ id, label }) => (
        <Card key={id} title={label} style={{ marginBottom: 20 }}>
          <Table compact>
            <thead>
              <tr><Th>KPI</Th><Th center>Min %</Th><Th center>Max %</Th><Th center>Range</Th></tr>
            </thead>
            <tbody>
              {KPI_CODES.map(kpiCode => {
                const rng = config[id]?.[kpiCode] ?? { lo: 0, hi: 0 }
                return (
                  <tr key={kpiCode}>
                    <Td>{KPI_LABELS[kpiCode]}</Td>
                    <Td center>{campoPerc(id, kpiCode, 'lo', rng.lo)}</Td>
                    <Td center>{campoPerc(id, kpiCode, 'hi', rng.hi)}</Td>
                    <Td center muted className="ui-num">{rng.lo}% – {rng.hi}%</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </Card>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// USALI — Righe Movimenti Attivi (per struttura)
// ---------------------------------------------------------------------------

const STRUTTURE_MOVIMENTI = [
  { code: 'DPH', label: 'Du Parc' },
  { code: 'CLB', label: 'Club Hotel' },
  { code: 'INT', label: 'International' },
  { code: 'BON', label: 'Buona Onda' },
]
const TIPI_RIGA = [
  { value: 'manuale', label: 'Manuale' },
  { value: 'auto_produzione', label: 'Auto — categoria Produzione' },
  { value: 'auto_corrispettivi_penali', label: 'Auto — Penali Corrispettivi' },
  { value: 'auto_maremosso', label: 'Auto — Maremosso Hotel (redirect, solo DPH)' },
  { value: 'auto_maremosso_esterni', label: 'Auto — Maremosso Clienti Esterni (Corrispettivi MMS, solo DPH)' },
]

function UsaliMovimentiRighe() {
  const [struttura, setStruttura] = useState('DPH')
  const [righe, setRighe] = useState([])
  const [categorie, setCategorie] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState({}) // id → {reparto, conto, tipo, categoria_produzione}
  const [nuovo, setNuovo] = useState({ reparto: '', conto: '', riga_code: '', tipo: 'manuale', categoria_produzione: '', aliquota_iva: '10' })
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const [rRighe, rCat] = await Promise.all([
        api.get('/usali/movimenti-righe', { params: { struttura } }),
        api.get('/produzione/categorie'),
      ])
      setRighe(rRighe.data)
      setCategorie(rCat.data.filter(c => c.attivo))
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setLoading(false)
    }
  }, [struttura, avvisi])

  useEffect(() => { carica() }, [carica])

  const avviaEdit = (r) => setEditing(prev => ({
    ...prev,
    [r.id]: {
      reparto: r.reparto, conto: r.conto, tipo: r.tipo,
      categoria_produzione: r.categoria_produzione || '', aliquota_iva: String(r.aliquota_iva),
    },
  }))
  const annullaEdit = (id) => setEditing(prev => { const n = { ...prev }; delete n[id]; return n })

  const salva = async (r) => {
    const ed = editing[r.id]
    try {
      await api.put(`/usali/movimenti-righe/${r.id}`, {
        reparto: ed.reparto, conto: ed.conto, tipo: ed.tipo,
        categoria_produzione: ed.tipo === 'auto_produzione' ? ed.categoria_produzione : null,
        aliquota_iva: Number(ed.aliquota_iva) || 0,
      })
      avvisi.successo('Riga salvata')
      annullaEdit(r.id)
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  const toggleAttivo = async (r) => {
    try {
      await api.put(`/usali/movimenti-righe/${r.id}`, { attivo: !r.attivo })
      avvisi.successo(r.attivo ? 'Riga disattivata' : 'Riga attivata')
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  const sposta = async (idx, delta) => {
    const altra = righe[idx + delta]
    const questa = righe[idx]
    if (!altra) return
    try {
      await Promise.all([
        api.put(`/usali/movimenti-righe/${questa.id}`, { ordine: altra.ordine }),
        api.put(`/usali/movimenti-righe/${altra.id}`, { ordine: questa.ordine }),
      ])
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  const elimina = async (r) => {
    if (!(await conferma({ titolo: `Eliminare la riga "${r.reparto} / ${r.conto}"?`, pericolo: true }))) return
    try {
      await api.delete(`/usali/movimenti-righe/${r.id}`)
      avvisi.successo('Riga eliminata')
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  const crea = async () => {
    if (!nuovo.reparto || !nuovo.conto || !nuovo.riga_code) { avvisi.attenzione('Reparto, conto e codice riga obbligatori'); return }
    if (nuovo.tipo === 'auto_produzione' && !nuovo.categoria_produzione) { avvisi.attenzione('Seleziona una categoria Produzione'); return }
    try {
      await api.post('/usali/movimenti-righe', {
        struttura_code: struttura, reparto: nuovo.reparto.trim(), conto: nuovo.conto.trim(),
        riga_code: nuovo.riga_code.trim(), tipo: nuovo.tipo,
        categoria_produzione: nuovo.tipo === 'auto_produzione' ? nuovo.categoria_produzione : null,
        aliquota_iva: Number(nuovo.aliquota_iva) || 10,
      })
      setNuovo({ reparto: '', conto: '', riga_code: '', tipo: 'manuale', categoria_produzione: '', aliquota_iva: '10' })
      avvisi.successo('Riga creata')
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  const aggiornaEdit = (id, campo, valore) => setEditing(prev => ({ ...prev, [id]: { ...prev[id], [campo]: valore } }))
  const selectCategoria = (valore, onChange) => (
    <Select value={valore} onChange={e => onChange(e.target.value)} aria-label="Categoria Produzione">
      <option value="">— categoria —</option>
      {categorie.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
    </Select>
  )

  return (
    <div>
      <PageHeader title="Righe Movimenti Attivi">
        <SegmentedControl value={struttura} onChange={setStruttura}
          options={STRUTTURE_MOVIMENTI.map(st => ({ value: st.code, label: st.label }))} />
      </PageHeader>
      <p className="ui-text-muted" style={{ fontSize: 'var(--fs-base)', marginTop: -8, maxWidth: 900 }}>
        Le voci di "Movimenti Attivi" (Reparto/Conto) non sono le stesse per ogni struttura — es. il
        Du Parc ha il Ristorante Mare Mosso (redirect automatico), Club Hotel e International hanno
        un Ristorante proprio, Buona Onda ha un set minimo tutto manuale. Gestisci qui quali righe
        esistono per ciascuna struttura, senza bisogno di modifiche al codice.
      </p>

      {loading ? <Loading /> : (
        <Table compact>
          <thead>
            <tr><Th center>Ordine</Th><Th>Reparto</Th><Th>Conto</Th><Th>Tipo</Th><Th center>Aliquota IVA %</Th><Th center>Stato</Th><Th /></tr>
          </thead>
          <tbody>
            {righe.map((r, i) => {
              const ed = editing[r.id]
              return (
                <tr key={r.id} className={ed ? 'ui-riga-evidenza' : r.attivo ? undefined : 'ui-riga-attenuata'}>
                  <Td center style={{ whiteSpace: 'nowrap' }}>
                    <Button variant="ghost" size="sm" onClick={() => sposta(i, -1)} disabled={i === 0} aria-label="Sposta su" style={{ padding: '2px 6px' }}>▲</Button>
                    <Button variant="ghost" size="sm" onClick={() => sposta(i, 1)} disabled={i === righe.length - 1} aria-label="Sposta giù" style={{ padding: '2px 6px' }}>▼</Button>
                  </Td>
                  <Td>{ed ? <Input value={ed.reparto} onChange={e => aggiornaEdit(r.id, 'reparto', e.target.value)} style={{ width: 150 }} /> : r.reparto}</Td>
                  <Td>{ed ? <Input value={ed.conto} onChange={e => aggiornaEdit(r.id, 'conto', e.target.value)} style={{ width: 230 }} /> : r.conto}</Td>
                  <Td>
                    {ed ? (
                      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Select value={ed.tipo} onChange={e => aggiornaEdit(r.id, 'tipo', e.target.value)} aria-label="Tipo riga">
                          {TIPI_RIGA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </Select>
                        {ed.tipo === 'auto_produzione' && selectCategoria(ed.categoria_produzione, v => aggiornaEdit(r.id, 'categoria_produzione', v))}
                      </span>
                    ) : (
                      <span>
                        {r.tipo !== 'manuale' && <Badge tono="info" style={{ marginRight: 6 }}>AUTO</Badge>}
                        {TIPI_RIGA.find(t => t.value === r.tipo)?.label || r.tipo}
                        {r.categoria_produzione && <span style={{ color: colors.textSubtle }}> ({r.categoria_produzione})</span>}
                      </span>
                    )}
                  </Td>
                  <Td center>
                    {ed ? (
                      <Input type="number" step="0.01" value={ed.aliquota_iva} className="ui-num"
                        onChange={e => aggiornaEdit(r.id, 'aliquota_iva', e.target.value)} style={{ width: 70, textAlign: 'center', padding: '3px 6px' }} />
                    ) : r.tipo === 'manuale' ? `${r.aliquota_iva}%` : (
                      <span style={{ color: colors.textSubtle }} title="Righe auto usano l'IVA reale dai dati sorgente, questa aliquota non è applicata">n/d</span>
                    )}
                  </Td>
                  <Td center>
                    <button type="button" onClick={() => toggleAttivo(r)} title={r.attivo ? 'Clicca per disattivare' : 'Clicca per attivare'}
                      className={`ui-badge ${r.attivo ? 'ui-badge-ok' : 'ui-badge-err'}`} style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {r.attivo ? 'attiva' : 'disattivata'}
                    </button>
                  </Td>
                  <Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {ed ? (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Button size="sm" onClick={() => salva(r)}>Salva</Button>
                        <Button variant="secondary" size="sm" onClick={() => annullaEdit(r.id)} aria-label="Annulla">✕</Button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Button variant="secondary" size="sm" onClick={() => avviaEdit(r)}>Modifica</Button>
                        <Button variant="danger-soft" size="sm" onClick={() => elimina(r)}>Rimuovi</Button>
                      </div>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      <Card title={`Nuova riga — ${STRUTTURE_MOVIMENTI.find(st => st.code === struttura)?.label}`} style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Reparto"><Input value={nuovo.reparto} onChange={e => setNuovo(v => ({ ...v, reparto: e.target.value }))} style={{ width: 150 }} /></Field>
          <Field label="Conto"><Input value={nuovo.conto} onChange={e => setNuovo(v => ({ ...v, conto: e.target.value }))} style={{ width: 210 }} /></Field>
          <Field label="Codice riga"><Input value={nuovo.riga_code} onChange={e => setNuovo(v => ({ ...v, riga_code: e.target.value }))} placeholder="es. mov_xyz" style={{ width: 150 }} /></Field>
          <Field label="Tipo">
            <Select value={nuovo.tipo} onChange={e => setNuovo(v => ({ ...v, tipo: e.target.value }))} style={{ width: 230 }}>
              {TIPI_RIGA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          {nuovo.tipo === 'auto_produzione' && (
            <Field label="Categoria Produzione">{selectCategoria(nuovo.categoria_produzione, v => setNuovo(n => ({ ...n, categoria_produzione: v })))}</Field>
          )}
          {nuovo.tipo === 'manuale' && (
            <Field label="Aliquota IVA %">
              <Input type="number" step="0.01" value={nuovo.aliquota_iva} onChange={e => setNuovo(v => ({ ...v, aliquota_iva: e.target.value }))} style={{ width: 90 }} />
            </Field>
          )}
          <Button onClick={crea}>+ Aggiungi</Button>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Debug & diagnostica
// ---------------------------------------------------------------------------

function SistemaDebug() {
  const [debugOn, setDebugOn] = useState(
    () => localStorage.getItem('debug_errori') === 'true'
  )

  function toggleDebug() {
    const nuovo = !debugOn
    localStorage.setItem('debug_errori', nuovo ? 'true' : 'false')
    setDebugOn(nuovo)
  }

  return (
    <div>
      <PageHeader title="Debug & diagnostica" />
      <Card style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Interruttore on/off */}
          <button
            type="button"
            role="switch"
            aria-checked={debugOn}
            onClick={toggleDebug}
            title={debugOn ? 'Disattiva modalità debug' : 'Attiva modalità debug'}
            style={{
              width: 52, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer', padding: 0,
              background: debugOn ? colors.success : colors.borderStrong,
              position: 'relative', transition: 'background 0.2s', flexShrink: 0,
            }}
          >
            <span style={{
              display: 'block', width: 22, height: 22, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 3, left: debugOn ? 27 : 3, transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(15,23,42,0.2)',
            }} />
          </button>
          <div>
            <div style={{ fontWeight: 600, color: colors.text, fontSize: 'var(--fs-md)' }}>
              Modalità debug errori
              {debugOn && <Badge tono="ok" style={{ marginLeft: 10 }}>ATTIVA</Badge>}
            </div>
            <div className="ui-text-muted" style={{ fontSize: 'var(--fs-base)', marginTop: 2 }}>
              {debugOn
                ? 'I messaggi di errore mostrano il dettaglio completo del backend (stack trace, SQL).'
                : 'I messaggi di errore mostrano solo il testo breve senza dettagli tecnici.'}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, marginBottom: -16 }}>
          <Messaggio tipo={debugOn ? 'warn' : 'info'}>
            <strong>Nota:</strong> questa impostazione è salvata nel browser (localStorage).
            È attiva solo su questo dispositivo e viene mantenuta tra le sessioni.
            Disattivare prima di condividere lo schermo con utenti finali.
          </Messaggio>
        </div>
      </Card>
    </div>
  )
}
