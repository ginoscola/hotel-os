// Impegni: tutte le uscite future note (fisco, affitti, mutuo, ricorrenti, interventi, estratti carte). Conferma di importi
// e date, voci a mano, abbinamenti proposti con la banca, credito IVA, avviso TARI.
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../api/client.js'
import { formatData, formatEuro, mostraErrore } from '../../utils/format.js'
import {
  Badge, Button, Card, Checkbox, Field, FileButton, Input, KpiTile, Loading, Messaggio, Modal, Select, StatoVuoto, Table, Td, Th,
  useAvvisi,
} from '../../components/ui'
import CardIva from './CardIva.jsx'
import { oggiISO } from './helpers.jsx'

const ETICHETTE_TIPO = {
  f24_dipendenti: 'F24 dipendenti', iva: 'IVA', ires: 'IRES', irap: 'IRAP', tassa_soggiorno: 'Tassa di soggiorno', tari: 'TARI',
  tributo_fisso: 'Tributi fissi', affitto: 'Affitti', mutuo: 'Mutuo', ricorrente: 'Ricorrenti', intervento: 'Interventi', compenso: 'Compensi soci', advertising: 'Advertising (carta)', carta: 'Estratti carte', altro: 'Altro',
}
const GIORNI_CREDITO_VECCHIO = 40   // residuo del credito IVA dal gestionale: aggiornato ogni mese

function giorniDa(iso) {
  if (!iso) return null
  const [a, m, g] = iso.split('-').map(Number)
  const oggi = new Date()
  return Math.round((new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate()) - new Date(a, m - 1, g)) / 86400000)
}

const STATI = {
  stimato: ['Stimato', 'neutral'], confermato: ['Confermato', 'info'], pagato: ['Pagato', 'ok'], coperto: ['Coperto da crediti', 'ok'],
}

