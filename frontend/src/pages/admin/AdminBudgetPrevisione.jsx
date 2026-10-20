import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client.js'
import { mostraErrore } from '../../utils/format.js'
import { meseNome } from '../../utils/corrispettiviHelpers.js'
import {
  Button, Card, Field, HotelTag, Input, Messaggio, NavAnno, PageHeader, Table, Td, Th,
  useAvvisi, useConferma,
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
  return (
    <div>
      <PageHeader title="Budget — previsione fine stagione" />
      <p className="ui-text-muted" style={{ fontSize: 'var(--fs-base)', maxWidth: 820, marginTop: -8 }}>
        Nella tab Proiezione del Budget le settimane future valgono: prenotato (OTB) + vendite
        attese, stimate da come sono cresciute le prenotazioni negli anni precedenti alla stessa
        distanza dall'arrivo. Qui si regola quanto essere ottimisti.
      </p>
      <Correttivi />
      <Parametri />
    </div>
  )
}

function Correttivi() {
  const [anno, setAnno] = useState(annoDefault)
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const avvisi = useAvvisi()

  const carica = useCallback(() => {
    api.get(`/budget-previsione/correttivi?anno=${anno}`)
      .then(r => { setDati(r.data); setErrore(null) })
      .catch(e => setErrore(mostraErrore(e)))
  }, [anno])

  useEffect(() => { carica() }, [carica])

  const valore = (hotel, mese) =>
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
    <Card title="Correttivi sul pickup previsto" actions={<NavAnno anno={anno} onChange={setAnno} />}
      style={{ marginBottom: 20 }}>
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
