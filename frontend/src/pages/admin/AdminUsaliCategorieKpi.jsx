// Admin → USALI → Categorie KPI (Conto Economico contabile): conto del gestionale → categoria
// KPI (personale, food, beverage, commissioni, utenze, altro). In cima i conti di costo già
// importati senza categoria (i conti nuovi che arrivano dal gestionale finiscono lì).
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../api/client.js'
import { mostraErrore } from '../../utils/format.js'
import {
  Badge, Button, Card, Checkbox, Field, Input, Loading, Select, StatoVuoto, Table, Td, Th,
  useAvvisi, useConferma,
} from '../../components/ui'
import { ETICHETTE_CATEGORIA, Euro } from '../usaliContabile/helpers.jsx'

function SelectCategoria({ categorie, value, onChange }) {
  return (
    <Select value={value} onChange={e => onChange(e.target.value)}>
      <option value="">— scegli —</option>
      {categorie.map(c => <option key={c} value={c}>{ETICHETTE_CATEGORIA[c] || c}</option>)}
    </Select>
  )
}

export default function AdminUsaliCategorieKpi() {
  const [categorie, setCategorie] = useState([])
  const [mappature, setMappature] = useState([])
  const [daClassificare, setDaClassificare] = useState(null)
  const [scelte, setScelte] = useState({})   // chiave conto|reparto → {categoria, soloReparto}
  const [nuovo, setNuovo] = useState({ conto_nome: '', reparto: '', categoria: '' })
  const [filtro, setFiltro] = useState('')
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    try {
      const [m, n] = await Promise.all([
        api.get('/usali/contabile/categorie-kpi'),
        api.get('/usali/contabile/categorie-kpi/non-categorizzati'),
      ])
      setCategorie(m.data.categorie)
      setMappature(m.data.mappature)
      setDaClassificare(n.data)
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    }
  }, [avvisi])

  useEffect(() => { carica() }, [carica])

  const chiave = r => `${r.conto_nome}|${r.reparto || ''}`

  async function classifica(r) {
    const s = scelte[chiave(r)] || {}
    if (!s.categoria) return
    try {
      await api.post('/usali/contabile/categorie-kpi', {
        conto_nome: r.conto_nome, reparto: s.soloReparto ? (r.reparto || '') : '', categoria: s.categoria,
      })
      avvisi.successo(`«${r.conto_nome}» → ${ETICHETTE_CATEGORIA[s.categoria]}`)
      setScelte(prev => { const n = { ...prev }; delete n[chiave(r)]; return n })
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function aggiungi() {
    try {
      await api.post('/usali/contabile/categorie-kpi', nuovo)
      avvisi.successo('Mappatura aggiunta')
      setNuovo({ conto_nome: '', reparto: '', categoria: '' })
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function cambiaCategoria(m, categoria) {
    try {
      await api.put(`/usali/contabile/categorie-kpi/${m.id}`, { categoria })
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function elimina(m) {
    if (!(await conferma({
      titolo: `Rimuovere la mappatura di «${m.conto_nome}»?`,
      messaggio: 'Il conto tornerà tra quelli da classificare e uscirà dai KPI della sua categoria.',
      pericolo: true,
    }))) return
    try {
      await api.delete(`/usali/contabile/categorie-kpi/${m.id}`)
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  const mappatureFiltrate = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    return f ? mappature.filter(m => `${m.conto_nome} ${m.reparto} ${m.categoria}`.toLowerCase().includes(f)) : mappature
  }, [mappature, filtro])

  if (daClassificare === null) return <Loading />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title={`Conti da classificare (${daClassificare.length})`}>
        <p className="ui-text-muted" style={{ marginBottom: 8 }}>
          Conti di costo importati dal gestionale senza categoria KPI. «Altro» li toglie dall'elenco senza
          farli entrare in nessun KPI. «Solo questo reparto» crea una regola valida solo per quel reparto
          (vince su quella generica).
        </p>
        {daClassificare.length === 0 ? <StatoVuoto>Tutti i conti importati sono classificati.</StatoVuoto> : (
          <Table compact maxHeight="50vh">
            <thead>
              <tr>
                <Th>Conto</Th><Th>Reparto</Th><Th>Sezione</Th><Th num>Totale importato</Th>
                <Th>Categoria</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {daClassificare.map(r => {
                const s = scelte[chiave(r)] || {}
                const set = (patch) => setScelte(prev => ({ ...prev, [chiave(r)]: { ...s, ...patch } }))
                return (
                  <tr key={chiave(r) + r.sezione}>
                    <Td>{r.conto_nome}</Td>
                    <Td>{r.reparto || '—'}</Td>
                    <Td muted>{r.sezione || '—'}</Td>
                    <Td num><Euro v={r.totale} /></Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <SelectCategoria categorie={categorie} value={s.categoria || ''} onChange={v => set({ categoria: v })} />
                        {r.reparto && (
                          <Checkbox label="Solo questo reparto" checked={!!s.soloReparto}
                            onChange={v => set({ soloReparto: v })} />
                        )}
                      </div>
                    </Td>
                    <Td><Button size="sm" disabled={!s.categoria} onClick={() => classifica(r)}>Salva</Button></Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title={`Mappature (${mappature.length})`}
        actions={<Input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Cerca…" style={{ width: 200 }} />}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
          <Field label="Nome conto (come nel gestionale)">
            <Input value={nuovo.conto_nome} onChange={e => setNuovo({ ...nuovo, conto_nome: e.target.value })} />
          </Field>
          <Field label="Reparto (vuoto = tutti)">
            <Input value={nuovo.reparto} onChange={e => setNuovo({ ...nuovo, reparto: e.target.value })} />
          </Field>
          <Field label="Categoria">
            <SelectCategoria categorie={categorie} value={nuovo.categoria} onChange={v => setNuovo({ ...nuovo, categoria: v })} />
          </Field>
          <Button onClick={aggiungi} disabled={!nuovo.conto_nome.trim() || !nuovo.categoria}>Aggiungi</Button>
        </div>
        <Table compact maxHeight="60vh">
          <thead>
            <tr><Th>Conto</Th><Th>Reparto</Th><Th>Categoria</Th><Th></Th></tr>
          </thead>
          <tbody>
            {mappatureFiltrate.map(m => (
              <tr key={m.id}>
                <Td>{m.conto_nome}</Td>
                <Td>{m.reparto ? m.reparto : <Badge tono="neutral">tutti</Badge>}</Td>
                <Td><SelectCategoria categorie={categorie} value={m.categoria} onChange={v => v && cambiaCategoria(m, v)} /></Td>
                <Td><Button size="sm" variant="danger-soft" onClick={() => elimina(m)}>Rimuovi</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
