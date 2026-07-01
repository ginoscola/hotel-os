/**
 * TabAnalisiRicavi — Analisi ricavi mensili per trattamento e reparto.
 * Caricamento CSV (auto-detect trattamenti/reparti), tabelle editabili inline,
 * vista per hotel e vista gruppo, toggle dettaglio/macrocategorie.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer } from 'recharts'
import api from '../api/client'
import { formatEuro, mostraErrore } from '../utils/format'

const MESI = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
              'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

const _oggi = new Date()
const MESE_DEFAULT = _oggi.getMonth() === 0 ? 12 : _oggi.getMonth()
const ANNO_DEFAULT = _oggi.getMonth() === 0 ? _oggi.getFullYear() - 1 : _oggi.getFullYear()

function pctFmt(v) {
  if (v == null) return '—'
  return v.toFixed(1) + '%'
}

// ── Palette categorie ─────────────────────────────────────────────────────────
const CATEGORIA_COLORI = {
  RO: '#fde047', BB: '#3b82f6', HB: '#10b981', FB: '#ea6a00', AI: '#ef4444',
}

// Palette generica per voci senza categoria
const PALETTE = [
  '#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#84cc16','#f97316','#ec4899','#14b8a6','#a78bfa',
]

// ── Colori voci (usata da tabella e torta) ────────────────────────────────────
function assegnaColori(voci) {
  let idx = 0
  return voci.filter(v => v.valore > 0).map(v => {
    const chiave = v.codice || v.categoria || v.reparto || ''
    // Priorità: colore salvato in DB → colore per categoria → palette generica
    const colore = v.colore || CATEGORIA_COLORI[v.categoria] || PALETTE[idx++ % PALETTE.length]
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
    <div style={{ marginTop: 16 }}>
      <ResponsiveContainer width="100%" height={440}>
        <PieChart>
          <Pie
            data={dati}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={160}
            innerRadius={72}
          >
            {dati.map((d, i) => (
              <Cell key={i} fill={d.colore} />
            ))}
          </Pie>
          <ReTooltip
            formatter={(val, name) => [formatEuro(val), name]}
            contentStyle={{ fontSize: 12 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

function categoriaBadge(cat) {
  if (!cat) return <span style={{ fontSize: 11, color: '#999' }}>—</span>
  const bg = CATEGORIA_COLORI[cat] || '#64748b'
  return (
    <span style={{ background: bg, color: '#fff', borderRadius: 4,
                   padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>
      {cat}
    </span>
  )
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
        value={tmp}
        onChange={e => setTmp(e.target.value)}
        onBlur={conferma}
        onKeyDown={e => { if (e.key === 'Enter') conferma(); if (e.key === 'Escape') setEditing(false) }}
        style={{ width: 90, fontSize: 13, textAlign: 'right', border: '1px solid #6366f1',
                 borderRadius: 4, padding: '1px 4px' }}
      />
    )
  }
  return (
    <span
      onClick={avvia}
      title={disabled ? '' : 'Clicca per modificare'}
      style={{ cursor: disabled ? 'default' : 'pointer', color: modificato ? '#f59e0b' : undefined,
               borderBottom: disabled ? 'none' : '1px dashed #cbd5e1' }}>
      {formatEuro(valore)}
      {modificato && <span title="Modificato manualmente" style={{ marginLeft: 4 }}>✏️</span>}
    </span>
  )
}

// ── Dot colore ────────────────────────────────────────────────────────────────
function DotColore({ colore }) {
  return (
    <span style={{ width: 10, height: 10, borderRadius: '50%', background: colore,
                   flexShrink: 0, display: 'inline-block' }} />
  )
}

// ── Tabella Trattamenti ───────────────────────────────────────────────────────
function TabellaTrattamenti({ hotelCode, anno, mese, meseFine, isAdmin, mostraDelta, vistaDettaglio }) {
  const [dati, setDati] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)

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
      await api.put(`/analisi-ricavi/trattamenti/${id}`, { valore: nuovoValore })
      carica()
    } catch (e) {
      alert(mostraErrore(e))
    }
  }

  if (loading) return <p style={{ color: '#64748b' }}>Caricamento...</p>
  if (errore) return <p style={{ color: '#ef4444' }}>{errore}</p>
  if (!dati || !dati.trattamenti.length) return <p style={{ color: '#64748b' }}>Nessun dato per questo periodo.</p>

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
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#1e293b', color: '#fff' }}>
            {vistaDettaglio && <th style={thS}>Codice</th>}
            <th style={thS}>{vistaDettaglio ? 'Nome' : 'Categoria'}</th>
            {vistaDettaglio && <th style={{ ...thS, textAlign: 'center' }}>Cat.</th>}
            <th style={{ ...thS, textAlign: 'right' }}>Valore</th>
            <th style={{ ...thS, textAlign: 'right' }}>%</th>
            {mostraDelta && dati.revenue_module && (
              <th style={{ ...thS, textAlign: 'right' }}>Δ Revenue</th>
            )}
          </tr>
        </thead>
        <tbody>
          {righeCon.map((t, i) => {
            const isEven = i % 2 === 0
            return (
              <tr key={vistaDettaglio ? t.codice : t.categoria}
                  style={{ background: isEven ? '#f8fafc' : '#fff' }}>
                {vistaDettaglio && (
                  <td style={tdS}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <DotColore colore={t._colore} />
                      <code style={{ fontSize: 12 }}>{t.codice}</code>
                    </span>
                  </td>
                )}
                <td style={tdS}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {!vistaDettaglio && <DotColore colore={t._colore} />}
                    {vistaDettaglio ? (t.nome_display || t.codice) : t.categoria}
                  </span>
                </td>
                {vistaDettaglio && <td style={{ ...tdS, textAlign: 'center' }}>{categoriaBadge(t.categoria)}</td>}
                <td style={{ ...tdS, textAlign: 'right' }}>
                  {vistaDettaglio ? (
                    <CellaValore
                      valore={t.valore}
                      modificato={t.modificato_manualmente}
                      onSalva={v => aggiornaValore(t.id, v)}
                      disabled={!isAdmin}
                    />
                  ) : formatEuro(t.valore)}
                </td>
                <td style={{ ...tdS, textAlign: 'right', color: '#64748b' }}>{pctFmt(t.pct)}</td>
                {mostraDelta && dati.revenue_module && (
                  <td style={{ ...tdS, textAlign: 'right' }}>—</td>
                )}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700, background: '#e2e8f0' }}>
            {vistaDettaglio && <td style={tdS} />}
            <td style={tdS}>Totale</td>
            {vistaDettaglio && <td style={tdS} />}
            <td style={{ ...tdS, textAlign: 'right' }}>{formatEuro(dati.totale)}</td>
            <td style={{ ...tdS, textAlign: 'right' }}>100%</td>
            {mostraDelta && dati.revenue_module && <td style={tdS} />}
          </tr>
        </tfoot>
      </table>
      {dati.n_non_classificati > 0 && (
        <p style={{ color: '#f59e0b', fontSize: 12, marginTop: 6 }}>
          ⚠ {dati.n_non_classificati} codic{dati.n_non_classificati > 1 ? 'i' : 'e'} non classificat{dati.n_non_classificati > 1 ? 'i' : 'o'} — configurare in Admin → Classificazione Trattamenti
        </p>
      )}
      <TortaRicavi voci={righe} totale={dati.totale} />
    </div>
  )
}

// ── Tabella Reparti ───────────────────────────────────────────────────────────
function TabellaReparti({ hotelCode, anno, mese, meseFine, isAdmin, mostraDelta }) {
  const [dati, setDati] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)

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
      await api.put(`/analisi-ricavi/reparti/${id}`, { valore: nuovoValore })
      carica()
    } catch (e) {
      alert(mostraErrore(e))
    }
  }

  if (loading) return <p style={{ color: '#64748b' }}>Caricamento...</p>
  if (errore) return <p style={{ color: '#ef4444' }}>{errore}</p>
  if (!dati || !dati.reparti.length) return <p style={{ color: '#64748b' }}>Nessun dato per questo periodo.</p>

  const rev = dati.revenue_module
  const deltaRev = mostraDelta && rev ? rev.revenue_totale : null
  const repartiCon = assegnaColori(dati.reparti.map(r => ({ ...r, nome_display: r.reparto })))

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#1e293b', color: '#fff' }}>
            <th style={thS}>Reparto</th>
            <th style={{ ...thS, textAlign: 'right' }}>Valore</th>
            <th style={{ ...thS, textAlign: 'right' }}>%</th>
            {mostraDelta && rev && <th style={{ ...thS, textAlign: 'right' }}>Rev. Module</th>}
            {mostraDelta && rev && <th style={{ ...thS, textAlign: 'right' }}>Δ</th>}
          </tr>
        </thead>
        <tbody>
          {repartiCon.map((r, i) => {
            const isEven = i % 2 === 0
            return (
              <tr key={r.reparto} style={{ background: isEven ? '#f8fafc' : '#fff' }}>
                <td style={tdS}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%',
                                   background: r._colore, flexShrink: 0, display: 'inline-block' }} />
                    {r.reparto}
                  </span>
                </td>
                <td style={{ ...tdS, textAlign: 'right' }}>
                  <CellaValore
                    valore={r.valore}
                    modificato={r.modificato_manualmente}
                    onSalva={v => aggiorna(r.id, v)}
                    disabled={!isAdmin}
                  />
                </td>
                <td style={{ ...tdS, textAlign: 'right', color: '#64748b' }}>{pctFmt(r.pct)}</td>
                {mostraDelta && rev && <td style={{ ...tdS, textAlign: 'right' }}>—</td>}
                {mostraDelta && rev && <td style={{ ...tdS, textAlign: 'right' }}>—</td>}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700, background: '#e2e8f0' }}>
            <td style={tdS}>Totale</td>
            <td style={{ ...tdS, textAlign: 'right' }}>{formatEuro(dati.totale)}</td>
            <td style={{ ...tdS, textAlign: 'right' }}>100%</td>
            {mostraDelta && rev && <td style={{ ...tdS, textAlign: 'right' }}>{formatEuro(rev.revenue_totale)}</td>}
            {mostraDelta && rev && (
              <td style={{ ...tdS, textAlign: 'right',
                           color: dati.totale > rev.revenue_totale ? '#10b981' : '#ef4444' }}>
                {formatEuro(dati.totale - rev.revenue_totale)}
              </td>
            )}
          </tr>
        </tfoot>
      </table>
      {mostraDelta && rev && (
        <p style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
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
  const [conferma, setConferma] = useState(null)   // per sovrascrittura
  const [storico, setStorico] = useState([])
  const dropRef = useRef()

  const caricaStorico = useCallback(async () => {
    try {
      const r = await api.get('/analisi-ricavi/import/storico')
      setStorico(r.data)
    } catch (e) { /* ignora */ }
  }, [])

  useEffect(() => { caricaStorico() }, [caricaStorico])

  const onDrop = e => {
    e.preventDefault()
    const nuovi = Array.from(e.dataTransfer?.files || e.target.files || [])
    setFiles(prev => [...prev, ...nuovi].slice(0, 2))
  }

  const rimuoviFile = i => setFiles(prev => prev.filter((_, j) => j !== i))

  const importa = async (sovrascrivi = false) => {
    if (!files.length) return alert('Selezionare almeno 1 file CSV')
    if (!hotelCode) return alert('Selezionare un hotel')
    setLoading(true)
    setMsg(null)
    setConferma(null)
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
        setConferma(e.response.data.detail || e.response.data)
      } else {
        setMsg({ tipo: 'err', testo: mostraErrore(e) })
      }
    } finally {
      setLoading(false)
    }
  }

  const elimina = async (id) => {
    if (!confirm('Eliminare questo import e tutti i dati collegati?')) return
    try {
      await api.delete(`/analisi-ricavi/import/${id}?conferma=true`)
      setStorico(prev => prev.filter(s => s.id !== id))
    } catch (e) {
      alert(mostraErrore(e))
    }
  }

  if (!isAdmin) return <p style={{ color: '#64748b' }}>Solo gli amministratori possono importare dati.</p>

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      {/* Form import */}
      <div style={{ flex: '0 0 360px', background: '#f8fafc', border: '1px solid #e2e8f0',
                    borderRadius: 8, padding: 20 }}>
        <h4 style={{ marginTop: 0 }}>Carica CSV ricavi</h4>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <select value={hotelCode} onChange={e => setHotelCode(e.target.value)}
                  style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1' }}>
            {hotels.map(h => <option key={h.code} value={h.code}>{h.code}</option>)}
          </select>
          <select value={mese} onChange={e => setMese(+e.target.value)}
                  style={{ flex: 1.5, padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1' }}>
            {MESI.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <input type="number" value={anno} onChange={e => setAnno(+e.target.value)}
                 min={2024} max={2030} style={{ width: 70, padding: '6px 8px', borderRadius: 6,
                 border: '1px solid #cbd5e1', textAlign: 'center' }} />
        </div>

        {/* Istruzioni origine file */}
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6,
                      padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#0c4a6e',
                      lineHeight: 1.6 }}>
          <strong>Da dove scaricare i file:</strong><br />
          Passbi → Analisi Ricavi → Dashboard analisi ricavi<br />
          • <em>Dettaglio ricavi trattamento</em><br />
          • <em>Dettaglio ricavi per trattamento</em><br />
          <span style={{ color: '#0369a1' }}>⏱ Da scaricare ogni fine mese per ogni hotel.</span>
        </div>

        {/* Drop zone */}
        <div
          ref={dropRef}
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
          style={{ border: '2px dashed #94a3b8', borderRadius: 8, padding: 24, textAlign: 'center',
                   cursor: 'pointer', background: '#fff', marginBottom: 12 }}
          onClick={() => dropRef.current.querySelector('input')?.click()}
        >
          <input type="file" accept=".csv" multiple style={{ display: 'none' }}
                 onChange={onDrop} />
          <div style={{ color: '#64748b', fontSize: 14 }}>
            Trascina qui i 2 file CSV oppure clicca per selezionarli
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            Auto-rileva trattamenti e reparti
          </div>
        </div>

        {/* File selezionati */}
        {files.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {files.map((f, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between',
                                    alignItems: 'center', fontSize: 13, padding: '4px 0',
                                    borderBottom: '1px solid #e2e8f0' }}>
                <span>📄 {f.name}</span>
                <button onClick={() => rimuoviFile(i)} style={btnDanger}>✕</button>
              </div>
            ))}
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                        marginBottom: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={isTest} onChange={e => setIsTest(e.target.checked)} />
          Dati di test
        </label>

        <button onClick={() => importa(false)} disabled={loading || !files.length}
                style={btnPrimary}>
          {loading ? 'Import in corso...' : 'Importa'}
        </button>

        {msg && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6,
                        background: msg.tipo === 'ok' ? '#d1fae5' : '#fee2e2',
                        color: msg.tipo === 'ok' ? '#065f46' : '#991b1b', fontSize: 13 }}>
            {msg.testo}
          </div>
        )}

        {/* Dialogo conferma sovrascrittura */}
        {conferma && (
          <div style={{ marginTop: 12, padding: 12, background: '#fef3c7', borderRadius: 6,
                        border: '1px solid #f59e0b' }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: '#92400e' }}>
              {conferma.messaggio || 'Esistono già dati per questo periodo.'}
              {conferma.n_trattamenti != null && ` (${conferma.n_trattamenti} trattamenti, ${conferma.n_reparti} reparti)`}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => importa(true)} style={btnWarning}>Sovrascrivi</button>
              <button onClick={() => setConferma(null)} style={btnSecondary}>Annulla</button>
            </div>
          </div>
        )}
      </div>

      {/* Storico import */}
      <div style={{ flex: 1, minWidth: 320 }}>
        <h4 style={{ marginTop: 0 }}>Storico import</h4>
        {storico.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: 13 }}>Nessun import effettuato.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#fff' }}>
                <th style={thS}>Hotel</th>
                <th style={thS}>Periodo</th>
                <th style={{ ...thS, textAlign: 'right' }}>Tratt.</th>
                <th style={{ ...thS, textAlign: 'right' }}>Rep.</th>
                <th style={thS}>Data</th>
                <th style={thS} />
              </tr>
            </thead>
            <tbody>
              {storico.map((s, i) => (
                <tr key={s.id} style={{ background: i % 2 === 0 ? '#f8fafc' : '#fff' }}>
                  <td style={tdS}>
                    <strong>{s.hotel_code}</strong>
                    {s.is_test && <span style={{ marginLeft: 4, fontSize: 10, background: '#fef9c3',
                                                color: '#854d0e', padding: '1px 5px', borderRadius: 4 }}>TEST</span>}
                  </td>
                  <td style={tdS}>{s.mese_nome} {s.anno}</td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{s.n_trattamenti}</td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{s.n_reparti}</td>
                  <td style={{ ...tdS, fontSize: 12, color: '#64748b' }}>
                    {s.created_at ? new Date(s.created_at).toLocaleDateString('it-IT') : '—'}
                  </td>
                  <td style={tdS}>
                    <button onClick={() => elimina(s.id)} style={btnDanger} title="Elimina">🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Vista Gruppo ───────────────────────────────────────────────────────────────
function VistGruppo({ anno, mese, meseFine, vistaDettaglio }) {
  const [dati, setDati] = useState(null)
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

  if (loading) return <p style={{ color: '#64748b' }}>Caricamento gruppo...</p>
  if (errore) return <p style={{ color: '#ef4444' }}>{errore}</p>
  if (!dati) return null

  const hotels = dati.hotel_codes

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
      <h4 style={{ marginBottom: 8 }}>Trattamenti — Gruppo</h4>
      {trattAmostare.length === 0 ? (
        <p style={{ color: '#64748b' }}>Nessun dato per questo periodo.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1e293b', color: '#fff' }}>
              <th style={thS}>{vistaDettaglio ? 'Codice' : 'Categoria'}</th>
              {vistaDettaglio && <th style={{ ...thS, textAlign: 'center' }}>Cat.</th>}
              {hotels.map(h => <th key={h} style={{ ...thS, textAlign: 'right' }}>{h}</th>)}
              <th style={{ ...thS, textAlign: 'right' }}>Totale</th>
              <th style={{ ...thS, textAlign: 'right' }}>%</th>
            </tr>
          </thead>
          <tbody>
            {trattAmostare.map((t, i) => {
              const isEven = i % 2 === 0
              const label = vistaDettaglio ? (t.nome_display || t.codice) : t.categoria
              return (
                <tr key={label} style={{ background: isEven ? '#f8fafc' : '#fff' }}>
                  <td style={tdS}>{label}</td>
                  {vistaDettaglio && <td style={{ ...tdS, textAlign: 'center' }}>{categoriaBadge(t.categoria)}</td>}
                  {hotels.map(h => (
                    <td key={h} style={{ ...tdS, textAlign: 'right', color: '#64748b' }}>
                      {t.per_hotel?.[h] ? formatEuro(t.per_hotel[h]) : '—'}
                    </td>
                  ))}
                  <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{formatEuro(t.valore)}</td>
                  <td style={{ ...tdS, textAlign: 'right', color: '#64748b' }}>{pctFmt(t.pct)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, background: '#e2e8f0' }}>
              <td style={tdS}>Totale</td>
              {vistaDettaglio && <td style={tdS} />}
              {hotels.map(h => (
                <td key={h} style={{ ...tdS, textAlign: 'right' }}>
                  {formatEuro(dati.trattamenti.filter(t => t.per_hotel?.[h]).reduce((s, t) => s + (t.per_hotel[h] || 0), 0))}
                </td>
              ))}
              <td style={{ ...tdS, textAlign: 'right' }}>{formatEuro(dati.totale_trattamenti)}</td>
              <td style={{ ...tdS, textAlign: 'right' }}>100%</td>
            </tr>
          </tfoot>
        </table>
      )}

      <h4 style={{ marginTop: 24, marginBottom: 8 }}>Reparti — Gruppo</h4>
      {dati.reparti.length === 0 ? (
        <p style={{ color: '#64748b' }}>Nessun dato.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1e293b', color: '#fff' }}>
              <th style={thS}>Reparto</th>
              {hotels.map(h => <th key={h} style={{ ...thS, textAlign: 'right' }}>{h}</th>)}
              <th style={{ ...thS, textAlign: 'right' }}>Totale</th>
              <th style={{ ...thS, textAlign: 'right' }}>%</th>
            </tr>
          </thead>
          <tbody>
            {dati.reparti.map((r, i) => (
              <tr key={r.reparto} style={{ background: i % 2 === 0 ? '#f8fafc' : '#fff' }}>
                <td style={tdS}>{r.reparto}</td>
                {hotels.map(h => (
                  <td key={h} style={{ ...tdS, textAlign: 'right', color: '#64748b' }}>
                    {r.per_hotel?.[h] ? formatEuro(r.per_hotel[h]) : '—'}
                  </td>
                ))}
                <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{formatEuro(r.valore)}</td>
                <td style={{ ...tdS, textAlign: 'right', color: '#64748b' }}>{pctFmt(r.pct)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, background: '#e2e8f0' }}>
              <td style={tdS}>Totale</td>
              {hotels.map(h => (
                <td key={h} style={{ ...tdS, textAlign: 'right' }}>
                  {formatEuro(dati.reparti.reduce((s, r) => s + (r.per_hotel?.[h] || 0), 0))}
                </td>
              ))}
              <td style={{ ...tdS, textAlign: 'right' }}>{formatEuro(dati.totale_reparti)}</td>
              <td style={{ ...tdS, textAlign: 'right' }}>100%</td>
            </tr>
          </tfoot>
        </table>
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
export default function TabAnalisiRicavi({ hotels, isAdmin }) {
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

  const HOTEL_BUTTONS = [
    ...hotels.map(h => ({ code: h.code, label: h.code })),
    { code: 'GRUPPO', label: 'Gruppo' },
  ]

  const btnHotel = (active) => ({
    padding: '6px 14px', borderRadius: 6, border: '1px solid #cbd5e1',
    cursor: 'pointer', fontWeight: active ? 700 : 400, fontSize: 13,
    background: active ? '#1e293b' : '#f8fafc',
    color: active ? '#fff' : '#374151',
    transition: 'all .15s',
  })

  const arrowBtn = {
    padding: '5px 10px', borderRadius: 6, border: '1px solid #cbd5e1',
    background: '#f8fafc', cursor: 'pointer', fontSize: 15, lineHeight: 1,
    color: '#374151',
  }

  return (
    <div>
      {/* Sub-nav */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid #e2e8f0',
                    paddingBottom: 0, alignItems: 'flex-end' }}>
        <button onClick={() => setShowImport(false)} style={{
          padding: '8px 16px', borderRadius: '6px 6px 0 0', border: 'none',
          cursor: 'pointer', fontWeight: !showImport ? 700 : 400,
          background: !showImport ? '#1e293b' : 'transparent',
          color: !showImport ? '#fff' : '#64748b',
          borderBottom: !showImport ? '2px solid #1e293b' : '2px solid transparent',
          marginBottom: -2,
        }}>Analisi</button>
        {isAdmin && (
          <button onClick={() => setShowImport(true)} style={{
            padding: '8px 16px', borderRadius: '6px 6px 0 0', border: 'none',
            cursor: 'pointer', fontWeight: showImport ? 700 : 400,
            background: showImport ? '#1e293b' : 'transparent',
            color: showImport ? '#fff' : '#64748b',
            borderBottom: showImport ? '2px solid #1e293b' : '2px solid transparent',
            marginBottom: -2,
          }}>Import</button>
        )}
      </div>

      {showImport ? (
        <SubtabImport hotels={hotels} isAdmin={isAdmin} />
      ) : (
        <>
          {/* Barra controlli */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center',
                        marginBottom: 16, flexWrap: 'wrap' }}>
            {/* Bottoni hotel */}
            <div style={{ display: 'flex', gap: 6 }}>
              {HOTEL_BUTTONS.map(h => (
                <button key={h.code} onClick={() => cambiaHotel(h.code)}
                        style={btnHotel(hotelSel === h.code)}>
                  {h.label}
                </button>
              ))}
            </div>

            {/* Divisore */}
            <div style={{ width: 1, height: 28, background: '#e2e8f0' }} />

            {/* Navigazione mese/anno */}
            <button style={arrowBtn} onClick={navIndietro}>◀</button>

            <select value={mese} onChange={e => setMese(+e.target.value)} style={selStyle}>
              {MESI.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>

            {rangeMode && (
              <>
                <span style={{ color: '#94a3b8', fontSize: 13 }}>—</span>
                <select value={meseFineEff} onChange={e => setMeseFine(+e.target.value)} style={selStyle}>
                  {MESI.slice(1).map((m, i) => (
                    <option key={i+1} value={i+1} disabled={i+1 < mese}>{m}</option>
                  ))}
                </select>
              </>
            )}

            <input type="number" value={anno} onChange={e => setAnno(+e.target.value)}
                   min={2024} max={2030}
                   style={{ ...selStyle, width: 78, textAlign: 'center' }} />

            <button style={arrowBtn} onClick={navAvanti}>▶</button>

            {/* Divisore */}
            <div style={{ width: 1, height: 28, background: '#e2e8f0' }} />

            {/* Toggle opzioni */}
            <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={rangeMode} onChange={e => toggleRange(e.target.checked)} />
              Range
            </label>
            <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={vistaDettaglio} onChange={e => setVistaDettaglio(e.target.checked)} />
              Dettaglio
            </label>
            {!isGruppo && (
              <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={mostraDelta} onChange={e => setMostraDelta(e.target.checked)} />
                Δ Revenue
              </label>
            )}
          </div>

          {/* Contenuto */}
          {isGruppo ? (
            <VistGruppo anno={anno} mese={mese} meseFine={meseFineEff} vistaDettaglio={vistaDettaglio} />
          ) : (
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 320 }}>
                <h4 style={{ marginTop: 0 }}>Trattamenti — {hotelSel}</h4>
                <TabellaTrattamenti
                  hotelCode={hotelSel} anno={anno} mese={mese} meseFine={meseFineEff}
                  isAdmin={isAdmin} mostraDelta={mostraDelta} vistaDettaglio={vistaDettaglio}
                />
              </div>
              <div style={{ flex: 1, minWidth: 280 }}>
                <h4 style={{ marginTop: 0 }}>Reparti — {hotelSel}</h4>
                <TabellaReparti
                  hotelCode={hotelSel} anno={anno} mese={mese} meseFine={meseFineEff}
                  isAdmin={isAdmin} mostraDelta={mostraDelta}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Stili ─────────────────────────────────────────────────────────────────────
const thS = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12 }
const tdS = { padding: '7px 12px', borderBottom: '1px solid #f1f5f9' }
const selStyle = { padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1',
                   fontSize: 14, background: '#fff' }
const btnPrimary = { padding: '8px 20px', background: '#1e293b', color: '#fff',
                     border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
                     fontSize: 14, width: '100%' }
const btnDanger = { padding: '2px 8px', background: 'transparent', color: '#ef4444',
                    border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer',
                    fontSize: 13 }
const btnWarning = { padding: '6px 14px', background: '#f59e0b', color: '#fff',
                     border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }
const btnSecondary = { padding: '6px 14px', background: '#e2e8f0', color: '#374151',
                       border: 'none', borderRadius: 6, cursor: 'pointer' }