function ModaleModifica({ impegno, onChiudi, onSalvato }) {
  const [importo, setImporto] = useState(impegno.importo_confermato ?? '')
  const [data, setData] = useState(impegno.data_scadenza)
  const [nota, setNota] = useState(impegno.nota || '')
  const [senzaCredito, setSenzaCredito] = useState(impegno.senza_credito)
  const avvisi = useAvvisi()

  async function salva(extra = {}) {
    const corpo = { nota, ...extra }
    if (impegno.compensabile && senzaCredito !== impegno.senza_credito) corpo.senza_credito = senzaCredito
    if (!extra.togli_conferma && importo !== '') corpo.importo_confermato = String(importo).replace(',', '.')
    if (!extra.ripristina_data && data !== impegno.data_scadenza) corpo.data_scadenza = data
    try { await api.put(`/tesoreria/impegni/${impegno.id}`, corpo); onSalvato() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  return (
    <Modal titolo={impegno.descrizione} onChiudi={onChiudi} footer={<>
      <Button variant="ghost" onClick={onChiudi}>Annulla</Button>
      <Button onClick={() => salva()}>Salva</Button>
    </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="ui-text-muted">Stima: {formatEuro(impegno.importo_stimato)}{impegno.base_stima ? ` — ${impegno.base_stima}` : ''}</p>
        <Field label="Importo confermato (€), vince sulla stima">
          <Input value={importo} inputMode="decimal" onChange={e => setImporto(e.target.value)} />
        </Field>
        {impegno.importo_confermato != null && impegno.fonte !== 'manuale' && (
          <div><Button size="sm" variant="secondary" onClick={() => salva({ togli_conferma: true })}>Torna alla stima</Button></div>
        )}
        <Field label="Scadenza"><Input type="date" value={data} onChange={e => setData(e.target.value)} /></Field>
        {impegno.data_manuale && impegno.fonte !== 'manuale' && (
          <div><Button size="sm" variant="secondary" onClick={() => salva({ ripristina_data: true })}>Torna alla data prevista</Button></div>
        )}
        {impegno.compensabile && (
          <div>
            <Checkbox label="Pagare senza usare il credito IVA" checked={senzaCredito} onChange={setSenzaCredito} />
            <p className="ui-text-muted" style={{ marginTop: 4 }}>
              Se lo studio paga questo F24 e tiene il credito per dopo: l'importo resta da pagare e il credito passa agli F24
              successivi. Gli altri crediti stimati (rimborsi e conguagli dei dipendenti) restano.
            </p>
          </div>
        )}
        <Field label="Nota"><Input value={nota} onChange={e => setNota(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function ModaleNuovo({ onChiudi, onSalvato }) {
  const [v, setV] = useState({ descrizione: '', data_scadenza: '', importo: '', compensabile: false })
  const avvisi = useAvvisi()
  async function salva() {
    try {
      await api.post('/tesoreria/impegni', { ...v, importo: String(v.importo).replace(',', '.') })
      onSalvato()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  return (
    <Modal titolo="Nuovo impegno" onChiudi={onChiudi} footer={<>
      <Button variant="ghost" onClick={onChiudi}>Annulla</Button>
      <Button onClick={salva} disabled={!v.descrizione.trim() || !v.data_scadenza || !v.importo}>Aggiungi</Button>
    </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Descrizione"><Input value={v.descrizione} onChange={e => setV({ ...v, descrizione: e.target.value })} /></Field>
        <Field label="Scadenza"><Input type="date" value={v.data_scadenza} onChange={e => setV({ ...v, data_scadenza: e.target.value })} /></Field>
        <Field label="Importo (€)"><Input value={v.importo} inputMode="decimal" onChange={e => setV({ ...v, importo: e.target.value })} /></Field>
        <Checkbox label="Si paga con F24 (compensabile con il credito IVA)" checked={v.compensabile} onChange={x => setV({ ...v, compensabile: x })} />
      </div>
    </Modal>
  )
}

function ModaleTari({ anteprima, onChiudi, onSalvato }) {
  const [fase, setFase] = useState(anteprima.fase)
  const avvisi = useAvvisi()
  async function conferma() {
    try {
      await api.post('/tesoreria/impegni/tari/conferma', { token: anteprima.token, fase })
      avvisi.successo('Avviso TARI registrato'); onSalvato()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  return (
    <Modal titolo={`Avviso TARI n. ${anteprima.numero} del ${formatData(anteprima.data_avviso)}`} onChiudi={onChiudi} footer={<>
      <Button variant="ghost" onClick={onChiudi}>Annulla</Button>
      <Button onClick={conferma}>Conferma</Button>
    </>}>
      <p>Anno {anteprima.anno}, totale {formatEuro(anteprima.totale)}.</p>
      <Field label="Fase">
        <Select value={fase} onChange={e => setFase(e.target.value)}>
          <option value="acconto">Acconto</option><option value="conguaglio">Conguaglio</option>
        </Select>
      </Field>
      <Table compact>
        <thead><tr><Th>Rata</Th><Th>Scadenza</Th><Th num>Importo</Th></tr></thead>
        <tbody>{anteprima.rate.map(r => <tr key={r.numero}><Td>{r.numero}</Td><Td>{formatData(r.scadenza)}</Td><Td num>{formatEuro(r.importo)}</Td></tr>)}</tbody>
      </Table>
      <p className="ui-text-muted" style={{ marginTop: 8 }}>Sostituisce la stima della stessa fase.</p>
    </Modal>
  )
}

export default function TabImpegni({ permessi }) {
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const [dal, setDal] = useState(oggiISO())
  const [al, setAl] = useState('')
  const [tipo, setTipo] = useState('')
  const [soloDaPagare, setSoloDaPagare] = useState(false)
  const [modifica, setModifica] = useState(null)
  const [nuovo, setNuovo] = useState(false)
  const [tari, setTari] = useState(null)
  const avvisi = useAvvisi()

  const carica = useCallback(async () => {
    const q = new URLSearchParams()
    if (dal) q.set('data_da', dal)
    if (al) q.set('data_a', al)
    if (tipo) q.set('tipo', tipo)
    try { setDati((await api.get(`/tesoreria/impegni?${q}`)).data); setErrore(null) } catch (e) { setErrore(mostraErrore(e)) }
  }, [dal, al, tipo])
  useEffect(() => { carica() }, [carica])

  const righe = useMemo(() => (dati?.impegni || []).filter(i => !soloDaPagare || (i.da_pagare > 0 && i.stato !== 'pagato')), [dati, soloDaPagare])
  const daConfermare = (dati?.impegni || []).filter(i => i.abbinamento === 'proposto')

  async function aggiorna() {
    try {
      const r = (await api.post('/tesoreria/impegni/genera')).data
      avvisi.successo(`Calendario aggiornato: ${r.n_nuovi + r.piani.n_nuovi} nuove, ${r.abbinamenti.automatici} chiuse dalla banca`)
      carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  async function abbinamento(i, azione) {
    try { await api.post(`/tesoreria/impegni/${i.id}/abbinamento`, { azione }); carica() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  async function elimina(i) {
    try { await api.delete(`/tesoreria/impegni/${i.id}`); carica() } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  async function caricaTari(file) {
    const fd = new FormData()
    fd.append('file', file)
    try { setTari((await api.post('/tesoreria/impegni/tari/anteprima', fd)).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Messaggio>{errore}</Messaggio>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label="Dal"><Input type="date" value={dal} onChange={e => setDal(e.target.value)} /></Field>
        <Field label="Al"><Input type="date" value={al} onChange={e => setAl(e.target.value)} /></Field>
        <Field label="Tipo">
          <Select value={tipo} onChange={e => setTipo(e.target.value)}>
            <option value="">Tutti</option>
            {Object.entries(ETICHETTE_TIPO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Checkbox label="Solo con importo da pagare" checked={soloDaPagare} onChange={setSoloDaPagare} />
        {permessi?.puo_modificare && <>
          <Button variant="secondary" onClick={aggiorna}>Aggiorna calendario</Button>
          <Button variant="secondary" onClick={() => setNuovo(true)}>Nuovo impegno</Button>
        </>}
        {permessi?.puo_importare && <FileButton accept=".pdf" onFile={caricaTari}>Carica avviso TARI</FileButton>}
      </div>

      {!dati ? (!errore && <Loading />) : <>
        <div className="ui-kpi-row">
          <KpiTile size="lg" label="Da pagare in banca" value={formatEuro(dati.da_pagare)} sub={`${dati.impegni.length} impegni nel periodo`} />
          <KpiTile label="Importo totale" value={formatEuro(dati.totale)} />
          <KpiTile label="Coperto dal credito IVA" value={formatEuro(dati.coperto_credito)}
            sub={`crediti previsti ${formatEuro(dati.credito_iva_previsto)} · ${dati.credito_iva_aggiornato_al ? `aggiornato al ${formatData(dati.credito_iva_aggiornato_al)}` : 'mai aggiornato'}`} />
          <KpiTile label="Coperto da altri crediti F24" value={formatEuro(dati.coperto_altri)} sub="stima dall'anno prima" />
        </div>

        {(giorniDa(dati.credito_iva_aggiornato_al) ?? Infinity) > GIORNI_CREDITO_VECCHIO && (
          <Messaggio tipo="warn">
            Credito IVA {dati.credito_iva_aggiornato_al ? `aggiornato l'ultima volta il ${formatData(dati.credito_iva_aggiornato_al)}` : 'mai aggiornato'}:
            {' '}inserire il residuo dal gestionale in Admin → Tesoreria → Dati fiscali, altrimenti la copertura degli F24 è una stima.
          </Messaggio>
        )}

        {daConfermare.length > 0 && (
          <Messaggio tipo="warn">{daConfermare.length} impegni hanno un pagamento in banca da confermare: usa Conferma o Scarta nella tabella.</Messaggio>
        )}

        <Card title="Impegni">
          {righe.length === 0 ? <StatoVuoto>Nessun impegno nel periodo.</StatoVuoto> : (
            <Table compact maxHeight="70vh">
              <thead>
                <tr>
                  <Th>Scadenza</Th><Th>Voce</Th><Th>Tipo</Th><Th num>Importo</Th><Th num>Coperto</Th><Th num>Da pagare</Th><Th>Stato</Th><Th>Calcolo</Th><Th></Th>
                </tr>
              </thead>
              <tbody>
                {righe.map(i => {
                  const [nome, tono] = STATI[i.stato_vista] || [i.stato_vista, 'neutral']
                  return (
                    <tr key={i.id} className={i.data_manuale || i.importo_confermato != null ? 'ui-riga-modificata' : undefined}>
                      <Td>{formatData(i.data_scadenza)}</Td>
                      <Td>{i.descrizione}</Td>
                      <Td>{ETICHETTE_TIPO[i.tipo] || i.tipo}</Td>
                      <Td num>{formatEuro(i.importo)}</Td>
                      <Td num>{i.coperto_credito + i.coperto_altri > 0 ? formatEuro(i.coperto_credito + i.coperto_altri) : '—'}</Td>
                      <Td num tot>{formatEuro(i.stato === 'pagato' ? 0 : i.da_pagare)}</Td>
                      <Td>
                        <Badge tono={tono}>{nome}</Badge>
                        {i.senza_credito && <> <Badge tono="neutral" title="Pagato senza usare il credito IVA">senza credito</Badge></>}
                      </Td>
                      <Td><span className="ui-text-muted">{i.base_stima || ''}</span></Td>
                      <Td style={{ whiteSpace: 'nowrap' }}>
                        {permessi?.puo_modificare && <>
                          {i.abbinamento === 'proposto' && <>
                            <Button size="sm" onClick={() => abbinamento(i, 'conferma')}>Conferma</Button>{' '}
                            <Button size="sm" variant="ghost" onClick={() => abbinamento(i, 'scarta')}>Scarta</Button>{' '}
                          </>}
                          {['automatico', 'confermato'].includes(i.abbinamento) && <Button size="sm" variant="ghost" onClick={() => abbinamento(i, 'annulla')}>Annulla abbinamento</Button>}
                          {i.stato !== 'pagato' && <Button size="sm" variant="secondary" onClick={() => setModifica(i)}>Modifica</Button>}{' '}
                          {i.fonte === 'manuale' && i.stato !== 'pagato' && <Button size="sm" variant="danger-soft" onClick={() => elimina(i)}>Elimina</Button>}
                        </>}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </>}

      <CardIva />

      {modifica && <ModaleModifica impegno={modifica} onChiudi={() => setModifica(null)} onSalvato={() => { setModifica(null); carica() }} />}
      {nuovo && <ModaleNuovo onChiudi={() => setNuovo(false)} onSalvato={() => { setNuovo(false); carica() }} />}
      {tari && <ModaleTari anteprima={tari} onChiudi={() => setTari(null)} onSalvato={() => { setTari(null); carica() }} />}
    </div>
  )
}
