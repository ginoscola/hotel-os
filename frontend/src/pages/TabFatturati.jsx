import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  Legend, ResponsiveContainer, Cell,
} from 'recharts'
import api from '../api/client'
import { ExportMenu } from '../components/ExportMenu'
import { formatEuro, mostraErrore } from '../utils/format'
import { STRUTTURE_HOTEL, STRUTTURE_MANUALI, NOMI, NOME_CAT } from '../utils/corrispettiviHelpers'
import {
  Badge, Button, Card, Dot, Field, Loading, Messaggio, SegmentedControl, SezioneApribile, Select,
  StatoVuoto, Table, Td, Th, Checkbox, useAvvisi,
} from '../components/ui'
import { colors, COLORI_STRUTTURA, coloreSerie } from '../styles/tokens.js'

const CATEGORIE_INCASSO = ['Contante', 'Bonifico', 'Assegno', 'Pagamento elettronico']

// Serie "Hotel vs Ristoranti" del grafico
const COL_HOTEL_TOT = coloreSerie(0)
const COL_RIST_TOT  = coloreSerie(2)

// Raggruppamento per struttura FISICA (dove operano le attività, non le singole partite/casse):
// Maremosso opera fisicamente per Du Parc, Buona Onda per International — vedi anche il
// trattamento di Maremosso nel Conto Economico USALI (accorpato su Du Parc, stessa logica).
const GRUPPI_FISICI = [
  { id: 'DUPARC', label: 'Du Parc', attivita: ['DPH', 'MMS'], colore: COLORI_STRUTTURA.DPH },
  { id: 'CLUB', label: 'Club Hotel', attivita: ['CLB'], colore: COLORI_STRUTTURA.CLB },
  { id: 'INTERNATIONAL', label: 'International', attivita: ['INT', 'BON'], colore: COLORI_STRUTTURA.INT },
]

const annoCorrente = new Date().getFullYear()
const meseCorrente = new Date().getMonth() + 1

// Intestazione di colonna per una struttura: pallino col colore ufficiale + codice
const ThStruttura = ({ sc }) => (
  <Th num><Dot colore={COLORI_STRUTTURA[sc] || colors.textSubtle} /> <span style={{ marginLeft: 3 }}>{sc}</span></Th>
)

// Cella "Mese" con evidenza del mese in corso
const TdMese = ({ m, corrente }) => (
  <Td style={{ fontWeight: corrente ? 700 : 400, color: corrente ? colors.infoText : undefined }}>
    {m.nome_mese}
    {corrente && <Badge tono="info" style={{ marginLeft: 6 }}>in corso</Badge>}
  </Td>
)

