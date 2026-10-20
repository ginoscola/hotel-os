import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client.js'
import { formatData, formatEuro, mostraErrore } from '../../utils/format.js'
import { meseNome } from '../../utils/corrispettiviHelpers.js'
import SpiegazionePrevisione from '../../components/SpiegazionePrevisione.jsx'
import {
  Badge, Button, Card, Field, HotelTag, Input, Loading, Messaggio, NavAnno, PageHeader,
  SectionTitle, SezioneApribile, StatoVuoto, Table, Td, Th, useAvvisi, useConferma,
} from '../../components/ui'
import { colors } from '../../styles/tokens.js'

// Da ottobre si lavora già sulla stagione successiva
const annoDefault = () => {
  const oggi = new Date()
  return oggi.getMonth() >= 9 ? oggi.getFullYear() + 1 : oggi.getFullYear()
}

const fmtPct = (v) => `${v > 0 ? '+' : ''}${v}%`

/** Correttivi % sul pickup previsto + parametri dell'algoritmo della proiezione fine stagione
 * (services/pickup_forecast.py). */
export default function AdminBudgetPrevisione() {
  const [anno, setAnno] = useState(annoDefault)
  // incrementato quando "Applica" scrive un correttivo, per ricaricare la griglia
  const [versione, setVersione] = useState(0)
  return (
    <div>
      <PageHeader title="Budget — previsione fine stagione">
        <SpiegazionePrevisione variant="secondary" />
        <NavAnno anno={anno} onChange={setAnno} />
      </PageHeader>
      <p className="ui-text-muted" style={{ fontSize: 'var(--fs-base)', maxWidth: 820, marginTop: -8 }}>
        Nella tab Proiezione del Budget le settimane future valgono: prenotato (OTB) + vendite
        attese, stimate da come sono cresciute le prenotazioni negli anni precedenti alla stessa
        distanza dall'arrivo. Qui si controlla quanto sbaglia e si regola quanto essere ottimisti.
      </p>
      <Controllo anno={anno} onApplicato={() => setVersione(v => v + 1)} />
      <Correttivi anno={anno} versione={versione} />
      <Parametri />
    </div>
  )
}

const ETICHETTA_ANTICIPO = { 14: '2 settimane prima', 28: '4 settimane prima', 56: '8 settimane prima' }

// scostamento_pct > 0 = previsione più alta del finale
function tendenza(scost) {
  if (scost == null) return '—'
  if (Math.abs(scost) < 2) return <Badge tono="ok">in linea</Badge>
  return scost > 0
    ? <Badge tono="warn">sovrastima {fmtPct(scost)}</Badge>
    : <Badge tono="info">sottostima {fmtPct(scost)}</Badge>
}

