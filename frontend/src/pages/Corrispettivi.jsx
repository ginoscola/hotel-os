import { useState, useEffect, useCallback, useRef } from 'react'
import TabAnalisiRicavi from './TabAnalisiRicavi'
import TabStampanteRT from './TabStampanteRT'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  Legend, ResponsiveContainer, Cell,
} from 'recharts'
import api from '../api/client'
import { formatEuro, mostraErrore } from '../utils/format'

// ── Costanti ──────────────────────────────────────────────────────────────────

const STRUTTURE_HOTEL = ['DPH', 'CLB', 'INT']
const STRUTTURE_MANUALI = ['MMS', 'BON']
const STRUTTURE_ORDINE = [...STRUTTURE_HOTEL, ...STRUTTURE_MANUALI]

const NOMI = {
  DPH: 'Hotel Du Parc', CLB: 'Club Hotel', INT: 'Hotel International',
  MMS: 'Maremosso', BON: 'Buona Onda',
}

const CATEGORIE_SC = ['arrangiamenti', 'tassa_soggiorno', 'penali', 'shop']
const LABEL_CAT = {
  arrangiamenti: 'Arrangiamenti', tassa_soggiorno: 'Tassa di Soggiorno', penali: 'Penali', shop: 'Shop',
}
const NOME_CAT = {
  arrangiamenti: 'Arrangiamenti (10%)', tassa_soggiorno: 'Tassa Soggiorno (0%)',
  penali: 'Penali (0%)', shop: 'Shop (22%)', altro: 'Altro',
}
const ALIQUOTA_CAT = { arrangiamenti: 10, tassa_soggiorno: 0, penali: 0, shop: 22, altro: 0 }

// ── Stili base ────────────────────────────────────────────────────────────────

