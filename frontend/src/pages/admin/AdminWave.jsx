import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client.js'
import { formatEuro, mostraErrore } from '../../utils/format.js'
import { NOMI, meseNome } from '../../utils/corrispettiviHelpers.js'
import {
  Badge, Button, Card, DropZone, Field, Input, Loading, Messaggio, Modal, NavAnno, PageHeader,
  SegmentedControl, Select, StatoVuoto, Table, Td, Th, useAvvisi, useConferma,
} from '../../components/ui'

const STRUTTURE = ['DPH', 'CLB', 'INT', 'MMS', 'BON']
const MESI_WAVE = [4, 5, 6, 7, 8, 9]
const PRIMO_ANNO_HOTELOS = 2026

/** Indice WAVE — storico del fatturato 2022–2025 (import dal file Excel, correzioni a mano) e riferimento
 * per periodo calcolato da HotelOS (services/wave.py). */
export default function AdminWave() {
  const [struttura, setStruttura] = useState('DPH')
  // incrementato a ogni modifica dello storico, per ricaricare il riferimento
  const [versione, setVersione] = useState(0)
  const aggiornato = () => setVersione(v => v + 1)
  return (
    <div>
      <PageHeader title="Indice WAVE — storico e riferimento">
        <SegmentedControl
          options={STRUTTURE.map(s => ({ value: s, label: s }))}
          value={struttura} onChange={setStruttura}
        />
      </PageHeader>
      <p className="ui-text-muted" style={{ fontSize: 'var(--fs-base)', maxWidth: 820, marginTop: -8 }}>
        Riferimento di un periodo = miglior fatturato (netto IVA, senza tassa di soggiorno, per data documento)
        ottenuto in quel periodo negli anni precedenti. Fino al {PRIMO_ANNO_HOTELOS - 1} i valori vengono dallo
        storico qui sotto; dal {PRIMO_ANNO_HOTELOS} dai Corrispettivi (arrangiamenti ÷ 1,10), e un anno conta
        solo a stagione chiusa.
      </p>
      <Riferimento struttura={struttura} versione={versione} />
      <Storico struttura={struttura} versione={versione} onModificato={aggiornato} />
      <ImportStorico onImportato={aggiornato} />
    </div>
  )
}

function Riferimento({ struttura, versione }) {
  const [anno, setAnno] = useState(() => new Date().getFullYear())
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    setDati(null)
    api.get(`/wave/riferimento?anno=${anno}`)
      .then(r => { setDati(r.data); setErrore(null) })
      .catch(e => setErrore(mostraErrore(e)))
  }, [anno, versione])

  const s = dati?.strutture.find(x => x.struttura_code === struttura)
  return (
    <Card
      title={`Riferimento per il ${anno} — ${NOMI[struttura]}`}
      actions={<NavAnno anno={anno} onChange={setAnno} />}
      style={{ marginBottom: 20 }}
    >
      {errore && <Messaggio tipo="err">{errore}</Messaggio>}
      {!dati && !errore && <Loading />}
      {s && !s.anni.length && <StatoVuoto>Nessun dato per questa struttura.</StatoVuoto>}
      {s && s.anni.length > 0 && (
        <>
          <Table compact>
            <thead>
              <tr>
                <Th>Periodo</Th>
                {s.anni.map(a => (
                  <Th num key={a.anno}>
                    {a.anno}
                    {a.in_corso && <> <Badge tono="warn">in corso</Badge></>}
                    {!a.concorre && !a.in_corso && <> <Badge>non concorre</Badge></>}
                  </Th>
                ))}
                <Th num tot>Riferimento</Th>
                <Th>Anno del record</Th>
              </tr>
            </thead>
            <tbody>
              {s.periodi.map(p => (
                <tr key={p.periodo}>
                  <Td>{p.etichetta}</Td>
                  {s.anni.map(a => {
                    const v = p.valori[a.anno]
                    const record = a.anno === p.anno_record
                    return (
                      <Td num key={a.anno} muted={!a.concorre} style={record ? { fontWeight: 700 } : undefined}>
                        {v != null ? formatEuro(v) : '—'}
                      </Td>
                    )
                  })}
                  <Td num tot>{p.riferimento != null ? formatEuro(p.riferimento) : '—'}</Td>
                  <Td>{p.anno_record ?? '—'}</Td>
                </tr>
              ))}
              <tr className="ui-riga-totale">
                <Td>Stagione</Td>
                {s.anni.map(a => <Td num key={a.anno}>{a.stagione != null ? formatEuro(a.stagione) : '—'}</Td>)}
                <Td num tot>{s.riferimento_stagione != null ? formatEuro(s.riferimento_stagione) : '—'}</Td>
                <Td>somma dei migliori</Td>
              </tr>
            </tbody>
          </Table>
          <p className="ui-text-muted" style={{ marginTop: 6 }}>
            In grassetto l'anno del record di ogni periodo. Gli anni dal {anno} in poi e le stagioni ancora in
            corso sono mostrati per confronto ma non concorrono al riferimento del {anno}.
          </p>
        </>
      )}
    </Card>
  )
}

