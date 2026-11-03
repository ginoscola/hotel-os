// Caparre per mese di arrivo (Fase 4a): incassi arrivati in banca prima del soggiorno. Mese di arrivo letto dalla
// causale dei bonifici da clienti o trovato tra gli ospiti delle prenotazioni Welcome; confronto con l'anno prima
// alla stessa data, coda dei bonifici senza periodo, elenco di quelli abbinati o sistemati a mano.
import { Fragment, useEffect, useState } from 'react'
import api from '../../api/client.js'
import { colors } from '../../styles/tokens.js'
import { formatData, formatDataIt, formatEuro, mostraErrore } from '../../utils/format.js'
import {
  Badge, Button, Card, Checkbox, HotelTag, Input, Loading, Messaggio, NavAnno, SezioneApribile, Select, StatoVuoto,
  Table, Td, Th, useAvvisi,
} from '../../components/ui'
import { Importo, STRUTTURE, annoDi, causaleDi, etichettaAnno } from './helpers.jsx'

const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre',
  'ottobre', 'novembre', 'dicembre']
const nomeStruttura = code => STRUTTURE.find(s => s.code === code)?.nome

function RigaCoda({ m, anno, puoModificare, selezionato, onSeleziona, onSalva }) {
  const [arrivo, setArrivo] = useState('')
  const [struttura, setStruttura] = useState('')
  return (
    <tr>
      {puoModificare && <Td><Checkbox checked={selezionato} onChange={onSeleziona} /></Td>}
      <Td>{formatData(m.data_contabile)}</Td>
      <Td num><Importo v={m.importo} /></Td>
      <Td>{m.controparte || '—'}</Td>
      <Td style={{ maxWidth: 360 }}>{causaleDi(m)}</Td>
      {puoModificare && <>
        <Td><Input type="date" value={arrivo} min={`${anno}-04-01`} max={`${anno}-10-31`}
          onChange={e => setArrivo(e.target.value)} /></Td>
        <Td>
          <Select value={struttura} onChange={e => setStruttura(e.target.value)}>
            <option value="">non indicata</option>
            {STRUTTURE.map(s => <option key={s.code} value={s.code}>{s.nome}</option>)}
          </Select>
        </Td>
        <Td style={{ whiteSpace: 'nowrap' }}>
          <Button size="sm" disabled={!arrivo} onClick={() => onSalva(m.id, { arrivo, struttura: struttura || null })}>Salva</Button>{' '}
          <Button size="sm" variant="secondary" onClick={() => onSalva(m.id, { senza_periodo: true })}>Senza periodo</Button>{' '}
          <Button size="sm" variant="ghost" onClick={() => onSalva(m.id, { escluso: true })}>Non è una caparra</Button>
        </Td>
      </>}
    </tr>
  )
}

function Esito({ m }) {
  if (m.arrivo_regola === 'escluso') return <Badge>non è una caparra</Badge>
  if (m.arrivo_regola === 'senza_periodo') return <Badge tono="info">caparra senza periodo</Badge>
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      arrivo {formatData(m.arrivo)}
      {m.arrivo_struttura && <HotelTag code={m.arrivo_struttura} label={nomeStruttura(m.arrivo_struttura)} />}
    </span>
  )
}

const origine = m => (m.arrivo_regola || '').startsWith('welcome:')
  ? `prenotazione Welcome n. ${m.arrivo_regola.slice(8)}` : 'a mano'

