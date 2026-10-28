// Admin → Tesoreria: conti (fido e scadenza), categorie (colore, operative o no), regole di
// classificazione (con prova e ricalcolo), soglie degli avvisi di freschezza.
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../api/client.js'
import { mostraErrore } from '../../utils/format.js'
import {
  Badge, Button, Card, Checkbox, Field, Input, Loading, Select, StatoVuoto, Table, Td, Th, useAvvisi, useConferma,
} from '../../components/ui'
import { ETICHETTE_SEGNO, ETICHETTE_TIPO_CONTO, ModaleRegola } from '../tesoreria/helpers.jsx'

const TIPI_CATEGORIA = { entrata: 'Entrata', uscita: 'Uscita', neutra: 'Neutra' }

function SceltaColore({ value, onChange }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <input type="color" value={value || '#94a3b8'} onChange={e => onChange(e.target.value)}
        style={{ width: 28, height: 24, padding: 0, border: 'none', background: 'none' }} />
      <Input value={value || ''} placeholder="#rrggbb" style={{ width: 86 }} onChange={e => onChange(e.target.value)} />
    </span>
  )
}

/** Righe modificabili con bozza locale: Salva per riga, riga in ambra finché non è salvata. */
function useBozze() {
  const [bozze, setBozze] = useState({})
  const modifica = (id, patch) => setBozze(b => ({ ...b, [id]: { ...(b[id] || {}), ...patch } }))
  const scarta = id => setBozze(b => { const n = { ...b }; delete n[id]; return n })
  return { bozze, modifica, scarta }
}

// ── Conti ───────────────────────────────────────────────────────────────────────