function Storico({ struttura, versione, onModificato }) {
  const [righe, setRighe] = useState(null)
  const [errore, setErrore] = useState(null)
  const [bozze, setBozze] = useState({})
  const [nuova, setNuova] = useState({ anno: '', mese: 6, netto: '' })
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(() => {
    api.get(`/wave/storico?struttura=${struttura}`)
      .then(r => { setRighe(r.data.righe); setErrore(null); setBozze({}) })
      .catch(e => setErrore(mostraErrore(e)))
  }, [struttura])

  useEffect(() => { setRighe(null); carica() }, [carica, versione])

  async function salva(r) {
    const testo = bozze[r.id]
    if (testo == null) return
    const valore = Number(String(testo).replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(valore) || valore < 0) {
      avvisi.errore('Importo non valido')
      return
    }
    if (Math.abs(valore - r.netto) < 0.005) {
      setBozze(b => { const { [r.id]: _, ...resto } = b; return resto })
      return
    }
    try {
      await api.put(`/wave/storico/${r.id}`, { netto: valore })
      avvisi.successo(`${meseNome(r.mese)} ${r.anno}: ${formatEuro(valore)}`)
      carica()
      onModificato()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    }
  }

  async function ripristina(r) {
    try {
      await api.put(`/wave/storico/${r.id}`, { ripristina: true })
      avvisi.successo(`${meseNome(r.mese)} ${r.anno}: ripristinato il valore del file`)
      carica()
      onModificato()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    }
  }

  async function elimina(r) {
    const ok = await conferma({
      titolo: 'Eliminare la riga?',
      messaggio: `${NOMI[struttura]}, ${meseNome(r.mese)} ${r.anno} (${formatEuro(r.netto)}). Il mese risulterà senza dati.`,
      pericolo: true,
    })
    if (!ok) return
    try {
      await api.delete(`/wave/storico/${r.id}?conferma=true`)
      carica()
      onModificato()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    }
  }

  async function aggiungi() {
    try {
      await api.post('/wave/storico', {
        struttura_code: struttura, anno: Number(nuova.anno), mese: Number(nuova.mese),
        netto: Number(String(nuova.netto).replace(/\./g, '').replace(',', '.')),
      })
      setNuova({ anno: '', mese: 6, netto: '' })
      carica()
      onModificato()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    }
  }

  return (
    <Card title={`Storico fino al ${PRIMO_ANNO_HOTELOS - 1} — ${NOMI[struttura]}`} style={{ marginBottom: 20 }}>
      <p className="ui-text-muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Netto IVA esclusa, senza tassa di soggiorno. Un valore corretto a mano (barra ambra) non viene più
        toccato dal reimport del file; "Ripristina" torna al valore del file.
      </p>
      {errore && <Messaggio tipo="err">{errore}</Messaggio>}
      {!righe && !errore && <Loading />}
      {righe && !righe.length && <StatoVuoto>Nessuna riga: importare il file Excel qui sotto.</StatoVuoto>}
      {righe && righe.length > 0 && (
        <Table compact>
          <thead>
            <tr>
              <Th>Anno</Th><Th>Mese</Th><Th num>Netto</Th><Th num>Lordo (IVA e tassa)</Th>
              <Th>Metodo</Th><Th>Fonte</Th><Th>Note</Th><Th />
            </tr>
          </thead>
          <tbody>
            {righe.map(r => (
              <tr key={r.id} className={r.modificato_manualmente ? 'ui-riga-modificata' : undefined}>
                <Td>{r.anno}</Td>
                <Td>{meseNome(r.mese)}</Td>
                <Td num>
                  <Input
                    style={{ width: 120, textAlign: 'right' }}
                    modificato={bozze[r.id] != null}
                    value={bozze[r.id] ?? r.netto.toFixed(2).replace('.', ',')}
                    onChange={e => setBozze(b => ({ ...b, [r.id]: e.target.value }))}
                    onBlur={() => salva(r)}
                    onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                  />
                </Td>
                <Td num muted>{r.lordo != null ? formatEuro(r.lordo) : '—'}</Td>
                <Td muted>{r.metodo ?? '—'}</Td>
                <Td muted>{r.fonte ?? '—'}</Td>
                <Td>
                  {r.note ?? ''}
                  {r.modificato_manualmente && r.netto_originale != null && (
                    <div className="ui-text-muted">Valore del file: {formatEuro(r.netto_originale)}</div>
                  )}
                </Td>
                <Td>
                  {r.modificato_manualmente && r.netto_originale != null && (
                    <Button size="sm" variant="ghost" onClick={() => ripristina(r)}>Ripristina</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => elimina(r)}>Elimina</Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 16 }}>
        <Field label="Anno">
          <Input style={{ width: 80 }} value={nuova.anno} placeholder="2024"
                 onChange={e => setNuova(n => ({ ...n, anno: e.target.value }))} />
        </Field>
        <Field label="Mese">
          <Select value={nuova.mese} onChange={e => setNuova(n => ({ ...n, mese: e.target.value }))}>
            {MESI_WAVE.map(m => <option key={m} value={m}>{meseNome(m)}</option>)}
          </Select>
        </Field>
        <Field label="Netto (€)">
          <Input style={{ width: 120 }} value={nuova.netto}
                 onChange={e => setNuova(n => ({ ...n, netto: e.target.value }))} />
        </Field>
        <Button variant="secondary" disabled={!nuova.anno || !nuova.netto} onClick={aggiungi}>
          Aggiungi mese mancante
        </Button>
      </div>
    </Card>
  )
}

function Elenco({ titolo, voci }) {
  if (!voci.length) return null
  return (
    <div style={{ marginTop: 10 }}>
      <strong>{titolo}</strong>
      <ul style={{ margin: '4px 0 0', paddingLeft: 20, maxHeight: 160, overflowY: 'auto' }}>
        {voci.map(v => <li key={v}>{v}</li>)}
      </ul>
    </div>
  )
}

function ImportStorico({ onImportato }) {
  const [file, setFile] = useState(null)
  const [anteprima, setAnteprima] = useState(null)
  const [inCorso, setInCorso] = useState(false)
  const avvisi = useAvvisi()

  async function invia(f, confermato) {
    const form = new FormData()
    form.append('file', f)
    setInCorso(true)
    try {
      const r = await api.post(`/wave/storico/import?conferma=${confermato}`, form)
      if (confermato) {
        avvisi.successo(`Storico importato: ${r.data.n_nuove} nuove, ${r.data.n_aggiornate} aggiornate`)
        setAnteprima(null)
        setFile(null)
        onImportato()
      } else {
        setFile(f)
        setAnteprima(r.data)
      }
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setInCorso(false)
    }
  }

  const cambia = anteprima && (anteprima.n_nuove + anteprima.n_aggiornate) > 0
  return (
    <Card title="Import del file Excel">
      <DropZone
        accept=".xlsx"
        titolo="Trascina qui Storico_fatturato_WAVE_2022-2025.xlsx"
        sottotitolo={`Foglio "Storico", colonna Netto. Anni dal ${PRIMO_ANNO_HOTELOS} e mesi fuori da aprile–settembre ignorati.`}
        disabled={inCorso}
        onFile={f => invia(f, false)}
      />
      {anteprima && (
        <Modal
          titolo={`Anteprima — ${anteprima.nome_file}`}
          larghezza={640}
          onChiudi={() => setAnteprima(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setAnteprima(null)}>Annulla</Button>
            <Button disabled={!cambia || inCorso} onClick={() => invia(file, true)}>Conferma import</Button>
          </>}
        >
          <p style={{ marginTop: 0 }}>
            Righe lette: <strong>{anteprima.righe_lette}</strong> · nuove {anteprima.n_nuove} · aggiornate{' '}
            {anteprima.n_aggiornate} · invariate {anteprima.n_invariate} · corrette a mano (non toccate){' '}
            {anteprima.n_bloccate}
          </p>
          {!cambia && <Messaggio tipo="info">Nessuna modifica rispetto ai dati già presenti.</Messaggio>}
          <Elenco titolo="Nuove" voci={anteprima.nuove} />
          <Elenco titolo="Aggiornate" voci={anteprima.aggiornate} />
          <Elenco titolo="Corrette a mano, non toccate" voci={anteprima.bloccate} />
          <Elenco titolo="Avvisi" voci={anteprima.avvisi} />
        </Modal>
      )}
    </Card>
  )
}
