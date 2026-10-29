// Scadenzario fornitori (Fase 2): ultima fotografia Passcom incrociata con la banca. I pareggi di Passcom
// (pagamenti registrati dallo studio senza collegarli alle fatture) coprono prima le pagate, poi le aperte
// più vecchie: ogni riga ha `aperto` (da pagare) e `da_segnalare` (pagata ma non registrata). Viste: per settimana
// (con selezione multipla e "Segna pagate"), abbinamenti da confermare, da segnalare allo studio (pagate in
// banca o a mano ma ancora aperte in Passcom, con export), per fornitore (dettaglio con pagamenti in banca e
// abbinamento manuale), residui degli anni precedenti.
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../api/client.js'
import { ExportMenu } from '../../components/ExportMenu.jsx'
import { colors } from '../../styles/tokens.js'
import { formatData, formatEuro, formatN, mostraErrore } from '../../utils/format.js'
import {
  Badge, Button, Card, Drawer, Field, Input, KpiTile, Loading, Messaggio, Modal, SegmentedControl, Select, StatoVuoto,
  Table, Td, Th, useAvvisi, useConferma,
} from '../../components/ui'
import { Importo, isoLocale, oggiISO, queryString } from './helpers.jsx'

const LS_VISTA = 'tesoreria_scadenzario_vista'

export const STATI_SCADENZA = {
  aperta: { label: 'aperta', tono: 'neutral' },
  scaduta: { label: 'scaduta', tono: 'err' },
  da_confermare: { label: 'da confermare', tono: 'warn' },
  pagata_banca: { label: 'pagata in banca', tono: 'ok' },
  pagata_manuale: { label: 'pagata a mano', tono: 'ok' },
  compensata: { label: 'chiusa da pareggio', tono: 'info' },
  residuo: { label: 'residuo', tono: 'neutral' },
  pareggio: { label: 'pareggio', tono: 'info' },
}

const ETICHETTE_REGOLA = {
  riba: 'Ri.Ba.', riba_somma: 'Ri.Ba. (somma)', sdd: 'Addebito diretto', bonifico: 'Bonifico',
  bonifico_somma: 'Bonifico (più fatture)', assegno: 'Assegno', altra_modalita: 'Altra modalità', manuale: 'A mano',
}

const VISTE = [
  { value: 'settimane', label: 'Per settimana' },
  { value: 'confermare', label: 'Da confermare' },
  { value: 'segnalare', label: 'Da segnalare allo studio' },
  { value: 'fornitori', label: 'Per fornitore' },
  { value: 'residui', label: 'Residui' },
]

export function BadgeStato({ stato }) {
  const s = STATI_SCADENZA[stato] || { label: stato, tono: 'neutral' }
  return <Badge tono={s.tono}>{s.label}</Badge>
}

/** Lunedì della settimana della data ISO (le scadenze si raggruppano per settimana lun–dom). */
function lunedi(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const g = new Date(y, m - 1, d)
  g.setDate(g.getDate() - ((g.getDay() + 6) % 7))
  return isoLocale(g)
}

function documento(r) {
  return `${r.tipo_documento || ''} ${r.numero_documento || ''}`.trim() || '—'
}

// ── Segna pagate a mano ──────────────────────────────────────────────────────