function Controllo({ anno, onApplicato }) {
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const [dettaglioAperto, setDettaglioAperto] = useState({})
  const avvisi = useAvvisi()

  const carica = useCallback(() => {
    setDati(null)
    api.get(`/budget-previsione/controllo?anno=${anno}`)
      .then(r => { setDati(r.data); setErrore(null) })
      .catch(e => setErrore(mostraErrore(e)))
  }, [anno])

  useEffect(() => { carica() }, [carica])

  async function applica(h) {
    try {
      await api.put('/budget-previsione/correttivi', {
        hotel_code: h.hotel_code, season_year: anno, mese: 0, correttivo_pct: h.complessivo.suggerito_pct,
      })
      avvisi.successo(`${h.hotel_code}: correttivo di stagione ${fmtPct(h.complessivo.suggerito_pct)}`)
      carica()
      onApplicato()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    }
  }

  const riga = (r, etichetta, h) => (
    <tr key={etichetta} className={h ? 'ui-riga-subtotale' : undefined}>
      <Td>{etichetta}</Td>
      <Td num>{r.n_settimane}</Td>
      <Td num>{r.errore_medio_pct != null ? `${r.errore_medio_pct}%` : '—'}</Td>
      <Td>{tendenza(r.scostamento_pct)}</Td>
      <Td num>{r.n_settimane ? formatEuro(r.pickup_previsto) : '—'}</Td>
      <Td num>{r.n_settimane ? formatEuro(r.pickup_reale) : '—'}</Td>
      <Td num style={{ fontWeight: h ? 700 : undefined }}>
        {r.suggerito_pct != null ? fmtPct(r.suggerito_pct) : (r.n_settimane ? 'dati insufficienti' : '—')}
      </Td>
      <Td>
        {h && r.suggerito_pct != null && r.suggerito_pct !== (h.correttivo_stagione ?? 0) && (
          <Button size="sm" onClick={() => applica(h)}>Applica alla stagione</Button>
        )}
      </Td>
    </tr>
  )

  return (
    <Card title="Controllo dell'algoritmo" style={{ marginBottom: 20 }}>
      <p className="ui-text-muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Per ogni settimana già chiusa la previsione viene rifatta come se fosse stata calcolata
        2, 4 e 8 settimane prima (senza correttivo) e confrontata con il finale. Correttivo
        suggerito = vendite reali ÷ vendite previste − 1, su tutte le settimane chiuse; serve
        almeno {dati?.min_settimane_suggerimento ?? 3} settimane. Le prime settimane chiuse sono di
        bassa stagione: il suggerimento va letto, non applicato a occhi chiusi.
      </p>
      {errore && <Messaggio tipo="err">{errore}</Messaggio>}
      {!dati && !errore && <Loading />}
      {dati?.hotel.map(h => (
        <div key={h.hotel_code} style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 8 }}>
            <HotelTag code={h.hotel_code} /> <strong>{h.hotel_name}</strong>
            <span className="ui-text-muted">
              {h.snapshot ? `prenotato al ${formatData(h.snapshot)}` : `nessun import Revenue ${anno}`}
              {h.snapshot && (h.anni_storico.length
                ? ` · storico ${h.anni_storico.join(', ')}`
                : ' · nessuno storico degli anni precedenti')}
              {' · correttivo di stagione attuale '}{fmtPct(h.correttivo_stagione ?? 0)}
            </span>
          </div>

          {!h.snapshot || !h.anni_storico.length ? (
            <StatoVuoto>
              {!h.snapshot
                ? `Il controllo si attiva con il primo import Revenue ${anno}.`
                : `Serve lo storico del ${anno - 1}: senza, la previsione usa il budget e non c'è nulla da misurare.`}
            </StatoVuoto>
          ) : (
            <>
              <Table compact>
                <thead>
                  <tr>
                    <Th>Previsione calcolata</Th><Th num>Settimane chiuse</Th><Th num>Errore medio</Th>
                    <Th>Tendenza</Th><Th num>Vendite previste</Th><Th num>Vendite reali</Th>
                    <Th num>Correttivo suggerito</Th><Th />
                  </tr>
                </thead>
                <tbody>
                  {h.per_anticipo.map(a => riga(a, ETICHETTA_ANTICIPO[a.anticipo_giorni] ?? `${a.anticipo_giorni} giorni prima`))}
                  {riga(h.complessivo, 'Complessivo', h)}
                </tbody>
              </Table>

              <SectionTitle as="h3" style={{ marginTop: 16 }}>
                Ritmo rispetto al {anno - 1} alla stessa data
                {h.snapshot_anno_prec && <span className="ui-text-muted" style={{ fontWeight: 400 }}> (snapshot {formatData(h.snapshot_anno_prec)})</span>}
              </SectionTitle>
              <Table compact>
                <thead>
                  <tr>
                    <Th>Mese</Th><Th num>Prenotato oggi</Th><Th num>{anno - 1} alla stessa data</Th>
                    <Th num>Δ</Th><Th num>Finale {anno - 1}</Th>
                  </tr>
                </thead>
                <tbody>
                  {h.ritmo.map(r => (
                    <tr key={r.mese}>
                      <Td>{meseNome(r.mese)}</Td>
                      <Td num>{formatEuro(r.otb)}</Td>
                      <Td num>{r.otb_anno_prec != null ? formatEuro(r.otb_anno_prec) : '—'}</Td>
                      <Td num style={{ color: r.delta_pct == null ? undefined : r.delta_pct >= 0 ? colors.success : colors.danger }}>
                        {r.delta_pct != null ? fmtPct(r.delta_pct) : '—'}
                      </Td>
                      <Td num>{r.finale_anno_prec != null ? formatEuro(r.finale_anno_prec) : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="ui-text-muted" style={{ marginTop: 4 }}>
                Già considerato dall'algoritmo (parte dal prenotato di oggi): serve a capire perché
                la previsione cambia, non va trasformato direttamente in correttivo.
              </p>

              {h.settimane.length > 0 && (
                <SezioneApribile
                  titolo="Dettaglio settimane chiuse"
                  aperta={!!dettaglioAperto[h.hotel_code]}
                  onToggle={() => setDettaglioAperto(d => ({ ...d, [h.hotel_code]: !d[h.hotel_code] }))}
                >
                  <Table compact>
                    <thead>
                      <tr>
                        <Th>Settimana</Th><Th num>Finale</Th>
                        {dati.anticipi_giorni.map(a => <Th num key={a}>Prev. {ETICHETTA_ANTICIPO[a] ?? `${a} gg prima`}</Th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {h.settimane.map(s => (
                        <tr key={s.week_start}>
                          <Td>{formatData(s.week_start)}</Td>
                          <Td num>{formatEuro(s.finale)}</Td>
                          {dati.anticipi_giorni.map(a => {
                            const p = s.previsioni.find(x => x.anticipo_giorni === a)
                            if (!p) return <Td num key={a}>—</Td>
                            const err = s.finale ? (p.previsione - s.finale) / s.finale * 100 : null
                            return (
                              <Td num key={a} title={`Prenotato allora ${formatEuro(p.otb)} (snapshot ${formatData(p.snapshot)})`}>
                                {formatEuro(p.previsione)}
                                {err != null && <span className="ui-text-muted"> ({fmtPct(Math.round(err))})</span>}
                              </Td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </SezioneApribile>
              )}
            </>
          )}
        </div>
      ))}
    </Card>
  )
}

function Correttivi({ anno, versione }) {
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const avvisi = useAvvisi()

  const carica = useCallback(() => {
    api.get(`/budget-previsione/correttivi?anno=${anno}`)
      .then(r => { setDati(r.data); setErrore(null) })
      .catch(e => setErrore(mostraErrore(e)))
  }, [anno])

  useEffect(() => { carica() }, [carica, versione])

  const valore =(hotel, mese) =>
    dati?.righe.find(r => r.hotel_code === hotel && r.mese === mese)?.correttivo_pct

  async function salva(hotel, mese, testo) {
    const nuovo = testo.trim() === '' ? null : parseFloat(testo.replace(',', '.'))
    if (nuovo !== null && Number.isNaN(nuovo)) return
    if (nuovo === (valore(hotel, mese) ?? null)) return
    try {
      await api.put('/budget-previsione/correttivi', {
        hotel_code: hotel, season_year: anno, mese, correttivo_pct: nuovo,
      })
      const periodo = mese === 0 ? 'stagione' : meseNome(mese)
      avvisi.successo(nuovo === null
        ? `${hotel} ${periodo}: correttivo tolto`
        : `${hotel} ${periodo}: correttivo ${fmtPct(nuovo)}`)
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    }
    carica()
  }

  const cella = (hotel, mese) => {
    const v = valore(hotel, mese)
    const ereditato = mese === 0 ? 0 : (valore(hotel, 0) ?? 0)
    return (
      <Td num key={mese}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Input
            key={`${anno}-${hotel}-${mese}-${v ?? ''}`}
            defaultValue={v ?? ''}
            placeholder={String(ereditato)}
            className="ui-num"
            style={{
              width: 64, textAlign: 'right', padding: '3px 6px',
              color: v != null ? colors.accent : undefined, fontWeight: v != null ? 600 : undefined,
            }}
            onBlur={e => salva(hotel, mese, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
          />
          <span className="ui-text-muted">%</span>
        </span>
      </Td>
    )
  }

  return (
    <Card title={`Correttivi sulle vendite attese — stagione ${anno}`} style={{ marginBottom: 20 }}>
      <p className="ui-text-muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Il correttivo agisce solo sulle vendite ancora da fare, mai sul prenotato. Esempio: OTB
        40.000 €, algoritmo 60.000 € → pickup 20.000 €; con −20% la previsione è 40.000 + 16.000
        = 56.000 €. Il mese prevale sulla stagione; una cella vuota usa il valore in grigio
        (stagione, oppure 0). Si salva uscendo dalla cella o con Invio; svuotarla toglie il correttivo.
      </p>
      {errore && <Messaggio tipo="err">{errore}</Messaggio>}
      {dati && (
        <Table compact>
          <thead>
            <tr>
              <Th>Hotel</Th>
              <Th num>Stagione</Th>
              {dati.mesi.map(m => <Th num key={m}>{meseNome(m)}</Th>)}
            </tr>
          </thead>
          <tbody>
            {dati.hotel.map(h => (
              <tr key={h.code}>
                <Td><HotelTag code={h.code} /> <span className="ui-text-muted">{h.name}</span></Td>
                {cella(h.code, 0)}
                {dati.mesi.map(m => cella(h.code, m))}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// Campi del form: in percentuale per il peso moltiplicativo, il resto come salvato
const CAMPI = [
  { key: 'peso_moltiplicativo', label: 'Peso coefficiente moltiplicativo', unita: '%',
    daServer: v => Math.round(v * 100), aServer: v => v / 100,
    aiuto: 'Il resto va al pickup additivo. Più additivo = più prudente quando il prenotato è già alto.' },
  { key: 'finestra_settimane', label: 'Settimane vicine considerate (±)', unita: 'sett.',
    aiuto: 'Quante settimane prima e dopo la stessa settimana dell\'anno precedente fanno da riferimento.' },
  { key: 'tetto_coefficiente', label: 'Tetto al coefficiente', unita: '×', vuotoAmmesso: true,
    aiuto: 'Vuoto = nessun tetto. Un tetto basso limita le stime lontane dalla data (DPH vende molto sotto data: ×9 a 20 settimane è normale).' },
  { key: 'peso_anno_1', label: 'Peso anno precedente', unita: '',
    aiuto: 'Con più anni di storico, media pesata degli anni.' },
  { key: 'peso_anno_2', label: 'Peso due anni prima', unita: '',
    aiuto: 'Usato solo quando ci sono dati di due anni prima.' },
  { key: 'tolleranza_giorni', label: 'Tolleranza snapshot', unita: 'giorni',
    aiuto: 'Distanza massima tra l\'anticipo cercato e la snapshot dell\'anno precedente usata.' },
]

const inForm = (v) => {
  const f = {}
  for (const c of CAMPI) {
    const raw = c.key === 'peso_anno_1' ? v.peso_anni?.[0]
      : c.key === 'peso_anno_2' ? v.peso_anni?.[1]
      : v[c.key]
    f[c.key] = raw == null ? '' : String(c.daServer ? c.daServer(raw) : raw)
  }
  return f
}

function Parametri() {
  const [dati, setDati] = useState(null)
  const [form, setForm] = useState({})
  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState(null)
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(() => {
    api.get('/budget-previsione/parametri')
      .then(r => { setDati(r.data); setForm(inForm(r.data.valori)) })
      .catch(e => setErrore(mostraErrore(e)))
  }, [])

  useEffect(() => { carica() }, [carica])

  async function invia(body, messaggio) {
    setSalvando(true)
    try {
      await api.put('/budget-previsione/parametri', body)
      avvisi.successo(messaggio)
      carica()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setSalvando(false)
    }
  }

  function salva() {
    const num = (k) => parseFloat(String(form[k]).replace(',', '.'))
    const body = {}
    for (const c of CAMPI) {
      if (c.key.startsWith('peso_anno')) continue
      if (form[c.key] === '') {
        if (c.vuotoAmmesso) body[c.key] = null
        continue
      }
      body[c.key] = c.aServer ? c.aServer(num(c.key)) : num(c.key)
    }
    body.peso_anni = [num('peso_anno_1') || 0, num('peso_anno_2') || 0]
    invia(body, 'Parametri della previsione salvati')
  }

  async function ripristina() {
    const ok = await conferma({
      titolo: 'Ripristinare i valori predefiniti?',
      messaggio: 'I parametri dell\'algoritmo tornano ai valori iniziali. I correttivi non vengono toccati.',
    })
    if (ok) invia(dati.default, 'Parametri ripristinati ai valori predefiniti')
  }

  if (errore) return <Messaggio tipo="err">{errore}</Messaggio>
  if (!dati) return null
  const def = inForm(dati.default)
  const sporco = CAMPI.some(c => form[c.key] !== inForm(dati.valori)[c.key])

  return (
    <Card title="Parametri dell'algoritmo" actions={<>
      <Button variant="secondary" size="sm" onClick={ripristina} disabled={salvando}>Ripristina predefiniti</Button>
      <Button size="sm" onClick={salva} disabled={!sporco || salvando}>{salvando ? 'Salvo…' : 'Salva'}</Button>
    </>}>
      <p className="ui-text-muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Valgono per tutti gli hotel e tutte le stagioni. I predefiniti sono quelli che hanno dato
        l'errore più basso nella prova sulla stagione 2026: cambiarli solo se il pannello dei
        correttivi non basta.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {CAMPI.map(c => (
          <Field key={c.key} label={c.label}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Input
                value={form[c.key] ?? ''}
                placeholder={c.vuotoAmmesso ? 'nessuno' : undefined}
                modificato={form[c.key] !== inForm(dati.valori)[c.key]}
                className="ui-num"
                style={{ width: 90, textAlign: 'right' }}
                onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))}
              />
              <span className="ui-text-muted">{c.unita}</span>
              <span className="ui-text-muted" style={{ fontSize: 'var(--fs-sm)' }}>
                (predefinito: {def[c.key] === '' ? 'nessuno' : def[c.key]})
              </span>
            </span>
            <span className="ui-text-muted" style={{ fontSize: 'var(--fs-sm)' }}>{c.aiuto}</span>
          </Field>
        ))}
      </div>
    </Card>
  )
}
