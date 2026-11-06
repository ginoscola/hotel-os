// Previsione di cassa: saldo mese per mese con la fascia pessimista–ottimista e la soglia del fido, tabella per
// scenario (uscite certe e stimate), dettaglio del mese, prove "cosa succede se" che non salvano nulla, previsioni salvate.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import api from '../../api/client.js'
import { ExportMenu } from '../../components/ExportMenu.jsx'
import pastReferenceArea from '../../components/PastReferenceArea.jsx'
import { colors } from '../../styles/tokens.js'
import { formatData, formatEuro, formatEuroIntero, mostraErrore } from '../../utils/format.js'
import {
  Badge, Button, Card, Checkbox, Drawer, Field, Input, KpiTile, Loading, Messaggio, SegmentedControl, StatoVuoto,
  Table, Td, Th, useAvvisi, useConferma,
} from '../../components/ui'
import { Importo, MESI_BREVI, annoDi, etichettaAnno, isoLocale } from './helpers.jsx'

const LS_SCENARIO = 'tesoreria_previsione_scenario'
const LS_LINEE = 'tesoreria_previsione_linee'
const LINEE = [{ value: 'una', label: 'Una linea' }, { value: 'due', label: 'Ordinarie e straordinarie' }]
const SCENARI = [
  { value: 'pessimista', label: 'Pessimista' }, { value: 'realista', label: 'Realista' }, { value: 'ottimista', label: 'Ottimista' },
]
const NOMI_CERTE = {
  fisco: 'Fisco', affitti: 'Affitti', mutuo: 'Mutuo', ricorrenti: 'Ricorrenti', interventi: 'Spese straordinarie', compensi: 'Compensi soci', advertising: 'Advertising (carta)',
  carte: 'Estratti carte', stipendi: 'Stipendi netti (cedolini)', fornitori: 'Fornitori (scadenzario)', fatture: 'Fatture da registrare (SDI)', altri_impegni: 'Altri impegni',
}
const NOMI_STIMATE = { fornitori: 'Fornitori', personale: 'Personale', utenze: 'Utenze', marketing: 'Marketing', carte: 'Carte', altre: 'Altre' }
const COLORE_SALDO = colors.info
const COLORE_ORDINARIO = colors.success

const legendaNeutra = v => <span style={{ color: colors.text }}>{v}</span>
const etichetta = (a, m) => `${MESI_BREVI[m - 1]} ${String(a).slice(2)}`
const fineMese = (a, m) => isoLocale(new Date(a, m, 0))
const nomeMese = r => etichetta(r.anno, r.mese)

function datiGrafico(d, scenario) {
  const passato = d.storico.map(s => ({ label: etichetta(s.anno, s.mese), data: fineMese(s.anno, s.mese), reale: s.saldo }))
  const futuro = d.scenari.realista.map((r, i) => ({
    label: nomeMese(r), data: fineMese(r.anno, r.mese), previsto: d.scenari[scenario][i].saldo_finale, realista: r.saldo_finale,
    ordinario: d.scenari[scenario][i].saldo_ordinario, straordinarie: d.scenari[scenario][i].straordinarie,
    pessimista: d.scenari.pessimista[i].saldo_finale, ottimista: d.scenari.ottimista[i].saldo_finale,
    fascia: [d.scenari.pessimista[i].saldo_finale, d.scenari.ottimista[i].saldo_finale], soglia: -r.fido,
  }))
  // Le due linee si toccano nell'ultimo mese reale, così il grafico non ha un vuoto
  if (passato.length && futuro.length) {
    const ultimo = passato[passato.length - 1]
    ultimo.previsto = ultimo.reale
    ultimo.ordinario = ultimo.reale
  }
  return [...passato, ...futuro]
}