export default function TabCaparre({ permessi }) {
  const corrente = annoDi(new Date(), 'alberghiero')
  const [anno, setAnno] = useState(corrente)
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const [versione, setVersione] = useState(0)
  const [selezione, setSelezione] = useState(() => new Set())
  const [sistematiAperti, setSistematiAperti] = useState(false)
  const avvisi = useAvvisi()

  useEffect(() => {
    let annullato = false
    setErrore(null)
    api.get('/tesoreria/caparre', { params: { anno } })
      .then(r => { if (!annullato) { setDati(r.data); setSelezione(new Set()) } })
      .catch(e => { if (!annullato) setErrore(mostraErrore(e)) })
    return () => { annullato = true }
  }, [anno, versione])

  if (errore) return <Messaggio>{errore}</Messaggio>
  if (!dati) return <Loading />

  const ricarica = () => setVersione(v => v + 1)
  async function salva(id, corpo) {
    try { await api.put(`/tesoreria/caparre/${id}`, corpo); ricarica() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  async function segna(stato) {
    try {
      await api.post('/tesoreria/caparre/segna', { ids: [...selezione], stato })
      avvisi.successo(`${selezione.size} bonifici aggiornati`)
      ricarica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  const seleziona = (id, si) => setSelezione(prev => {
    const n = new Set(prev)
    if (si) n.add(id); else n.delete(id)
    return n
  })

  const riga = (titolo, x, classe) => {
    const diff = x.quest_anno.totale - x.anno_prima.totale
    return (
      <tr className={classe}>
        <Td>{titolo}</Td>
        {STRUTTURE.map(s => <Td key={s.code} num>{formatEuro(x.quest_anno.per_struttura[s.code])}</Td>)}
        <Td num muted>{formatEuro(x.quest_anno.per_struttura[''])}</Td>
        <Td num tot>{formatEuro(x.quest_anno.totale)}</Td>
        <Td num gruppo>{formatEuro(x.anno_prima.totale)}</Td>
        <Td num style={{ color: diff < 0 ? colors.danger : diff > 0 ? colors.success : undefined }}>
          {diff > 0 ? '+' : ''}{formatEuro(diff)}
        </Td>
        <Td num muted>{formatEuro(x.anno_prima_finale.totale)}</Td>
      </tr>
    )
  }
  const b = dati.bonifici
  const puoModificare = permessi?.puo_modificare
  const tuttiSelezionati = dati.coda.length > 0 && dati.coda.every(m => selezione.has(m.id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <NavAnno anno={anno} onChange={setAnno} etichetta={a => `Stagione ${a} (${etichettaAnno(a, 'alberghiero')})`} />
        <span className="ui-text-muted">
          Incassi fino al {formatDataIt(dati.al_giorno)}; anno prima fino al {formatDataIt(dati.al_giorno_ap)}
        </span>
      </div>

      <Card title="Caparre per mese di arrivo">
        <Table compact>
          <thead>
            <tr>
              <Th rowSpan={2}>Arrivo</Th>
              <Th center colSpan={5}>Stagione {anno}</Th>
              <Th center colSpan={2} gruppo>Stagione {anno - 1} alla stessa data</Th>
              <Th rowSpan={2} num>{anno - 1} a fine stagione</Th>
            </tr>
            <tr className="sub">
              {STRUTTURE.map(s => <Th key={s.code} num><HotelTag code={s.code} label={s.nome} /></Th>)}
              <Th num>Non indicata</Th><Th num tot>Totale</Th>
              <Th num gruppo>Totale</Th><Th num>Differenza</Th>
            </tr>
          </thead>
          <tbody>
            {dati.mesi.map(x => <Fragment key={x.mese}>{riga(MESI_LUNGHI[x.mese - 1], x)}</Fragment>)}
            {riga('Periodo non indicato', dati.senza_periodo, 'ui-riga-attenuata')}
            {riga('TOTALE', dati.totali, 'ui-riga-totale')}
          </tbody>
        </Table>
        <p className="ui-text-muted" style={{ marginTop: 8 }}>
          Caparre = bonifici da clienti arrivati prima del giorno di arrivo (caparre, acconti e saldi anticipati).
          Mese di arrivo letto dalla causale oppure trovato tra gli ospiti delle prenotazioni Welcome importate nel
          Forecast. Bonifici della stagione: {b.n} — letti {b.n_letti} (di cui {b.n_welcome} tramite Welcome), senza
          periodo {b.n_senza_periodo}, non caparre {b.n_esclusi}, da completare {b.n_coda}. Le caparre senza periodo
          sono distribuite sui mesi in proporzione alle altre; quelle pagate con carta o POS non hanno causale e non
          compaiono. In Previsione la differenza con l'anno prima (× il fattore del Budget) sposta gli incassi sul
          mese di arrivo: il totale della stagione resta quello del Budget.
        </p>
      </Card>

      <Card title={`Bonifici da completare (${dati.coda.length})`}
        actions={puoModificare && selezione.size > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" variant="secondary" onClick={() => segna('senza_periodo')}>
              {selezione.size} come caparre senza periodo
            </Button>
            <Button size="sm" variant="ghost" onClick={() => segna('escluso')}>{selezione.size} non sono caparre</Button>
          </div>
        )}>
        {dati.coda.length === 0 ? <StatoVuoto>Nessun bonifico da completare.</StatoVuoto> : (
          <Table compact maxHeight="60vh">
            <thead>
              <tr>
                {puoModificare && (
                  <Th><Checkbox checked={tuttiSelezionati}
                    onChange={si => setSelezione(si ? new Set(dati.coda.map(m => m.id)) : new Set())} /></Th>
                )}
                <Th>Data</Th><Th num>Importo</Th><Th>Ordinante</Th><Th>Causale</Th>
                {puoModificare && <><Th>Arrivo</Th><Th>Struttura</Th><Th /></>}
              </tr>
            </thead>
            <tbody>
              {dati.coda.map(m => (
                <RigaCoda key={m.id} m={m} anno={anno} puoModificare={puoModificare} selezionato={selezione.has(m.id)}
                  onSeleziona={si => seleziona(m.id, si)} onSalva={salva} />
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <SezioneApribile titolo={`Abbinati a una prenotazione Welcome o sistemati a mano (${dati.sistemati.length})`}
        aperta={sistematiAperti} onToggle={() => setSistematiAperti(a => !a)}>
        {dati.sistemati.length === 0 ? <StatoVuoto>Nessuno.</StatoVuoto> : (
          <Table compact maxHeight="60vh">
            <thead>
              <tr>
                <Th>Data</Th><Th num>Importo</Th><Th>Ordinante</Th><Th>Causale</Th><Th>Esito</Th><Th>Da</Th>
                {puoModificare && <Th />}
              </tr>
            </thead>
            <tbody>
              {dati.sistemati.map(m => (
                <tr key={m.id}>
                  <Td>{formatData(m.data_contabile)}</Td>
                  <Td num><Importo v={m.importo} /></Td>
                  <Td>{m.controparte || '—'}</Td>
                  <Td style={{ maxWidth: 360 }}>{causaleDi(m)}</Td>
                  <Td><Esito m={m} /></Td>
                  <Td muted>{origine(m)}</Td>
                  {puoModificare && (
                    <Td>
                      {m.arrivo_manuale ? (
                        <Button size="sm" variant="ghost" onClick={() => salva(m.id, { automatico: true })}>Torna automatico</Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => salva(m.id, { escluso: true })}>Non è una caparra</Button>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </SezioneApribile>
    </div>
  )
}