function ModalePagate({ righe, onChiudi, onFatto }) {
  const [data, setData] = useState(oggiISO())
  const [nota, setNota] = useState('')
  const [lavoro, setLavoro] = useState(false)
  const avvisi = useAvvisi()
  const totale = righe.reduce((s, r) => s + (r.aperto || r.importo), 0)

  async function salva() {
    setLavoro(true)
    try {
      const r = await api.post('/tesoreria/scadenzario/pagate-manuali',
        { chiavi: righe.map(x => x.chiave), data_pagamento: data || null, nota: nota || null })
      avvisi.successo(`${r.data.segnate} scadenze segnate pagate`)
      onFatto()
    } catch (e) { avvisi.errore(mostraErrore(e)); setLavoro(false) }
  }

  return (
    <Modal titolo={`Segna pagate ${righe.length} scadenze`} onChiudi={onChiudi} larghezza={520}
      footer={<>
        <Button variant="secondary" onClick={onChiudi}>Annulla</Button>
        <Button onClick={salva} disabled={lavoro}>Segna pagate</Button>
      </>}>
      <p style={{ marginBottom: 12 }}>
        Totale {formatEuro(totale)}. Per pagamenti che non passano dal conto corrente (contanti, carta,
        compensazioni): restano segnate anche nei prossimi scadenzari, finché lo studio non le chiude.
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <Field label="Pagate il (facoltativo)"><Input type="date" value={data} onChange={e => setData(e.target.value)} /></Field>
        <Field label="Nota" style={{ flex: 1 }}><Input value={nota} placeholder="es. contanti" onChange={e => setNota(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

// ── Tabella scadenze con selezione ───────────────────────────────────────────

function TabellaScadenze({ righe, selezione, onSeleziona, mostraFornitore = true, onFornitore, maxHeight }) {
  const selezionabile = r => onSeleziona && ['aperta', 'scaduta', 'da_confermare', 'residuo'].includes(r.stato)
  return (
    <Table compact maxHeight={maxHeight}>
      <thead>
        <tr>
          {onSeleziona && <Th></Th>}
          <Th>Scadenza</Th>{mostraFornitore && <Th>Fornitore</Th>}<Th>Documento</Th><Th>Data doc.</Th>
          <Th>Modalità</Th><Th num>Importo</Th><Th num>Da pagare</Th><Th>Stato</Th><Th>Pagata</Th>
        </tr>
      </thead>
      <tbody>
        {righe.map(r => (
          <tr key={r.chiave} className={r.stato === 'scaduta' ? 'ui-riga-errore'
            : ['pagata_banca', 'pagata_manuale'].includes(r.stato) ? 'ui-riga-ok'
              : ['compensata', 'pareggio', 'residuo'].includes(r.stato) ? 'ui-riga-attenuata' : undefined}>
            {onSeleziona && (
              <Td>{selezionabile(r) && (
                <input type="checkbox" checked={selezione.has(r.chiave)} aria-label="Seleziona"
                  onChange={e => onSeleziona(r.chiave, e.target.checked)} />
              )}</Td>
            )}
            <Td style={{ whiteSpace: 'nowrap' }}>{formatData(r.data_scadenza)}</Td>
            {mostraFornitore && (
              <Td>{onFornitore
                ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => onFornitore(r.codice_fornitore)}>{r.fornitore}</button>
                : r.fornitore}</Td>
            )}
            <Td title={r.descrizione || undefined}>{documento(r)}</Td>
            <Td muted>{formatData(r.data_documento)}</Td>
            <Td muted>{r.tipo_pagamento}</Td>
            <Td num><Importo v={r.importo} /></Td>
            <Td num title={r.compensato ? `${formatEuro(r.compensato)} coperti dai pareggi di Passcom` : undefined}>
              {['aperta', 'scaduta', 'da_confermare', 'residuo'].includes(r.stato) ? <Importo v={r.aperto} /> : '—'}
            </Td>
            <Td><BadgeStato stato={r.stato} /></Td>
            <Td muted style={{ whiteSpace: 'nowrap' }}>
              {r.data_pagamento ? `${formatData(r.data_pagamento)} · ${r.pagata_come}` : r.pagata_come || ''}
              {r.nota_manuale ? ` (${r.nota_manuale})` : ''}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

function useSelezione() {
  const [sel, setSel] = useState(() => new Set())
  const imposta = (chiave, on) => setSel(prev => {
    const n = new Set(prev)
    if (on) n.add(chiave)
    else n.delete(chiave)
    return n
  })
  return { sel, imposta, svuota: () => setSel(new Set()), tutte: chiavi => setSel(new Set(chiavi)) }
}

// ── Viste ────────────────────────────────────────────────────────────────────

function VistaSettimane({ dati, permessi, onCambio, onFornitore }) {
  const [soloDaPagare, setSoloDaPagare] = useState(true)
  const [pagate, setPagate] = useState(null)
  const { sel, imposta, svuota } = useSelezione()
  const righe = dati.scadenze.filter(r => soloDaPagare
    ? ['aperta', 'scaduta', 'da_confermare'].includes(r.stato)
    : !['pareggio', 'residuo'].includes(r.stato))
  const settimane = useMemo(() => {
    const g = new Map()
    for (const r of [...righe].sort((a, b) => a.data_scadenza.localeCompare(b.data_scadenza))) {
      const k = r.stato === 'scaduta' ? 'scadute' : lunedi(r.data_scadenza)
      if (!g.has(k)) g.set(k, [])
      g.get(k).push(r)
    }
    return [...g.entries()]
  }, [righe])
  const selezionate = dati.scadenze.filter(r => sel.has(r.chiave))

  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <SegmentedControl value={soloDaPagare} onChange={setSoloDaPagare}
          options={[{ value: true, label: 'Da pagare' }, { value: false, label: 'Tutte, anche pagate' }]} />
        {permessi.puo_modificare && (
          <>
            <span className="ui-text-muted">{sel.size} selezionate</span>
            <Button size="sm" disabled={!sel.size} onClick={() => setPagate(selezionate)}>Segna pagate</Button>
            {sel.size > 0 && <Button size="sm" variant="ghost" onClick={svuota}>Togli selezione</Button>}
          </>
        )}
      </div>
      {settimane.length === 0 ? <StatoVuoto>Nessuna scadenza da pagare.</StatoVuoto> : settimane.map(([k, rr]) => {
        const totale = rr.reduce((s, r) => s + (r.aperto || 0), 0)
        const fine = k === 'scadute' ? null : (() => {
          const [y, m, d] = k.split('-').map(Number)
          return isoLocale(new Date(y, m - 1, d + 6))
        })()
        return (
          <Card key={k} style={{ marginBottom: 12 }}
            title={k === 'scadute' ? `Scadute e non pagate — ${formatEuro(totale)}`
              : `Settimana ${formatData(k)} – ${formatData(fine)} — ${formatEuro(totale)}`}
            actions={permessi.puo_modificare && (
              <Button size="sm" variant="ghost" onClick={() => rr.filter(r => ['aperta', 'scaduta', 'da_confermare'].includes(r.stato))
                .forEach(r => imposta(r.chiave, true))}>Seleziona tutte</Button>
            )}>
            <TabellaScadenze righe={rr} selezione={sel} onFornitore={onFornitore}
              onSeleziona={permessi.puo_modificare ? imposta : null} />
          </Card>
        )
      })}
      {pagate && <ModalePagate righe={pagate} onChiudi={() => setPagate(null)}
        onFatto={() => { setPagate(null); svuota(); onCambio() }} />}
    </>
  )
}

function CardAbbinamento({ a, selezionato, onSeleziona, permessi, onConferma, onScarta, onAnnulla }) {
  const daDecidere = ['automatico', 'proposto'].includes(a.stato)
  return (
    <Card style={{ marginBottom: 12 }}
      title={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        {permessi.puo_modificare && onSeleziona && (
          <input type="checkbox" checked={selezionato} onChange={e => onSeleziona(e.target.checked)} aria-label="Seleziona" />
        )}
        {a.fornitore}
        <Badge tono={a.stato === 'proposto' ? 'warn' : a.stato === 'scartato' ? 'neutral' : 'ok'}>{a.stato}</Badge>
        <span className="ui-text-muted">{ETICHETTE_REGOLA[a.regola] || a.regola}</span>
      </span>}
      actions={permessi.puo_modificare && (daDecidere ? (
        <>
          <Button size="sm" onClick={() => onConferma([a.id])}>Conferma</Button>
          <Button size="sm" variant="danger-soft" onClick={() => onScarta([a.id])}>Scarta</Button>
        </>
      ) : <Button size="sm" variant="ghost" onClick={() => onAnnulla(a)}>Annulla la scelta</Button>)}>
      {a.nota && <Messaggio tipo={a.stato === 'proposto' ? 'warn' : 'info'}>{a.nota}</Messaggio>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <div>
          <div className="ui-text-muted" style={{ marginBottom: 4 }}>
            Passcom: {a.n_scadenze} scadenze, {formatEuro(a.totale_scadenze)}
          </div>
          <Table compact maxHeight="30vh">
            <thead><tr><Th>Scadenza</Th><Th>Documento</Th><Th>Modalità</Th><Th num>Importo</Th></tr></thead>
            <tbody>
              {a.scadenze.map(s => (
                <tr key={s.chiave}>
                  <Td>{formatData(s.data_scadenza)}</Td><Td>{s.numero_documento || '—'}</Td>
                  <Td muted>{s.tipo_pagamento}</Td><Td num><Importo v={s.importo} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div>
          <div className="ui-text-muted" style={{ marginBottom: 4 }}>
            Banca: {a.movimenti.length} movimenti, {formatEuro(a.totale_movimenti)}
            {Math.abs(a.differenza) > 0.005 && <> · <span style={{ color: colors.danger }}>differenza {formatEuro(a.differenza)}</span></>}
          </div>
          <Table compact>
            <thead><tr><Th>Data</Th><Th>Controparte</Th><Th>Causale</Th><Th num>Importo</Th></tr></thead>
            <tbody>
              {a.movimenti.map(m => (
                <tr key={m.id}>
                  <Td>{formatData(m.data_contabile)}</Td><Td>{m.controparte || '—'}</Td>
                  <Td muted>{m.causale || ''}</Td><Td num><Importo v={m.importo} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </Card>
  )
}

function useAzioniAbbinamenti(onCambio) {
  const avvisi = useAvvisi()
  const conferma = useConferma()
  return {
    async conferma(ids) {
      try {
        await api.post('/tesoreria/scadenzario/abbinamenti/conferma', { ids })
        avvisi.successo(ids.length > 1 ? `${ids.length} abbinamenti confermati` : 'Abbinamento confermato')
        onCambio()
      } catch (e) { avvisi.errore(mostraErrore(e)) }
    },
    async scarta(ids) {
      if (!(await conferma({ titolo: ids.length > 1 ? `Scartare ${ids.length} abbinamenti?` : "Scartare l'abbinamento?",
        messaggio: 'Le stesse scadenze e gli stessi movimenti non verranno più proposti insieme.' }))) return
      try {
        await api.post('/tesoreria/scadenzario/abbinamenti/scarta', { ids })
        onCambio()
      } catch (e) { avvisi.errore(mostraErrore(e)) }
    },
    async annulla(a) {
      if (!(await conferma({ titolo: 'Annullare la scelta?',
        messaggio: `L'abbinamento ${a.stato} di ${a.fornitore} viene tolto e gli abbinamenti vengono ricalcolati.` }))) return
      try {
        await api.delete(`/tesoreria/scadenzario/abbinamenti/${a.id}`)
        onCambio()
      } catch (e) { avvisi.errore(mostraErrore(e)) }
    },
  }
}

function VistaConfermare({ permessi, versione, onCambio, filtro }) {
  const [dati, setDati] = useState(null)
  const [mostra, setMostra] = useState('proposto')
  const { sel, imposta, svuota, tutte } = useSelezione()
  const avvisi = useAvvisi()
  const azioni = useAzioniAbbinamenti(() => { svuota(); onCambio() })

  useEffect(() => {
    let annullato = false
    api.get('/tesoreria/scadenzario/abbinamenti', { params: { stato: mostra } })
      .then(r => { if (!annullato) setDati(r.data) })
      .catch(e => avvisi.errore(mostraErrore(e)))
    return () => { annullato = true }
  }, [mostra, versione, avvisi])

  const c = dati?.conteggi || {}
  const ids = [...sel].map(Number)
  const abbinamenti = dati ? dati.abbinamenti.filter(a => !filtro || a.scadenze.some(filtro)) : []
  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <SegmentedControl value={mostra} onChange={v => { setMostra(v); svuota() }} options={[
          { value: 'proposto', label: `Da confermare (${c.proposto ?? '…'})` },
          { value: 'automatico', label: `Automatici (${c.automatico ?? '…'})` },
          { value: 'confermato', label: `Confermati (${c.confermato ?? '…'})` },
          { value: 'scartato', label: `Scartati (${c.scartato ?? '…'})` },
        ]} />
        {filtro && dati && <span className="ui-text-muted">{abbinamenti.length} con i filtri</span>}
        {permessi.puo_modificare && ['proposto', 'automatico'].includes(mostra) && abbinamenti.length > 0 && (
          <>
            <Button size="sm" variant="ghost" onClick={() => tutte(abbinamenti.map(a => String(a.id)))}>Seleziona tutti</Button>
            <Button size="sm" disabled={!sel.size} onClick={() => azioni.conferma(ids)}>Conferma {sel.size || ''}</Button>
            <Button size="sm" variant="danger-soft" disabled={!sel.size} onClick={() => azioni.scarta(ids)}>Scarta {sel.size || ''}</Button>
          </>
        )}
      </div>
      {mostra === 'automatico' && (
        <p className="ui-text-muted" style={{ marginBottom: 12 }}>
          Gli automatici valgono già come pagati: confermarli serve solo a renderli definitivi (non cambiano più
          con i prossimi import).
        </p>
      )}
      {!dati ? <Loading /> : abbinamenti.length === 0 ? <StatoVuoto>Nessun abbinamento.</StatoVuoto>
        : abbinamenti.map(a => (
          <CardAbbinamento key={a.id} a={a} permessi={permessi} selezionato={sel.has(String(a.id))}
            onSeleziona={['proposto', 'automatico'].includes(a.stato) ? on => imposta(String(a.id), on) : null}
            onConferma={azioni.conferma} onScarta={azioni.scarta} onAnnulla={azioni.annulla} />
        ))}
    </>
  )
}

function VistaSegnalare({ dati, filtri, onFornitore }) {
  const daSegnalare = new Set(dati.fornitori.filter(f => f.da_segnalare > 0).map(f => f.codice_fornitore))
  const righe = dati.scadenze.filter(r => ['pagata_banca', 'pagata_manuale'].includes(r.stato) && r.da_segnalare !== 0
    && daSegnalare.has(r.codice_fornitore))
    .sort((a, b) => a.fornitore.localeCompare(b.fornitore) || a.data_scadenza.localeCompare(b.data_scadenza))
  const perFornitore = useMemo(() => {
    const g = new Map()
    for (const r of righe) g.set(r.fornitore, (g.get(r.fornitore) || 0) + r.da_segnalare)
    return [...g.entries()].sort((a, b) => b[1] - a[1])
  }, [righe])
  return (
    <Card title={`Pagate ma ancora aperte in Passcom — ${righe.length} scadenze, ${formatEuro(righe.reduce((s, r) => s + r.da_segnalare, 0))}`}
      actions={<ExportMenu nome="scadenze_da_registrare" url={`/tesoreria/scadenzario/da-segnalare/export?${queryString({
        scadenza_da: filtri.da, scadenza_a: filtri.a, modalita: filtri.modalita, fornitore: filtri.fornitore.trim() })}`} />}>
      <p className="ui-text-muted" style={{ marginBottom: 8 }}>
        Da mandare allo studio perché registri i pagamenti. Non compaiono quelle già coperte dai pareggi di
        Passcom (pagamenti registrati senza collegarli alle fatture). Per fornitore: {perFornitore.slice(0, 6)
          .map(([f, v]) => `${f} ${formatEuro(v)}`).join(' · ')}{perFornitore.length > 6 ? ' …' : ''}
      </p>
      {righe.length === 0 ? <StatoVuoto>Niente da segnalare.</StatoVuoto>
        : <TabellaScadenze righe={righe} onFornitore={onFornitore} maxHeight="60vh" />}
    </Card>
  )
}

function VistaFornitori({ dati, onFornitore }) {
  const [testo, setTesto] = useState('')
  const elenco = dati.fornitori.filter(f => !testo || f.fornitore.toLowerCase().includes(testo.toLowerCase()))
  return (
    <Card title="Fornitori" actions={<Input value={testo} placeholder="Cerca fornitore" onChange={e => setTesto(e.target.value)} />}>
      <Table compact maxHeight="65vh">
        <thead>
          <tr>
            <Th>Fornitore</Th><Th num tot>Da pagare</Th><Th num>di cui scaduto</Th><Th>Prossima scadenza</Th>
            <Th num>Pagato, da segnalare</Th><Th num>Da confermare</Th><Th num>Aperto Passcom</Th>
          </tr>
        </thead>
        <tbody>
          {elenco.map(f => (
            <tr key={f.codice_fornitore} className={f.netto_passcom <= 0 ? 'ui-riga-attenuata' : undefined}>
              <Td>
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => onFornitore(f.codice_fornitore)}>{f.fornitore}</button>
              </Td>
              <Td num tot><Importo v={f.da_pagare} /></Td>
              <Td num>{f.scaduto ? <span style={{ color: colors.danger }}>{formatEuro(f.scaduto)}</span> : '—'}</Td>
              <Td>{formatData(f.prossima_scadenza)}</Td>
              <Td num>{f.da_segnalare ? formatEuro(f.da_segnalare) : '—'}</Td>
              <Td num>{f.n_da_confermare || '—'}</Td>
              <Td num muted>{formatEuro(f.aperto_passcom)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="ui-text-muted" style={{ marginTop: 8 }}>
        In grigio i fornitori a saldo zero per i pareggi di Passcom. Da pagare = aperto al netto dei pareggi, delle
        scadenze già pagate in banca e di quelle segnate a mano. Clic sul nome per il dettaglio.
      </p>
    </Card>
  )
}

function VistaResidui({ dati, onFornitore }) {
  const righe = dati.scadenze.filter(r => r.stato === 'residuo')
  return (
    <Card title={`Residui fino al ${formatData(dati.totali.limite_residui)} — ${righe.length} scadenze, ${formatEuro(dati.totali.residui.importo)}`}>
      <p className="ui-text-muted" style={{ marginBottom: 8 }}>
        Partite di anni precedenti ancora aperte in Passcom (spesso pochi euro): da verificare con lo studio.
        Non entrano nel "da pagare" né negli abbinamenti con la banca.
      </p>
      {righe.length === 0 ? <StatoVuoto>Nessun residuo.</StatoVuoto>
        : <TabellaScadenze righe={righe} onFornitore={onFornitore} maxHeight="60vh" />}
    </Card>
  )
}

// ── Dettaglio fornitore ──────────────────────────────────────────────────────

function ModaleManuale({ scadenze, onChiudi, onFatto }) {
  const [cand, setCand] = useState(null)
  const [scelti, setScelti] = useState(() => new Set())
  const [nota, setNota] = useState('')
  const avvisi = useAvvisi()
  const totaleScad = scadenze.reduce((s, r) => s + r.importo, 0)

  useEffect(() => {
    api.get('/tesoreria/scadenzario/movimenti-candidati', { params: { chiave: scadenze[0].chiave } })
      .then(r => setCand(r.data)).catch(e => avvisi.errore(mostraErrore(e)))
  }, [scadenze, avvisi])

  const totaleMov = (cand || []).filter(m => scelti.has(m.id)).reduce((s, m) => s - m.importo, 0)
  async function salva() {
    try {
      await api.post('/tesoreria/scadenzario/abbinamenti/manuale',
        { chiavi: scadenze.map(s => s.chiave), movimenti: [...scelti], nota: nota || null })
      avvisi.successo('Abbinamento salvato')
      onFatto()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  return (
    <Modal titolo={`Abbina a mano ${scadenze.length} scadenze (${formatEuro(totaleScad)})`} onChiudi={onChiudi} larghezza={820}
      chiudiSuSfondo={false} footer={<>
        <Button variant="secondary" onClick={onChiudi}>Annulla</Button>
        <Button onClick={salva} disabled={!scelti.size}>Abbina</Button>
      </>}>
      <p style={{ marginBottom: 8 }}>
        Scegli i pagamenti in banca (90 giorni attorno alla scadenza, prima quelli con il nome simile). Selezionati:
        {' '}{formatEuro(totaleMov)}
        {scelti.size > 0 && Math.abs(totaleMov - totaleScad) > 0.005 && (
          <span style={{ color: colors.warning }}> — differenza {formatEuro(totaleMov - totaleScad)}</span>
        )}
      </p>
      {!cand ? <Loading /> : cand.length === 0 ? <StatoVuoto>Nessun pagamento disponibile.</StatoVuoto> : (
        <Table compact maxHeight="45vh">
          <thead><tr><Th></Th><Th>Data</Th><Th>Controparte</Th><Th>Testo</Th><Th num>Importo</Th></tr></thead>
          <tbody>
            {cand.map(m => (
              <tr key={m.id} className={m.forza_nome > 0 ? 'ui-riga-evidenza' : undefined}>
                <Td><input type="checkbox" checked={scelti.has(m.id)} aria-label="Seleziona" onChange={e => setScelti(prev => {
                  const n = new Set(prev)
                  if (e.target.checked) n.add(m.id)
                  else n.delete(m.id)
                  return n
                })} /></Td>
                <Td>{formatData(m.data_contabile)}</Td><Td>{m.controparte || '—'}</Td>
                <Td muted style={{ maxWidth: 280 }} title={m.testo}>{m.testo.slice(0, 70)}</Td>
                <Td num><Importo v={m.importo} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Field label="Nota (facoltativa)" style={{ marginTop: 8 }}><Input value={nota} onChange={e => setNota(e.target.value)} /></Field>
    </Modal>
  )
}

function DettaglioFornitore({ codice, permessi, versione, onChiudi, onCambio }) {
  const [d, setD] = useState(null)
  const [manuale, setManuale] = useState(null)
  const [pagate, setPagate] = useState(null)
  const { sel, imposta, svuota } = useSelezione()
  const avvisi = useAvvisi()
  const conferma = useConferma()
  const azioni = useAzioniAbbinamenti(onCambio)

  useEffect(() => {
    let annullato = false
    api.get(`/tesoreria/scadenzario/fornitore/${encodeURIComponent(codice)}`)
      .then(r => { if (!annullato) setD(r.data) })
      .catch(e => avvisi.errore(mostraErrore(e)))
    return () => { annullato = true }
  }, [codice, versione, avvisi])

  const selezionate = d ? d.scadenze.filter(r => sel.has(r.chiave)) : []
  async function togliManuali() {
    const chiavi = d.scadenze.filter(r => r.stato === 'pagata_manuale' && sel.has(r.chiave)).map(r => r.chiave)
    if (!chiavi.length || !(await conferma({ titolo: `Togliere "pagata a mano" da ${chiavi.length} scadenze?` }))) return
    try {
      await api.post('/tesoreria/scadenzario/pagate-manuali/rimuovi', { chiavi })
      svuota(); onCambio()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }
  const selezionabileManuale = r => ['aperta', 'scaduta', 'da_confermare', 'residuo', 'pagata_manuale'].includes(r.stato)

  return (
    <Drawer titolo={d?.fornitore || 'Fornitore'} sottotitolo={d ? `Conto ${d.codice_fornitore}` : null} onChiudi={onChiudi} larghezza={960}>
      {!d ? <Loading /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="ui-kpi-row" style={{ marginBottom: 0 }}>
            <KpiTile label="Da pagare" value={formatEuro(d.riepilogo.da_pagare)}
              sub={d.riepilogo.scaduto ? `scaduto ${formatEuro(d.riepilogo.scaduto)}` : null}
              colore={d.riepilogo.scaduto > 0 ? colors.danger : undefined} />
            <KpiTile label="Pagato, da segnalare" value={formatEuro(d.riepilogo.da_segnalare)} />
            <KpiTile label="Aperto per Passcom" value={formatEuro(d.riepilogo.aperto_passcom)}
              sub={`netto pareggi ${formatEuro(d.riepilogo.netto_passcom)}`} />
          </div>
          {d.nomi_in_banca.length > 0 && (
            <p className="ui-text-muted">In banca anche come: {d.nomi_in_banca.join(', ')}</p>
          )}

          <Card title="Scadenze nell'ultimo scadenzario" actions={permessi.puo_modificare && (
            <>
              <Button size="sm" disabled={!selezionate.length} onClick={() => setManuale(selezionate)}>Abbina a un pagamento</Button>
              <Button size="sm" variant="secondary" disabled={!selezionate.some(r => r.stato !== 'pagata_manuale')}
                onClick={() => setPagate(selezionate.filter(r => r.stato !== 'pagata_manuale'))}>Segna pagate</Button>
              {selezionate.some(r => r.stato === 'pagata_manuale') && (
                <Button size="sm" variant="ghost" onClick={togliManuali}>Togli "pagata a mano"</Button>
              )}
            </>
          )}>
            <TabellaScadenze righe={d.scadenze} mostraFornitore={false} selezione={sel} maxHeight="40vh"
              onSeleziona={permessi.puo_modificare ? (k, on) => {
                const r = d.scadenze.find(x => x.chiave === k)
                if (r && selezionabileManuale(r)) imposta(k, on)
              } : null} />
          </Card>

          <Card title="Pagamenti in banca (ultimi 18 mesi)">
            {d.mensile.length > 0 && (
              <p className="ui-text-muted" style={{ marginBottom: 8 }}>
                Per mese: {d.mensile.map(m => `${m.mese.slice(5)}/${m.mese.slice(2, 4)} ${formatEuro(m.importo)}`).join(' · ')}
              </p>
            )}
            {d.pagamenti.length === 0 ? (
              <StatoVuoto>Nessun pagamento in banca con un nome simile. Se il fornitore compare con un altro nome,
                abbinalo a mano: la prossima volta verrà riconosciuto.</StatoVuoto>
            ) : (
              <Table compact maxHeight="35vh">
                <thead><tr><Th>Data</Th><Th>Controparte</Th><Th>Testo</Th><Th num>Importo</Th><Th>Abbinato</Th></tr></thead>
                <tbody>
                  {d.pagamenti.map(m => (
                    <tr key={m.id}>
                      <Td>{formatData(m.data_contabile)}</Td><Td>{m.controparte}</Td>
                      <Td muted style={{ maxWidth: 320 }} title={m.testo}>{m.testo.slice(0, 70)}</Td>
                      <Td num><Importo v={m.importo} /></Td>
                      <Td>{m.abbinato ? <Badge tono="ok">sì</Badge> : <span className="ui-text-muted">no</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {d.abbinamenti.length > 0 && (
            <div>
              <div className="ui-section-title" style={{ marginBottom: 8 }}>Abbinamenti</div>
              {d.abbinamenti.map(a => (
                <CardAbbinamento key={a.id} a={a} permessi={permessi} onConferma={azioni.conferma}
                  onScarta={azioni.scarta} onAnnulla={azioni.annulla} />
              ))}
            </div>
          )}
        </div>
      )}
      {manuale && <ModaleManuale scadenze={manuale} onChiudi={() => setManuale(null)}
        onFatto={() => { setManuale(null); svuota(); onCambio() }} />}
      {pagate && <ModalePagate righe={pagate} onChiudi={() => setPagate(null)}
        onFatto={() => { setPagate(null); svuota(); onCambio() }} />}
    </Drawer>
  )
}

// ── Filtri (data di scadenza e modalità di pagamento) ────────────────────────

const STATI_DA_PAGARE = ['aperta', 'scaduta', 'da_confermare']
const FILTRI_VUOTI = { da: '', a: '', modalita: '', fornitore: '' }

/** Totali e riepilogo per fornitore ricalcolati sulle sole scadenze filtrate (stesse regole del backend:
 *  quote `aperto` e `da_segnalare`, già al netto dei pareggi). */
function riassumi(dati, scadenze) {
  const somma = (filtro, campo = 'aperto') => {
    const sel = scadenze.filter(filtro)
    return { n: sel.length, importo: sel.reduce((x, r) => x + r[campo], 0) }
  }
  const limite = (() => {
    const [y, m, d] = dati.oggi.split('-').map(Number)
    return isoLocale(new Date(y, m - 1, d + dati.totali.giorni_in_scadenza))
  })()
  const totali = {
    ...dati.totali,
    da_pagare: somma(r => STATI_DA_PAGARE.includes(r.stato)),
    scaduto: somma(r => r.stato === 'scaduta'),
    in_scadenza: somma(r => r.stato === 'aperta' && r.data_scadenza <= limite),
    da_segnalare: somma(r => ['pagata_banca', 'pagata_manuale'].includes(r.stato), 'da_segnalare'),
    da_confermare: somma(r => r.stato === 'da_confermare'),
    residui: somma(r => r.stato === 'residuo'),
  }
  const orig = new Map(dati.fornitori.map(f => [f.codice_fornitore, f]))
  const g = new Map()
  for (const r of scadenze) {
    const o = orig.get(r.codice_fornitore)
    if (!g.has(r.codice_fornitore)) {
      g.set(r.codice_fornitore, { ...o, n: 0, da_pagare: 0, scaduto: 0, da_segnalare: 0, n_da_confermare: 0,
        residui: 0, prossima_scadenza: null })
    }
    const f = g.get(r.codice_fornitore)
    f.n += 1
    if (STATI_DA_PAGARE.includes(r.stato)) {
      f.da_pagare += r.aperto
      if (r.stato === 'aperta' && (!f.prossima_scadenza || r.data_scadenza < f.prossima_scadenza)) f.prossima_scadenza = r.data_scadenza
    }
    if (r.stato === 'scaduta') f.scaduto += r.aperto
    if (['pagata_banca', 'pagata_manuale'].includes(r.stato)) f.da_segnalare += r.da_segnalare
    if (r.stato === 'da_confermare') f.n_da_confermare += 1
    if (r.stato === 'residuo') f.residui += r.aperto
  }
  const fornitori = [...g.values()].sort((a, b) => b.da_pagare - a.da_pagare || b.da_segnalare - a.da_segnalare
    || a.fornitore.localeCompare(b.fornitore))
  return { ...dati, totali, fornitori, scadenze }
}

function BarraFiltri({ filtri, onChange, modalita, fornitori, attivi }) {
  const set = patch => onChange({ ...filtri, ...patch })
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
      <Field label="Scadenza dal"><Input type="date" value={filtri.da} onChange={e => set({ da: e.target.value })} /></Field>
      <Field label="al"><Input type="date" value={filtri.a} onChange={e => set({ a: e.target.value })} /></Field>
      <Field label="Modalità di pagamento">
        <Select value={filtri.modalita} onChange={e => set({ modalita: e.target.value })}>
          <option value="">Tutte</option>
          {modalita.map(m => <option key={m} value={m}>{m}</option>)}
        </Select>
      </Field>
      <Field label="Fornitore">
        <Input value={filtri.fornitore} list="tesoreria-fornitori" placeholder="nome o parte del nome" style={{ width: 240 }}
          onChange={e => set({ fornitore: e.target.value })} />
        <datalist id="tesoreria-fornitori">{fornitori.map(f => <option key={f} value={f} />)}</datalist>
      </Field>
      {attivi && <Button size="sm" variant="ghost" onClick={() => onChange(FILTRI_VUOTI)}>Togli filtri</Button>}
    </div>
  )
}

// ── Scheda ───────────────────────────────────────────────────────────────────

export default function TabScadenzario({ permessi, onVaiA }) {
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const [versione, setVersione] = useState(0)
  const [fornitore, setFornitore] = useState(null)
  const [filtri, setFiltri] = useState(FILTRI_VUOTI)
  const [vista, setVista] = useState(() => {
    try {
      const v = localStorage.getItem(LS_VISTA)
      return VISTE.some(x => x.value === v) ? v : 'settimane'
    } catch { return 'settimane' }
  })
  const avvisi = useAvvisi()

  const carica = useCallback(async () => {
    try {
      setErrore(null)
      setDati((await api.get('/tesoreria/scadenzario/stato')).data)
    } catch (e) { setErrore(mostraErrore(e)) }
  }, [])
  useEffect(() => { carica() }, [carica, versione])

  const cambiaVista = v => {
    setVista(v)
    try { localStorage.setItem(LS_VISTA, v) } catch { /* preferenza non salvata */ }
  }
  const cambio = () => setVersione(v => v + 1)

  async function ricalcola() {
    try {
      const r = (await api.post('/tesoreria/scadenzario/abbinamenti/ricalcola')).data
      avvisi.successo(`Abbinamenti ricalcolati: ${r.n_scadenze_automatiche} scadenze pagate in automatico, ` +
        `${r.n_proposti} da confermare`)
      cambio()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  const testoFornitore = filtri.fornitore.trim().toLowerCase()
  const attivi = !!(filtri.da || filtri.a || filtri.modalita || testoFornitore)
  const filtro = useMemo(() => (attivi ? r => (!filtri.da || r.data_scadenza >= filtri.da)
    && (!filtri.a || r.data_scadenza <= filtri.a) && (!filtri.modalita || r.tipo_pagamento === filtri.modalita)
    && (!testoFornitore || (r.fornitore || '').toLowerCase().includes(testoFornitore)) : null),
  [attivi, filtri, testoFornitore])
  const visibili = useMemo(() => (dati?.data_fotografia && filtro ? riassumi(dati, dati.scadenze.filter(filtro)) : dati),
    [dati, filtro])
  const modalita = useMemo(() => [...new Set((dati?.scadenze || []).filter(r => !r.pareggio)
    .map(r => r.tipo_pagamento))].sort(), [dati])
  const nomiFornitori = useMemo(() => [...new Set((dati?.scadenze || []).map(r => r.fornitore))].sort(), [dati])

  if (errore) return <Messaggio>{errore}</Messaggio>
  if (!dati) return <Loading />
  if (!dati.data_fotografia) {
    return (
      <StatoVuoto>
        Nessuno scadenzario caricato. Scaricalo da Passcom (scadenzario fornitori, rate da pagare) e caricalo in
        {' '}<Button size="sm" variant="ghost" onClick={() => onVaiA('import')}>Import e saldi</Button>.
      </StatoVuoto>
    )
  }
  const t = visibili.totali

  return (
    <div>
      <BarraFiltri filtri={filtri} onChange={setFiltri} modalita={modalita} fornitori={nomiFornitori} attivi={attivi} />
      {attivi && <p className="ui-text-muted" style={{ marginTop: -8, marginBottom: 8 }}>Totali e viste con i filtri applicati.</p>}
      <div className="ui-kpi-row">
        <KpiTile size="lg" label="Da pagare" value={formatEuro(t.da_pagare.importo)}
          sub={`${formatN(t.da_pagare.n)} scadenze · ${formatEuro(t.in_scadenza.importo)} entro ${t.giorni_in_scadenza} giorni`} />
        <KpiTile label="Scaduto non pagato" value={formatEuro(t.scaduto.importo)} sub={`${formatN(t.scaduto.n)} scadenze`}
          colore={t.scaduto.importo > 0 ? colors.danger : undefined} />
        <KpiTile label="Pagato, da segnalare allo studio" value={formatEuro(t.da_segnalare.importo)}
          sub={`${formatN(t.da_segnalare.n)} scadenze`} />
        <KpiTile label="Da confermare" value={formatN(t.da_confermare.n)} sub={formatEuro(t.da_confermare.importo)}
          colore={t.da_confermare.n > 0 ? colors.warning : undefined} />
        <KpiTile label="Aperto per Passcom" value={formatEuro(t.aperto_passcom)}
          sub={`scadenzario del ${formatData(dati.data_fotografia)}`} />
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <SegmentedControl options={VISTE} value={vista} onChange={cambiaVista} />
        {permessi.puo_modificare && <Button size="sm" variant="secondary" onClick={ricalcola}>Ricalcola abbinamenti</Button>}
      </div>

      {vista === 'settimane' && <VistaSettimane dati={visibili} permessi={permessi} onCambio={cambio} onFornitore={setFornitore} />}
      {vista === 'confermare' && <VistaConfermare permessi={permessi} versione={versione} onCambio={cambio} filtro={filtro} />}
      {vista === 'segnalare' && <VistaSegnalare dati={visibili} filtri={filtri} onFornitore={setFornitore} />}
      {vista === 'fornitori' && <VistaFornitori dati={visibili} onFornitore={setFornitore} />}
      {vista === 'residui' && <VistaResidui dati={visibili} onFornitore={setFornitore} />}

      {fornitore && (
        <DettaglioFornitore codice={fornitore} permessi={permessi} versione={versione}
          onChiudi={() => setFornitore(null)} onCambio={cambio} />
      )}
    </div>
  )
}