function TooltipSaldo({ active, payload, label, scenario, dueLinee }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const riga = (nome, v, chiave) => v != null && (
    <div style={chiave === scenario ? { color: COLORE_SALDO, fontWeight: 600 } : undefined}>{nome}: <strong>{formatEuroIntero(v)}</strong></div>
  )
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6, padding: 8, fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {riga('Saldo reale', p.fascia ? null : p.reale)}
      {riga('Ottimista', p.ottimista, 'ottimista')}
      {riga('Realista', p.realista, 'realista')}
      {riga('Pessimista', p.pessimista, 'pessimista')}
      {dueLinee && p.fascia && (
        <div style={{ marginTop: 4, color: COLORE_ORDINARIO }}>
          Solo spese ordinarie ({scenario}): <strong>{formatEuroIntero(p.ordinario)}</strong>
          {p.straordinarie > 0 && <div style={{ color: colors.text }}>Straordinarie del mese: <strong>{formatEuroIntero(p.straordinarie)}</strong></div>}
        </div>
      )}
      {riga('Soglia fido', p.soglia)}
    </div>
  )
}

/** Etichetta della linea verticale di fine anno: l'anno e il saldo di quel punto (ultimo giorno dell'anno). */
function EtichettaAnno({ viewBox, testo, data, saldo, reale }) {
  if (!viewBox) return null
  const x = viewBox.x - 6
  return (
    <text x={x} y={viewBox.y - 24} fontSize={12} fill={colors.textMuted} textAnchor="end">
      <tspan fontWeight={700} fill={colors.text}>Fine {testo}</tspan>
      <tspan x={x} dy={15}>
        {reale ? 'saldo reale' : 'saldo previsto'} al {data}:{' '}
        <tspan fontWeight={700} fill={saldo < 0 ? colors.danger : colors.text}>{formatEuroIntero(saldo)}</tspan>
      </tspan>
    </text>
  )
}

