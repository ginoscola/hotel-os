// Dettaglio della materia prima: conti food/beverage della contabilità per punto vendita, e conti
// F&B senza categoria KPI (finiscono in "Altri costi": classificarli in Admin sposta la cifra).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api/client.js'
import { formatEuroIntero, mostraErrore } from '../../utils/format.js'
import { Badge, Card, Input, Loading, Messaggio, Table, Td, Th } from '../../components/ui'
import { colors } from '../../styles/tokens.js'

const ETICHETTA = { food: 'Food', beverage: 'Beverage' }

export default function MateriaPrimaFnb({ struttura, anno, meseDa, meseA }) {
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const [cerca, setCerca] = useState('')

  useEffect(() => {
    let annullato = false
    setErrore(null)
    api.get('/usali/fnb/materia-prima', { params: { struttura, anno, mese_da: meseDa, mese_a: meseA } })
      .then(r => { if (!annullato) setDati(r.data) })
      .catch(e => { if (!annullato) { setDati(null); setErrore(mostraErrore(e)) } })
    return () => { annullato = true }
  }, [struttura, anno, meseDa, meseA])

  const filtra = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    return (righe) => (q ? righe.filter(r => `${r.conto} ${r.punto_label} ${r.struttura}`.toLowerCase().includes(q)) : righe)
  }, [cerca])

  if (errore) return <Messaggio>{errore}</Messaggio>
  if (!dati) return <Loading />

  const gruppo = struttura === 'GRUPPO'
  const conti = filtra(dati.conti)
  const nonCat = filtra(dati.non_categorizzati)
  const totale = conti.reduce((s, r) => s + r.totale, 0)

  const tabella = (righe, conCategoria) => (
    <Table compact maxHeight="60vh">
      <thead>
        <tr>
          {gruppo && <Th>Struttura</Th>}
          <Th>Punto vendita</Th>
          <Th>Conto</Th>
          {conCategoria && <Th>Categoria</Th>}
          <Th num>Totale</Th>
        </tr>
      </thead>
      <tbody>
        {righe.map((r, i) => (
          <tr key={i}>
            {gruppo && <Td>{r.struttura}</Td>}
            <Td>{r.punto_label}</Td>
            <Td>{r.conto}</Td>
            {conCategoria && <Td><Badge tono={r.categoria === 'food' ? 'ok' : 'info'}>{ETICHETTA[r.categoria]}</Badge></Td>}
            <Td num>{formatEuroIntero(r.totale)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Input placeholder="Cerca conto o punto vendita…" value={cerca} onChange={e => setCerca(e.target.value)}
        style={{ maxWidth: 320 }} />

      {dati.non_categorizzati.length > 0 && (
        <Card title={`Conti F&B senza categoria — ${formatEuroIntero(dati.totale_non_categorizzati)}`}>
          <Messaggio tipo="warn">
            Questi conti finiscono in "Altri costi", non nella materia prima: se sono alimenti o bevande
            il food cost risulta più basso del vero. Classificarli in{' '}
            <Link to="/admin?s=usali-categorie-kpi">Admin → Categorie KPI</Link> (anche "altro" per quelli
            che non sono materia prima).
          </Messaggio>
          {tabella(nonCat, false)}
        </Card>
      )}

      <Card title={`Materia prima — ${formatEuroIntero(totale)}`}>
        {conti.length ? tabella(conti, true) : (
          <div style={{ color: colors.textMuted }}>Nessun costo di materia prima nel periodo.</div>
        )}
      </Card>
    </div>
  )
}
