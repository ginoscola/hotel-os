import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { formatEuro, mostraErrore } from '../utils/format'
import {
  STRUTTURE_HOTEL, NOME_CAT,
  isAdmin, fmtD, primoGiorno, ultimoGiorno, giornoSettimana, applyToggle,
} from '../utils/corrispettiviHelpers'
import { meseAnnoPrecedente } from '../utils/produzioneHelpers'
import {
  Badge, Button, Checkbox, Field, HotelTag, Input, Loading, Messaggio, Modal, NavMese, Paginazione,
  SegmentedControl, Select, Table, Td, Textarea, Th,
} from '../components/ui'
import { colors } from '../styles/tokens.js'

const VUOTO = colors.borderStrong

// ── CameraCell (usato nella lista documenti) ──────────────────────────────────

function CameraCell({ camera }) {
  const [pos, setPos] = useState(null)
  if (!camera) return <span style={{ color: colors.textSubtle }}>—</span>
  const camere = camera.split(',').map(s => s.trim()).filter(Boolean)
  if (camere.length <= 4) return <span>{camera}</span>

  const apri = (e) => {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 340) })
  }

  return (
    <>
      <span onClick={apri} title={`${camere.length} camere — clicca per vedere tutte`} style={{ cursor: 'pointer' }}>
        {camere.slice(0, 4).join(', ')}
        <span style={{ color: colors.info, fontWeight: 600 }}>{' '}…+{camere.length - 4}</span>
      </span>
      {pos && (
        <>
          <div onClick={() => setPos(null)} style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
          <div className="ui-card" style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000, padding: '10px 14px',
            boxShadow: 'var(--shadow-pop)', maxWidth: 320, maxHeight: 260, overflowY: 'auto',
            fontSize: 'var(--fs-sm)', lineHeight: 1.7, whiteSpace: 'normal',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{camere.length} camere</div>
            <div style={{ wordBreak: 'break-word' }}>{camera}</div>
            <button className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setPos(null)} style={{ marginTop: 6, padding: '2px 6px' }}>
              chiudi ✕
            </button>
          </div>
        </>
      )}
    </>
  )
}

// ── Modal modifica documento ──────────────────────────────────────────────────

function _disaggregaFrontend(totale, imponibile, iva, tassa_soggiorno, categoria) {
  if (categoria !== 'arrangiamenti') return null
  let lordo_arr, lordo_ts
  if (tassa_soggiorno != null) {
    lordo_ts  = Math.round(tassa_soggiorno * 100) / 100
    lordo_arr = Math.round(Math.max(0, totale - lordo_ts) * 100) / 100
  } else if (iva > 0) {
    lordo_arr = Math.round(iva * 11 * 100) / 100
    lordo_ts  = Math.round(Math.max(0, totale - lordo_arr) * 100) / 100
  } else {
    lordo_arr = totale; lordo_ts = 0
  }
  const imp_arr = Math.round(lordo_arr / 1.10 * 100) / 100
  const iva_arr = Math.round((lordo_arr - imp_arr) * 100) / 100
  return { imp_arr, iva_arr, imp_ts: lordo_ts, iva_ts: 0 }
}