export function AdminTesoreriaConti() {
  const [conti, setConti] = useState(null)
  const [nuovo, setNuovo] = useState({ codice: '', nome: '', tipo: 'carta_credito' })
  const { bozze, modifica, scarta } = useBozze()
  const avvisi = useAvvisi()

  const carica = useCallback(async () => {
    try { setConti((await api.get('/tesoreria/conti')).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [avvisi])
  useEffect(() => { carica() }, [carica])

  async function salva(c) {
    try {
      const b = { ...bozze[c.id] }
      if ('fido' in b) b.fido = String(b.fido).replace(',', '.') || 0
      await api.put(`/tesoreria/conti/${c.id}`, b)
      scarta(c.id); avvisi.successo(`${c.nome}: salvato`); carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function aggiungi() {
    try {
      await api.post('/tesoreria/conti', nuovo)
      setNuovo({ codice: '', nome: '', tipo: 'carta_credito' }); carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  if (!conti) return <Loading />
  return (
    <Card title="Conti">
      <p className="ui-text-muted" style={{ marginBottom: 8 }}>
        I conti con «Import» ricevono gli estratti conto XML (riconosciuti dall'IBAN); gli altri hanno solo
        saldi inseriti a mano. Il fido conta nella disponibilità fino al giorno di scadenza compreso
        (scadenza vuota = sempre); dopo, avviso rosso finché non lo si aggiorna. Carte di credito: «Testo
        addebito in banca» è come compare il pagamento dell'estratto nel conto (es. AMERICAN EXPRESS):
        serve a riconoscerlo e azzerare la carta.
      </p>
      <Table compact>
        <thead>
          <tr>
            <Th>Codice</Th><Th>Nome</Th><Th>Tipo</Th><Th>Banca</Th><Th>IBAN</Th><Th num>Fido (€)</Th>
            <Th>Scadenza fido</Th><Th>Testo addebito in banca</Th><Th center>Import</Th><Th>Colore</Th><Th num>Ordine</Th><Th center>Attivo</Th><Th></Th>
          </tr>
        </thead>
        <tbody>
          {conti.map(c => {
            const v = { ...c, ...(bozze[c.id] || {}) }
            const set = patch => modifica(c.id, patch)
            return (
              <tr key={c.id} className={bozze[c.id] ? 'ui-riga-modificata' : undefined}>
                <Td><Input value={v.codice} style={{ width: 90 }} onChange={e => set({ codice: e.target.value })} /></Td>
                <Td><Input value={v.nome} style={{ width: 160 }} onChange={e => set({ nome: e.target.value })} /></Td>
                <Td>
                  <Select value={v.tipo} onChange={e => set({ tipo: e.target.value })}>
                    {Object.entries(ETICHETTE_TIPO_CONTO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                </Td>
                <Td><Input value={v.banca || ''} style={{ width: 110 }} onChange={e => set({ banca: e.target.value })} /></Td>
                <Td><Input value={v.iban || ''} style={{ width: 230 }} onChange={e => set({ iban: e.target.value })} /></Td>
                <Td num><Input value={v.fido ?? 0} inputMode="decimal" style={{ width: 100 }} onChange={e => set({ fido: e.target.value })} /></Td>
                <Td><Input type="date" value={v.fido_scadenza || ''} onChange={e => set({ fido_scadenza: e.target.value || null })} /></Td>
                <Td>
                  {v.tipo === 'carta_credito'
                    ? <Input value={v.testo_addebito || ''} style={{ width: 200 }} onChange={e => set({ testo_addebito: e.target.value })} />
                    : <span className="ui-text-muted">—</span>}
                </Td>
                <Td center><Checkbox checked={v.ha_import} onChange={x => set({ ha_import: x })} /></Td>
                <Td><SceltaColore value={v.colore} onChange={x => set({ colore: x })} /></Td>
                <Td num><Input type="number" value={v.ordine} style={{ width: 60 }} onChange={e => set({ ordine: e.target.value })} /></Td>
                <Td center><Checkbox checked={v.attivo} onChange={x => set({ attivo: x })} /></Td>
                <Td style={{ whiteSpace: 'nowrap' }}>
                  {bozze[c.id] && <>
                    <Button size="sm" onClick={() => salva(c)}>Salva</Button>{' '}
                    <Button size="sm" variant="ghost" onClick={() => scarta(c.id)}>Annulla</Button>
                  </>}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
        <Field label="Codice"><Input value={nuovo.codice} style={{ width: 100 }} onChange={e => setNuovo({ ...nuovo, codice: e.target.value })} /></Field>
        <Field label="Nome"><Input value={nuovo.nome} onChange={e => setNuovo({ ...nuovo, nome: e.target.value })} /></Field>
        <Field label="Tipo">
          <Select value={nuovo.tipo} onChange={e => setNuovo({ ...nuovo, tipo: e.target.value })}>
            {Object.entries(ETICHETTE_TIPO_CONTO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Button onClick={aggiungi} disabled={!nuovo.codice.trim() || !nuovo.nome.trim()}>Aggiungi conto</Button>
      </div>
    </Card>
  )
}

// ── Categorie ───────────────────────────────────────────────────────────────────

export function AdminTesoreriaCategorie() {
  const [categorie, setCategorie] = useState(null)
  const [nuova, setNuova] = useState({ codice: '', nome: '', tipo: 'uscita' })
  const { bozze, modifica, scarta } = useBozze()
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    try { setCategorie((await api.get('/tesoreria/categorie')).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [avvisi])
  useEffect(() => { carica() }, [carica])

  async function salva(c) {
    try {
      await api.put(`/tesoreria/categorie/${c.id}`, bozze[c.id])
      scarta(c.id); carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function aggiungi() {
    try {
      await api.post('/tesoreria/categorie', nuova)
      setNuova({ codice: '', nome: '', tipo: 'uscita' }); carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function elimina(c) {
    if (!(await conferma({ titolo: `Eliminare la categoria «${c.nome}»?`, pericolo: true }))) return
    try { await api.delete(`/tesoreria/categorie/${c.id}`); carica() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  if (!categorie) return <Loading />
  return (
    <Card title="Categorie">
      <p className="ui-text-muted" style={{ marginBottom: 8 }}>
        «Non operativa» = fuori da entrate/uscite/netto operativo del consuntivo (es. erogazione mutuo,
        giroconti), mostrata a parte. Una categoria usata da movimenti o regole non si elimina: disattivarla
        (le sue regole smettono di valere al prossimo ricalcolo).
      </p>
      <Table compact>
        <thead>
          <tr>
            <Th>Colore</Th><Th>Nome</Th><Th>Codice</Th><Th>Tipo</Th><Th center>Non operativa</Th>
            <Th num>Ordine</Th><Th center>Attiva</Th><Th num>Movimenti</Th><Th num>Regole</Th><Th></Th>
          </tr>
        </thead>
        <tbody>
          {categorie.map(c => {
            const v = { ...c, ...(bozze[c.id] || {}) }
            const set = patch => modifica(c.id, patch)
            return (
              <tr key={c.id} className={bozze[c.id] ? 'ui-riga-modificata' : undefined}>
                <Td><SceltaColore value={v.colore} onChange={x => set({ colore: x })} /></Td>
                <Td><Input value={v.nome} style={{ width: 220 }} onChange={e => set({ nome: e.target.value })} /></Td>
                <Td muted>{c.codice}</Td>
                <Td>
                  <Select value={v.tipo} onChange={e => set({ tipo: e.target.value })}>
                    {Object.entries(TIPI_CATEGORIA).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                </Td>
                <Td center><Checkbox checked={v.escludi_da_operativo} onChange={x => set({ escludi_da_operativo: x })} /></Td>
                <Td num><Input type="number" value={v.ordine} style={{ width: 60 }} onChange={e => set({ ordine: e.target.value })} /></Td>
                <Td center>{c.protetta ? <Badge tono="neutral">sempre</Badge>
                  : <Checkbox checked={v.attivo} onChange={x => set({ attivo: x })} />}</Td>
                <Td num>{c.n_movimenti}</Td>
                <Td num>{c.n_regole}</Td>
                <Td style={{ whiteSpace: 'nowrap' }}>
                  {bozze[c.id] ? <>
                    <Button size="sm" onClick={() => salva(c)}>Salva</Button>{' '}
                    <Button size="sm" variant="ghost" onClick={() => scarta(c.id)}>Annulla</Button>
                  </> : (!c.protetta && !c.n_movimenti && !c.n_regole &&
                    <Button size="sm" variant="danger-soft" onClick={() => elimina(c)}>Elimina</Button>)}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
        <Field label="Nome"><Input value={nuova.nome} onChange={e => setNuova({ ...nuova, nome: e.target.value })} /></Field>
        <Field label="Codice (minuscole, _)"><Input value={nuova.codice} style={{ width: 160 }} onChange={e => setNuova({ ...nuova, codice: e.target.value })} /></Field>
        <Field label="Tipo">
          <Select value={nuova.tipo} onChange={e => setNuova({ ...nuova, tipo: e.target.value })}>
            {Object.entries(TIPI_CATEGORIA).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Button onClick={aggiungi} disabled={!nuova.codice.trim() || !nuova.nome.trim()}>Aggiungi categoria</Button>
      </div>
    </Card>
  )
}

// ── Regole ──────────────────────────────────────────────────────────────────────

export function AdminTesoreriaRegole() {
  const [regole, setRegole] = useState(null)
  const [categorie, setCategorie] = useState([])
  const [aperta, setAperta] = useState(null)   // {} = nuova, regola = modifica
  const [filtro, setFiltro] = useState('')
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([api.get('/tesoreria/regole'), api.get('/tesoreria/categorie')])
      setRegole(r.data); setCategorie(c.data)
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [avvisi])
  useEffect(() => { carica() }, [carica])

  async function attiva(r, valore) {
    try { await api.put(`/tesoreria/regole/${r.id}`, { attiva: valore, ricalcola: true }); carica() }
    catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function elimina(r) {
    if (!(await conferma({ titolo: 'Eliminare questa regola?', messaggio: 'I movimenti verranno riclassificati.', pericolo: true }))) return
    try {
      const res = await api.delete(`/tesoreria/regole/${r.id}`, { params: { ricalcola: true } })
      avvisi.successo(`Regola eliminata: ${res.data.ricalcolo?.n_cambiati ?? 0} movimenti riclassificati`); carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function ricalcolaTutto() {
    try {
      const r = await api.post('/tesoreria/ricalcola')
      avvisi.successo(`Ricalcolo fatto: ${r.data.n_cambiati} movimenti cambiati su ${r.data.n_controllati}`)
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  const filtrate = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    if (!regole) return []
    return f ? regole.filter(r => `${r.categoria_nome} ${r.valori.join(' ')} ${(r.valori_anche || []).join(' ')} ${r.note || ''}`
      .toLowerCase().includes(f)) : regole
  }, [regole, filtro])

  if (!regole) return <Loading />
  return (
    <Card title={`Regole di classificazione (${regole.length})`}
      actions={<div style={{ display: 'flex', gap: 8 }}>
        <Input value={filtro} placeholder="Cerca…" style={{ width: 180 }} onChange={e => setFiltro(e.target.value)} />
        <Button variant="secondary" onClick={ricalcolaTutto}>Ricalcola tutti i movimenti</Button>
        <Button onClick={() => setAperta({})}>Nuova regola</Button>
      </div>}>
      <p className="ui-text-muted" style={{ marginBottom: 8 }}>
        Vince la prima regola che corrisponde, in ordine di priorità. Senza nessuna regola il movimento va in
        «Da classificare». Le categorie corrette a mano sui movimenti non cambiano mai.
      </p>
      {filtrate.length === 0 ? <StatoVuoto>Nessuna regola.</StatoVuoto> : (
        <Table compact maxHeight="65vh">
          <thead>
            <tr>
              <Th num>Priorità</Th><Th>Categoria</Th><Th>Condizione</Th><Th>Movimenti</Th><Th center>Attiva</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {filtrate.map(r => (
              <tr key={r.id} className={r.attiva ? undefined : 'ui-riga-attenuata'}>
                <Td num>{r.priorita}</Td>
                <Td>{r.categoria_nome}</Td>
                <Td>
                  <span className="ui-text-muted">{r.campo === 'controparte' ? 'Controparte' : 'Descrizione'}{' '}
                    {r.operatore === 'inizia' ? 'inizia con' : 'contiene'}</span>{' '}
                  {r.valori.map(v => <Badge key={v} tono="info" style={{ marginRight: 4 }}>{v}</Badge>)}
                  {r.valori_anche?.length > 0 && <>
                    <span className="ui-text-muted"> e anche </span>
                    {r.valori_anche.map(v => <Badge key={v} tono="neutral" style={{ marginRight: 4 }}>{v}</Badge>)}
                  </>}
                  {r.note && <div className="ui-text-muted">{r.note}</div>}
                </Td>
                <Td muted>{ETICHETTE_SEGNO[r.segno]}</Td>
                <Td center><Checkbox checked={r.attiva} onChange={v => attiva(r, v)} /></Td>
                <Td style={{ whiteSpace: 'nowrap' }}>
                  <Button size="sm" variant="ghost" onClick={() => setAperta(r)}>Modifica</Button>{' '}
                  <Button size="sm" variant="danger-soft" onClick={() => elimina(r)}>Elimina</Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {aperta && (
        <ModaleRegola iniziale={aperta.id ? aperta : null} categorie={categorie} onChiudi={() => setAperta(null)}
          onSalvata={() => { setAperta(null); carica() }} />
      )}
    </Card>
  )
}

// ── Soglie avvisi ───────────────────────────────────────────────────────────────

const SOGLIE = [
  { key: 'giorni_estratto', label: 'Estratto conto caricato da più di (giorni)' },
  { key: 'giorni_saldo_carta', label: 'Saldo di carte e prepagate più vecchio di (giorni)' },
  { key: 'giorni_preavviso_fido', label: 'Preavviso scadenza fido (giorni)' },
]

export function AdminTesoreriaSoglie() {
  const [soglie, setSoglie] = useState(null)
  const [bozza, setBozza] = useState({})
  const avvisi = useAvvisi()

  useEffect(() => {
    api.get('/tesoreria/soglie').then(r => setSoglie(r.data)).catch(e => avvisi.errore(mostraErrore(e)))
  }, [avvisi])

  async function salva() {
    try {
      setSoglie((await api.put('/tesoreria/soglie', bozza)).data)
      setBozza({}); avvisi.successo('Soglie salvate')
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  if (!soglie) return <Loading />
  return (
    <Card title="Soglie degli avvisi (Posizione)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
        {SOGLIE.map(s => (
          <Field key={s.key} label={s.label}>
            <Input type="number" min={1} max={365} value={bozza[s.key] ?? soglie[s.key]}
              modificato={s.key in bozza} style={{ width: 100 }}
              onChange={e => setBozza({ ...bozza, [s.key]: e.target.value })} />
          </Field>
        ))}
        <div><Button onClick={salva} disabled={!Object.keys(bozza).length}>Salva</Button></div>
      </div>
    </Card>
  )
}
