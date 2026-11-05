// Import degli ZIP di fatture ricevute scaricati dal portale AdE (Fase 5): istruzioni fisse per la richiesta,
// anteprima con conferma, storico con ZIP originale ed eliminazione. Usato in "Import e saldi".
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client.js'
import { colors } from '../../styles/tokens.js'
import { formatData, formatEuro, formatN, mostraErrore } from '../../utils/format.js'
import {
  Badge, Button, Card, DropZone, Field, Input, KpiTile, Loading, Messaggio, Modal, SezioneApribile, StatoVuoto, Table,
  Td, Th, useAvvisi, useConferma,
} from '../../components/ui'
import { scarica } from '../usaliContabile/helpers.jsx'

const TIMEOUT_ZIP = 300000          // ZIP di un trimestre d'estate: fino a 15 s di lettura più l'upload
const LS_ISTRUZIONI = 'tesoreria_istruzioni_ade'

function Istruzioni() {
  const [aperta, setAperta] = useState(() => {
    try { return localStorage.getItem(LS_ISTRUZIONI) !== 'chiuse' } catch { return true }
  })
  const cambia = () => {
    setAperta(a => {
      try { localStorage.setItem(LS_ISTRUZIONI, a ? 'chiuse' : 'aperte') } catch { /* preferenza non salvata */ }
      return !a
    })
  }
  return (
    <SezioneApribile titolo="Come scaricare lo ZIP dall'Agenzia delle Entrate" aperta={aperta} onToggle={cambia}>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <li>Portale <b>Fatture e Corrispettivi</b> → Consultazione/Richieste → <b>Richieste di Fatture Elettroniche</b> →
          Creazione richiesta guidata.</li>
        <li>Scegliere <b>Puntuale</b>, fatture <b>Ricevute</b>, tipo <b>Tutte</b>, tipo di data <b>data di ricezione</b>
          (mai la data di emissione: le fatture differite di fine mese arrivano fino al 15 del mese dopo).</li>
        <li>Periodo: <b>il mese intero appena finito</b>, richiesto dopo la sua fine (per lo storico un trimestre per volta:
          il portale limita il periodo e il numero di richieste al giorno).</li>
        <li><b>Genera richiesta</b> → <b>Invia richiesta</b> («Download richiesta (xml)» è solo il modulo, non le fatture).</li>
        <li>Dopo 1–5 giorni, in Richieste, scaricare lo ZIP e caricarlo qui <b>così com'è</b>, senza decomprimerlo
          (nome suggerito <code>AAAA-MM.zip</code>). Il file <code>…_fileInput.xml</code> accanto è il modulo: non serve.</li>
        <li>Uno ZIP che si sovrappone a uno già caricato va bene: le fatture già presenti vengono saltate.</li>
      </ol>
    </SezioneApribile>
  )
}

function ModaleZip({ file, onChiudi, onImportato }) {
  const [a, setA] = useState(null)
  const [errore, setErrore] = useState(null)
  const [note, setNote] = useState('')
  const [lavoro, setLavoro] = useState(true)
  const avvisi = useAvvisi()

  useEffect(() => {
    let annullato = false
    const fd = new FormData()
    fd.append('file', file)
    api.post('/tesoreria/fatture/anteprima', fd, { timeout: TIMEOUT_ZIP })
      .then(r => { if (!annullato) setA(r.data) })
      .catch(e => { if (!annullato) setErrore(mostraErrore(e, 'Errore nella lettura dello ZIP')) })
      .finally(() => { if (!annullato) setLavoro(false) })
    return () => { annullato = true }
  }, [file])

  async function conferma() {
    setLavoro(true); setErrore(null)
    try {
      const r = await api.post('/tesoreria/fatture/conferma', { token: a.token, note: note || null }, { timeout: TIMEOUT_ZIP })
      avvisi.successo(`Fatture importate: ${r.data.n_nuove} nuove, ${r.data.n_gia_presenti} già presenti`)
      onImportato()
    } catch (e) {
      setErrore(mostraErrore(e, "Errore durante l'import"))
      setLavoro(false)
    }
  }

  return (
    <Modal titolo={`Importa fatture ricevute — ${file.name}`} onChiudi={onChiudi} larghezza={760} chiudiSuSfondo={false}
      footer={<>
        <Button variant="secondary" onClick={onChiudi}>Annulla</Button>
        <Button onClick={conferma} disabled={!a || a.gia_importato || !a.n_nuove || lavoro}>
          {lavoro && a ? 'Import in corso…' : 'Conferma import'}
        </Button>
      </>}>
      <Messaggio>{errore}</Messaggio>
      {!a ? (lavoro && <Loading testo="Lettura dello ZIP (un trimestre d'estate richiede fino a 15–20 secondi)…" />) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {a.gia_importato && <Messaggio tipo="warn">Questo ZIP è già stato importato il {formatData(a.gia_importato.data?.slice(0, 10))}.</Messaggio>}
          {!a.gia_importato && !a.n_nuove && <Messaggio tipo="info">Tutte le fatture dello ZIP sono già presenti: niente da importare.</Messaggio>}
          {a.avvisi.map((t, i) => <Messaggio key={i} tipo="warn">{t}</Messaggio>)}
          <div className="ui-kpi-row">
            <KpiTile label="Ricevute dal portale" value={`${formatData(a.ricezione_da)} – ${formatData(a.ricezione_a)}`}
              sub={`date dei documenti ${formatData(a.documento_da)} – ${formatData(a.documento_a)}`} minWidth={260} />
            <KpiTile label="Fatture nuove" value={formatN(a.n_nuove)} sub={formatEuro(a.totale_nuove)} />
            <KpiTile label="Già presenti" value={formatN(a.n_gia_presenti + a.n_doppie_documento)}
              sub={a.n_doppie_documento ? `di cui ${a.n_doppie_documento} stesso numero e data` : 'saltate'} />
            <KpiTile label="File illeggibili" value={formatN(a.n_errori)} colore={a.n_errori ? colors.warning : undefined} />
          </div>
          {a.per_tipo.length > 0 && (
            <Table compact>
              <thead><tr><Th>Tipo documento (nuove)</Th><Th num>Fatture</Th><Th num>Totale</Th></tr></thead>
              <tbody>
                {a.per_tipo.map(t => (
                  <tr key={t.tipo_documento}><Td>{t.tipo_documento}</Td><Td num>{t.n}</Td><Td num>{formatEuro(t.totale)}</Td></tr>
                ))}
              </tbody>
            </Table>
          )}
          {a.errori.length > 0 && (
            <Table compact maxHeight="25vh">
              <thead><tr><Th>File non letto</Th><Th>Motivo</Th></tr></thead>
              <tbody>{a.errori.map((e, i) => <tr key={i}><Td>{e.file}</Td><Td muted>{e.motivo}</Td></tr>)}</tbody>
            </Table>
          )}
          <Field label="Note (facoltative)"><Input value={note} onChange={e => setNote(e.target.value)} /></Field>
        </div>
      )}
    </Modal>
  )
}