function GraficoSaldo({ d, scenario, tipoAnno, dueLinee }) {
  const dati = useMemo(() => datiGrafico(d, scenario), [d, scenario])
  const nomeScenario = SCENARI.find(s => s.value === scenario).label
  // una linea verticale sull'ultimo mese di ogni anno: dicembre (solare) o settembre (alberghiero),
  // sul punto di cui l'etichetta riporta il saldo
  const meseFine = tipoAnno === 'alberghiero' ? 9 : 12
  const fini = dati.filter(p => Number(p.data.slice(5, 7)) === meseFine).map(p => {
    const fine = new Date(Number(p.data.slice(0, 4)), meseFine, 0)
    const reale = p.previsto == null || p.reale != null
    return { label: p.label, testo: etichettaAnno(annoDi(fine, tipoAnno), tipoAnno),
      data: fine.toLocaleDateString('it-IT'), saldo: reale ? p.reale : p.previsto, reale, y: reale ? p.reale : p.previsto }
  })
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={dati} margin={{ top: 40, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: colors.textMuted }} interval={1} />
        <YAxis tickFormatter={v => `${Math.round(v / 1000)}k`} width={56} tick={{ fontSize: 12, fill: colors.textMuted }} />
        <Tooltip content={<TooltipSaldo scenario={scenario} dueLinee={dueLinee} />} />
        <Legend formatter={legendaNeutra} />
        {pastReferenceArea(dati, 'data', 'label', d.oggi)}
        <ReferenceLine y={0} stroke={colors.textMuted} />
        {fini.map(i => (
          <ReferenceLine key={i.label} x={i.label} stroke={colors.text} strokeWidth={2} strokeDasharray="6 4"
            label={<EtichettaAnno testo={i.testo} data={i.data} saldo={i.saldo} reale={i.reale} />} />
        ))}
        <Area dataKey="fascia" name="Da pessimista a ottimista" stroke="none" fill={COLORE_SALDO} fillOpacity={0.15} connectNulls={false} isAnimationActive={false} />
        <Line dataKey="reale" name="Saldo reale" stroke={colors.text} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="previsto" name={dueLinee ? `${nomeScenario}, con le spese straordinarie` : nomeScenario} stroke={COLORE_SALDO} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        {dueLinee && (
          <Line dataKey="ordinario" name={`${nomeScenario}, solo spese ordinarie`} stroke={COLORE_ORDINARIO} strokeWidth={2}
            strokeDasharray="5 3" dot={false} isAnimationActive={false} />
        )}
        {fini.map(i => <ReferenceDot key={`p${i.label}`} x={i.label} y={i.y} r={6} fill={colors.text} stroke={colors.surface} strokeWidth={2} />)}
        <Line dataKey="soglia" name="Soglia del fido" stroke={colors.danger} strokeWidth={2} strokeDasharray="6 4" dot={false} type="stepAfter" isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function BadgeStato({ stato }) {
  if (stato === 'sotto_fido') return <Badge tono="err">Oltre il fido</Badge>
  if (stato === 'sotto_zero') return <Badge tono="warn">Sotto zero</Badge>
  return null
}

function DettaglioMese({ riga, tolte = [], onChiudi }) {
  const tolteMese = tolte.filter(t => t.mese === riga.mese && (riga.riferimento_uscite || []).includes(t.anno))
  const [impegni, setImpegni] = useState(null)
  useEffect(() => {
    const primo = isoLocale(new Date(riga.anno, riga.mese - 1, 1))
    api.get(`/tesoreria/impegni?data_da=${primo}&data_a=${fineMese(riga.anno, riga.mese)}`).then(r => setImpegni(r.data.impegni)).catch(() => setImpegni([]))
  }, [riga])
  return (
    <Drawer titolo={`Dettaglio ${nomeMese(riga)}`} sottotitolo={`Entrate stimate ${formatEuro(riga.entrate)}`} onChiudi={onChiudi} larghezza={640}>
      {riga.rettifica_caparre ? (
        <Messaggio tipo="info">
          {riga.rettifica_caparre > 0
            ? `Entrate ridotte di ${formatEuro(riga.rettifica_caparre)}: per gli arrivi di questo mese sono già arrivate più caparre dell'anno prima alla stessa data.`
            : `Entrate aumentate di ${formatEuro(-riga.rettifica_caparre)}: per gli arrivi di questo mese sono arrivate meno caparre dell'anno prima alla stessa data, si attendono più vicino all'arrivo.`}
        </Messaggio>
      ) : null}
      <h4 style={{ margin: '0 0 6px' }}><Badge tono="info">Certe</Badge> {formatEuro(riga.totale_certe)}</h4>
      {Object.entries(riga.uscite_certe).map(([k, v]) => <div key={k}>{NOMI_CERTE[k] || k}: {formatEuro(v)}</div>)}
      <h4 style={{ margin: '12px 0 6px' }}><Badge>Stimate</Badge> {formatEuro(riga.totale_stimate)}</h4>
      {riga.riferimento_uscite?.length > 0 && (
        <p className="ui-text-muted" style={{ margin: '0 0 6px' }}>
          Dallo stesso mese {riga.riferimento_uscite.length > 1
            ? `del ${riga.riferimento_uscite[0]} (peso doppio) e del ${riga.riferimento_uscite[1]}`
            : `del ${riga.riferimento_uscite[0]}`}
          {riga.riferimento_previsti?.length > 0 && ` (del ${riga.riferimento_uscite[0]}, ${MESI_BREVI[riga.riferimento_previsti[0] - 1]}–dic sono quelli previsti qui)`}, scalato sul Budget.
          Entrate sul ritmo del {riga.riferimento_entrate ?? '—'}.
        </p>
      )}
      {Object.entries(riga.uscite_stimate).filter(([, v]) => v > 0).map(([k, v]) => <div key={k}>{NOMI_STIMATE[k] || k}: {formatEuro(v)}</div>)}
      {tolteMese.length > 0 && (
        <p className="ui-text-muted" style={{ margin: '6px 0 0' }}>
          Dallo storico di {MESI_BREVI[riga.mese - 1]} sono state tolte le fatture delle spese straordinarie:{' '}
          {tolteMese.map(t => `${t.categoria_nome} ${t.anno} ${formatEuro(t.importo)}`).join(', ')}.
        </p>
      )}
      <h4 style={{ margin: '12px 0 6px' }}>Impegni del mese</h4>
      {!impegni ? <Loading /> : impegni.length === 0 ? <StatoVuoto>Nessun impegno.</StatoVuoto> : (
        <Table compact>
          <thead>
            <tr>
              <Th>Data</Th><Th>Voce</Th><Th num>Dovuto</Th>
              <Th num style={{ whiteSpace: 'normal', width: 90 }}>Compensato con credito IVA</Th>
              <Th num style={{ whiteSpace: 'normal', width: 90 }}>Compensato con altri crediti F24</Th>
              <Th num style={{ whiteSpace: 'normal', width: 70 }}>Da pagare</Th>
            </tr>
          </thead>
          <tbody>
            {impegni.map(i => (
              <tr key={i.id}>
                <Td>{formatData(i.data_scadenza)}</Td><Td>{i.descrizione}</Td><Td num>{formatEuro(i.importo)}</Td>
                <Td num>{i.coperto_credito > 0 ? formatEuro(i.coperto_credito) : '—'}</Td>
                <Td num>{i.coperto_altri > 0 ? formatEuro(i.coperto_altri) : '—'}</Td>
                <Td num>{formatEuro(i.da_pagare)}</Td>
              </tr>
            ))}
            <tr className="ui-riga-totale">
              <Td>Totale</Td><Td></Td>
              {['importo', 'coperto_credito', 'coperto_altri', 'da_pagare'].map(k => (
                <Td num key={k}>{formatEuro(impegni.reduce((s, i) => s + i[k], 0))}</Td>
              ))}
            </tr>
          </tbody>
        </Table>
      )}
    </Drawer>
  )
}

function PannelloProva({ onProva, attiva, onTogli }) {
  const [rate, setRate] = useState(null)
  const [interventi, setInterventi] = useState([])
  const [rateInterventi, setRateInterventi] = useState([])
  const [rateCompensi, setRateCompensi] = useState([])
  const [sposta, setSposta] = useState({})
  const [accesi, setAccesi] = useState({})
  const avvisi = useAvvisi()

  useEffect(() => {
    Promise.all([api.get('/tesoreria/impegni?tipo=affitto'), api.get('/tesoreria/piani/interventi'), api.get('/tesoreria/impegni?tipo=intervento'), api.get('/tesoreria/impegni?tipo=compenso')]).then(([a, b, c, d]) => {
      setRateInterventi(c.data.impegni.filter(i => i.stato !== 'pagato'))
      setRateCompensi(d.data.impegni.filter(i => i.stato !== 'pagato'))
      setRate(a.data.impegni.filter(i => i.codice.startsWith('affitto:DPH:') && i.stato !== 'pagato'))
      setInterventi(b.data)
    }).catch(e => avvisi.errore(mostraErrore(e)))
  }, [avvisi])

  async function prova() {
    const on = [], off = []
    interventi.forEach(i => {
      if (!(i.id in accesi)) return
      if (accesi[i.id] && !i.inclusa_in_previsione) on.push(i.id)
      if (!accesi[i.id] && i.inclusa_in_previsione) off.push(i.id)
    })
    const corpo = { sposta: Object.fromEntries(Object.entries(sposta).filter(([, v]) => v)), interventi_on: on, interventi_off: off }
    try { onProva((await api.post('/tesoreria/previsione/prova', corpo)).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  function togli() { setSposta({}); setAccesi({}); onTogli() }

  if (!rate) return <Loading />
  return (
    <Card title="Prova: cosa succede se">
      <p className="ui-text-muted" style={{ marginBottom: 8 }}>
        Sposta le rate Du Parc, delle spese straordinarie in previsione e dei compensi, o accendi e spegni le spese straordinarie: grafico e tabella si ricalcolano, ma <strong>nulla viene salvato</strong>.
        Se la prova ti convince, cambia la rata in Admin → Tesoreria → Piano affitti.
      </p>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <strong>Rate Du Parc</strong>
          {rate.length === 0 && <StatoVuoto>Nessuna rata da pagare.</StatoVuoto>}
          {rate.map(r => (
            <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
              <span style={{ width: 90 }} className="ui-num">{formatEuroIntero(r.da_pagare)}</span>
              <Input type="date" value={sposta[r.id] || r.data_scadenza} modificato={r.id in sposta}
                onChange={e => setSposta({ ...sposta, [r.id]: e.target.value })} />
            </div>
          ))}
        </div>
        <div>
          <strong>Spese straordinarie</strong>
          {interventi.length === 0 && <StatoVuoto>Nessuna spesa straordinaria.</StatoVuoto>}
          {interventi.map(i => {
            const usabile = i.importo_stimato != null && i.rate.length > 0
            return (
              <div key={i.id} style={{ marginTop: 6 }}>
                <Checkbox label={`${i.descrizione}${usabile ? ` (${formatEuroIntero(i.importo_stimato)}, ${i.rate.length === 1 ? formatData(i.rate[0].data_prevista) : `${i.rate.length} rate`})` : ' — senza importo o rate'}`}
                  checked={i.id in accesi ? accesi[i.id] : i.inclusa_in_previsione}
                  onChange={x => usabile && setAccesi({ ...accesi, [i.id]: x })} />
              </div>
            )
          })}
          {rateInterventi.map(r => (
            <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
              <span style={{ width: 240 }}>{r.descrizione.replace('Intervento: ', '')} · {formatEuroIntero(r.da_pagare)}</span>
              <Input type="date" value={sposta[r.id] || r.data_scadenza} modificato={r.id in sposta}
                onChange={e => setSposta({ ...sposta, [r.id]: e.target.value })} />
            </div>
          ))}
        </div>
        {rateCompensi.length > 0 && (
          <div>
            <strong>Compensi soci</strong>
            {rateCompensi.map(r => (
              <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                <span style={{ width: 240 }}>{r.descrizione} · {formatEuroIntero(r.da_pagare)}</span>
                <Input type="date" value={sposta[r.id] || r.data_scadenza} modificato={r.id in sposta}
                  onChange={e => setSposta({ ...sposta, [r.id]: e.target.value })} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button onClick={prova}>Prova</Button>
        {attiva && <Button variant="secondary" onClick={togli}>Torna alla previsione</Button>}
      </div>
    </Card>
  )
}

function PrevisioniSalvate({ permessi, versione, onCambio }) {
  const [elenco, setElenco] = useState(null)
  const [nota, setNota] = useState('')
  const avvisi = useAvvisi()
  const conferma = useConferma()
  const carica = useCallback(() => {
    api.get('/tesoreria/previsione/salvate').then(r => setElenco(r.data)).catch(e => avvisi.errore(mostraErrore(e)))
  }, [avvisi])
  useEffect(() => { carica() }, [carica, versione])

  async function salva() {
    try {
      await api.post('/tesoreria/previsione/salva', { nota })
      setNota(''); avvisi.successo('Previsione salvata'); carica(); onCambio?.()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  async function elimina(s) {
    if (!await conferma({ titolo: 'Eliminare la previsione salvata?', messaggio: `Del ${formatData(s.data_riferimento)}`, pericolo: true })) return
    try { await api.delete(`/tesoreria/previsione/salvate/${s.id}`); carica() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  return (
    <Card title="Previsioni salvate">
      <p className="ui-text-muted" style={{ marginBottom: 8 }}>Una fotografia della previsione di oggi, da confrontare poi con il reale. Le prove non vengono salvate.</p>
      {permessi?.puo_modificare && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
          <Field label="Nota"><Input value={nota} style={{ width: 280 }} onChange={e => setNota(e.target.value)} /></Field>
          <Button onClick={salva}>Salva previsione</Button>
        </div>
      )}
      {!elenco ? <Loading /> : elenco.length === 0 ? <StatoVuoto>Nessuna previsione salvata.</StatoVuoto> : (
        <Table compact>
          <thead><tr><Th>Data</Th><Th>Nota</Th><Th num>Minimo realista</Th><Th num>Minimo pessimista</Th><Th></Th></tr></thead>
          <tbody>
            {elenco.map(s => (
              <tr key={s.id}>
                <Td>{formatData(s.data_riferimento)}</Td><Td>{s.nota || '—'}</Td>
                <Td num><Importo v={s.minimi?.realista?.saldo} /></Td><Td num><Importo v={s.minimi?.pessimista?.saldo} /></Td>
                <Td>{permessi?.puo_modificare && <Button size="sm" variant="danger-soft" onClick={() => elimina(s)}>Elimina</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

export default function TabPrevisione({ permessi, tipoAnno = 'solare' }) {
  const [base, setBase] = useState(null)
  const [prova, setProva] = useState(null)
  const [errore, setErrore] = useState(null)
  const [dettaglio, setDettaglio] = useState(null)
  const [scenario, setScenario] = useState(() => {
    try { return localStorage.getItem(LS_SCENARIO) || 'realista' } catch { return 'realista' }
  })
  const [linee, setLinee] = useState(() => {
    try { return localStorage.getItem(LS_LINEE) || 'una' } catch { return 'una' }
  })

  useEffect(() => {
    api.get('/tesoreria/previsione').then(r => setBase(r.data)).catch(e => setErrore(mostraErrore(e)))
  }, [])

  function cambiaScenario(s) {
    setScenario(s)
    try { localStorage.setItem(LS_SCENARIO, s) } catch { /* preferenza non salvata */ }
  }

  function cambiaLinee(v) {
    setLinee(v)
    try { localStorage.setItem(LS_LINEE, v) } catch { /* preferenza non salvata */ }
  }

  if (errore) return <Messaggio>{errore}</Messaggio>
  if (!base) return <Loading />
  const d = prova || base
  const righe = d.scenari[scenario]
  // riga di totale dopo l'ultimo mese di ogni anno (solare o alberghiero, dal toggle in cima alla pagina)
  const totaliDopo = new Map((d.totali_anno?.[tipoAnno]?.[scenario] || []).map(t => [`${t.al.anno}-${t.al.mese}`, t]))
  const critici = d.scenari.pessimista.filter(r => r.stato === 'sotto_fido')
  const totStraordinarie = righe.reduce((t, r) => t + (r.straordinarie || 0), 0)
  const kpiMin = nome => {
    const m = d.minimi[nome]
    const b = base.minimi[nome]
    return (
      <KpiTile key={nome} label={`Minimo ${nome}`} value={formatEuro(m.saldo)} colore={m.saldo < 0 ? colors.danger : undefined}
        sub={etichetta(m.anno, m.mese)}
        confronto={prova ? formatEuro(b.saldo) : null} confrontoLabel="senza prova" />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Messaggio tipo="info">
        È una stima: rifacendo il 2026 con i dati 2025 il saldo si è scostato dal reale fino a circa 100.000 €, quasi sempre per prudenza.
        Le uscite «certe» sono note; entrate e uscite «stimate» dipendono da Budget e storico.
      </Messaggio>
      {(d.avvisi || []).map(a => <Messaggio key={a} tipo="warn">{a}</Messaggio>)}
      {prova && <Messaggio tipo="warn">Stai guardando una prova: nulla è stato salvato.</Messaggio>}
      {critici.length > 0 && (
        <Messaggio tipo="warn">
          Scenario pessimista oltre il fido in: {critici.map(nomeMese).join(', ')}.
          {critici.some(r => r.fido === 0) && ' In questi mesi il fido risulta scaduto: se viene rinnovato, aggiornare la scadenza in Admin → Conti.'}
        </Messaggio>
      )}

      <div className="ui-kpi-row">
        <KpiTile size="lg" label="Saldo dei conti oggi" value={formatEuro(d.saldo_iniziale)} sub={formatData(d.oggi)} />
        {['pessimista', 'realista', 'ottimista'].map(kpiMin)}
        {d.fattore_budget && (
          <KpiTile label="Budget sui ricavi dell'anno prima" value={`${d.fattore_budget >= 1 ? '+' : ''}${((d.fattore_budget - 1) * 100).toFixed(1).replace('.', ',')}%`}
            sub="modificando il Budget cambia subito" />
        )}
      </div>

      <Card title="Saldo dei conti a fine mese" actions={<SegmentedControl options={LINEE} value={linee} onChange={cambiaLinee} />}>
        {linee === 'due' && (
          <p className="ui-text-muted" style={{ margin: '0 0 8px' }}>
            {totStraordinarie > 0
              ? <>La linea verde è il saldo senza le spese straordinarie previste ({formatEuroIntero(totStraordinarie)} fino a fine previsione): la distanza tra le due è quanto pesano. </>
              : <>Nessuna spesa straordinaria in previsione: le due linee coincidono. </>}
            Si inseriscono in Admin → Tesoreria → Spese straordinarie (solo quelle «In previsione»); quelle già pagate in passato (pagamenti segnati come straordinari e fatture collegate, con modalità e data di pagamento) non entrano nelle stime.
          </p>
        )}
        <GraficoSaldo d={d} scenario={scenario} tipoAnno={tipoAnno} dueLinee={linee === 'due'} />
      </Card>

      <Card title="Mese per mese" actions={<ExportMenu url={`/tesoreria/previsione/export?scenario=${scenario}&tipo_anno=${tipoAnno}`} nome={`previsione_${scenario}`} />}>
        <div style={{ marginBottom: 8 }}><SegmentedControl options={SCENARI} value={scenario} onChange={cambiaScenario} label="Scenario" /></div>
        <Table compact>
          <thead>
            <tr>
              <Th>Mese</Th><Th num>Saldo iniziale</Th><Th num>Entrate (stima)</Th><Th num>Uscite certe</Th><Th num>di cui straordinarie</Th><Th num>Uscite stimate</Th>
              <Th num>Saldo finale</Th><Th num>Cassa libera a 90 gg</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {righe.map(r => {
              const t = totaliDopo.get(`${r.anno}-${r.mese}`)
              return (
                <Fragment key={`${r.anno}-${r.mese}`}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setDettaglio(r)}
                    className={r.stato === 'sotto_fido' ? 'ui-riga-errore' : r.stato === 'sotto_zero' ? 'ui-riga-avviso' : undefined}>
                    <Td>{nomeMese(r)}</Td>
                    <Td num><Importo v={r.saldo_iniziale} /></Td>
                    <Td num>{formatEuro(r.entrate)}</Td>
                    <Td num>{formatEuro(r.totale_certe)}</Td>
                    <Td num>{r.straordinarie ? formatEuro(r.straordinarie) : '—'}</Td>
                    <Td num>{formatEuro(r.totale_stimate)}</Td>
                    <Td num tot><Importo v={r.saldo_finale} forte /></Td>
                    <Td num><Importo v={r.cassa_libera} /></Td>
                    <Td><BadgeStato stato={r.stato} /></Td>
                  </tr>
                  {t && (
                    <tr className="ui-riga-subtotale">
                      <Td>Totale {t.etichetta}{!t.completo && <span className="ui-text-muted"> ({t.n_mesi} mesi)</span>}</Td>
                      <Td num><Importo v={t.saldo_iniziale} /></Td>
                      <Td num>{formatEuro(t.entrate)}</Td>
                      <Td num>{formatEuro(t.totale_certe)}</Td>
                      <Td num>{t.straordinarie ? formatEuro(t.straordinarie) : '—'}</Td>
                      <Td num>{formatEuro(t.totale_stimate)}</Td>
                      <Td num tot><Importo v={t.saldo_finale} forte /></Td>
                      <Td num /><Td />
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </Table>
      </Card>

      <PannelloProva onProva={setProva} attiva={!!prova} onTogli={() => setProva(null)} />
      <PrevisioniSalvate permessi={permessi} />
      {dettaglio && <DettaglioMese riga={dettaglio} tolte={d.straordinarie_tolte} onChiudi={() => setDettaglio(null)} />}
    </div>
  )
}
