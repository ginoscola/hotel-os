// Popup con la fattura ricevuta: versione leggibile costruita dall'XML (sempre disponibile) e PDF del fornitore
// (quando è incorporato nell'XML, estratto al momento dallo ZIP originale). Usato da Fatture e da Admin → Spese straordinarie.
import { useEffect, useState } from 'react'
import api from '../../api/client.js'
import { formatData, formatEuro, leggiErroreBlob, mostraErrore } from '../../utils/format.js'
import { Button, Loading, Messaggio, Modal, SegmentedControl, StatoVuoto, Table, Td, Th } from '../../components/ui'
import { scarica } from '../usaliContabile/helpers.jsx'

const IN_LINEA = ['pdf', 'png', 'jpg', 'jpeg']

function numero(v, dec = 2) {
  if (v == null) return '—'
  return v.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: dec })
}

function Soggetto({ titolo, s }) {
  if (!s) return null
  return (
    <div style={{ flex: 1, minWidth: 240 }}>
      <div className="ui-text-muted" style={{ textTransform: 'uppercase', fontSize: 'var(--fs-xs)' }}>{titolo}</div>
      <div style={{ fontWeight: 600 }}>{s.denominazione || '—'}</div>
      {s.indirizzo && <div>{s.indirizzo}</div>}
      <div className="ui-text-muted">
        {[s.piva && `P.IVA ${s.piva}`, s.codice_fiscale && `C.F. ${s.codice_fiscale}`].filter(Boolean).join(' · ')}
      </div>
      {(s.email || s.telefono) && <div className="ui-text-muted">{[s.telefono, s.email].filter(Boolean).join(' · ')}</div>}
    </div>
  )
}

function Riferimenti({ titolo, voci }) {
  if (!voci?.length) return null
  return <div><span className="ui-text-muted">{titolo}: </span>{voci.map(v => `${v.numero || '?'}${v.data ? ` del ${formatData(v.data)}` : ''}`).join(', ')}</div>
}

