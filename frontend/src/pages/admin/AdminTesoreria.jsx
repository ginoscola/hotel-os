// Admin → Tesoreria: conti (fido e scadenza), categorie (colore, operative o no), regole di
// classificazione (con prova e ricalcolo), soglie degli avvisi di freschezza, piano affitti, interventi, parametri della previsione.
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../api/client.js'
import { formatEuro, formatData, mostraErrore } from '../../utils/format.js'
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
                  <Td num><Input value={v.percentuale} inputMode="decimal" disabled={pagata} style={{ width: 100 }} onChange={e => modifica(r.id, { percentuale: e.target.value })} /></Td>
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
        Le percentuali di un anno non possono superare il 100%; se restano sotto, la differenza è «da pianificare» e non
        entra in previsione. Una rata pagata in banca non si modifica più.
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
        Un intervento entra in previsione solo con «In previsione» attivo, importo e mese: l'uscita è messa a fine mese.
        Finché mancano le cifre può restare qui come promemoria.
      </p>
      {interventi.length === 0 ? <StatoVuoto>Nessun intervento</StatoVuoto> : (
        <Table compact>
          <thead>
            <tr><Th>Descrizione</Th><Th>Struttura</Th><Th>Fornitore</Th><Th num>Importo (€)</Th><Th>Mese</Th><Th>Stato</Th><Th center>In previsione</Th><Th></Th></tr>
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
                  <Td><Input type="month" value={v.mese_previsto || ''} onChange={e => set({ mese_previsto: e.target.value })} /></Td>
                  <Td>
                    <Select value={v.stato} onChange={e => set({ stato: e.target.value })}>
                      {Object.entries(STATI_INTERVENTO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </Select>
                  </Td>
                  <Td center><Checkbox checked={v.inclusa_in_previsione} onChange={x => set({ inclusa_in_previsione: x })} /></Td>
                  <Td style={{ whiteSpace: 'nowrap' }}>
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
    </Card>
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
