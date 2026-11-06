// Fatture ricevute dallo SDI (Fase 5): stato rispetto allo scadenzario Passcom e alla banca, "da registrare" da
// segnalare allo studio (entrano in previsione), dettaglio con righe IVA, rate e abbinamenti. Gli ZIP si caricano in
// "Import e saldi". Più fatture selezionate (anche già pagate e chiuse) si assegnano a una spesa straordinaria.
import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../api/client.js'
import { ExportMenu } from '../../components/ExportMenu.jsx'
import { formatData, formatEuro, formatN, mostraErrore } from '../../utils/format.js'
import {
  Badge, Button, Card, Checkbox, Drawer, Field, Input, KpiTile, Loading, Messaggio, Modal, Paginazione, SegmentedControl, Select, StatoVuoto, Table, Td, Th,
  ThOrdinabile, useAvvisi, useConferma,
} from '../../components/ui'
import { Importo, etichettaAnno } from './helpers.jsx'
import { ModaleManuale, ModalePagate } from './TabScadenzario.jsx'
import VistaFattura from './VistaFattura.jsx'

const PER_PAGINA = 50
const STATI = {
  da_registrare: ['Da registrare', 'warn'],
  da_confermare: ['Pagamento da confermare', 'info'],
  pagata_banca: ['Pagata in banca', 'ok'],
  pagata_manuale: ['Segnata pagata a mano', 'ok'],
  pagata_carta: ['Pagata con carta', 'ok'],
  in_scadenzario: ['Nello scadenzario', 'neutral'],
  chiusa: ['Chiusa in contabilità', 'neutral'],
  autofattura: ['Autofattura (solo IVA)', 'neutral'],
}
const TIPI = { TD01: 'Fattura', TD02: 'Acconto', TD04: 'Nota di credito', TD06: 'Parcella', TD24: 'Differita',
  TD16: 'Autofattura', TD17: 'Autofattura servizi esteri', TD18: 'Autofattura beni UE', TD19: 'Autofattura beni' }
const STATI_AZIONI = ['da_registrare', 'da_confermare']

function BadgeStato({ stato }) {
  const [nome, tono] = STATI[stato] || [stato, 'neutral']
  return <Badge tono={tono}>{nome}</Badge>
}

const annoAlberghieroOggi = () => { const d = new Date(); return d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear() }

