import { useState, useEffect, useRef, useCallback } from 'react'
import { PieChart, Pie, Cell, Tooltip as ReTooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../api/client'
import { formatEuro, formatPerc, mostraErrore } from '../utils/format'


const MESI = [
  '', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]

export default function Dipendenti() {
  const mesePrecedente = new Date()
  mesePrecedente.setMonth(mesePrecedente.getMonth() - 1)
  const [mese, setMese] = useState(mesePrecedente.getMonth() + 1)
  const [anno, setAnno] = useState(mesePrecedente.getFullYear())
  const [report, setReport] = useState(null)
  const [centri, setCentri] = useState([])
  const [dipendenti, setDipendenti] = useState([])
  const [storici, setStorici] = useState([])
  const [annoAnagrafica, setAnnoAnagrafica] = useState(new Date().getFullYear())
  const [cercaDipendente, setCercaDipendente] = useState('')
  const [sezione, setSezione] = useState('report')
  const [caricando, setCaricando] = useState(false)
  const [errore, setErrore] = useState(null)
  const [uploadState, setUploadState] = useState({ stato: 'idle', messaggio: '', risultato: null })
  const [isTest, setIsTest] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [voceExpanded, setVoceExpanded] = useState(null)
  const [testStats, setTestStats] = useState(null)
  const [cancellandoTest, setCancellandoTest] = useState(false)
  const [ccColori, setCcColori] = useState(null)
  const [ccColoriModificato, setCcColoriModificato] = useState(false)
  const [ccColoriSalvando, setCcColoriSalvando] = useState(false)
  const [ccColoriEsito, setCcColoriEsito] = useState(null)
  const [nuovoNomeColore, setNuovoNomeColore] = useState('')
  const [nuovaTintaColore, setNuovaTintaColore] = useState(120)
  const [reportTab, setReportTab] = useState('dipendenti')
  const [albero, setAlbero] = useState([])
  const [ricalcolandoTutto, setRicalcolandoTutto] = useState(false)
  const [esitoRicalcoloTutto, setEsitoRicalcoloTutto] = useState(null)
  const fileRef = useRef()

  const isAdmin = () => {
    try {
      const u = JSON.parse(localStorage.getItem('auth_user') || '{}')
      return u.ruolo === 'admin'
    } catch { return false }
  }

  const caricaTestStats = useCallback(() => {
    if (isAdmin()) {
      api.get('/dipendenti/admin/test-stats').then(r => setTestStats(r.data)).catch(() => {})
    }
  }, [])

  const handleRicalcolaTutto = async () => {
    if (!window.confirm(
      `Ricalcola le ripartizioni CC di tutti i dipendenti per l'anno ${anno}?\n\n` +
      'Verranno sovrascritte anche le impostazioni manuali.'
    )) return
    setRicalcolandoTutto(true)
    setEsitoRicalcoloTutto(null)
    try {
      const { data } = await api.post('/dipendenti/ricalcola-cc-anno', null, { params: { anno } })
      setEsitoRicalcoloTutto({ ok: true, messaggio: data.messaggio })
      caricaReport()
    } catch (err) {
      setEsitoRicalcoloTutto({ ok: false, messaggio: mostraErrore(err, 'Errore sconosciuto') })
    } finally {
      setRicalcolandoTutto(false)
    }
  }

  // Carica centri di costo (albero gerarchico) e anagrafica
  useEffect(() => {
    api.get('/config/cc-colori/mappa').then(r => {
      aggiornaColoriCC(r.data)
      setCcColori(r.data)
    }).catch(() => {})
    api.get('/cost-centers/albero').then(r => setAlbero(r.data)).catch(() => {})
    api.get('/cost-centers/').then(r => setCentri(r.data)).catch(() => {})
    api.get('/dipendenti/', { params: { anno: annoAnagrafica } }).then(r => setDipendenti(r.data)).catch(() => {})
    if (isAdmin()) {
      api.get('/dipendenti/import/storico').then(r => setStorici(r.data)).catch(() => {})
      caricaTestStats()
    }
  }, [])

  // Ricarica dipendenti quando cambia anno anagrafica
  useEffect(() => {
    api.get('/dipendenti/', { params: { anno: annoAnagrafica } }).then(r => setDipendenti(r.data)).catch(() => {})
  }, [annoAnagrafica])

  // Filtra dipendenti per testo di ricerca
  const dipendentiFiltrati = cercaDipendente.trim() === ''
    ? dipendenti
    : dipendenti.filter(d => {
        const q = cercaDipendente.toLowerCase()
        return (
          d.cognome?.toLowerCase().includes(q) ||
          d.nome?.toLowerCase().includes(q) ||
          d.codice_fiscale?.toLowerCase().includes(q) ||
          `${d.cognome} ${d.nome}`.toLowerCase().includes(q)
        )
      })

  // Carica report mensile (o annuale se mese === 0)
  const caricaReport = useCallback(() => {
    setCaricando(true)
    setErrore(null)
    const req = mese === 0
      ? api.get('/dipendenti/report/annuale-riepilogo', { params: { anno } })
      : api.get('/dipendenti/report/mensile', { params: { mese, anno } })
    req
      .then(r => setReport(r.data))
      .catch(e => {
        if (e.response?.status === 404) setReport(null)
        else setErrore(mostraErrore(e, 'Errore caricamento report'))
      })
      .finally(() => setCaricando(false))
  }, [mese, anno])

  useEffect(() => { caricaReport() }, [caricaReport])

  // Upload PDF
  const handleFile = async (file) => {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      setUploadState({ stato: 'errore', messaggio: 'Seleziona un file PDF', risultato: null })
      return
    }
    setUploadState({ stato: 'caricando', messaggio: 'Importazione in corso…', risultato: null })
    const form = new FormData()
    form.append('file', file)
    try {
      const r = await api.post(`/dipendenti/import?is_test=${isTest}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setUploadState({ stato: 'ok', messaggio: '', risultato: r.data })
      // Ricarica dati
      caricaReport()
      api.get('/dipendenti/').then(r => setDipendenti(r.data)).catch(() => {})
      api.get('/dipendenti/import/storico').then(r => setStorici(r.data)).catch(() => {})
      caricaTestStats()
    } catch (e) {
      setUploadState({ stato: 'errore', messaggio: mostraErrore(e, "Errore durante l'importazione"), risultato: null })
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    handleFile(file)
  }

  const aggiornaCCMensile = async (monthlyId, ccId, ccName) => {
    try {
      await api.put(`/dipendenti/monthly/${monthlyId}/centro-di-costo`, { cost_center_id: ccId })
      caricaReport()
    } catch {
      alert('Errore aggiornamento centro di costo')
    }
  }

  const eliminaTestData = async () => {
    if (!window.confirm('Cancellare tutti gli import di test (payroll) e i dati collegati?')) return
    setCancellandoTest(true)
    try {
      const r = await api.delete('/dipendenti/admin/test-data')
      alert(r.data.messaggio)
      caricaReport()
      api.get('/dipendenti/import/storico').then(r => setStorici(r.data)).catch(() => {})
      caricaTestStats()
    } catch (e) {
      alert(mostraErrore(e, 'Errore cancellazione dati di test'))
    } finally {
      setCancellandoTest(false)
    }
  }

  const salvaColoriCC = async () => {
    setCcColoriSalvando(true)
    setCcColoriEsito(null)
    try {
      await api.put('/config/cc-colori/mappa', ccColori)
      aggiornaColoriCC(ccColori)
      setCcColoriModificato(false)
      setCcColoriEsito({ ok: true, msg: 'Colori salvati correttamente.' })
    } catch (e) {
      setCcColoriEsito({ ok: false, msg: mostraErrore(e, 'Errore nel salvataggio.') })
    } finally {
      setCcColoriSalvando(false)
    }
  }

  const eliminaImport = async (id, label) => {
    if (!window.confirm(`Eliminare definitivamente l'import "${label}"?`)) return
    try {
      await api.delete(`/dipendenti/import/${id}`, { params: { conferma: true } })
      setStorici(s => s.filter(i => i.id !== id))
      caricaReport()
    } catch (e) {
      alert(mostraErrore(e, 'Errore eliminazione'))
    }
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      {/* Titolo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <span style={{ fontSize: 28 }}>👥</span>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1e293b' }}>Spese Dipendenti</h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>Gestione costi del personale</p>
        </div>
        {isAdmin() && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleRicalcolaTutto}
              disabled={ricalcolandoTutto}
              title={`Ricalcola le ripartizioni CC di tutti i dipendenti per il ${anno}`}
              style={{
                fontSize: 13, padding: '6px 14px', borderRadius: 6, cursor: ricalcolandoTutto ? 'wait' : 'pointer',
                border: '1px solid #d97706', background: ricalcolandoTutto ? '#fef3c7' : '#fffbeb',
                color: '#92400e', fontWeight: 600,
              }}
            >
              {ricalcolandoTutto ? '⏳ Aggiornando…' : '🔄 Aggiorna le ripartizioni'}
            </button>
            {esitoRicalcoloTutto && (
              <span style={{
                fontSize: 12, padding: '4px 8px', borderRadius: 4,
                background: esitoRicalcoloTutto.ok ? '#dcfce7' : '#fee2e2',
                color: esitoRicalcoloTutto.ok ? '#166534' : '#991b1b',
              }}>
                {esitoRicalcoloTutto.messaggio}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tab navigazione */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid #e2e8f0' }}>
        {[
          { id: 'report', label: 'Report mensile' },
          { id: 'analisi', label: 'Analisi CC' },
          { id: 'anagrafica', label: 'Anagrafica' },
          ...(isAdmin() ? [
            { id: 'import', label: 'Import PDF' },
            { id: 'storico', label: 'Storico import' },
          ] : []),
        ].map(t => (
          <button key={t.id} onClick={() => setSezione(t.id)} style={{
            padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: sezione === t.id ? 700 : 400,
            color: sezione === t.id ? '#d97706' : '#475569',
            borderBottom: sezione === t.id ? '2px solid #d97706' : '2px solid transparent',
            marginBottom: -2,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── SEZIONE REPORT ─────────────────────────────────────────────────── */}
      {sezione === 'report' && (
        <div>
          {/* Selettore periodo */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
            {mese !== 0 && (
              <button onClick={() => {
                const d = new Date(anno, mese - 2, 1)
                setMese(d.getMonth() + 1)
                setAnno(d.getFullYear())
              }} style={navBtnStyle} title="Mese precedente">‹</button>
            )}
            <select value={mese} onChange={e => setMese(Number(e.target.value))} style={selectStyle}>
              <option value={0}>Tutto l'anno</option>
              {MESI.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
            <select value={anno} onChange={e => setAnno(Number(e.target.value))} style={selectStyle}>
              {[2024, 2025, 2026, 2027].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {mese !== 0 && (
              <button onClick={() => {
                const d = new Date(anno, mese, 1)
                setMese(d.getMonth() + 1)
                setAnno(d.getFullYear())
              }} style={navBtnStyle} title="Mese successivo">›</button>
            )}
            <button onClick={caricaReport} style={btnStyle}>Aggiorna</button>
          </div>

          {caricando && <p style={{ color: '#64748b' }}>Caricamento…</p>}
          {errore && <p style={{ color: '#dc2626' }}>{errore}</p>}

          {!caricando && !report && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
              <p>Nessun dato per {mese === 0 ? `l'anno ${anno}` : `${MESI[mese]} ${anno}`}.<br />Importa un PDF dalla sezione "Import PDF".</p>
            </div>
          )}

          {report && (
            <>
              {/* Card KPI */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
                {[
                  { label: 'Dipendenti', value: report.n_dipendenti },
                  { label: 'Retrib. Netta Tot.', value: formatEuro(report.totale_netto) },
                  { label: 'Lordo Tot.', value: formatEuro(report.totale_lordo) },
                  { label: 'Costo Az. Tot.', value: formatEuro(report.totale_costo_aziendale) },
                ].map(k => (
                  <div key={k.label} style={cardStyle}>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{k.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#1e293b' }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* Sub-tab: Per Dipendente / Per Struttura */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #e2e8f0' }}>
                {[{ id: 'dipendenti', label: 'Per Dipendente' }, { id: 'struttura', label: 'Per Struttura/Reparto' }].map(t => (
                  <button key={t.id} onClick={() => setReportTab(t.id)} style={{
                    padding: '6px 14px', border: 'none', background: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: reportTab === t.id ? 700 : 400,
                    color: reportTab === t.id ? '#1e40af' : '#64748b',
                    borderBottom: reportTab === t.id ? '2px solid #1e40af' : '2px solid transparent',
                    marginBottom: -1,
                  }}>{t.label}</button>
                ))}
              </div>

              {/* ── Vista Per Struttura ── */}
              {reportTab === 'struttura' && (
                <div>
                  {(report.totali_per_struttura || []).length === 0 ? (
                    <p style={{ color: '#94a3b8' }}>Nessun dato per struttura disponibile.</p>
                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
                        {(report.totali_per_struttura || []).map(s => (
                          <div key={s.struttura_code} style={{ ...cardStyle, minWidth: 180 }}>
                            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 2 }}>{s.struttura_code}</div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>{s.struttura_name}</div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#d97706' }}>{formatEuro(s.costo_aziendale)}</div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>
                              {report.totale_costo_aziendale > 0
                                ? formatPerc(s.costo_aziendale / report.totale_costo_aziendale * 100)
                                : '—'} · {s.n_dipendenti} dip.
                            </div>
                          </div>
                        ))}
                      </div>
                      <table style={tableStyle}>
                        <thead>
                          <tr style={{ background: '#2d6a9f' }}>
                            {['Struttura', 'Costo Az. Totale', '% sul totale', 'N° Dipendenti'].map(h => (
                              <th key={h} style={thStyle}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(report.totali_per_struttura || []).map((s, idx) => (
                            <tr key={s.struttura_code} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                              <td style={{ ...tdStyle, fontWeight: 600 }}>
                                <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace', marginRight: 8 }}>{s.struttura_code}</span>
                                {s.struttura_name}
                              </td>
                              <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{formatEuro(s.costo_aziendale)}</td>
                              <td style={{ ...tdStyle, textAlign: 'right' }}>
                                {report.totale_costo_aziendale > 0
                                  ? formatPerc(s.costo_aziendale / report.totale_costo_aziendale * 100)
                                  : '—'}
                              </td>
                              <td style={{ ...tdStyle, textAlign: 'right' }}>{s.n_dipendenti}</td>
                            </tr>
                          ))}
                          <tr>
                            <td style={{ ...tdStyle, background: '#0f172a', color: '#fff', fontWeight: 700 }}>TOTALE</td>
                            <td style={{ ...tdStyle, background: '#0f172a', textAlign: 'right', color: '#fff', fontWeight: 700 }}>{formatEuro(report.totale_costo_aziendale)}</td>
                            <td style={{ ...tdStyle, background: '#0f172a', textAlign: 'right', color: '#fff', fontWeight: 700 }}>100%</td>
                            <td style={{ ...tdStyle, background: '#0f172a', textAlign: 'right', color: '#fff', fontWeight: 700 }}>{report.n_dipendenti}</td>
                          </tr>
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}

              {/* ── Vista Per Dipendente ── */}
              {reportTab === 'dipendenti' && (
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr style={{ background: '#2d6a9f' }}>
                      {['Dipendente', 'Centri di costo', 'Ret. Netta', 'Tot. Lordo', 'Contrib. Az.', 'TFR', 'Costo Totale', 'Incidenza%', ''].map(h => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.dipendenti.map((d, idx) => (
                      <>
                        <tr key={d.employee_id} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                          <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                              <button onClick={() => setVoceExpanded(voceExpanded === d.employee_id ? null : d.employee_id)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#64748b', padding: 0, flexShrink: 0 }}>
                                {voceExpanded === d.employee_id ? '▼' : '▶'}
                              </button>
                              <div>
                                <span style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>{d.cognome} {d.nome}</span>
                                <div style={{ fontSize: 11, color: '#94a3b8' }}>{d.codice_fiscale}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'left' }}>
                            <CCBadgeList centri={d.centri_di_costo} fallback={d.centro_di_costo} />
                            {d.override_manuale && <span title="CC modificato manualmente" style={{ marginLeft: 4, fontSize: 11 }}>✏️</span>}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{formatEuro(d.retribuzione_netta)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{formatEuro(d.totale_lordo)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            {formatEuro((d.voci.find(v => v.code === 'contr_prev_az')?.importo || 0) +
                              (d.voci.find(v => v.code === 'contr_san_az')?.importo || 0))}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            {formatEuro(d.voci.find(v => v.code === 'tfr')?.importo)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{formatEuro(d.costo_aziendale)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            {d.retribuzione_netta > 0
                              ? <IncidenzaBadge valore={(d.costo_aziendale - d.retribuzione_netta) / d.retribuzione_netta * 100} />
                              : '—'}
                          </td>
                          <td style={tdStyle}></td>
                        </tr>
                        {/* Dettaglio voci */}
                        {voceExpanded === d.employee_id && (
                          <tr key={`voci-${d.employee_id}`} style={{ background: '#fffbeb' }}>
                            <td colSpan={9} style={{ padding: '10px 24px' }}>
                              <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                                {/* Anagrafica professionale */}
                                <div style={{ minWidth: 180 }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', marginBottom: 6 }}>
                                    Inquadramento
                                  </div>
                                  {[
                                    { label: 'Qualifica', value: d.qualifica },
                                    { label: 'Mansione', value: d.mansione },
                                    { label: 'Livello', value: d.livello },
                                  ].map(r => (
                                    <div key={r.label} style={{ display: 'flex', gap: 8, fontSize: 12, color: '#374151', marginBottom: 3 }}>
                                      <span style={{ color: '#94a3b8', minWidth: 64 }}>{r.label}</span>
                                      <span style={{ fontWeight: 600 }}>{r.value || '—'}</span>
                                    </div>
                                  ))}
                                </div>
                                {/* Voci di costo */}
                                {['dipendente', 'azienda'].map(cat => (
                                  <div key={cat}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', marginBottom: 6 }}>
                                      {cat === 'dipendente' ? 'Voci dipendente' : 'Voci azienda'}
                                    </div>
                                    {d.voci.filter(v => v.categoria === cat).map(v => (
                                      <div key={v.code} style={{ display: 'flex', justifyContent: 'space-between', gap: 24, fontSize: 12, color: '#374151', marginBottom: 3 }}>
                                        <span>{v.name}</span>
                                        <span style={{ fontWeight: 600 }}>{formatEuro(v.importo)}</span>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                    {/* Riga totale */}
                    {(() => {
                      const totContribAz = report.dipendenti.reduce((s, d) =>
                        s + (d.voci.find(v => v.code === 'contr_prev_az')?.importo || 0)
                          + (d.voci.find(v => v.code === 'contr_san_az')?.importo || 0), 0)
                      const totTfr = report.dipendenti.reduce((s, d) =>
                        s + (d.voci.find(v => v.code === 'tfr')?.importo || 0), 0)
                      const incidenzaTot = report.totale_netto > 0
                        ? ((report.totale_costo_aziendale - report.totale_netto) / report.totale_netto * 100)
                        : null
                      return (
                        <tr>
                          <td style={{ ...tdStyle, background: '#0f172a', color: '#fff', fontWeight: 700 }}>TOTALE ({report.n_dipendenti} dip.)</td>
                          <td style={{ ...tdStyle, background: '#0f172a' }}></td>
                          <td style={{ ...tdStyle, background: '#0f172a', textAlign: 'right', color: '#fff', fontWeight: 700 }}>{formatEuro(report.totale_netto)}</td>
                          <td style={{ ...tdStyle, background: '#0f172a', textAlign: 'right', color: '#fff', fontWeight: 700 }}>{formatEuro(report.totale_lordo)}</td>
                          <td style={{ ...tdStyle, background: '#0f172a', textAlign: 'right', color: '#fff', fontWeight: 700 }}>{formatEuro(totContribAz)}</td>
                          <td style={{ ...tdStyle, background: '#0f172a', textAlign: 'right', color: '#fff', fontWeight: 700 }}>{formatEuro(totTfr)}</td>
                          <td style={{ ...tdStyle, background: '#0f172a', textAlign: 'right', color: '#fff', fontWeight: 700 }}>{formatEuro(report.totale_costo_aziendale)}</td>
                          <td style={{ ...tdStyle, background: '#0f172a', textAlign: 'right' }}>
                            {incidenzaTot != null ? <IncidenzaBadge valore={incidenzaTot} /> : '—'}
                          </td>
                          <td style={{ ...tdStyle, background: '#0f172a' }}></td>
                        </tr>
                      )
                    })()}
                  </tbody>
                </table>
              </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── SEZIONE ANALISI CC ─────────────────────────────────────────────── */}
      {sezione === 'analisi' && (
        <AnalisiCC />
      )}

      {/* ── SEZIONE ANAGRAFICA ──────────────────────────────────────────────── */}
      {sezione === 'anagrafica' && (
        <div>
          {/* Header con titolo, ricerca e selettore anno */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <h2 style={{ ...h2Style, margin: 0 }}>
              Anagrafica dipendenti
              {' '}
              <span style={{ fontSize: 14, fontWeight: 500, color: '#64748b' }}>
                ({cercaDipendente ? `${dipendentiFiltrati.length} di ${dipendenti.length}` : dipendenti.length})
              </span>
            </h2>
            <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 15, pointerEvents: 'none' }}>🔍</span>
              <input
                type="text"
                placeholder="Cerca per nome, cognome o CF…"
                value={cercaDipendente}
                onChange={e => setCercaDipendente(e.target.value)}
                style={{ ...inlineInputStyle, width: '100%', paddingLeft: 32, boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              <label style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>Anno:</label>
              <select
                value={annoAnagrafica}
                onChange={e => setAnnoAnagrafica(Number(e.target.value))}
                style={{ ...inlineInputStyle, width: 90, fontWeight: 700 }}>
                {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {dipendenti.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8 }}>
              Nessun dipendente con import nel {annoAnagrafica} — importa un PDF per aggiungere l'anagrafica
            </div>
          ) : dipendentiFiltrati.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8 }}>
              Nessun dipendente trovato per "<strong>{cercaDipendente}</strong>"
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dipendentiFiltrati.map((d, idx) => (
                <AnagraficaCard
                  key={d.id}
                  d={d}
                  idx={idx}
                  anno={annoAnagrafica}
                  albero={albero}
                  onSaved={aggiornato => setDipendenti(prev =>
                    prev.map(x => x.id === aggiornato.id ? { ...x, ...aggiornato } : x)
                  )}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SEZIONE IMPORT PDF ─────────────────────────────────────────────── */}
      {sezione === 'import' && isAdmin() && (
        <div style={{ maxWidth: 600 }}>
          <h2 style={h2Style}>Importa PDF costi personale</h2>
          <p style={{ color: '#64748b', fontSize: 13, marginBottom: 20 }}>
            Carica il PDF mensile dei costi aziendali. Il sistema estrae automaticamente
            i dati di tutti i dipendenti.
          </p>

          {/* Checkbox dati di test */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20,
            padding: '10px 14px', background: '#fffbeb', borderRadius: 8, border: '1px solid #fcd34d' }}>
            <input
              type="checkbox"
              id="isTestPdf"
              checked={isTest}
              onChange={e => setIsTest(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <label htmlFor="isTestPdf" style={{ cursor: 'pointer', fontSize: 13, color: '#92400e', fontWeight: 600 }}>
              Dati di test (cancellabili dalla sezione Admin)
            </label>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? '#d97706' : '#cbd5e1'}`,
              borderRadius: 12,
              padding: '40px 24px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragOver ? '#fffbeb' : '#f8fafc',
              transition: 'all 0.2s',
              marginBottom: 20,
            }}>
            <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])} />
            <div style={{ fontSize: 36, marginBottom: 8 }}>📤</div>
            <div style={{ fontWeight: 600, color: '#374151', marginBottom: 4 }}>
              Trascina il PDF qui o clicca per selezionare
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Solo file .pdf</div>
          </div>

          {/* Stato upload */}
          {uploadState.stato === 'caricando' && (
            <div style={{ padding: '12px 16px', background: '#eff6ff', borderRadius: 8, color: '#1d4ed8' }}>
              ⏳ {uploadState.messaggio}
            </div>
          )}
          {uploadState.stato === 'errore' && (
            <div style={{ padding: '12px 16px', background: '#fef2f2', borderRadius: 8, color: '#dc2626' }}>
              ❌ {uploadState.messaggio}
            </div>
          )}
          {uploadState.stato === 'ok' && uploadState.risultato && (
            <div style={{ padding: '16px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
              <div style={{ fontWeight: 700, color: '#15803d', marginBottom: 8 }}>
                ✅ Importazione completata
              </div>
              <div style={{ fontSize: 13, color: '#166534' }}>
                <div>Periodo: {MESI[uploadState.risultato.mese]} {uploadState.risultato.anno}</div>
                <div>Società: {uploadState.risultato.societa}</div>
                <div>Dipendenti importati: <strong>{uploadState.risultato.n_dipendenti}</strong></div>
                <div>Retrib. netta totale: <strong>{formatEuro(uploadState.risultato.totale_netto)}</strong></div>
                <div>Costo aziendale totale: <strong>{formatEuro(uploadState.risultato.totale_costo_aziendale)}</strong></div>
                {uploadState.risultato.nuovi_dipendenti?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <strong>Nuovi dipendenti:</strong>
                    <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                      {uploadState.risultato.nuovi_dipendenti.map(n => (
                        <li key={n} style={{ fontSize: 12 }}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {uploadState.risultato.warnings?.length > 0 && (
                  <div style={{ marginTop: 8, background: '#fef9c3', borderRadius: 6, padding: '8px 12px' }}>
                    <strong>⚠️ Warning:</strong>
                    <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                      {uploadState.risultato.warnings.map((w, i) => (
                        <li key={i} style={{ fontSize: 12 }}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {uploadState.risultato.pagine_non_parsate?.length > 0 && (
                  <div style={{ marginTop: 8, background: '#fef2f2', borderRadius: 6, padding: '8px 12px' }}>
                    <strong>❌ Pagine non parsate:</strong>
                    <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                      {uploadState.risultato.pagine_non_parsate.map((p, i) => (
                        <li key={i} style={{ fontSize: 12 }}>Pagina {p.pagina}: {p.errore}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <button onClick={() => { setSezione('report'); setMese(uploadState.risultato.mese); setAnno(uploadState.risultato.anno) }}
                style={{ ...btnStyle, marginTop: 12 }}>
                Vai al report {MESI[uploadState.risultato.mese]} {uploadState.risultato.anno}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── SEZIONE STORICO IMPORT ─────────────────────────────────────────── */}
      {sezione === 'storico' && isAdmin() && (
        <div>
          <h2 style={h2Style}>Storico import ({storici.length})</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: '#2d6a9f' }}>
                  {['ID', 'File', 'Periodo', 'Società', 'Dip.', 'Costo Az. Tot.', 'Stato', 'Azioni'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {storici.map((s, idx) => (
                  <tr key={s.id} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                    <td style={{ ...tdStyle, color: '#94a3b8', fontSize: 12 }}>{s.id}</td>
                    <td style={{ ...tdStyle, fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nome_file}</td>
                    <td style={tdStyle}>{MESI[s.mese]} {s.anno}</td>
                    <td style={tdStyle}>{s.societa || '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{s.n_dipendenti ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{formatEuro(s.totale_costo_aziendale)}</td>
                    <td style={tdStyle}>
                      <span style={{ background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: 12, fontSize: 11 }}>
                        {s.stato}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => eliminaImport(s.id, `${MESI[s.mese]} ${s.anno}`)}
                        style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>
                        Elimina
                      </button>
                    </td>
                  </tr>
                ))}
                {storici.length === 0 && (
                  <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8' }}>
                    Nessun import effettuato
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CARD ANAGRAFICA CON PANNELLO CC ─────────────────────────────────────────

function AnagraficaCard({ d, idx, anno, albero }) {
  const [espanso, setEspanso] = useState(false)
  const [ccDefaults, setCcDefaults] = useState(null)  // null = non ancora caricati
  const [editandoDefault, setEditandoDefault] = useState(false)
  const [ricalcolando, setRicalcolando] = useState(false)
  const [esitoRicalcolo, setEsitoRicalcolo] = useState(null)

  const isAdmin = () => {
    try { return JSON.parse(localStorage.getItem('auth_user') || '{}').ruolo === 'admin' } catch { return false }
  }

  // Carica i default CC quando il pannello viene aperto per la prima volta
  useEffect(() => {
    if (espanso && ccDefaults === null) {
      api.get(`/dipendenti/${d.id}/centri-di-costo`)
        .then(r => setCcDefaults(r.data))
        .catch(() => setCcDefaults([]))
    }
  }, [espanso, d.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDefaultSaved = (nuoviDefaults) => {
    setCcDefaults(nuoviDefaults)
    setEditandoDefault(false)
  }

  const handleRicalcola = async () => {
    if (!window.confirm(
      'Ricalcola le ripartizioni CC su tutti i mesi già importati?\n\n' +
      'I mesi con eccezione manuale rimarranno invariati.'
    )) return
    setRicalcolando(true)
    setEsitoRicalcolo(null)
    try {
      const { data } = await api.post(`/dipendenti/${d.id}/ricalcola-cc`)
      setEsitoRicalcolo({ ok: true, messaggio: data.messaggio })
    } catch (err) {
      setEsitoRicalcolo({ ok: false, messaggio: mostraErrore(err, 'Errore ricalcolo') })
    } finally {
      setRicalcolando(false)
      setTimeout(() => setEsitoRicalcolo(null), 4000)
    }
  }

  // Badge CC da mostrare nella riga riassuntiva
  const badgeCC = ccDefaults
    ? ccDefaults
    : (d.centro_di_costo ? [{ cost_center_id: d.centro_di_costo_id, cost_center_code: d.centro_di_costo, percentuale: 100 }] : [])

  return (
    <div style={{
      border: '1px solid #e2e8f0', borderRadius: 10,
      background: idx % 2 === 0 ? '#fff' : '#f8fafc',
      overflow: 'hidden',
    }}>
      {/* Riga riassuntiva — clic per espandere */}
      <div
        onClick={() => setEspanso(v => !v)}
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1.5fr auto',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          cursor: 'pointer',
          userSelect: 'none',
        }}>
        <div>
          <span style={{ fontWeight: 700, color: '#1e293b' }}>{d.cognome} {d.nome}</span>
          <span style={{ marginLeft: 8, color: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}>{d.codice_fiscale}</span>
        </div>
        <span style={{ color: '#64748b', fontSize: 13 }}>{d.qualifica || '—'}</span>
        <span style={{ color: '#64748b', fontSize: 13 }}>{d.mansione || '—'}</span>
        <span style={{ color: '#64748b', fontSize: 13 }}>{d.livello || '—'}</span>
        <div>
          {badgeCC.length > 0
            ? <CCInlineBadges centri={badgeCC} />
            : <span style={{ color: '#94a3b8', fontSize: 12 }}>N/A</span>
          }
        </div>
        <span style={{ color: '#94a3b8', fontSize: 12 }}>
          {d.email || d.cellulare || '—'}
        </span>
        <span style={{ color: '#94a3b8', fontSize: 16 }}>{espanso ? '▲' : '▼'}</span>
      </div>

      {/* Pannello espanso */}
      {espanso && (
        <div style={{
          borderTop: '1px solid #e2e8f0',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 0,
        }}>
          {/* Colonna sinistra — CC default */}
          <div style={{ padding: '16px 20px', borderRight: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
              Ripartizione default
            </div>
            {ccDefaults === null ? (
              <span style={{ color: '#94a3b8', fontSize: 13 }}>Caricamento…</span>
            ) : editandoDefault ? (
              <CCSplitEditor
                dipendente={d}
                albero={albero}
                initialCC={ccDefaults}
                onClose={() => setEditandoDefault(false)}
                onSaved={handleDefaultSaved}
                inline
              />
            ) : (
              <CCDefaultView defaults={ccDefaults} onEdit={isAdmin() ? () => setEditandoDefault(true) : null} />
            )}

            {/* Ricalcola ripartizioni sui mesi passati */}
            {isAdmin() && !editandoDefault && (
              <div style={{ marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
                <button
                  onClick={handleRicalcola}
                  disabled={ricalcolando}
                  style={{
                    fontSize: 12, padding: '4px 10px', borderRadius: 5, cursor: ricalcolando ? 'wait' : 'pointer',
                    border: '1px solid #cbd5e1', background: ricalcolando ? '#f1f5f9' : '#fff',
                    color: '#475569', display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  {ricalcolando ? '⏳' : '🔄'} Ricalcola mesi passati
                </button>
                {esitoRicalcolo && (
                  <div style={{
                    marginTop: 6, fontSize: 11, padding: '4px 8px', borderRadius: 4,
                    background: esitoRicalcolo.ok ? '#dcfce7' : '#fee2e2',
                    color: esitoRicalcolo.ok ? '#166534' : '#991b1b',
                  }}>
                    {esitoRicalcolo.messaggio}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Colonna destra — mesi dell'anno */}
          <div style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
              Mesi {anno} — eccezioni per mese
            </div>
            <MesiAnnoPanel dipendente={d} anno={anno} albero={albero} />
          </div>
        </div>
      )}
    </div>
  )
}

// Vista read-only dei default CC con pulsante modifica
function CCDefaultView({ defaults, onEdit }) {
  if (defaults.length === 0) {
    return (
      <div>
        <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 10 }}>
          Nessun default impostato — verranno usati KMDIMARE come fallback.
        </div>
        {onEdit && (
          <button onClick={onEdit} style={{ ...microBtnStyle, background: '#e0e7ff', color: '#3730a3', padding: '5px 14px', fontSize: 13 }}>
            + Imposta default
          </button>
        )}
      </div>
    )
  }

  const decorrenza = defaults[0]
  const label = `${MESI[decorrenza.mese_inizio]} ${decorrenza.anno_inizio}`

  return (
    <div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
        In vigore da {label}
        {decorrenza.anno_fine && ` · scade ${MESI[decorrenza.mese_fine]} ${decorrenza.anno_fine}`}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {defaults.map(cc => (
          <div key={cc.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              background: '#e0e7ff', color: '#3730a3',
              padding: '2px 10px', borderRadius: 10, fontSize: 13, fontWeight: 600, minWidth: 60, textAlign: 'center',
            }}>
              {cc.cost_center_code}
            </span>
            <span style={{ color: '#475569', fontSize: 13 }}>{cc.cost_center_name}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700, color: '#1e293b', fontSize: 13 }}>
              {cc.percentuale}%
            </span>
          </div>
        ))}
      </div>
      {onEdit && (
        <button onClick={onEdit} style={{ ...microBtnStyle, background: '#f1f5f9', color: '#475569', padding: '5px 14px', fontSize: 13 }}>
          ✏ Modifica
        </button>
      )}
    </div>
  )
}

// ─── PANEL MESI ANNO ──────────────────────────────────────────────────────────

function MesiAnnoPanel({ dipendente, anno, albero }) {
  const [mesi, setMesi] = useState(null)
  const [meseAperto, setMeseAperto] = useState(null)

  useEffect(() => {
    api.get(`/dipendenti/${dipendente.id}/anno/${anno}`)
      .then(r => setMesi(r.data))
      .catch(() => setMesi([]))
  }, [dipendente.id, anno])

  if (mesi === null) return <div style={{ color: '#94a3b8', fontSize: 13 }}>Caricamento…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {mesi.map(m => (
        <MeseRiga
          key={m.mese}
          mese={m}
          dipendente={dipendente}
          albero={albero}
          aperto={meseAperto === m.mese}
          onToggle={() => setMeseAperto(v => v === m.mese ? null : m.mese)}
          onSaved={aggiornatiCC => setMesi(prev =>
            prev.map(x => x.mese === m.mese ? { ...x, centri_di_costo: aggiornatiCC, override_manuale: true } : x)
          )}
        />
      ))}
    </div>
  )
}

function MeseRiga({ mese: m, dipendente, albero, aperto, onToggle, onSaved }) {
  const MESI_LABEL = ['', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']
  const haImport = m.import_id !== null
  const haOverride = m.override_manuale

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
      <div
        onClick={haImport ? onToggle : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px',
          background: haOverride ? '#fef3c7' : haImport ? '#f0fdf4' : '#f8fafc',
          cursor: haImport ? 'pointer' : 'default',
          userSelect: 'none',
        }}>
        <span style={{ fontWeight: 700, color: '#475569', width: 28, flexShrink: 0 }}>{MESI_LABEL[m.mese]}</span>
        {!haImport ? (
          <span style={{ fontSize: 12, color: '#cbd5e1' }}>nessun dato</span>
        ) : haOverride ? (
          <>
            <span style={{ fontSize: 11, background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: 8, marginRight: 4 }}>override</span>
            <CCInlineBadges centri={m.centri_di_costo} />
          </>
        ) : (
          <>
            <span style={{ fontSize: 11, color: '#64748b' }}>come default</span>
            <CCInlineBadges centri={m.centri_di_costo} />
          </>
        )}
        {haImport && (
          <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 13 }}>{aperto ? '▲' : '✏'}</span>
        )}
      </div>

      {aperto && haImport && (
        <div style={{ padding: '12px 14px', background: '#fff', borderTop: '1px solid #e2e8f0' }}>
          <CCSplitEditor
            dipendente={dipendente}
            albero={albero}
            importId={m.import_id}
            initialCC={m.centri_di_costo}
            onClose={onToggle}
            onSaved={nuoviCC => { onSaved(nuoviCC); onToggle() }}
            inline
            mensile
          />
        </div>
      )}
    </div>
  )
}

function CCInlineBadges({ centri }) {
  if (!centri || centri.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {centri.map(c => {
        const colori = getCCBadgeStyle(c.struttura_code, c.cost_center_name || c.cost_center_code)
        return (
          <span key={c.cost_center_id} style={{ ...colori, fontSize: 11, padding: '1px 6px', borderRadius: 8 }}>
            {c.struttura_code && <span style={{ fontWeight: 700, marginRight: 3 }}>{c.struttura_code}</span>}
            {c.cost_center_name || c.cost_center_code}
            {centri.length > 1 ? ` ${c.percentuale}%` : ''}
          </span>
        )
      })}
    </div>
  )
}


function CCBadgeList({ centri, fallback }) {
  if (!centri || centri.length === 0) {
    return <div style={{ textAlign: 'left', color: '#94a3b8', fontSize: 13 }}>{fallback || '—'}</div>
  }
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
      {centri.map(c => {
        const colori = getCCBadgeStyle(c.struttura_code, c.cost_center_name)
        return (
          <span key={c.cost_center_id} style={{ ...colori, padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>
            {c.struttura_code && <span style={{ fontWeight: 700, marginRight: 4 }}>{c.struttura_code}</span>}
            {c.cost_center_name}{centri.length > 1 ? ` ${c.percentuale}%` : ''}
          </span>
        )
      })}
    </div>
  )
}

// CCSplitEditor — usato sia per il default che per i mesi (prop mensile=true)
// Props:
//   inline: non mostra pulsante Annulla (pannello sempre visibile)
//   mensile: modalità mensile — salva su PUT centri-di-costo/mensile con importId
//   importId: obbligatorio se mensile=true
//   initialCC: lista CC di partenza (obbligatorio per default, opzionale per mensile)
function CCSplitEditor({ dipendente, albero, onClose, onSaved, inline = false, mensile = false, importId = null, initialCC = null }) {
  const oggi = new Date()
  const [righe, setRighe] = useState([{ cost_center_id: '', percentuale: 100 }])
  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState(null)
  const [salvato, setSalvato] = useState(false)
  // Se ci sono default esistenti usa la loro decorrenza, altrimenti gennaio dell'anno corrente
  const decorrenzaIniziale = initialCC?.length > 0 && initialCC[0].anno_inizio
    ? { anno: initialCC[0].anno_inizio, mese: initialCC[0].mese_inizio }
    : { anno: oggi.getFullYear(), mese: 1 }
  const [decAnno, setDecAnno] = useState(decorrenzaIniziale.anno)
  const [decMese, setDecMese] = useState(decorrenzaIniziale.mese)

  useEffect(() => {
    if (initialCC !== null) {
      setRighe(initialCC.length > 0
        ? initialCC.map(a => ({ cost_center_id: a.cost_center_id, percentuale: a.percentuale }))
        : [{ cost_center_id: '', percentuale: 100 }]
      )
    }
  }, [dipendente.id, importId])  // eslint-disable-line react-hooks/exhaustive-deps

  const somma = righe.reduce((s, r) => s + (parseFloat(r.percentuale) || 0), 0)
  const tuttiCCSelezionati = righe.every(r => r.cost_center_id !== '' && r.cost_center_id != null)
  const ccIds = righe.map(r => String(r.cost_center_id)).filter(Boolean)
  const hasDuplicati = ccIds.length !== new Set(ccIds).size
  const valida = Math.abs(somma - 100) <= 0.02 && tuttiCCSelezionati && !hasDuplicati

  const aggiornaRiga = (idx, campo, valore) => {
    setSalvato(false)
    setRighe(prev => prev.map((r, i) => i === idx ? { ...r, [campo]: valore } : r))
  }

  const distribuisciEquo = (elenco) => {
    const n = elenco.length
    if (n === 0) return elenco
    const base = Math.floor((100 / n) * 100) / 100
    const resto = Math.round((100 - base * n) * 100) / 100
    return elenco.map((r, i) => ({ ...r, percentuale: i === 0 ? Math.round((base + resto) * 100) / 100 : base }))
  }

  const salva = async () => {
    setErrore(null)
    if (!tuttiCCSelezionati) { setErrore('Seleziona un centro di costo per ogni riga'); return }
    if (!valida) { setErrore(`La somma deve essere 100% (attuale: ${somma.toFixed(2)}%)`); return }
    setSalvando(true)
    try {
      const assegnazioni = righe.map(r => ({
        cost_center_id: parseInt(r.cost_center_id),
        percentuale: parseFloat(r.percentuale),
      }))
      if (mensile) {
        const r = await api.put(`/dipendenti/${dipendente.id}/centri-di-costo/mensile`, {
          import_id: importId,
          assegnazioni,
        })
        onSaved(r.data.assegnazioni)
      } else {
        const r = await api.put(`/dipendenti/${dipendente.id}/centri-di-costo`, {
          assegnazioni,
          anno_inizio: decAnno,
          mese_inizio: decMese,
        })
        onSaved(r.data.assegnazioni)
        setSalvato(true)
        setTimeout(() => setSalvato(false), 2000)
        if (!inline) onClose()
      }
    } catch (err) {
      console.error('Errore salvataggio CC:', err.response || err)
      const detail = err.response?.data?.detail
      let msg
      if (Array.isArray(detail)) {
        msg = detail.map(e => `${e.loc?.slice(-1)[0] ?? ''}: ${e.msg}`).join(' | ')
      } else if (detail) {
        msg = detail
      } else if (err.response?.status) {
        msg = `Errore ${err.response.status} — ${err.response.statusText || 'risposta non valida dal server'}`
      } else {
        msg = err.message || 'Errore di rete'
      }
      setErrore(msg)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      {!mensile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          padding: '8px 10px', background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd' }}>
          <span style={{ fontSize: 12, color: '#0369a1', fontWeight: 600 }}>Decorrenza:</span>
          <select value={decMese} onChange={e => setDecMese(Number(e.target.value))}
            style={{ ...inlineInputStyle, fontSize: 12 }}>
            {MESI.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select value={decAnno} onChange={e => setDecAnno(Number(e.target.value))}
            style={{ ...inlineInputStyle, width: 80, fontSize: 12 }}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      )}
      {righe.map((r, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <select
            value={r.cost_center_id}
            onChange={e => aggiornaRiga(idx, 'cost_center_id', e.target.value)}
            style={{ flex: 1, ...inlineInputStyle, fontSize: 13 }}>
            <option value="">— Seleziona CC —</option>
            {albero.map(str =>
              (str.categorie || []).map(cat => (
                <optgroup key={cat.id} label={`${str.code} — ${cat.name}`}>
                  {cat.reparti.map(rep => (
                    <option key={rep.id} value={rep.id}>{rep.name}</option>
                  ))}
                </optgroup>
              ))
            )}
          </select>
          <input
            type="number" min="0" max="100" step="0.01"
            value={r.percentuale}
            onChange={e => aggiornaRiga(idx, 'percentuale', e.target.value)}
            style={{ ...inlineInputStyle, width: 70, textAlign: 'right' }}
          />
          <span style={{ fontSize: 12, color: '#64748b' }}>%</span>
          {righe.length > 1 && (
            <button onClick={() => setRighe(prev => prev.filter((_, i) => i !== idx))}
              style={{ ...microBtnStyle, background: '#fee2e2', color: '#dc2626' }}>✕</button>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <button onClick={() => {
            setSalvato(false)
            setRighe(prev => distribuisciEquo([...prev, { cost_center_id: '', percentuale: 0 }]))
          }}
          style={{ ...microBtnStyle, background: '#e0e7ff', color: '#3730a3', fontSize: 13, padding: '4px 12px' }}>
          + Aggiungi CC
        </button>
        <button
          onClick={() => { setSalvato(false); setRighe(prev => distribuisciEquo(prev)) }}
          title="Ripartisci equamente tra i CC selezionati"
          style={{ ...microBtnStyle, background: '#dcfce7', color: '#15803d', fontSize: 13, padding: '4px 12px' }}>
          ⚖ Equo
        </button>
        {hasDuplicati && (
          <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
            ⚠ CC duplicato
          </span>
        )}
        <span style={{ fontSize: 12, fontWeight: 700, color: valida ? '#15803d' : '#dc2626' }}>
          Totale: {somma.toFixed(1)}%
        </span>
      </div>

      {errore && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{errore}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <button onClick={salva} disabled={salvando || !valida}
          style={{ padding: '6px 16px', background: valida ? '#4338ca' : '#cbd5e1', color: '#fff', border: 'none', borderRadius: 6, cursor: valida ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: 13 }}>
          {salvando ? 'Salvataggio…' : 'Salva'}
        </button>
        {!inline && (
          <button onClick={onClose}
            style={{ padding: '6px 14px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            Annulla
          </button>
        )}
        {inline && mensile && (
          <button onClick={onClose}
            style={{ padding: '6px 14px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            Chiudi
          </button>
        )}
        {salvato && (
          <span style={{ color: '#15803d', fontWeight: 700, fontSize: 13 }}>✓ Salvato</span>
        )}
      </div>
    </div>
  )
}

function IncidenzaBadge({ valore }) {
  const colore = valore < 40 ? '#15803d' : valore <= 50 ? '#d97706' : '#dc2626'
  return (
    <span style={{ color: colore, fontWeight: 700 }}>
      {valore > 60 && <span title="Attenzione: incidenza oltre il budget" style={{ marginRight: 4 }}>⚠️</span>}
      {formatPerc(valore)}
    </span>
  )
}

// ─── ANALISI CC ───────────────────────────────────────────────────────────────

const MESI_BREVI = ['', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

function AnalisiCC() {
  const annoCorrente = new Date().getFullYear()
  const [anno, setAnno] = useState(annoCorrente)
  const [confronta, setConfronta] = useState(false)
  const [dati, setDati] = useState(null)
  const [datiPrec, setDatiPrec] = useState(null)
  const [caricando, setCaricando] = useState(false)
  const [errore, setErrore] = useState(null)

  const [granularita, setGranularita] = useState('reparto') // 'reparto' | 'categoria'
  const [barStruttureSel, setBarStruttureSel] = useState(new Set())
  const [barRaggruppa, setBarRaggruppa] = useState(false)
  const [barDettaglio, setBarDettaglio] = useState(null)
  const [dettaglioDip, setDettaglioDip] = useState(null)
  const [dettaglioCaricando, setDettaglioCaricando] = useState(false)

  // Selettore periodo: 'anno' | 'mese' | 'range'
  const [periodoTipo, setPeriodoTipo] = useState('anno')
  const [periodoMeseDa, setPeriodoMeseDa] = useState(1)
  const [periodoMeseA, setPeriodoMeseA] = useState(12)

  // Calcola mese_da / mese_a effettivi da passare alle API
  const meseDaEff = periodoTipo === 'anno' ? 1 : periodoMeseDa
  const meseAEff = periodoTipo === 'anno' ? 12 : periodoTipo === 'mese' ? periodoMeseDa : periodoMeseA

  // Carica report per l'anno/periodo selezionato
  useEffect(() => {
    setCaricando(true)
    setErrore(null)
    const params = { anno, mese_da: meseDaEff, mese_a: meseAEff }
    const richieste = [api.get('/dipendenti/report/annuale', { params })]
    if (confronta) {
      richieste.push(api.get('/dipendenti/report/annuale', { params: { ...params, anno: anno - 1 } }))
    }
    Promise.all(richieste)
      .then(([r1, r2]) => {
        setDati(r1.data)
        setDatiPrec(r2 ? r2.data : null)
        // Inizializza selezione strutture con tutte quelle disponibili
        const tutte = new Set(r1.data.centri.filter(c => c.struttura_code).map(c => c.struttura_code))
        setBarStruttureSel(tutte)
      })
      .catch(() => setErrore('Errore caricamento dati'))
      .finally(() => setCaricando(false))
  }, [anno, confronta, meseDaEff, meseAEff])

  const [vista, setVista] = useState('tutto')
  const [tortaVista, setTortaVista] = useState('reparto')

  // Strutture disponibili dai dati caricati
  const strutture = [...new Map(
    [...(dati?.centri || []), ...(datiPrec?.centri || [])]
      .filter(c => c.struttura_code)
      .map(c => [c.struttura_code, { code: c.struttura_code, name: c.struttura_name }])
  ).values()].sort((a, b) => a.name.localeCompare(b.name, 'it'))

  // Aggrega un array di centri per chiave
  const _aggrega = (arr, keyFn, extraFn) => {
    const mappa = new Map()
    arr.forEach(cc => {
      const key = keyFn(cc)
      if (!mappa.has(key)) mappa.set(key, { ...extraFn(cc), mesi: {}, totale: 0 })
      const agg = mappa.get(key)
      Object.entries(cc.mesi).forEach(([m, v]) => {
        if (!agg.mesi[m]) agg.mesi[m] = { costo: 0, n_dipendenti: 0 }
        agg.mesi[m].costo += v.costo
        agg.mesi[m].n_dipendenti += v.n_dipendenti
      })
      agg.totale += cc.totale
    })
    return [...mappa.values()].sort((a, b) => b.totale - a.totale)
  }

  // Trasforma centri in base alla vista (filtro struttura) e granularita (reparti vs categorie)
  const trasformaCentri = (centri) => {
    if (!centri) return []

    // Vista "KM Di Mare": somma tutti gli hotel per nome reparto/categoria (nessuna distinzione struttura)
    if (vista === 'kmdimare') {
      if (granularita === 'categoria') {
        return _aggrega(centri,
          cc => cc.parent_name || cc.name,
          cc => ({ code: `__kmdi_cat_${cc.parent_name || cc.name}`, name: cc.parent_name || cc.name,
                   tipo: 'categoria', struttura_code: null, struttura_name: null,
                   parent_code: null, parent_name: null })
        )
      }
      return _aggrega(centri,
        cc => cc.name,
        cc => ({ code: `__kmdi_${cc.name}`, name: cc.name, tipo: cc.tipo,
                 struttura_code: null, struttura_name: null,
                 parent_code: cc.parent_code, parent_name: cc.parent_name })
      )
    }

    // Filtro struttura
    const base = vista === 'tutto' ? [...centri] : centri.filter(cc => cc.struttura_code === vista)
    // Aggregazione per macrocategoria (con distinzione struttura)
    if (granularita === 'categoria') {
      return _aggrega(base,
        cc => `${cc.struttura_code || '__'}__${cc.parent_name || cc.name}`,
        cc => ({
          code: `__cat_${cc.struttura_code}_${cc.parent_name || cc.name}`,
          name: cc.parent_name || cc.name,
          tipo: 'categoria',
          struttura_code: cc.struttura_code,
          struttura_name: cc.struttura_name,
          parent_code: null,
          parent_name: null,
        })
      )
    }
    // granularita === 'reparto': mostra reparti individuali
    return base.sort((a, b) => b.totale - a.totale)
  }

  const centriVis = trasformaCentri(dati?.centri)
  const centriPrecVis = trasformaCentri(datiPrec?.centri)

  // Ricalcola totali per i centri visibili
  const totaliMeseVis = {}
  centriVis.forEach(cc => Object.entries(cc.mesi).forEach(([m, v]) => {
    totaliMeseVis[m] = (totaliMeseVis[m] || 0) + v.costo
  }))
  const totaliMesePrecVis = {}
  centriPrecVis.forEach(cc => Object.entries(cc.mesi).forEach(([m, v]) => {
    totaliMesePrecVis[m] = (totaliMesePrecVis[m] || 0) + v.costo
  }))
  const totaleAnnoVis = centriVis.reduce((s, cc) => s + cc.totale, 0)
  const totaleAnnoPrecVis = centriPrecVis.reduce((s, cc) => s + cc.totale, 0)

  // Calcola colonne (mesi da mostrare)
  const mesiCorrenti = dati?.mesi_disponibili || []
  const mesiPrec = datiPrec?.mesi_disponibili || []
  const mesiUnione = confronta
    ? [...new Set([...mesiCorrenti, ...mesiPrec])].sort((a, b) => a - b)
    : mesiCorrenti

  // Lookup costo per CC e mese
  const getCosto = (centri, ccCode, mese) => {
    const cc = centri?.find(c => c.code === ccCode)
    return cc?.mesi?.[String(mese)]?.costo ?? null
  }

  // Tutti i CC code presenti (unione vis corrente + precedente), ordinati per struttura poi reparto
  const allCCCodes = [...new Set([
    ...centriVis.map(c => c.code),
    ...centriPrecVis.map(c => c.code),
  ])].sort((a, b) => {
    const totA = centriVis.find(c => c.code === a)?.totale ?? centriPrecVis.find(c => c.code === a)?.totale ?? 0
    const totB = centriVis.find(c => c.code === b)?.totale ?? centriPrecVis.find(c => c.code === b)?.totale ?? 0
    return totB - totA
  })

  // Mappa code → oggetto CC (preferisce anno corrente)
  const ccByCode = {}
  ;[...centriVis, ...centriPrecVis].forEach(c => {
    if (!ccByCode[c.code]) ccByCode[c.code] = c
  })

  // Totale di riga per un CC nell'anno corrente
  const totaleCCAnno = (ccCode) => centriVis.find(c => c.code === ccCode)?.totale ?? 0

  const deltaPerc = (curr, prec) => {
    if (prec == null || prec === 0) return null
    return ((curr - prec) / prec) * 100
  }

  const cellaDelta = (curr, prec) => {
    if (curr == null || prec == null) return null
    const d = deltaPerc(curr, prec)
    if (d == null) return null
    const colore = d > 5 ? '#dc2626' : d < -5 ? '#16a34a' : '#92400e'
    const segno = d > 0 ? '+' : ''
    return <span style={{ fontSize: 10, color: colore, display: 'block', fontWeight: 600 }}>{segno}{d.toFixed(0)}%</span>
  }

  return (
    <div>
      {/* Header con controlli */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {/* Filtro struttura */}
        <select
          value={vista}
          onChange={e => setVista(e.target.value)}
          style={{ ...inlineInputStyle, fontWeight: 600, minWidth: 160 }}
        >
          <option value="tutto">Tutte le strutture</option>
          <option value="kmdimare">KM Di Mare (gruppo)</option>
          {strutture.map(s => (
            <option key={s.code} value={s.code}>{s.name}</option>
          ))}
        </select>
        {/* Toggle granularità */}
        <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
          {[{ v: 'reparto', label: 'Reparti' }, { v: 'categoria', label: 'Macrocategorie' }].map(({ v, label }) => (
            <button key={v} onClick={() => { setGranularita(v); setBarDettaglio(null) }} style={{
              padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: 13,
              fontWeight: granularita === v ? 700 : 400,
              background: granularita === v ? '#1e3a5f' : '#f8fafc',
              color: granularita === v ? '#fff' : '#64748b',
            }}>{label}</button>
          ))}
        </div>
        <h2 style={{ ...h2Style, margin: 0 }}>Analisi costi per centro di costo</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>Anno:</label>
          <select value={anno} onChange={e => setAnno(Number(e.target.value))}
            style={{ ...inlineInputStyle, width: 90, fontWeight: 700 }}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {/* Selettore periodo */}
          <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
            {[{ v: 'anno', label: 'Anno' }, { v: 'mese', label: 'Mese' }, { v: 'range', label: 'Range' }].map(({ v, label }) => (
              <button key={v} type="button" onClick={() => { setPeriodoTipo(v); setBarDettaglio(null) }} style={{
                padding: '5px 10px', border: 'none', cursor: 'pointer', fontSize: 12,
                fontWeight: periodoTipo === v ? 700 : 400,
                background: periodoTipo === v ? '#0f172a' : '#f8fafc',
                color: periodoTipo === v ? '#fff' : '#64748b',
              }}>{label}</button>
            ))}
          </div>
          {periodoTipo === 'mese' && (
            <select value={periodoMeseDa} onChange={e => { setPeriodoMeseDa(Number(e.target.value)); setBarDettaglio(null) }}
              style={{ ...inlineInputStyle, width: 110 }}>
              {['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'].map((m, i) => (
                <option key={i+1} value={i+1}>{m}</option>
              ))}
            </select>
          )}
          {periodoTipo === 'range' && (
            <>
              <select value={periodoMeseDa} onChange={e => { setPeriodoMeseDa(Number(e.target.value)); setBarDettaglio(null) }}
                style={{ ...inlineInputStyle, width: 110 }}>
                {['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'].map((m, i) => (
                  <option key={i+1} value={i+1}>{m}</option>
                ))}
              </select>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>→</span>
              <select value={periodoMeseA} onChange={e => { setPeriodoMeseA(Number(e.target.value)); setBarDettaglio(null) }}
                style={{ ...inlineInputStyle, width: 110 }}>
                {['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'].map((m, i) => (
                  <option key={i+1} value={i+1} disabled={i+1 < periodoMeseDa}>{m}</option>
                ))}
              </select>
            </>
          )}
          <button
            onClick={() => setConfronta(v => !v)}
            style={{
              padding: '5px 14px', border: '1px solid #e2e8f0', borderRadius: 6,
              background: confronta ? '#fef3c7' : '#f8fafc',
              color: confronta ? '#92400e' : '#64748b',
              cursor: 'pointer', fontSize: 13, fontWeight: confronta ? 700 : 400,
            }}>
            {confronta ? `vs ${anno - 1} ✓` : `vs ${anno - 1}`}
          </button>
        </div>
      </div>

      {caricando && <div style={{ color: '#94a3b8', fontSize: 13 }}>Caricamento…</div>}
      {errore && <div style={{ color: '#dc2626', fontSize: 13 }}>{errore}</div>}

      {dati && !caricando && (
        dati.mesi_disponibili.length === 0 && (!confronta || datiPrec?.mesi_disponibili.length === 0) ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8 }}>
            Nessun dato disponibile per il {anno}
          </div>
        ) : (
          <>
          <div style={{ display: 'flex', gap: 28, alignItems: 'stretch' }}>
          {/* ── Tabella ── */}
          <div style={{ overflowX: 'auto', flex: 1, minWidth: 0 }}>
            <table style={{ ...tableStyle, fontSize: 12 }}>
              <thead>
                {/* Riga anno se confronta attivo */}
                {confronta && (
                  <tr>
                    <th style={{ ...thStyle, background: '#1e293b' }}></th>
                    {mesiUnione.map(m => (
                      <th key={m} colSpan={2} style={{ ...thStyle, background: '#1e293b', textAlign: 'center', borderLeft: '1px solid #334155' }}>
                        {MESI_BREVI[m]}
                      </th>
                    ))}
                    <th colSpan={2} style={{ ...thStyle, background: '#1e293b', textAlign: 'center', borderLeft: '1px solid #334155' }}>Totale</th>
                  </tr>
                )}
                <tr style={{ background: '#2d6a9f' }}>
                  <th style={{ ...thStyle, minWidth: 160 }}>Centro di costo</th>
                  {mesiUnione.map(m => (
                    confronta ? (
                      <>
                        <th key={`${m}-curr`} style={{ ...thStyle, textAlign: 'right', borderLeft: '1px solid #3b82f6', minWidth: 90, background: '#2d6a9f' }}>
                          {anno}
                        </th>
                        <th key={`${m}-prec`} style={{ ...thStyle, textAlign: 'right', minWidth: 80, background: '#374f6b', fontSize: 11 }}>
                          {anno - 1}
                        </th>
                      </>
                    ) : (
                      <th key={m} style={{ ...thStyle, textAlign: 'right', minWidth: 100 }}>
                        {MESI_BREVI[m]}
                      </th>
                    )
                  ))}
                  {confronta ? (
                    <>
                      <th style={{ ...thStyle, textAlign: 'right', borderLeft: '1px solid #3b82f6', minWidth: 100 }}>Totale {anno}</th>
                      <th style={{ ...thStyle, textAlign: 'right', minWidth: 90, background: '#374f6b', fontSize: 11 }}>Tot. {anno - 1}</th>
                    </>
                  ) : (
                    <th style={{ ...thStyle, textAlign: 'right', minWidth: 100 }}>Totale</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {allCCCodes.map((code, idx) => {
                  const cc = ccByCode[code]
                  const totAnno = totaleCCAnno(code)
                  const totPrec = centriPrecVis.find(c => c.code === code)?.totale ?? null
                  return (
                    <tr key={code} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                      <td style={{ ...tdStyle }}>
                        {(cc.struttura_code || cc.parent_name) && (
                          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                            {cc.struttura_code && (
                              <span style={{ fontWeight: 700, fontFamily: 'monospace',
                                background: '#e0e7ff', color: '#3730a3',
                                padding: '0px 4px', borderRadius: 3, fontSize: 10 }}>
                                {cc.struttura_code}
                              </span>
                            )}
                            {cc.parent_name && (
                              <span style={{ fontWeight: 500 }}>{cc.parent_name}</span>
                            )}
                          </div>
                        )}
                        <span style={{ fontWeight: 600 }}>{cc.name}</span>
                      </td>
                      {mesiUnione.map(m => {
                        const curr = getCosto(centriVis, code, m)
                        const prec = datiPrec ? getCosto(centriPrecVis, code, m) : null
                        return confronta ? (
                          <>
                            <td key={`${m}-curr`} style={{ ...tdStyle, textAlign: 'right', borderLeft: '1px solid #e2e8f0' }}>
                              {curr != null ? (
                                <>
                                  <span>{formatEuro(curr)}</span>
                                  {cellaDelta(curr, prec)}
                                </>
                              ) : <span style={{ color: '#e2e8f0' }}>—</span>}
                            </td>
                            <td key={`${m}-prec`} style={{ ...tdStyle, textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>
                              {prec != null ? formatEuro(prec) : <span style={{ color: '#e2e8f0' }}>—</span>}
                            </td>
                          </>
                        ) : (
                          <td key={m} style={{ ...tdStyle, textAlign: 'right' }}>
                            {curr != null ? formatEuro(curr) : <span style={{ color: '#e2e8f0' }}>—</span>}
                          </td>
                        )
                      })}
                      {confronta ? (
                        <>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, borderLeft: '1px solid #e2e8f0' }}>
                            {totAnno > 0 ? formatEuro(totAnno) : <span style={{ color: '#e2e8f0' }}>—</span>}
                            {totPrec != null && cellaDelta(totAnno, totPrec)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>
                            {totPrec != null ? formatEuro(totPrec) : <span style={{ color: '#e2e8f0' }}>—</span>}
                          </td>
                        </>
                      ) : (
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>
                          {totAnno > 0 ? formatEuro(totAnno) : <span style={{ color: '#e2e8f0' }}>—</span>}
                        </td>
                      )}
                    </tr>
                  )
                })}

                {/* Riga totali */}
                <tr>
                  <td style={{ ...tdStyle, background: '#0f172a', color: '#fff', fontWeight: 700 }}>TOTALE</td>
                  {mesiUnione.map(m => {
                    const curr = totaliMeseVis[String(m)] ?? null
                    const prec = totaliMesePrecVis[String(m)] ?? null
                    return confronta ? (
                      <>
                        <td key={`${m}-curr`} style={{ ...tdStyle, background: '#0f172a', textAlign: 'right', color: '#fff', fontWeight: 700, borderLeft: '1px solid #334155' }}>
                          {curr != null ? formatEuro(curr) : '—'}
                          {curr != null && prec != null && cellaDelta(curr, prec)}
                        </td>
                        <td key={`${m}-prec`} style={{ ...tdStyle, background: '#1e293b', textAlign: 'right', color: '#cbd5e1', fontSize: 12, fontWeight: 600 }}>
                          {prec != null ? formatEuro(prec) : '—'}
                        </td>
                      </>
                    ) : (
                      <td key={m} style={{ ...tdStyle, background: '#0f172a', textAlign: 'right', color: '#fff', fontWeight: 700 }}>
                        {curr != null ? formatEuro(curr) : '—'}
                      </td>
                    )
                  })}
                  {confronta ? (
                    <>
                      <td style={{ ...tdStyle, background: '#0f172a', textAlign: 'right', color: '#fff', fontWeight: 700, borderLeft: '1px solid #334155' }}>
                        {formatEuro(totaleAnnoVis)}
                        {datiPrec && cellaDelta(totaleAnnoVis, totaleAnnoPrecVis)}
                      </td>
                      <td style={{ ...tdStyle, background: '#1e293b', textAlign: 'right', color: '#cbd5e1', fontSize: 12, fontWeight: 600 }}>
                        {datiPrec ? formatEuro(totaleAnnoPrecVis) : '—'}
                      </td>
                    </>
                  ) : (
                    <td style={{ ...tdStyle, background: '#0f172a', textAlign: 'right', color: '#fff', fontWeight: 700 }}>
                      {formatEuro(totaleAnnoVis)}
                    </td>
                  )}
                </tr>
              </tbody>
            </table>

            {/* Legenda */}
            <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8', display: 'flex', gap: 16 }}>
              <span>Dati {anno}: {dati.mesi_disponibili.length} {dati.mesi_disponibili.length === 1 ? 'mese' : 'mesi'} importati</span>
              {confronta && datiPrec && (
                <span>Dati {anno - 1}: {datiPrec.mesi_disponibili.length} {datiPrec.mesi_disponibili.length === 1 ? 'mese' : 'mesi'} importati</span>
              )}
              {confronta && (
                <span>
                  <span style={{ color: '#dc2626', fontWeight: 700 }}>+%</span> = aumento &nbsp;
                  <span style={{ color: '#16a34a', fontWeight: 700 }}>-%</span> = riduzione
                </span>
              )}
            </div>
          </div>{/* fine tabella */}

          {/* ── Grafico a torta ── */}
          {(() => {
            const STRUTTURA_COLORI = {
              DPH: '#3b82f6', CLB: '#10b981', INT: '#f59e0b',
              MMS: '#8b5cf6', BON: '#ef4444',
            }

            const dataTortaReparto = allCCCodes
              .map(code => ({
                name: ccByCode[code]?.name ?? code,
                struttura: ccByCode[code]?.struttura_name ?? null,
                value: totaleCCAnno(code),
                colore: getCCFillColor(ccByCode[code]?.struttura_code, ccByCode[code]?.name ?? code),
              }))
              .filter(d => d.value > 0)

            // Vista per struttura: raggruppa per struttura_code e somma
            const perStruttura = {}
            allCCCodes.forEach(code => {
              const cc = ccByCode[code]
              const sc = cc?.struttura_code
              if (!sc) return
              const v = totaleCCAnno(code)
              if (!perStruttura[sc]) perStruttura[sc] = { name: cc.struttura_name ?? sc, struttura_code: sc, value: 0 }
              perStruttura[sc].value += v
            })
            const dataTortaStruttura = Object.values(perStruttura)
              .filter(d => d.value > 0)
              .sort((a, b) => b.value - a.value)
              .map(d => ({ ...d, colore: STRUTTURA_COLORI[d.struttura_code] ?? '#94a3b8' }))

            const dataTorta = tortaVista === 'struttura' ? dataTortaStruttura : dataTortaReparto
            const totale = dataTorta.reduce((s, d) => s + d.value, 0)
            if (dataTorta.length === 0) return null

            const btnToggle = (attivo) => ({
              padding: '3px 10px', fontSize: 11, border: 'none', borderRadius: 4,
              cursor: 'pointer', fontWeight: attivo ? 700 : 400,
              background: attivo ? '#1e293b' : '#f1f5f9',
              color: attivo ? '#fff' : '#64748b',
            })

            return (
              <div style={{ flexShrink: 0, width: 320, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 6, textAlign: 'center' }}>
                  Ripartizione {anno}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginBottom: 6 }}>
                  <button style={btnToggle(tortaVista === 'reparto')} onClick={() => setTortaVista('reparto')}>Per reparto</button>
                  <button style={btnToggle(tortaVista === 'struttura')} onClick={() => setTortaVista('struttura')}>Per struttura</button>
                </div>
                <PieChart width={300} height={240}>
                  <Pie
                    data={dataTorta}
                    cx={148}
                    cy={116}
                    innerRadius={66}
                    outerRadius={110}
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {dataTorta.map((d, i) => (
                      <Cell key={i} fill={d.colore} />
                    ))}
                  </Pie>
                  <ReTooltip
                    formatter={(value, name) => [formatEuro(value), name]}
                    contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  />
                </PieChart>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4, flex: 1, overflowY: 'auto' }}>
                  {[...dataTorta].sort((a, b) => b.value - a.value).map((d, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: d.colore, flexShrink: 0 }} />
                      <span style={{ flex: 1, color: '#475569', lineHeight: 1.2 }}>
                        {tortaVista === 'reparto' && d.struttura && (
                          <span style={{ fontSize: 10, color: '#94a3b8', display: 'block' }}>{d.struttura}</span>
                        )}
                        {d.name}
                      </span>
                      <span style={{ fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap' }}>
                        {totale > 0 ? (d.value / totale * 100).toFixed(1) : '0'}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          </div>

          {/* ── Grafico a barre full-width: totale annuo per CC ── */}
          {(() => {
            // Base: centri grezzi (non aggregati) per il grafico a barre
            const tuttiCentriGrezzi = (dati?.centri || []).filter(cc => cc.totale > 0)
            const struttureDispo = [...new Set(tuttiCentriGrezzi.filter(c => c.struttura_code).map(c => c.struttura_code))].sort()
            if (tuttiCentriGrezzi.length === 0) return null

            // Filtra coerentemente con la vista selezionata
            const mostraCheckbox = vista === 'tutto'
            const grezziPerBar = vista === 'kmdimare'
              ? tuttiCentriGrezzi                                          // tutto, aggregato per nome
              : vista === 'tutto'
                ? tuttiCentriGrezzi.filter(cc => !cc.struttura_code || barStruttureSel.has(cc.struttura_code))
                : tuttiCentriGrezzi.filter(cc => cc.struttura_code === vista) // struttura specifica

            const handleBarClick = (payload) => {
              if (!payload?.activePayload?.[0]) return
              const d = payload.activePayload[0].payload
              setBarDettaglio(d)
              setDettaglioCaricando(true)
              setDettaglioDip(null)
              const params = { anno }
              const usaCategoria = granularita === 'categoria'
              const usaNome = !usaCategoria && (barRaggruppa || vista === 'kmdimare' || !d.ccCode)
              if (usaCategoria) {
                // Macrocategorie: cerca reparti il cui parent ha questo nome
                params.cat_name = d.ccName ?? d.name
                if (d.struttura_code) {
                  // Ogni barra ha una struttura specifica — filtra solo su quella
                  params.strutture = d.struttura_code
                } else if (vista === 'tutto' && barStruttureSel.size > 0) {
                  params.strutture = [...barStruttureSel].join(',')
                }
                // kmdimare o barre aggregate: nessun filtro struttura
              } else if (usaNome) {
                params.cc_name = d.ccName ?? d.name
                if (vista === 'tutto' && barStruttureSel.size > 0)
                  params.strutture = [...barStruttureSel].join(',')
                else if (vista !== 'tutto' && vista !== 'kmdimare')
                  params.strutture = vista
              } else {
                params.cc_code = d.ccCode
              }
              params.mese_da = meseDaEff
              params.mese_a = meseAEff
              api.get('/dipendenti/report/annuale/dettaglio-cc', { params })
                .then(r => setDettaglioDip(r.data))
                .catch(() => setDettaglioDip([]))
                .finally(() => setDettaglioCaricando(false))
            }

            let dataBar
            if (vista === 'kmdimare' || barRaggruppa) {
              // Somma per nome (reparto o categoria) senza distinzione struttura
              const keyFn = granularita === 'categoria'
                ? cc => cc.parent_name || cc.name
                : cc => cc.name
              const extraFn = granularita === 'categoria'
                ? cc => ({ name: cc.parent_name || cc.name, ccName: cc.parent_name || cc.name, struttura: null, struttura_code: null, totale: 0 })
                : cc => ({ name: cc.name, ccName: cc.name, struttura: null, struttura_code: null, totale: 0 })
              dataBar = _aggrega(grezziPerBar, keyFn, extraFn)
            } else if (granularita === 'categoria') {
              // Aggrega per struttura × macrocategoria
              dataBar = _aggrega(
                grezziPerBar,
                cc => `${cc.struttura_code || '__'}__${cc.parent_name || cc.name}`,
                cc => ({
                  name: cc.struttura_code ? `${cc.struttura_code} · ${cc.parent_name || cc.name}` : (cc.parent_name || cc.name),
                  ccName: cc.parent_name || cc.name,
                  struttura: cc.struttura_name ?? null,
                  struttura_code: cc.struttura_code,
                  totale: 0,
                })
              )
            } else {
              dataBar = grezziPerBar.map(cc => ({
                name: cc.struttura_code ? `${cc.struttura_code} · ${cc.name}` : cc.name,
                ccName: cc.name,
                ccCode: cc.code,
                struttura: cc.struttura_name ?? null,
                struttura_code: cc.struttura_code,
                totale: cc.totale,
              }))
            }
            dataBar = dataBar
              .sort((a, b) => b.totale - a.totale)
              .map(d => ({ ...d, colore: getCCFillColor(d.struttura_code, d.ccName ?? d.name) }))

            if (dataBar.length === 0) return (
              <div style={{ marginTop: 28, padding: '24px', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                Nessuna struttura selezionata
              </div>
            )

            return (
              <div style={{ marginTop: 28, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 20px' }}>
                {/* Header + checkboxes */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                    Costo totale per centro di costo — {anno}
                  </span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
                    {mostraCheckbox && struttureDispo.map(s => (
                      <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none' }}>
                        <input
                          type="checkbox"
                          checked={barStruttureSel.has(s)}
                          onChange={() => {
                            const next = new Set(barStruttureSel)
                            if (next.has(s)) next.delete(s); else next.add(s)
                            setBarStruttureSel(next)
                            setBarDettaglio(null)
                          }}
                          style={{ accentColor: getCCFillColor(s, 'a'), width: 14, height: 14 }}
                        />
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{s}</span>
                      </label>
                    ))}
                    {mostraCheckbox && <div style={{ width: 1, height: 18, background: '#e2e8f0', margin: '0 4px' }} />}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={barRaggruppa}
                        onChange={() => { setBarRaggruppa(v => !v); setBarDettaglio(null) }}
                        style={{ width: 14, height: 14 }}
                      />
                      <span style={{ fontSize: 12, color: '#475569' }}>Somma gruppo</span>
                    </label>
                  </div>
                </div>

                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={dataBar} margin={{ top: 4, right: 16, left: 16, bottom: 60 }} onClick={handleBarClick} style={{ cursor: 'pointer' }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k €` : `${v} €`} tick={{ fontSize: 11 }} width={64} />
                    <Tooltip
                      formatter={(value, _n, props) => [formatEuro(value), props.payload.struttura ? `${props.payload.struttura} › ${props.payload.ccName ?? props.payload.name}` : props.payload.name]}
                      contentStyle={{ fontSize: 12, borderRadius: 6 }}
                    />
                    <Bar dataKey="totale" radius={[4, 4, 0, 0]}>
                      {dataBar.map((d, i) => (
                        <Cell
                          key={i}
                          fill={d.colore}
                          opacity={barDettaglio && barDettaglio.name !== d.name ? 0.4 : 1}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                {/* Tabella dettaglio dipendenti */}
                {barDettaglio && (
                  <div style={{ marginTop: 20, borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                        Dipendenti — {barDettaglio.struttura ? `${barDettaglio.struttura} › ` : ''}{barDettaglio.ccName ?? barDettaglio.name}
                      </span>
                      <button
                        onClick={() => { setBarDettaglio(null); setDettaglioDip(null) }}
                        style={{ border: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer', color: '#475569' }}
                      >
                        ✕ Chiudi
                      </button>
                    </div>
                    {dettaglioCaricando && <div style={{ color: '#94a3b8', fontSize: 13 }}>Caricamento…</div>}
                    {dettaglioDip && dettaglioDip.length === 0 && (
                      <div style={{ color: '#94a3b8', fontSize: 13 }}>Nessun dipendente trovato.</div>
                    )}
                    {dettaglioDip && dettaglioDip.length > 0 && (() => {
                      const totale = dettaglioDip.reduce((s, d) => s + d.costo_anno, 0)
                      return (
                        <table style={{ ...tableStyle, fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: '#2d6a9f' }}>
                              <th style={thStyle}>#</th>
                              <th style={thStyle}>Dipendente</th>
                              {barRaggruppa && <th style={thStyle}>Strutture</th>}
                              <th style={{ ...thStyle, textAlign: 'right' }}>Costo anno</th>
                              <th style={{ ...thStyle, textAlign: 'right' }}>% sul totale</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dettaglioDip.map((d, i) => (
                              <tr key={d.employee_id} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                                <td style={{ ...tdStyle, color: '#94a3b8', width: 32 }}>{i + 1}</td>
                                <td style={{ ...tdStyle, fontWeight: 600 }}>{d.cognome} {d.nome}</td>
                                {barRaggruppa && (
                                  <td style={tdStyle}>
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                      {d.strutture.map(s => (
                                        <span key={s} style={{ fontSize: 10, fontWeight: 700, color: getCCFillColor(s, 'a'), background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>{s}</span>
                                      ))}
                                    </div>
                                  </td>
                                )}
                                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatEuro(d.costo_anno)}</td>
                                <td style={{ ...tdStyle, textAlign: 'right', color: '#64748b' }}>
                                  {totale > 0 ? (d.costo_anno / totale * 100).toFixed(1) : '0'}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ background: '#0f172a' }}>
                              <td colSpan={barRaggruppa ? 3 : 2} style={{ ...tdStyle, color: '#fff', fontWeight: 700 }}>TOTALE</td>
                              <td style={{ ...tdStyle, textAlign: 'right', color: '#fff', fontWeight: 700 }}>{formatEuro(totale)}</td>
                              <td style={{ ...tdStyle, textAlign: 'right', color: '#fff' }}>100%</td>
                            </tr>
                          </tfoot>
                        </table>
                      )
                    })()}
                  </div>
                )}
              </div>
            )
          })()}

          </>
        )
      )}
    </div>
  )
}

// ─── Colori CC: stessa tinta per lo stesso reparto, gradazione diversa per struttura ──

// Palette automatica per reparti senza colore personalizzato
const _CC_PALETTE = [
  '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4',
  '#f97316', '#84cc16', '#ec4899', '#6366f1', '#14b8a6',
]

// Libreria colori CC — caricata da /config/cc-colori/mappa, modificabile da Admin
// Valori: colori hex (#RRGGBB) per reparto primario; la graduazione per struttura è automatica
let _ccColoriDinamici = { ristorante: '#3d8c40' }

export function aggiornaColoriCC(mappa) {
  _ccColoriDinamici = Object.fromEntries(
    Object.entries(mappa).map(([k, v]) => [k.toLowerCase().trim(), v])
  )
}

function _hashCC(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Restituisce il colore hex base per un nome reparto
function _colorCC(ccName) {
  const key = (ccName || '').toLowerCase().trim()
  const val = _ccColoriDinamici[key]
  // Accetta solo valori hex validi (#RRGGBB); ignora eventuali valori legacy (interi HSL)
  if (val && typeof val === 'string' && /^#[0-9a-fA-F]{6}$/i.test(val)) return val
  return _CC_PALETTE[_hashCC(key) % _CC_PALETTE.length]
}

// Converte hex #RRGGBB in {r, g, b}
function _hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16) || 136,
    g: parseInt(h.slice(2, 4), 16) || 136,
    b: parseInt(h.slice(4, 6), 16) || 136,
  }
}

// Bianco da mescolare per badge (0 = colore puro, 1 = bianco puro)
// CLB = colore pieno, BON = quasi bianco — forbice ampia per differenza netta
const _STRUTTURA_TINT = { CLB: 0.55, DPH: 0.72, INT: 0.85, BON: 0.92, COMUNE: 0.94 }
// Opacità fill grafici: CLB pieno, COMUNE trasparente
const _STRUTTURA_ALPHA = { CLB: 'ff', DPH: 'cc', INT: '88', BON: '66', COMUNE: '44' }
// Oscuramento testo badge: CLB più scuro, COMUNE più chiaro
const _STRUTTURA_DARK = { CLB: 0.38, DPH: 0.44, INT: 0.52, BON: 0.58, COMUNE: 0.62 }

// Stile badge: sfondo pastello (mix col bianco), testo scuro, bordo colorato
function getCCBadgeStyle(parentCode, ccName) {
  const hex = _colorCC(ccName)
  const { r, g, b } = _hexToRgb(hex)
  const tint = _STRUTTURA_TINT[parentCode] ?? 0.78
  const darkFactor = _STRUTTURA_DARK[parentCode] ?? 0.48
  const bg = (c) => Math.round(c + (255 - c) * tint)
  const dark = (c) => Math.round(c * darkFactor)
  return {
    background: `rgb(${bg(r)}, ${bg(g)}, ${bg(b)})`,
    border: `1px solid rgba(${r}, ${g}, ${b}, 0.42)`,
    color: `rgb(${dark(r)}, ${dark(g)}, ${dark(b)})`,
  }
}

// Colore pieno per grafici SVG (hex + canale alpha per struttura)
function getCCFillColor(parentCode, ccName) {
  const hex = _colorCC(ccName)
  const alpha = _STRUTTURA_ALPHA[parentCode] ?? 'bb'
  return hex + alpha
}

// ─── Stili condivisi ─────────────────────────────────────────────────────────

const cardStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: '14px 18px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
  borderRadius: 8,
  overflow: 'hidden',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
}

const thStyle = {
  padding: '10px 12px',
  color: '#fff',
  fontWeight: 700,
  textAlign: 'left',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
}

const tdStyle = {
  padding: '9px 12px',
  borderBottom: '1px solid #f1f5f9',
  color: '#1e293b',
  verticalAlign: 'middle',
}

const selectStyle = {
  padding: '7px 10px',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  fontSize: 13,
  background: '#fff',
  color: '#1e293b',
}

const btnStyle = {
  padding: '7px 16px',
  background: '#d97706',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}

const h2Style = {
  fontSize: 16,
  fontWeight: 700,
  color: '#1e293b',
  marginBottom: 16,
  marginTop: 0,
}

const navBtnStyle = {
  padding: '5px 12px',
  background: '#f1f5f9',
  color: '#1e293b',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 18,
  fontWeight: 700,
  lineHeight: 1,
}

const inlineInputStyle = {
  padding: '4px 8px',
  border: '1px solid #93c5fd',
  borderRadius: 4,
  fontSize: 12,
  outline: 'none',
}

const microBtnStyle = {
  padding: '2px 7px',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 700,
}
