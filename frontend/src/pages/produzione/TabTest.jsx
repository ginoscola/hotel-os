import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { mostraErrore } from '../../utils/format'
import { fmtD } from '../../utils/produzioneHelpers'
import { Button, Loading, Messaggio, SectionTitle, useAvvisi, useConferma } from '../../components/ui'

export default function TabTest({ onPulito }) {
  const [imports, setImports] = useState([])
  const [loading, setLoading] = useState(true)
  const [cancellando, setCancellando] = useState(false)
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    try {
      const { data } = await api.get('/produzione/import/storico', { params: { is_test: true } })
      setImports(data)
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { carica() }, [carica])

  const totaleRighe = imports.reduce((s, i) => s + i.n_righe_valide, 0)

  const cancella = async () => {
    if (!(await conferma({
      titolo: 'Eliminare tutti gli import di test Produzione?',
      messaggio: `${imports.length} import, ${totaleRighe} righe.`,
      pericolo: true,
    }))) return
    setCancellando(true)
    try {
      for (const imp of imports) {
        await api.delete(`/produzione/import/${imp.id}?conferma=true`)
      }
      avvisi.successo('Dati di test eliminati.')
      carica()
      onPulito?.()
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore'))
    } finally {
      setCancellando(false)
    }
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <SectionTitle as="h3">Gestione dati di test — Statistiche Produzione</SectionTitle>
      {loading ? <Loading /> : (
        <Messaggio tipo="warn">
          <strong>Import di test presenti nel database:</strong>
          {imports.length === 0 ? (
            <div style={{ marginTop: 6 }}>Nessuno.</div>
          ) : (
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
              {imports.map(i => (
                <li key={i.id}>{i.nome_file} — {fmtD(i.data_da)}–{fmtD(i.data_a)} ({i.n_righe_valide} righe)</li>
              ))}
              <li><strong>Totale: {imports.length} import, {totaleRighe} righe</strong></li>
            </ul>
          )}
        </Messaggio>
      )}
      <Button variant="danger" onClick={cancella} disabled={cancellando || imports.length === 0}>
        {cancellando ? 'Eliminazione…' : 'Elimina tutti gli import di test'}
      </Button>
    </div>
  )
}
