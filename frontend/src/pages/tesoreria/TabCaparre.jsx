// Caparre per mese di arrivo (Fase 4a): incassi arrivati in banca prima del soggiorno, letti dalla causale dei
// bonifici da clienti. Confronto con l'anno prima alla stessa data e coda dei bonifici senza periodo di soggiorno.
import { Fragment, useEffect, useState } from 'react'
import api from '../../api/client.js'
import { colors } from '../../styles/tokens.js'
import { formatData, formatDataIt, formatEuro, mostraErrore } from '../../utils/format.js'
import {
  Button, Card, HotelTag, Input, Loading, Messaggio, NavAnno, Select, StatoVuoto, Table, Td, Th, useAvvisi,
} from '../../components/ui'
import { Importo, STRUTTURE, annoDi, causaleDi, etichettaAnno } from './helpers.jsx'

const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre',
  'ottobre', 'novembre', 'dicembre']

function RigaCoda({ m, anno, puoModificare, onSalvato }) {
  const [arrivo, setArrivo] = useState('')
  const [struttura, setStruttura] = useState('')
  const avvisi = useAvvisi()
  async function salva(corpo) {
    try { await api.put(`/tesoreria/caparre/${m.id}`, corpo); onSalvato() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  return (
    <tr>
      <Td>{formatData(m.data_contabile)}</Td>
      <Td num><Importo v={m.importo} /></Td>
      <Td>{m.controparte || '—'}</Td>
      <Td style={{ maxWidth: 380 }}>{causaleDi(m)}</Td>
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
          <Button size="sm" disabled={!arrivo} onClick={() => salva({ arrivo, struttura: struttura || null })}>Salva</Button>{' '}
          <Button size="sm" variant="ghost" onClick={() => salva({ escluso: true })}>Non è una caparra</Button>
        </Td>
      </>}
    </tr>
  )
}

export default function TabCaparre({ permessi }) {
  const corrente = annoDi(new Date(), 'alberghiero')
  const [anno, setAnno] = useState(corrente)
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const [versione, setVersione] = useState(0)

  useEffect(() => {
    let annullato = false
    setErrore(null)
    api.get('/tesoreria/caparre', { params: { anno } })
      .then(r => { if (!annullato) setDati(r.data) })
      .catch(e => { if (!annullato) setErrore(mostraErrore(e)) })
    return () => { annullato = true }
  }, [anno, versione])

  if (errore) return <Messaggio>{errore}</Messaggio>
  if (!dati) return <Loading />

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
            {riga('TOTALE', dati.totali, 'ui-riga-totale')}
          </tbody>
        </Table>
        <p className="ui-text-muted" style={{ marginTop: 8 }}>
          Caparre = bonifici da clienti arrivati prima del giorno di arrivo (caparre, acconti e saldi anticipati),
          per mese di arrivo letto dalla causale. Bonifici della stagione: {b.n}, letti {b.n_letti},
          esclusi {b.n_esclusi}, senza periodo {b.n_coda}. Le caparre pagate con carta o POS non hanno causale e
          non compaiono. In Previsione la differenza con l'anno prima (× il fattore del Budget) sposta gli incassi
          sul mese di arrivo: il totale della stagione resta quello del Budget.
        </p>
      </Card>

      <Card title={`Bonifici senza periodo di soggiorno (${dati.coda.length})`}>
        {anno !== corrente && (
          <Messaggio tipo="info">
            Stagione passata: i bonifici senza periodo restano fuori dal confronto e non serve completarli.
          </Messaggio>
        )}
        {dati.coda.length === 0 ? <StatoVuoto>Nessun bonifico da completare.</StatoVuoto> : (
          <Table compact maxHeight="60vh">
            <thead>
              <tr>
                <Th>Data</Th><Th num>Importo</Th><Th>Ordinante</Th><Th>Causale</Th>
                {puoModificare && <><Th>Arrivo</Th><Th>Struttura</Th><Th /></>}
              </tr>
            </thead>
            <tbody>
              {dati.coda.map(m => (
                <RigaCoda key={m.id} m={m} anno={anno} puoModificare={puoModificare}
                  onSalvato={() => setVersione(v => v + 1)} />
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

