import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { mostraErrore } from '../utils/format'
import { isAdmin, fmtD } from '../utils/corrispettiviHelpers'
import {
  Badge, Button, Checkbox, DropZone, Loading, Messaggio, SectionTitle, SegmentedControl, StatoVuoto,
  Table, Td, Th, useAvvisi, useConferma,
} from '../components/ui'

export default function TabImport({ onImportato }) {
  const [caricamento, setCaricamento] = useState(false)
  const [esito, setEsito] = useState(null)
  const [isTest, setIsTest] = useState(false)
  const [onConflict, setOnConflict] = useState('salta')
  const [storico, setStorico] = useState([])
  const [loadStor, setLoadStor] = useState(true)
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const caricaStorico = useCallback(async () => {
    try {
      const { data } = await api.get('/corrispettivi/import/storico')
      setStorico(data)
    } catch { /* ignora */ }
    finally { setLoadStor(false) }
  }, [])

  useEffect(() => { caricaStorico() }, [caricaStorico])

  const gestisciFile = async (file) => {
    if (!file) return
    if (!file.name.toLowerCase().match(/\.(xlsx|xls)$/)) {
      setEsito({ ok: false, msg: 'Seleziona un file Excel (.xlsx)' })
      return
    }
    setCaricamento(true)
    setEsito(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const { data } = await api.post(
        `/corrispettivi/import?is_test=${isTest}&on_conflict=${onConflict}`,
        form, { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      const strutStr = data.strutture?.join(', ') || '—'
      const parts = [`${data.n_inseriti} inseriti`]
      if (data.n_aggiornati) parts.push(`${data.n_aggiornati} aggiornati`)
      if (data.n_saltati) parts.push(`${data.n_saltati} saltati (già presenti)`)
      if (data.n_protetti) parts.push(`${data.n_protetti} protetti (modificati manualmente)`)
      if (data.n_esclusi) parts.push(`${data.n_esclusi} esclusi (CP/FD)`)
      setEsito({
        ok: true,
        msg: `Import completato: ${parts.join(', ')}`,
        sub: `Strutture: ${strutStr} · Periodo: ${fmtD(data.periodo?.da)} – ${fmtD(data.periodo?.a)}`,
        warnings: data.warnings,
      })
      caricaStorico()
      onImportato()
    } catch (err) {
      setEsito({ ok: false, msg: mostraErrore(err) })
    } finally {
      setCaricamento(false)
    }
  }

  const eliminaImport = async (id) => {
    if (!(await conferma({ titolo: 'Eliminare questa sessione di import?', pericolo: true }))) return
    try {
      await api.delete(`/corrispettivi/import/${id}?conferma=true`)
      caricaStorico()
      onImportato()
    } catch (err) { avvisi.errore(mostraErrore(err)) }
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <DropZone
        accept=".xlsx,.xls"
        onFile={gestisciFile}
        disabled={caricamento}
        icona={caricamento ? null : '📊'}
        titolo={caricamento ? 'Caricamento in corso…' : 'Trascina il file Excel esportato da Welcome PMS'}
        sottotitolo={caricamento ? null : 'Formato base (18 col.) o formato esteso con Tassa di soggiorno (36 col.) — oppure clicca per selezionare'}
      />

      <div style={{ display: 'flex', gap: 24, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Checkbox checked={isTest} onChange={setIsTest} label="Segna come dati di test" />
          {isTest && <Badge tono="warn">TEST</Badge>}
        </div>
        <SegmentedControl
          label="Se già presente:"
          value={onConflict}
          onChange={setOnConflict}
          options={[{ value: 'salta', label: 'Salta' }, { value: 'aggiorna', label: 'Aggiorna' }]}
        />
        {onConflict === 'aggiorna' && (
          <Badge tono="warn">I doc. modificati manualmente non vengono sovrascritti</Badge>
        )}
      </div>

      {esito && (
        <Messaggio tipo={esito.ok ? 'ok' : 'err'} onChiudi={() => setEsito(null)}>
          <strong>{esito.msg}</strong>
          {esito.sub && <div style={{ marginTop: 4, opacity: 0.85 }}>{esito.sub}</div>}
          {esito.warnings?.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer' }}>{esito.warnings.length} avvisi</summary>
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {esito.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}
        </Messaggio>
      )}

      <SectionTitle as="h3">Storico import</SectionTitle>
      {loadStor ? (
        <Loading />
      ) : storico.length === 0 ? (
        <StatoVuoto>Nessun import effettuato.</StatoVuoto>
      ) : (
        <Table compact>
          <thead>
            <tr>
              <Th>Data import</Th><Th>File</Th><Th>Periodo</Th><Th>Strutture</Th>
              <Th num>Scontrini</Th><Th num>Fatture</Th><Th num>Esclusi</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {storico.map(imp => (
              <tr key={imp.id}>
                <Td muted>{imp.created_at ? new Date(imp.created_at).toLocaleDateString('it-IT') : '—'}</Td>
                <Td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={imp.nome_file}>
                  {imp.nome_file || '—'}
                </Td>
                <Td style={{ whiteSpace: 'nowrap' }}>{fmtD(imp.data_da)} – {fmtD(imp.data_a)}</Td>
                <Td>{(imp.strutture_presenti || []).join(', ') || '—'}</Td>
                <Td num>{imp.n_scontrini}</Td>
                <Td num>{imp.n_fatture}</Td>
                <Td num style={{ color: imp.n_esclusi > 0 ? 'var(--color-warning-text)' : 'var(--color-text-subtle)' }}>{imp.n_esclusi}</Td>
                <Td center>
                  {isAdmin() && (
                    <Button variant="danger-soft" size="sm" onClick={() => eliminaImport(imp.id)}>Elimina</Button>
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
