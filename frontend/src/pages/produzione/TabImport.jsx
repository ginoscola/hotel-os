import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { mostraErrore } from '../../utils/format'
import { isAdmin, fmtD } from '../../utils/produzioneHelpers'
import {
  Badge, Button, Checkbox, DropZone, Loading, Messaggio, SectionTitle, StatoVuoto, Table, Td, Th,
  useAvvisi, useConferma,
} from '../../components/ui'

export default function TabImport({ onImportato }) {
  const [caricamento, setCaricamento] = useState(false)
  const [esito, setEsito] = useState(null)
  const [isTest, setIsTest] = useState(false)
  const [storico, setStorico] = useState([])
  const [loadStor, setLoadStor] = useState(true)
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const caricaStorico = useCallback(async () => {
    try {
      const [rTest, rReali] = await Promise.all([
        api.get('/produzione/import/storico', { params: { is_test: true } }),
        api.get('/produzione/import/storico', { params: { is_test: false } }),
      ])
      setStorico([...rReali.data, ...rTest.data].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)))
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
        `/produzione/import?is_test=${isTest}`,
        form, { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      const strutStr = data.strutture?.join(', ') || '—'
      const parts = [`${data.n_inserite} inserite`]
      if (data.n_saltate) parts.push(`${data.n_saltate} saltate (già presenti)`)
      if (data.n_righe_riassetto) parts.push(`${data.n_righe_riassetto} righe riassetto (salvate, escluse dai report)`)
      if (data.n_righe_escluse) parts.push(`${data.n_righe_escluse} righe escluse`)
      setEsito({
        ok: true,
        msg: `Import completato: ${parts.join(', ')}`,
        sub: `Strutture: ${strutStr} · Periodo: ${fmtD(data.periodo?.da)} – ${fmtD(data.periodo?.a)}`,
        warnings: data.warning,
      })
      caricaStorico()
      onImportato()
    } catch (err) {
      setEsito({ ok: false, msg: mostraErrore(err) })
    } finally {
      setCaricamento(false)
    }
  }

  const eliminaImport = async (imp) => {
    const ok = await conferma(imp.is_test
      ? { titolo: 'Eliminare questa sessione di import di test?', pericolo: true }
      : {
          titolo: `Eliminare l'import reale "${imp.nome_file}"?`,
          messaggio: `${imp.n_righe_valide} righe. Verranno rimossi anche tutti i dati collegati.`,
          pericolo: true,
        })
    if (!ok) return
    try {
      await api.delete(`/produzione/import/${imp.id}?conferma=true`)
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
        icona={caricamento ? null : '📈'}
        titolo={caricamento ? 'Caricamento in corso…' : 'Trascina il file StatisticheProduzione.xlsx esportato da Welcome PMS'}
        sottotitolo={caricamento ? null : 'Registro analitico riga-per-riga (diverso da listaConti.xlsx) — oppure clicca per selezionare'}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Checkbox checked={isTest} onChange={setIsTest} label="Segna come dati di test" />
        {isTest && <Badge tono="warn">TEST</Badge>}
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
              <Th num>Righe valide</Th><Th num>Riassetto</Th><Th num>Escluse</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {storico.map(imp => (
              <tr key={imp.id}>
                <Td muted>
                  {imp.created_at ? new Date(imp.created_at).toLocaleDateString('it-IT') : '—'}
                  {imp.is_test && <Badge tono="warn" style={{ marginLeft: 6 }}>TEST</Badge>}
                </Td>
                <Td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={imp.nome_file}>
                  {imp.nome_file || '—'}
                </Td>
                <Td style={{ whiteSpace: 'nowrap' }}>{fmtD(imp.data_da)} – {fmtD(imp.data_a)}</Td>
                <Td>{(imp.strutture_presenti || []).join(', ') || '—'}</Td>
                <Td num>{imp.n_righe_valide}</Td>
                <Td num>{imp.n_righe_riassetto}</Td>
                <Td num style={{ color: imp.n_righe_escluse > 0 ? 'var(--color-warning-text)' : 'var(--color-text-subtle)' }}>{imp.n_righe_escluse}</Td>
                <Td center>
                  {isAdmin() && (
                    <Button variant="danger-soft" size="sm" onClick={() => eliminaImport(imp)}>Elimina</Button>
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