export default function TabFatturati({ lordo }) {
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
  const avvisi = useAvvisi()

  const carica = useCallback(async () => {
    setLoading(true)
    setErrore(null)
    setDrillDown(null)
    try {
      const [r1, r2] = await Promise.all([
        api.get('/corrispettivi/report/fatturati', { params: { anno, lordo } }),
        api.get('/corrispettivi/report/tipo-incasso', { params: { anno } }),
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

  if (loading) return <Loading />
  if (errore)  return <Messaggio tipo="err">{errore}</Messaggio>
  if (!dati)   return null

  const strutture = dati.strutture || []
  const mesi      = dati.mesi || []
  const totAnno   = dati.totale_anno || {}
  const strutHotel = strutture.filter(s => STRUTTURE_HOTEL.includes(s))
  const strutRist  = strutture.filter(s => STRUTTURE_MANUALI.includes(s))

  const fmtV = (v) => (v && v !== 0) ? formatEuro(v) : <span style={{ color: colors.borderStrong }}>—</span>

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
  // Vista "per struttura fisica": un punto per mese, una Bar per gruppo (Du Parc/Club/International),
  // somma delle attività che vi operano fisicamente (es. Maremosso dentro Du Parc)
  const datiGraficoFisico = mesi.map(m => {
    const entry = { nome: m.nome_mese.slice(0, 3) }
    GRUPPI_FISICI.forEach(g => {
      entry[g.id] = g.attivita.reduce((acc, a) => acc + (m.per_struttura?.[a]?.totale || 0), 0)
    })
    return entry
  })
  const datiGrafico = vistaGrafico === 'struttura'
    ? (raggruppaPer === 'struttura' ? datiGraficoPers : datiGraficoMese)
    : vistaGrafico === 'fisica'
    ? datiGraficoFisico
    : mesi.map(m => ({ nome: m.nome_mese.slice(0, 3), Hotel: m.totale_hotel || 0, Ristoranti: m.totale_ristoranti || 0 }))

  const esportaExcel = async () => {
    try {
      const res = await api.get('/corrispettivi/export/fatturati', {
        params: { anno, lordo },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `corrispettivi_fatturati_${anno}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore export'))
    }
  }

  const isCorrente = (m) => anno === annoCorrente && m.mese === meseCorrente
  // Cella cliccabile per il dettaglio per categoria
  const tdDrill = (s, mese, contenuto) => {
    const attivo = drillDown?.sc === s && drillDown?.mese === mese
    return (
      <Td key={s} num onClick={() => toggleDrill(s, mese)} title="Clicca per il dettaglio per categoria"
        style={{ cursor: 'pointer', ...(attivo ? { background: colors.infoBg, boxShadow: `inset 0 -2px 0 ${colors.info}` } : null) }}>
        {contenuto}
      </Td>
    )
  }
  const tsTotaleAnno = strutture.reduce((acc, s) => acc + (totAnno.per_struttura?.[s]?.tassa_soggiorno || 0), 0)

  return (
    <div>
      {/* Selettore anno */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <Field label="Anno">
          <Select value={anno} onChange={e => setAnno(Number(e.target.value))}>
            {[2024, 2025, 2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
          </Select>
        </Field>
        {mesi.length > 0 && (
          <>
            <span className="ui-text-muted" style={{ alignSelf: 'center' }}>
              {mesi.length} {mesi.length === 1 ? 'mese' : 'mesi'} con dati
            </span>
            <Button variant="secondary" size="sm" onClick={esportaExcel} style={{ alignSelf: 'center' }}>⬇ Esporta Excel</Button>
          </>
        )}
      </div>

      {mesi.length === 0 ? (
        <StatoVuoto>Nessun dato per l'anno {anno}.</StatoVuoto>
      ) : (
        <>
          {/* ── Tabella principale ─────────────────────────────────────────── */}
          <h3 className="ui-section-title">Totale Corrispettivi</h3>
          <Table compact minWidth={700} style={{ marginBottom: 24 }}>
            <thead>
              <tr>
                <Th style={{ minWidth: 100 }}>Mese</Th>
                {strutHotel.map(s => <ThStruttura key={s} sc={s} />)}
                {strutHotel.length > 0 && <Th num tot>Tot. Hotel</Th>}
                {strutRist.map(s => <ThStruttura key={s} sc={s} />)}
                {strutRist.length > 0 && <Th num tot>Tot. Rist.</Th>}
                <Th num tot>TOTALE</Th>
              </tr>
            </thead>
            <tbody>
              {mesi.map(m => (
                <tr key={m.mese} className={isCorrente(m) ? 'ui-riga-evidenza' : undefined}>
                  <TdMese m={m} corrente={isCorrente(m)} />
                  {strutHotel.map(s => tdDrill(s, m.mese, fmtV(m.per_struttura?.[s]?.totale)))}
                  {strutHotel.length > 0 && <Td num tot>{fmtV(m.totale_hotel)}</Td>}
                  {strutRist.map(s => tdDrill(s, m.mese, fmtV(m.per_struttura?.[s]?.totale)))}
                  {strutRist.length > 0 && <Td num tot>{fmtV(m.totale_ristoranti)}</Td>}
                  <Td num tot style={{ fontWeight: 700 }}>{fmtV(m.totale_generale)}</Td>
                </tr>
              ))}

              {/* Riga TOTALE ANNO */}
              <tr className="ui-riga-totale">
                <Td>TOTALE ANNO</Td>
                {strutHotel.map(s => (
                  <Td key={s} num onClick={() => toggleDrill(s, 'totale')} style={{ cursor: 'pointer', textDecoration: drillDown?.sc === s && drillDown?.mese === 'totale' ? 'underline' : undefined }}>
                    {formatEuro(totAnno.per_struttura?.[s]?.totale || 0)}
                  </Td>
                ))}
                {strutHotel.length > 0 && <Td num tot>{formatEuro(totAnno.totale_hotel || 0)}</Td>}
                {strutRist.map(s => (
                  <Td key={s} num onClick={() => toggleDrill(s, 'totale')} style={{ cursor: 'pointer', textDecoration: drillDown?.sc === s && drillDown?.mese === 'totale' ? 'underline' : undefined }}>
                    {formatEuro(totAnno.per_struttura?.[s]?.totale || 0)}
                  </Td>
                ))}
                {strutRist.length > 0 && <Td num tot>{formatEuro(totAnno.totale_ristoranti || 0)}</Td>}
                <Td num tot style={{ fontWeight: 800 }}>{formatEuro(totAnno.totale_generale || 0)}</Td>
              </tr>
            </tbody>
          </Table>

          {/* ── Drill-down categorie ───────────────────────────────────────── */}
          {drillDown && drillDati && (
            <Card style={{ marginBottom: 24, maxWidth: 480 }}
              title={<span>
                <span style={{ color: COLORI_STRUTTURA[drillDown.sc] || colors.primary }}>{drillDown.sc}</span>
                {' — '}
                {drillDown.mese === 'totale' ? 'Totale Anno' : (mesi.find(m => m.mese === drillDown.mese)?.nome_mese || '')}
              </span>}
              actions={<Button variant="ghost" size="sm" onClick={() => setDrillDown(null)} aria-label="Chiudi">✕</Button>}
            >
              <Table compact>
                <tbody>
                  {['arrangiamenti', 'penali', 'shop', 'altro'].map(cat => {
                    const v = drillDati[cat] || 0
                    if (v === 0) return null
                    return (
                      <tr key={cat}>
                        <Td style={{ color: colors.textSecond }}>{NOME_CAT[cat]}</Td>
                        <Td num style={{ fontWeight: 600 }}>{formatEuro(v)}</Td>
                      </tr>
                    )
                  })}
                  <tr className="ui-riga-sezione">
                    <Td>Totale ricavi</Td>
                    <Td num>{formatEuro(drillDati.totale || 0)}</Td>
                  </tr>
                  {(drillDati.tassa_soggiorno || 0) > 0 && (
                    <tr>
                      <Td muted style={{ fontStyle: 'italic', fontSize: 'var(--fs-xs)' }}>Tassa soggiorno (transito, esclusa dal totale)</Td>
                      <Td num muted style={{ fontStyle: 'italic', fontSize: 'var(--fs-xs)' }}>{formatEuro(drillDati.tassa_soggiorno)}</Td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </Card>
          )}

          {/* ── Tabella Tassa di Soggiorno ─────────────────────────────────── */}
          {strutHotel.length > 0 && (
            <>
              <SezioneApribile titolo="Totale Tassa di Soggiorno" nota="(transito Comune — esclusa dal corrispettivo)"
                aperta={apriTs} onToggle={() => setApriTs(v => !v)}>
                <Table compact minWidth={500}>
                  <thead>
                    <tr>
                      <Th style={{ minWidth: 100 }}>Mese</Th>
                      {strutHotel.map(s => <ThStruttura key={s} sc={s} />)}
                      <Th num tot>Tot. Hotel</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {mesi.map(m => {
                      const totTs = strutHotel.reduce((acc, s) => acc + (m.per_struttura?.[s]?.tassa_soggiorno || 0), 0)
                      return (
                        <tr key={m.mese} className={isCorrente(m) ? 'ui-riga-evidenza' : undefined}>
                          <TdMese m={m} corrente={isCorrente(m)} />
                          {strutHotel.map(s => <Td key={s} num>{fmtV(m.per_struttura?.[s]?.tassa_soggiorno)}</Td>)}
                          <Td num tot>{fmtV(totTs)}</Td>
                        </tr>
                      )
                    })}
                    <tr className="ui-riga-totale">
                      <Td>TOTALE ANNO</Td>
                      {strutHotel.map(s => <Td key={s} num>{formatEuro(totAnno.per_struttura?.[s]?.tassa_soggiorno || 0)}</Td>)}
                      <Td num tot style={{ fontWeight: 800 }}>
                        {formatEuro(strutHotel.reduce((acc, s) => acc + (totAnno.per_struttura?.[s]?.tassa_soggiorno || 0), 0))}
                      </Td>
                    </tr>
                  </tbody>
                </Table>
              </SezioneApribile>

              {/* ── Riepilogo di controllo ──────────────────────────────────────── */}
              <SezioneApribile titolo="Riepilogo di controllo" nota="(il Totale Lordo deve coincidere con i corrispettivi giornalieri)"
                aperta={apriControllo} onToggle={() => setApriControllo(v => !v)}>
                <Table compact minWidth={420}>
                  <thead>
                    <tr>
                      <Th style={{ minWidth: 100 }}>Mese</Th>
                      <Th num>Corrispettivo</Th>
                      <Th num>+ Tassa Soggiorno</Th>
                      <Th num tot>= Totale Lordo</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {mesi.map(m => {
                      const tsGenerale = strutture.reduce((acc, s) => acc + (m.per_struttura?.[s]?.tassa_soggiorno || 0), 0)
                      const totLordo = (m.totale_generale || 0) + tsGenerale
                      return (
                        <tr key={m.mese} className={isCorrente(m) ? 'ui-riga-evidenza' : undefined}>
                          <TdMese m={m} corrente={isCorrente(m)} />
                          <Td num>{formatEuro(m.totale_generale || 0)}</Td>
                          <Td num>{fmtV(tsGenerale)}</Td>
                          <Td num tot style={{ fontWeight: 700 }}>{formatEuro(totLordo)}</Td>
                        </tr>
                      )
                    })}
                    <tr className="ui-riga-totale">
                      <Td>TOTALE ANNO</Td>
                      <Td num>{formatEuro(totAnno.totale_generale || 0)}</Td>
                      <Td num>{formatEuro(tsTotaleAnno)}</Td>
                      <Td num tot style={{ fontWeight: 800 }}>{formatEuro((totAnno.totale_generale || 0) + tsTotaleAnno)}</Td>
                    </tr>
                  </tbody>
                </Table>
              </SezioneApribile>
            </>
          )}

          {/* ── Forme di pagamento (raggruppate: Contante / Bonifico / Assegno / Elettronico) ── */}
          {datiPag && datiPag.tipi?.length > 0 && (
            <Card title={`Forme di pagamento ${anno}`} style={{ marginBottom: 24 }}
              actions={<ExportMenu url={`/corrispettivi/export/tipo-incasso?anno=${anno}`} nome={`corrispettivi_forme_pagamento_${anno}`} />}>
              <Table compact minWidth={500}>
                <thead>
                  <tr>
                    <Th style={{ minWidth: 150 }}>Forma di pagamento</Th>
                    {datiPag.mesi.map(m => <Th key={m.mese} num>{m.nome_mese.slice(0, 3)}</Th>)}
                    <Th num tot>TOTALE</Th>
                  </tr>
                </thead>
                <tbody>
                  {datiPag.tipi.map(tipo => {
                    const isSpeciale = !CATEGORIE_INCASSO.includes(tipo)
                    return (
                      <tr key={tipo}>
                        <Td style={{ fontWeight: isSpeciale ? 600 : 500, color: isSpeciale ? colors.textMuted : colors.textSecond, fontStyle: isSpeciale ? 'italic' : undefined }}>{tipo}</Td>
                        {datiPag.mesi.map(m => {
                          const v = datiPag.per_tipo[tipo]?.[String(m.mese)] || 0
                          return <Td key={m.mese} num>{v ? formatEuro(v) : <span style={{ color: colors.borderStrong }}>—</span>}</Td>
                        })}
                        <Td num tot style={{ fontWeight: 700 }}>{formatEuro(datiPag.totale_anno[tipo] || 0)}</Td>
                      </tr>
                    )
                  })}
                  <tr className="ui-riga-totale">
                    <Td>TOTALE</Td>
                    {datiPag.mesi.map(m => <Td key={m.mese} num>{formatEuro(datiPag.totale_mese[String(m.mese)] || 0)}</Td>)}
                    <Td num tot style={{ fontWeight: 800 }}>{formatEuro(Object.values(datiPag.totale_anno).reduce((a, v) => a + v, 0))}</Td>
                  </tr>
                </tbody>
              </Table>
              <p className="ui-text-muted" style={{ marginTop: 12, marginBottom: 0, fontStyle: 'italic', fontSize: 'var(--fs-xs)' }}>
                «Pagamento elettronico» raggruppa carte e app (Carta Credito, Bancomat, XPAY-Nexi,
                Satispay). I totali includono gli incassi MMS e BON. Le righe in corsivo
                (Non specificato, Caparra, Sospeso, MMS/BON manuale) sono informative e non
                rientrano nelle 4 forme di pagamento.
              </p>
            </Card>
          )}

          {/* ── Grafico ────────────────────────────────────────────────────── */}
          <Card title={`Fatturato mensile ${anno}`} style={{ marginBottom: 24 }}
            actions={<>
              {vistaGrafico === 'struttura' && (
                <Checkbox checked={raggruppaPer === 'struttura'} onChange={v => setRaggruppaPer(v ? 'struttura' : 'mese')} label="Raggruppa per attività" />
              )}
              <SegmentedControl value={vistaGrafico} onChange={setVistaGrafico} options={[
                { value: 'struttura', label: 'Per attività' },
                { value: 'fisica', label: 'Per struttura' },
                { value: 'gruppo', label: 'Hotel vs Ristoranti' },
              ]} />
            </>}
          >
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={datiGrafico} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.surfaceAlt} />
                {vistaGrafico === 'struttura' && raggruppaPer === 'struttura' ? (
                  <XAxis dataKey="nome" height={42}
                    tick={(props) => {
                      const { x, y, payload } = props
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <text x={0} dy={14} textAnchor="middle" fill={colors.textMuted} fontSize={10}>{payload.value}</text>
                        </g>
                      )
                    }}
                  />
                ) : (
                  <XAxis dataKey="nome" tick={{ fontSize: 11, fill: colors.textMuted }} />
                )}
                <YAxis tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                  tick={{ fontSize: 11, fill: colors.textMuted }} />
                {vistaGrafico === 'struttura' && raggruppaPer === 'struttura' ? (
                  <ReTooltip formatter={(v, _n, props) => [formatEuro(v), NOMI[props.payload?.struttura] || props.payload?.struttura]} />
                ) : (
                  <ReTooltip formatter={(v, name) => [formatEuro(v), name]} />
                )}
                {vistaGrafico === 'struttura' && raggruppaPer === 'struttura' ? (
                  <Bar dataKey="valore" radius={[3, 3, 0, 0]}>
                    {datiGraficoPers.map((entry, i) => (
                      <Cell key={i} fill={COLORI_STRUTTURA[entry.struttura] || colors.textSubtle} />
                    ))}
                  </Bar>
                ) : vistaGrafico === 'struttura' ? (
                  <>
                    <Legend wrapperStyle={{ fontSize: 'var(--fs-sm)' }} />
                    {strutture.map(s => (
                      <Bar key={s} dataKey={s} name={NOMI[s] || s}
                        fill={COLORI_STRUTTURA[s] || colors.textSubtle} radius={[3, 3, 0, 0]} />
                    ))}
                  </>
                ) : vistaGrafico === 'fisica' ? (
                  <>
                    <Legend wrapperStyle={{ fontSize: 'var(--fs-sm)' }} />
                    {GRUPPI_FISICI.map(g => (
                      <Bar key={g.id} dataKey={g.id} name={g.label} fill={g.colore} radius={[3, 3, 0, 0]} />
                    ))}
                  </>
                ) : (
                  <>
                    <Legend wrapperStyle={{ fontSize: 'var(--fs-sm)' }} />
                    <Bar key="Hotel" dataKey="Hotel" name="Hotel" fill={COL_HOTEL_TOT} radius={[3, 3, 0, 0]} />
                    <Bar key="Ristoranti" dataKey="Ristoranti" name="Ristoranti" fill={COL_RIST_TOT} radius={[3, 3, 0, 0]} />
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
            {vistaGrafico === 'struttura' && raggruppaPer === 'struttura' && (
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                {strutture.map(s => (
                  <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-sm)', color: colors.textMuted }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: COLORI_STRUTTURA[s] || colors.textSubtle, display: 'inline-block' }} />
                    {NOMI[s] || s}
                  </span>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
