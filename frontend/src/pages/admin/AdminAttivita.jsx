// Admin → Comune → Attività ricorrenti: giorno, mesi attivi e attiva/disattiva di ogni attività dello scadenziario.
// Il catalogo è nel codice (backend services/attivita.py); qui si salvano solo le modifiche, "Ripristina" torna al default.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api/client.js'
import { mostraErrore } from '../../utils/format.js'
import { Badge, Button, Checkbox, Messaggio, PageHeader, Select, Table, Td, Th, useAvvisi } from '../../components/ui'

const GIORNI_SETT = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica']
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const FREQ = { giornaliera: 'Ogni giorno', settimanale: 'Ogni settimana', mensile: 'Ogni mese', annuale: 'Ogni anno' }

function Riga({ a, onSalvato }) {
  const [bozza, setBozza] = useState(null)
  const avvisi = useAvvisi()
  const v = bozza || a
  const cambia = (k, val) => setBozza({ ...v, [k]: val })
  const toggleMese = m => cambia('mesi', v.mesi.includes(m) ? v.mesi.filter(x => x !== m) : [...v.mesi, m].sort((x, y) => x - y))

  async function salva(corpo) {
    try {
      await api.put(`/attivita/parametri/${a.codice}`, corpo)
      setBozza(null)
      onSalvato()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  return (
    <tr className={bozza ? 'ui-riga-modificata' : v.attiva ? undefined : 'ui-riga-attenuata'}>
      <Td>
        <div>{a.titolo}</div>
        <div className="ui-text-muted" style={{ fontSize: 'var(--fs-sm)' }}>
          {a.gruppo}{!a.automatica && ' · da spuntare a mano'}
        </div>
      </Td>
      <Td>{FREQ[a.frequenza]}</Td>
      <Td>
        {a.frequenza === 'settimanale' && (
          <Select value={v.giorno} onChange={e => cambia('giorno', Number(e.target.value))}>
            {GIORNI_SETT.map((g, i) => <option key={g} value={i}>{g}</option>)}
          </Select>
        )}
        {(a.frequenza === 'mensile' || a.frequenza === 'annuale') && (
          <div style={{ display: 'flex', gap: 4 }}>
            <Select value={v.giorno} onChange={e => cambia('giorno', Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(g => (
                <option key={g} value={g}>{g === 31 && a.frequenza === 'mensile' ? 'fine mese' : g}</option>
              ))}
            </Select>
            {a.frequenza === 'annuale' && (
              <Select value={v.mese} onChange={e => cambia('mese', Number(e.target.value))}>
                {MESI.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
            )}
          </div>
        )}
        {a.frequenza === 'giornaliera' && <span className="ui-text-muted">in stagione</span>}
      </Td>
      <Td>
        {a.frequenza === 'annuale' ? <span className="ui-text-muted">—</span> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, maxWidth: 330 }}>
            {MESI.map((m, i) => (
              <Checkbox key={m} label={m} checked={v.mesi.includes(i + 1)} onChange={() => toggleMese(i + 1)} />
            ))}
          </div>
        )}
      </Td>
      <Td><Checkbox checked={v.attiva} onChange={x => cambia('attiva', x)} /></Td>
      <Td style={{ whiteSpace: 'nowrap' }}>
        {bozza && <Button size="sm" onClick={() => salva({ giorno: v.giorno, mese: v.mese, mesi: v.mesi, attiva: v.attiva })}>Salva</Button>}{' '}
        {bozza && <Button size="sm" variant="ghost" onClick={() => setBozza(null)}>Annulla</Button>}
        {!bozza && a.modificata && (
          <><Badge tono="info">modificata</Badge>{' '}
            <Button size="sm" variant="ghost" onClick={() => salva({ ripristina: true })}>Ripristina</Button></>
        )}
      </Td>
    </tr>
  )
}

export default function AdminAttivita() {
  const [catalogo, setCatalogo] = useState(null)
  const [errore, setErrore] = useState(null)

  const carica = useCallback(() => {
    api.get('/attivita/catalogo').then(r => setCatalogo(r.data)).catch(e => setErrore(mostraErrore(e)))
  }, [])
  useEffect(() => { carica() }, [carica])

  return (
    <div>
      <PageHeader title="Attività ricorrenti" subtitle="Quando va fatta ogni attività dello scadenziario">
        <Link to="/attivita" className="ui-btn ui-btn-secondary">Apri lo scadenziario</Link>
      </PageHeader>
      <Messaggio>{errore}</Messaggio>
      <p className="ui-text-muted">
        Settimanali: giorno della scadenza, fatta se c'è un import nella settimana (lunedì–domenica). Mensili: entro il
        giorno indicato, fatta se c'è un import nel mese. Annuali: entro il giorno e mese indicati. I mesi spenti non
        generano scadenze (es. Revenue solo da marzo a settembre).
      </p>
      {catalogo && (
        <Table compact>
          <thead>
            <tr><Th>Attività</Th><Th>Frequenza</Th><Th>Giorno</Th><Th>Mesi attivi</Th><Th>Attiva</Th><Th /></tr>
          </thead>
          <tbody>
            {catalogo.map(a => <Riga key={a.codice} a={a} onSalvato={carica} />)}
          </tbody>
        </Table>
      )}
    </div>
  )
}