function ModalModifica({ doc, tipo, onSalva, onChiudi }) {
  const [form, setForm] = useState({
    totale_lordo:       doc?.totale_lordo ?? '',
    incassato:          doc?.incassato ?? '',
    deposito:           doc?.deposito ?? '',
    sospeso:            doc?.sospeso ?? '',
    imponibile:         doc?.imponibile ?? '',
    iva:                doc?.iva ?? '',
    categoria:          doc?.categoria ?? '',
    annullato:          doc?.annullato ?? false,
    note:               doc?.note ?? '',
    ospiti:             doc?.ospiti ?? '',
    tipo_pagamento:     doc?.tipo_pagamento ?? '',
    categoria_pagamento: doc?.categoria_pagamento ?? '',
  })
  const [tipiPagamento, setTipiPagamento] = useState([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    api.get('/lookup/tipi-pagamento').then(r => {
      const lista = r.data
      setTipiPagamento(lista)
      // Il campo può contenere testo grezzo dall'Excel (es. "Contante 8,00 € /")
      // o già un codice da edit precedente.
      // Cerca: prima per codice, poi per descrizione esatta, poi per startsWith
      // (lista ordinata per lunghezza desc per evitare match parziali errati).
      if (doc?.tipo_pagamento) {
        const raw = doc.tipo_pagamento.toLowerCase()
        const ordinati = [...lista].sort((a, b) => b.descrizione.length - a.descrizione.length)
        const match = ordinati.find(t =>
          t.codice === doc.tipo_pagamento ||
          t.descrizione.toLowerCase() === raw ||
          raw.startsWith(t.descrizione.toLowerCase() + ' ') ||
          raw.startsWith(t.descrizione.toLowerCase() + '\t')
        )
        if (match) {
          setForm(f => ({
            ...f,
            tipo_pagamento: match.codice,
            categoria_pagamento: match.categoria,
          }))
        }
      }
    }).catch(e => setErr(mostraErrore(e)))
  }, [])

  if (!doc) return null

  // Raggruppa tipi pagamento per categoria
  const categoriePag = [...new Set(tipiPagamento.map(t => t.categoria))]

  const selezionaPagamento = (codice) => {
    const t = tipiPagamento.find(x => x.codice === codice)
    setForm(f => ({
      ...f,
      tipo_pagamento: codice,
      categoria_pagamento: t ? t.categoria : '',
    }))
  }

  // Disaggregazione imponibile (calcolata in tempo reale dai valori del form)
  const disagg = _disaggregaFrontend(
    parseFloat(form.totale_lordo) || 0,
    parseFloat(form.imponibile) || 0,
    parseFloat(form.iva) || 0,
    doc.tassa_soggiorno,
    form.categoria,
  )

  const salva = async () => {
    setSaving(true)
    setErr(null)
    try {
      await api.put(`/corrispettivi/documenti/${doc.id}`, form)
      onSalva()
    } catch (e) {
      setErr(mostraErrore(e, 'Errore salvataggio'))
    } finally {
      setSaving(false)
    }
  }

  const pieno = { width: '100%' }

  return (
    <Modal
      titolo={`Modifica ${tipo === 'fattura' ? 'fattura' : 'scontrino'} ${doc.suffisso} ${doc.numero}`}
      onChiudi={onChiudi}
      larghezza={540}
      footer={<>
        <Button variant="secondary" onClick={onChiudi}>Annulla</Button>
        <Button onClick={salva} disabled={saving}>{saving ? 'Salvataggio…' : 'Salva modifiche'}</Button>
      </>}
    >
      <div style={{ whiteSpace: 'normal', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Griglia campi numerici */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
          {[
            ['totale_lordo', 'Totale lordo'],
            ['incassato',    'Incassato'],
            ['deposito',     'Deposito'],
            ['sospeso',      'Sospeso'],
            ['imponibile',   'Imponibile (totale)'],
            ['iva',          'IVA (totale)'],
          ].map(([k, label]) => (
            <Field key={k} label={label} style={pieno}>
              <Input type="number" step="0.01" value={form[k]} className="ui-num"
                onChange={e => setForm(f => ({ ...f, [k]: parseFloat(e.target.value) || 0 }))}
                style={pieno} />
            </Field>
          ))}
        </div>

        {/* Disaggregazione imponibile (solo categoria arrangiamenti) */}
        {disagg && (
          <div style={{ background: colors.surfaceSoft, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
              Dettaglio IVA
            </div>
            <div className="ui-num" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 12px', fontSize: 'var(--fs-sm)' }}>
              <span />
              <span style={{ color: colors.textMuted, fontWeight: 600 }}>Imponibile</span>
              <span style={{ color: colors.textMuted, fontWeight: 600 }}>IVA</span>

              <span style={{ color: colors.textSecond }}>Soggiorno (10%)</span>
              <span>{formatEuro(disagg.imp_arr)}</span>
              <span>{formatEuro(disagg.iva_arr)}</span>

              <span style={{ color: colors.textSecond }}>Tassa soggiorno (0%)</span>
              <span>{formatEuro(disagg.imp_ts)}</span>
              <span style={{ color: colors.textSubtle, fontStyle: 'italic' }}>esente</span>
            </div>
            {doc.tassa_soggiorno == null && (
              <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-xs)', color: colors.textSubtle, fontStyle: 'italic' }}>
                * Tassa soggiorno calcolata per inferenza (formato base — valore esatto non disponibile)
              </p>
            )}
          </div>
        )}

        <Field label="Categoria" style={pieno}>
          <Select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))} style={pieno}>
            {['arrangiamenti', 'tassa_soggiorno', 'penali', 'shop', 'altro'].map(c => (
              <option key={c} value={c}>{NOME_CAT[c]}</option>
            ))}
          </Select>
        </Field>

        <Field label="Forma di pagamento" style={pieno}>
          <Select value={form.tipo_pagamento} onChange={e => selezionaPagamento(e.target.value)} style={pieno}>
            <option value="">— non specificato —</option>
            {categoriePag.map(cat => (
              <optgroup key={cat} label={cat}>
                {tipiPagamento.filter(t => t.categoria === cat).map(t => (
                  <option key={t.codice} value={t.codice}>{t.descrizione}</option>
                ))}
              </optgroup>
            ))}
          </Select>
          {form.categoria_pagamento && (
            <span className="ui-text-muted" style={{ fontSize: 'var(--fs-xs)' }}>Categoria: {form.categoria_pagamento}</span>
          )}
        </Field>

        <Field label="Note" style={pieno}>
          <Textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={2} style={pieno} />
        </Field>

        <Checkbox checked={form.annullato} onChange={v => setForm(f => ({ ...f, annullato: v }))} label="Annullato" />

        <Messaggio tipo="err">{err}</Messaggio>
      </div>
    </Modal>
  )
}