/** Assegna le fatture selezionate a una spesa straordinaria esistente o nuova. */
function ModaleAssegna({ ids, onChiudi, onFatto }) {
  const [spese, setSpese] = useState(null)
  const [scelta, setScelta] = useState('')
  const [modo, setModo] = useState('esistente')
  const [nuova, setNuova] = useState({ descrizione: '', anno: annoAlberghieroOggi() - 1 })
  const [lavoro, setLavoro] = useState(false)
  const avvisi = useAvvisi()
  useEffect(() => {
    api.get('/tesoreria/piani/interventi').then(r => setSpese(r.data)).catch(e => avvisi.errore(mostraErrore(e)))
  }, [avvisi])
  const corrente = annoAlberghieroOggi()
  const anni = [corrente + 1, corrente, corrente - 1, corrente - 2]

  async function assegna() {
    setLavoro(true)
    try {
      let id = scelta
      if (modo === 'nuova') {
        id = (await api.post('/tesoreria/piani/interventi', { descrizione: nuova.descrizione.trim(), anno: Number(nuova.anno), stato: 'pagato' })).data.id
      }
      const r = await api.post(`/tesoreria/piani/interventi/${id}/fatture-sdi`, { fattura_ids: ids })
      avvisi.successo(`Assegnate a «${r.data.spesa.descrizione}»: ${r.data.n_nuove} rate collegate` +
        `${r.data.n_spostate ? `, ${r.data.n_spostate} spostate da un'altra spesa` : ''}${r.data.n_gia ? `, ${r.data.n_gia} già presenti` : ''}. ` +
        'Controlla come e quando sono state pagate in Admin → Spese straordinarie.')
      r.data.saltate.forEach(t => avvisi.attenzione(t))
      onFatto()
    } catch (e) { avvisi.errore(mostraErrore(e)); setLavoro(false) }
  }
  const valido = modo === 'nuova' ? nuova.descrizione.trim() : scelta
  const perAnno = {}
  ;(spese || []).forEach(sp => { (perAnno[sp.anno || 0] = perAnno[sp.anno || 0] || []).push(sp) })
  return (
    <Modal titolo={`Assegna ${ids.length} fatture a una spesa straordinaria`} onChiudi={onChiudi} larghezza={560}
      footer={<>
        <Button variant="secondary" onClick={onChiudi}>Annulla</Button>
        <Button onClick={assegna} disabled={!valido || lavoro}>{lavoro ? 'Assegnazione…' : 'Assegna'}</Button>
      </>}>
      {!spese ? <Loading /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SegmentedControl value={modo} onChange={setModo} options={[
            { value: 'esistente', label: 'Spesa già inserita' }, { value: 'nuova', label: 'Nuova spesa (anche anni passati)' },
          ]} />
          {modo === 'esistente' && (
            <Field label="Spesa straordinaria">
              <Select value={scelta} onChange={e => setScelta(e.target.value)}>
                <option value="">—</option>
                {Object.keys(perAnno).sort((a, b) => b - a).map(a => (
                  <optgroup key={a} label={Number(a) ? etichettaAnno(Number(a), 'alberghiero') : 'Senza anno'}>
                    {perAnno[a].map(sp => <option key={sp.id} value={sp.id}>{sp.descrizione}</option>)}
                  </optgroup>
                ))}
              </Select>
            </Field>
          )}
          {modo === 'nuova' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <Field label="Descrizione" style={{ flex: 1 }}>
                <Input value={nuova.descrizione} placeholder="es. Sala da pranzo Du Parc" onChange={e => setNuova({ ...nuova, descrizione: e.target.value })} />
              </Field>
              <Field label="Anno alberghiero">
                <Select value={nuova.anno} onChange={e => setNuova({ ...nuova, anno: e.target.value })}>
                  {anni.map(a => <option key={a} value={a}>{etichettaAnno(a, 'alberghiero')}</option>)}
                </Select>
              </Field>
            </div>
          )}
          <p className="ui-text-muted" style={{ margin: 0 }}>
            Modalità e data di pagamento vengono proposte dalla fattura (o dal pagamento trovato in banca): si correggono in Admin →
            Tesoreria → Spese straordinarie → «Fatture e pagamenti». Una fattura già in un'altra spesa viene spostata; le autofatture non si assegnano.
          </p>
        </div>
      )}
    </Modal>
  )
}

function Riga({ etichetta, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 8, marginBottom: 4 }}>
      <span className="ui-text-muted">{etichetta}</span><span>{children}</span>
    </div>
  )
}

