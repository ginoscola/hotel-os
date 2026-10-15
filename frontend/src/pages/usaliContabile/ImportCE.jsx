// Import dell'export del gestionale (xlsx obbligatorio + csv facoltativo) con anteprima e
// conferma, e storico degli import con download dei file originali.
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client.js'
import { mostraErrore } from '../../utils/format.js'
import { isAdmin } from '../../utils/auth.js'
import {
  Badge, Button, Card, DropZone, Field, Input, Loading, Messaggio, Modal, Select, StatoVuoto,
  Table, Td, Th, useAvvisi, useConferma,
} from '../../components/ui'
import { Euro, periodiCompatti, periodoLabel, scarica } from './helpers.jsx'

function ModaleImport({ strutture, onChiudi, onImportato }) {
  const [xlsx, setXlsx] = useState(null)
  const [csv, setCsv] = useState(null)
  const [struttura, setStruttura] = useState('')
  const [anteprima, setAnteprima] = useState(null)
  const [note, setNote] = useState('')
  const [errore, setErrore] = useState(null)
  const [lavoro, setLavoro] = useState(false)
  const avvisi = useAvvisi()

  async function caricaAnteprima(strutturaScelta = struttura) {
    if (!xlsx) return
    setLavoro(true)
    setErrore(null)
    try {
      const fd = new FormData()
      fd.append('xlsx', xlsx)
      if (csv) fd.append('csv', csv)
      if (strutturaScelta) fd.append('struttura_code', strutturaScelta)
      const r = await api.post('/usali/contabile/anteprima', fd, { timeout: 120000 })
      setAnteprima(r.data)
      if (r.data.struttura) setStruttura(r.data.struttura)
    } catch (e) {
      setAnteprima(null)
      setErrore(mostraErrore(e, 'Errore nella lettura del file'))
    } finally {
      setLavoro(false)
    }
  }

  // Nuovi file → nuova anteprima da zero
  useEffect(() => {
    setAnteprima(null)
    if (xlsx) caricaAnteprima('')
  }, [xlsx, csv])

  async function conferma() {
    setLavoro(true)
    setErrore(null)
    try {
      const r = await api.post('/usali/contabile/conferma', {
        token: anteprima.token, struttura_code: struttura || null, note: note || null,
      }, { timeout: 120000 })
      avvisi.successo(`Import completato: ${r.data.struttura}, ${periodiCompatti(r.data.periodi)}`)
      onImportato()
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore durante l\'import'))
    } finally {
      setLavoro(false)
    }
  }

  const strutturaDalFile = !!anteprima?.struttura_rilevata
  const puoConfermare = anteprima && struttura && !anteprima.gia_importato && !lavoro

  const footer = (
    <>
      <Button variant="secondary" onClick={onChiudi}>Annulla</Button>
      <Button onClick={conferma} disabled={!puoConfermare}>
        {lavoro && anteprima ? 'Import in corso…' : 'Conferma import'}
      </Button>
    </>
  )

  return (
    <Modal titolo="Importa export del gestionale" onChiudi={onChiudi} footer={footer} larghezza={760}
      chiudiSuSfondo={false}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <DropZone accept=".xlsx" onFile={setXlsx} icona="📊"
            titolo={xlsx ? xlsx.name : 'File xlsx (obbligatorio)'}
            sottotitolo={xlsx ? 'Clic per cambiare' : 'Trascina qui o clicca — contiene gerarchia e importi'} />
        </div>
        <div>
          <DropZone accept=".csv" onFile={setCsv} icona="📄"
            titolo={csv ? csv.name : 'File csv (facoltativo)'}
            sottotitolo={csv ? 'Clic per cambiare' : 'Consigliato: id conti/reparti e struttura'} />
          {csv && <Button size="sm" variant="ghost" onClick={() => setCsv(null)}>Rimuovi csv</Button>}
        </div>
      </div>

      {lavoro && !anteprima && <Loading testo="Lettura del file…" />}
      {errore && <Messaggio onChiudi={() => setErrore(null)}>{errore}</Messaggio>}

      {anteprima && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge tono={anteprima.quadratura_ok ? 'ok' : 'err'}>
              {anteprima.quadratura_ok ? '✓ Quadra col Gran Totale' : '✗ Non quadra'}
            </Badge>
            <Badge tono="neutral">{anteprima.n_conti} conti</Badge>
            <Badge tono="neutral">{periodiCompatti(anteprima.periodi)}</Badge>
            <Badge tono={anteprima.csv_arricchito ? 'ok' : 'neutral'}>
              {anteprima.csv_arricchito ? 'CSV abbinato' : 'Senza CSV'}
            </Badge>
          </div>

          <Field label={strutturaDalFile
            ? `Struttura (rilevata dal file: id gestionale ${anteprima.id_struttura_gestionale})`
            : 'Struttura (non rilevabile dal file: sceglierla)'}>
            <Select value={struttura} disabled={strutturaDalFile || lavoro}
              onChange={e => { setStruttura(e.target.value); caricaAnteprima(e.target.value) }}>
              <option value="">— scegli —</option>
              {strutture.map(s => <option key={s.code} value={s.code}>{s.nome} ({s.code})</option>)}
            </Select>
          </Field>

          {anteprima.avvisi.map((a, i) => <Messaggio key={i} tipo="warn">{a}</Messaggio>)}
          {anteprima.gia_importato && (
            <Messaggio tipo="warn">
              Questo file è già stato importato (import #{anteprima.gia_importato.id}): nessuna modifica da fare.
            </Messaggio>
          )}

          {anteprima.confronto.length > 0 && (
            <Table compact>
              <thead>
                <tr>
                  <Th>Mese</Th>
                  <Th num>Netto attuale</Th>
                  <Th num>Netto nuovo</Th>
                  <Th num>Differenza</Th>
                  <Th num>Ricavi nuovi</Th>
                </tr>
              </thead>
              <tbody>
                {anteprima.confronto.map(c => (
                  <tr key={c.periodo}
                    className={c.gia_presente && Math.abs(c.differenza) >= 0.01 ? 'ui-riga-modificata' : undefined}>
                    <Td>{periodoLabel(c.periodo)} {!c.gia_presente && <Badge tono="info">nuovo</Badge>}</Td>
                    <Td num>{c.gia_presente ? <Euro v={c.netto_vecchio} /> : '—'}</Td>
                    <Td num><Euro v={c.netto_nuovo} /></Td>
                    <Td num>{c.gia_presente ? <Euro v={c.differenza} /> : '—'}</Td>
                    <Td num><Euro v={c.ricavi_nuovi} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {anteprima.confronto.some(c => c.gia_presente) && (
            <p className="ui-text-muted">
              Alla conferma i mesi già presenti vengono sostituiti da quelli del file (l'ultimo import vince);
              gli import precedenti restano nello storico con i file originali.
            </p>
          )}

          <Field label="Note (facoltative)">
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="es. riesportato dopo fatture di agosto" />
          </Field>
        </div>
      )}
    </Modal>
  )
}

export default function ImportCE({ struttura, strutture, onImportato }) {
  const [storico, setStorico] = useState(null)
  const [errore, setErrore] = useState(null)
  const [modale, setModale] = useState(false)
  const avvisi = useAvvisi()
  const conferma = useConferma()
  const admin = isAdmin()

  const carica = useCallback(() => {
    api.get('/usali/contabile/import', { params: { struttura } })
      .then(r => setStorico(r.data))
      .catch(e => setErrore(mostraErrore(e)))
  }, [struttura])

  useEffect(() => { carica() }, [carica])

  async function scaricaOriginale(imp, tipo) {
    try {
      await scarica(`/usali/contabile/import/${imp.id}/file/${tipo}`, {},
        tipo === 'xlsx' ? imp.nome_file_xlsx : imp.nome_file_csv)
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'File non disponibile'))
    }
  }

  async function elimina(imp) {
    const inVigore = imp.periodi_in_vigore.length
    if (!(await conferma({
      titolo: `Eliminare l'import #${imp.id} (${imp.struttura})?`,
      messaggio: (inVigore
        ? `Verranno cancellati dal database i dati di ${periodiCompatti(imp.periodi_in_vigore)} per ${imp.struttura}: `
          + 'quei mesi risulteranno non importati finché non carichi di nuovo il file giusto. '
          + 'Un import precedente sostituito da questo non viene ripristinato. '
        : 'Nessun mese è più in vigore da questo import: viene tolto solo dallo storico. ')
        + 'Vengono cancellati anche i file originali salvati. L\'operazione non si può annullare.',
      pericolo: true,
      ritardoMs: 1500,
    }))) return
    try {
      const r = await api.delete(`/usali/contabile/import/${imp.id}`, { params: { conferma: true } })
      avvisi.successo(`Import #${imp.id} eliminato (${r.data.righe_eliminate} righe)`)
      carica()
      onImportato()
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore durante l\'eliminazione'))
    }
  }

  const azioni = admin && <Button size="sm" onClick={() => setModale(true)}>⬆ Importa export gestionale</Button>

  return (
    <Card title={`Storico import — ${struttura}`} actions={azioni}>
      {errore && <Messaggio>{errore}</Messaggio>}
      {!storico && !errore && <Loading />}
      {storico?.length === 0 && <StatoVuoto>Nessun import per questa struttura.</StatoVuoto>}
      {storico?.length > 0 && (
        <Table compact>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Data</Th>
              <Th>File</Th>
              <Th>Mesi nel file</Th>
              <Th>Mesi in vigore</Th>
              <Th>Esito</Th>
              <Th>Utente</Th>
              <Th>Note</Th>
              {admin && <Th></Th>}
            </tr>
          </thead>
          <tbody>
            {storico.map(i => (
              <tr key={i.id} className={i.periodi_in_vigore.length ? undefined : 'ui-riga-attenuata'}>
                <Td>{i.id}</Td>
                <Td style={{ whiteSpace: 'nowrap' }}>
                  {i.created_at ? new Date(i.created_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                </Td>
                <Td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {i.ha_xlsx
                      ? <Button size="sm" variant="ghost" onClick={() => scaricaOriginale(i, 'xlsx')}>⬇ {i.nome_file_xlsx}</Button>
                      : <span>{i.nome_file_xlsx}</span>}
                    {i.nome_file_csv && (i.ha_csv
                      ? <Button size="sm" variant="ghost" onClick={() => scaricaOriginale(i, 'csv')}>⬇ {i.nome_file_csv}</Button>
                      : <span>{i.nome_file_csv}</span>)}
                  </div>
                </Td>
                <Td>{periodiCompatti(i.periodi)}</Td>
                <Td>{i.periodi_in_vigore.length ? periodiCompatti(i.periodi_in_vigore) : 'sostituito'}</Td>
                <Td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <Badge tono={i.quadratura_ok ? 'ok' : 'err'}>{i.quadratura_ok ? 'quadra' : 'non quadra'}</Badge>
                    {i.csv_arricchito && <Badge tono="info">CSV</Badge>}
                    {i.avvisi.length > 0 && <Badge tono="warn" title={i.avvisi.join('\n')}>{i.avvisi.length} avvisi</Badge>}
                  </div>
                </Td>
                <Td>{i.utente || '—'}</Td>
                <Td>{i.note || ''}</Td>
                {admin && (
                  <Td><Button size="sm" variant="danger-soft" onClick={() => elimina(i)}>Elimina</Button></Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="ui-text-muted" style={{ marginTop: 8 }}>
        Ogni import sostituisce i mesi che contiene: «Mesi in vigore» indica quali mesi del report vengono
        ancora da quell'import. Gli importi vengono sempre dall'xlsx (con i decimali), il CSV aggiunge solo
        gli identificativi di conti e reparti.
      </p>

      {modale && (
        <ModaleImport strutture={strutture} onChiudi={() => setModale(false)}
          onImportato={() => { setModale(false); carica(); onImportato() }} />
      )}
    </Card>
  )
}
