// Movimenti bancari: filtri, ricerca, ordinamento, paginazione; correzione della categoria (manuale,
// vince sulle regole), dettaglio con note/straordinario e "crea regola da questo movimento".
import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../api/client.js'
import { formatData, formatEuro, mostraErrore } from '../../utils/format.js'
import {
  Button, Checkbox, Field, Input, Loading, Messaggio, Modal, Paginazione, Select, StatoVuoto, Table, Td, Textarea, Th,
  ThOrdinabile, useAvvisi,
} from '../../components/ui'
import { BadgeCategoria, Importo, ModaleRegola, SelectCategoria } from './helpers.jsx'

const PER_PAGINA = 50

function ModaleMovimento({ movimento, conti, puoModificare, onChiudi, onSalvato, onCreaRegola }) {
  const [note, setNote] = useState(movimento.note || '')
  const [straordinario, setStraordinario] = useState(movimento.straordinario)
  const [errore, setErrore] = useState(null)
  const conto = conti.find(c => c.id === movimento.conto_id)

  async function salva(extra = {}) {
    try {
      await api.put(`/tesoreria/movimenti/${movimento.id}`, { note, straordinario, ...extra })
      onSalvato()
    } catch (e) { setErrore(mostraErrore(e)) }
  }

  const footer = puoModificare ? (
    <>
      <Button variant="secondary" onClick={() => onCreaRegola(movimento)}>Crea regola da questo movimento</Button>
      {movimento.categoria_manuale && (
        <Button variant="secondary" onClick={() => salva({ automatica: true })}>Torna alla categoria automatica</Button>
      )}
      <Button onClick={() => salva()}>Salva</Button>
    </>
  ) : <Button variant="secondary" onClick={onChiudi}>Chiudi</Button>

  const riga = (etichetta, valore) => (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, marginBottom: 4 }}>
      <span className="ui-text-muted">{etichetta}</span><span>{valore}</span>
    </div>
  )

  return (
    <Modal titolo="Movimento" onChiudi={onChiudi} footer={footer} larghezza={680}>
      {riga('Conto', conto?.nome || '—')}
      {riga('Data contabile', formatData(movimento.data_contabile))}
      {riga('Data valuta', formatData(movimento.data_valuta))}
      {riga('Importo', <Importo v={movimento.importo} forte />)}
      {riga('Controparte', movimento.controparte || '—')}
      {riga('Causale ABI', movimento.causale_abi || '—')}
      {riga('Categoria', <BadgeCategoria nome={movimento.categoria_nome} colore={movimento.categoria_colore}
        manuale={movimento.categoria_manuale} />)}
      <div style={{ margin: '8px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} className="ui-text-muted">
        {movimento.descrizione}
      </div>
      {puoModificare && (
        <>
          <Field label="Note"><Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
          <div style={{ marginTop: 8 }}>
            <Checkbox label="Straordinario (non ricorrente: escluso dalle stime della previsione)"
              checked={straordinario} onChange={setStraordinario} />
          </div>
        </>
      )}
      <Messaggio>{errore}</Messaggio>
    </Modal>
  )
}

export default function TabMovimenti({ conti, categorie, permessi, filtroIniziale }) {
  const daClassificareId = categorie.find(c => c.codice === 'da_classificare')?.id
  const [filtri, setFiltri] = useState(() => ({
    conto_id: '', data_da: '', data_a: '', segno: '', solo_manuali: false, straordinario: '',
    // Arrivando dal link "vedi" della Posizione si apre già filtrato (niente richiesta senza filtro)
    categoria_id: filtroIniziale?.daClassificare && daClassificareId ? String(daClassificareId) : '',
  }))
  const [testo, setTesto] = useState('')
  const [q, setQ] = useState('')
  const [ordine, setOrdine] = useState({ per: 'data_contabile', direzione: 'desc' })
  const [pagina, setPagina] = useState(1)
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const [aperto, setAperto] = useState(null)
  const [regola, setRegola] = useState(null)
  const avvisi = useAvvisi()
  const ultimaRichiesta = useRef(0)

  // Link "vedi" dalla Posizione: movimenti da classificare
  useEffect(() => {
    if (filtroIniziale?.daClassificare && daClassificareId) {
      setFiltri(f => ({ ...f, categoria_id: String(daClassificareId) }))
      setPagina(1)
    }
  }, [filtroIniziale, daClassificareId])

  // Ricerca con ritardo (400ms) per non interrogare a ogni tasto
  useEffect(() => {
    const t = setTimeout(() => { setQ(testo); setPagina(1) }, 400)
    return () => clearTimeout(t)
  }, [testo])

  const carica = useCallback(async () => {
    const params = { pagina, per_pagina: PER_PAGINA, ordina_per: ordine.per, direzione: ordine.direzione }
    Object.entries(filtri).forEach(([k, v]) => { if (v !== '' && v !== false) params[k] = v })
    if (q) params.q = q
    // Solo la risposta dell'ultima richiesta conta: una più lenta, partita prima con altri filtri,
    // non deve sovrascriverla
    const richiesta = ++ultimaRichiesta.current
    try {
      setErrore(null)
      const r = await api.get('/tesoreria/movimenti', { params })
      if (richiesta === ultimaRichiesta.current) setDati(r.data)
    } catch (e) { if (richiesta === ultimaRichiesta.current) setErrore(mostraErrore(e)) }
  }, [filtri, q, ordine, pagina])

  useEffect(() => { carica() }, [carica])

  const setFiltro = patch => { setFiltri(f => ({ ...f, ...patch })); setPagina(1) }
  const ordina = campo => {
    setOrdine(o => ({ per: campo, direzione: o.per === campo && o.direzione === 'desc' ? 'asc' : 'desc' }))
    setPagina(1)
  }

  async function cambiaCategoria(m, categoriaId) {
    if (!categoriaId) return
    try {
      await api.put(`/tesoreria/movimenti/${m.id}`, { categoria_id: categoriaId })
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function creaRegola(m) {
    try {
      const proposta = (await api.get(`/tesoreria/movimenti/${m.id}/proposta-regola`)).data
      setAperto(null)
      setRegola(proposta)
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label="Cerca"><Input value={testo} placeholder="Nome, descrizione, importo…" style={{ width: 240 }}
          onChange={e => setTesto(e.target.value)} /></Field>
        <Field label="Conto">
          <Select value={filtri.conto_id} onChange={e => setFiltro({ conto_id: e.target.value })}>
            <option value="">Tutti</option>
            {conti.filter(c => c.ha_import).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
        </Field>
        <Field label="Dal"><Input type="date" value={filtri.data_da} onChange={e => setFiltro({ data_da: e.target.value })} /></Field>
        <Field label="Al"><Input type="date" value={filtri.data_a} onChange={e => setFiltro({ data_a: e.target.value })} /></Field>
        <Field label="Categoria">
          <SelectCategoria categorie={categorie} value={filtri.categoria_id ? Number(filtri.categoria_id) : null}
            vuota="Tutte" soloAttive={false} onChange={v => setFiltro({ categoria_id: v ? String(v) : '' })} />
        </Field>
        <Field label="Tipo">
          <Select value={filtri.segno} onChange={e => setFiltro({ segno: e.target.value })}>
            <option value="">Entrate e uscite</option>
            <option value="entrata">Solo entrate</option>
            <option value="uscita">Solo uscite</option>
          </Select>
        </Field>
        <Checkbox label="Solo corretti a mano" checked={filtri.solo_manuali} onChange={v => setFiltro({ solo_manuali: v })} />
        <Checkbox label="Solo straordinari" checked={filtri.straordinario === 'true'}
          onChange={v => setFiltro({ straordinario: v ? 'true' : '' })} />
      </div>

      <Messaggio>{errore}</Messaggio>
      {!dati ? <Loading /> : (
        <>
          <p className="ui-text-muted">
            {dati.totale} movimenti — entrate {formatEuro(dati.entrate)}, uscite {formatEuro(dati.uscite)},
            netto {formatEuro(dati.netto)}
          </p>
          {dati.righe.length === 0 ? <StatoVuoto>Nessun movimento con questi filtri.</StatoVuoto> : (
            <Table compact>
              <thead>
                <tr>
                  <ThOrdinabile campo="data_contabile" ordinaPer={ordine.per} direzione={ordine.direzione} onOrdina={ordina}>Data</ThOrdinabile>
                  <Th>Conto</Th>
                  <ThOrdinabile campo="controparte" ordinaPer={ordine.per} direzione={ordine.direzione} onOrdina={ordina}>Controparte / descrizione</ThOrdinabile>
                  <ThOrdinabile campo="importo" num ordinaPer={ordine.per} direzione={ordine.direzione} onOrdina={ordina}>Importo</ThOrdinabile>
                  <Th>Categoria</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {dati.righe.map(m => (
                  <tr key={m.id} className={m.categoria_manuale ? 'ui-riga-modificata' : undefined}>
                    <Td style={{ whiteSpace: 'nowrap' }}>{formatData(m.data_contabile)}</Td>
                    <Td muted>{conti.find(c => c.id === m.conto_id)?.codice}</Td>
                    <Td style={{ maxWidth: 480 }}>
                      {m.controparte && <b>{m.controparte}</b>}
                      <div className="ui-text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={m.descrizione}>{m.descrizione}</div>
                      {(m.note || m.straordinario) && (
                        <div className="ui-text-muted">{m.straordinario ? '★ straordinario ' : ''}{m.note || ''}</div>
                      )}
                    </Td>
                    <Td num><Importo v={m.importo} /></Td>
                    <Td>
                      {permessi.puo_modificare ? (
                        <SelectCategoria categorie={categorie} value={m.categoria_id} vuota={null}
                          onChange={v => cambiaCategoria(m, v)} />
                      ) : <BadgeCategoria nome={m.categoria_nome} colore={m.categoria_colore} manuale={m.categoria_manuale} />}
                    </Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => setAperto(m)}>Dettagli</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Paginazione pagina={pagina} perPagina={PER_PAGINA} totale={dati.totale} onChange={setPagina} estremi />
          <p className="ui-text-muted">
            Barra ambra = categoria corretta a mano: le regole e il ricalcolo non la cambiano.
          </p>
        </>
      )}

      {aperto && (
        <ModaleMovimento movimento={aperto} conti={conti} puoModificare={permessi.puo_modificare}
          onChiudi={() => setAperto(null)} onSalvato={() => { setAperto(null); carica() }} onCreaRegola={creaRegola} />
      )}
      {regola && (
        <ModaleRegola iniziale={regola} categorie={categorie} onChiudi={() => setRegola(null)}
          onSalvata={() => { setRegola(null); carica() }} />
      )}
    </div>
  )
}
