import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client.js'
import { mostraErrore } from '../../utils/format.js'
import {
  Button, Card, Loading, Messaggio, PageHeader, Select, Table, Td, Th, useAvvisi,
} from '../../components/ui'
import { colors } from '../../styles/tokens.js'

const PUNTI = [
  { value: 'colazione', label: 'Colazione' },
  { value: 'ristorante', label: 'Ristorante' },
  { value: 'bar', label: 'Bar' },
]
const NOME_STRUTTURA = { DPH: 'Du Parc + Mare Mosso', CLB: 'Club Hotel', INT: 'International', BON: 'Buona Onda' }

/** Parametri della scheda USALI → Food & Beverage (services/usali_fnb.py): reparto dei
 * cedolini → punto vendita. */
export default function AdminUsaliFnb() {
  const [dati, setDati] = useState(null)
  const [mappa, setMappa] = useState({})
  const [errore, setErrore] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const avvisi = useAvvisi()

  const applica = (d) => {
    setDati(d)
    setMappa(Object.fromEntries(d.centri.map(c => [c.code, c.punto])))
  }

  const carica = useCallback(async () => {
    try {
      const { data } = await api.get('/usali/fnb/parametri')
      applica(data)
    } catch (e) {
      setErrore(mostraErrore(e))
    }
  }, [])

  useEffect(() => { carica() }, [carica])

  async function salva() {
    // Si salvano solo gli abbinamenti diversi dal default (così un reparto nuovo eredita il default)
    const cc_punto = Object.fromEntries(
      dati.centri.filter(c => mappa[c.code] !== c.punto_default).map(c => [c.code, mappa[c.code]]),
    )
    setSalvando(true)
    try {
      const { data } = await api.put('/usali/fnb/parametri', { cc_punto })
      applica(data)
      avvisi.successo('Parametri salvati')
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setSalvando(false)
    }
  }

  if (errore) return <Messaggio>{errore}</Messaggio>
  if (!dati) return <Loading />

  const modificato = dati.centri.some(c => mappa[c.code] !== c.punto)
  const centriHotel = dati.centri.filter(c => c.struttura !== 'BON')

  return (
    <div>
      <PageHeader title="USALI — Food & Beverage">
        <Button onClick={salva} disabled={salvando || !modificato}>{salvando ? 'Salvataggio…' : 'Salva'}</Button>
      </PageHeader>

      <Card title="Reparti dei cedolini → punto vendita">
        <p style={{ fontSize: 13, color: colors.textSecond, maxWidth: 760, marginTop: 0 }}>
          Il costo del personale F&B viene dai cedolini, ripartiti per centro di costo. Qui si sceglie a
          quale punto vendita va ogni reparto. Buona Onda è un punto vendita unico e non compare.
        </p>
        <Table compact>
          <thead>
            <tr><Th>Struttura</Th><Th>Reparto</Th><Th>Codice</Th><Th>Punto vendita</Th></tr>
          </thead>
          <tbody>
            {centriHotel.map(c => (
              <tr key={c.code} className={mappa[c.code] !== c.punto ? 'ui-riga-modificata' : undefined}>
                <Td>{NOME_STRUTTURA[c.struttura] || c.struttura}</Td>
                <Td>{c.gruppo && c.gruppo !== NOME_STRUTTURA[c.struttura] ? `${c.gruppo} — ` : ''}{c.name}</Td>
                <Td muted>{c.code}</Td>
                <Td>
                  <Select value={mappa[c.code]} onChange={e => setMappa(m => ({ ...m, [c.code]: e.target.value }))}>
                    {PUNTI.map(p => (
                      <option key={p.value} value={p.value}>{p.label}{p.value === c.punto_default ? ' (default)' : ''}</option>
                    ))}
                  </Select>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
