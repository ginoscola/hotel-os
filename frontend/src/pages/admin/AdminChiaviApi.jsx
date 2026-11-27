import { useState, useEffect, useCallback } from 'react'
import api, { API_URL } from '../../api/client.js'
import { copiaTesto, formatData, mostraErrore, oggiIso } from '../../utils/format.js'
import {
  Badge, Button, Card, Field, Input, Loading, Messaggio, Modal, PageHeader, Select, StatoVuoto, Table, Td, Th,
  useAvvisi, useConferma,
} from '../../components/ui'
import { colors } from '../../styles/tokens.js'

// Gli agenti (bot Grok, in futuro Claude) chiamano l'indirizzo pubblico, non quello di rete locale
const URL_PUBBLICO = import.meta.env.VITE_API_URL || API_URL

function formatDataOra(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function statoChiave(k) {
  if (!k.attiva) return { label: 'Revocata', tono: 'err' }
  if (k.scade_il && k.scade_il < oggiIso()) return { label: 'Scaduta', tono: 'warn' }
  return { label: 'Attiva', tono: 'ok' }
}

const stilePre = {
  background: colors.textStrong, color: colors.border, padding: 12, borderRadius: 6,
  fontSize: 'var(--fs-sm)', overflowX: 'auto', margin: 0, whiteSpace: 'pre',
}

export default function AdminChiaviApi() {
  const [chiavi, setChiavi] = useState([])
  const [utenti, setUtenti] = useState([])
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState(null)
  const [form, setForm] = useState({ user_id: '', nome: '', scade_il: '' })
  const [salvando, setSalvando] = useState(false)
  const [nuova, setNuova] = useState(null)   // chiave appena creata: in chiaro solo qui
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    try {
      setLoading(true)
      const { data } = await api.get('/admin/chiavi-api')
      setChiavi(data)
      setErrore(null)
    } catch (e) {
      setErrore(mostraErrore(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    carica()
    api.get('/admin/utenti')
      .then(r => setUtenti(r.data.filter(u => u.ruolo !== 'admin' && u.attivo)))
      .catch(() => { /* lista di supporto: l'errore lo segnala già il caricamento delle chiavi */ })
  }, [carica])

  async function crea(e) {
    e.preventDefault()
    setSalvando(true)
    try {
      const { data } = await api.post('/admin/chiavi-api', {
        user_id: Number(form.user_id), nome: form.nome, scade_il: form.scade_il || null,
      })
      setNuova(data)
      setForm({ user_id: '', nome: '', scade_il: '' })
      carica()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setSalvando(false)
    }
  }

  async function revoca(k) {
    const ok = await conferma({
      titolo: 'Revocare la chiave?',
      messaggio: `"${k.nome}" (${k.prefisso}…) smetterà di funzionare subito e non si potrà riattivare.`,
      confermaLabel: 'Revoca', pericolo: true,
    })
    if (!ok) return
    try {
      await api.post(`/admin/chiavi-api/${k.id}/revoca`)
      avvisi.successo('Chiave revocata')
      carica()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    }
  }

  async function copia(testo) {
    try {
      await copiaTesto(testo)
      avvisi.successo('Chiave copiata')
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Copia non riuscita: selezionala e copiala a mano.'))
    }
  }

  const pieno = { width: '100%' }

  return (
    <div>
      {nuova && (
        <Modal
          titolo={`Nuova chiave — ${nuova.nome}`}
          onChiudi={() => setNuova(null)}
          chiudiSuSfondo={false}
          larghezza={560}
          footer={<Button onClick={() => setNuova(null)}>Ho copiato la chiave</Button>}
        >
          <div style={{ whiteSpace: 'normal', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Messaggio tipo="warn">
              Copiala ora: è l&apos;unica volta che viene mostrata. HotelOS ne salva solo un&apos;impronta e non può recuperarla.
            </Messaggio>
            <pre style={{ ...stilePre, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{nuova.chiave}</pre>
            <div><Button variant="secondary" onClick={() => copia(nuova.chiave)}>Copia chiave</Button></div>
          </div>
        </Modal>
      )}

      <PageHeader
        title="Accessi agenti AI"
        subtitle="Chiavi API per gli agenti (bot Grok, in futuro Claude): leggono i dati senza login e senza passare dall'interfaccia."
      />

      <Card title="Nuova chiave" style={{ marginBottom: 20 }}>
        <form onSubmit={crea}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 12 }}>
            <Field label="Utente dell'agente *" style={pieno}>
              <Select value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))} required style={pieno}>
                <option value="">— scegli —</option>
                {utenti.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
              </Select>
            </Field>
            <Field label="Nome *" style={pieno}>
              <Input type="text" value={form.nome} placeholder="es. Bot Grok" maxLength={100} required
                onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} style={pieno} />
            </Field>
            <Field label="Valida fino al (facoltativo)" style={pieno}>
              <Input type="date" value={form.scade_il} min={oggiIso()}
                onChange={e => setForm(f => ({ ...f, scade_il: e.target.value }))} style={pieno} />
            </Field>
          </div>
          <p className="ui-text-muted" style={{ marginTop: 0 }}>
            La chiave vale come l&apos;utente scelto (vede i moduli abilitati in Utenti → Permessi), ma è sempre in
            sola lettura e non apre mai l&apos;area Admin. Gli utenti admin non sono selezionabili.
          </p>
          <Button type="submit" disabled={salvando}>{salvando ? 'Creazione…' : 'Crea chiave'}</Button>
        </form>
      </Card>

      <Card title="Chiavi" style={{ marginBottom: 20 }}>
        {errore && <Messaggio>{errore}</Messaggio>}
        {loading ? <Loading /> : chiavi.length === 0 ? <StatoVuoto>Nessuna chiave creata.</StatoVuoto> : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th><Th>Utente</Th><Th>Chiave</Th><Th>Creata</Th><Th>Ultimo uso</Th><Th>Scadenza</Th><Th>Stato</Th><Th />
              </tr>
            </thead>
            <tbody>
              {chiavi.map(k => {
                const s = statoChiave(k)
                return (
                  <tr key={k.id}>
                    <Td>{k.nome}</Td>
                    <Td>{k.username}</Td>
                    <Td><code>{k.prefisso}…</code></Td>
                    <Td>{formatDataOra(k.created_at)}</Td>
                    <Td>{formatDataOra(k.ultimo_uso)}</Td>
                    <Td>{k.scade_il ? formatData(k.scade_il) : 'nessuna'}</Td>
                    <Td><Badge tono={s.tono}>{s.label}</Badge></Td>
                    <Td>{k.attiva && <Button size="sm" variant="danger" onClick={() => revoca(k)}>Revoca</Button>}</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Come la usa l'agente">
        <div style={{ whiteSpace: 'normal', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0 }}>
            Indirizzo: <code>{URL_PUBBLICO}</code> — la chiave va nell&apos;intestazione <code>X-API-Key</code> di ogni chiamata.
            L&apos;elenco completo degli endpoint, leggibile dall&apos;agente, è in <code>{URL_PUBBLICO}/openapi.json</code>.
          </p>
          <pre style={stilePre}>{`curl -H "X-API-Key: hos_..." ${URL_PUBBLICO}/hotels/`}</pre>
          <p className="ui-text-muted" style={{ margin: 0 }}>
            Solo richieste GET: ogni scrittura riceve 403. Chiave revocata, scaduta o utente disattivato → 401.
          </p>
        </div>
      </Card>
    </div>
  )
}
