// Import degli estratti conto (XML CBI) con anteprima e conferma, storico degli import con file
// originali, e saldi inseriti a mano per carte di credito e prepagate.
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client.js'
import { colors } from '../../styles/tokens.js'
import { formatData, formatEuro, formatN, mostraErrore } from '../../utils/format.js'
import {
  Badge, Button, Card, DropZone, Field, Input, KpiTile, Loading, Messaggio, Modal, Select, StatoVuoto, Table, Td, Th,
  useAvvisi, useConferma,
} from '../../components/ui'
import { scarica } from '../usaliContabile/helpers.jsx'
import { BadgeCategoria, ETICHETTE_TIPO_CONTO, Importo, oggiISO } from './helpers.jsx'

const TIMEOUT_IMPORT = 120000

function ModaleAnteprima({ file, onChiudi, onImportato }) {
  const [anteprima, setAnteprima] = useState(null)
  const [errore, setErrore] = useState(null)
  const [note, setNote] = useState('')
  const [lavoro, setLavoro] = useState(true)
  const avvisi = useAvvisi()

  useEffect(() => {
    const fd = new FormData()
    fd.append('file', file)
    api.post('/tesoreria/import/anteprima', fd, { timeout: TIMEOUT_IMPORT })
      .then(r => setAnteprima(r.data))
      .catch(e => setErrore(mostraErrore(e, 'Errore nella lettura del file')))
      .finally(() => setLavoro(false))
  }, [file])

  async function conferma() {
    setLavoro(true); setErrore(null)
    try {
      const r = await api.post('/tesoreria/import/conferma', { token: anteprima.token, note: note || null },
        { timeout: TIMEOUT_IMPORT })
      avvisi.successo(`Import completato: ${r.data.n_nuovi} movimenti nuovi, ${r.data.n_saldi} saldi`)
      onImportato()
    } catch (e) {
      setErrore(mostraErrore(e, "Errore durante l'import"))
      setLavoro(false)
    }
  }

  const a = anteprima
  const footer = (
    <>
      <Button variant="secondary" onClick={onChiudi}>Annulla</Button>
      <Button onClick={conferma} disabled={!a || a.gia_importato || lavoro}>
        {lavoro && a ? 'Import in corso…' : 'Conferma import'}
      </Button>
    </>
  )

  return (
    <Modal titolo={`Importa estratto conto — ${file.name}`} onChiudi={onChiudi} footer={footer} larghezza={760}
      chiudiSuSfondo={false}>
      <Messaggio>{errore}</Messaggio>
      {!a ? (lavoro && <Loading testo="Lettura del file…" />) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {a.gia_importato && (
            <Messaggio tipo="warn">Questo file è già stato importato il {formatData(a.gia_importato.data?.slice(0, 10))}:
              nessuna modifica possibile.</Messaggio>
          )}
          {a.discrepanze.length > 0 && (
            <Messaggio tipo="err">
              Dopo l'import i saldi non tornerebbero con i movimenti in {a.discrepanze.length} punti
              (primo: dal {formatData(a.discrepanze[0].data_da)} al {formatData(a.discrepanze[0].data_a)},
              differenza {formatEuro(a.discrepanze[0].differenza)}): probabilmente manca un estratto conto
              di un periodo intermedio. Si può importare comunque e caricare poi il periodo mancante.
            </Messaggio>
          )}
          {a.avvisi.map((t, i) => <Messaggio key={i} tipo="warn">{t}</Messaggio>)}

          <div className="ui-kpi-row">
            <KpiTile label="Conto" value={a.conto.nome} sub={`${formatData(a.data_da)} – ${formatData(a.data_a)}`} />
            <KpiTile label="Movimenti nel file" value={formatN(a.n_movimenti)} />
            <KpiTile label="Nuovi" value={formatN(a.n_nuovi)} sub={formatEuro(a.importo_nuovi)} />
            <KpiTile label="Già presenti" value={formatN(a.n_gia_presenti)} />
            <KpiTile label="Saldo finale" value={formatEuro(a.saldo_finale)} />
          </div>

          {a.per_categoria.length > 0 && (
            <Table compact maxHeight="35vh">
              <thead><tr><Th>Classificazione dei nuovi movimenti</Th><Th num>N.</Th><Th num>Importo</Th></tr></thead>
              <tbody>
                {a.per_categoria.map(c => (
                  <tr key={c.categoria_id ?? 'x'} className={c.codice === 'da_classificare' ? 'ui-riga-avviso' : undefined}>
                    <Td><BadgeCategoria nome={c.nome} colore={c.colore} /></Td>
                    <Td num>{c.n}</Td>
                    <Td num><Importo v={c.importo} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {a.saldi_cambiati.length > 0 && (
            <Messaggio tipo="info">
              {a.saldi_cambiati.length} saldi già presenti cambieranno con quelli dell'estratto conto
              {a.saldi_cambiati.some(s => s.origine === 'manuale') && ' (compresi saldi inseriti a mano: vale la banca)'}.
            </Messaggio>
          )}
          <Field label="Note (facoltative)"><Input value={note} onChange={e => setNote(e.target.value)} /></Field>
        </div>
      )}
    </Modal>
  )
}

function SaldiManuali({ conti, puoModificare, onCambio }) {
  const manuali = conti.filter(c => !c.ha_import && c.attivo)
  const [saldi, setSaldi] = useState(null)
  const [nuovo, setNuovo] = useState({ conto_id: '', data: oggiISO(), saldo: '', note: '' })
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    try {
      setSaldi((await api.get('/tesoreria/saldi', { params: { origine: 'manuale', limite: 100 } })).data)
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [avvisi])
  useEffect(() => { carica() }, [carica])

  const contoScelto = manuali.find(c => String(c.id) === String(nuovo.conto_id))

  async function salva() {
    try {
      await api.post('/tesoreria/saldi', { ...nuovo, conto_id: Number(nuovo.conto_id), saldo: nuovo.saldo.replace(',', '.') })
      avvisi.successo('Saldo salvato')
      setNuovo({ ...nuovo, saldo: '', note: '' })
      carica(); onCambio()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function elimina(s) {
    if (!(await conferma({ titolo: 'Eliminare questo saldo?', pericolo: true }))) return
    try {
      await api.delete(`/tesoreria/saldi/${s.id}`)
      carica(); onCambio()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  return (
    <Card title="Saldi inseriti a mano (carte e prepagate)">
      <p className="ui-text-muted" style={{ marginBottom: 8 }}>
        Carte di credito: ogni mese il totale dell'estratto (AMEX «Importo dovuto», BCC «Saldo attuale»)
        con la data di chiusura. Quando la banca lo addebita la carta torna a zero da sola: non serve
        inserire zeri. Prepagate: la disponibilità, quando si vuole.
      </p>
      {puoModificare && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
          <Field label="Conto">
            <Select value={nuovo.conto_id} onChange={e => setNuovo({ ...nuovo, conto_id: e.target.value })}>
              <option value="">— scegli —</option>
              {manuali.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
          </Field>
          <Field label={contoScelto?.tipo === 'carta_credito' ? "Data di chiusura dell'estratto" : 'Al giorno'}>
            <Input type="date" value={nuovo.data} onChange={e => setNuovo({ ...nuovo, data: e.target.value })} />
          </Field>
          <Field label={contoScelto?.tipo === 'carta_credito' ? "Totale dell'estratto (€)" : 'Saldo (€)'}>
            <Input value={nuovo.saldo} inputMode="decimal" style={{ width: 140 }}
              onChange={e => setNuovo({ ...nuovo, saldo: e.target.value })} />
          </Field>
          <Field label="Note"><Input value={nuovo.note} onChange={e => setNuovo({ ...nuovo, note: e.target.value })} /></Field>
          <Button onClick={salva} disabled={!nuovo.conto_id || !nuovo.data || nuovo.saldo === ''}>Salva saldo</Button>
        </div>
      )}
      {!saldi ? <Loading /> : saldi.length === 0 ? <StatoVuoto>Nessun saldo inserito.</StatoVuoto> : (
        <Table compact maxHeight="40vh">
          <thead><tr><Th>Conto</Th><Th>Tipo</Th><Th>Data</Th><Th num>Saldo</Th><Th>Note</Th><Th></Th></tr></thead>
          <tbody>
            {saldi.map(s => {
              const c = conti.find(x => x.id === s.conto_id)
              return (
                <tr key={s.id}>
                  <Td>{c?.nome}</Td>
                  <Td muted>{ETICHETTE_TIPO_CONTO[c?.tipo] || '—'}</Td>
                  <Td>{formatData(s.data)}</Td>
                  <Td num>{formatEuro(s.saldo)}</Td>
                  <Td muted>{s.note || ''}</Td>
                  <Td>{puoModificare && <Button size="sm" variant="danger-soft" onClick={() => elimina(s)}>Elimina</Button>}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

export default function TabImport({ conti, permessi, onCambio }) {
  const [storico, setStorico] = useState(null)
  const [file, setFile] = useState(null)
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    try { setStorico((await api.get('/tesoreria/import')).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [avvisi])
  useEffect(() => { carica() }, [carica])

  async function elimina(i) {
    if (!(await conferma({
      titolo: `Eliminare l'import di «${i.nome_file}»?`,
      messaggio: `Spariscono i ${i.n_collegati} movimenti che questo file ha inserito per primo (anche se un ` +
        'file caricato dopo li conteneva) e i saldi che ha scritto. Per riaverli va ricaricato il file.',
      pericolo: true,
    }))) return
    try {
      const r = await api.delete(`/tesoreria/import/${i.id}`, { params: { conferma: true } })
      avvisi.successo(`Import eliminato: ${r.data.movimenti_eliminati} movimenti, ${r.data.saldi_eliminati} saldi`)
      carica(); onCambio()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {permessi.puo_importare && (
        <Card title="Importa estratto conto">
          <DropZone accept=".xml" icona="🏦" onFile={setFile}
            titolo="Trascina qui l'estratto conto XML (formato CBI) o clicca per sceglierlo"
            sottotitolo="Il conto si riconosce dall'IBAN. I movimenti già caricati vengono saltati: si possono ricaricare periodi sovrapposti." />
        </Card>
      )}

      <Card title="Import caricati">
        {!storico ? <Loading /> : storico.length === 0 ? <StatoVuoto>Nessun import.</StatoVuoto> : (
          <Table compact maxHeight="50vh">
            <thead>
              <tr>
                <Th>Caricato</Th><Th>Conto</Th><Th>File</Th><Th>Periodo</Th>
                <Th num>Nuovi</Th><Th num>Già presenti</Th><Th>Utente</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {storico.map(i => (
                <tr key={i.id}>
                  <Td style={{ whiteSpace: 'nowrap' }}>{formatData(i.created_at?.slice(0, 10))}</Td>
                  <Td>{i.conto_nome}</Td>
                  <Td>
                    {i.nome_file}
                    {i.avvisi.length > 0 && <> <Badge tono="warn" title={i.avvisi.join('\n')}>avvisi</Badge></>}
                  </Td>
                  <Td style={{ whiteSpace: 'nowrap' }}>{formatData(i.data_da)} – {formatData(i.data_a)}</Td>
                  <Td num>{i.n_nuovi}</Td>
                  <Td num style={{ color: colors.textMuted }}>{i.n_gia_presenti}</Td>
                  <Td muted>{i.utente || '—'}</Td>
                  <Td style={{ whiteSpace: 'nowrap' }}>
                    {i.ha_file && (
                      <Button size="sm" variant="ghost"
                        onClick={() => scarica(`/tesoreria/import/${i.id}/file`, {}, i.nome_file).catch(e => avvisi.errore(mostraErrore(e)))}>
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
      </Card>

      <SaldiManuali conti={conti} puoModificare={permessi.puo_modificare} onCambio={onCambio} />

      {file && (
        <ModaleAnteprima file={file} onChiudi={() => setFile(null)}
          onImportato={() => { setFile(null); carica(); onCambio() }} />
      )}
    </div>
  )
}