// ── Vista aggregata Per Hotel (scontrini o fatture) ──────────────────────────

function PerHotelView({ lordo, tipo }) {
  // tipo: 'scontrino' | 'fattura'
  const tipoApi = tipo === 'fattura' ? 'fatture' : 'scontrini'
  // Default: mese precedente (convenzione dell'app, vedi CLAUDE.md "Selettore mese/anno")
  const def = meseAnnoPrecedente()
  const [anno, setAnno] = useState(def.anno)
  const [mese, setMese] = useState(def.mese)
  const [dati, setDati] = useState([])
  const [loading, setLoading] = useState(false)

  const da = primoGiorno(anno, mese)
  const a = ultimoGiorno(anno, mese)

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/corrispettivi/report/giornaliero', { params: { data_da: da, data_a: a, tipo: tipoApi } })
      setDati(r.data)
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [da, a, tipoApi])

  useEffect(() => { carica() }, [carica])

  // Genera giorni del mese
  const giorni = []
  const cur = new Date(da + 'T00:00:00')
  const end = new Date(a + 'T00:00:00')
  while (cur <= end) {
    giorni.push(`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`)
    cur.setDate(cur.getDate() + 1)
  }

  const byData = {}
  dati.forEach(g => { byData[g.data] = g })

  const applyL = (v, aliq = 10) => lordo ? (v || 0) : applyToggle(v, lordo, aliq)
  const fmtL = (v, aliq = 10) => {
    const vv = applyL(v, aliq)
    return vv === 0 ? <span style={{ color: VUOTO }}>—</span> : formatEuro(vv)
  }

  // Totali mese per struttura
  const totMese = {}
  STRUTTURE_HOTEL.forEach(sc => { totMese[sc] = { arr: 0, ts: 0, pen: 0, shop: 0, alt: 0 } })
  giorni.forEach(data => {
    const g = byData[data]
    STRUTTURE_HOTEL.forEach(sc => {
      // usa 'scontrini' o 'fatture' a seconda del tipo
      const blk = g?.strutture?.find(x => x.struttura_code === sc)?.[tipoApi === 'scontrini' ? 'scontrini' : 'fatture']
      if (!blk) return
      totMese[sc].arr  += blk.arrangiamenti || 0
      totMese[sc].ts   += blk.tassa_soggiorno || 0
      totMese[sc].pen  += blk.penali || 0
      totMese[sc].shop += blk.shop || 0
      totMese[sc].alt  += blk.altro || 0
    })
  })

  const CATS = [['arrangiamenti', 10], ['tassa_soggiorno', 0], ['penali', 0], ['shop', 22], ['altro', 10]]
  const CATS_LABEL = ['Arrangiamenti', 'Tassa di Soggiorno', 'Penali', 'Shop', 'Alt.', 'Tot.']
  const titoloTipo = tipoApi === 'scontrini' ? 'Scontrini' : 'Fatture'

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <NavMese anno={anno} mese={mese} onChange={({ anno: y, mese: m }) => { setAnno(y); setMese(m) }} />
        <span className="ui-text-muted" style={{ fontStyle: 'italic' }}>
          {titoloTipo} per hotel — suddivisione per categoria IVA
        </span>
      </div>

      {loading && <Loading />}

      <Table compact minWidth={900}>
        <thead>
          <tr>
            <Th rowSpan={2} style={{ minWidth: 80, verticalAlign: 'bottom' }}>Data</Th>
            {STRUTTURE_HOTEL.map(sc => <Th key={sc} center gruppo colSpan={6}>{sc}</Th>)}
            <Th num tot rowSpan={2} style={{ verticalAlign: 'bottom' }}>TOT. GG</Th>
          </tr>
          <tr className="sub">
            {STRUTTURE_HOTEL.map(sc =>
              CATS_LABEL.map((l, i) => (
                <Th key={`${sc}_${i}`} num gruppo={i === 0} style={i === 5 ? { fontWeight: 700 } : undefined}>{l}</Th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {giorni.map(data => {
            const g = byData[data]
            const gg = giornoSettimana(data)
            const isSab = gg === 'sab'
            let totGG = 0

            return (
              <tr key={data} className={isSab ? 'ui-riga-evidenza' : undefined}>
                <Td style={{ fontWeight: isSab ? 700 : 400, color: colors.textSecond, whiteSpace: 'nowrap' }}>
                  {fmtD(data)} <span style={{ color: colors.textSubtle, fontSize: 'var(--fs-xs)' }}>{gg}</span>
                </Td>
                {STRUTTURE_HOTEL.map(sc => {
                  const blk = g?.strutture?.find(x => x.struttura_code === sc)?.[tipoApi === 'scontrini' ? 'scontrini' : 'fatture']
                  const get = (cat) => blk?.[cat] || 0
                  const totBlk = CATS.reduce((s, [cat, aliq]) => s + applyL(get(cat), aliq), 0)
                  totGG += totBlk
                  return CATS.map(([cat, aliq], i) => (
                    <Td key={`${sc}_${cat}`} num gruppo={i === 0}>{fmtL(get(cat), aliq)}</Td>
                  )).concat(
                    <Td key={`${sc}_tot`} num style={{ fontWeight: 700, color: totBlk === 0 ? VUOTO : undefined }}>
                      {totBlk === 0 ? '—' : formatEuro(totBlk)}
                    </Td>
                  )
                })}
                <Td num tot style={{ fontWeight: 700, color: totGG === 0 ? VUOTO : undefined }}>
                  {totGG === 0 ? '—' : formatEuro(totGG)}
                </Td>
              </tr>
            )
          })}
          {/* Riga totale mese */}
          <tr className="ui-riga-totale">
            <Td>TOTALE</Td>
            {STRUTTURE_HOTEL.map(sc => {
              const t = totMese[sc]
              const totTot = applyL(t.arr,10) + t.ts + t.pen + applyL(t.shop,22) + applyL(t.alt,10)
              return [
                [t.arr,10],[t.ts,0],[t.pen,0],[t.shop,22],[t.alt,10]
              ].map(([v,aliq], i) => (
                <Td key={`tot_${sc}_${i}`} num gruppo={i === 0}>
                  {applyL(v,aliq) === 0 ? '—' : formatEuro(applyL(v,aliq))}
                </Td>
              )).concat(
                <Td key={`tot_${sc}_t`} num style={{ fontWeight: 800 }}>{totTot === 0 ? '—' : formatEuro(totTot)}</Td>
              )
            })}
            <Td num tot style={{ fontWeight: 800 }}>
              {(() => {
                const tot = STRUTTURE_HOTEL.reduce((s, sc) => {
                  const t = totMese[sc]
                  return s + applyL(t.arr,10) + t.ts + t.pen + applyL(t.shop,22) + applyL(t.alt,10)
                }, 0)
                return tot === 0 ? '—' : formatEuro(tot)
              })()}
            </Td>
          </tr>
        </tbody>
      </Table>
    </div>
  )
}

export default function TabDocumenti({ endpoint, tipo, lordo, refreshKey }) {
  const lsKeyVista = tipo === 'fattura' ? 'fatture_vista' : 'scontrini_vista'
  const [vista, setVista] = useState(() => localStorage.getItem(lsKeyVista) || 'lista')
  const [filtri, setFiltri] = useState({ data_da: '', data_a: '', struttura_code: '', categoria: '', annullato: '', numero: '', camera: '' })
  const [docs, setDocs] = useState([])
  const [totale, setTotale] = useState(0)
  const [totaleImporto, setTotaleImporto] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  const [docMod, setDocMod] = useState(null)

  const PER_PAGE = 50

  const carica = useCallback(async () => {
    setLoading(true)
    setErrore(null)
    try {
      const params = { page, per_page: PER_PAGE, ...filtri }
      Object.keys(params).forEach(k => !params[k] && params[k] !== 0 && delete params[k])
      const { data } = await api.get(endpoint, { params })
      setDocs(data.documenti || [])
      setTotale(data.totale || 0)
      setTotaleImporto(data.totale_importo ?? null)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore caricamento'))
    } finally {
      setLoading(false)
    }
  }, [endpoint, page, filtri, refreshKey])

  useEffect(() => { carica() }, [carica])

  const setFiltro = (k, v) => { setFiltri(f => ({ ...f, [k]: v })); setPage(1) }
  const cambiaVista = (v) => { setVista(v); localStorage.setItem(lsKeyVista, v) }

  return (
    <div>
      {/* Toggle vista Lista / Per hotel (scontrini e fatture) */}
      <div style={{ marginBottom: 16 }}>
        <SegmentedControl value={vista} onChange={cambiaVista}
          options={[{ value: 'lista', label: 'Lista documenti' }, { value: 'per_hotel', label: 'Per hotel' }]} />
      </div>

      {vista === 'per_hotel' && <PerHotelView lordo={lordo} tipo={tipo} />}

      {vista === 'lista' && (
      <>
      {/* Filtri */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
        <Field label="Dal"><Input type="date" value={filtri.data_da} onChange={e => setFiltro('data_da', e.target.value)} /></Field>
        <Field label="Al"><Input type="date" value={filtri.data_a} onChange={e => setFiltro('data_a', e.target.value)} /></Field>
        <Field label="Struttura">
          <Select value={filtri.struttura_code} onChange={e => setFiltro('struttura_code', e.target.value)}>
            <option value="">Tutte</option>
            {STRUTTURE_HOTEL.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Categoria">
          <Select value={filtri.categoria} onChange={e => setFiltro('categoria', e.target.value)}>
            <option value="">Tutte</option>
            {['arrangiamenti', 'tassa_soggiorno', 'penali', 'shop', 'altro'].map(c => (
              <option key={c} value={c}>{NOME_CAT[c]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Stato">
          <Select value={filtri.annullato} onChange={e => setFiltro('annullato', e.target.value)}>
            <option value="">Tutti</option>
            <option value="false">Validi</option>
            <option value="true">Annullati</option>
          </Select>
        </Field>
        <Field label="N. documento">
          <Input value={filtri.numero} onChange={e => setFiltro('numero', e.target.value)} placeholder="es. 1042" style={{ width: 100 }} />
        </Field>
        <Field label="N. camera">
          <Input value={filtri.camera} onChange={e => setFiltro('camera', e.target.value)} placeholder="es. 312" style={{ width: 90 }} />
        </Field>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <span className="ui-text-muted">{loading ? 'Caricamento…' : `${totale} documenti trovati`}</span>
        {!loading && totaleImporto !== null && (
          <Badge tono="ok" style={{ fontSize: 'var(--fs-sm)', padding: '3px 10px' }}>Totale filtrato: {formatEuro(totaleImporto)}</Badge>
        )}
      </div>
      <Messaggio tipo="err">{errore}</Messaggio>

      {!loading && docs.length > 0 && (
        <Table compact>
          <thead>
            <tr>
              <Th>Data</Th><Th num>N.</Th><Th>Suff.</Th><Th>Struttura</Th><Th>Camera</Th><Th>Categoria</Th>
              <Th num>Totale</Th><Th num>Imponibile</Th><Th num>IVA</Th><Th center>Ann.</Th><Th center>Mod.</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {docs.map(d => (
              <tr key={d.id} className={[d.annullato && 'ui-riga-annullata', d.modificato_manualmente && 'ui-riga-modificata'].filter(Boolean).join(' ') || undefined}>
                <Td style={{ color: colors.textSecond, whiteSpace: 'nowrap' }}>{fmtD(d.data_documento)}</Td>
                <Td num>{d.numero}</Td>
                <Td muted>{d.suffisso}</Td>
                <Td><HotelTag code={d.struttura_code} /></Td>
                <Td style={{ color: colors.textMuted }}><CameraCell camera={d.camera} /></Td>
                <Td><Badge>{NOME_CAT[d.categoria] || d.categoria || '—'}</Badge></Td>
                <Td num style={{ color: d.totale_lordo < 0 ? colors.danger : undefined, fontWeight: 600 }}>
                  {formatEuro(d.totale_lordo || 0)}
                </Td>
                <Td num>{formatEuro(d.imponibile || 0)}</Td>
                <Td num style={{ color: colors.textMuted }}>
                  {d.iva > 0 ? formatEuro(d.iva) : <span style={{ color: VUOTO }}>—</span>}
                </Td>
                <Td center style={{ color: colors.danger }}>{d.annullato ? '✗' : ''}</Td>
                <Td center>{d.modificato_manualmente ? <span title="Modificato manualmente">✏️</span> : ''}</Td>
                <Td center>
                  {isAdmin() && <Button variant="secondary" size="sm" onClick={() => setDocMod(d)}>Modifica</Button>}
                </Td>
              </tr>
            ))}
            <tr className="ui-riga-sezione">
              <Td colSpan={6} style={{ textAlign: 'right', fontSize: 'var(--fs-sm)' }}>Totale pagina ({docs.length} doc.):</Td>
              <Td num>{formatEuro(docs.reduce((s, d) => s + (d.totale_lordo || 0), 0))}</Td>
              <Td num>{formatEuro(docs.reduce((s, d) => s + (d.imponibile || 0), 0))}</Td>
              <Td num>{formatEuro(docs.reduce((s, d) => s + (d.iva || 0), 0))}</Td>
              <Td colSpan={3} />
            </tr>
          </tbody>
        </Table>
      )}

      {totale > PER_PAGE && (
        <Paginazione pagina={page} perPagina={PER_PAGE} totale={totale} onChange={setPage} estremi />
      )}

      {/* Modal modifica */}
      {docMod && (
        <ModalModifica
          doc={docMod}
          tipo={tipo}
          onSalva={() => { setDocMod(null); carica() }}
          onChiudi={() => setDocMod(null)}
        />
      )}
      </>
      )}
    </div>
  )
}