function DocumentoXml({ d }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <Soggetto titolo="Fornitore" s={d.cedente} />
        <Soggetto titolo="Cliente" s={d.cessionario} />
        <div style={{ minWidth: 200 }}>
          <div style={{ fontWeight: 600 }}>{d.tipo_nome} ({d.tipo_documento})</div>
          <div>n. <b>{d.numero}</b> del {formatData(d.data)}</div>
          {d.data_ricezione && <div className="ui-text-muted">ricevuta dallo SDI il {formatData(d.data_ricezione.slice(0, 10))}</div>}
          <div style={{ marginTop: 4 }}>Totale <b>{formatEuro(d.totale)}</b></div>
        </div>
      </div>
      {d.causale.length > 0 && <div><span className="ui-text-muted">Causale: </span>{d.causale.join(' ')}</div>}
      <div>
        <Riferimenti titolo="DDT" voci={d.ddt} />
        <Riferimenti titolo="Ordini" voci={d.ordini} />
        <Riferimenti titolo="Contratti" voci={d.contratti} />
        <Riferimenti titolo="Fatture collegate" voci={d.fatture_collegate} />
      </div>

      <div>
        <div className="ui-section-title">Righe ({d.righe.length})</div>
        {d.righe.length === 0 ? <StatoVuoto>Nessuna riga nel file.</StatoVuoto> : (
          <Table compact maxHeight="45vh">
            <thead>
              <tr><Th>Descrizione</Th><Th>Codice</Th><Th num>Q.tà</Th><Th>U.m.</Th><Th num>Prezzo</Th><Th>Sconti</Th><Th num>Importo</Th><Th num>IVA</Th></tr>
            </thead>
            <tbody>
              {d.righe.map((r, i) => (
                <tr key={i}>
                  <Td style={{ whiteSpace: 'normal', minWidth: 260 }}>{r.descrizione}</Td>
                  <Td muted>{r.codice || ''}</Td>
                  <Td num>{numero(r.quantita, 3)}</Td><Td muted>{r.unita || ''}</Td>
                  <Td num>{numero(r.prezzo_unitario, 4)}</Td><Td muted>{r.sconti || ''}</Td>
                  <Td num>{r.prezzo_totale != null ? formatEuro(r.prezzo_totale) : '—'}</Td>
                  <Td num>{r.natura || (r.aliquota != null ? `${numero(r.aliquota)}%` : '—')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 320 }}>
          <div className="ui-section-title">Riepilogo IVA</div>
          <Table compact>
            <thead><tr><Th num>Aliquota</Th><Th num>Imponibile</Th><Th num>Imposta</Th><Th>Note</Th></tr></thead>
            <tbody>
              {d.riepilogo.map((r, i) => (
                <tr key={i}>
                  <Td num>{r.natura || `${numero(r.aliquota)}%`}</Td><Td num>{formatEuro(r.imponibile)}</Td>
                  <Td num>{formatEuro(r.imposta)}</Td>
                  <Td muted style={{ whiteSpace: 'normal' }}>{[r.esigibilita === 'S' ? 'scissione dei pagamenti' : r.esigibilita === 'D' ? 'esigibilità differita' : null, r.riferimento_normativo].filter(Boolean).join(' · ')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {(d.ritenute.length > 0 || d.cassa_previdenziale.length > 0 || d.bollo) && (
            <div style={{ marginTop: 6 }}>
              {d.ritenute.map((r, i) => <div key={i}>Ritenuta {r.tipo}{r.aliquota ? ` ${numero(r.aliquota)}%` : ''}: {formatEuro(r.importo)}</div>)}
              {d.cassa_previdenziale.map((c, i) => <div key={i}>Cassa previdenziale {c.tipo}{c.aliquota ? ` ${numero(c.aliquota)}%` : ''}: {formatEuro(c.importo)}</div>)}
              {d.bollo ? <div>Bollo: {formatEuro(d.bollo)}</div> : null}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 320 }}>
          <div className="ui-section-title">Pagamento</div>
          {d.pagamenti.length === 0 ? <StatoVuoto>Nessun dato di pagamento nel file.</StatoVuoto> : (
            <Table compact>
              <thead><tr><Th>Modalità</Th><Th>Scadenza</Th><Th num>Importo</Th></tr></thead>
              <tbody>
                {d.pagamenti.map((p, i) => (
                  <tr key={i}>
                    <Td>{p.modalita || '—'}{p.iban && <div className="ui-text-muted">IBAN {p.iban}{p.istituto ? ` · ${p.istituto}` : ''}</div>}</Td>
                    <Td>{p.scadenza ? formatData(p.scadenza) : '—'}</Td><Td num>{formatEuro(p.importo)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </div>
    </div>
  )
}

function Allegato({ id, a }) {
  const [url, setUrl] = useState(null)
  const [errore, setErrore] = useState(null)
  useEffect(() => {
    let href = null
    let annullato = false
    api.get(`/tesoreria/fatture/${id}/allegati/${a.indice}`, { responseType: 'blob', timeout: 60000 })
      .then(r => { if (!annullato) { href = URL.createObjectURL(r.data); setUrl(href) } })
      .catch(e => { if (!annullato) setErrore(mostraErrore(e)) })
    return () => { annullato = true; if (href) URL.revokeObjectURL(href) }
  }, [id, a.indice])
  if (errore) return <Messaggio>{errore}</Messaggio>
  if (!url) return <Loading testo="Apertura del PDF del fornitore…" />
  return a.formato === 'pdf'
    ? <iframe title={a.nome} src={url} style={{ width: '100%', height: '75vh', border: '1px solid var(--color-border)', borderRadius: 6 }} />
    : <img alt={a.nome} src={url} style={{ maxWidth: '100%' }} />
}

export default function VistaFattura({ id, onChiudi }) {
  const [d, setD] = useState(null)
  const [errore, setErrore] = useState(null)
  const [vista, setVista] = useState('xml')

  useEffect(() => {
    setD(null); setErrore(null)
    api.get(`/tesoreria/fatture/${id}/documento`, { timeout: 60000 })
      .then(r => {
        setD(r.data)
        const pdf = r.data.allegati.find(a => a.formato === 'pdf')
        setVista(pdf ? `a${pdf.indice}` : 'xml')
      })
      .catch(e => setErrore(mostraErrore(e)))
  }, [id])

  const visibili = d ? d.allegati.filter(a => IN_LINEA.includes(a.formato)) : []
  const altri = d ? d.allegati.filter(a => !IN_LINEA.includes(a.formato)) : []
  const scelto = d && vista !== 'xml' ? d.allegati.find(a => `a${a.indice}` === vista) : null

  return (
    <Modal titolo={d ? `${d.cedente?.denominazione || 'Fattura'} — n. ${d.numero} del ${formatData(d.data)}` : 'Fattura'}
      onChiudi={onChiudi} larghezza={1100} footer={<Button onClick={onChiudi}>Chiudi</Button>}>
      <Messaggio>{errore}</Messaggio>
      {!d ? (!errore && <Loading />) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <SegmentedControl value={vista} onChange={setVista} options={[
              ...visibili.map(a => ({ value: `a${a.indice}`, label: visibili.length > 1 ? `PDF del fornitore: ${a.nome}` : 'PDF del fornitore' })),
              { value: 'xml', label: 'Dati della fattura (XML)' },
            ]} />
            {altri.map(a => (
              <Button key={a.indice} size="sm" variant="ghost"
                onClick={() => scarica(`/tesoreria/fatture/${id}/allegati/${a.indice}`, {}, a.nome).catch(async e => setErrore(mostraErrore(await leggiErroreBlob(e), 'Download dell\'allegato non riuscito')))}>
                Scarica allegato «{a.nome}»
              </Button>
            ))}
          </div>
          {d.allegati_non_disponibili && <Messaggio tipo="warn">Il PDF del fornitore era nel file, ma lo ZIP originale non è più sul server.</Messaggio>}
          {scelto ? <Allegato key={scelto.indice} id={id} a={scelto} /> : <DocumentoXml d={d} />}
        </div>
      )}
    </Modal>
  )
}
