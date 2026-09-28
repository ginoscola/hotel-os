import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client.js'
import { mostraErrore } from '../../utils/format.js'
import {
  Badge, Button, Card, KpiTile, Loading, Messaggio, Modal, PageHeader, SegmentedControl, SezioneApribile, Table, Td, Th,
  useAvvisi,
} from '../../components/ui'
import { colors } from '../../styles/tokens.js'

function formatDataOra(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const BADGE_ESITO = {
  success: { label: 'SUCCESSO', tono: 'ok' },
  partial: { label: 'PARZIALE', tono: 'warn' },
  error:   { label: 'ERRORE',   tono: 'err' },
}

function BadgeEsito({ esito }) {
  const b = BADGE_ESITO[esito] || { label: esito || '—', tono: 'neutral' }
  return <Badge tono={b.tono}>{b.label}</Badge>
}

const CLASSE_RIGA_ESITO = { error: 'ui-riga-errore', partial: 'ui-riga-avviso' }

// Blocco di comandi da copiare (fondo scuro, carattere a spaziatura fissa)
const stilePre = {
  background: colors.textStrong, color: colors.border, padding: 12, borderRadius: 6,
  fontSize: 'var(--fs-sm)', overflowX: 'auto', margin: 0, whiteSpace: 'pre',
}

export default function AdminBackup() {
  const [status, setStatus] = useState(null)
  const [logs, setLogs] = useState([])
  const [files, setFiles] = useState([])
  const [filtroEsito, setFiltroEsito] = useState('')
  const [eseguendo, setEseguendo] = useState(false)
  const avvisi = useAvvisi()
  const [setupAperto, setSetupAperto] = useState(false)
  const [modalFile, setModalFile] = useState(null)
  const [istruzioni, setIstruzioni] = useState(null)
  const [erroreIstruzioni, setErroreIstruzioni] = useState(null)

  const carica = useCallback(() => {
    api.get('/admin/backup/status').then(r => setStatus(r.data)).catch(() => {})
    api.get('/admin/backup/logs', { params: { limit: 30, esito: filtroEsito || undefined } })
      .then(r => setLogs(r.data)).catch(() => {})
    api.get('/admin/backup/files').then(r => setFiles(r.data)).catch(() => {})
  }, [filtroEsito])

  useEffect(() => { carica() }, [carica])

  async function eseguiOra() {
    setEseguendo(true)
    try {
      const { data } = await api.post('/admin/backup/esegui-ora')
      avvisi.successo(data.messaggio)
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore nell\'avvio del backup.'))
    } finally {
      setEseguendo(false)
    }
  }

  async function apriIstruzioni(nome) {
    setModalFile(nome); setIstruzioni(null); setErroreIstruzioni(null)
    try {
      const { data } = await api.post(`/admin/backup/ripristina/${encodeURIComponent(nome)}`)
      setIstruzioni(data)
    } catch (e) {
      setErroreIstruzioni(mostraErrore(e, 'Errore nel recupero delle istruzioni.'))
    }
  }

  const u = status?.ultimo_backup
  const ok = (v) => v ? '✅' : '❌'

  return (
    <div>
      <PageHeader title="Backup automatico">
        <Button onClick={eseguiOra} disabled={eseguendo}>{eseguendo ? 'Avvio in corso…' : 'Esegui adesso'}</Button>
      </PageHeader>

      {/* Card stato */}
      <Card style={{ marginBottom: 24 }}>
        {!status && <Loading />}
        {status && (
          <>
            <div className="ui-kpi-row">
              <KpiTile label="Ultimo backup" value={u ? formatDataOra(u.timestamp) : 'Nessuno'} minWidth={190}
                sub={u ? <BadgeEsito esito={u.esito} /> : null} />
              {u && <KpiTile label="DB" value={`${u.dump_size_mb} MB`} minWidth={110} />}
              {u && <KpiTile label="Durata" value={`${u.durata_secondi}s`} minWidth={110} />}
              {u && <KpiTile label="Raspberry" value={ok(u.raspberry_ok)} minWidth={110} />}
              {u && <KpiTile label="GitHub" value={ok(u.github_ok)} minWidth={110} />}
              <KpiTile label="Prossimo backup" value={`stanotte ore ${status.prossimo_backup}`} minWidth={190} />
            </div>
            <div className="ui-text-muted" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 'var(--fs-base)' }}>
              <span>Scheduler: {status.scheduler_attivo ? '✅ attivo' : '⚠️ non caricato'}</span>
              <span>Raspberry raggiungibile ora: {ok(status.raspberry_raggiungibile)}</span>
              <span>Backup locali presenti: {status.backup_locali}</span>
            </div>
          </>
        )}
      </Card>

      {/* Tabella log */}
      <Card title="Storico backup (ultimi 30)" style={{ marginBottom: 24 }}
        actions={
          <SegmentedControl value={filtroEsito} onChange={setFiltroEsito} options={[
            { value: '', label: 'Tutti' },
            { value: 'success', label: 'Successo' },
            { value: 'partial', label: 'Parziale' },
            { value: 'error', label: 'Errore' },
          ]} />
        }>
        <Table compact>
          <thead>
            <tr><Th>Data/Ora</Th><Th center>Esito</Th><Th num>DB (MB)</Th><Th center>Raspberry</Th><Th center>GitHub</Th><Th num>Durata</Th><Th>Note</Th></tr>
          </thead>
          <tbody>
            {logs.length === 0 && <tr><Td colSpan={7} center muted>Nessun record.</Td></tr>}
            {logs.map((r, i) => (
              <tr key={i} className={CLASSE_RIGA_ESITO[r.esito]}>
                <Td style={{ whiteSpace: 'nowrap' }}>{formatDataOra(r.timestamp)}</Td>
                <Td center><BadgeEsito esito={r.esito} /></Td>
                <Td num>{r.dump_size_mb}</Td>
                <Td center>{ok(r.raspberry_ok)}</Td>
                <Td center>{ok(r.github_ok)}</Td>
                <Td num>{r.durata_secondi}s</Td>
                <Td style={{ color: colors.textMuted }}>{r.errore || '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* File locali */}
      <Card title="File locali" style={{ marginBottom: 24 }}>
        <Table compact>
          <thead><tr><Th>Nome</Th><Th num>Dimensione (MB)</Th><Th>Data</Th><Th /></tr></thead>
          <tbody>
            {files.length === 0 && <tr><Td colSpan={4} center muted>Nessun file presente.</Td></tr>}
            {files.map(f => (
              <tr key={f.nome}>
                <Td><code>{f.nome}</code></Td>
                <Td num>{f.dimensione_mb}</Td>
                <Td style={{ whiteSpace: 'nowrap' }}>{formatDataOra(f.data_creazione)}</Td>
                <Td center><Button variant="secondary" size="sm" onClick={() => apriIstruzioni(f.nome)}>Istruzioni ripristino</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* Setup */}
      <Card>
        <SezioneApribile titolo="Configurazione iniziale (da fare una volta)" aperta={setupAperto} onToggle={() => setSetupAperto(a => !a)}>
          <ol style={{ margin: 0, lineHeight: 1.8, fontSize: 'var(--fs-base)', color: colors.textSecond }}>
            <li>
              Crea un repository GitHub privato:<br />
              → vai su github.com → New repository → nome: <code>hotelos-backup</code> → Private ✓<br />
              → NON inizializzare con README
            </li>
            <li>
              Verifica che la chiave SSH esistente abbia accesso al nuovo repo (già usata per hotel-os, non serve crearne una nuova).
            </li>
            <li>
              Installa il backup automatico (timer systemd, ogni notte alle 03:00):<br />
              <code>sudo cp deploy/hotelos-backup.service deploy/hotelos-backup.timer /etc/systemd/system/</code><br />
              <code>sudo systemctl daemon-reload && sudo systemctl enable --now hotelos-backup.timer</code>
            </li>
            <li>Testa subito:<br /><code>bash scripts/test-backup.sh</code></li>
            <li>Verifica stato:<br /><code>bash scripts/verifica-backup.sh</code></li>
          </ol>
        </SezioneApribile>
      </Card>

      {/* Modal istruzioni ripristino */}
      {modalFile && (
        <Modal titolo={`Ripristino — ${modalFile}`} onChiudi={() => setModalFile(null)} larghezza={600}
          footer={<Button variant="secondary" onClick={() => setModalFile(null)}>Chiudi</Button>}>
          <div style={{ whiteSpace: 'normal' }}>
            <Messaggio tipo="err">{erroreIstruzioni}</Messaggio>
            {!erroreIstruzioni && !istruzioni && <Loading />}
            {istruzioni && (
              <>
                <Messaggio tipo="err"><strong>⚠️ {istruzioni.avvertenza}</strong></Messaggio>
                <div style={{ marginBottom: 12 }}>
                  <div className="ui-text-muted" style={{ marginBottom: 4 }}>Comando di ripristino</div>
                  <pre style={stilePre}>{istruzioni.comando_ripristino}</pre>
                </div>
                <div>
                  <div className="ui-text-muted" style={{ marginBottom: 4 }}>Comando di verifica</div>
                  <pre style={stilePre}>{istruzioni.comando_verifica}</pre>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
