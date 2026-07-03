import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { formatEuro, mostraErrore } from '../utils/format'
import {
  STRUTTURE_HOTEL, NOME_CAT, thSt, tdSt, inpSt,
  isAdmin, fmtD, meseNome, primoGiorno, ultimoGiorno, giornoSettimana, applyToggle,
} from '../utils/corrispettiviHelpers'

// ── CameraCell (usato nella lista documenti) ──────────────────────────────────

function CameraCell({ camera }) {
  const [pos, setPos] = useState(null)
  if (!camera) return <span style={{ color: '#94a3b8' }}>—</span>
  const camere = camera.split(',').map(s => s.trim()).filter(Boolean)
  if (camere.length <= 4) return <span>{camera}</span>

  const apri = (e) => {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 340) })
  }

  return (
    <>
      <span onClick={apri} title={`${camere.length} camere — clicca per vedere tutte`}
        style={{ cursor: 'pointer', color: '#334155' }}>
        {camere.slice(0, 4).join(', ')}
        <span style={{ color: '#2563eb', fontWeight: 600 }}>{' '}…+{camere.length - 4}</span>
      </span>
      {pos && (
        <>
          <div onClick={() => setPos(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
          <div style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000,
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
            padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.13)',
            maxWidth: 320, maxHeight: 260, overflowY: 'auto',
            fontSize: '0.82rem', color: '#334155', lineHeight: 1.7,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: '#1e293b', fontSize: '0.85rem' }}>
              {camere.length} camere
            </div>
            <div style={{ wordBreak: 'break-word' }}>{camera}</div>
            <button onClick={() => setPos(null)}
              style={{ marginTop: 8, fontSize: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}>
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

  const lblSt = { fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 3 }
  const secSt = { marginTop: '0.75rem' }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onChiudi() }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: '1.5rem', width: 520, maxWidth: '95vw',
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#1e293b' }}>
          Modifica {tipo === 'fattura' ? 'fattura' : 'scontrino'} {doc.suffisso} {doc.numero}
        </h3>

        {/* Griglia campi numerici */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem 1rem' }}>
          {[
            ['totale_lordo', 'Totale lordo'],
            ['incassato',    'Incassato'],
            ['deposito',     'Deposito'],
            ['sospeso',      'Sospeso'],
            ['imponibile',   'Imponibile (totale)'],
            ['iva',          'IVA (totale)'],
          ].map(([k, label]) => (
            <label key={k}>
              <span style={lblSt}>{label}</span>
              <input type="number" step="0.01" value={form[k]}
                onChange={e => setForm(f => ({ ...f, [k]: parseFloat(e.target.value) || 0 }))}
                style={{ ...inpSt, width: '100%', boxSizing: 'border-box' }} />
            </label>
          ))}
        </div>

        {/* Disaggregazione imponibile (solo categoria arrangiamenti) */}
        {disagg && (
          <div style={{ marginTop: '0.75rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.6rem 0.9rem' }}>
            <p style={{ margin: '0 0 0.4rem', fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Dettaglio IVA
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.25rem 0.75rem', fontSize: '0.8rem' }}>
              <span style={{ color: '#94a3b8' }}></span>
              <span style={{ color: '#64748b', fontWeight: 600 }}>Imponibile</span>
              <span style={{ color: '#64748b', fontWeight: 600 }}>IVA</span>

              <span style={{ color: '#475569' }}>Soggiorno (10%)</span>
              <span style={{ color: '#1e293b' }}>{formatEuro(disagg.imp_arr)}</span>
              <span style={{ color: '#1e293b' }}>{formatEuro(disagg.iva_arr)}</span>

              <span style={{ color: '#475569' }}>Tassa soggiorno (0%)</span>
              <span style={{ color: '#1e293b' }}>{formatEuro(disagg.imp_ts)}</span>
              <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>esente</span>
            </div>
            {doc.tassa_soggiorno == null && (
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.72rem', color: '#94a3b8', fontStyle: 'italic' }}>
                * Tassa soggiorno calcolata per inferenza (formato base — valore esatto non disponibile)
              </p>
            )}
          </div>
        )}

        {/* Categoria */}
        <div style={secSt}>
          <label style={lblSt}>Categoria</label>
          <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
            style={{ ...inpSt, width: '100%' }}>
            {['arrangiamenti', 'tassa_soggiorno', 'penali', 'shop', 'altro'].map(c => (
              <option key={c} value={c}>{NOME_CAT[c]}</option>
            ))}
          </select>
        </div>

        {/* Forma di pagamento */}
        <div style={secSt}>
          <label style={lblSt}>Forma di pagamento</label>
          <select value={form.tipo_pagamento} onChange={e => selezionaPagamento(e.target.value)}
            style={{ ...inpSt, width: '100%' }}>
            <option value="">— non specificato —</option>
            {categoriePag.map(cat => (
              <optgroup key={cat} label={cat}>
                {tipiPagamento.filter(t => t.categoria === cat).map(t => (
                  <option key={t.codice} value={t.codice}>{t.descrizione}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {form.categoria_pagamento && (
            <span style={{ fontSize: '0.73rem', color: '#94a3b8', marginTop: 3, display: 'block' }}>
              Categoria: {form.categoria_pagamento}
            </span>
          )}
        </div>

        {/* Note */}
        <div style={secSt}>
          <label style={lblSt}>Note</label>
          <textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            rows={2} style={{ ...inpSt, width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: '0.75rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.annullato} onChange={e => setForm(f => ({ ...f, annullato: e.target.checked }))} />
          <span style={{ fontSize: '0.85rem' }}>Annullato</span>
        </label>

        {err && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginTop: '0.5rem' }}>{err}</p>}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
          <button onClick={onChiudi} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9', border: '1px solid #e2e8f0' }}>Annulla</button>
          <button onClick={salva} disabled={saving}
            style={{ ...inpSt, cursor: 'pointer', background: '#1e3a5f', color: '#fff', border: 'none', fontWeight: 600 }}>
            {saving ? 'Salvataggio…' : 'Salva modifiche'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Vista aggregata Per Hotel (scontrini o fatture) ──────────────────────────

function PerHotelView({ lordo, tipo }) {
  // tipo: 'scontrino' | 'fattura'
  const tipoApi = tipo === 'fattura' ? 'fatture' : 'scontrini'
  const oggi = new Date()
  const [anno, setAnno] = useState(oggi.getFullYear())
  const [mese, setMese] = useState(oggi.getMonth() + 1)
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

  const navMese = (delta) => {
    let m = mese + delta, y = anno
    if (m > 12) { m = 1; y++ }
    if (m < 1) { m = 12; y-- }
    setMese(m); setAnno(y)
  }

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
    return vv === 0 ? <span style={{ color: '#e2e8f0' }}>—</span> : formatEuro(vv)
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
      {/* Navigazione mese */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
        <button onClick={() => navMese(-1)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9', border: '1px solid #e2e8f0' }}>←</button>
        <span style={{ fontWeight: 700, fontSize: '1rem', minWidth: 120, textAlign: 'center' }}>{meseNome(mese)} {anno}</span>
        <button onClick={() => navMese(1)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9', border: '1px solid #e2e8f0' }}>→</button>
        <span style={{ fontSize: '0.82rem', color: '#64748b', fontStyle: 'italic' }}>
          {titoloTipo} per hotel — suddivisione per categoria IVA
        </span>
      </div>

      {loading && <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Caricamento…</p>}

      <div style={{ overflowX: 'auto', fontSize: '0.78rem' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: '#1e3a5f', color: '#fff' }}>
              <th style={{ ...thSt, textAlign: 'left', minWidth: 70 }} rowSpan={2}>Data</th>
              {STRUTTURE_HOTEL.map(sc => (
                <th key={sc} style={{ ...thSt, textAlign: 'center', borderLeft: '2px solid #334e78' }} colSpan={6}>{sc}</th>
              ))}
              <th style={{ ...thSt, borderLeft: '2px solid #334e78' }} rowSpan={2}>TOT. GG</th>
            </tr>
            <tr style={{ background: '#2d4f7c', color: '#cbd5e1' }}>
              {STRUTTURE_HOTEL.map(sc =>
                CATS_LABEL.map((l, i) => (
                  <th key={`${sc}_${i}`} style={{
                    ...thSt, color: '#cbd5e1', fontSize: '0.7rem',
                    borderLeft: i === 0 ? '3px solid #4a6fa5' : '1px solid #3d6a9a',
                    fontWeight: i === 5 ? 700 : 400,
                  }}>{l}</th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {giorni.map((data, idx) => {
              const g = byData[data]
              const gg = giornoSettimana(data)
              const isSab = gg === 'sab'
              let totGG = 0

              return (
                <tr key={data} style={{ background: isSab ? '#eff6ff' : idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                  <td style={{ ...tdSt, textAlign: 'left', fontWeight: isSab ? 700 : 400, color: '#475569' }}>
                    {fmtD(data)} <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>{gg}</span>
                  </td>
                  {STRUTTURE_HOTEL.map(sc => {
                    const blk = g?.strutture?.find(x => x.struttura_code === sc)?.[tipoApi === 'scontrini' ? 'scontrini' : 'fatture']
                    const get = (cat) => blk?.[cat] || 0
                    const totBlk = CATS.reduce((s, [cat, aliq]) => s + applyL(get(cat), aliq), 0)
                    totGG += totBlk
                    return CATS.map(([cat, aliq], i) => {
                      const v = get(cat)
                      return (
                        <td key={`${sc}_${cat}`} style={{
                          ...tdSt,
                          color: v === 0 ? '#e2e8f0' : '#1e293b',
                          borderLeft: i === 0 ? '2px solid #e2e8f0' : undefined,
                        }}>
                          {fmtL(v, aliq)}
                        </td>
                      )
                    }).concat(
                      <td key={`${sc}_tot`} style={{ ...tdSt, fontWeight: 700, color: totBlk === 0 ? '#e2e8f0' : '#1e293b' }}>
                        {totBlk === 0 ? '—' : formatEuro(totBlk)}
                      </td>
                    )
                  })}
                  <td style={{ ...tdSt, fontWeight: 700, borderLeft: '2px solid #e2e8f0', color: totGG === 0 ? '#e2e8f0' : '#1e293b' }}>
                    {totGG === 0 ? '—' : formatEuro(totGG)}
                  </td>
                </tr>
              )
            })}
            {/* Riga totale mese */}
            <tr className="riga-totale" style={{ background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>
              <td style={{ ...tdSt, color: '#fff', borderBottom: 'none', textAlign: 'left' }}>TOTALE</td>
              {STRUTTURE_HOTEL.map(sc => {
                const t = totMese[sc]
                const totTot = applyL(t.arr,10) + t.ts + t.pen + applyL(t.shop,22) + applyL(t.alt,10)
                return [
                  [t.arr,10],[t.ts,0],[t.pen,0],[t.shop,22],[t.alt,10]
                ].map(([v,aliq], i) => (
                  <td key={`tot_${sc}_${i}`} style={{
                    ...tdSt, color: '#fff', borderBottom: 'none',
                    borderLeft: i === 0 ? '3px solid #4a6fa5' : '1px solid #3d6a9a',
                  }}>
                    {applyL(v,aliq) === 0 ? '—' : formatEuro(applyL(v,aliq))}
                  </td>
                )).concat(
                  <td key={`tot_${sc}_t`} style={{ ...tdSt, color: '#fff', fontWeight: 800, borderBottom: 'none' }}>
                    {totTot === 0 ? '—' : formatEuro(totTot)}
                  </td>
                )
              })}
              <td style={{ ...tdSt, color: '#fff', fontWeight: 800, borderBottom: 'none', borderLeft: '2px solid #334e78' }}>
                {(() => {
                  const tot = STRUTTURE_HOTEL.reduce((s, sc) => {
                    const t = totMese[sc]
                    return s + applyL(t.arr,10) + t.ts + t.pen + applyL(t.shop,22) + applyL(t.alt,10)
                  }, 0)
                  return tot === 0 ? '—' : formatEuro(tot)
                })()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
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

  const totPages = Math.ceil(totale / PER_PAGE)

  const applyL = (v, aliq = 10) => lordo ? (v || 0) : applyToggle(v, lordo, aliq)

  return (
    <div>
      {/* Toggle vista Lista / Per hotel (scontrini e fatture) */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1rem' }}>
        {[['lista', 'Lista documenti'], ['per_hotel', 'Per hotel']].map(([v, l]) => (
          <button key={v} onClick={() => { setVista(v); localStorage.setItem(lsKeyVista, v) }} style={{
            padding: '5px 14px', borderRadius: 6, border: '1px solid', fontSize: '0.82rem',
            cursor: 'pointer', fontWeight: vista === v ? 700 : 400,
            background: vista === v ? '#1e3a5f' : '#f8fafc',
            color: vista === v ? '#fff' : '#64748b',
            borderColor: vista === v ? '#1e3a5f' : '#e2e8f0',
          }}>{l}</button>
        ))}
      </div>

      {vista === 'per_hotel' && <PerHotelView lordo={lordo} tipo={tipo} />}

      {vista === 'lista' && (
      <>
      {/* Filtri */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem', alignItems: 'flex-end' }}>
        {[['data_da', 'Dal', 'date'], ['data_a', 'Al', 'date']].map(([k, l, t]) => (
          <label key={k}>
            <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 3 }}>{l}</span>
            <input type={t} value={filtri[k]} onChange={e => { setFiltri(f => ({ ...f, [k]: e.target.value })); setPage(1) }}
              style={inpSt} />
          </label>
        ))}
        <label>
          <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 3 }}>Struttura</span>
          <select value={filtri.struttura_code} onChange={e => { setFiltri(f => ({ ...f, struttura_code: e.target.value })); setPage(1) }}
            style={inpSt}>
            <option value="">Tutte</option>
            {STRUTTURE_HOTEL.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 3 }}>Categoria</span>
          <select value={filtri.categoria} onChange={e => { setFiltri(f => ({ ...f, categoria: e.target.value })); setPage(1) }}
            style={inpSt}>
            <option value="">Tutte</option>
            {['arrangiamenti', 'tassa_soggiorno', 'penali', 'shop', 'altro'].map(c => (
              <option key={c} value={c}>{NOME_CAT[c]}</option>
            ))}
          </select>
        </label>
        <label>
          <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 3 }}>Stato</span>
          <select value={filtri.annullato} onChange={e => { setFiltri(f => ({ ...f, annullato: e.target.value })); setPage(1) }}
            style={inpSt}>
            <option value="">Tutti</option>
            <option value="false">Validi</option>
            <option value="true">Annullati</option>
          </select>
        </label>
        <label>
          <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 3 }}>N. documento</span>
          <input value={filtri.numero} onChange={e => { setFiltri(f => ({ ...f, numero: e.target.value })); setPage(1) }}
            placeholder="es. 1042" style={{ ...inpSt, width: 90 }} />
        </label>
        <label>
          <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 3 }}>N. camera</span>
          <input value={filtri.camera} onChange={e => { setFiltri(f => ({ ...f, camera: e.target.value })); setPage(1) }}
            placeholder="es. 312" style={{ ...inpSt, width: 80 }} />
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.82rem', color: '#64748b', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <span>{loading ? 'Caricamento…' : `${totale} documenti trovati`}</span>
        {!loading && totaleImporto !== null && (
          <span style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 5, padding: '2px 10px', color: '#166534', fontWeight: 700, fontSize: '0.82rem' }}>
            Totale filtrato: {formatEuro(totaleImporto)}
          </span>
        )}
      </div>
      {errore && <p style={{ color: '#ef4444', fontSize: '0.85rem' }}>{errore}</p>}

      {!loading && docs.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: '#1e3a5f', color: '#fff' }}>
                {['Data', 'N.', 'Suff.', 'Struttura', 'Camera', 'Categoria', 'Totale', 'Imponibile', 'IVA', 'Ann.', 'Mod.', ''].map(h => (
                  <th key={h} style={{ ...thSt, color: '#fff', ...(h === 'Camera' ? { textAlign: 'left' } : {}) }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map((d, idx) => (
                <tr key={d.id} style={{
                  background: d.annullato ? '#fef9f9' : idx % 2 === 0 ? '#fff' : '#f8fafc',
                  opacity: d.annullato ? 0.65 : 1,
                  borderLeft: d.modificato_manualmente ? '3px solid #f59e0b' : undefined,
                }}>
                  <td style={{ ...tdSt, color: '#475569' }}>{fmtD(d.data_documento)}</td>
                  <td style={tdSt}>{d.numero}</td>
                  <td style={{ ...tdSt, color: '#94a3b8' }}>{d.suffisso}</td>
                  <td style={{ ...tdSt, fontWeight: 600 }}>{d.struttura_code}</td>
                  <td style={{ ...tdSt, color: '#64748b', textAlign: 'left' }}><CameraCell camera={d.camera} /></td>
                  <td style={tdSt}>
                    <span style={{ background: '#f1f5f9', borderRadius: 3, padding: '1px 5px', fontSize: '0.72rem' }}>
                      {NOME_CAT[d.categoria] || d.categoria || '—'}
                    </span>
                  </td>
                  <td style={{ ...tdSt, color: d.totale_lordo < 0 ? '#ef4444' : '#1e293b', fontWeight: 600 }}>
                    {formatEuro(d.totale_lordo || 0)}
                  </td>
                  <td style={tdSt}>{formatEuro(d.imponibile || 0)}</td>
                  <td style={{ ...tdSt, color: '#64748b' }}>
                    {d.iva > 0 ? formatEuro(d.iva) : <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>
                  <td style={{ ...tdSt, textAlign: 'center', color: d.annullato ? '#ef4444' : '#94a3b8' }}>
                    {d.annullato ? '✗' : ''}
                  </td>
                  <td style={{ ...tdSt, textAlign: 'center' }}>
                    {d.modificato_manualmente ? <span title="Modificato manualmente">✏️</span> : ''}
                  </td>
                  <td style={tdSt}>
                    {isAdmin() && (
                      <button onClick={() => setDocMod(d)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: '0.78rem' }}>
                        Modifica
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              <tr style={{ background: '#f1f5f9', borderTop: '2px solid #cbd5e1' }}>
                <td colSpan={6} style={{ ...tdSt, textAlign: 'right', color: '#475569', fontWeight: 600, fontSize: '0.75rem' }}>
                  Totale pagina ({docs.length} doc.):
                </td>
                <td style={{ ...tdSt, fontWeight: 700, color: '#1e293b' }}>
                  {formatEuro(docs.reduce((s, d) => s + (d.totale_lordo || 0), 0))}
                </td>
                <td style={{ ...tdSt, fontWeight: 600, color: '#475569' }}>
                  {formatEuro(docs.reduce((s, d) => s + (d.imponibile || 0), 0))}
                </td>
                <td style={{ ...tdSt, fontWeight: 600, color: '#475569' }}>
                  {formatEuro(docs.reduce((s, d) => s + (d.iva || 0), 0))}
                </td>
                <td colSpan={3} />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Paginazione */}
      {totPages > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setPage(1)} disabled={page === 1} style={{ ...inpSt, cursor: 'pointer' }}>«</button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ ...inpSt, cursor: 'pointer' }}>‹</button>
          <span style={{ fontSize: '0.82rem', color: '#64748b' }}>Pag. {page} / {totPages}</span>
          <button onClick={() => setPage(p => Math.min(totPages, p + 1))} disabled={page === totPages} style={{ ...inpSt, cursor: 'pointer' }}>›</button>
          <button onClick={() => setPage(totPages)} disabled={page === totPages} style={{ ...inpSt, cursor: 'pointer' }}>»</button>
        </div>
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
