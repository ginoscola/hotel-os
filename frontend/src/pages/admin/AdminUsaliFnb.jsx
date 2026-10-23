import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client.js'
import { mostraErrore } from '../../utils/format.js'
import {
  Button, Card, Field, Input, Loading, Messaggio, PageHeader, Select, Table, Td, Th, useAvvisi,
} from '../../components/ui'
import { colors } from '../../styles/tokens.js'

const PUNTI = [
  { value: 'colazione', label: 'Colazione' },
  { value: 'ristorante', label: 'Ristorante' },
  { value: 'bar', label: 'Bar' },
]
const NOME_STRUTTURA = { DPH: 'Du Parc + Mare Mosso', CLB: 'Club Hotel', INT: 'International', BON: 'Buona Onda' }

/** Parametri della scheda USALI → Food & Beverage (services/usali_fnb.py): peso della cena
 * rispetto al pranzo per stimare i costi, e reparto dei cedolini → punto vendita. */
export default function AdminUsaliFnb() {
  const [dati, setDati] = useState(null)
  const [peso, setPeso] = useState('')
  const [mappa, setMappa] = useState({})
  const [errore, setErrore] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const avvisi = useAvvisi()

  const applica = (d) => {
    setDati(d)
    setPeso(String(d.peso_cena).replace('.', ','))
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
    const valorePeso = Number(peso.replace(',', '.'))
    if (!(valorePeso >= 0.1 && valorePeso <= 10)) {
      avvisi.attenzione('Il peso della cena deve essere un numero tra 0,1 e 10')
      return
    }
    // Si salvano solo gli abbinamenti diversi dal default (così un reparto nuovo eredita il default)
    const cc_punto = Object.fromEntries(
      dati.centri.filter(c => mappa[c.code] !== c.punto_default).map(c => [c.code, mappa[c.code]]),
    )
    setSalvando(true)
    try {
      const { data } = await api.put('/usali/fnb/parametri', { peso_cena: valorePeso, cc_punto })
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

  const modificato = String(dati.peso_cena).replace('.', ',') !== peso
    || dati.centri.some(c => mappa[c.code] !== c.punto)
  const centriHotel = dati.centri.filter(c => c.struttura !== 'BON')

  return (
    <div>
      <PageHeader title="USALI — Food & Beverage">
        <Button onClick={salva} disabled={salvando || !modificato}>{salvando ? 'Salvataggio…' : 'Salva'}</Button>
      </PageHeader>

      <Card title="Peso della cena rispetto al pranzo">
        <p style={{ fontSize: 13, color: colors.textSecond, maxWidth: 760, marginTop: 0 }}>
          La contabilità ha un unico "Ristorante": per stimare i costi di pranzo e cena (e di ospiti /
          clienti esterni del Mare Mosso) il totale viene ripartito sui coperti, contando ogni cena come
          questo numero di pranzi. Con 1 il costo per coperto è uguale per pranzo e cena; con un valore
          più alto la cena assorbe più costi. Ricavi e coperti di pranzo e cena restano quelli veri.
        </p>
        <Field label={`Una cena vale (pranzi) — default ${String(dati.peso_cena_default).replace('.', ',')}`}>
          <Input value={peso} onChange={e => setPeso(e.target.value)} inputMode="decimal" style={{ width: 90 }} />
        </Field>
      </Card>

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
