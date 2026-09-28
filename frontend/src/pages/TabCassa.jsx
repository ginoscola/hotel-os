import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { formatEuro, mostraErrore } from '../utils/format'
import { isAdmin, fmtD, meseNome } from '../utils/corrispettiviHelpers'
import {
  Button, Card, Field, Input, Loading, Messaggio, Select, Table, Td, Th, useConferma,
} from '../components/ui'
import { colors } from '../styles/tokens.js'

const annoCorrente = new Date().getFullYear()
const oggiIso = new Date().toISOString().slice(0, 10)

const TIPI = [
  ['versamento', 'Versamento in banca', colors.danger],
  ['rettifica', 'Rettifica (± contante)', colors.warning],
  ['saldo_iniziale', 'Saldo iniziale', colors.info],
]
const tipoLabel = t => (TIPI.find(x => x[0] === t) || [t, t])[1]
const tipoColore = t => (TIPI.find(x => x[0] === t) || [t, t, colors.textMuted])[2]

const FORM_VUOTO = { id: null, tipo: 'versamento', data: oggiIso, importo: '', note: '' }

export default function TabCassa() {
  const [anno, setAnno] = useState(annoCorrente)
  const [riep, setRiep] = useState(null)
  const [movimenti, setMovimenti] = useState([])
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  const [form, setForm] = useState(FORM_VUOTO)
  const [saving, setSaving] = useState(false)
  const admin = isAdmin()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    setLoading(true)
    setErrore(null)
    try {
      const [r, m] = await Promise.all([
        api.get('/corrispettivi/cassa/riepilogo', { params: { anno } }),
        api.get('/corrispettivi/cassa/movimenti', { params: { anno } }),
      ])
      setRiep(r.data)
      setMovimenti(m.data)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore nel caricamento'))
    } finally {
      setLoading(false)
    }
  }, [anno])

  useEffect(() => { carica() }, [carica])

  const salva = async () => {
    if (!form.importo && form.importo !== 0) { setErrore('Inserire un importo'); return }
    if (form.tipo !== 'rettifica' && (parseFloat(form.importo) || 0) < 0) {
      setErrore(`L'importo di un ${tipoLabel(form.tipo).toLowerCase()} non può essere negativo (usa "Rettifica" per un'uscita di contante).`)
      return
    }
    setSaving(true)
    setErrore(null)
    try {
      const body = {
        tipo: form.tipo, data: form.data,
        importo: parseFloat(form.importo) || 0, note: form.note || null,
      }
      if (form.id) await api.put(`/corrispettivi/cassa/movimenti/${form.id}`, body)
      else await api.post('/corrispettivi/cassa/movimenti', body)
      setForm(FORM_VUOTO)
      carica()
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore salvataggio'))
    } finally {
      setSaving(false)
    }
  }

  const elimina = async (id) => {
    if (!(await conferma({ titolo: 'Eliminare questo movimento?', pericolo: true }))) return
    try {
      await api.delete(`/corrispettivi/cassa/movimenti/${id}`)
      if (form.id === id) setForm(FORM_VUOTO)
      carica()
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore eliminazione'))
    }
  }

  const modifica = (m) => setForm({
    id: m.id, tipo: m.tipo, data: m.data, importo: String(m.importo), note: m.note || '',
  })

  const t = riep?.totali || {}
  // Dal più recente in alto al più vecchio in fondo (il saldo iniziale resta ultimo).
  const movimentiOrdinati = [...movimenti].sort(
    (a, b) => b.data.localeCompare(a.data) || b.id - a.id
  )
  const vuoto = <span style={{ color: colors.borderStrong }}>—</span>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <Field label="Anno">
          <Select value={anno} onChange={e => setAnno(Number(e.target.value))}>
            {[2024, 2025, 2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
          </Select>
        </Field>
      </div>

      {loading && <Loading />}
      <Messaggio tipo="err" onChiudi={() => setErrore(null)}>{errore}</Messaggio>

      {!loading && riep && (
        <>
          {/* Card saldo corrente */}
          <div style={{
            background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-light))', color: '#fff',
            borderRadius: 12, padding: 24, marginBottom: 24, maxWidth: 480, boxShadow: 'var(--shadow-card)',
          }}>
            <div style={{ fontSize: 'var(--fs-sm)', opacity: 0.85, marginBottom: 4 }}>
              Cassa contante disponibile {anno}
            </div>
            <div className="ui-num" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.5px' }}>
              {formatEuro(riep.saldo_corrente)}
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', opacity: 0.8, marginTop: 8 }}>
              {riep.saldo_iniziale
                ? `Saldo iniziale ${formatEuro(riep.saldo_iniziale.importo)} al 1° ${meseNome(new Date(riep.saldo_iniziale.data).getMonth() + 1)} ${new Date(riep.saldo_iniziale.data).getFullYear()}`
                : 'Nessun saldo iniziale impostato — il progressivo parte da 0'}
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', opacity: 0.8, marginTop: 4 }}>
              + {formatEuro(t.contante_incassato || 0)} incassato · − {formatEuro(t.versamenti || 0)} versato
              {t.rettifiche ? ` · ${t.rettifiche > 0 ? '+' : '−'} ${formatEuro(Math.abs(t.rettifiche))} rettifiche` : ''}
            </div>
          </div>

          {/* Tabella mensile */}
          <Card title="Movimento cassa per mese" style={{ marginBottom: 24 }}>
            {riep.mesi.length === 0 ? (
              <p className="ui-text-muted" style={{ fontStyle: 'italic' }}>Nessun dato per l'anno {anno}.</p>
            ) : (
              <Table compact minWidth={520}>
                <thead>
                  <tr>
                    <Th>Mese</Th>
                    <Th num>Contante incassato</Th>
                    <Th num>Versamenti</Th>
                    <Th num>Rettifiche</Th>
                    <Th num tot>Saldo fine mese</Th>
                  </tr>
                </thead>
                <tbody>
                  {riep.mesi.map(m => (
                    <tr key={m.mese}>
                      <Td>{meseNome(m.mese)}</Td>
                      <Td num>{formatEuro(m.contante_incassato)}</Td>
                      <Td num style={{ color: m.versamenti ? colors.danger : undefined }}>
                        {m.versamenti ? '− ' + formatEuro(m.versamenti) : vuoto}
                      </Td>
                      <Td num style={{ color: m.rettifiche ? colors.warning : undefined }}>
                        {m.rettifiche ? (m.rettifiche > 0 ? '+ ' : '− ') + formatEuro(Math.abs(m.rettifiche)) : vuoto}
                      </Td>
                      <Td num tot style={{ fontWeight: 700 }}>{formatEuro(m.saldo_fine_mese)}</Td>
                    </tr>
                  ))}
                  <tr className="ui-riga-totale">
                    <Td>TOTALE</Td>
                    <Td num>{formatEuro(t.contante_incassato || 0)}</Td>
                    <Td num>− {formatEuro(t.versamenti || 0)}</Td>
                    <Td num>{(t.rettifiche || 0) >= 0 ? '+ ' : '− '}{formatEuro(Math.abs(t.rettifiche || 0))}</Td>
                    <Td num tot style={{ fontWeight: 800 }}>{formatEuro(riep.saldo_corrente)}</Td>
                  </tr>
                </tbody>
              </Table>
            )}
            <p className="ui-text-muted" style={{ marginTop: 12, marginBottom: 0, fontStyle: 'italic', fontSize: 'var(--fs-xs)' }}>
              «Contante incassato» = riga Contante della tab Tipo Incasso (DPH/CLB/INT + MMS/BON).
              Include l'eventuale tassa di soggiorno pagata in contanti (denaro fisicamente in cassa,
              da girare al Comune).
            </p>
          </Card>

          {/* Gestione movimenti (admin) */}
          {admin && (
            <Card title={form.id ? 'Modifica movimento' : 'Aggiungi movimento'}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <Field label="Tipo">
                  <Select value={form.tipo} onChange={e => setForm(f => {
                    // Solo la rettifica accetta il segno: passando a versamento/saldo iniziale
                    // normalizzo un eventuale importo negativo rimasto da una bozza di rettifica.
                    const tipo = e.target.value
                    const importo = tipo !== 'rettifica' && f.importo
                      ? String(Math.abs(parseFloat(f.importo) || 0))
                      : f.importo
                    return { ...f, tipo, importo }
                  })}>
                    {TIPI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
                <Field label="Data">
                  <Input type="date" value={form.data} onChange={e => setForm(f => ({ ...f, data: e.target.value }))} />
                </Field>
                <Field label={`Importo ${form.tipo === 'rettifica' ? '(± con segno)' : '(solo positivo)'}`}>
                  <Input type="number" step="0.01" min={form.tipo === 'rettifica' ? undefined : '0'}
                    value={form.importo} placeholder="0.00" className="ui-num"
                    onChange={e => setForm(f => ({ ...f, importo: e.target.value }))}
                    style={{ width: 130, textAlign: 'right' }} />
                </Field>
                <Field label="Note" style={{ flex: '1 1 180px' }}>
                  <Input type="text" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={{ width: '100%' }} />
                </Field>
                <Button onClick={salva} disabled={saving}>
                  {saving ? '…' : form.id ? 'Salva' : 'Aggiungi'}
                </Button>
                {form.id && <Button variant="secondary" onClick={() => setForm(FORM_VUOTO)}>Annulla</Button>}
              </div>
              {form.tipo === 'saldo_iniziale' && (
                <p className="ui-text-muted" style={{ margin: '8px 0 0', fontSize: 'var(--fs-xs)' }}>
                  Il saldo iniziale viene registrato al 1° del mese della data indicata.
                </p>
              )}

              <Table compact minWidth={480} style={{ marginTop: 20 }}>
                <thead>
                  <tr>
                    <Th>Data</Th>
                    <Th>Tipo</Th>
                    <Th num>Importo</Th>
                    <Th>Note</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {movimentiOrdinati.length === 0 && (
                    <tr><Td colSpan={5} muted style={{ fontStyle: 'italic' }}>Nessun movimento.</Td></tr>
                  )}
                  {movimentiOrdinati.map(m => (
                    <tr key={m.id} className={form.id === m.id ? 'ui-riga-evidenza' : undefined}>
                      <Td>{fmtD(m.data)}</Td>
                      <Td style={{ color: tipoColore(m.tipo), fontWeight: 600 }}>{tipoLabel(m.tipo)}</Td>
                      <Td num>{formatEuro(m.importo)}</Td>
                      <Td style={{ color: colors.textMuted }}>{m.note || '—'}</Td>
                      <Td center style={{ whiteSpace: 'nowrap' }}>
                        <Button variant="secondary" size="sm" onClick={() => modifica(m)}>Modifica</Button>
                        <Button variant="danger-soft" size="sm" onClick={() => elimina(m.id)} style={{ marginLeft: 6 }}>Elimina</Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
