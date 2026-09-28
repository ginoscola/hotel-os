import { useState } from 'react'
import api from '../api/client.js'
import { formatData, mostraErrore } from '../utils/format.js'
import {
  Badge, Button, Card, Checkbox, Field, HotelTag, Input, KpiTile, Messaggio, PageHeader, Table, Td, Th,
} from '../components/ui'
import { colors } from '../styles/tokens.js'

// Esito di ogni coppia di file → tono del badge
const TONO_STATO = { importato: 'ok', saltato: 'info', errore: 'err' }

export default function ImportBulk() {
  const [cartella, setCartella] = useState('')
  const [anno, setAnno] = useState(new Date().getFullYear())
  const [isTest, setIsTest] = useState(false)
  const [loading, setLoading] = useState(false)
  const [risultato, setRisultato] = useState(null)
  const [errore, setErrore] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!cartella.trim()) { setErrore('Inserisci il percorso della cartella.'); return }

    setLoading(true)
    setRisultato(null)
    setErrore(null)

    try {
      const params = new URLSearchParams({ cartella: cartella.trim(), anno, is_test: isTest })
      const { data } = await api.post(`/upload/bulk?${params}`)
      setRisultato(data)
    } catch (err) {
      setErrore(mostraErrore(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PageHeader title="Import massivo da cartella" />

      <Card style={{ maxWidth: 620, marginBottom: 24 }}>
        <p className="ui-text-muted" style={{ marginTop: 0 }}>
          Scansiona una cartella sul server e importa automaticamente tutte le coppie
          di file CSV/Excel trovate. I file già importati vengono saltati.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Percorso cartella (assoluto sul server)" style={{ width: '100%' }}>
            <Input type="text" value={cartella} onChange={e => setCartella(e.target.value)}
              placeholder="es. /srv/progetti/hotel-os/uploads" style={{ width: '100%' }} />
          </Field>
          <Field label="Anno stagionale">
            <Input type="number" value={anno} onChange={e => setAnno(Number(e.target.value))}
              min={2020} max={2099} style={{ width: 120 }} />
          </Field>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Checkbox checked={isTest} onChange={setIsTest} label="Dati di test (cancellabili dall'area Admin)" />
            {isTest && <Badge tono="warn">TEST</Badge>}
          </div>
          <div>
            <Button type="submit" disabled={loading}>
              {loading ? 'Importazione in corso…' : 'Avvia import massivo'}
            </Button>
          </div>
        </form>
      </Card>

      {errore && <div style={{ maxWidth: 620 }}><Messaggio tipo="err" onChiudi={() => setErrore(null)}>{errore}</Messaggio></div>}

      {risultato && <RisultatoBulk r={risultato} />}
    </div>
  )
}

function RisultatoBulk({ r }) {
  return (
    <div style={{ maxWidth: 960 }}>
      <Card title={`Riepilogo — ${r.cartella}`} style={{ marginBottom: 20 }}>
        <div className="ui-kpi-row" style={{ marginBottom: 0 }}>
          <KpiTile label="File trovati" value={r.file_trovati} minWidth={120} />
          <KpiTile label="Coppie trovate" value={r.coppie_trovate} minWidth={120} />
          <KpiTile label="Importate" value={r.coppie_importate} colore={colors.successText} minWidth={120} />
          <KpiTile label="Saltate" value={r.coppie_saltate} colore={colors.infoText} minWidth={120} />
          <KpiTile label="Errori" value={r.coppie_errore} colore={colors.dangerText} minWidth={120} />
        </div>
      </Card>

      {r.risultati.length > 0 && (
        <Card title="Dettaglio per coppia">
          <Table compact>
            <thead>
              <tr>
                <Th>Hotel</Th><Th>Snapshot</Th><Th>File 1</Th><Th>File 2</Th><Th center>Stato</Th>
                <Th num>Inserite</Th><Th num>Aggiornate</Th><Th num>Scartate</Th><Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {r.risultati.map((res, i) => (
                <tr key={i}>
                  <Td><HotelTag code={res.hotel_code} /></Td>
                  <Td style={{ whiteSpace: 'nowrap' }}>{formatData(res.snapshot_date)}</Td>
                  <Td muted style={{ fontSize: 'var(--fs-sm)' }}>{res.file1_nome}</Td>
                  <Td muted style={{ fontSize: 'var(--fs-sm)' }}>{res.file2_nome}</Td>
                  <Td center><Badge tono={TONO_STATO[res.stato] || 'neutral'}>{res.stato}</Badge></Td>
                  <Td num>{res.righe_inserite || '—'}</Td>
                  <Td num>{res.righe_aggiornate || '—'}</Td>
                  <Td num>{res.righe_scartate || '—'}</Td>
                  <Td muted style={{ fontSize: 'var(--fs-sm)' }}>{res.motivo || ''}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}