export default function ImportFatture({ permessi, onCambio }) {
  const [storico, setStorico] = useState(null)
  const [file, setFile] = useState(null)
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    try { setStorico((await api.get('/tesoreria/fatture/import')).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [avvisi])
  useEffect(() => { carica() }, [carica])

  async function elimina(i) {
    if (!(await conferma({
      titolo: `Eliminare l'import «${i.nome_file}»?`,
      messaggio: `Spariscono le ${i.n_collegate} fatture che questo import ha inserito per primo (anche se uno ZIP caricato ` +
        'dopo le conteneva: va ricaricato). Gli abbinamenti con la banca vengono ricalcolati.',
      pericolo: true,
    }))) return
    try {
      await api.delete(`/tesoreria/fatture/import/${i.id}`, { params: { conferma: true } })
      carica(); onCambio()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  return (
    <Card title="Fatture ricevute (ZIP dell'Agenzia delle Entrate)">
      <Istruzioni />
      {permessi.puo_importare && (
        <div style={{ marginBottom: 12 }}>
          <DropZone accept=".zip" icona="🧾" onFile={setFile}
            titolo="Trascina qui lo ZIP delle fatture ricevute o clicca per sceglierlo"
            sottotitolo="Scaricato dal portale Fatture e Corrispettivi, così com'è (file .zip)." />
        </div>
      )}
      {!storico ? <Loading /> : storico.length === 0 ? <StatoVuoto>Nessuno ZIP caricato.</StatoVuoto> : (
        <Table compact maxHeight="35vh">
          <thead><tr><Th>File</Th><Th>Ricevute</Th><Th num>Nuove</Th><Th num>Già presenti</Th><Th num>Errori</Th><Th>Caricato</Th><Th></Th></tr></thead>
          <tbody>
            {storico.map(i => (
              <tr key={i.id}>
                <Td>
                  {i.nome_file}{i.note ? <span className="ui-text-muted"> — {i.note}</span> : null}
                  {i.avvisi.length > 0 && <> <Badge tono="warn" title={i.avvisi.join('\n')}>avvisi</Badge></>}
                </Td>
                <Td style={{ whiteSpace: 'nowrap' }}>{formatData(i.ricezione_da)} – {formatData(i.ricezione_a)}</Td>
                <Td num>{formatN(i.n_nuove)}</Td><Td num muted>{formatN(i.n_presenti)}</Td>
                <Td num>{i.n_errori ? <span title={i.errori.map(e => `${e.file}: ${e.motivo}`).join('\n')}>{i.n_errori}</span> : '—'}</Td>
                <Td muted>{formatData(i.created_at?.slice(0, 10))} {i.utente || ''}</Td>
                <Td style={{ whiteSpace: 'nowrap' }}>
                  {i.ha_file && (
                    <Button size="sm" variant="ghost"
                      onClick={() => scarica(`/tesoreria/fatture/import/${i.id}/file`, {}, i.nome_file).catch(e => avvisi.errore(mostraErrore(e)))}>
                      Scarica
                    </Button>
                  )}
                  {permessi.puo_importare && <Button size="sm" variant="danger-soft" onClick={() => elimina(i)}>Elimina</Button>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {file && <ModaleZip file={file} onChiudi={() => setFile(null)} onImportato={() => { setFile(null); carica(); onCambio() }} />}
    </Card>
  )
}
