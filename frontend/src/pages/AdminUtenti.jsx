import { useState, useEffect, useCallback } from 'react'
import api from '../api/client.js'
import { mostraErrore } from '../utils/format.js'
import {
  Badge, Button, Card, Field, Input, Loading, Messaggio, Modal, PageHeader, Select, Table, Td, Th,
  useAvvisi, useConferma,
} from '../components/ui'
import { colors } from '../styles/tokens.js'

const RUOLI = ['admin', 'viewer']

export default function AdminUtenti() {
  const [utenti, setUtenti]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [errore, setErrore]     = useState(null)

  // Form nuovo utente
  const [mostraForm, setMostraForm] = useState(false)
  const [form, setForm]             = useState({ username: '', email: '', password: '', ruolo: 'viewer' })
  const [salvando, setSalvando]     = useState(false)
  const [esitoForm, setEsitoForm]   = useState(null)

  // Reset password
  const [resetId, setResetId]           = useState(null)
  const [nuovaPassword, setNuovaPassword] = useState('')
  const [salvandoReset, setSalvandoReset] = useState(false)
  const [esitoReset, setEsitoReset]     = useState({})

  const avvisi = useAvvisi()
  const conferma = useConferma()

  // Modal modifica
  const [editUtente, setEditUtente]   = useState(null)
  const [editForm, setEditForm]       = useState({})
  const [salvandoEdit, setSalvandoEdit] = useState(false)
  const [esitoEdit, setEsitoEdit]     = useState(null)

  // Modal permessi
  const [permUtente, setPermUtente]   = useState(null)   // utente di cui si gestiscono i permessi
  const [permModuli, setPermModuli]   = useState([])     // [{module_code, module_name, module_icon, puo_vedere, default_vedere}]
  const [caricandoPerm, setCaricandoPerm] = useState(false)
  const [salvandoPerm, setSalvandoPerm]   = useState(false)
  const [esitoPerm, setEsitoPerm]         = useState(null)

  const caricaUtenti = useCallback(async () => {
    try {
      setLoading(true)
      const { data } = await api.get('/admin/utenti')
      setUtenti(data)
      setErrore(null)
    } catch (err) {
      setErrore(mostraErrore(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { caricaUtenti() }, [caricaUtenti])

  // ---- Crea utente ----
  async function handleCreaUtente(e) {
    e.preventDefault()
    setSalvando(true)
    setEsitoForm(null)
    try {
      await api.post('/admin/utenti', form)
      setEsitoForm({ ok: true, msg: `Utente "${form.username}" creato con successo.` })
      setForm({ username: '', email: '', password: '', ruolo: 'viewer' })
      setMostraForm(false)
      await caricaUtenti()
    } catch (err) {
      setEsitoForm({ ok: false, msg: mostraErrore(err) })
    } finally {
      setSalvando(false)
    }
  }

  // ---- Disattiva / riattiva ----
  async function toggleAttivo(utente) {
    try {
      await api.put(`/admin/utenti/${utente.id}`, { attivo: !utente.attivo })
      avvisi.successo(`${utente.username}: ${utente.attivo ? 'disattivato' : 'riattivato'}`)
      await caricaUtenti()
    } catch (err) {
      avvisi.errore(mostraErrore(err))
    }
  }

  // ---- Cambio ruolo inline ----
  async function cambiaRuolo(utente, nuovoRuolo) {
    try {
      await api.put(`/admin/utenti/${utente.id}`, { ruolo: nuovoRuolo })
      avvisi.successo(`${utente.username}: ruolo ${nuovoRuolo}`)
      await caricaUtenti()
    } catch (err) {
      avvisi.errore(mostraErrore(err))
    }
  }

  // ---- Reset password ----
  async function handleResetPassword(userId) {
    if (!nuovaPassword || nuovaPassword.length < 6) {
      setEsitoReset(prev => ({ ...prev, [userId]: { ok: false, msg: 'Password minimo 6 caratteri' } }))
      return
    }
    setSalvandoReset(true)
    try {
      await api.post(`/admin/utenti/${userId}/reset-password`, { password: nuovaPassword })
      setEsitoReset(prev => ({ ...prev, [userId]: { ok: true, msg: 'Password aggiornata' } }))
      setResetId(null)
      setNuovaPassword('')
    } catch (err) {
      setEsitoReset(prev => ({ ...prev, [userId]: { ok: false, msg: mostraErrore(err) } }))
    } finally {
      setSalvandoReset(false)
    }
  }

  // ---- Apri modal permessi ----
  async function apriPermessi(u) {
    setPermUtente(u)
    setPermModuli([])
    setEsitoPerm(null)
    setCaricandoPerm(true)
    try {
      const { data } = await api.get(`/admin/utenti/${u.id}/permessi`)
      setPermModuli(data)
    } catch (err) {
      setEsitoPerm({ ok: false, msg: mostraErrore(err, 'Errore caricamento permessi') })
    } finally {
      setCaricandoPerm(false)
    }
  }

  function togglePerm(code) {
    setPermModuli(prev => prev.map(m => m.module_code === code ? { ...m, puo_vedere: !m.puo_vedere } : m))
    setEsitoPerm(null)
  }

  async function salvaPerm() {
    setSalvandoPerm(true); setEsitoPerm(null)
    try {
      await api.put(`/admin/utenti/${permUtente.id}/permessi`,
        permModuli.map(m => ({ module_code: m.module_code, puo_vedere: m.puo_vedere }))
      )
      setEsitoPerm({ ok: true, msg: 'Permessi salvati' })
    } catch (err) {
      setEsitoPerm({ ok: false, msg: mostraErrore(err, 'Errore nel salvataggio') })
    } finally {
      setSalvandoPerm(false) }
  }

  // ---- Apri modal modifica ----
  function apriModifica(u) {
    setEditUtente(u)
    setEditForm({ username: u.username, email: u.email || '', ruolo: u.ruolo })
    setEsitoEdit(null)
  }

  // ---- Salva modifica ----
  async function handleSalvaModifica(e) {
    e.preventDefault()
    setSalvandoEdit(true)
    setEsitoEdit(null)
    try {
      await api.put(`/admin/utenti/${editUtente.id}`, {
        username: editForm.username,
        email: editForm.email || null,
        ruolo: editForm.ruolo,
      })
      setEsitoEdit({ ok: true, msg: 'Modifiche salvate' })
      await caricaUtenti()
      setTimeout(() => setEditUtente(null), 800)
    } catch (err) {
      setEsitoEdit({ ok: false, msg: mostraErrore(err) })
    } finally {
      setSalvandoEdit(false)
    }
  }

  // ---- Elimina utente ----
  async function handleElimina(u) {
    if (!(await conferma({
      titolo: `Eliminare definitivamente l'utente "${u.username}"?`,
      messaggio: 'Questa operazione non è reversibile.',
      pericolo: true,
    }))) return
    try {
      await api.delete(`/admin/utenti/${u.id}`)
      avvisi.successo(`Utente ${u.username} eliminato`)
      await caricaUtenti()
    } catch (err) {
      avvisi.errore(mostraErrore(err))
    }
  }

  const pieno = { width: '100%' }

  return (
    <div>
      {/* ── Modal modifica ── */}
      {editUtente && (
        <Modal
          titolo={`Modifica utente — ${editUtente.username}`}
          onChiudi={() => setEditUtente(null)}
          larghezza={440}
          footer={<>
            <Button variant="secondary" onClick={() => setEditUtente(null)}>Annulla</Button>
            <Button type="submit" form="form-modifica-utente" disabled={salvandoEdit}>{salvandoEdit ? 'Salvataggio…' : 'Salva modifiche'}</Button>
          </>}
        >
          <form id="form-modifica-utente" onSubmit={handleSalvaModifica} style={{ display: 'flex', flexDirection: 'column', gap: 14, whiteSpace: 'normal' }}>
            <Field label="Username *" style={pieno}>
              <Input type="text" value={editForm.username} onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))}
                required maxLength={50} style={pieno} />
            </Field>
            <Field label="Email" style={pieno}>
              <Input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} style={pieno} />
            </Field>
            <Field label="Ruolo *" style={pieno}>
              <Select value={editForm.ruolo} onChange={e => setEditForm(f => ({ ...f, ruolo: e.target.value }))} style={pieno}>
                {RUOLI.map(r => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            {esitoEdit && <Messaggio tipo={esitoEdit.ok ? 'ok' : 'err'}>{esitoEdit.msg}</Messaggio>}
          </form>
        </Modal>
      )}

      {/* ── Modal permessi moduli ── */}
      {permUtente && (
        <Modal
          titolo={`Permessi moduli — ${permUtente.username}`}
          onChiudi={() => setPermUtente(null)}
          larghezza={480}
          footer={<>
            <Button variant="secondary" onClick={() => setPermUtente(null)}>Chiudi</Button>
            <Button onClick={salvaPerm} disabled={salvandoPerm || caricandoPerm}>{salvandoPerm ? 'Salvataggio…' : 'Salva permessi'}</Button>
          </>}
        >
          <div style={{ whiteSpace: 'normal' }}>
            <p className="ui-text-muted" style={{ marginTop: 0 }}>
              Seleziona i moduli visibili per questo utente. Le modifiche sovrascrivono i permessi di ruolo solo dove diversi.
            </p>
            {caricandoPerm ? <Loading /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '50vh', overflowY: 'auto', marginBottom: 12 }}>
                {permModuli.map(m => {
                  const isOverride = m.puo_vedere !== m.default_vedere
                  return (
                    <label key={m.module_code} style={{
                      display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '9px 14px', borderRadius: 8,
                      background: isOverride ? colors.infoSoft : colors.surfaceSoft,
                      border: `1px solid ${isOverride ? colors.infoBg : colors.border}`,
                    }}>
                      <input type="checkbox" checked={m.puo_vedere} onChange={() => togglePerm(m.module_code)} />
                      <span style={{ fontSize: 18, lineHeight: 1 }}>{m.module_icon}</span>
                      <span style={{ fontWeight: 600, color: colors.text, flex: 1 }}>{m.module_name}</span>
                      {isOverride ? <Badge tono="info">override</Badge> : <span className="ui-text-muted" style={{ fontSize: 'var(--fs-xs)' }}>default ruolo</span>}
                    </label>
                  )
                })}
              </div>
            )}
            {esitoPerm && <Messaggio tipo={esitoPerm.ok ? 'ok' : 'err'}>{esitoPerm.msg}</Messaggio>}
          </div>
        </Modal>
      )}

      <PageHeader title="Gestione utenti">
        <Button variant={mostraForm ? 'secondary' : 'primary'} onClick={() => { setMostraForm(v => !v); setEsitoForm(null) }}>
          {mostraForm ? '✕ Annulla' : '+ Nuovo utente'}
        </Button>
      </PageHeader>

      {/* Form nuovo utente */}
      {mostraForm && (
        <Card title="Nuovo utente" style={{ marginBottom: 20 }}>
          <form onSubmit={handleCreaUtente}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 12 }}>
              <Field label="Username *" style={pieno}>
                <Input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  required maxLength={50} style={pieno} />
              </Field>
              <Field label="Email" style={pieno}>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={pieno} />
              </Field>
              <Field label="Password * (min 6)" style={pieno}>
                <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  required minLength={6} style={pieno} />
              </Field>
              <Field label="Ruolo *" style={pieno}>
                <Select value={form.ruolo} onChange={e => setForm(f => ({ ...f, ruolo: e.target.value }))} style={pieno}>
                  {RUOLI.map(r => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
            </div>
            {esitoForm && <Messaggio tipo={esitoForm.ok ? 'ok' : 'err'}>{esitoForm.msg}</Messaggio>}
            <Button type="submit" disabled={salvando}>{salvando ? 'Creazione…' : 'Crea utente'}</Button>
          </form>
        </Card>
      )}

      {!mostraForm && esitoForm?.ok && <Messaggio tipo="ok" onChiudi={() => setEsitoForm(null)}>{esitoForm.msg}</Messaggio>}

      {/* Tabella utenti */}
      {loading ? <Loading testo="Caricamento utenti…" /> : errore ? <Messaggio tipo="err">Errore: {errore}</Messaggio> : (
        <Table compact>
          <thead>
            <tr>
              <Th>Username</Th><Th>Email</Th><Th center>Ruolo</Th><Th center>Stato</Th>
              <Th>Creato il</Th><Th>Ultimo accesso</Th><Th>Azioni</Th>
            </tr>
          </thead>
          <tbody>
            {utenti.map(u => (
              <tr key={u.id} className={u.attivo ? undefined : 'ui-riga-attenuata'}>
                <Td style={{ fontWeight: 600 }}>{u.username}</Td>
                <Td style={{ color: colors.textMuted }}>{u.email || '—'}</Td>
                <Td center>
                  <Select value={u.ruolo} onChange={e => cambiaRuolo(u, e.target.value)} aria-label={`Ruolo di ${u.username}`}
                    style={{ padding: '2px 8px', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
                    {RUOLI.map(r => <option key={r} value={r}>{r}</option>)}
                  </Select>
                </Td>
                <Td center><Badge tono={u.attivo ? 'ok' : 'err'}>{u.attivo ? 'Attivo' : 'Disattivo'}</Badge></Td>
                <Td style={{ color: colors.textMuted, whiteSpace: 'nowrap' }}>{u.created_at ? new Date(u.created_at).toLocaleDateString('it-IT') : '—'}</Td>
                <Td style={{ color: colors.textMuted, whiteSpace: 'nowrap' }}>{u.last_login ? new Date(u.last_login).toLocaleString('it-IT') : 'Mai'}</Td>
                <Td>
                  {/* Reset password inline */}
                  {resetId === u.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Input type="password" placeholder="Nuova password" value={nuovaPassword}
                        onChange={e => setNuovaPassword(e.target.value)} minLength={6} style={{ width: 140 }} />
                      <Button size="sm" onClick={() => handleResetPassword(u.id)} disabled={salvandoReset}>{salvandoReset ? '…' : 'Salva'}</Button>
                      <Button variant="secondary" size="sm" onClick={() => { setResetId(null); setNuovaPassword('') }} aria-label="Annulla">✕</Button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Button variant="secondary" size="sm" onClick={() => apriModifica(u)}>Modifica</Button>
                      {u.ruolo !== 'admin' && <Button variant="secondary" size="sm" onClick={() => apriPermessi(u)}>Permessi</Button>}
                      <Button variant="secondary" size="sm"
                        onClick={() => { setResetId(u.id); setNuovaPassword(''); setEsitoReset(prev => ({ ...prev, [u.id]: null })) }}>
                        Reset pwd
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => toggleAttivo(u)}>{u.attivo ? 'Disattiva' : 'Riattiva'}</Button>
                      <Button variant="danger-soft" size="sm" onClick={() => handleElimina(u)}>Elimina</Button>
                    </div>
                  )}
                  {esitoReset[u.id] && (
                    <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, marginTop: 3, color: esitoReset[u.id].ok ? colors.success : colors.danger }}>
                      {esitoReset[u.id].msg}
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