const thSt = {
  padding: '6px 8px', fontWeight: 600, fontSize: '0.75rem',
  whiteSpace: 'nowrap', textAlign: 'right',
}
const tdSt = {
  padding: '5px 8px', fontSize: '0.8rem', borderBottom: '1px solid #f1f5f9',
  whiteSpace: 'nowrap', textAlign: 'right',
}
const inpSt = {
  padding: '5px 8px', border: '1px solid #e2e8f0',
  borderRadius: 5, fontSize: '0.85rem', color: '#1e293b',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAdmin() {
  try { return JSON.parse(localStorage.getItem('auth_user') || '{}').ruolo === 'admin' } catch { return false }
}

function fmtD(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function meseNome(m) {
  return ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'][m]
}

function primoGiorno(anno, mese) {
  return `${anno}-${String(mese).padStart(2, '0')}-01`
}
function ultimoGiorno(anno, mese) {
  const d = new Date(anno, mese, 0)
  return `${anno}-${String(mese).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function giornoSettimana(iso) {
  const gg = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
  const d = new Date(iso + 'T00:00:00')
  return gg[d.getDay()]
}

// Applica toggle IVA: se !lordo divide per (1 + aliquota/100)
function applyToggle(val, lordo, aliquota = 10) {
  const v = val || 0
  if (lordo || aliquota === 0) return v
  return v / (1 + aliquota / 100)
}

function fmtToggle(val, lordo, aliquota = 10) {
  const v = applyToggle(val, lordo, aliquota)
  return v === 0 ? '—' : formatEuro(v)
}

// ── Componente TabImport ──────────────────────────────────────────────────────

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

function TabImport({ onImportato }) {
  const [trascina, setTrascina] = useState(false)
  const [caricamento, setCaricamento] = useState(false)
  const [esito, setEsito] = useState(null)
  const [isTest, setIsTest] = useState(false)
  const [onConflict, setOnConflict] = useState('salta')
  const [storico, setStorico] = useState([])
  const [loadStor, setLoadStor] = useState(true)
  const inputRef = useRef()

  const caricaStorico = useCallback(async () => {
    try {
      const { data } = await api.get('/corrispettivi/import/storico')
      setStorico(data)
    } catch { /* ignora */ }
    finally { setLoadStor(false) }
  }, [])

  useEffect(() => { caricaStorico() }, [caricaStorico])

  const gestisciFile = async (file) => {
    if (!file) return
    if (!file.name.toLowerCase().match(/\.(xlsx|xls)$/)) {
      setEsito({ ok: false, msg: 'Seleziona un file Excel (.xlsx)' })
      return
    }
    setCaricamento(true)
    setEsito(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const { data } = await api.post(
        `/corrispettivi/import?is_test=${isTest}&on_conflict=${onConflict}`,
        form, { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      const strutStr = data.strutture?.join(', ') || '—'
      const parts = [`${data.n_inseriti} inseriti`]
      if (data.n_aggiornati) parts.push(`${data.n_aggiornati} aggiornati`)
      if (data.n_saltati) parts.push(`${data.n_saltati} saltati (già presenti)`)
      if (data.n_protetti) parts.push(`${data.n_protetti} protetti (modificati manualmente)`)
      if (data.n_esclusi) parts.push(`${data.n_esclusi} esclusi (CP/FD)`)
      setEsito({
        ok: true,
        msg: `Import completato: ${parts.join(', ')}`,
        sub: `Strutture: ${strutStr} · Periodo: ${fmtD(data.periodo?.da)} – ${fmtD(data.periodo?.a)}`,
        warnings: data.warnings,
      })
      caricaStorico()
      onImportato()
    } catch (err) {
      setEsito({ ok: false, msg: err.response?.data?.detail || 'Errore durante il caricamento' })
    } finally {
      setCaricamento(false)
    }
  }

  const eliminaImport = async (id) => {
    if (!window.confirm('Eliminare questa sessione di import?')) return
    try {
      await api.delete(`/corrispettivi/import/${id}?conferma=true`)
      caricaStorico()
      onImportato()
    } catch (err) { alert(err.response?.data?.detail || 'Errore') }
  }

  return (
    <div style={{ maxWidth: 820 }}>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setTrascina(true) }}
        onDragLeave={() => setTrascina(false)}
        onDrop={(e) => { e.preventDefault(); setTrascina(false); gestisciFile(e.dataTransfer.files[0]) }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${trascina ? '#2563eb' : '#94a3b8'}`,
          borderRadius: 12, padding: '2.5rem', textAlign: 'center',
          cursor: 'pointer', background: trascina ? '#eff6ff' : '#f8fafc',
          transition: 'all .15s', marginBottom: '1rem',
        }}
      >
        <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
          onChange={(e) => gestisciFile(e.target.files[0])} />
        {caricamento ? (
          <p style={{ color: '#64748b', margin: 0 }}>Caricamento in corso…</p>
        ) : (
          <>
            <p style={{ fontSize: '2rem', margin: 0 }}>📊</p>
            <p style={{ color: '#475569', margin: '0.5rem 0 0' }}>
              Trascina il file Excel esportato da Welcome PMS
              <br />
              <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                Formato base (18 col.) o formato esteso con Tassa di soggiorno (36 col.) — oppure clicca per selezionare
              </span>
            </p>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />
          <span style={{ fontSize: '0.88rem', color: '#64748b' }}>Segna come dati di test</span>
          {isTest && <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: '0.78rem', fontWeight: 600 }}>TEST</span>}
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff7ed', border: '1.5px solid #fdba74', borderRadius: 8, padding: '5px 10px' }}>
          <span style={{ fontSize: '0.85rem', color: '#9a3412', fontWeight: 600 }}>Se già presente:</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[['salta', 'Salta'], ['aggiorna', 'Aggiorna']].map(([v, l]) => (
              <button key={v} onClick={() => setOnConflict(v)} style={{
                padding: '5px 14px', borderRadius: 6, border: 'none',
                fontSize: '0.85rem', cursor: 'pointer', fontWeight: onConflict === v ? 700 : 400,
                background: onConflict === v ? '#ea580c' : 'transparent',
                color: onConflict === v ? '#fff' : '#9a3412',
              }}>{l}</button>
            ))}
          </div>
          {onConflict === 'aggiorna' && (
            <span style={{ fontSize: '0.75rem', color: '#92400e', background: '#fef3c7', padding: '2px 6px', borderRadius: 3 }}>
              I doc. modificati manualmente non vengono sovrascritti
            </span>
          )}
        </div>
      </div>

      {esito && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.5rem', fontSize: '0.88rem',
          background: esito.ok ? '#dcfce7' : '#fee2e2', color: esito.ok ? '#166534' : '#991b1b',
        }}>
          <strong>{esito.ok ? '✓' : '✗'} {esito.msg}</strong>
          {esito.sub && <p style={{ margin: '0.25rem 0 0', opacity: 0.8 }}>{esito.sub}</p>}
          {esito.warnings?.length > 0 && (
            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.82rem' }}>{esito.warnings.length} avvisi</summary>
              <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
                {esito.warnings.map((w, i) => <li key={i} style={{ fontSize: '0.8rem' }}>{w}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.75rem', color: '#1e293b' }}>Storico import</h3>
      {loadStor ? (
        <p style={{ color: '#94a3b8', fontSize: '0.88rem' }}>Caricamento…</p>
      ) : storico.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: '0.88rem' }}>Nessun import effettuato.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: '#1e3a5f', color: '#fff' }}>
              {['Data import', 'File', 'Periodo', 'Strutture', 'Scontrini', 'Fatture', 'Esclusi', ''].map(h => (
                <th key={h} style={{ ...thSt, textAlign: 'left', color: '#fff' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {storico.map((imp, idx) => (
              <tr key={imp.id} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                <td style={{ ...tdSt, textAlign: 'left', color: '#64748b' }}>
                  {imp.created_at ? new Date(imp.created_at).toLocaleDateString('it-IT') : '—'}
                </td>
                <td style={{ ...tdSt, textAlign: 'left', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {imp.nome_file || '—'}
                </td>
                <td style={{ ...tdSt, textAlign: 'left' }}>{fmtD(imp.data_da)} – {fmtD(imp.data_a)}</td>
                <td style={{ ...tdSt, textAlign: 'left' }}>{(imp.strutture_presenti || []).join(', ') || '—'}</td>
                <td style={tdSt}>{imp.n_scontrini}</td>
                <td style={tdSt}>{imp.n_fatture}</td>
                <td style={{ ...tdSt, color: imp.n_esclusi > 0 ? '#92400e' : '#94a3b8' }}>{imp.n_esclusi}</td>
                <td style={tdSt}>
                  {isAdmin() && (
                    <button onClick={() => eliminaImport(imp.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '0.8rem' }}>
                      Elimina
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Drawer documenti ──────────────────────────────────────────────────────────

function DrawerDocumenti({ info, onClose }) {
  // info: { data, struttura_code, tipo ('scontrini'|'fatture'), categoria }
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!info) return
    setLoading(true)
    const endpoint = info.tipo === 'fatture' ? '/corrispettivi/fatture' : '/corrispettivi/scontrini'
    api.get(endpoint, { params: { data_da: info.data, data_a: info.data, struttura_code: info.struttura_code, per_page: 100 } })
      .then(r => setDocs(r.data.documenti || []))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false))
  }, [info])

  if (!info) return null

  const docsFiltrati = info.categoria
    ? docs.filter(d => d.categoria === info.categoria)
    : docs

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: 480,
      background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
      zIndex: 1000, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong style={{ color: '#1e293b' }}>{info.tipo === 'fatture' ? 'Fatture' : 'Scontrini'} — {NOMI[info.struttura_code]}</strong>
          <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
            {fmtD(info.data)}{info.categoria ? ` · ${NOME_CAT[info.categoria]}` : ''}
          </p>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#94a3b8' }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem' }}>
        {loading ? (
          <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Caricamento…</p>
        ) : docsFiltrati.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Nessun documento per questa selezione.</p>
        ) : docsFiltrati.map(d => (
          <div key={d.id} style={{
            border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.65rem 0.85rem',
            marginBottom: '0.5rem', opacity: d.annullato ? 0.45 : 1,
            borderLeft: d.modificato_manualmente ? '3px solid #f59e0b' : undefined,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.85rem', color: d.annullato ? '#94a3b8' : '#1e293b' }}>
                {d.suffisso} {d.numero}{d.annullato ? ' · ANNULLATO' : ''}{d.modificato_manualmente ? ' ✏️' : ''}
              </span>
              <span style={{ fontWeight: 700, fontSize: '0.88rem', color: d.totale_lordo < 0 ? '#ef4444' : '#1e293b' }}>
                {formatEuro(d.totale_lordo)}
              </span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 3 }}>
              {d.camera && <span>Cam. {d.camera} · </span>}
              {d.intestazione && <span>{d.intestazione.split('\n')[0]} · </span>}
              <span style={{ background: '#f1f5f9', borderRadius: 3, padding: '1px 5px' }}>{NOME_CAT[d.categoria] || d.categoria}</span>
            </div>
            {d.ospiti && (
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>Ospiti: {d.ospiti}</div>
            )}
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>
              Imp. {formatEuro(d.imponibile)} · IVA {formatEuro(d.iva)} ({d.aliquota_pct}%)
            </div>
          </div>
        ))}
      </div>
    </div>
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
    }).catch(() => {})
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

// ── Tab Corrispettivi giornalieri ─────────────────────────────────────────────

function TabGiornalieri({ lordo }) {
  const oggi = new Date()
  const [anno, setAnno] = useState(oggi.getFullYear())
  const [mese, setMese] = useState(oggi.getMonth() + 1)
  const [tipo, setTipo] = useState('tutti')  // 'scontrini' | 'fatture' | 'tutti'
  const [datiGG, setDatiGG] = useState([])
  const [manuali, setManuali] = useState({})     // key: "YYYY-MM-DD_MMS/BON" → lordo
  const [manualiDB, setManualiDB] = useState([]) // array dal DB
  const [manualiEdit, setManualiEdit] = useState({}) // edit in corso
  const [saving, setSaving] = useState({})
  const [check, setCheck] = useState(null)
  const [loading, setLoading] = useState(false)
  const [drawer, setDrawer] = useState(null)  // { data, struttura_code, tipo, categoria }

  const da = primoGiorno(anno, mese)
  const a = ultimoGiorno(anno, mese)

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const [rGG, rMan, rCheck] = await Promise.all([
        api.get('/corrispettivi/report/giornaliero', { params: { data_da: da, data_a: a, tipo } }),
        api.get('/corrispettivi/manuali', { params: { data_da: da, data_a: a } }),
        api.get('/corrispettivi/check', { params: { data_da: da, data_a: a } }),
      ])
      setDatiGG(rGG.data)
      setManualiDB(rMan.data)
      // Mappa manuali per chiave rapida
      const mm = {}
      rMan.data.forEach(m => { mm[`${m.data_giorno}_${m.struttura_code}`] = m.arrangiamenti_lordo })
      setManuali(mm)
      setCheck(rCheck.data)
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [da, a, tipo, lordo])

  useEffect(() => { carica() }, [carica])

  // Genera tutte le date del mese
  const giorni = []
  const cur = new Date(da + 'T00:00:00')
  const end = new Date(a + 'T00:00:00')
  while (cur <= end) {
    const y = cur.getFullYear()
    const m = String(cur.getMonth() + 1).padStart(2, '0')
    const d = String(cur.getDate()).padStart(2, '0')
    giorni.push(`${y}-${m}-${d}`)
    cur.setDate(cur.getDate() + 1)
  }

  // Indice dati per data
  const byData = {}
  datiGG.forEach(g => { byData[g.data] = g })

  const getStruttura = (data, sc) => {
    const g = byData[data]
    if (!g) return null
    return g.strutture?.find(s => s.struttura_code === sc) || null
  }

  const getCat = (struttura, catKey, tipoKey) => {
    if (!struttura) return 0
    return struttura[tipoKey]?.[catKey] || 0
  }

  const getTot = (struttura, tipoKey) => {
    if (!struttura) return 0
    if (tipoKey === 'tutti') return (struttura.scontrini?.totale || 0) + (struttura.fatture?.totale || 0)
    return struttura[tipoKey]?.totale || 0
  }

  // Totali mese per struttura
  const totMese = {}
  STRUTTURE_HOTEL.forEach(sc => {
    totMese[sc] = { arr: 0, ts: 0, pen: 0, shop: 0, alt: 0 }
  })
  STRUTTURE_MANUALI.forEach(sc => { totMese[sc] = { arr: 0 } })
  let totMeseGlobale = 0

  giorni.forEach(data => {
    const g = byData[data]
    STRUTTURE_HOTEL.forEach(sc => {
      const s = g?.strutture?.find(x => x.struttura_code === sc)
      if (!s) return
      const src = tipo === 'fatture' ? [s.fatture] : tipo === 'scontrini' ? [s.scontrini] : [s.scontrini, s.fatture]
      src.forEach(d => {
        if (!d) return
        totMese[sc].arr  += d.arrangiamenti || 0
        totMese[sc].ts   += d.tassa_soggiorno || 0
        totMese[sc].pen  += d.penali || 0
        totMese[sc].shop += d.shop || 0
        totMese[sc].alt  += d.altro || 0
      })
    })
    STRUTTURE_MANUALI.forEach(sc => {
      const lordo_m = parseFloat(manuali[`${data}_${sc}`] || 0)
      totMese[sc].arr += lordo_m
    })
  })
  giorni.forEach(data => { totMeseGlobale += byData[data]?.totale_giorno || 0 })

  // Salva manuale
  const salvaManuale = async (data, sc) => {
    const key = `${data}_${sc}`
    const val = parseFloat(manualiEdit[key] ?? manuali[key] ?? 0)
    setSaving(s => ({ ...s, [key]: true }))
    try {
      await api.post('/corrispettivi/manuali', {
        data_giorno: data, struttura_code: sc, arrangiamenti_lordo: val,
      })
      carica()
    } catch (e) {
      alert(mostraErrore(e, 'Errore salvataggio'))
    } finally {
      setSaving(s => ({ ...s, [key]: false }))
      setManualiEdit(e => { const n = { ...e }; delete n[key]; return n })
    }
  }

  const navMese = (delta) => {
    let m = mese + delta
    let a = anno
    if (m > 12) { m = 1; a++ }
    if (m < 1) { m = 12; a-- }
    setMese(m)
    setAnno(a)
  }

  const applyL = (v, aliq = 10) => lordo ? (v || 0) : applyToggle(v, lordo, aliq)
  const fmtL = (v, aliq = 10) => {
    const vv = applyL(v, aliq)
    return vv === 0 ? <span style={{ color: '#e2e8f0' }}>—</span> : formatEuro(vv)
  }

  const cellStyle = (v) => ({
    ...tdSt,
    color: v < 0 ? '#ef4444' : v === 0 ? '#e2e8f0' : '#1e293b',
    cursor: v !== 0 ? 'pointer' : 'default',
  })

  // Contatore giorni completati (entrambi MMS e BON inseriti con valore > 0)
  const giorniCompletati = giorni.filter(d => manuali[`${d}_MMS`] && manuali[`${d}_BON`]).length

  return (
    <div>
      {/* Navigazione mese */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button onClick={() => navMese(-1)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9', border: '1px solid #e2e8f0' }}>←</button>
        <label title="Clicca per selezionare mese" style={{ cursor: 'pointer', position: 'relative', display: 'inline-block' }}>
          <span style={{ fontWeight: 700, fontSize: '1rem', minWidth: 120, textAlign: 'center', display: 'inline-block', padding: '4px 8px', borderRadius: 6, border: '1px solid transparent', userSelect: 'none' }}
            onMouseEnter={e => e.currentTarget.style.border = '1px solid #e2e8f0'}
            onMouseLeave={e => e.currentTarget.style.border = '1px solid transparent'}>
            {meseNome(mese)} {anno} ▾
          </span>
          <input type="month"
            value={`${anno}-${String(mese).padStart(2, '0')}`}
            onChange={e => {
              const [y, m] = e.target.value.split('-').map(Number)
              if (y && m) { setAnno(y); setMese(m) }
            }}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }} />
        </label>
        <button onClick={() => navMese(1)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9', border: '1px solid #e2e8f0' }}>→</button>

        {/* Toggle tipo */}
        <div style={{ display: 'flex', gap: 4, marginLeft: '0.5rem' }}>
          {[['tutti', 'Tutti'], ['scontrini', 'Scontrini'], ['fatture', 'Fatture']].map(([v, l]) => (
            <button key={v} onClick={() => setTipo(v)} style={{
              padding: '5px 12px', borderRadius: 6, border: '1px solid', fontSize: '0.82rem',
              cursor: 'pointer', fontWeight: tipo === v ? 700 : 400,
              background: tipo === v ? '#1e3a5f' : '#f8fafc',
              color: tipo === v ? '#fff' : '#64748b',
              borderColor: tipo === v ? '#1e3a5f' : '#e2e8f0',
            }}>{l}</button>
          ))}
        </div>
      </div>

      {loading && <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Caricamento…</p>}

      {/* Tabella principale */}
      <div style={{ overflowX: 'auto', fontSize: '0.78rem' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            {/* Riga 1: strutture */}
            <tr style={{ background: '#1e3a5f', color: '#fff' }}>
              <th style={{ ...thSt, textAlign: 'left', minWidth: 70 }} rowSpan={2}>Data</th>
              {STRUTTURE_HOTEL.map(sc => (
                <th key={sc} style={{ ...thSt, textAlign: 'center', borderLeft: '2px solid #334e78' }} colSpan={5}>
                  {sc}
                </th>
              ))}
              <th style={{ ...thSt, textAlign: 'center', borderLeft: '2px solid #334e78' }}>MMS</th>
              <th style={{ ...thSt, textAlign: 'center', borderLeft: '1px solid #334e78' }}>BON</th>
              <th style={{ ...thSt, borderLeft: '2px solid #334e78' }}>TOT. GIORNO</th>
            </tr>
            {/* Riga 2: categorie */}
            <tr style={{ background: '#2d4f7c', color: '#cbd5e1' }}>
              {STRUTTURE_HOTEL.map(sc => (
                ['Arrangiamenti', 'Tassa di Soggiorno', 'Penali', 'Shop/ricariche', 'Tot.'].map((l, i) => (
                  <th key={`${sc}_${i}`} style={{
                    ...thSt, color: '#cbd5e1', fontSize: '0.7rem',
                    borderLeft: i === 0 ? '3px solid #4a6fa5' : '1px solid #3d6a9a',
                    fontWeight: i === 4 ? 700 : 400,
                  }}>{l}</th>
                ))
              ))}
              <th style={{ ...thSt, color: '#cbd5e1', borderLeft: '3px solid #4a6fa5', fontSize: '0.7rem' }}>Chiusura RT</th>
              <th style={{ ...thSt, color: '#cbd5e1', borderLeft: '1px solid #3d6a9a', fontSize: '0.7rem' }}>Chiusura RT</th>
              <th style={{ ...thSt, borderLeft: '3px solid #4a6fa5' }} />
            </tr>
          </thead>
          <tbody>
            {giorni.map((data, idx) => {
              const g = byData[data]
              const gg = giornoSettimana(data)
              const isSab = gg === 'sab'
              const rigaBg = isSab ? '#eff6ff' : idx % 2 === 0 ? '#fff' : '#f8fafc'
              let totGiorno = g?.totale_giorno || 0

              return (
                <tr key={data} style={{ background: rigaBg }}>
                  <td style={{ ...tdSt, textAlign: 'left', fontWeight: isSab ? 700 : 400, color: '#475569' }}>
                    {fmtD(data)} <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>{gg}</span>
                  </td>

                  {STRUTTURE_HOTEL.map(sc => {
                    const s = g?.strutture?.find(x => x.struttura_code === sc)
                    const getCombinato = (cat) => {
                      if (tipo === 'tutti') return (s?.scontrini?.[cat] || 0) + (s?.fatture?.[cat] || 0)
                      return s?.[tipo === 'scontrini' ? 'scontrini' : 'fatture']?.[cat] || 0
                    }
                    // Totale netto: somma per categoria con aliquote corrette (no media singola)
                    const cats4 = [['arrangiamenti', 10], ['tassa_soggiorno', 0], ['penali', 0], ['shop', 22]]
                    const totNetto = cats4.reduce((sum, [cat, aliq]) =>
                      sum + applyToggle(getCombinato(cat), lordo, aliq), 0
                    ) + applyToggle(getCombinato('altro'), lordo, 10)
                    const totS = getTot(s, tipo === 'tutti' ? 'tutti' : tipo === 'fatture' ? 'fatture' : 'scontrini')

                    return cats4.map(([cat, aliq], i) => {
                      const v = getCombinato(cat)
                      return (
                        <td key={`${sc}_${cat}`} style={{
                          ...cellStyle(v),
                          borderLeft: i === 0 ? '3px solid #7baec8' : '1px solid #86a8bf',
                        }}
                          onClick={() => v !== 0 && setDrawer({ data, struttura_code: sc, tipo: tipo === 'tutti' ? 'scontrini' : tipo, categoria: cat })}
                          title={v !== 0 ? 'Clicca per vedere documenti' : undefined}
                        >
                          {fmtL(v, aliq)}
                        </td>
                      )
                    }).concat(
                      <td key={`${sc}_tot`} style={{
                        ...tdSt, fontWeight: 700, borderLeft: '1px solid #86a8bf',
                        color: totNetto < 0 ? '#ef4444' : totNetto === 0 ? '#e2e8f0' : '#1e293b',
                        cursor: totS !== 0 ? 'pointer' : 'default',
                      }}
                        onClick={() => totS !== 0 && setDrawer({ data, struttura_code: sc, tipo: tipo === 'tutti' ? 'scontrini' : tipo })}
                      >
                        {totNetto === 0 ? <span style={{ color: '#e2e8f0' }}>—</span> : formatEuro(totNetto)}
                      </td>
                    )
                  })}

                  {/* MMS */}
                  <td style={{ ...tdSt, borderLeft: '3px solid #7baec8' }}>
                    {(manuali[`${data}_MMS`] || 0) > 0
                      ? fmtL(parseFloat(manuali[`${data}_MMS`] || 0))
                      : <span style={{ color: '#e2e8f0' }}>—</span>}
                  </td>
                  {/* BON */}
                  <td style={{ ...tdSt, borderLeft: '1px solid #86a8bf' }}>
                    {(manuali[`${data}_BON`] || 0) > 0
                      ? fmtL(parseFloat(manuali[`${data}_BON`] || 0))
                      : <span style={{ color: '#e2e8f0' }}>—</span>}
                  </td>
                  {/* Totale giorno */}
                  <td style={{ ...tdSt, fontWeight: 700, borderLeft: '3px solid #7baec8', color: totGiorno === 0 ? '#e2e8f0' : '#1e293b' }}>
                    {totGiorno === 0 ? '—' : formatEuro(totGiorno)}
                  </td>
                </tr>
              )
            })}

            {/* Riga totale mese */}
            <tr className="riga-totale" style={{ background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>
              <td style={{ ...tdSt, color: '#fff', borderBottom: 'none', textAlign: 'left' }}>TOTALE</td>
              {STRUTTURE_HOTEL.map(sc => (
                [
                  [totMese[sc].arr, 10],
                  [totMese[sc].ts, 0],
                  [totMese[sc].pen, 0],
                  [totMese[sc].shop, 22],
                ].map(([v, aliq], i) => (
                  <td key={`tot_${sc}_${i}`} style={{
                    ...tdSt, color: '#fff', borderBottom: 'none',
                    borderLeft: i === 0 ? '3px solid #4a6fa5' : '1px solid #3d6a9a',
                  }}>
                    {applyL(v, aliq) === 0 ? '—' : formatEuro(applyL(v, aliq))}
                  </td>
                )).concat(
                  <td key={`tot_${sc}_t`} style={{ ...tdSt, color: '#fff', fontWeight: 800, borderBottom: 'none' }}>
                    {(() => {
                      const t = applyL(totMese[sc].arr, 10) + totMese[sc].ts + totMese[sc].pen + applyL(totMese[sc].shop, 22) + applyL(totMese[sc].alt, 10)
                      return t === 0 ? '—' : formatEuro(t)
                    })()}
                  </td>
                )
              ))}
              <td style={{ ...tdSt, color: '#fff', borderBottom: 'none', borderLeft: '3px solid #4a6fa5' }}>
                {totMese['MMS'].arr === 0 ? '—' : formatEuro(applyL(totMese['MMS'].arr))}
              </td>
              <td style={{ ...tdSt, color: '#fff', borderBottom: 'none', borderLeft: '1px solid #4a6fa5' }}>
                {totMese['BON'].arr === 0 ? '—' : formatEuro(applyL(totMese['BON'].arr))}
              </td>
              <td style={{ ...tdSt, color: '#fff', fontWeight: 800, borderBottom: 'none', borderLeft: '3px solid #4a6fa5' }}>
                {totMeseGlobale === 0 ? '—' : formatEuro(totMeseGlobale)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Sezione inserimento manuale MMS/BON */}
      {isAdmin() && (
        <div style={{
          marginTop: '1.5rem', border: '1px solid #e2e8f0', borderRadius: 10,
          padding: '1rem 1.25rem', background: '#fafafa',
        }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', color: '#1e293b' }}>
            Inserimento manuale — Maremosso (MMS) e Buona Onda (BON)
          </h3>
          <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 0.75rem' }}>
            Inserire il totale lordo (IVA 10% inclusa). Il sistema calcola automaticamente imponibile e IVA.
          </p>

          <p style={{ fontSize: '0.78rem', color: giorniCompletati === giorni.length ? '#22c55e' : '#64748b', margin: '0 0 0.75rem' }}>
            {giorniCompletati === giorni.length
              ? `✓ Tutti i ${giorni.length} giorni del mese sono stati inseriti.`
              : `${giorniCompletati} / ${giorni.length} giorni inseriti`}
          </p>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                {['Data', 'MMS lordo (€)', '', 'BON lordo (€)', ''].map((h, i) => (
                  <th key={i} style={{ ...thSt, textAlign: i === 0 ? 'left' : 'right', padding: '6px 10px', color: '#475569' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {giorni.map((data) => {
                const keyMMS = `${data}_MMS`
                const keyBON = `${data}_BON`
                const valMMS = manualiEdit[keyMMS] ?? manuali[keyMMS] ?? ''
                const valBON = manualiEdit[keyBON] ?? manuali[keyBON] ?? ''
                const salvMMS = !!manuali[keyMMS]
                const salvBON = !!manuali[keyBON]
                const inpMMS = { ...inpSt, width: 90, textAlign: 'right', border: `2px solid ${salvMMS ? '#16a34a' : '#f59e0b'}` }
                const inpBON = { ...inpSt, width: 90, textAlign: 'right', border: `2px solid ${salvBON ? '#16a34a' : '#f59e0b'}` }
                return (
                  <tr key={data}>
                    <td style={{ ...tdSt, textAlign: 'left' }}>
                      {fmtD(data)} {giornoSettimana(data)}
                    </td>
                    <td style={tdSt}>
                      <input type="number" step="0.01" min="0" value={valMMS}
                        placeholder="0.00"
                        onChange={e => setManualiEdit(v => ({ ...v, [keyMMS]: e.target.value }))}
                        style={inpMMS} />
                    </td>
                    <td style={tdSt}>
                      <button onClick={() => salvaManuale(data, 'MMS')} disabled={saving[keyMMS]}
                        style={{ ...inpSt, cursor: 'pointer', background: '#1e3a5f', color: '#fff', border: 'none', fontSize: '0.78rem', padding: '4px 10px' }}>
                        {saving[keyMMS] ? '…' : 'Salva'}
                      </button>
                    </td>
                    <td style={tdSt}>
                      <input type="number" step="0.01" min="0" value={valBON}
                        placeholder="0.00"
                        onChange={e => setManualiEdit(v => ({ ...v, [keyBON]: e.target.value }))}
                        style={inpBON} />
                    </td>
                    <td style={tdSt}>
                      <button onClick={() => salvaManuale(data, 'BON')} disabled={saving[keyBON]}
                        style={{ ...inpSt, cursor: 'pointer', background: '#1e3a5f', color: '#fff', border: 'none', fontSize: '0.78rem', padding: '4px 10px' }}>
                        {saving[keyBON] ? '…' : 'Salva'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sezione CHECK */}
      {check && (() => {
        const hotelConDati = STRUTTURE_HOTEL.filter(sc => (check[sc] || 0) > 0)
        const tuttiOk = hotelConDati.length === STRUTTURE_HOTEL.length
        const nessunDato = hotelConDati.length === 0
        const semaforo = nessunDato ? { bg: '#fef2f2', border: '#fca5a5', dot: '#ef4444', label: 'Nessun dato hotel' }
          : tuttiOk ? { bg: '#f0fdf4', border: '#86efac', dot: '#16a34a', label: 'Tutte le strutture presenti' }
          : { bg: '#fffbeb', border: '#fcd34d', dot: '#d97706', label: `${hotelConDati.length}/${STRUTTURE_HOTEL.length} hotel con dati` }
        return (
          <div style={{ marginTop: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ flex: 1, minWidth: 280, border: `1.5px solid ${semaforo.border}`, background: semaforo.bg, borderRadius: 10, padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.5rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: semaforo.dot, display: 'inline-block', flexShrink: 0 }} />
                <h4 style={{ margin: 0, fontSize: '0.88rem', color: '#475569' }}>
                  Hotel ({check.label_hotel}) — <span style={{ color: semaforo.dot, fontWeight: 700 }}>{semaforo.label}</span>
                </h4>
              </div>
              {STRUTTURE_HOTEL.map(sc => {
                const v = check[sc] || 0
                const presente = v > 0
                return (
                  <div key={sc} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: '0.85rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#475569' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: presente ? '#16a34a' : '#d1d5db', display: 'inline-block' }} />
                      {sc}
                    </span>
                    <span style={{ fontWeight: 600, color: presente ? '#1e293b' : '#94a3b8' }}>{formatEuro(v)}</span>
                  </div>
                )
              })}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', marginTop: 6, paddingTop: 6, fontWeight: 700 }}>
                <span>TOTALE HOTEL</span>
                <span>{formatEuro(check.totale_hotel || 0)}</span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 200, border: '1.5px solid #fcd34d', borderRadius: 10, padding: '1rem 1.25rem', background: '#fffbeb' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', color: '#b45309' }}>
                Ristoranti ({check.label_ristoranti})
              </h4>
              {STRUTTURE_MANUALI.map(sc => {
                const v = check[sc] || 0
                return (
                  <div key={sc} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: '0.85rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#475569' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: v > 0 ? '#f59e0b' : '#d1d5db', display: 'inline-block' }} />
                      {NOMI[sc]}
                    </span>
                    <span style={{ fontWeight: 600, color: v > 0 ? '#1e293b' : '#94a3b8' }}>{formatEuro(v)}</span>
                  </div>
                )
              })}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #fcd34d', marginTop: 6, paddingTop: 6, fontWeight: 700 }}>
                <span>TOTALE RISTORANTI</span>
                <span>{formatEuro(check.totale_ristoranti || 0)}</span>
              </div>
            </div>
            {/* Box per sede fisica */}
            {(() => {
              const sedi = [
                { label: 'Du Parc', strutture: ['DPH', 'MMS'], color: '#1e3a5f' },
                { label: 'Club Hotel', strutture: ['CLB'], color: '#0ea5e9' },
                { label: 'International', strutture: ['INT', 'BON'], color: '#6366f1' },
              ]
              const totSedi = sedi.reduce((sum, s) => sum + s.strutture.reduce((a, sc) => a + (check[sc] || 0), 0), 0)
              return (
                <div style={{ flex: 1, minWidth: 220, border: '1.5px solid #67e8f9', borderRadius: 10, padding: '1rem 1.25rem', background: '#ecfeff' }}>
                  <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', color: '#0891b2' }}>
                    Per sede fisica
                  </h4>
                  {sedi.map(({ label, strutture, color }) => {
                    const v = strutture.reduce((sum, sc) => sum + (check[sc] || 0), 0)
                    const dettaglio = strutture.map(sc => NOMI[sc]).join(' + ')
                    return (
                      <div key={label} style={{ padding: '4px 0', fontSize: '0.85rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: v > 0 ? color : '#d1d5db', display: 'inline-block', flexShrink: 0 }} />
                            <span style={{ fontWeight: 600, color: '#1e293b' }}>{label}</span>
                          </span>
                          <span style={{ fontWeight: 700, color: v > 0 ? '#1e293b' : '#94a3b8' }}>{formatEuro(v)}</span>
                        </div>
                        {strutture.length > 1 && (
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8', paddingLeft: 12 }}>{dettaglio}</div>
                        )}
                      </div>
                    )
                  })}
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #67e8f9', marginTop: 6, paddingTop: 6, fontWeight: 700 }}>
                    <span>TOTALE SEDI</span>
                    <span>{formatEuro(totSedi)}</span>
                  </div>
                </div>
              )
            })()}
            <div style={{
              alignSelf: 'center', background: '#1e3a5f', color: '#fff',
              borderRadius: 10, padding: '1rem 1.5rem', textAlign: 'center', minWidth: 160,
              border: `3px solid ${semaforo.dot}`,
            }}>
              <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>TOTALE GENERALE</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: 4 }}>
                {formatEuro(check.totale_generale || 0)}
              </div>
              <div style={{ marginTop: 6, fontSize: '0.72rem', background: semaforo.dot, borderRadius: 4, padding: '2px 6px', display: 'inline-block' }}>
                {semaforo.label}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Drawer documenti */}
      {drawer && <DrawerDocumenti info={drawer} onClose={() => setDrawer(null)} />}
      {drawer && (
        <div onClick={() => setDrawer(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.1)' }} />
      )}
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

function TabDocumenti({ endpoint, tipo, lordo, refreshKey }) {
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

// ── Tab Dati di test ──────────────────────────────────────────────────────────

function TabTest({ onPulito }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cancellando, setCancellando] = useState(false)
  const [msg, setMsg] = useState(null)

  const carica = useCallback(async () => {
    try {
      const { data } = await api.get('/corrispettivi/admin/test-stats')
      setStats(data)
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { carica() }, [carica])

  const cancella = async () => {
    if (!window.confirm(`Eliminare tutti i dati di test corrispettivi (${stats?.totale} record)?`)) return
    setCancellando(true)
    try {
      await api.delete('/corrispettivi/admin/test-data?conferma=true')
      setMsg('Dati di test eliminati.')
      carica()
      onPulito()
    } catch (e) {
      setMsg(mostraErrore(e, 'Errore'))
    } finally {
      setCancellando(false)
    }
  }

  return (
    <div style={{ maxWidth: 500 }}>
      <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#1e293b' }}>Gestione dati di test</h3>
      {loading ? <p style={{ color: '#94a3b8' }}>Caricamento…</p> : stats && (
        <div style={{ border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
          <p style={{ margin: 0, fontWeight: 600, color: '#92400e' }}>Dati di test presenti nel database:</p>
          <ul style={{ margin: '0.5rem 0 0 1rem', color: '#78350f', fontSize: '0.85rem' }}>
            <li>Import: {stats.imports}</li>
            <li>Documenti: {stats.documenti}</li>
            <li>Manuali: {stats.manuali}</li>
            <li><strong>Totale: {stats.totale}</strong></li>
          </ul>
        </div>
      )}
      {msg && <p style={{ color: msg.includes('eliminati') ? '#166534' : '#ef4444', fontSize: '0.88rem', marginBottom: '0.75rem' }}>{msg}</p>}
      <button
        onClick={cancella}
        disabled={cancellando || (stats?.totale === 0)}
        style={{
          padding: '8px 20px', borderRadius: 7, border: 'none', cursor: 'pointer',
          background: stats?.totale === 0 ? '#f1f5f9' : '#ef4444',
          color: stats?.totale === 0 ? '#94a3b8' : '#fff',
          fontWeight: 600, fontSize: '0.88rem',
        }}
      >
        {cancellando ? 'Eliminazione…' : 'Elimina tutti i dati di test'}
      </button>
    </div>
  )
}

// ── Componente TabFatturati ───────────────────────────────────────────────────

const COLORI_STRUTTURA = {
  DPH: '#1e3a5f', CLB: '#0ea5e9', INT: '#6366f1',
  MMS: '#f59e0b', BON: '#10b981',
}
const COL_HOTEL_TOT  = '#94a3b8'
const COL_RIST_TOT   = '#fbbf24'
const COL_GEN_TOT    = '#334155'

const annoCorrente = new Date().getFullYear()
const meseCorrente = new Date().getMonth() + 1

function TabFatturati({ lordo }) {
  const [anno, setAnno] = useState(annoCorrente)
  const [dati, setDati] = useState(null)
  const [datiPag, setDatiPag] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  // drill-down: { sc, mese } oppure null
  const [drillDown, setDrillDown] = useState(null)
  // grafico: 'struttura' | 'gruppo'
  const [vistaGrafico, setVistaGrafico] = useState('struttura')
  // raggruppamento grafico struttura: 'struttura' (mesi dentro ogni struttura) | 'mese' (strutture affiancate per mese)
  const [raggruppaPer, setRaggruppaPer] = useState('struttura')
  const [apriTs, setApriTs] = useState(false)
  const [apriControllo, setApriControllo] = useState(false)

  const carica = useCallback(async () => {
    setLoading(true)
    setErrore(null)
    setDrillDown(null)
    try {
      const [r1, r2] = await Promise.all([
        api.get('/corrispettivi/report/fatturati', { params: { anno, lordo } }),
        api.get('/corrispettivi/report/pagamenti', { params: { anno } }),
      ])
      setDati(r1.data)
      setDatiPag(r2.data)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore nel caricamento'))
    } finally {
      setLoading(false)
    }
  }, [anno, lordo])

  useEffect(() => { carica() }, [carica])

  if (loading) return <p style={{ color: '#94a3b8', padding: '2rem 0' }}>Caricamento…</p>
  if (errore)  return <p style={{ color: '#ef4444' }}>{errore}</p>
  if (!dati)   return null

  const strutture = dati.strutture || []
  const mesi      = dati.mesi || []
  const totAnno   = dati.totale_anno || {}
  const strutHotel = strutture.filter(s => STRUTTURE_HOTEL.includes(s))
  const strutRist  = strutture.filter(s => STRUTTURE_MANUALI.includes(s))

  const fmtV = (v) => (v && v !== 0) ? formatEuro(v) : <span style={{ color: '#cbd5e1' }}>—</span>

  // Toggle cella drill-down
  const toggleDrill = (sc, mese) => {
    if (drillDown && drillDown.sc === sc && drillDown.mese === mese) {
      setDrillDown(null)
    } else {
      setDrillDown({ sc, mese })
    }
  }

  // Dati drill-down correnti
  const drillDati = drillDown
    ? (drillDown.mese === 'totale'
        ? totAnno.per_struttura?.[drillDown.sc]
        : mesi.find(m => m.mese === drillDown.mese)?.per_struttura?.[drillDown.sc])
    : null

  // ── Dati grafico ────────────────────────────────────────────────────────────
  // Vista "per struttura, mesi dentro": un punto per (struttura, mese)
  const datiGraficoPers = strutture.flatMap(s =>
    mesi.map(m => ({
      nome: m.nome_mese.slice(0, 3),
      struttura: s,
      valore: m.per_struttura?.[s]?.totale || 0,
    }))
  )
  // Vista "per mese, strutture affiancate": un punto per mese, una Bar per struttura
  const datiGraficoMese = mesi.map(m => {
    const entry = { nome: m.nome_mese.slice(0, 3) }
    strutture.forEach(s => { entry[s] = m.per_struttura?.[s]?.totale || 0 })
    return entry
  })
  const datiGrafico = vistaGrafico === 'struttura'
    ? (raggruppaPer === 'struttura' ? datiGraficoPers : datiGraficoMese)
    : mesi.map(m => ({ nome: m.nome_mese.slice(0, 3), Hotel: m.totale_hotel || 0, Ristoranti: m.totale_ristoranti || 0 }))

  const stileColonnaTot = {
    background: '#f1f5f9', fontWeight: 600,
  }

  return (
    <div>
      {/* Selettore anno */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 600 }}>Anno:</label>
          <select value={anno} onChange={e => setAnno(Number(e.target.value))}
            style={{ ...inpSt, padding: '5px 10px' }}>
            {[2024, 2025, 2026, 2027].map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        {mesi.length > 0 && (
          <>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              {mesi.length} {mesi.length === 1 ? 'mese' : 'mesi'} con dati
            </span>
            <button onClick={async () => {
              try {
                const res = await api.get('/corrispettivi/export/fatturati', {
                  params: { anno, lordo },
                  responseType: 'blob',
                })
                const url = URL.createObjectURL(res.data)
                const a = document.createElement('a')
                a.href = url
                a.download = `corrispettivi_fatturati_${anno}.xlsx`
                a.click()
                URL.revokeObjectURL(url)
              } catch (e) {
                alert(mostraErrore(e, 'Errore export'))
              }
            }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 6, background: '#16a34a', color: '#fff', fontWeight: 600, fontSize: '0.82rem', border: 'none', cursor: 'pointer' }}>
              ⬇ Esporta Excel
            </button>
          </>
        )}
      </div>

      {mesi.length === 0 ? (
        <p style={{ color: '#94a3b8', fontStyle: 'italic' }}>Nessun dato per l'anno {anno}.</p>
      ) : (
        <>
          {/* ── Tabella principale ─────────────────────────────────────────── */}
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', color: '#1e293b', fontWeight: 700, letterSpacing: '0.02em' }}>
            Totale Corrispettivi
          </h3>
          <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
            <table style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th style={{ ...thSt, textAlign: 'left', minWidth: 90 }}>Mese</th>
                  {strutHotel.map(s => (
                    <th key={s} style={{ ...thSt, color: '#fff', background: COLORI_STRUTTURA[s] }}>{s}</th>
                  ))}
                  {strutHotel.length > 0 && (
                    <th style={{ ...thSt, background: '#475569', color: '#fff' }}>Tot. Hotel</th>
                  )}
                  {strutRist.map(s => (
                    <th key={s} style={{ ...thSt, color: '#fff', background: COLORI_STRUTTURA[s] }}>{s}</th>
                  ))}
                  {strutRist.length > 0 && (
                    <th style={{ ...thSt, background: '#78350f', color: '#fff' }}>Tot. Rist.</th>
                  )}
                  <th style={{ ...thSt, background: '#1e293b', color: '#fff' }}>TOTALE</th>
                </tr>
              </thead>
              <tbody>
                {mesi.map(m => {
                  const isMeseCorrente = anno === annoCorrente && m.mese === meseCorrente
                  const rowBg = isMeseCorrente ? '#eff6ff' : undefined
                  return (
                    <tr key={m.mese} style={rowBg ? { background: rowBg } : undefined}>
                      <td style={{ ...tdSt, textAlign: 'left', fontWeight: isMeseCorrente ? 700 : 400, background: rowBg, color: isMeseCorrente ? '#1d4ed8' : undefined }}>
                        {m.nome_mese}
                        {isMeseCorrente && <span style={{ marginLeft: 5, fontSize: '0.7rem', background: '#dbeafe', color: '#1d4ed8', padding: '1px 5px', borderRadius: 4, verticalAlign: 'middle' }}>▶</span>}
                      </td>
                      {strutHotel.map(s => {
                        const val = m.per_struttura?.[s]?.totale
                        const attivo = drillDown?.sc === s && drillDown?.mese === m.mese
                        return (
                          <td key={s} onClick={() => toggleDrill(s, m.mese)}
                            style={{ ...tdSt, background: attivo ? '#dbeafe' : rowBg, cursor: 'pointer', borderBottom: attivo ? '2px solid #3b82f6' : undefined }}>
                            {fmtV(val)}
                          </td>
                        )
                      })}
                      {strutHotel.length > 0 && (
                        <td style={{ ...tdSt, ...stileColonnaTot, background: rowBg || stileColonnaTot.background }}>
                          {fmtV(m.totale_hotel)}
                        </td>
                      )}
                      {strutRist.map(s => {
                        const val = m.per_struttura?.[s]?.totale
                        const attivo = drillDown?.sc === s && drillDown?.mese === m.mese
                        return (
                          <td key={s} onClick={() => toggleDrill(s, m.mese)}
                            style={{ ...tdSt, background: attivo ? '#fef9c3' : rowBg, cursor: 'pointer', borderBottom: attivo ? '2px solid #eab308' : undefined }}>
                            {fmtV(val)}
                          </td>
                        )
                      })}
                      {strutRist.length > 0 && (
                        <td style={{ ...tdSt, ...stileColonnaTot, background: rowBg || stileColonnaTot.background }}>
                          {fmtV(m.totale_ristoranti)}
                        </td>
                      )}
                      <td style={{ ...tdSt, fontWeight: 700, background: rowBg || '#f8fafc' }}>
                        {fmtV(m.totale_generale)}
                      </td>
                    </tr>
                  )
                })}

                {/* Riga TOTALE ANNO */}
                <tr className="riga-totale">
                  <td style={{ ...tdSt, textAlign: 'left', background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>TOTALE ANNO</td>
                  {strutHotel.map(s => {
                    const attivo = drillDown?.sc === s && drillDown?.mese === 'totale'
                    return (
                      <td key={s} onClick={() => toggleDrill(s, 'totale')}
                        style={{ background: attivo ? '#1d4ed8' : '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {formatEuro(totAnno.per_struttura?.[s]?.totale || 0)}
                      </td>
                    )
                  })}
                  {strutHotel.length > 0 && (
                    <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right' }}>
                      {formatEuro(totAnno.totale_hotel || 0)}
                    </td>
                  )}
                  {strutRist.map(s => {
                    const attivo = drillDown?.sc === s && drillDown?.mese === 'totale'
                    return (
                      <td key={s} onClick={() => toggleDrill(s, 'totale')}
                        style={{ background: attivo ? '#1d4ed8' : '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {formatEuro(totAnno.per_struttura?.[s]?.totale || 0)}
                      </td>
                    )
                  })}
                  {strutRist.length > 0 && (
                    <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right' }}>
                      {formatEuro(totAnno.totale_ristoranti || 0)}
                    </td>
                  )}
                  <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 800, textAlign: 'right' }}>
                    {formatEuro(totAnno.totale_generale || 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Drill-down categorie ───────────────────────────────────────── */}
          {drillDown && drillDati && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.5rem', maxWidth: 480 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#1e293b' }}>
                  <span style={{ color: COLORI_STRUTTURA[drillDown.sc] || '#1e3a5f', fontWeight: 700 }}>{drillDown.sc}</span>
                  {' — '}
                  {drillDown.mese === 'totale' ? 'Totale Anno' : (mesi.find(m => m.mese === drillDown.mese)?.nome_mese || '')}
                </h4>
                <button onClick={() => setDrillDown(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.1rem', padding: '0 4px' }}>✕</button>
              </div>
              <table style={{ width: '100%' }}>
                <tbody>
                  {['arrangiamenti', 'penali', 'shop', 'altro'].map(cat => {
                    const v = drillDati[cat] || 0
                    if (v === 0) return null
                    return (
                      <tr key={cat}>
                        <td style={{ ...tdSt, textAlign: 'left', color: '#475569' }}>{NOME_CAT[cat]}</td>
                        <td style={{ ...tdSt, fontWeight: 600 }}>{formatEuro(v)}</td>
                      </tr>
                    )
                  })}
                  <tr style={{ borderTop: '2px solid #e2e8f0' }}>
                    <td style={{ ...tdSt, textAlign: 'left', fontWeight: 700 }}>Totale ricavi</td>
                    <td style={{ ...tdSt, fontWeight: 700 }}>{formatEuro(drillDati.totale || 0)}</td>
                  </tr>
                  {(drillDati.tassa_soggiorno || 0) > 0 && (
                    <tr>
                      <td style={{ ...tdSt, textAlign: 'left', color: '#94a3b8', fontStyle: 'italic', fontSize: '0.75rem' }}>
                        Tassa soggiorno (transito, esclusa dal totale)
                      </td>
                      <td style={{ ...tdSt, color: '#94a3b8', fontStyle: 'italic', fontSize: '0.75rem' }}>
                        {formatEuro(drillDati.tassa_soggiorno)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Tabella Tassa di Soggiorno ─────────────────────────────────── */}
          {strutHotel.length > 0 && (
            <>
              <h3 onClick={() => setApriTs(v => !v)}
                style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', color: '#1e293b', fontWeight: 700, letterSpacing: '0.02em', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{apriTs ? '▾' : '▸'}</span>
                Totale Tassa di Soggiorno
                <span style={{ marginLeft: 4, fontSize: '0.75rem', color: '#94a3b8', fontWeight: 400, fontStyle: 'italic' }}>
                  (transito Comune — esclusa dal corrispettivo)
                </span>
              </h3>
              {apriTs && (
                <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
                  <table style={{ minWidth: 500 }}>
                    <thead>
                      <tr>
                        <th style={{ ...thSt, textAlign: 'left', minWidth: 90 }}>Mese</th>
                        {strutHotel.map(s => (
                          <th key={s} style={{ ...thSt, color: '#fff', background: COLORI_STRUTTURA[s] }}>{s}</th>
                        ))}
                        <th style={{ ...thSt, background: '#475569', color: '#fff' }}>Tot. Hotel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mesi.map(m => {
                        const isMeseCorrente = anno === annoCorrente && m.mese === meseCorrente
                        const rowBg = isMeseCorrente ? '#eff6ff' : undefined
                        const totTs = strutHotel.reduce((acc, s) => acc + (m.per_struttura?.[s]?.tassa_soggiorno || 0), 0)
                        return (
                          <tr key={m.mese} style={rowBg ? { background: rowBg } : undefined}>
                            <td style={{ ...tdSt, textAlign: 'left', fontWeight: isMeseCorrente ? 700 : 400, background: rowBg, color: isMeseCorrente ? '#1d4ed8' : undefined }}>
                              {m.nome_mese}
                              {isMeseCorrente && <span style={{ marginLeft: 5, fontSize: '0.7rem', background: '#dbeafe', color: '#1d4ed8', padding: '1px 5px', borderRadius: 4, verticalAlign: 'middle' }}>▶</span>}
                            </td>
                            {strutHotel.map(s => (
                              <td key={s} style={{ ...tdSt, background: rowBg }}>
                                {fmtV(m.per_struttura?.[s]?.tassa_soggiorno)}
                              </td>
                            ))}
                            <td style={{ ...tdSt, ...stileColonnaTot, background: rowBg || stileColonnaTot.background }}>
                              {fmtV(totTs)}
                            </td>
                          </tr>
                        )
                      })}
                      <tr className="riga-totale">
                        <td style={{ ...tdSt, textAlign: 'left', background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>TOTALE ANNO</td>
                        {strutHotel.map(s => (
                          <td key={s} style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {formatEuro(totAnno.per_struttura?.[s]?.tassa_soggiorno || 0)}
                          </td>
                        ))}
                        <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 800, textAlign: 'right' }}>
                          {formatEuro(strutHotel.reduce((acc, s) => acc + (totAnno.per_struttura?.[s]?.tassa_soggiorno || 0), 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Riepilogo di controllo ──────────────────────────────────────── */}
              <h3 onClick={() => setApriControllo(v => !v)}
                style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', color: '#1e293b', fontWeight: 700, letterSpacing: '0.02em', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{apriControllo ? '▾' : '▸'}</span>
                Riepilogo di controllo
                <span style={{ marginLeft: 4, fontSize: '0.75rem', color: '#94a3b8', fontWeight: 400, fontStyle: 'italic' }}>
                  (il Totale Lordo deve coincidere con i corrispettivi giornalieri)
                </span>
              </h3>
              {apriControllo && (
                <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
                  <table style={{ minWidth: 420 }}>
                    <thead>
                      <tr>
                        <th style={{ ...thSt, textAlign: 'left', minWidth: 90 }}>Mese</th>
                        <th style={{ ...thSt, background: '#334155', color: '#fff' }}>Corrispettivo</th>
                        <th style={{ ...thSt, background: '#0f766e', color: '#fff' }}>+ Tassa Soggiorno</th>
                        <th style={{ ...thSt, background: '#1e3a5f', color: '#fff' }}>= Totale Lordo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mesi.map(m => {
                        const isMeseCorrente = anno === annoCorrente && m.mese === meseCorrente
                        const rowBg = isMeseCorrente ? '#eff6ff' : undefined
                        const tsGenerale = strutture.reduce((acc, s) => acc + (m.per_struttura?.[s]?.tassa_soggiorno || 0), 0)
                        const totLordo = (m.totale_generale || 0) + tsGenerale
                        return (
                          <tr key={m.mese} style={rowBg ? { background: rowBg } : undefined}>
                            <td style={{ ...tdSt, textAlign: 'left', fontWeight: isMeseCorrente ? 700 : 400, background: rowBg, color: isMeseCorrente ? '#1d4ed8' : undefined }}>
                              {m.nome_mese}
                              {isMeseCorrente && <span style={{ marginLeft: 5, fontSize: '0.7rem', background: '#dbeafe', color: '#1d4ed8', padding: '1px 5px', borderRadius: 4, verticalAlign: 'middle' }}>▶</span>}
                            </td>
                            <td style={{ ...tdSt, background: rowBg }}>{formatEuro(m.totale_generale || 0)}</td>
                            <td style={{ ...tdSt, background: rowBg, color: '#0f766e', fontWeight: 500 }}>{fmtV(tsGenerale)}</td>
                            <td style={{ ...tdSt, background: rowBg, fontWeight: 700 }}>{formatEuro(totLordo)}</td>
                          </tr>
                        )
                      })}
                      <tr className="riga-totale">
                        <td style={{ ...tdSt, textAlign: 'left', background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>TOTALE ANNO</td>
                        <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right' }}>
                          {formatEuro(totAnno.totale_generale || 0)}
                        </td>
                        <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right' }}>
                          {formatEuro(strutture.reduce((acc, s) => acc + (totAnno.per_struttura?.[s]?.tassa_soggiorno || 0), 0))}
                        </td>
                        <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 800, textAlign: 'right' }}>
                          {formatEuro(
                            (totAnno.totale_generale || 0) +
                            strutture.reduce((acc, s) => acc + (totAnno.per_struttura?.[s]?.tassa_soggiorno || 0), 0)
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── Tabella tipi di pagamento ──────────────────────────────────── */}
          {datiPag && datiPag.tipi?.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem', color: '#1e293b', fontWeight: 700 }}>
                Forme di pagamento {anno}
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 500 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thSt, textAlign: 'left', minWidth: 140 }}>Tipo pagamento</th>
                      {datiPag.mesi.map(m => (
                        <th key={m.mese} style={{ ...thSt }}>{m.nome_mese.slice(0, 3)}</th>
                      ))}
                      <th style={{ ...thSt, background: '#1e293b' }}>TOTALE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datiPag.tipi.map((tipo, idx) => {
                      const isSpeciale = tipo === 'Caparra' || tipo === 'Sospeso' || tipo === 'MMS / BON (manuale)'
                      const bgBase = idx % 2 === 0 ? '#fff' : '#f8fafc'
                      const borderTop = isSpeciale ? '1px solid #e2e8f0' : undefined
                      return (
                      <tr key={tipo} style={{ background: bgBase, borderTop }}>
                        <td style={{ ...tdSt, textAlign: 'left', background: bgBase, fontWeight: isSpeciale ? 600 : 500, color: isSpeciale ? '#64748b' : '#374151', fontStyle: isSpeciale ? 'italic' : undefined }}>{tipo}</td>
                        {datiPag.mesi.map(m => {
                          const v = datiPag.per_tipo[tipo]?.[String(m.mese)] || 0
                          return (
                            <td key={m.mese} style={{ ...tdSt, background: bgBase }}>
                              {v ? formatEuro(v) : <span style={{ color: '#e2e8f0' }}>—</span>}
                            </td>
                          )
                        })}
                        <td style={{ ...tdSt, fontWeight: 700, background: idx % 2 === 0 ? '#f1f5f9' : '#e8edf3' }}>
                          {formatEuro(datiPag.totale_anno[tipo] || 0)}
                        </td>
                      </tr>
                    )})}
                    {/* Riga totale */}
                    <tr className="riga-totale">
                      <td style={{ ...tdSt, textAlign: 'left', background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>TOTALE</td>
                      {datiPag.mesi.map(m => (
                        <td key={m.mese} style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {formatEuro(datiPag.totale_mese[String(m.mese)] || 0)}
                        </td>
                      ))}
                      <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 800, textAlign: 'right' }}>
                        {formatEuro(Object.values(datiPag.totale_anno).reduce((a, v) => a + v, 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Grafico ────────────────────────────────────────────────────── */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#1e293b', fontWeight: 700 }}>
                Fatturato mensile {anno}
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                {vistaGrafico === 'struttura' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: '#64748b', cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={raggruppaPer === 'struttura'}
                      onChange={e => setRaggruppaPer(e.target.checked ? 'struttura' : 'mese')}
                      style={{ cursor: 'pointer' }} />
                    Raggruppa per struttura
                  </label>
                )}
                <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 7, padding: '3px 4px', gap: 2 }}>
                  {[
                    { id: 'struttura', label: 'Per struttura' },
                    { id: 'gruppo', label: 'Hotel vs Ristoranti' },
                  ].map(v => (
                    <button key={v.id} onClick={() => setVistaGrafico(v.id)}
                      style={{
                        padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
                        fontSize: '0.78rem', fontWeight: vistaGrafico === v.id ? 700 : 400,
                        background: vistaGrafico === v.id ? '#1e3a5f' : 'transparent',
                        color: vistaGrafico === v.id ? '#fff' : '#64748b',
                      }}>{v.label}</button>
                  ))}
                </div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={datiGrafico} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                {vistaGrafico === 'struttura' && raggruppaPer === 'struttura' ? (
                  <XAxis dataKey="nome" height={42}
                    tick={(props) => {
                      const { x, y, payload, index } = props
                      const nMesi = mesi.length
                      const sIdx = Math.floor(index / nMesi)
                      const mIdx = index % nMesi
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <text x={0} dy={14} textAnchor="middle" fill="#64748b" fontSize={10}>{payload.value}</text>
                        </g>
                      )
                    }}
                  />
                ) : (
                  <XAxis dataKey="nome" tick={{ fontSize: 11, fill: '#64748b' }} />
                )}
                <YAxis tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                  tick={{ fontSize: 11, fill: '#64748b' }} />
                {vistaGrafico === 'struttura' && raggruppaPer === 'struttura' ? (
                  <ReTooltip formatter={(v, _n, props) => [formatEuro(v), NOMI[props.payload?.struttura] || props.payload?.struttura]} />
                ) : (
                  <ReTooltip formatter={(v, name) => [formatEuro(v), name]} />
                )}
                {vistaGrafico === 'struttura' && raggruppaPer === 'struttura' ? (
                  <Bar dataKey="valore" radius={[3, 3, 0, 0]}>
                    {datiGraficoPers.map((entry, i) => (
                      <Cell key={i} fill={COLORI_STRUTTURA[entry.struttura] || '#94a3b8'} />
                    ))}
                  </Bar>
                ) : vistaGrafico === 'struttura' ? (
                  <>
                    <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
                    {strutture.map(s => (
                      <Bar key={s} dataKey={s} name={NOMI[s] || s}
                        fill={COLORI_STRUTTURA[s] || '#94a3b8'} radius={[3, 3, 0, 0]} />
                    ))}
                  </>
                ) : (
                  <>
                    <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
                    <Bar key="Hotel" dataKey="Hotel" name="Hotel" fill={COL_HOTEL_TOT} radius={[3, 3, 0, 0]} />
                    <Bar key="Ristoranti" dataKey="Ristoranti" name="Ristoranti" fill={COL_RIST_TOT} radius={[3, 3, 0, 0]} />
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
            {vistaGrafico === 'struttura' && raggruppaPer === 'struttura' && (
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                {strutture.map(s => (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: COLORI_STRUTTURA[s] || '#94a3b8', display: 'inline-block' }} />
                    <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{NOMI[s] || s}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Pagina principale ─────────────────────────────────────────────────────────

// ── Componente FormRT (sotto-pannello di inserimento per una singola RT) ───────

function FormRT({ label, prefix, form, setForm, onElimina, pms }) {
  // Stato locale per i sotto-campi Importo Parziale e Imposta (solo aliquote con IVA)
  // Non vengono salvati in DB: servono solo per calcolare il Corrispettivo
  const [sub, setSub] = useState({ par10: '', imp10: '', par22: '', imp22: '' })

  const BREAKDOWN_KEYS = ['10', 'ts', 'penali', '22']

  const pNum = (val) => {
    if (val === '' || val === null || val === undefined) return null
    const n = parseFloat(String(val).replace(',', '.'))
    return isNaN(n) ? null : n
  }

  // Aggiorna un breakdown e ricalcola automaticamente il totale giorno
  const setBreakdown = (k, v) => {
    setForm(f => {
      const newF = { ...f, [`${prefix}_${k}`]: v }
      const vals = BREAKDOWN_KEYS.map(bk => pNum(bk === k ? v : newF[`${prefix}_${bk}`]))
      const almenoUno = vals.some(n => n !== null)
      if (almenoUno) {
        const somma = vals.reduce((acc, n) => acc + (n || 0), 0)
        return { ...newF, [`${prefix}_totale`]: somma.toFixed(2).replace('.', ',') }
      }
      return newF
    })
  }

  // Aggiorna Importo Parziale o Imposta per un'aliquota con IVA
  // e ricalcola il Corrispettivo = par + imp
  const updateAliquota = (parKey, impKey, formKey, k, v) => {
    const ns = { ...sub, [k]: v }
    setSub(ns)
    const par = pNum(ns[parKey])
    const imp = pNum(ns[impKey])
    const corr = (par !== null || imp !== null)
      ? ((par || 0) + (imp || 0)).toFixed(2).replace('.', ',')
      : ''
    setBreakdown(formKey, corr)
  }

  const totaleNum = pNum(form[`${prefix}_totale`])
  const breakdownVals = BREAKDOWN_KEYS.map(k => pNum(form[`${prefix}_${k}`]))
  const almenoUnBreakdown = breakdownVals.some(v => v !== null)
  const sommaBreakdown = almenoUnBreakdown ? breakdownVals.reduce((a, v) => a + (v || 0), 0) : null
  const totaleAuto = almenoUnBreakdown && totaleNum !== null && Math.abs(totaleNum - sommaBreakdown) < 0.01

  const deltaInfo = (k, pmsV) => {
    const rt = pNum(form[`${prefix}_${k}`])
    if (rt === null) return { label: '—', color: '#94a3b8' }
    const d = rt - (pmsV || 0)
    if (Math.abs(d) <= 0.01) return { label: '✓', color: '#16a34a' }
    return { label: (d > 0 ? '+' : '') + formatEuro(d), color: '#dc2626' }
  }

  const tdL = { fontSize: '0.74rem', color: '#475569', padding: '2px 4px' }
  const tdR = { fontSize: '0.74rem', color: '#64748b', textAlign: 'right', padding: '2px 4px' }
  const subLbl = { ...tdL, color: '#94a3b8', paddingLeft: 14, fontStyle: 'italic' }
  const inputStyle = { ...inpSt, width: 80, textAlign: 'right', padding: '3px 6px', fontSize: '0.78rem' }
  const sep = <tr><td colSpan={4}><div style={{ borderTop: '1px dashed #f1f5f9', margin: '2px 0' }} /></td></tr>

  const corrDisplay = (k) => {
    const v = pNum(form[`${prefix}_${k}`])
    return v !== null
      ? <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e3a5f' }}>{formatEuro(v)} <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 400 }}>corr.</span></span>
      : <span style={{ fontSize: '0.78rem', color: '#cbd5e1' }}>—</span>
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
        <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#1e3a5f' }}>{label}</span>
        {onElimina && (
          <button onClick={onElimina} style={{
            fontSize: '0.73rem', color: '#ef4444', border: '1px solid #fca5a5',
            borderRadius: 4, padding: '2px 8px', cursor: 'pointer', background: '#fff5f5',
          }}>Elimina</button>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
            <th style={{ textAlign: 'left',  padding: '2px 4px', fontWeight: 500 }}>Natura</th>
            <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 500 }}>RT</th>
            <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 500 }}>PMS</th>
            <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 500 }}>Δ</th>
          </tr>
        </thead>
        <tbody>

          {/* ── Totale giorno (auto-calcolato) ── */}
          {(() => {
            const d = deltaInfo('totale', pms?.totale)
            return (
              <tr style={{ background: totaleAuto ? '#f0fdf4' : '#fffbeb' }}>
                <td style={{ ...tdL, fontWeight: 600 }}>
                  Totale giorno
                  {totaleAuto
                    ? <span style={{ marginLeft: 4, fontSize: '0.68rem', color: '#16a34a' }}>⚡ auto</span>
                    : <span style={{ color: '#dc2626' }}> *</span>}
                </td>
                <td style={{ padding: '3px 4px', textAlign: 'right' }}>
                  {totaleAuto
                    ? <span style={{ display: 'inline-block', width: 80, textAlign: 'right', background: '#dcfce7', color: '#15803d', fontWeight: 700, fontSize: '0.78rem', borderRadius: 5, padding: '3px 6px', border: '1px solid #86efac' }}>
                        {totaleNum.toFixed(2).replace('.', ',')}
                      </span>
                    : <input type="text" inputMode="decimal"
                        value={form[`${prefix}_totale`] ?? ''}
                        onChange={e => setForm(f => ({ ...f, [`${prefix}_totale`]: e.target.value }))}
                        placeholder="0,00" style={inputStyle} />}
                </td>
                <td style={tdR}>{pms?.totale > 0 ? formatEuro(pms.totale) : '—'}</td>
                <td style={{ ...tdR, fontWeight: 700, color: d.color }}>{d.label}</td>
              </tr>
            )
          })()}

          <tr><td colSpan={4}><div style={{ borderTop: '1px dashed #e2e8f0', margin: '3px 0' }} /></td></tr>

          {/* ── Aliquota 10%: Importo Parziale + Imposta → Corrispettivo auto ── */}
          {(() => {
            const d = deltaInfo('10', pms?.arr)
            return (
              <>
                <tr>
                  <td style={{ ...tdL, fontWeight: 600 }}>Aliquota 10%</td>
                  <td style={{ padding: '2px 4px', textAlign: 'right' }}>{corrDisplay('10')}</td>
                  <td style={tdR}>{pms?.arr > 0 ? formatEuro(pms.arr) : '—'}</td>
                  <td style={{ ...tdR, fontWeight: 700, color: d.color }}>{d.label}</td>
                </tr>
                <tr>
                  <td style={subLbl}>Imposta</td>
                  <td style={{ padding: '2px 4px' }}>
                    <input type="text" inputMode="decimal" value={sub.imp10}
                      onChange={e => updateAliquota('par10', 'imp10', '10', 'imp10', e.target.value)}
                      placeholder="0,00" style={inputStyle} />
                  </td>
                  <td /><td />
                </tr>
                <tr>
                  <td style={subLbl}>Importo Parziale</td>
                  <td style={{ padding: '2px 4px' }}>
                    <input type="text" inputMode="decimal" value={sub.par10}
                      onChange={e => updateAliquota('par10', 'imp10', '10', 'par10', e.target.value)}
                      placeholder="0,00" style={inputStyle} />
                  </td>
                  <td /><td />
                </tr>
              </>
            )
          })()}

          {sep}

          {/* ── Esente N1 (T. Soggiorno): solo Importo Parziale ── */}
          {(() => {
            const d = deltaInfo('ts', pms?.ts)
            return (
              <tr>
                <td style={tdL}>Esente N1 (T. Soggiorno)</td>
                <td style={{ padding: '3px 4px' }}>
                  <input type="text" inputMode="decimal"
                    value={form[`${prefix}_ts`] ?? ''}
                    onChange={e => setBreakdown('ts', e.target.value)}
                    placeholder="Imp. Parziale" style={inputStyle} />
                </td>
                <td style={tdR}>{pms?.ts > 0 ? formatEuro(pms.ts) : '—'}</td>
                <td style={{ ...tdR, fontWeight: 700, color: d.color }}>{d.label}</td>
              </tr>
            )
          })()}

          {/* ── Esente Art.15 (Penali): solo Importo Parziale ── */}
          {(() => {
            const d = deltaInfo('penali', pms?.penali)
            return (
              <tr>
                <td style={tdL}>Esente Art.15 (Penali)</td>
                <td style={{ padding: '3px 4px' }}>
                  <input type="text" inputMode="decimal"
                    value={form[`${prefix}_penali`] ?? ''}
                    onChange={e => setBreakdown('penali', e.target.value)}
                    placeholder="Imp. Parziale" style={inputStyle} />
                </td>
                <td style={tdR}>{pms?.penali > 0 ? formatEuro(pms.penali) : '—'}</td>
                <td style={{ ...tdR, fontWeight: 700, color: d.color }}>{d.label}</td>
              </tr>
            )
          })()}

          {sep}

          {/* ── Aliquota 22%: Importo Parziale + Imposta → Corrispettivo auto ── */}
          {(() => {
            const d = deltaInfo('22', pms?.shop)
            return (
              <>
                <tr>
                  <td style={{ ...tdL, fontWeight: 600 }}>Aliquota 22%</td>
                  <td style={{ padding: '2px 4px', textAlign: 'right' }}>{corrDisplay('22')}</td>
                  <td style={tdR}>{pms?.shop > 0 ? formatEuro(pms.shop) : '—'}</td>
                  <td style={{ ...tdR, fontWeight: 700, color: d.color }}>{d.label}</td>
                </tr>
                <tr>
                  <td style={subLbl}>Imposta</td>
                  <td style={{ padding: '2px 4px' }}>
                    <input type="text" inputMode="decimal" value={sub.imp22}
                      onChange={e => updateAliquota('par22', 'imp22', '22', 'imp22', e.target.value)}
                      placeholder="0,00" style={inputStyle} />
                  </td>
                  <td /><td />
                </tr>
                <tr>
                  <td style={subLbl}>Importo Parziale</td>
                  <td style={{ padding: '2px 4px' }}>
                    <input type="text" inputMode="decimal" value={sub.par22}
                      onChange={e => updateAliquota('par22', 'imp22', '22', 'par22', e.target.value)}
                      placeholder="0,00" style={inputStyle} />
                  </td>
                  <td /><td />
                </tr>
              </>
            )
          })()}

        </tbody>
      </table>
    </div>
  )
}

// ── Tab Controllo RT ──────────────────────────────────────────────────────────

function TabControlloRT() {
  const oggi = new Date()
  const [mese, setMese] = useState(oggi.getMonth() + 1)
  const [anno, setAnno] = useState(oggi.getFullYear())
  const [dati, setDati] = useState(null)
  const [caricamento, setCaricamento] = useState(false)
  const [giornoSel, setGiornoSel] = useState(null)   // data ISO giorno aperto nel pannello
  const [form, setForm] = useState({})
  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState('')
  const [msgOk, setMsgOk] = useState('')
  const [dataManualeInput, setDataManualeInput] = useState('')

  const carica = useCallback(async () => {
    setCaricamento(true)
    setErrore('')
    try {
      const r = await api.get(`/corrispettivi/rt-chiusure?mese=${mese}&anno=${anno}`)
      setDati(r.data)
    } catch (e) {
      setErrore(mostraErrore(e))
    } finally {
      setCaricamento(false)
    }
  }, [mese, anno])

  useEffect(() => { carica() }, [carica])

  const mesePrecedente = () => {
    if (mese === 1) { setMese(12); setAnno(a => a - 1) } else setMese(m => m - 1)
    setGiornoSel(null)
  }
  const meseSuccessivo = () => {
    if (mese === 12) { setMese(1); setAnno(a => a + 1) } else setMese(m => m + 1)
    setGiornoSel(null)
  }

  const _apriForm = (dataIso, rt1, rt2) => {
    setGiornoSel(dataIso)
    setForm({
      rt1_totale:  rt1?.totale_giorno ?? '',
      rt1_10:      rt1?.totale_10     ?? '',
      rt1_22:      rt1?.totale_22     ?? '',
      rt1_ts:      rt1?.totale_ts     ?? '',
      rt1_penali:  rt1?.totale_penali ?? '',
      rt1_id:      rt1?.id            ?? null,
      rt2_totale:  rt2?.totale_giorno ?? '',
      rt2_10:      rt2?.totale_10     ?? '',
      rt2_22:      rt2?.totale_22     ?? '',
      rt2_ts:      rt2?.totale_ts     ?? '',
      rt2_penali:  rt2?.totale_penali ?? '',
      rt2_id:      rt2?.id            ?? null,
      note: rt1?.note || rt2?.note || '',
    })
    setErrPannello('')
    setMsgOk('')
  }

  const apriGiorno = (g) => { if (isAdmin()) _apriForm(g.data, g.rt1.rt, g.rt2.rt) }
  const apriGiornoVuoto = (dataIso) => { _apriForm(dataIso, null, null) }

  // errore locale al pannello (separato dall'errore lista)
  const [errPannello, setErrPannello] = useState('')

  const parseNum = (s) => {
    if (s === '' || s === null || s === undefined) return null
    const n = parseFloat(String(s).replace(',', '.'))
    return isNaN(n) ? null : n
  }

  const salva = async () => {
    setSalvando(true)
    setErrPannello('')
    setMsgOk('')
    const mkPayload = (pref, rtCode) => ({
      data_chiusura: giornoSel,
      rt_code:       rtCode,
      totale_giorno: parseNum(form[`${pref}_totale`]),
      totale_10:     parseNum(form[`${pref}_10`]),
      totale_22:     parseNum(form[`${pref}_22`]),
      totale_ts:     parseNum(form[`${pref}_ts`]),
      totale_penali: parseNum(form[`${pref}_penali`]),
      note: form.note || null,
    })
    try {
      const promises = []
      if (parseNum(form.rt1_totale) !== null) promises.push(api.post('/corrispettivi/rt-chiusure', mkPayload('rt1', 'RT1')))
      if (parseNum(form.rt2_totale) !== null) promises.push(api.post('/corrispettivi/rt-chiusure', mkPayload('rt2', 'RT2')))
      if (promises.length === 0) { setErrPannello('Inserire almeno un totale RT.'); setSalvando(false); return }
      await Promise.all(promises)
      setMsgOk('Salvato')
      await carica()
    } catch (e) {
      setErrPannello(mostraErrore(e))
    } finally {
      setSalvando(false)
    }
  }

  const eliminaRT = async (rtCode, id) => {
    if (!confirm(`Eliminare la chiusura ${rtCode} per ${fmtD(giornoSel)}?`)) return
    try {
      await api.delete(`/corrispettivi/rt-chiusure/${id}`)
      const pref = rtCode === 'RT1' ? 'rt1' : 'rt2'
      setForm(f => ({
        ...f,
        [`${pref}_totale`]: '', [`${pref}_10`]: '', [`${pref}_22`]: '',
        [`${pref}_ts`]: '', [`${pref}_penali`]: '', [`${pref}_id`]: null,
      }))
      await carica()
    } catch (e) {
      setErrPannello(mostraErrore(e))
    }
  }

  const fmtDelta = (delta) => {
    if (delta === null) return { label: '—', color: '#94a3b8' }
    if (Math.abs(delta) <= 0.01) return { label: '✓', color: '#16a34a' }
    return { label: `${delta > 0 ? '+' : ''}${formatEuro(delta)}`, color: '#dc2626' }
  }

  const giornoDati = giornoSel ? dati?.giorni?.find(g => g.data === giornoSel) : null

  const btnNav = { border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', background: '#fff', fontSize: '0.9rem' }

  return (
    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>

      {/* ── Colonna principale ── */}
      <div style={{ flex: 1, minWidth: 0 }}>

        {/* Navigazione mese + badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <button onClick={mesePrecedente} style={btnNav}>←</button>
          <span style={{ fontWeight: 700, fontSize: '1rem', minWidth: 160, textAlign: 'center' }}>
            {meseNome(mese)} {anno}
          </span>
          <button onClick={meseSuccessivo} style={btnNav}>→</button>

          {dati && (
            <span style={{
              background: dati.n_differenze > 0 ? '#fef2f2' : '#f0fdf4',
              color:      dati.n_differenze > 0 ? '#dc2626' : '#16a34a',
              border:     `1px solid ${dati.n_differenze > 0 ? '#fca5a5' : '#86efac'}`,
              borderRadius: 6, padding: '4px 12px', fontSize: '0.82rem', fontWeight: 600,
            }}>
              {dati.n_differenze === 0
                ? 'Nessuna differenza'
                : `${dati.n_differenze} giorn${dati.n_differenze === 1 ? 'o' : 'i'} con differenza`}
            </span>
          )}

          {/* Input data manuale per aggiungere chiusure su giorni senza PMS */}
          {isAdmin() && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
              <input
                type="date"
                value={dataManualeInput}
                onChange={e => setDataManualeInput(e.target.value)}
                style={{ ...inpSt, fontSize: '0.8rem' }}
              />
              <button
                onClick={() => { if (dataManualeInput) { apriGiornoVuoto(dataManualeInput); setDataManualeInput('') } }}
                disabled={!dataManualeInput}
                style={{
                  border: '1px solid #3b82f6', borderRadius: 6, padding: '5px 12px',
                  cursor: 'pointer', background: '#3b82f6', color: '#fff',
                  fontSize: '0.82rem', fontWeight: 600,
                }}
              >+ Inserisci</button>
            </div>
          )}
        </div>

        {caricamento && <p style={{ color: '#64748b', fontSize: '0.85rem' }}>Caricamento…</p>}
        {errore && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{errore}</p>}

        {dati && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 680 }}>
              <thead>
                <tr style={{ background: '#1e3a5f', color: '#fff' }}>
                  <th style={{ ...thSt, textAlign: 'left', borderRadius: '6px 0 0 0' }}>Data</th>
                  <th colSpan={3} style={{ ...thSt, textAlign: 'center', borderRight: '2px solid rgba(255,255,255,0.2)' }}>
                    RT1 — DPH + CLB
                  </th>
                  <th colSpan={3} style={{ ...thSt, textAlign: 'center', borderRadius: '0 6px 0 0' }}>
                    RT2 — INT
                  </th>
                </tr>
                <tr style={{ background: '#2d4a7a', color: '#c8d8f0', fontSize: '0.72rem' }}>
                  <th style={{ ...thSt, textAlign: 'left', color: '#c8d8f0' }}></th>
                  <th style={{ ...thSt, color: '#c8d8f0' }}>Chiusura RT</th>
                  <th style={{ ...thSt, color: '#c8d8f0' }}>PMS gestionale</th>
                  <th style={{ ...thSt, color: '#c8d8f0', borderRight: '2px solid rgba(255,255,255,0.2)' }}>Δ</th>
                  <th style={{ ...thSt, color: '#c8d8f0' }}>Chiusura RT</th>
                  <th style={{ ...thSt, color: '#c8d8f0' }}>PMS gestionale</th>
                  <th style={{ ...thSt, color: '#c8d8f0' }}>Δ</th>
                </tr>
              </thead>
              <tbody>
                {dati.giorni.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ ...tdSt, textAlign: 'center', color: '#94a3b8', padding: '2.5rem' }}>
                      Nessun dato per questo mese
                    </td>
                  </tr>
                )}
                {dati.giorni.map((g, i) => {
                  const sel = giornoSel === g.data
                  const d1 = fmtDelta(g.rt1.delta)
                  const d2 = fmtDelta(g.rt2.delta)
                  const hasDiff = (g.rt1.delta !== null && Math.abs(g.rt1.delta) > 0.01)
                                || (g.rt2.delta !== null && Math.abs(g.rt2.delta) > 0.01)
                  return (
                    <tr
                      key={g.data}
                      onClick={() => apriGiorno(g)}
                      style={{
                        background: sel ? '#eff6ff' : hasDiff ? '#fff5f5' : i % 2 === 0 ? '#fff' : '#f8fafc',
                        cursor: isAdmin() ? 'pointer' : 'default',
                        borderLeft: `3px solid ${sel ? '#3b82f6' : 'transparent'}`,
                      }}
                    >
                      <td style={{ ...tdSt, textAlign: 'left', fontWeight: 600, color: '#374151' }}>
                        {giornoSettimana(g.data)} {fmtD(g.data)}
                      </td>
                      {/* RT1 */}
                      <td style={tdSt}>
                        {g.rt1.rt ? formatEuro(g.rt1.rt.totale_giorno) : <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                      <td style={tdSt}>
                        {g.rt1.pms.totale > 0 ? formatEuro(g.rt1.pms.totale) : <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                      <td style={{ ...tdSt, color: d1.color, fontWeight: 700, borderRight: '2px solid #e2e8f0' }}>
                        {d1.label}
                      </td>
                      {/* RT2 */}
                      <td style={tdSt}>
                        {g.rt2.rt ? formatEuro(g.rt2.rt.totale_giorno) : <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                      <td style={tdSt}>
                        {g.rt2.pms.totale > 0 ? formatEuro(g.rt2.pms.totale) : <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                      <td style={{ ...tdSt, color: d2.color, fontWeight: 700 }}>
                        {d2.label}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {isAdmin() && (
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                Clicca su una riga per inserire o modificare la chiusura RT del giorno.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Pannello inserimento (solo admin, solo con giorno selezionato) ── */}
      {isAdmin() && giornoSel && (
        <div style={{
          width: 340, flexShrink: 0,
          background: '#fff', border: '1px solid #e2e8f0',
          borderRadius: 10, padding: '1.25rem',
          boxShadow: '0 2px 12px #0001',
          position: 'sticky', top: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e3a5f' }}>
              {giornoSettimana(giornoSel)} {fmtD(giornoSel)}
            </span>
            <button
              onClick={() => setGiornoSel(null)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#94a3b8', lineHeight: 1 }}
            >✕</button>
          </div>

          <FormRT
            label="RT1 — DPH + CLB"
            prefix="rt1"
            form={form}
            setForm={setForm}
            onElimina={form.rt1_id ? () => eliminaRT('RT1', form.rt1_id) : null}
            pms={giornoDati?.rt1?.pms}
          />

          <div style={{ borderTop: '1px solid #e2e8f0', margin: '0.75rem 0' }} />

          <FormRT
            label="RT2 — INT"
            prefix="rt2"
            form={form}
            setForm={setForm}
            onElimina={form.rt2_id ? () => eliminaRT('RT2', form.rt2_id) : null}
            pms={giornoDati?.rt2?.pms}
          />

          <div style={{ borderTop: '1px solid #e2e8f0', margin: '0.75rem 0' }} />

          <label style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 4 }}>Note</label>
          <textarea
            rows={2}
            value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            style={{ ...inpSt, width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
          />

          {errPannello && <p style={{ color: '#dc2626', fontSize: '0.82rem', margin: '0.5rem 0 0' }}>{errPannello}</p>}
          {msgOk && <p style={{ color: '#16a34a', fontSize: '0.82rem', margin: '0.5rem 0 0' }}>{msgOk}</p>}

          <button
            onClick={salva}
            disabled={salvando}
            style={{
              marginTop: '0.75rem', width: '100%', padding: '9px',
              background: '#1e3a5f', color: '#fff', border: 'none',
              borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem',
            }}
          >{salvando ? 'Salvataggio…' : 'Salva chiusure RT'}</button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

const LS_TAB = 'corrispettivi_tab'
const LS_LORDO = 'corrispettivi_lordo'

const TABS_BASE = [
  { id: 'import', label: 'Import' },
  { id: 'giornalieri', label: 'Corrispettivi giornalieri' },
  { id: 'scontrini', label: 'Scontrini' },
  { id: 'fatture', label: 'Fatture' },
  { id: 'fatturati', label: 'Riepilogo Fatturati' },
  { id: 'rt', label: 'Controllo RT' },
  { id: 'rt-stampante', label: 'Stampante RT' },
  { id: 'analisi', label: 'Analisi Ricavi' },
]
const TABS_ADMIN = [
  ...TABS_BASE,
  { id: 'test', label: 'Dati di test' },
]

export default function Corrispettivi() {
  const tabsDisponibili = isAdmin() ? TABS_ADMIN : TABS_BASE
  const [tab, setTab] = useState(() => localStorage.getItem(LS_TAB) || 'giornalieri')
  const [hotels, setHotels] = useState([])
  const [lordo, setLordo] = useState(() => {
    const v = localStorage.getItem(LS_LORDO)
    return v === null ? true : v === 'true'
  })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    api.get('/hotels/').then(r => setHotels(r.data)).catch(() => {})
  }, [])

  const cambiaTab = (id) => {
    setTab(id)
    localStorage.setItem(LS_TAB, id)
  }
  const cambiaLordo = (v) => {
    setLordo(v)
    localStorage.setItem(LS_LORDO, String(v))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Corrispettivi</h1>

        {/* Toggle IVA globale */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#fff7ed', border: '1.5px solid #fdba74', borderRadius: 8, padding: '5px 8px' }}>
          <span style={{ fontSize: '0.85rem', color: '#9a3412', fontWeight: 600 }}>Valori:</span>
          <button onClick={() => cambiaLordo(true)} style={{
            padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: lordo ? 700 : 400,
            background: lordo ? '#ea580c' : 'transparent', color: lordo ? '#fff' : '#9a3412',
          }}>IVA inclusa</button>
          <button onClick={() => cambiaLordo(false)} style={{
            padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: !lordo ? 700 : 400,
            background: !lordo ? '#ea580c' : 'transparent', color: !lordo ? '#fff' : '#9a3412',
          }}>IVA esclusa</button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem', flexWrap: 'wrap', gap: 0 }}>
        {tabsDisponibili.map(t => (
          <button key={t.id} onClick={() => cambiaTab(t.id)} style={{
            padding: '8px 18px', border: 'none',
            borderBottom: tab === t.id ? '2px solid #1e3a5f' : '2px solid transparent',
            background: 'none', cursor: 'pointer', fontSize: '0.88rem',
            fontWeight: tab === t.id ? 700 : 400,
            color: tab === t.id ? '#1e3a5f' : '#64748b',
            marginBottom: -2, transition: 'all .15s',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Contenuto tab */}
      {tab === 'import' && (
        <TabImport onImportato={() => setRefreshKey(k => k + 1)} />
      )}
      {tab === 'giornalieri' && (
        <TabGiornalieri lordo={lordo} key={refreshKey} />
      )}
      {tab === 'scontrini' && (
        <TabDocumenti
          key={`sc_${refreshKey}`}
          endpoint="/corrispettivi/scontrini"
          tipo="scontrino"
          lordo={lordo}
          refreshKey={refreshKey}
        />
      )}
      {tab === 'fatture' && (
        <TabDocumenti
          key={`ft_${refreshKey}`}
          endpoint="/corrispettivi/fatture"
          tipo="fattura"
          lordo={lordo}
          refreshKey={refreshKey}
        />
      )}
      {tab === 'fatturati' && (
        <TabFatturati lordo={lordo} />
      )}
      {tab === 'rt' && (
        <TabControlloRT />
      )}
      {tab === 'rt-stampante' && (
        <TabStampanteRT hotels={hotels} isAdmin={isAdmin()} />
      )}
      {tab === 'analisi' && (
        <TabAnalisiRicavi hotels={hotels} isAdmin={isAdmin()} />
      )}
      {tab === 'test' && isAdmin() && (
        <TabTest onPulito={() => setRefreshKey(k => k + 1)} />
      )}
    </div>
  )
}