function DettaglioFattura({ id, permessi, onChiudi, onCambio }) {
  const [d, setD] = useState(null)
  const [pagate, setPagate] = useState(null)
  const [manuale, setManuale] = useState(null)
  const [vedi, setVedi] = useState(false)
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    try { setD((await api.get(`/tesoreria/fatture/${id}`)).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [id, avvisi])
  useEffect(() => { carica() }, [carica])
  const aggiornato = () => { setPagate(null); setManuale(null); carica(); onCambio() }

  async function azioneAbbinamento(a, azione) {
    try {
      await api.post(`/tesoreria/scadenzario/abbinamenti/${azione}`, { ids: [a.id] })
      avvisi.successo(azione === 'conferma' ? 'Pagamento confermato' : 'Proposta scartata')
      aggiornato()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function togliPagata() {
    if (!(await conferma({ titolo: 'Togliere "pagata a mano"?', messaggio: 'La fattura torna allo stato calcolato.' }))) return
    try {
      await api.post('/tesoreria/scadenzario/pagate-manuali/rimuovi', { chiavi: d.rate.map(r => r.chiave) })
      aggiornato()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  const rateAzioni = d ? d.rate.filter(r => r.importo > 0) : []
  return (
    <Drawer titolo={d ? d.cedente_denominazione : 'Fattura'} onChiudi={onChiudi} larghezza={900}
      sottotitolo={d ? `${TIPI[d.tipo_documento] || d.tipo_documento} n. ${d.numero} del ${formatData(d.data_documento)}` : null}>
      {!d ? <Loading /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div><Button onClick={() => setVedi(true)}>Vedi fattura{d.ha_allegati ? ' (PDF del fornitore)' : ''}</Button></div>
          {vedi && <VistaFattura id={d.id} onChiudi={() => setVedi(false)} />}
          <div>
            <Riga etichetta="Stato"><BadgeStato stato={d.stato} /></Riga>
            <Riga etichetta="Partita IVA">{d.cedente_paese || ''} {d.cedente_piva || d.cedente_cf || '—'}
              {d.codice_fornitore && <span className="ui-text-muted"> — conto Passcom {d.codice_fornitore}</span>}</Riga>
            <Riga etichetta="Ricevuta dallo SDI">{d.data_ricezione ? formatData(d.data_ricezione.slice(0, 10)) : '—'}
              {d.id_sdi && <span className="ui-text-muted"> — id SDI {d.id_sdi}</span>}</Riga>
            <Riga etichetta="Totale documento"><Importo v={d.totale} forte />
              {d.totale_calcolato && <span className="ui-text-muted"> (calcolato: il file non lo riporta)</span>}</Riga>
            {d.ritenuta != null && <Riga etichetta="Ritenuta d'acconto"><Importo v={d.ritenuta} /></Riga>}
            <Riga etichetta="Da pagare"><Importo v={d.da_pagare} /></Riga>
            {d.causale && <Riga etichetta="Causale">{d.causale}</Riga>}
            {d.fatture_collegate.length > 0 && (
              <Riga etichetta="Fatture collegate">{d.fatture_collegate.map(c => `${c.numero || '?'}${c.data ? ` del ${formatData(c.data)}` : ''}`).join(', ')}</Riga>
            )}
            {d.spesa && <Riga etichetta="Spesa straordinaria">{d.spesa.anno ? `${etichettaAnno(d.spesa.anno, 'alberghiero')} · ` : ''}{d.spesa.descrizione}</Riga>}
            <Riga etichetta="File">{d.nome_file}{d.n_ddt ? ` — ${d.n_ddt} DDT` : ''}{d.ha_allegati ? ' — con PDF allegato' : ''}</Riga>
          </div>

          {permessi.puo_modificare && (STATI_AZIONI.includes(d.stato) || d.stato === 'pagata_manuale') && (
            <div style={{ display: 'flex', gap: 8 }}>
              {STATI_AZIONI.includes(d.stato) && rateAzioni.length > 0 && <>
                <Button size="sm" onClick={() => setManuale(rateAzioni)}>Abbina a un pagamento in banca</Button>
                <Button size="sm" variant="secondary" onClick={() => setPagate(rateAzioni)}>Segna pagata a mano</Button>
              </>}
              {d.stato === 'pagata_manuale' && <Button size="sm" variant="secondary" onClick={togliPagata}>Togli pagata a mano</Button>}
            </div>
          )}

          <div>
            <div className="ui-section-title">Riepilogo IVA</div>
            <Table compact>
              <thead><tr><Th num>Aliquota</Th><Th>Natura</Th><Th num>Imponibile</Th><Th num>Imposta</Th><Th>Esigibilità</Th></tr></thead>
              <tbody>
                {d.iva.map((r, i) => (
                  <tr key={i}>
                    <Td num>{r.aliquota}%</Td><Td muted title={r.riferimento_normativo || undefined}>{r.natura || '—'}</Td>
                    <Td num><Importo v={r.imponibile} /></Td><Td num><Importo v={r.imposta} /></Td><Td muted>{r.esigibilita || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          {d.rate.length > 0 && (
            <div>
              <div className="ui-section-title">Pagamento</div>
              <Table compact>
                <thead><tr><Th>Rata</Th><Th>Scadenza</Th><Th>Modalità</Th><Th num>Importo</Th></tr></thead>
                <tbody>
                  {d.rate.map(r => {
                    const f = d.scadenze_file.find(x => x.numero_rata === r.numero_rata)
                    return (
                      <tr key={r.chiave}>
                        <Td>{r.numero_rata}</Td>
                        <Td>{formatData(r.data_scadenza)}{r.data_stimata && <span className="ui-text-muted" title="Scadenza assente nel file: data del documento più i giorni abituali del fornitore"> (stimata)</span>}</Td>
                        <Td>{f?.modalita_nome || (r.tipo_pagamento === 'NON INDICATA' ? 'Non indicata' : r.tipo_pagamento)}{f?.iban && <span className="ui-text-muted"> — {f.iban}</span>}</Td>
                        <Td num><Importo v={r.importo} /></Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </div>
          )}

          {d.passcom.length > 0 && (
            <div>
              <div className="ui-section-title">Nello scadenzario Passcom</div>
              <Table compact>
                <thead><tr><Th>Fornitore Passcom</Th><Th>Scadenza</Th><Th>Modalità</Th><Th num>Importo</Th></tr></thead>
                <tbody>
                  {d.passcom.map(p => (
                    <tr key={p.chiave}>
                      <Td>{p.fornitore} <span className="ui-text-muted">({p.codice_fornitore})</span></Td>
                      <Td>{formatData(p.data_scadenza)}</Td><Td>{p.tipo_pagamento}</Td><Td num><Importo v={p.importo} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="ui-text-muted" style={{ marginTop: 4 }}>La segue la scheda Scadenzario (pagamenti, da segnalare allo studio).</p>
            </div>
          )}

          {d.abbinamenti.length > 0 && (
            <div>
              <div className="ui-section-title">Pagamenti in banca</div>
              <Table compact>
                <thead><tr><Th>Data</Th><Th>Controparte</Th><Th num>Importo</Th><Th>Abbinamento</Th><Th></Th></tr></thead>
                <tbody>
                  {d.abbinamenti.flatMap(a => a.movimenti.map(m => (
                    <tr key={`${a.id}-${m.id}`}>
                      <Td>{formatData(m.data_contabile)}</Td><Td>{m.controparte || m.causale || '—'}</Td>
                      <Td num><Importo v={m.importo} /></Td>
                      <Td><Badge tono={a.stato === 'proposto' ? 'info' : a.stato === 'scartato' ? 'neutral' : 'ok'}>{a.stato}</Badge>
                        {a.nota && <span className="ui-text-muted"> {a.nota}</span>}</Td>
                      <Td style={{ whiteSpace: 'nowrap' }}>
                        {permessi.puo_modificare && ['proposto', 'automatico'].includes(a.stato) && <>
                          <Button size="sm" variant="ghost" onClick={() => azioneAbbinamento(a, 'conferma')}>Conferma</Button>
                          <Button size="sm" variant="danger-soft" onClick={() => azioneAbbinamento(a, 'scarta')}>Scarta</Button>
                        </>}
                      </Td>
                    </tr>
                  )))}
                </tbody>
              </Table>
            </div>
          )}
        </div>
      )}
      {pagate && <ModalePagate righe={pagate} onChiudi={() => setPagate(null)} onFatto={aggiornato} />}
      {manuale && <ModaleManuale scadenze={manuale} onChiudi={() => setManuale(null)} onFatto={aggiornato} />}
    </Drawer>
  )
}

export default function TabFatture({ permessi, onVaiA }) {
  const [filtri, setFiltri] = useState({ stato: '', tipo: '', ricevuta_da: '', ricevuta_a: '', spesa: '' })
  const [scelte, setScelte] = useState(new Set())
  const [assegna, setAssegna] = useState(false)
  const [testo, setTesto] = useState('')
  const [q, setQ] = useState('')
  const [ordine, setOrdine] = useState({ per: 'data_ricezione', direzione: 'desc' })
  const [pagina, setPagina] = useState(1)
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const [aperta, setAperta] = useState(null)
  const ultimaRichiesta = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => { setQ(testo); setPagina(1) }, 400)
    return () => clearTimeout(t)
  }, [testo])

  const carica = useCallback(async () => {
    const params = { pagina, per_pagina: PER_PAGINA, ordina_per: ordine.per, direzione: ordine.direzione }
    Object.entries(filtri).forEach(([k, v]) => { if (v) params[k] = v })
    if (q) params.q = q
    const richiesta = ++ultimaRichiesta.current
    try {
      setErrore(null)
      const r = await api.get('/tesoreria/fatture', { params })
      if (richiesta === ultimaRichiesta.current) setDati(r.data)
    } catch (e) { if (richiesta === ultimaRichiesta.current) setErrore(mostraErrore(e)) }
  }, [filtri, q, ordine, pagina])
  useEffect(() => { carica() }, [carica])

  const setFiltro = patch => { setFiltri(f => ({ ...f, ...patch })); setPagina(1) }
  const ordina = campo => {
    setOrdine(o => ({ per: campo, direzione: o.per === campo && o.direzione === 'desc' ? 'asc' : 'desc' }))
    setPagina(1)
  }
  const c = dati?.conteggi || {}
  const n = s => c[s]?.n || 0
  const imp = s => c[s]?.importo || 0
  const pagate = ['pagata_banca', 'pagata_manuale', 'pagata_carta']
  const vuoto = dati && Object.keys(c).length === 0
  const puoAssegnare = permessi.puo_modificare
  const assegnabili = (dati?.fatture || []).filter(f => f.stato !== 'autofattura')
  const cambiaScelta = (id, si) => setScelte(x => { const n = new Set(x); if (si) n.add(id); else n.delete(id); return n })
  const tuttePagina = assegnabili.length > 0 && assegnabili.every(f => scelte.has(f.id))
  const cambiaPagina = si => setScelte(x => { const n = new Set(x); assegnabili.forEach(f => (si ? n.add(f.id) : n.delete(f.id))); return n })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Messaggio>{errore}</Messaggio>
      {vuoto ? (
        <StatoVuoto>
          Nessuna fattura caricata. Gli ZIP scaricati dal portale dell'Agenzia delle Entrate si caricano in
          {' '}<Button size="sm" variant="ghost" onClick={() => onVaiA('import')}>Import e saldi</Button>.
        </StatoVuoto>
      ) : !dati ? <Loading /> : (
        <>
          <div className="ui-kpi-row">
            <KpiTile label="Da registrare" value={formatN(n('da_registrare'))} sub={formatEuro(imp('da_registrare'))} />
            <KpiTile label="Pagamento da confermare" value={formatN(n('da_confermare'))} sub={formatEuro(imp('da_confermare'))} />
            <KpiTile label="Pagate (banca, a mano, carta)" value={formatN(pagate.reduce((s, x) => s + n(x), 0))}
              sub={formatEuro(pagate.reduce((s, x) => s + imp(x), 0))} />
            <KpiTile label="Nello scadenzario Passcom" value={formatN(n('in_scadenzario'))} sub={formatEuro(imp('in_scadenzario'))} />
            <KpiTile label="Chiuse / autofatture" value={`${formatN(n('chiusa'))} / ${formatN(n('autofattura'))}`} />
          </div>
          <p className="ui-text-muted">
            {dati.data_fotografia
              ? <>Scadenzario Passcom del {formatData(dati.data_fotografia)}, ultima registrazione dello studio il
                {' '}{formatData(dati.ultima_registrazione)}: sono <b>da registrare</b> le fatture ricevute dal
                {' '}{formatData(dati.limite_da_registrare)} che non sono nello scadenzario né pagate. Entrano nella previsione
                di cassa alla loro scadenza; le più vecchie assenti da Passcom risultano chiuse.</>
              : 'Nessuno scadenzario Passcom caricato: non si può dire quali fatture siano da registrare.'}
          </p>
        </>
      )}

      {!vuoto && (
        <Card title="Fatture ricevute" actions={<ExportMenu nome="fatture_da_registrare" url="/tesoreria/fatture/da-registrare/export" />}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
            <Field label="Cerca"><Input value={testo} placeholder="Fornitore, P.IVA, numero, importo…" style={{ width: 240 }}
              onChange={e => setTesto(e.target.value)} /></Field>
            <Field label="Stato">
              <Select value={filtri.stato} onChange={e => setFiltro({ stato: e.target.value })}>
                <option value="">Tutti</option>
                {Object.entries(STATI).map(([k, [nome]]) => <option key={k} value={k}>{nome}</option>)}
              </Select>
            </Field>
            <Field label="Tipo">
              <Select value={filtri.tipo} onChange={e => setFiltro({ tipo: e.target.value })}>
                <option value="">Tutti</option>
                {Object.entries(TIPI).map(([k, nome]) => <option key={k} value={k}>{k} {nome}</option>)}
              </Select>
            </Field>
            <Field label="Ricevute dal"><Input type="date" value={filtri.ricevuta_da} onChange={e => setFiltro({ ricevuta_da: e.target.value })} /></Field>
            <Field label="al"><Input type="date" value={filtri.ricevuta_a} onChange={e => setFiltro({ ricevuta_a: e.target.value })} /></Field>
            <Field label="Spesa straordinaria">
              <Select value={filtri.spesa} onChange={e => setFiltro({ spesa: e.target.value })}>
                <option value="">Tutte</option><option value="si">Assegnate</option><option value="no">Non assegnate</option>
              </Select>
            </Field>
            {puoAssegnare && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Button onClick={() => setAssegna(true)} disabled={!scelte.size}>Assegna a spesa straordinaria ({scelte.size})</Button>
                {scelte.size > 0 && <Button variant="ghost" onClick={() => setScelte(new Set())}>Deseleziona</Button>}
              </div>
            )}
          </div>
          {!dati ? <Loading /> : dati.fatture.length === 0 ? <StatoVuoto>Nessuna fattura con questi filtri.</StatoVuoto> : (
            <>
              <Table compact maxHeight="60vh">
                <thead>
                  <tr>
                    {puoAssegnare && <Th><Checkbox checked={tuttePagina} onChange={cambiaPagina} /></Th>}
                    <ThOrdinabile campo="data_ricezione" ordinaPer={ordine.per} direzione={ordine.direzione} onOrdina={ordina}>Ricevuta</ThOrdinabile>
                    <ThOrdinabile campo="fornitore" ordinaPer={ordine.per} direzione={ordine.direzione} onOrdina={ordina}>Fornitore</ThOrdinabile>
                    <Th>Documento</Th>
                    <ThOrdinabile campo="data_documento" ordinaPer={ordine.per} direzione={ordine.direzione} onOrdina={ordina}>Data doc.</ThOrdinabile>
                    <ThOrdinabile campo="totale" num ordinaPer={ordine.per} direzione={ordine.direzione} onOrdina={ordina}>Totale</ThOrdinabile>
                    <Th num>Da pagare</Th><Th>Scadenza</Th><Th>Stato</Th>
                  </tr>
                </thead>
                <tbody>
                  {dati.fatture.map(f => (
                    <tr key={f.id} onClick={() => setAperta(f.id)} style={{ cursor: 'pointer' }}
                      className={f.stato === 'da_registrare' ? 'ui-riga-avviso' : undefined}>
                      {puoAssegnare && (
                        <Td onClick={e => e.stopPropagation()}>
                          {f.stato !== 'autofattura' && <Checkbox checked={scelte.has(f.id)} onChange={x => cambiaScelta(f.id, x)} />}
                        </Td>
                      )}
                      <Td>{f.data_ricezione ? formatData(f.data_ricezione.slice(0, 10)) : '—'}</Td>
                      <Td>{f.cedente_denominazione}
                        {f.spesa && <div><Badge tono="info" title="Spesa straordinaria">{f.spesa.descrizione}</Badge></div>}</Td>
                      <Td><span title={TIPI[f.tipo_documento]}>{f.tipo_documento}</span> {f.numero}</Td>
                      <Td>{formatData(f.data_documento)}</Td>
                      <Td num><Importo v={f.totale} /></Td>
                      <Td num>{f.stato === 'autofattura' ? '—' : <Importo v={f.da_pagare} />}</Td>
                      <Td>{f.prima_scadenza ? formatData(f.prima_scadenza) : '—'}</Td>
                      <Td><BadgeStato stato={f.stato} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Paginazione pagina={pagina} perPagina={PER_PAGINA} totale={dati.totale} onChange={setPagina} estremi />
            </>
          )}
        </Card>
      )}
      {assegna && <ModaleAssegna ids={[...scelte]} onChiudi={() => setAssegna(false)}
        onFatto={() => { setAssegna(false); setScelte(new Set()); carica() }} />}
      {aperta && <DettaglioFattura id={aperta} permessi={permessi} onChiudi={() => setAperta(null)} onCambio={carica} />}
    </div>
  )
}
