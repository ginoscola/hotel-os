// Admin → Tesoreria: conti (fido e scadenza), categorie (colore, operative o no), regole di
// classificazione (con prova e ricalcolo), soglie degli avvisi di freschezza, piano affitti, interventi, advertising e fornitori
// pagati con carta, ricorrenti, mutuo, dati fiscali,
// parametri della previsione.
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../api/client.js'
import { formatEuro, formatData, mostraErrore } from '../../utils/format.js'
import {
  Badge, Button, Card, Checkbox, Field, FileButton, Input, Loading, Modal, Select, StatoVuoto, Table, Td, Th, useAvvisi, useConferma,
} from '../../components/ui'
import { ETICHETTE_SEGNO, ETICHETTE_TIPO_CONTO, ModaleRegola } from '../tesoreria/helpers.jsx'

const oggi = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
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
            <Th>Scadenza fido</Th><Th>Testo addebito in banca</Th><Th num>Giorno addebito</Th><Th center>Import</Th><Th>Colore</Th><Th num>Ordine</Th><Th center>Attivo</Th><Th></Th>
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
                <Td num>
                  {v.tipo === 'carta_credito'
                    ? <Input type="number" min={1} max={31} value={v.giorno_addebito ?? ''} style={{ width: 60 }} onChange={e => set({ giorno_addebito: e.target.value })} />
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

// ── Piano affitti ───────────────────────────────────────────────────────────────

const ETICHETTE_STATO_RATA = { stimato: 'Prevista', confermato: 'Prevista', pagato: 'Pagata' }

function ContrattoAffitto({ contratto, onAggiorna }) {
  const annoIniziale = contratto.anni.at(-1)?.anno ?? new Date().getFullYear()
  const [nuova, setNuova] = useState({ anno_competenza: annoIniziale, data_prevista: '', percentuale: '' })
  const [canone, setCanone] = useState(null)
  const { bozze, modifica, scarta } = useBozze()
  const avvisi = useAvvisi()
  const conferma = useConferma()

  async function salvaRata(r) {
    try {
      const b = { ...bozze[r.id] }
      if ('percentuale' in b) b.percentuale = String(b.percentuale)
      onAggiorna((await api.put(`/tesoreria/piani/affitti/rate/${r.id}`, b)).data)
      scarta(r.id)
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function aggiungi() {
    try {
      onAggiorna((await api.post(`/tesoreria/piani/affitti/${contratto.id}/rate`, { ...nuova, percentuale: String(nuova.percentuale) })).data)
      setNuova({ ...nuova, data_prevista: '', percentuale: '' })
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function elimina(r) {
    const ok = await conferma({
      titolo: 'Eliminare la rata?', messaggio: `Rata del ${formatData(r.data_prevista)} da ${formatEuro(r.importo)}`, pericolo: true,
    })
    if (!ok) return
    try { onAggiorna((await api.delete(`/tesoreria/piani/affitti/rate/${r.id}`)).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function salvaCanone() {
    try {
      onAggiorna((await api.put(`/tesoreria/piani/affitti/${contratto.id}`, { canone_annuo: String(canone) })).data)
      setCanone(null); avvisi.successo('Canone salvato')
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  return (
    <Card title={`${contratto.codice} — ${contratto.controparte}`}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <Field label="Canone annuo, IVA inclusa (€)">
          <Input value={canone ?? contratto.canone_annuo} inputMode="decimal" modificato={canone !== null} style={{ width: 130 }}
            onChange={e => setCanone(e.target.value)} />
        </Field>
        {canone !== null && <Button size="sm" onClick={salvaCanone}>Salva</Button>}
        <span className="ui-text-muted">Nomi in banca: {(contratto.nomi_banca || []).join(' · ')}</span>
      </div>
      {contratto.rate.length === 0 ? <StatoVuoto>Nessuna rata pianificata</StatoVuoto> : (
        <Table compact>
          <thead>
            <tr><Th>Canone</Th><Th>Data</Th><Th num>%</Th><Th num>Importo</Th><Th>Stato</Th><Th></Th></tr>
          </thead>
          <tbody>
            {contratto.rate.map(r => {
              const v = { ...r, ...(bozze[r.id] || {}) }
              const pagata = r.stato === 'pagato'
              return (
                <tr key={r.id} className={bozze[r.id] ? 'ui-riga-modificata' : undefined}>
                  <Td>{r.anno_competenza}</Td>
                  <Td><Input type="date" value={v.data_prevista} disabled={pagata} onChange={e => modifica(r.id, { data_prevista: e.target.value })} /></Td>
                  <Td num>
                    <Input value={r.automatica ? r.percentuale : v.percentuale} inputMode="decimal" disabled={pagata || r.automatica} title={r.automatica ? 'Automatica: chiude il 100% del canone' : undefined}
                      style={{ width: 100 }} onChange={e => modifica(r.id, { percentuale: e.target.value })} />
                    {r.automatica && <div className="ui-text-muted">automatica</div>}
                  </Td>
                  <Td num>{formatEuro(r.importo)}</Td>
                  <Td><Badge tono={pagata ? 'ok' : 'neutral'}>{ETICHETTE_STATO_RATA[r.stato] || r.stato}{r.abbinamento === 'proposto' ? ' · da confermare' : ''}</Badge></Td>
                  <Td style={{ whiteSpace: 'nowrap' }}>
                    {bozze[r.id] ? <>
                      <Button size="sm" onClick={() => salvaRata(r)}>Salva</Button>{' '}
                      <Button size="sm" variant="ghost" onClick={() => scarta(r.id)}>Annulla</Button>
                    </> : !pagata && <Button size="sm" variant="danger-soft" onClick={() => elimina(r)}>Elimina</Button>}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
      {contratto.anni.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {contratto.anni.map(a => (
            <div key={a.anno} className="ui-text-muted">
              Canone {a.anno}: pagato {formatEuro(a.pagato)}, residuo {formatEuro(a.residuo)}
              {a.da_pianificare > 0.01 ? ` — da pianificare ${formatEuro(a.da_pianificare)} (${(100 - a.percentuale_pianificata).toFixed(2)}%)` : ''}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
        <Field label="Canone dell'anno">
          <Input type="number" value={nuova.anno_competenza} style={{ width: 80 }} onChange={e => setNuova({ ...nuova, anno_competenza: Number(e.target.value) })} />
        </Field>
        <Field label="Data"><Input type="date" value={nuova.data_prevista} onChange={e => setNuova({ ...nuova, data_prevista: e.target.value })} /></Field>
        <Field label="% del canone"><Input value={nuova.percentuale} inputMode="decimal" style={{ width: 100 }} onChange={e => setNuova({ ...nuova, percentuale: e.target.value })} /></Field>
        <Button onClick={aggiungi} disabled={!nuova.data_prevista || !nuova.percentuale}>Aggiungi rata</Button>
      </div>
    </Card>
  )
}

export function AdminTesoreriaAffitti() {
  const [contratti, setContratti] = useState(null)
  const avvisi = useAvvisi()

  useEffect(() => {
    api.get('/tesoreria/piani/affitti').then(r => setContratti(r.data)).catch(e => avvisi.errore(mostraErrore(e)))
  }, [avvisi])

  if (!contratti) return <Loading />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p className="ui-text-muted">
        Ogni rata ha una data e una percentuale del canone dell'anno: modificandole cambia subito la previsione.
        Con almeno due rate nello stesso anno, l'ultima in ordine di data è automatica e chiude il 100%. Con una rata sola
        la differenza è «da pianificare» e non entra in previsione. Una rata pagata in banca non si modifica più.
      </p>
      {contratti.length === 0 && <StatoVuoto>Nessun contratto</StatoVuoto>}
      {contratti.map(c => (
        <ContrattoAffitto key={c.id} contratto={c}
          onAggiorna={nuovo => setContratti(lista => lista.map(x => (x.id === nuovo.id ? nuovo : x)))} />
      ))}
    </div>
  )
}

// ── Interventi ──────────────────────────────────────────────────────────────────

const STATI_INTERVENTO = { idea: 'Idea', approvato: 'Approvato', ordinato: 'Ordinato', fatturato: 'Fatturato', pagato: 'Pagato' }
const STRUTTURE_INTERVENTO = ['DPH', 'CLB', 'INT', 'BON']

export function AdminTesoreriaInterventi() {
  const [interventi, setInterventi] = useState(null)
  const [nuovo, setNuovo] = useState('')
  const [fatture, setFatture] = useState(null)
  const [rateDi, setRateDi] = useState(null)
  const { bozze, modifica, scarta } = useBozze()
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    try { setInterventi((await api.get('/tesoreria/piani/interventi')).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [avvisi])
  useEffect(() => { carica() }, [carica])

  async function salva(i) {
    try {
      const b = { ...bozze[i.id] }
      if ('importo_stimato' in b) b.importo_stimato = String(b.importo_stimato ?? '').replace(',', '.')
      await api.put(`/tesoreria/piani/interventi/${i.id}`, b)
      scarta(i.id); carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function aggiungi() {
    try {
      await api.post('/tesoreria/piani/interventi', { descrizione: nuovo.trim() })
      setNuovo(''); carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function elimina(i) {
    if (!await conferma({ titolo: 'Eliminare l\'intervento?', messaggio: i.descrizione, pericolo: true })) return
    try { await api.delete(`/tesoreria/piani/interventi/${i.id}`); carica() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  if (!interventi) return <Loading />
  return (
    <Card title="Interventi straordinari">
      <p className="ui-text-muted" style={{ marginBottom: 8 }}>
        Un intervento entra in previsione solo con «In previsione» attivo, importo e almeno una rata (data e percentuale; l'ultima chiude il 100%).
        Finché mancano le cifre può restare qui come promemoria. A un lavoro puoi collegare più fatture dello scadenzario: la stima si riduce
        partendo dalla prima rata (le fatture sono già tra le uscite certe); quando sono tutte pagate e coprono la stima, l'intervento diventa «Pagato».
      </p>
      {interventi.length === 0 ? <StatoVuoto>Nessun intervento</StatoVuoto> : (
        <Table compact>
          <thead>
            <tr><Th>Descrizione</Th><Th>Struttura</Th><Th>Fornitore</Th><Th num>Importo (€)</Th><Th>Pagamenti</Th><Th>Stato</Th><Th center>In previsione</Th><Th num>Ancora da fatturare</Th><Th></Th></tr>
          </thead>
          <tbody>
            {interventi.map(i => {
              const v = { ...i, ...(bozze[i.id] || {}) }
              const set = patch => modifica(i.id, patch)
              return (
                <tr key={i.id} className={bozze[i.id] ? 'ui-riga-modificata' : undefined}>
                  <Td><Input value={v.descrizione} style={{ width: 220 }} onChange={e => set({ descrizione: e.target.value })} /></Td>
                  <Td>
                    <Select value={v.struttura_code || ''} onChange={e => set({ struttura_code: e.target.value })}>
                      <option value="">—</option>
                      {STRUTTURE_INTERVENTO.map(s => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </Td>
                  <Td><Input value={v.fornitore || ''} style={{ width: 150 }} onChange={e => set({ fornitore: e.target.value })} /></Td>
                  <Td num><Input value={v.importo_stimato ?? ''} inputMode="decimal" style={{ width: 100 }} onChange={e => set({ importo_stimato: e.target.value })} /></Td>
                  <Td style={{ whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="secondary" onClick={() => setRateDi(i.id)}>Rate ({i.rate.length})</Button>
                    {i.rate.length > 0 && <div className="ui-text-muted">{formatData(i.rate[0].data_prevista)}{i.rate.length > 1 ? ` → ${formatData(i.rate.at(-1).data_prevista)}` : ''}</div>}
                  </Td>
                  <Td>
                    <Select value={v.stato} onChange={e => set({ stato: e.target.value })}>
                      {Object.entries(STATI_INTERVENTO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </Select>
                  </Td>
                  <Td center><Checkbox checked={v.inclusa_in_previsione} onChange={x => set({ inclusa_in_previsione: x })} /></Td>
                  <Td num>{i.residuo != null ? formatEuro(i.residuo) : '—'}</Td>
                  <Td style={{ whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="secondary" onClick={() => setFatture(i)}>Fatture ({i.n_fatture})</Button>{' '}
                    {bozze[i.id] ? <>
                      <Button size="sm" onClick={() => salva(i)}>Salva</Button>{' '}
                      <Button size="sm" variant="ghost" onClick={() => scarta(i.id)}>Annulla</Button>
                    </> : <Button size="sm" variant="danger-soft" onClick={() => elimina(i)}>Elimina</Button>}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
        <Field label="Nuovo intervento"><Input value={nuovo} style={{ width: 260 }} onChange={e => setNuovo(e.target.value)} /></Field>
        <Button onClick={aggiungi} disabled={!nuovo.trim()}>Aggiungi</Button>
      </div>
      {fatture && <ModaleFatture intervento={fatture} onChiudi={() => { setFatture(null); carica() }} />}
      {rateDi && interventi.some(i => i.id === rateDi) && (
        <ModaleRate piano={interventi.find(i => i.id === rateDi)} titolo={interventi.find(i => i.id === rateDi).descrizione} url="/tesoreria/piani/interventi" onChiudi={() => setRateDi(null)}
          onAggiorna={nuovo => setInterventi(lista => lista.map(x => (x.id === nuovo.id ? nuovo : x)))} />
      )}
    </Card>
  )
}

function ModaleRate({ piano, titolo, url, onChiudi, onAggiorna }) {
  const [data, setData] = useState('')
  const [percentuali, setPercentuali] = useState({})
  const avvisi = useAvvisi()
  const conFatture = piano.rate.some(r => 'da_fatturare' in r)

  async function esegui(chiamata) {
    try { onAggiorna((await chiamata()).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  const aggiungi = () => esegui(() => api.post(`${url}/${piano.id}/rate`, { data_prevista: data })).then(() => setData(''))
  const salvaData = (r, valore) => valore && esegui(() => api.put(`${url}/rate/${r.id}`, { data_prevista: valore }))
  const elimina = r => esegui(() => api.delete(`${url}/rate/${r.id}`))

  async function salvaPercentuale(r) {
    const valore = percentuali[r.id]
    if (valore === undefined) return
    await esegui(() => api.put(`${url}/rate/${r.id}`, { percentuale: String(valore).replace(',', '.') }))
    setPercentuali(({ [r.id]: _, ...resto }) => resto)
  }

  return (
    <Modal titolo={`Rate — ${titolo}`} onChiudi={onChiudi} larghezza={640} footer={<Button onClick={onChiudi}>Chiudi</Button>}>
      <p className="ui-text-muted" style={{ marginBottom: 8 }}>
        Con una rata sola il pagamento è unico. Una nuova rata divide a metà la quota dell'ultima: correggi poi le percentuali; l'ultima per data chiude da sola il 100%.
      </p>
      {piano.rate.length === 0 ? <StatoVuoto>Nessuna rata: non entra in previsione.</StatoVuoto> : (
        <Table compact>
          <thead><tr><Th>Data</Th><Th num>%</Th><Th num>Importo</Th>{conFatture && <Th num>Da fatturare</Th>}<Th></Th></tr></thead>
          <tbody>
            {piano.rate.map(r => (
              <tr key={r.id}>
                <Td><Input type="date" value={r.data_prevista} disabled={r.pagata} onChange={e => salvaData(r, e.target.value)} /></Td>
                <Td num>
                  <Input value={r.automatica ? r.percentuale : (percentuali[r.id] ?? r.percentuale)} inputMode="decimal" disabled={r.automatica || r.pagata} style={{ width: 90 }}
                    onChange={e => setPercentuali({ ...percentuali, [r.id]: e.target.value })} onBlur={() => salvaPercentuale(r)} />
                  {r.automatica && <div className="ui-text-muted">automatica</div>}
                </Td>
                <Td num>{r.importo != null ? formatEuro(r.importo) : '—'}</Td>
                {conFatture && <Td num>{r.da_fatturare != null ? formatEuro(r.da_fatturare) : '—'}</Td>}
                <Td>{r.pagata ? <Badge tono="ok">Pagata</Badge> : <Button size="sm" variant="danger-soft" onClick={() => elimina(r)}>Elimina</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
        <Field label="Data della nuova rata"><Input type="date" value={data} onChange={e => setData(e.target.value)} /></Field>
        <Button onClick={aggiungi} disabled={!data}>Aggiungi rata</Button>
      </div>
    </Modal>
  )
}

// ── Compensi dei soci ───────────────────────────────────────────────────────────

const VOCI_COMPENSO = { marchio: 'Marchio', amministratori: 'Amministratori' }

export function AdminTesoreriaCompensi() {
  const [compensi, setCompensi] = useState(null)
  const [nuovo, setNuovo] = useState({ voce: 'marchio', anno_competenza: new Date().getFullYear() + 1, importo: '' })
  const [rateDi, setRateDi] = useState(null)
  const { bozze, modifica, scarta } = useBozze()
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    try { setCompensi((await api.get('/tesoreria/piani/compensi')).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [avvisi])
  useEffect(() => { carica() }, [carica])

  async function aggiungi() {
    try {
      await api.post('/tesoreria/piani/compensi', { ...nuovo, importo: String(nuovo.importo).replace(',', '.') })
      setNuovo({ ...nuovo, importo: '' }); carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  async function salva(c) {
    try {
      const b = { ...bozze[c.id] }
      if ('importo' in b) b.importo = String(b.importo).replace(',', '.')
      await api.put(`/tesoreria/piani/compensi/${c.id}`, b)
      scarta(c.id); carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  async function elimina(c) {
    if (!await conferma({ titolo: 'Eliminare il compenso?', messaggio: `${VOCI_COMPENSO[c.voce]} ${c.anno_competenza}`, pericolo: true })) return
    try { await api.delete(`/tesoreria/piani/compensi/${c.id}`); carica() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  if (!compensi) return <Loading />
  const inRate = compensi.find(c => c.id === rateDi)
  return (
    <Card title="Compensi dei soci">
      <p className="ui-text-muted" style={{ marginBottom: 8 }}>
        Da decidere ogni anno: marchio e amministratori, separati dagli stipendi. Inserisci l'importo <strong>netto</strong>, cioè quello che esce dalla banca;
        eventuali ritenute vanno a parte in Impegni. Entra in previsione solo con importo e almeno una rata: nessuna stima automatica dagli anni precedenti.
      </p>
      {compensi.length === 0 ? <StatoVuoto>Nessun compenso deciso</StatoVuoto> : (
        <Table compact>
          <thead><tr><Th>Anno</Th><Th>Voce</Th><Th num>Importo netto (€)</Th><Th>Pagamenti</Th><Th num>Pagato</Th><Th>Nota</Th><Th></Th></tr></thead>
          <tbody>
            {compensi.map(c => {
              const v = { ...c, ...(bozze[c.id] || {}) }
              return (
                <tr key={c.id} className={bozze[c.id] ? 'ui-riga-modificata' : undefined}>
                  <Td>{c.anno_competenza}</Td><Td>{VOCI_COMPENSO[c.voce] || c.voce}</Td>
                  <Td num><Input value={v.importo} inputMode="decimal" style={{ width: 110 }} onChange={e => modifica(c.id, { importo: e.target.value })} /></Td>
                  <Td style={{ whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="secondary" onClick={() => setRateDi(c.id)}>Rate ({c.rate.length})</Button>
                    {c.rate.length > 0 && <div className="ui-text-muted">{formatData(c.rate[0].data_prevista)}{c.rate.length > 1 ? ` → ${formatData(c.rate.at(-1).data_prevista)}` : ''}</div>}
                    {c.da_pianificare > 0.01 && <div className="ui-text-muted">da pianificare {formatEuro(c.da_pianificare)}</div>}
                  </Td>
                  <Td num>{formatEuro(c.pagato)}</Td>
                  <Td><Input value={v.nota || ''} style={{ width: 180 }} onChange={e => modifica(c.id, { nota: e.target.value })} /></Td>
                  <Td style={{ whiteSpace: 'nowrap' }}>
                    {bozze[c.id] ? <>
                      <Button size="sm" onClick={() => salva(c)}>Salva</Button>{' '}
                      <Button size="sm" variant="ghost" onClick={() => scarta(c.id)}>Annulla</Button>
                    </> : <Button size="sm" variant="danger-soft" onClick={() => elimina(c)}>Elimina</Button>}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
        <Field label="Anno"><Input type="number" value={nuovo.anno_competenza} style={{ width: 80 }} onChange={e => setNuovo({ ...nuovo, anno_competenza: Number(e.target.value) })} /></Field>
        <Field label="Voce">
          <Select value={nuovo.voce} onChange={e => setNuovo({ ...nuovo, voce: e.target.value })}>
            {Object.entries(VOCI_COMPENSO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Importo netto (€)"><Input value={nuovo.importo} inputMode="decimal" style={{ width: 110 }} onChange={e => setNuovo({ ...nuovo, importo: e.target.value })} /></Field>
        <Button onClick={aggiungi} disabled={!nuovo.importo}>Aggiungi</Button>
      </div>
      {inRate && (
        <ModaleRate piano={inRate} titolo={`${VOCI_COMPENSO[inRate.voce]} ${inRate.anno_competenza}`} url="/tesoreria/piani/compensi" onChiudi={() => setRateDi(null)}
          onAggiorna={nuovo => setCompensi(lista => lista.map(x => (x.id === nuovo.id ? nuovo : x)))} />
      )}
    </Card>
  )
}

// ── Advertising pagato con carta e fornitori pagati con carta ───────────────────

const MESI_ADV = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
const numero = v => Number(String(v ?? '').replace(',', '.')) || 0

/** Valori a schermo dei 12 mesi con la bozza applicata: l'ultimo mese compilato prende quanto manca al totale. */
function mesiConBozza(piano, bozza) {
  const valori = {}
  for (const m of piano.mesi) valori[m.mese] = String(m.importo)
  for (const [m, v] of Object.entries(bozza?.mesi || {})) {
    if (v === '' || v == null) delete valori[m]; else valori[m] = v
  }
  const compilati = Object.keys(valori).map(Number).sort((a, b) => a - b)
  const ultimo = compilati.at(-1)
  const totale = numero(bozza?.totale ?? piano.totale)
  const altri = compilati.slice(0, -1).reduce((x, m) => x + numero(valori[m]), 0)
  return { valori, ultimo, automatico: compilati.length > 1 ? totale - altri : null }
}

function PianoAdvertising({ piano, carte, onAggiorna, onElimina }) {
  const [bozza, setBozza] = useState(null)
  const avvisi = useAvvisi()
  const { valori, ultimo, automatico } = mesiConBozza(piano, bozza)
  const info = new Map(piano.mesi.map(m => [m.mese, m]))
  const v = { ...piano, ...(bozza || {}) }
  const modifica = patch => setBozza(b => ({ ...(b || {}), ...patch }))
  const modificaMese = (m, val) => setBozza(b => ({ ...(b || {}), mesi: { ...(b?.mesi || {}), [m]: val } }))

  async function salva() {
    try {
      const corpo = { ...bozza }
      if ('totale' in corpo) corpo.totale = String(corpo.totale).replace(',', '.')
      if (corpo.mesi) corpo.mesi = Object.fromEntries(Object.entries(corpo.mesi).map(([m, x]) => [m, x === '' ? null : String(x).replace(',', '.')]))
      onAggiorna((await api.put(`/tesoreria/piani/advertising/${piano.id}`, corpo)).data)
      setBozza(null)
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
        <strong style={{ fontSize: 16, marginRight: 8 }}>{piano.anno}</strong>
        <Field label="Carta">
          <Select value={v.conto_id} onChange={e => modifica({ conto_id: Number(e.target.value) })}>
            {carte.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
        </Field>
        <Field label="Totale dell'anno (€)"><Input value={v.totale} inputMode="decimal" style={{ width: 110 }} onChange={e => modifica({ totale: e.target.value })} /></Field>
        <Field label="Nota"><Input value={v.nota || ''} style={{ width: 220 }} onChange={e => modifica({ nota: e.target.value })} /></Field>
        {bozza ? <>
          <Button onClick={salva}>Salva</Button>
          <Button variant="ghost" onClick={() => setBozza(null)}>Annulla</Button>
        </> : <Button variant="danger-soft" onClick={() => onElimina(piano)}>Elimina</Button>}
      </div>
      <Table compact>
        <thead><tr><Th>Mese della spesa</Th><Th num>Spesa (€)</Th><Th>Addebito in banca</Th><Th>Nella previsione</Th></tr></thead>
        <tbody>
          {MESI_ADV.map((nome, i) => {
            const m = i + 1
            const r = info.get(m)
            const auto = m === ultimo && automatico != null
            const modificato = bozza?.mesi && m in bozza.mesi
            return (
              <tr key={m} className={modificato ? 'ui-riga-modificata' : undefined}>
                <Td>{nome}</Td>
                <Td num>
                  {auto
                    ? <span>{formatEuro(automatico)} <span className="ui-text-muted">automatico</span></span>
                    : <Input value={valori[m] ?? ''} inputMode="decimal" style={{ width: 110 }} placeholder="—" onChange={e => modificaMese(m, e.target.value)} />}
                </Td>
                <Td>{r ? formatData(r.data_addebito) : '—'}</Td>
                <Td>{!r ? '—' : r.in_previsione ? <Badge tono="info">sì</Badge>
                  : r.addebitato ? <span className="ui-text-muted">già addebitato</span> : <span className="ui-text-muted">nell'estratto inserito</span>}</Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <div className="ui-text-muted" style={{ marginTop: 4 }}>In previsione: {formatEuro(piano.in_previsione)}</div>
    </div>
  )
}

function FornitoriCarta() {
  const [elenco, setElenco] = useState(null)
  const [fornitori, setFornitori] = useState([])
  const [scelta, setScelta] = useState('')
  const avvisi = useAvvisi()

  useEffect(() => {
    Promise.all([api.get('/tesoreria/scadenzario/fornitori-carta'), api.get('/tesoreria/scadenzario/stato')])
      .then(([a, b]) => { setElenco(a.data); setFornitori(b.data.fornitori || []) })
      .catch(e => avvisi.errore(mostraErrore(e)))
  }, [avvisi])

  async function salva(nuovo) {
    try { setElenco((await api.put('/tesoreria/scadenzario/fornitori-carta', nuovo)).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  if (!elenco) return <Loading />
  const presenti = new Set(elenco.map(f => f.codice_fornitore))
  const disponibili = fornitori.filter(f => !presenti.has(f.codice_fornitore)).sort((a, b) => a.fornitore.localeCompare(b.fornitore))
  return (
    <Card title="Fornitori pagati con carta">
      <p className="ui-text-muted" style={{ marginBottom: 8 }}>
        Le loro fatture nello scadenzario Passcom risultano <strong>pagate con carta</strong>: non sono da pagare, non sono scadute, non vanno
        segnalate allo studio e non entrano nella previsione (la spesa è già nell'estratto della carta o nel piano advertising qui sopra).
      </p>
      {elenco.length === 0 ? <StatoVuoto>Nessun fornitore</StatoVuoto> : (
        <Table compact>
          <thead><tr><Th>Codice Passcom</Th><Th>Fornitore</Th><Th></Th></tr></thead>
          <tbody>
            {elenco.map(f => (
              <tr key={f.codice_fornitore}>
                <Td>{f.codice_fornitore}</Td><Td>{f.fornitore}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => salva(elenco.filter(x => x.codice_fornitore !== f.codice_fornitore))}>Togli</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
        <Field label="Fornitore dello scadenzario" style={{ flex: 1 }}>
          <Select value={scelta} onChange={e => setScelta(e.target.value)}>
            <option value="">—</option>
            {disponibili.map(f => <option key={f.codice_fornitore} value={f.codice_fornitore}>{f.fornitore} ({f.codice_fornitore})</option>)}
          </Select>
        </Field>
        <Button disabled={!scelta} onClick={() => {
          const f = fornitori.find(x => x.codice_fornitore === scelta)
          salva([...elenco, { codice_fornitore: f.codice_fornitore, fornitore: f.fornitore }]); setScelta('')
        }}>Aggiungi</Button>
      </div>
    </Card>
  )
}

export function AdminTesoreriaAdvertising() {
  const [piani, setPiani] = useState(null)
  const [carte, setCarte] = useState([])
  const [nuovo, setNuovo] = useState({ anno: new Date().getFullYear() + 1, conto_id: '', totale: '' })
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api.get('/tesoreria/piani/advertising'), api.get('/tesoreria/conti')])
      const soloCarte = c.data.filter(x => x.tipo === 'carta_credito')
      setPiani(p.data); setCarte(soloCarte)
      setNuovo(n => ({ ...n, conto_id: n.conto_id || (soloCarte.find(x => x.codice === 'AMEX') || soloCarte[0])?.id || '' }))
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [avvisi])
  useEffect(() => { carica() }, [carica])

  async function aggiungi() {
    try {
      await api.post('/tesoreria/piani/advertising', { ...nuovo, totale: String(nuovo.totale).replace(',', '.') })
      setNuovo({ ...nuovo, totale: '' }); carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  async function elimina(p) {
    if (!await conferma({ titolo: "Eliminare il piano advertising?", messaggio: `Anno ${p.anno}`, pericolo: true })) return
    try { await api.delete(`/tesoreria/piani/advertising/${p.id}`); carica() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  if (!piani) return <Loading />
  return (
    <>
      <Card title="Advertising pagato con carta (Google, Meta)">
        <p className="ui-text-muted" style={{ marginBottom: 8 }}>
          Spesa di ogni mese decisa da te: esce dalla banca con l'addebito della carta del <strong>mese dopo</strong> (AMEX: estratto chiuso il 6,
          addebito intorno al 27). L'ultimo mese compilato prende quanto manca al totale dell'anno. In previsione entra come gruppo «Advertising»;
          la stima «Carte» dello stesso mese dell'anno di riferimento viene ridotta dell'advertising di quell'anno, quindi inserisci anche
          gli anni passati (sono il riferimento). Un mese il cui estratto è già inserito non entra: lo contiene l'estratto.
        </p>
        {piani.length === 0 ? <StatoVuoto>Nessun piano</StatoVuoto> : piani.map(p => (
          <PianoAdvertising key={p.id} piano={p} carte={carte} onElimina={elimina}
            onAggiorna={nuovo => setPiani(lista => lista.map(x => (x.id === nuovo.id ? nuovo : x)))} />
        ))}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
          <Field label="Anno"><Input type="number" value={nuovo.anno} style={{ width: 80 }} onChange={e => setNuovo({ ...nuovo, anno: Number(e.target.value) })} /></Field>
          <Field label="Carta">
            <Select value={nuovo.conto_id} onChange={e => setNuovo({ ...nuovo, conto_id: Number(e.target.value) })}>
              {carte.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
          </Field>
          <Field label="Totale dell'anno (€)"><Input value={nuovo.totale} inputMode="decimal" style={{ width: 110 }} onChange={e => setNuovo({ ...nuovo, totale: e.target.value })} /></Field>
          <Button onClick={aggiungi} disabled={!nuovo.totale || !nuovo.conto_id}>Aggiungi anno</Button>
        </div>
      </Card>
      <div style={{ height: 16 }} />
      <FornitoriCarta />
    </>
  )
}

function ModaleFatture({ intervento, onChiudi }) {
  const [dati, setDati] = useState(null)
  const [scelta, setScelta] = useState('')
  const avvisi = useAvvisi()
  const carica = useCallback(async () => {
    try { setDati((await api.get(`/tesoreria/piani/interventi/${intervento.id}/fatture`)).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [intervento.id, avvisi])
  useEffect(() => { carica() }, [carica])

  async function collega() {
    try { await api.post(`/tesoreria/piani/interventi/${intervento.id}/fatture`, { chiave: scelta }); setScelta(''); carica() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  async function scollega(f) {
    try { await api.delete(`/tesoreria/piani/interventi/fatture/${f.id}`); carica() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  return (
    <Modal titolo={`Fatture — ${intervento.descrizione}`} onChiudi={onChiudi} larghezza={640} footer={<Button onClick={onChiudi}>Chiudi</Button>}>
      {!dati ? <Loading /> : <>
        {dati.collegate.length === 0 ? <StatoVuoto>Nessuna fattura collegata.</StatoVuoto> : (
          <Table compact>
            <thead><tr><Th>Fornitore</Th><Th>N.</Th><Th>Scadenza</Th><Th num>Importo</Th><Th></Th></tr></thead>
            <tbody>
              {dati.collegate.map(f => (
                <tr key={f.id}>
                  <Td>{f.fornitore}</Td><Td>{f.numero_documento || '—'}</Td><Td>{formatData(f.data_scadenza)}</Td><Td num>{formatEuro(f.importo)}</Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => scollega(f)}>Togli</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
          <Field label="Scadenza dello scadenzario (prima quelle del fornitore previsto)" style={{ flex: 1 }}>
            <Select value={scelta} onChange={e => setScelta(e.target.value)}>
              <option value="">—</option>
              {dati.candidate.map(c => (
                <option key={c.chiave} value={c.chiave}>{c.fornitore} · {c.numero_documento || 's.n.'} · {formatData(c.data_scadenza)} · {formatEuro(c.importo)}</option>
              ))}
            </Select>
          </Field>
          <Button onClick={collega} disabled={!scelta}>Collega</Button>
        </div>
      </>}
    </Modal>
  )
}

// ── Parametri della previsione ──────────────────────────────────────────────────

const GRUPPI_CRESCITA = [
  { key: 'fornitori', label: 'Spese F&B e fornitori' },
  { key: 'marketing', label: 'Marketing e OTA' },
  { key: 'carte', label: 'Carte di credito' },
  { key: 'personale', label: 'Personale' },
  { key: 'utenze', label: 'Utenze' },
  { key: 'altre', label: 'Altre (spiagge, auto, banca)' },
]
const SCENARI_PREVISIONE = { pessimista: 'Pessimista', realista: 'Realista', ottimista: 'Ottimista' }

export function AdminTesoreriaPrevisione() {
  const [parametri, setParametri] = useState(null)
  const [crescita, setCrescita] = useState({})
  const [scenari, setScenari] = useState({})
  const avvisi = useAvvisi()

  useEffect(() => {
    api.get('/tesoreria/previsione/parametri').then(r => setParametri(r.data)).catch(e => avvisi.errore(mostraErrore(e)))
  }, [avvisi])

  const numero = v => Number(String(v).replace(',', '.'))
  const modificato = Object.keys(crescita).length > 0 || Object.keys(scenari).length > 0

  async function salva() {
    const corpoCrescita = Object.fromEntries(Object.entries(crescita).map(([k, v]) => [k, v === '' ? null : numero(v)]))
    const corpoScenari = Object.fromEntries(Object.entries(scenari).map(([nome, valori]) => [
      nome, Object.fromEntries(Object.entries(valori).map(([k, v]) => [k, numero(v)])),
    ]))
    if ([...Object.values(corpoCrescita), ...Object.values(corpoScenari).flatMap(Object.values)].some(v => v !== null && Number.isNaN(v))) {
      avvisi.errore('Inserire solo numeri'); return
    }
    try {
      setParametri((await api.put('/tesoreria/previsione/parametri', { crescita: corpoCrescita, scenari: corpoScenari })).data)
      setCrescita({}); setScenari({}); avvisi.successo('Parametri salvati')
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  if (!parametri) return <Loading />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Crescita delle uscite rispetto all'anno prima">
        <p className="ui-text-muted" style={{ marginBottom: 8 }}>
          Percentuale per gruppo, anche negativa. Campo vuoto = cresce come il Budget rispetto ai ricavi dell'anno prima.
          Vale per le uscite stimate degli anni futuri, non per quelle già certe (scadenzario, affitti, fisco).
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
          {GRUPPI_CRESCITA.map(g => {
            const v = g.key in crescita ? crescita[g.key] : parametri.crescita[g.key] ?? ''
            return (
              <Field key={g.key} label={g.label}>
                <Input value={v} inputMode="decimal" placeholder="come il Budget" modificato={g.key in crescita} style={{ width: 130 }}
                  onChange={e => setCrescita({ ...crescita, [g.key]: e.target.value })} />
              </Field>
            )
          })}
        </div>
      </Card>
      <Card title="Scenari">
        <p className="ui-text-muted" style={{ marginBottom: 8 }}>Variazioni percentuali applicate a incassi e uscite stimate.</p>
        <Table compact>
          <thead><tr><Th>Scenario</Th><Th num>Incassi %</Th><Th num>Uscite stimate %</Th></tr></thead>
          <tbody>
            {Object.entries(SCENARI_PREVISIONE).map(([nome, label]) => (
              <tr key={nome}>
                <Td>{label}</Td>
                {['incassi_pct', 'uscite_stimate_pct'].map(k => (
                  <Td num key={k}>
                    <Input value={scenari[nome]?.[k] ?? parametri.scenari[nome][k]} inputMode="decimal" modificato={k in (scenari[nome] || {})} style={{ width: 80 }}
                      onChange={e => setScenari({ ...scenari, [nome]: { ...(scenari[nome] || {}), [k]: e.target.value } })} />
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <div><Button onClick={salva} disabled={!modificato}>Salva</Button></div>
    </div>
  )
}

// ── Ricorrenti ──────────────────────────────────────────────────────────────────

const VUOTO_RICORRENTE = { descrizione: '', categoria_id: '', importo: '', giorno: 1, mesi: '' }
const mesiDaTesto = t => String(t).split(/[\s,;]+/).filter(Boolean).map(Number)

export function AdminTesoreriaRicorrenti() {
  const [ricorrenti, setRicorrenti] = useState(null)
  const [categorie, setCategorie] = useState([])
  const [nuovo, setNuovo] = useState(VUOTO_RICORRENTE)
  const { bozze, modifica, scarta } = useBozze()
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([api.get('/tesoreria/piani/ricorrenti'), api.get('/tesoreria/categorie')])
      setRicorrenti(r.data); setCategorie(c.data.filter(x => x.tipo !== 'entrata'))
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [avvisi])
  useEffect(() => { carica() }, [carica])

  function corpo(b) {
    const out = { ...b }
    if ('importo' in out) out.importo = String(out.importo).replace(',', '.')
    if ('mesi' in out) out.mesi = mesiDaTesto(out.mesi)
    if ('giorno' in out) out.giorno = Number(out.giorno)
    if ('categoria_id' in out) out.categoria_id = Number(out.categoria_id)
    return out
  }
  async function salva(r) {
    try { await api.put(`/tesoreria/piani/ricorrenti/${r.id}`, corpo(bozze[r.id])); scarta(r.id); carica() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  async function aggiungi() {
    try { await api.post('/tesoreria/piani/ricorrenti', corpo(nuovo)); setNuovo(VUOTO_RICORRENTE); carica() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  async function elimina(r) {
    if (!await conferma({ titolo: 'Eliminare il ricorrente?', messaggio: r.descrizione, pericolo: true })) return
    try { await api.delete(`/tesoreria/piani/ricorrenti/${r.id}`); carica() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  if (!ricorrenti) return <Loading />
  const SelectCat = ({ value, onChange }) => (
    <Select value={value ?? ''} onChange={e => onChange(e.target.value)}>
      <option value="">—</option>
      {categorie.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
    </Select>
  )
  return (
    <Card title="Uscite ricorrenti fuori dallo scadenzario">
      <p className="ui-text-muted" style={{ marginBottom: 8 }}>
        Mesi separati da virgola (es. 1, 7). La categoria serve a togliere l'importo dalla stima storica, così non conta due volte.
      </p>
      <Table compact>
        <thead><tr><Th>Descrizione</Th><Th>Categoria</Th><Th num>Importo (€)</Th><Th num>Giorno</Th><Th>Mesi</Th><Th center>Attivo</Th><Th></Th></tr></thead>
        <tbody>
          {ricorrenti.map(r => {
            const v = { ...r, ...(bozze[r.id] || {}) }
            const set = patch => modifica(r.id, patch)
            return (
              <tr key={r.id} className={bozze[r.id] ? 'ui-riga-modificata' : undefined}>
                <Td><Input value={v.descrizione} style={{ width: 300 }} onChange={e => set({ descrizione: e.target.value })} /></Td>
                <Td><SelectCat value={v.categoria_id} onChange={x => set({ categoria_id: x })} /></Td>
                <Td num><Input value={v.importo} inputMode="decimal" style={{ width: 90 }} onChange={e => set({ importo: e.target.value })} /></Td>
                <Td num><Input type="number" min={1} max={31} value={v.giorno} style={{ width: 60 }} onChange={e => set({ giorno: e.target.value })} /></Td>
                <Td><Input value={Array.isArray(v.mesi) ? v.mesi.join(', ') : v.mesi} style={{ width: 80 }} onChange={e => set({ mesi: e.target.value })} /></Td>
                <Td center><Checkbox checked={v.attivo} onChange={x => set({ attivo: x })} /></Td>
                <Td style={{ whiteSpace: 'nowrap' }}>
                  {bozze[r.id] ? <>
                    <Button size="sm" onClick={() => salva(r)}>Salva</Button>{' '}
                    <Button size="sm" variant="ghost" onClick={() => scarta(r.id)}>Annulla</Button>
                  </> : <Button size="sm" variant="danger-soft" onClick={() => elimina(r)}>Elimina</Button>}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
        <Field label="Descrizione"><Input value={nuovo.descrizione} style={{ width: 240 }} onChange={e => setNuovo({ ...nuovo, descrizione: e.target.value })} /></Field>
        <Field label="Categoria"><SelectCat value={nuovo.categoria_id} onChange={x => setNuovo({ ...nuovo, categoria_id: x })} /></Field>
        <Field label="Importo (€)"><Input value={nuovo.importo} inputMode="decimal" style={{ width: 90 }} onChange={e => setNuovo({ ...nuovo, importo: e.target.value })} /></Field>
        <Field label="Giorno"><Input type="number" min={1} max={31} value={nuovo.giorno} style={{ width: 60 }} onChange={e => setNuovo({ ...nuovo, giorno: e.target.value })} /></Field>
        <Field label="Mesi"><Input value={nuovo.mesi} style={{ width: 80 }} onChange={e => setNuovo({ ...nuovo, mesi: e.target.value })} /></Field>
        <Button onClick={aggiungi} disabled={!nuovo.descrizione.trim() || !nuovo.categoria_id || !nuovo.importo || !nuovo.mesi}>Aggiungi</Button>
      </div>
    </Card>
  )
}

// ── Mutuo ───────────────────────────────────────────────────────────────────────

export function AdminTesoreriaMutuo() {
  const [piano, setPiano] = useState(null)
  const avvisi = useAvvisi()
  const carica = useCallback(async () => {
    try { setPiano((await api.get('/tesoreria/piani/mutuo')).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [avvisi])
  useEffect(() => { carica() }, [carica])

  async function caricaFile(file) {
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = (await api.post('/tesoreria/piani/mutuo', fd)).data
      avvisi.successo(`Piano caricato: ${r.n_rate} rate, ${r.n_pagate} già pagate`); carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  if (!piano) return <Loading />
  return (
    <Card title="Piano di ammortamento" actions={<FileButton accept=".xls" onFile={caricaFile}>Carica piano (.xls della banca)</FileButton>}>
      <p className="ui-text-muted" style={{ marginBottom: 8 }}>
        Il tasso è variabile: ricaricando il piano si aggiornano le rate da pagare, quelle pagate restano. Debito residuo: <strong>{formatEuro(piano.debito_residuo)}</strong>.
      </p>
      {piano.rate.length === 0 ? <StatoVuoto>Nessun piano caricato.</StatoVuoto> : (
        <Table compact maxHeight="60vh">
          <thead><tr><Th num>N.</Th><Th>Scadenza</Th><Th num>Capitale</Th><Th num>Interessi</Th><Th num>Rata</Th><Th num>Spese</Th><Th num>Residuo</Th><Th>Pagata</Th></tr></thead>
          <tbody>
            {piano.rate.map(r => (
              <tr key={`${r.finanziamento}-${r.numero}`} className={r.pagata_il ? 'ui-riga-attenuata' : undefined}>
                <Td num>{r.numero}</Td><Td>{formatData(r.data_scadenza)}</Td><Td num>{formatEuro(r.capitale)}</Td><Td num>{formatEuro(r.interessi)}</Td>
                <Td num>{formatEuro(r.importo)}</Td><Td num>{formatEuro(r.spese)}</Td><Td num>{r.residuo != null ? formatEuro(r.residuo) : '—'}</Td>
                <Td>{r.pagata_il ? formatData(r.pagata_il) : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// ── Dati fiscali ────────────────────────────────────────────────────────────────

function MappaImporti({ titolo, nota, etichetta, valori, onChange }) {
  const [chiave, setChiave] = useState('')
  const voci = Object.entries(valori || {}).sort(([a], [b]) => a.localeCompare(b))
  return (
    <Card title={titolo}>
      {nota && <p className="ui-text-muted" style={{ marginBottom: 8 }}>{nota}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        {voci.map(([k, v]) => (
          <Field key={k} label={k}>
            <Input value={v} inputMode="decimal" style={{ width: 100 }} onChange={e => onChange({ ...valori, [k]: e.target.value })} />
          </Field>
        ))}
        <Field label={`Aggiungi ${etichetta}`}><Input value={chiave} style={{ width: 100 }} onChange={e => setChiave(e.target.value)} /></Field>
        <Button size="sm" variant="secondary" disabled={!chiave.trim()} onClick={() => { onChange({ ...valori, [chiave.trim()]: 0 }); setChiave('') }}>Aggiungi</Button>
      </div>
    </Card>
  )
}

export function AdminTesoreriaFiscale() {
  const [p, setP] = useState(null)
  const [modificato, setModificato] = useState(false)
  const avvisi = useAvvisi()

  useEffect(() => {
    api.get('/tesoreria/impegni/parametri').then(r => setP(r.data)).catch(e => avvisi.errore(mostraErrore(e)))
  }, [avvisi])

  const aggiorna = patch => { setP({ ...p, ...patch }); setModificato(true) }
  const numeri = mappa => Object.fromEntries(Object.entries(mappa).map(([k, v]) => [k, Number(String(v).replace(',', '.'))]))

  async function salva() {
    const corpo = {
      ...p,
      giorno_tassa_soggiorno: Number(p.giorno_tassa_soggiorno), acconti_mese: Number(p.acconti_mese), acconti_giorno: Number(p.acconti_giorno),
      imposte: { ires: numeri(p.imposte.ires || {}), irap: numeri(p.imposte.irap || {}) },
      iva_agosto: numeri(p.iva_agosto), tari_totali: numeri(p.tari_totali), altri_crediti_f24: numeri(p.altri_crediti_f24), f24_storico: numeri(p.f24_storico),
      crediti_iva: p.crediti_iva.map(c => ({ ...c, importo: Number(String(c.importo).replace(',', '.')), anticipabile_dal: c.anticipabile_dal || undefined })),
    }
    try {
      await api.put('/tesoreria/impegni/parametri', corpo)
      await api.post('/tesoreria/impegni/genera')
      setModificato(false); avvisi.successo('Dati salvati e calendario aggiornato')
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  if (!p) return <Loading />
  const setCredito = (i, patch) => aggiorna({ crediti_iva: p.crediti_iva.map((c, n) => (n === i ? { ...c, ...patch } : c)) })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button onClick={salva} disabled={!modificato}>Salva e aggiorna il calendario</Button>
        <span className="ui-text-muted">Questi dati restano solo nel database.</span>
      </div>
      <Card title="Date">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Field label="Previsione fino al"><Input type="date" value={p.orizzonte} onChange={e => aggiorna({ orizzonte: e.target.value })} /></Field>
          <Field label="Giorno tassa di soggiorno"><Input type="number" min={1} max={31} value={p.giorno_tassa_soggiorno} style={{ width: 80 }} onChange={e => aggiorna({ giorno_tassa_soggiorno: e.target.value })} /></Field>
          <Field label="1° acconto: mese"><Input type="number" min={1} max={12} value={p.acconti_mese} style={{ width: 80 }} onChange={e => aggiorna({ acconti_mese: e.target.value })} /></Field>
          <Field label="1° acconto: giorno"><Input type="number" min={1} max={31} value={p.acconti_giorno} style={{ width: 80 }} onChange={e => aggiorna({ acconti_giorno: e.target.value })} /></Field>
        </div>
      </Card>
      <Card title="Credito IVA">
        <p className="ui-text-muted" style={{ marginBottom: 8 }}>
          Una riga per credito. «Intero dal» = dopo la dichiarazione; «5.000 € dal» = quota usabile prima. Aggiornare quando arriva la dichiarazione IVA.
        </p>
        <Table compact>
          <thead><tr><Th num>Importo (€)</Th><Th>Intero dal</Th><Th>5.000 € dal</Th><Th></Th></tr></thead>
          <tbody>
            {p.crediti_iva.map((c, i) => (
              <tr key={i}>
                <Td num><Input value={c.importo} inputMode="decimal" style={{ width: 110 }} onChange={e => setCredito(i, { importo: e.target.value })} /></Td>
                <Td><Input type="date" value={c.disponibile_dal} onChange={e => setCredito(i, { disponibile_dal: e.target.value })} /></Td>
                <Td><Input type="date" value={c.anticipabile_dal || ''} onChange={e => setCredito(i, { anticipabile_dal: e.target.value })} /></Td>
                <Td><Button size="sm" variant="danger-soft" onClick={() => aggiorna({ crediti_iva: p.crediti_iva.filter((_, n) => n !== i) })}>Togli</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div style={{ marginTop: 8 }}>
          <Button size="sm" variant="secondary" onClick={() => aggiorna({ crediti_iva: [...p.crediti_iva, { importo: 0, disponibile_dal: oggi() }] })}>Aggiungi credito</Button>
        </div>
      </Card>
      <MappaImporti titolo="IRES da dichiarazione" etichetta="anno" valori={p.imposte.ires} onChange={v => aggiorna({ imposte: { ...p.imposte, ires: v } })} />
      <MappaImporti titolo="IRAP da dichiarazione" etichetta="anno" valori={p.imposte.irap} onChange={v => aggiorna({ imposte: { ...p.imposte, irap: v } })} />
      <MappaImporti titolo="IVA di agosto versata" etichetta="anno" valori={p.iva_agosto} onChange={v => aggiorna({ iva_agosto: v })} />
      <MappaImporti titolo="TARI: totale dell'anno" etichetta="anno" valori={p.tari_totali} onChange={v => aggiorna({ tari_totali: v })} />
      <MappaImporti titolo="Altri crediti F24 (1701, 1704, 1631, 1627)" nota="Per mese di versamento, dalle quietanze." etichetta="AAAA-MM" valori={p.altri_crediti_f24} onChange={v => aggiorna({ altri_crediti_f24: v })} />
      <MappaImporti titolo="F24 dipendenti storici" nota="Per mese di paga, dalle quietanze: si usano dove mancano i cedolini." etichetta="AAAA-MM" valori={p.f24_storico} onChange={v => aggiorna({ f24_storico: v })} />
    </div>
  )
}
