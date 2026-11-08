/**
 * Admin → Comune → Hotel e camere (v4.31.0).
 *
 * Hotel: nome e camere di default (proposte quando si crea una stagione; i KPI usano le camere
 * del PMS, le stagioni le loro). Camere: anagrafica che decide a quale hotel vanno gli addebiti
 * importati da Produzione e Corrispettivi (struttura_resolver) e che elenca le camere a zero in
 * Ricavi camere. Niente "Elimina": una camera dismessa si disattiva (resta legata allo storico).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../api/client.js'
import { mostraErrore } from '../../utils/format.js'
import { NOMI, STRUTTURE_HOTEL } from '../../utils/corrispettiviHelpers.js'
import {
  Badge, Button, Card, Checkbox, Field, HotelTag, Input, Loading, Messaggio, Modal, PageHeader, SegmentedControl, Select,
  StatoVuoto, Table, Td, Th, useAvvisi,
} from '../../components/ui'

const OPZIONI_STRUTTURA = [{ value: '', label: 'Tutte' }, ...STRUTTURE_HOTEL.map(sc => ({ value: sc, label: sc }))]

export default function AdminHotelCamere() {
  return (
    <div>
      <PageHeader title="Hotel e camere" subtitle="Anagrafica degli hotel del gruppo e delle loro camere" />
      <SezioneHotel />
      <SezioneCamere />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hotel
// ---------------------------------------------------------------------------

function SezioneHotel() {
  const [hotels, setHotels] = useState(null)
  const [form, setForm] = useState({})
  const [salvando, setSalvando] = useState(null)
  const avvisi = useAvvisi()

  const carica = useCallback(async () => {
    try {
      const { data } = await api.get('/hotels/')
      setHotels(data)
      setForm(Object.fromEntries(data.map(h => [h.code, { name: h.name, default_rooms: String(h.default_rooms) }])))
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [avvisi])

  useEffect(() => { carica() }, [carica])

  const modificato = h => form[h.code] && (form[h.code].name !== h.name || form[h.code].default_rooms !== String(h.default_rooms))

  async function salva(h) {
    const f = form[h.code]
    setSalvando(h.code)
    try {
      await api.put(`/hotels/${h.code}`, { name: f.name.trim(), default_rooms: Number(f.default_rooms) })
      avvisi.successo(`${f.name.trim()}: salvato`)
      await carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) } finally { setSalvando(null) }
  }

  return (
    <Card title="Hotel" style={{ marginBottom: 16 }}>
      <p className="ui-text-muted" style={{ marginTop: 0 }}>
        Le <b>camere di default</b> sono proposte quando si crea una nuova stagione e usate dal Budget se la stagione
        manca. Non cambiano i KPI (che usano le camere del PMS) né le stagioni già configurate (Admin → Stagioni operative).
      </p>
      {!hotels ? <Loading /> : (
        <Table compact>
          <thead><tr><Th>Codice</Th><Th>Nome</Th><Th num>Camere di default</Th><Th /></tr></thead>
          <tbody>
            {hotels.map(h => {
              const f = form[h.code] || {}
              const valido = f.name?.trim() && Number(f.default_rooms) >= 1
              return (
                <tr key={h.code}>
                  <Td><HotelTag code={h.code} /></Td>
                  <Td>
                    <Input value={f.name || ''} modificato={f.name !== h.name} style={{ width: '100%', minWidth: 200 }}
                      onChange={e => setForm(p => ({ ...p, [h.code]: { ...p[h.code], name: e.target.value } }))} />
                  </Td>
                  <Td num>
                    <Input type="number" min="1" max="999" className="ui-num" style={{ width: 80, textAlign: 'right' }}
                      value={f.default_rooms || ''} modificato={f.default_rooms !== String(h.default_rooms)}
                      onChange={e => setForm(p => ({ ...p, [h.code]: { ...p[h.code], default_rooms: e.target.value } }))} />
                  </Td>
                  <Td>
                    <Button size="sm" onClick={() => salva(h)} disabled={!modificato(h) || !valido || salvando === h.code}>
                      {salvando === h.code ? '…' : 'Salva'}
                    </Button>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Camere
// ---------------------------------------------------------------------------

function SezioneCamere() {
  const [camere, setCamere] = useState(null)
  const [struttura, setStruttura] = useState('')
  const [cerca, setCerca] = useState('')
  const [aperta, setAperta] = useState(null)   // null | {} (nuova) | camera da modificare
  const avvisi = useAvvisi()

  const carica = useCallback(async () => {
    try { setCamere((await api.get('/rooms/')).data) } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [avvisi])

  useEffect(() => { carica() }, [carica])

  const conteggi = useMemo(() => Object.fromEntries(STRUTTURE_HOTEL.map(sc => {
    const dell = (camere || []).filter(c => c.struttura_code === sc)
    return [sc, { totale: dell.length, attive: dell.filter(c => c.attiva).length }]
  })), [camere])

  const visibili = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    return (camere || []).filter(c => (!struttura || c.struttura_code === struttura)
      && (!q || c.code.toLowerCase().includes(q) || (c.nome_tipo || '').toLowerCase().includes(q) || (c.tipo_risorsa || '').toLowerCase().includes(q)))
  }, [camere, struttura, cerca])

  return (
    <Card title="Camere">
      <p className="ui-text-muted" style={{ marginTop: 0 }}>
        L'elenco decide a quale hotel vanno gli addebiti importati da Produzione e Corrispettivi (una camera non in elenco
        viene assegnata in base alla lettera iniziale). Una camera dismessa o virtuale si <b>disattiva</b>: continua ad
        assegnare all'hotel giusto gli addebiti che la nominano, ma non compare tra le camere a zero di Ricavi camere.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <SegmentedControl options={OPZIONI_STRUTTURA} value={struttura} onChange={setStruttura} />
        <Input placeholder="Cerca codice o tipo…" value={cerca} onChange={e => setCerca(e.target.value)} style={{ width: 200 }} />
        <span className="ui-text-muted" style={{ fontSize: 12 }}>
          {STRUTTURE_HOTEL.map(sc => `${sc} ${conteggi[sc]?.attive ?? 0}/${conteggi[sc]?.totale ?? 0}`).join(' · ')} attive
        </span>
        <span style={{ flex: 1 }} />
        <Button onClick={() => setAperta({})}>Nuova camera</Button>
      </div>
      {!camere ? <Loading /> : visibili.length === 0 ? <StatoVuoto>Nessuna camera trovata.</StatoVuoto> : (
        <Table compact>
          <thead>
            <tr>
              <Th>Codice</Th><Th>Hotel</Th><Th>Tipo</Th><Th>Nome tipo</Th><Th num>Piano</Th><Th num>Posti letto</Th>
              <Th num>Letti agg.</Th><Th>Stato</Th><Th>Note</Th><Th />
            </tr>
          </thead>
          <tbody>
            {visibili.map(c => (
              <tr key={c.code} className={c.attiva ? undefined : 'ui-riga-attenuata'}>
                <Td style={{ fontWeight: 600 }}>{c.code}</Td>
                <Td><HotelTag code={c.struttura_code} /></Td>
                <Td>{c.tipo_risorsa || '—'}</Td>
                <Td>{c.nome_tipo || '—'}</Td>
                <Td num>{c.piano ?? '—'}</Td>
                <Td num>{c.posti_letto ?? '—'}</Td>
                <Td num>{c.letti_aggiunti || '—'}</Td>
                <Td>{c.attiva ? <Badge tono="ok">attiva</Badge> : <Badge tono="neutral">disattivata</Badge>}</Td>
                <Td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.note || ''}>{c.note || ''}</Td>
                <Td><Button size="sm" variant="secondary" onClick={() => setAperta(c)}>Modifica</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {aperta && (
        <ModaleCamera camera={aperta.code ? aperta : null} strutturaIniziale={struttura || 'DPH'}
          onChiudi={() => setAperta(null)} onSalvata={() => { setAperta(null); carica() }} />
      )}
    </Card>
  )
}

const numOpz = v => (v === '' || v == null ? null : Number(v))

function ModaleCamera({ camera, strutturaIniziale, onChiudi, onSalvata }) {
  const nuova = !camera
  const [f, setF] = useState(() => ({
    code: camera?.code || '',
    struttura_code: camera?.struttura_code || strutturaIniziale,
    tipo_risorsa: camera?.tipo_risorsa || '',
    nome_tipo: camera?.nome_tipo || '',
    piano: camera?.piano ?? '',
    posti_letto: camera?.posti_letto ?? '',
    letti_aggiunti: camera?.letti_aggiunti ?? '',
    attiva: camera?.attiva ?? true,
    note: camera?.note || '',
  }))
  const [lavoro, setLavoro] = useState(false)
  const [errore, setErrore] = useState(null)
  const avvisi = useAvvisi()
  const set = patch => setF(p => ({ ...p, ...patch }))

  async function salva() {
    setLavoro(true); setErrore(null)
    const corpo = {
      tipo_risorsa: f.tipo_risorsa.trim() || null, nome_tipo: f.nome_tipo.trim() || null,
      piano: numOpz(f.piano), posti_letto: numOpz(f.posti_letto), letti_aggiunti: numOpz(f.letti_aggiunti),
      attiva: f.attiva, note: f.note.trim() || null,
    }
    try {
      if (nuova) await api.post('/rooms/', { ...corpo, code: f.code.trim(), struttura_code: f.struttura_code })
      else await api.put(`/rooms/${encodeURIComponent(camera.code)}`, corpo)
      avvisi.successo(`Camera ${(nuova ? f.code.trim() : camera.code).toUpperCase()} salvata`)
      onSalvata()
    } catch (e) { setErrore(mostraErrore(e)) } finally { setLavoro(false) }
  }

  const footer = (
    <>
      <Button variant="secondary" onClick={onChiudi}>Annulla</Button>
      <Button onClick={salva} disabled={lavoro || (nuova && !f.code.trim())}>{lavoro ? '…' : 'Salva'}</Button>
    </>
  )

  return (
    <Modal titolo={nuova ? 'Nuova camera' : `Modifica camera ${camera.code}`} onChiudi={onChiudi} footer={footer}
      larghezza={560} chiudiSuSfondo={false}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Codice (come nel PMS)">
          {nuova ? <Input value={f.code} onChange={e => set({ code: e.target.value })} placeholder="es. D410" autoFocus />
            : <Input value={camera.code} disabled />}
        </Field>
        <Field label="Hotel" style={{ gridColumn: 'span 2' }}>
          {nuova ? (
            <Select value={f.struttura_code} onChange={e => set({ struttura_code: e.target.value })}>
              {STRUTTURE_HOTEL.map(sc => <option key={sc} value={sc}>{NOMI[sc]}</option>)}
            </Select>
          ) : <Input value={NOMI[camera.struttura_code] || camera.struttura_code} disabled />}
        </Field>
        <Field label="Tipo (sigla)"><Input value={f.tipo_risorsa} onChange={e => set({ tipo_risorsa: e.target.value })} placeholder="es. D-COM" /></Field>
        <Field label="Nome tipo" style={{ gridColumn: 'span 2' }}><Input value={f.nome_tipo} onChange={e => set({ nome_tipo: e.target.value })} placeholder="es. comfort" /></Field>
        <Field label="Piano"><Input type="number" min="-5" max="20" value={f.piano} onChange={e => set({ piano: e.target.value })} /></Field>
        <Field label="Posti letto"><Input type="number" min="0" max="20" value={f.posti_letto} onChange={e => set({ posti_letto: e.target.value })} /></Field>
        <Field label="Letti aggiunti"><Input type="number" min="0" max="10" value={f.letti_aggiunti} onChange={e => set({ letti_aggiunti: e.target.value })} /></Field>
        <Field label="Note" style={{ gridColumn: 'span 3' }}><Input value={f.note} onChange={e => set({ note: e.target.value })} /></Field>
        <div style={{ gridColumn: 'span 3' }}>
          <Checkbox label="Camera attiva" checked={f.attiva} onChange={v => set({ attiva: v })} />
          <div className="ui-text-muted" style={{ fontSize: 12, marginTop: 4 }}>
            Disattivata: resta nello storico e continua ad assegnare all'hotel giusto gli addebiti che la nominano,
            ma non compare tra le camere a zero di Ricavi camere.
          </div>
        </div>
      </div>
      {nuova && (
        <p className="ui-text-muted" style={{ fontSize: 12 }}>
          Codice e hotel non si potranno cambiare: decidono a quale hotel vanno gli addebiti dei prossimi import.
        </p>
      )}
      <Messaggio tipo="err">{errore}</Messaggio>
    </Modal>
  )
}
