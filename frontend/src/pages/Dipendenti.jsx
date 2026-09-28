import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { PieChart, Pie, Cell, Tooltip as ReTooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../api/client'
import { formatEuro, formatPerc, mostraErrore } from '../utils/format'
import {
  Badge, Button, Checkbox, DropZone, Input, KpiTile, Loading, Messaggio, PageHeader, SectionTitle, Select,
  StatoVuoto, Table, Tabs, Td, Th, useAvvisi, useConferma,
} from '../components/ui'
import { colors } from '../styles/tokens.js'


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
  const avvisi = useAvvisi()
  const conferma = useConferma()

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
    if (!(await conferma({
      titolo: `Ricalcolare le ripartizioni CC di tutti i dipendenti per il ${anno}?`,
      messaggio: 'I mesi con eccezione manuale rimarranno invariati.',
      confermaLabel: 'Ricalcola',
    }))) return
    setRicalcolandoTutto(true)
    setEsitoRicalcoloTutto(null)
    try {
      const { data } = await api.post('/dipendenti/ricalcola-cc-anno', null, { params: { anno } })
      avvisi.successo(data.messaggio)
      caricaReport()
    } catch (err) {
      avvisi.errore(mostraErrore(err, 'Errore sconosciuto'))
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

  const aggiornaCCMensile = async (monthlyId, ccId, ccName) => {
    try {
      await api.put(`/dipendenti/monthly/${monthlyId}/centro-di-costo`, { cost_center_id: ccId })
      caricaReport()
    } catch {
      avvisi.errore('Errore aggiornamento centro di costo')
    }
  }

  const eliminaTestData = async () => {
    if (!(await conferma({ titolo: 'Cancellare tutti gli import di test (payroll)?', messaggio: 'Verranno cancellati anche i dati collegati.', pericolo: true }))) return
    setCancellandoTest(true)
    try {
      const r = await api.delete('/dipendenti/admin/test-data')
      avvisi.successo(r.data.messaggio)
      caricaReport()
      api.get('/dipendenti/import/storico').then(r => setStorici(r.data)).catch(() => {})
      caricaTestStats()
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore cancellazione dati di test'))
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
    if (!(await conferma({ titolo: `Eliminare definitivamente l'import "${label}"?`, pericolo: true }))) return
    try {
      await api.delete(`/dipendenti/import/${id}`, { params: { conferma: true } })
      setStorici(s => s.filter(i => i.id !== id))
      caricaReport()
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore eliminazione'))
    }
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────

  const vociAzienda = (d, codici) => codici.reduce((s, c) => s + (d.voci.find(v => v.code === c)?.importo || 0), 0)
  const quota = (v) => report?.totale_costo_aziendale > 0 ? formatPerc(v / report.totale_costo_aziendale * 100) : '—'
  const vuoto = { padding: 32, textAlign: 'center' }

  return (
    <div>
      <PageHeader title="Spese Dipendenti" subtitle="Gestione costi del personale">
        {isAdmin() && (
          <Button variant="secondary" onClick={handleRicalcolaTutto} disabled={ricalcolandoTutto}
            title={`Ricalcola le ripartizioni CC di tutti i dipendenti per il ${anno}`}>
            {ricalcolandoTutto ? '⏳ Aggiornando…' : '🔄 Aggiorna le ripartizioni'}
          </Button>
        )}
      </PageHeader>

      <Tabs value={sezione} onChange={setSezione} tabs={[
        { id: 'report', label: 'Report mensile' },
        { id: 'analisi', label: 'Analisi CC' },
        { id: 'anagrafica', label: 'Anagrafica' },
        ...(isAdmin() ? [
          { id: 'import', label: 'Import PDF' },
          { id: 'storico', label: 'Storico import' },
        ] : []),
      ]} />

      {/* ── SEZIONE REPORT ─────────────────────────────────────────────────── */}
      {sezione === 'report' && (
        <div>
          {/* Selettore periodo: mese (o "Tutto l'anno") + anno */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
            {mese !== 0 && (
              <Button variant="secondary" size="sm" title="Mese precedente" onClick={() => {
                const d = new Date(anno, mese - 2, 1)
                setMese(d.getMonth() + 1)
                setAnno(d.getFullYear())
              }}>◀</Button>
            )}
            <Select value={mese} onChange={e => setMese(Number(e.target.value))} aria-label="Mese">
              <option value={0}>Tutto l'anno</option>
              {MESI.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </Select>
            <Select value={anno} onChange={e => setAnno(Number(e.target.value))} aria-label="Anno">
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
            {mese !== 0 && (
              <Button variant="secondary" size="sm" title="Mese successivo" onClick={() => {
                const d = new Date(anno, mese, 1)
                setMese(d.getMonth() + 1)
                setAnno(d.getFullYear())
              }}>▶</Button>
            )}
            <Button variant="secondary" size="sm" onClick={caricaReport}>Aggiorna</Button>
          </div>

          {caricando && <Loading />}
          <Messaggio tipo="err">{errore}</Messaggio>

          {!caricando && !report && (
            <StatoVuoto>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
              Nessun dato per {mese === 0 ? `l'anno ${anno}` : `${MESI[mese]} ${anno}`}.<br />Importa un PDF dalla sezione "Import PDF".
            </StatoVuoto>
          )}

          {report && (
            <>
              {/* Card KPI */}
              <div className="ui-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <KpiTile label="Dipendenti" value={report.n_dipendenti} />
                <KpiTile label="Retrib. Netta Tot." value={formatEuro(report.totale_netto)} />
                <KpiTile label="Lordo Tot." value={formatEuro(report.totale_lordo)} />
                <KpiTile label="Costo Az. Tot." value={formatEuro(report.totale_costo_aziendale)} />
              </div>

              <Tabs size="sm" value={reportTab} onChange={setReportTab}
                tabs={[{ id: 'dipendenti', label: 'Per Dipendente' }, { id: 'struttura', label: 'Per Struttura/Reparto' }]} />

              {/* ── Vista Per Struttura ── */}
              {reportTab === 'struttura' && (
                <div>
                  {(report.totali_per_struttura || []).length === 0 ? (
                    <StatoVuoto>Nessun dato per struttura disponibile.</StatoVuoto>
                  ) : (
                    <>
                      <div className="ui-kpi-row">
                        {(report.totali_per_struttura || []).map(s => (
                          <KpiTile key={s.struttura_code} minWidth={180}
                            label={`${s.struttura_code} · ${s.struttura_name}`}
                            value={formatEuro(s.costo_aziendale)}
                            sub={`${quota(s.costo_aziendale)} · ${s.n_dipendenti} dip.`} />
                        ))}
                      </div>
                      <Table>
                        <thead>
                          <tr><Th>Struttura</Th><Th num>Costo Az. Totale</Th><Th num>% sul totale</Th><Th num>N° Dipendenti</Th></tr>
                        </thead>
                        <tbody>
                          {(report.totali_per_struttura || []).map(s => (
                            <tr key={s.struttura_code}>
                              <Td style={{ fontWeight: 600 }}>
                                <code style={{ color: colors.textSubtle, marginRight: 8 }}>{s.struttura_code}</code>
                                {s.struttura_name}
                              </Td>
                              <Td num style={{ fontWeight: 700 }}>{formatEuro(s.costo_aziendale)}</Td>
                              <Td num>{quota(s.costo_aziendale)}</Td>
                              <Td num>{s.n_dipendenti}</Td>
                            </tr>
                          ))}
                          <tr className="ui-riga-totale">
                            <Td>TOTALE</Td>
                            <Td num>{formatEuro(report.totale_costo_aziendale)}</Td>
                            <Td num>100%</Td>
                            <Td num>{report.n_dipendenti}</Td>
                          </tr>
                        </tbody>
                      </Table>
                    </>
                  )}
                </div>
              )}

              {/* ── Vista Per Dipendente ── */}
              {reportTab === 'dipendenti' && (
                <Table>
                  <thead>
                    <tr>
                      <Th>Dipendente</Th><Th>Centri di costo</Th><Th num>Ret. Netta</Th><Th num>Tot. Lordo</Th>
                      <Th num>Contrib. Az.</Th><Th num>TFR</Th><Th num tot>Costo Totale</Th><Th num>Incidenza%</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.dipendenti.map(d => (
                      <Fragment key={d.employee_id}>
                        <tr>
                          <Td style={{ whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" style={{ padding: '0 4px', fontSize: 10 }}
                                onClick={() => setVoceExpanded(voceExpanded === d.employee_id ? null : d.employee_id)}
                                aria-label="Dettaglio voci">
                                {voceExpanded === d.employee_id ? '▼' : '▶'}
                              </button>
                              <div>
                                <span style={{ fontWeight: 600 }}>{d.cognome} {d.nome}</span>
                                <div style={{ fontSize: 'var(--fs-xs)', color: colors.textSubtle }}>{d.codice_fiscale}</div>
                              </div>
                            </div>
                          </Td>
                          <Td>
                            <CCBadgeList centri={d.centri_di_costo} fallback={d.centro_di_costo} />
                            {d.override_manuale && <span title="CC modificato manualmente" style={{ marginLeft: 4, fontSize: 11 }}>✏️</span>}
                          </Td>
                          <Td num>{formatEuro(d.retribuzione_netta)}</Td>
                          <Td num>{formatEuro(d.totale_lordo)}</Td>
                          <Td num>{formatEuro(vociAzienda(d, ['contr_prev_az', 'contr_san_az']))}</Td>
                          <Td num>{formatEuro(d.voci.find(v => v.code === 'tfr')?.importo)}</Td>
                          <Td num tot style={{ fontWeight: 600 }}>{formatEuro(d.costo_aziendale)}</Td>
                          <Td num>
                            {d.retribuzione_netta > 0
                              ? <IncidenzaBadge valore={(d.costo_aziendale - d.retribuzione_netta) / d.retribuzione_netta * 100} />
                              : '—'}
                          </Td>
                        </tr>
                        {/* Dettaglio voci */}
                        {voceExpanded === d.employee_id && (
                          <tr className="ui-riga-dettaglio">
                            <Td colSpan={8}>
                              <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                                <div style={{ minWidth: 180 }}>
                                  <div style={titoletto}>Inquadramento</div>
                                  {[
                                    { label: 'Qualifica', value: d.qualifica },
                                    { label: 'Mansione', value: d.mansione },
                                    { label: 'Livello', value: d.livello },
                                  ].map(r => (
                                    <div key={r.label} style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
                                      <span style={{ color: colors.textSubtle, minWidth: 64 }}>{r.label}</span>
                                      <span style={{ fontWeight: 600 }}>{r.value || '—'}</span>
                                    </div>
                                  ))}
                                </div>
                                {['dipendente', 'azienda'].map(cat => (
                                  <div key={cat}>
                                    <div style={titoletto}>{cat === 'dipendente' ? 'Voci dipendente' : 'Voci azienda'}</div>
                                    {d.voci.filter(v => v.categoria === cat).map(v => (
                                      <div key={v.code} style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginBottom: 3 }}>
                                        <span>{v.name}</span>
                                        <span className="ui-num" style={{ fontWeight: 600 }}>{formatEuro(v.importo)}</span>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            </Td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                    {/* Riga totale */}
                    {(() => {
                      const totContribAz = report.dipendenti.reduce((s, d) => s + vociAzienda(d, ['contr_prev_az', 'contr_san_az']), 0)
                      const totTfr = report.dipendenti.reduce((s, d) => s + vociAzienda(d, ['tfr']), 0)
                      const incidenzaTot = report.totale_netto > 0
                        ? ((report.totale_costo_aziendale - report.totale_netto) / report.totale_netto * 100)
                        : null
                      return (
                        <tr className="ui-riga-totale">
                          <Td>TOTALE ({report.n_dipendenti} dip.)</Td>
                          <Td />
                          <Td num>{formatEuro(report.totale_netto)}</Td>
                          <Td num>{formatEuro(report.totale_lordo)}</Td>
                          <Td num>{formatEuro(totContribAz)}</Td>
                          <Td num>{formatEuro(totTfr)}</Td>
                          <Td num tot>{formatEuro(report.totale_costo_aziendale)}</Td>
                          <Td num>{incidenzaTot != null ? <IncidenzaBadge valore={incidenzaTot} suSfondoScuro /> : '—'}</Td>
                        </tr>
                      )
                    })()}
                  </tbody>
                </Table>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <SectionTitle style={{ margin: 0 }}>
              Anagrafica dipendenti{' '}
              <span className="ui-text-muted" style={{ fontWeight: 500, fontSize: 'var(--fs-md)' }}>
                ({cercaDipendente ? `${dipendentiFiltrati.length} di ${dipendenti.length}` : dipendenti.length})
              </span>
            </SectionTitle>
            <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: colors.textSubtle, pointerEvents: 'none' }}>🔍</span>
              <Input type="text" placeholder="Cerca per nome, cognome o CF…" value={cercaDipendente}
                onChange={e => setCercaDipendente(e.target.value)} style={{ width: '100%', paddingLeft: 32 }} />
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <Select value={annoAnagrafica} onChange={e => setAnnoAnagrafica(Number(e.target.value))} aria-label="Anno anagrafica">
                {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
              </Select>
            </div>
          </div>

          {dipendenti.length === 0 ? (
            <StatoVuoto>Nessun dipendente con import nel {annoAnagrafica} — importa un PDF per aggiungere l'anagrafica</StatoVuoto>
          ) : dipendentiFiltrati.length === 0 ? (
            <StatoVuoto>Nessun dipendente trovato per "<strong>{cercaDipendente}</strong>"</StatoVuoto>
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
        <div style={{ maxWidth: 640 }}>
          <SectionTitle>Importa PDF costi personale</SectionTitle>
          <p className="ui-text-muted" style={{ marginTop: 0, marginBottom: 16 }}>
            Carica il PDF mensile dei costi aziendali. Il sistema estrae automaticamente
            i dati di tutti i dipendenti.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Checkbox checked={isTest} onChange={setIsTest} label="Dati di test (cancellabili dalla sezione Admin)" />
            {isTest && <Badge tono="warn">TEST</Badge>}
          </div>

          <DropZone
            accept=".pdf"
            onFile={handleFile}
            disabled={uploadState.stato === 'caricando'}
            icona={uploadState.stato === 'caricando' ? null : '📤'}
            titolo={uploadState.stato === 'caricando' ? 'Importazione in corso…' : 'Trascina il PDF qui o clicca per selezionare'}
            sottotitolo={uploadState.stato === 'caricando' ? null : 'Solo file .pdf'}
          />

          {uploadState.stato === 'errore' && (
            <Messaggio tipo="err" onChiudi={() => setUploadState({ stato: 'idle', messaggio: '', risultato: null })}>{uploadState.messaggio}</Messaggio>
          )}
          {uploadState.stato === 'ok' && uploadState.risultato && (
            <Messaggio tipo="ok">
              <strong>Importazione completata</strong>
              <div style={{ marginTop: 6 }}>
                <div>Periodo: {MESI[uploadState.risultato.mese]} {uploadState.risultato.anno}</div>
                <div>Società: {uploadState.risultato.societa}</div>
                <div>Dipendenti importati: <strong>{uploadState.risultato.n_dipendenti}</strong></div>
                <div>Retrib. netta totale: <strong>{formatEuro(uploadState.risultato.totale_netto)}</strong></div>
                <div>Costo aziendale totale: <strong>{formatEuro(uploadState.risultato.totale_costo_aziendale)}</strong></div>
                {uploadState.risultato.nuovi_dipendenti?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <strong>Nuovi dipendenti:</strong>
                    <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                      {uploadState.risultato.nuovi_dipendenti.map(n => <li key={n}>{n}</li>)}
                    </ul>
                  </div>
                )}
              </div>
              <Button size="sm" style={{ marginTop: 10 }}
                onClick={() => { setSezione('report'); setMese(uploadState.risultato.mese); setAnno(uploadState.risultato.anno) }}>
                Vai al report {MESI[uploadState.risultato.mese]} {uploadState.risultato.anno}
              </Button>
            </Messaggio>
          )}
          {uploadState.stato === 'ok' && uploadState.risultato?.warnings?.length > 0 && (
            <Messaggio tipo="warn">
              <strong>Avvisi:</strong>
              <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                {uploadState.risultato.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </Messaggio>
          )}
          {uploadState.stato === 'ok' && uploadState.risultato?.pagine_non_parsate?.length > 0 && (
            <Messaggio tipo="err">
              <strong>Pagine non lette:</strong>
              <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                {uploadState.risultato.pagine_non_parsate.map((p, i) => <li key={i}>Pagina {p.pagina}: {p.errore}</li>)}
              </ul>
            </Messaggio>
          )}
        </div>
      )}

      {/* ── SEZIONE STORICO IMPORT ─────────────────────────────────────────── */}
      {sezione === 'storico' && isAdmin() && (
        <div>
          <SectionTitle>Storico import ({storici.length})</SectionTitle>
          <Table compact>
            <thead>
              <tr>
                <Th num>ID</Th><Th>File</Th><Th>Periodo</Th><Th>Società</Th><Th num>Dip.</Th>
                <Th num>Costo Az. Tot.</Th><Th center>Stato</Th><Th center>Azioni</Th>
              </tr>
            </thead>
            <tbody>
              {storici.map(s => (
                <tr key={s.id}>
                  <Td num muted>{s.id}</Td>
                  <Td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.nome_file}>{s.nome_file}</Td>
                  <Td>{MESI[s.mese]} {s.anno}</Td>
                  <Td>{s.societa || '—'}</Td>
                  <Td num>{s.n_dipendenti ?? '—'}</Td>
                  <Td num>{formatEuro(s.totale_costo_aziendale)}</Td>
                  <Td center><Badge tono="ok">{s.stato}</Badge></Td>
                  <Td center>
                    <Button variant="danger-soft" size="sm" onClick={() => eliminaImport(s.id, `${MESI[s.mese]} ${s.anno}`)}>Elimina</Button>
                  </Td>
                </tr>
              ))}
              {storici.length === 0 && (
                <tr><Td colSpan={8} center muted>Nessun import effettuato</Td></tr>
              )}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  )
}

// Titoletto maiuscolo delle sezioni di dettaglio (voci, inquadramento, ripartizioni)
const titoletto = {
  fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--color-text-muted)',
  textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6,
}

// ─── CARD ANAGRAFICA CON PANNELLO CC ─────────────────────────────────────────

function AnagraficaCard({ d, idx, anno, albero }) {
  const [espanso, setEspanso] = useState(false)
  // Precompilato con d.centri_di_costo (già nella lista) cosi la riga riassuntiva mostra
  // subito tutti i CC senza dover espandere; null solo se la lista non li aveva ancora.
  const [ccDefaults, setCcDefaults] = useState(d.centri_di_costo?.length ? d.centri_di_costo : null)
  const [editandoDefault, setEditandoDefault] = useState(false)
  const [ricalcolando, setRicalcolando] = useState(false)
  const avvisi = useAvvisi()
  const conferma = useConferma()

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
    if (!(await conferma({
      titolo: 'Ricalcolare le ripartizioni CC su tutti i mesi già importati?',
      messaggio: 'I mesi con eccezione manuale rimarranno invariati.',
      confermaLabel: 'Ricalcola',
    }))) return
    setRicalcolando(true)
    try {
      const { data } = await api.post(`/dipendenti/${d.id}/ricalcola-cc`)
      avvisi.successo(data.messaggio)
    } catch (err) {
      avvisi.errore(mostraErrore(err, 'Errore ricalcolo'))
    } finally {
      setRicalcolando(false)
    }
  }

  // Badge CC da mostrare nella riga riassuntiva
  const badgeCC = ccDefaults
    ? ccDefaults
    : (d.centro_di_costo ? [{ cost_center_id: d.centro_di_costo_id, cost_center_code: d.centro_di_costo, percentuale: 100 }] : [])

  return (
    <div className="ui-card" style={{ padding: 0, overflow: 'hidden', background: idx % 2 === 0 ? colors.surface : colors.surfaceSoft }}>
      {/* Riga riassuntiva — clic per espandere */}
      <div
        onClick={() => setEspanso(v => !v)}
        role="button"
        aria-expanded={espanso}
        style={{
          display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1.5fr auto',
          alignItems: 'center', gap: 12, padding: '10px 16px', cursor: 'pointer', userSelect: 'none',
        }}>
        <div>
          <span style={{ fontWeight: 700 }}>{d.cognome} {d.nome}</span>
          <code style={{ marginLeft: 8, color: colors.textSubtle, fontSize: 'var(--fs-xs)' }}>{d.codice_fiscale}</code>
        </div>
        <span className="ui-text-muted" style={{ fontSize: 'var(--fs-base)' }}>{d.qualifica || '—'}</span>
        <span className="ui-text-muted" style={{ fontSize: 'var(--fs-base)' }}>{d.mansione || '—'}</span>
        <span className="ui-text-muted" style={{ fontSize: 'var(--fs-base)' }}>{d.livello || '—'}</span>
        <div>
          {badgeCC.length > 0
            ? <CCInlineBadges centri={badgeCC} />
            : <span style={{ color: colors.textSubtle, fontSize: 'var(--fs-sm)' }}>N/A</span>}
        </div>
        <span style={{ color: colors.textSubtle, fontSize: 'var(--fs-sm)' }}>{d.email || d.cellulare || '—'}</span>
        <span style={{ color: colors.textSubtle, fontSize: 11, transform: espanso ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
      </div>

      {/* Pannello espanso */}
      {espanso && (
        <div style={{ borderTop: `1px solid ${colors.border}`, display: 'grid', gridTemplateColumns: '1fr 1fr', background: colors.surface }}>
          {/* Colonna sinistra — CC default */}
          <div style={{ padding: '16px 20px', borderRight: `1px solid ${colors.border}` }}>
            <div style={titoletto}>Ripartizione default</div>
            {ccDefaults === null ? (
              <Loading />
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
              <div style={{ marginTop: 12, borderTop: `1px solid ${colors.surfaceAlt}`, paddingTop: 10 }}>
                <Button variant="secondary" size="sm" onClick={handleRicalcola} disabled={ricalcolando}>
                  {ricalcolando ? '⏳' : '🔄'} Ricalcola mesi passati
                </Button>
              </div>
            )}
          </div>

          {/* Colonna destra — mesi dell'anno */}
          <div style={{ padding: '16px 20px' }}>
            <div style={titoletto}>Mesi {anno} — eccezioni per mese</div>
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
        <div className="ui-text-muted" style={{ marginBottom: 10 }}>
          Nessun default impostato — verranno usati KMDIMARE come fallback.
        </div>
        {onEdit && <Button size="sm" onClick={onEdit}>+ Imposta default</Button>}
      </div>
    )
  }

  const decorrenza = defaults[0]
  const label = `${MESI[decorrenza.mese_inizio]} ${decorrenza.anno_inizio}`

  return (
    <div>
      <div className="ui-text-muted" style={{ fontSize: 'var(--fs-xs)', marginBottom: 8 }}>
        In vigore da {label}
        {decorrenza.anno_fine && ` · scade ${MESI[decorrenza.mese_fine]} ${decorrenza.anno_fine}`}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {defaults.map(cc => (
          <div key={cc.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Badge tono="info" style={{ minWidth: 60, textAlign: 'center', fontSize: 'var(--fs-sm)' }}>{cc.cost_center_code}</Badge>
            <span style={{ color: colors.textSecond, fontSize: 'var(--fs-base)' }}>{cc.cost_center_name}</span>
            <span className="ui-num" style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 'var(--fs-base)' }}>{cc.percentuale}%</span>
          </div>
        ))}
      </div>
      {onEdit && <Button variant="secondary" size="sm" onClick={onEdit}>✏ Modifica</Button>}
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

  if (mesi === null) return <Loading />

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
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 6, overflow: 'hidden' }}>
      <div
        onClick={haImport ? onToggle : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
          background: haOverride ? colors.warningSoft : haImport ? colors.successSoft : colors.surfaceSoft,
          cursor: haImport ? 'pointer' : 'default', userSelect: 'none',
        }}>
        <span style={{ fontWeight: 700, color: colors.textSecond, width: 28, flexShrink: 0 }}>{MESI_LABEL[m.mese]}</span>
        {!haImport ? (
          <span style={{ fontSize: 'var(--fs-sm)', color: colors.borderStrong }}>nessun dato</span>
        ) : haOverride ? (
          <>
            <Badge tono="warn" style={{ marginRight: 4 }}>override</Badge>
            <CCInlineBadges centri={m.centri_di_costo} />
          </>
        ) : (
          <>
            <span className="ui-text-muted" style={{ fontSize: 'var(--fs-xs)' }}>come default</span>
            <CCInlineBadges centri={m.centri_di_costo} />
          </>
        )}
        {haImport && (
          <span style={{ marginLeft: 'auto', color: colors.textSubtle }}>{aperto ? '▲' : '✏'}</span>
        )}
      </div>

      {aperto && haImport && (
        <div style={{ padding: '12px 14px', background: colors.surface, borderTop: `1px solid ${colors.border}` }}>
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

// Badge CC: colore dal reparto (configurabile in Admin → Colori CC), gradazione per struttura
function CCInlineBadges({ centri }) {
  if (!centri || centri.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {centri.map(c => {
        const colori = getCCBadgeStyle(c.struttura_code, c.cost_center_name || c.cost_center_code)
        return (
          <span key={c.cost_center_id} className="ui-badge" style={{ ...colori, fontWeight: 500 }}>
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
    return <span style={{ color: colors.textSubtle }}>{fallback || '—'}</span>
  }
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {centri.map(c => {
        const colori = getCCBadgeStyle(c.struttura_code, c.cost_center_name)
        return (
          <span key={c.cost_center_id} className="ui-badge" style={{ ...colori, fontWeight: 500, fontSize: 'var(--fs-sm)' }}>
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
    <div style={{ maxWidth: 540 }}>
      {!mensile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          padding: '8px 10px', background: colors.infoSoft, borderRadius: 6, border: `1px solid ${colors.infoBg}` }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: colors.infoText, fontWeight: 600 }}>Decorrenza:</span>
          <Select value={decMese} onChange={e => setDecMese(Number(e.target.value))} aria-label="Mese decorrenza">
            {MESI.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </Select>
          <Select value={decAnno} onChange={e => setDecAnno(Number(e.target.value))} aria-label="Anno decorrenza">
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
        </div>
      )}
      {righe.map((r, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <Select value={r.cost_center_id} onChange={e => aggiornaRiga(idx, 'cost_center_id', e.target.value)} style={{ flex: 1 }}>
            <option value="">— Seleziona CC —</option>
            {albero.map(str =>
              (str.categorie || []).map(cat => (
                <optgroup key={cat.id} label={`${str.code} — ${cat.name}`}>
                  {cat.reparti.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
                </optgroup>
              ))
            )}
          </Select>
          <Input type="number" min="0" max="100" step="0.01" value={r.percentuale} className="ui-num"
            onChange={e => aggiornaRiga(idx, 'percentuale', e.target.value)} style={{ width: 76, textAlign: 'right' }} />
          <span className="ui-text-muted">%</span>
          {righe.length > 1 && (
            <Button variant="danger-soft" size="sm" onClick={() => setRighe(prev => prev.filter((_, i) => i !== idx))} aria-label="Rimuovi riga">✕</Button>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" size="sm" onClick={() => {
          setSalvato(false)
          setRighe(prev => distribuisciEquo([...prev, { cost_center_id: '', percentuale: 0 }]))
        }}>+ Aggiungi CC</Button>
        <Button variant="secondary" size="sm" title="Ripartisci equamente tra i CC selezionati"
          onClick={() => { setSalvato(false); setRighe(prev => distribuisciEquo(prev)) }}>⚖ Equo</Button>
        {hasDuplicati && <Badge tono="err">⚠ CC duplicato</Badge>}
        <span className="ui-num" style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: valida ? colors.success : colors.danger }}>
          Totale: {somma.toFixed(1)}%
        </span>
      </div>

      {errore && <div style={{ color: colors.danger, fontSize: 'var(--fs-sm)', marginTop: 6 }}>{errore}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <Button size="sm" onClick={salva} disabled={salvando || !valida}>{salvando ? 'Salvataggio…' : 'Salva'}</Button>
        {!inline && <Button variant="secondary" size="sm" onClick={onClose}>Annulla</Button>}
        {inline && mensile && <Button variant="secondary" size="sm" onClick={onClose}>Chiudi</Button>}
        {salvato && <span style={{ color: colors.success, fontWeight: 700, fontSize: 'var(--fs-base)' }}>✓ Salvato</span>}
      </div>
    </div>
  )
}

// Incidenza costo aziendale su netto: verde < 40%, ambra 40–50%, rosso oltre
function IncidenzaBadge({ valore, suSfondoScuro = false }) {
  const colore = suSfondoScuro ? '#fff' : valore < 40 ? colors.success : valore <= 50 ? colors.warning : colors.danger
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
  const [categorieSel, setCategorieSel] = useState(new Set())
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
        // Inizializza selezione categorie con tutte quelle disponibili
        const tutteCategorie = new Set(r1.data.centri.filter(c => c.parent_name).map(c => c.parent_name))
        setCategorieSel(tutteCategorie)
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

  // Macrocategorie disponibili dai dati caricati (ordine fisso quando presenti, poi alfabetico)
  const ORDINE_CATEGORIE = ['Camere', 'Food & Beverage', 'Struttura', 'Amministrazione']
  const categorieDisponibili = [...new Set(
    [...(dati?.centri || []), ...(datiPrec?.centri || [])]
      .map(c => c.parent_name)
      .filter(Boolean)
  )].sort((a, b) => {
    const ia = ORDINE_CATEGORIE.indexOf(a), ib = ORDINE_CATEGORIE.indexOf(b)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b, 'it')
  })

  // Filtra i centri grezzi in base alla selezione categorie (righe senza macrocategoria sempre incluse)
  const filtraCategorie = (centri) => (centri || []).filter(c => !c.parent_name || categorieSel.has(c.parent_name))

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

  const centriVis = trasformaCentri(filtraCategorie(dati?.centri))
  const centriPrecVis = trasformaCentri(filtraCategorie(datiPrec?.centri))

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
        {/* Filtro categorie */}
        {categorieDisponibili.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 10px' }}>
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Categorie:</span>
            {categorieDisponibili.map(cat => (
              <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={categorieSel.has(cat)}
                  onChange={() => {
                    const next = new Set(categorieSel)
                    if (next.has(cat)) next.delete(cat); else next.add(cat)
                    setCategorieSel(next)
                    setBarDettaglio(null)
                  }}
                  style={{ width: 13, height: 13 }}
                />
                <span style={{ fontSize: 12, color: '#1e293b' }}>{cat}</span>
              </label>
            ))}
          </div>
        )}
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
            {/* overflow:visible obbligatorio: l'overflow:hidden di tableStyle (per il borderRadius)
                rompe position:sticky delle celle, che si ancorerebbero alla tabella anziché al div che scrolla */}
            <table style={{ ...tableStyle, fontSize: 12, overflow: 'visible', borderRadius: 0 }}>
              <thead>
                {/* Riga anno se confronta attivo */}
                {confronta && (
                  <tr>
                    <th style={{ ...thStyle, background: '#1e293b', position: 'sticky', left: 0, zIndex: 3 }}></th>
                    {mesiUnione.map(m => (
                      <th key={m} colSpan={2} style={{ ...thStyle, background: '#1e293b', textAlign: 'center', borderLeft: '1px solid #334155' }}>
                        {MESI_BREVI[m]}
                      </th>
                    ))}
                    <th colSpan={2} style={{ ...thStyle, background: '#1e293b', textAlign: 'center', borderLeft: '1px solid #334155' }}>Totale</th>
                  </tr>
                )}
                <tr style={{ background: '#2d6a9f' }}>
                  <th style={{ ...thStyle, minWidth: 160, background: '#2d6a9f', position: 'sticky', left: 0, zIndex: 3 }}>Centro di costo</th>
                  {mesiUnione.map(m => (
                    confronta ? (
                      <Fragment key={m}>
                        <th style={{ ...thStyle, textAlign: 'right', borderLeft: '1px solid #3b82f6', minWidth: 90, background: '#2d6a9f' }}>
                          {anno}
                        </th>
                        <th style={{ ...thStyle, textAlign: 'right', minWidth: 80, background: '#374f6b', fontSize: 11 }}>
                          {anno - 1}
                        </th>
                      </Fragment>
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
                      <td style={{ ...tdStyle, position: 'sticky', left: 0, zIndex: 1, background: idx % 2 === 0 ? '#fff' : '#edf1f7', borderRight: '2px solid #cbd5e1' }}>
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
                          <Fragment key={m}>
                            <td style={{ ...tdStyle, textAlign: 'right', borderLeft: '1px solid #e2e8f0' }}>
                              {curr != null ? (
                                <>
                                  <span>{formatEuro(curr)}</span>
                                  {cellaDelta(curr, prec)}
                                </>
                              ) : <span style={{ color: '#e2e8f0' }}>—</span>}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>
                              {prec != null ? formatEuro(prec) : <span style={{ color: '#e2e8f0' }}>—</span>}
                            </td>
                          </Fragment>
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
                  <td style={{ ...tdStyle, background: '#0f172a', color: '#fff', fontWeight: 700, position: 'sticky', left: 0, zIndex: 2, borderRight: '2px solid #334155' }}>TOTALE</td>
                  {mesiUnione.map(m => {
                    const curr = totaliMeseVis[String(m)] ?? null
                    const prec = totaliMesePrecVis[String(m)] ?? null
                    return confronta ? (
                      <Fragment key={m}>
                        <td style={{ ...tdStyle, background: '#0f172a', textAlign: 'right', color: '#fff', fontWeight: 700, borderLeft: '1px solid #334155' }}>
                          {curr != null ? formatEuro(curr) : '—'}
                          {curr != null && prec != null && cellaDelta(curr, prec)}
                        </td>
                        <td style={{ ...tdStyle, background: '#1e293b', textAlign: 'right', color: '#cbd5e1', fontSize: 12, fontWeight: 600 }}>
                          {prec != null ? formatEuro(prec) : '—'}
                        </td>
                      </Fragment>
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

            // Vista per struttura: totale REALE per hotel (tutti i reparti/categorie), indipendente
            // dai filtri della tabella sopra (vista struttura, granularita, checkbox categorie) —
            // sempre dal dato grezzo del periodo selezionato, non da centriVis filtrato.
            const perStruttura = {}
            ;(dati?.centri || []).forEach(cc => {
              const sc = cc.struttura_code
              if (!sc) return
              if (!perStruttura[sc]) perStruttura[sc] = { name: cc.struttura_name ?? sc, struttura_code: sc, value: 0 }
              perStruttura[sc].value += cc.totale
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

            const labelPeriodo = periodoTipo === 'anno'
              ? `${anno}`
              : periodoTipo === 'mese'
                ? `${MESI_BREVI[periodoMeseDa]} ${anno}`
                : `${MESI_BREVI[periodoMeseDa]}-${MESI_BREVI[periodoMeseA]} ${anno}`

            return (
              <div style={{ flexShrink: 0, width: 320, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 6, textAlign: 'center' }}>
                  Ripartizione {labelPeriodo}
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
            const tuttiCentriGrezzi = filtraCategorie(dati?.centri).filter(cc => cc.totale > 0)
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



const h2Style = {
  fontSize: 16,
  fontWeight: 700,
  color: '#1e293b',
  marginBottom: 16,
  marginTop: 0,
}


const inlineInputStyle = {
  padding: '4px 8px',
  border: '1px solid #93c5fd',
  borderRadius: 4,
  fontSize: 12,
  outline: 'none',
}

