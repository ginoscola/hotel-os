import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { mostraErrore } from '../utils/format'
import { Button, Loading, Messaggio, SectionTitle, useAvvisi, useConferma } from '../components/ui'

export default function TabTest({ onPulito }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cancellando, setCancellando] = useState(false)
  const avvisi = useAvvisi()
  const conferma = useConferma()

  const carica = useCallback(async () => {
    try {
      const { data } = await api.get('/corrispettivi/admin/test-stats')
      setStats(data)
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { carica() }, [carica])

  const cancella = async () => {
    if (!(await conferma({
      titolo: 'Eliminare tutti i dati di test corrispettivi?',
      messaggio: `${stats?.totale} record.`,
      pericolo: true,
    }))) return
    setCancellando(true)
    try {
      await api.delete('/corrispettivi/admin/test-data?conferma=true')
      avvisi.successo('Dati di test eliminati.')
      carica()
      onPulito()
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore'))
    } finally {
      setCancellando(false)
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <SectionTitle as="h3">Gestione dati di test</SectionTitle>
      {loading ? <Loading /> : stats && (
        <Messaggio tipo="warn">
          <strong>Dati di test presenti nel database:</strong>
          <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
            <li>Import: {stats.imports}</li>
            <li>Documenti: {stats.documenti}</li>
            <li>Manuali: {stats.manuali}</li>
            <li><strong>Totale: {stats.totale}</strong></li>
          </ul>
        </Messaggio>
      )}
      <Button variant="danger" onClick={cancella} disabled={cancellando || (stats?.totale === 0)}>
        {cancellando ? 'Eliminazione…' : 'Elimina tutti i dati di test'}
      </Button>
    </div>
  )
}
