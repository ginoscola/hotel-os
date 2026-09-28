/**
 * TabStampanteRT — invio comandi X/Z e verifica raggiungibilità al registratore telematico Epson FP-81 II.
 * Chiamata diretta browser → stampante (nessun proxy backend): l'IP è letto da GET /rt-printers/,
 * dove più hotel possono condividere la stessa stampante (es. Du Parc + Club Hotel).
 * Il controllo "solo admin per Z" è applicato solo lato interfaccia (nessuna enforcement server-side,
 * dato che il browser parla direttamente con la stampante).
 */
import { useState, useEffect } from 'react'
import api from '../api/client'
import { mostraErrore } from '../utils/format'
import { Badge, Button, Messaggio, Modal, SectionTitle, StatoVuoto } from '../components/ui'
import { colors } from '../styles/tokens.js'

const CONFERMA_Z_DELAY_MS = 2000
const PING_TIMEOUT_MS = 3000

function buildSOAP(command) {
  const inner = command === 'Z' ? '<printZReport operator="1"/>' : '<printXReport operator="1"/>'
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <printerFiscalReport>${inner}</printerFiscalReport>
  </soapenv:Body>
</soapenv:Envelope>`
}

function urlStampante(ip) {
  return `http://${ip}/cgi-bin/fpmate.cgi?devid=local_printer&timeout=10000`
}

export default function TabStampanteRT({ isAdmin }) {
  const [stampanti, setStampanti] = useState([])
  const [caricamentoErrore, setCaricamentoErrore] = useState(null)
  const [selezionata, setSelezionata] = useState(null)
  const [comandoInCorso, setComandoInCorso] = useState(null)
  const [log, setLog] = useState([])
  const [dialogZ, setDialogZ] = useState(false)
  const [confermaAbilitata, setConfermaAbilitata] = useState(false)

  useEffect(() => {
    api.get('/rt-printers/')
      .then(({ data }) => { setStampanti(data); if (data.length) setSelezionata(data[0].id) })
      .catch(e => setCaricamentoErrore(mostraErrore(e)))
  }, [])

  const stampante = stampanti.find(s => s.id === selezionata) || null

  function aggiungiLog(messaggio, tipo = 'info') {
    setLog(prev => [
      ...prev.slice(-19),
      { ts: new Date().toLocaleTimeString('it-IT'), messaggio, tipo },
    ])
  }

  async function inviaComando(cmd) {
    if (!stampante) return
    setComandoInCorso(cmd)
    aggiungiLog(`→ ${cmd} su ${stampante.nome} (${stampante.ip})…`, 'info')
    try {
      // Content-Type 'text/plain' e nessun header custom: una richiesta "simple" CORS
      // non genera preflight OPTIONS. Con 'text/xml' + header SOAPAction il browser manda
      // prima una OPTIONS e poi la POST — se la fpmate.cgi non distingue i verbi HTTP,
      // il risultato è una stampa duplicata (causa del bug osservato in campo).
      const resp = await fetch(urlStampante(stampante.ip), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: buildSOAP(cmd),
      })
      const testo = await resp.text()
      aggiungiLog(`HTTP ${resp.status}`, resp.ok ? 'success' : 'error')

      const xml = new DOMParser().parseFromString(testo, 'text/xml')
      const risposta = xml.querySelector('response')
      if (risposta) {
        const success = risposta.getAttribute('success')
        const code = risposta.getAttribute('code')
        const status = risposta.getAttribute('status')
        if (success === 'true') {
          const msg = cmd === 'Z' ? 'Chiusura fiscale completata' : 'Report X stampato correttamente'
          aggiungiLog(`✅ ${msg}`, 'success')
        } else {
          aggiungiLog(`❌ Errore RT: ${code || 'sconosciuto'} (status ${status || '—'})`, 'error')
        }
      } else {
        aggiungiLog(`Risposta non riconosciuta: ${testo.slice(0, 200)}`, 'info')
      }
    } catch (err) {
      aggiungiLog(`❌ RT non raggiungibile — verifica rete/VPN (${err.message})`, 'error')
    } finally {
      setComandoInCorso(null)
    }
  }

  async function verificaStato() {
    if (!stampante) return
    setComandoInCorso('STATUS')
    aggiungiLog(`→ Verifica raggiungibilità ${stampante.nome} (${stampante.ip})…`, 'info')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
    try {
      // 'no-cors': non serve leggere la risposta, solo sapere se la connessione TCP va a buon fine —
      // niente comandi SOAP inviati, quindi nessuna stampa fisica generata sull'RT.
      await fetch(`http://${stampante.ip}/`, { mode: 'no-cors', signal: controller.signal })
      aggiungiLog('✅ Stampante raggiungibile', 'success')
    } catch (err) {
      const motivo = err.name === 'AbortError' ? 'timeout' : err.message
      aggiungiLog(`❌ Stampante non raggiungibile — verifica rete/VPN (${motivo})`, 'error')
    } finally {
      clearTimeout(timer)
      setComandoInCorso(null)
    }
  }

  function apriConfermaZ() {
    setConfermaAbilitata(false)
    setDialogZ(true)
    setTimeout(() => setConfermaAbilitata(true), CONFERMA_Z_DELAY_MS)
  }

  function confermaZ() {
    setDialogZ(false)
    inviaComando('Z')
  }

  const disabilitato = !stampante || !!comandoInCorso
  const etichetta = (testo) => (
    <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: colors.textSubtle, marginBottom: 8 }}>
      {testo}
    </div>
  )
  // Pulsante comando grande a tutta larghezza, testo allineato a sinistra
  const stileComando = { justifyContent: 'flex-start', padding: '12px 18px', fontSize: 'var(--fs-md)', width: '100%' }

  return (
    <div style={{ maxWidth: 580 }}>
      <SectionTitle style={{ marginBottom: 2 }}>Controllo Registratori Telematici</SectionTitle>
      <p className="ui-text-muted" style={{ margin: '0 0 20px' }}>
        Invia comandi agli RT Epson FP-81 II senza tastiera fisica.
      </p>

      {etichetta('Seleziona stampante')}

      <Messaggio tipo="err">{caricamentoErrore}</Messaggio>

      {!caricamentoErrore && stampanti.length === 0 && (
        <StatoVuoto>Nessun registratore telematico configurato. Aggiungilo in Admin → Corrispettivi → Stampanti RT.</StatoVuoto>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }} role="radiogroup">
        {stampanti.map(s => {
          const vpn = !s.ip.startsWith('192.168.100.')
          const attiva = s.id === selezionata
          return (
            <label key={s.id} onClick={() => setSelezionata(s.id)} role="radio" aria-checked={attiva} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              border: `2px solid ${attiva ? colors.primary : colors.border}`,
              background: attiva ? colors.primarySoft : colors.surface,
              borderRadius: 12, cursor: 'pointer',
            }}>
              <span style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${attiva ? colors.primary : colors.borderStrong}`,
                background: attiva ? colors.primary : 'transparent',
                boxShadow: attiva ? 'inset 0 0 0 3px #fff' : 'none',
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: colors.text }}>{s.nome}</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: colors.textSubtle, fontFamily: 'monospace' }}>
                  {s.ip}{s.hotels?.length ? ` · ${s.hotels.join(', ')}` : ''}
                </div>
              </div>
              <Badge tono={vpn ? 'ok' : 'info'}>{vpn ? 'VPN' : 'LAN'}</Badge>
            </label>
          )
        })}
      </div>

      {etichetta('Comandi')}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        <Button variant="secondary" disabled={disabilitato} onClick={() => inviaComando('X')} style={stileComando}>
          📊 {comandoInCorso === 'X' ? 'Invio…' : 'Report X — Lettura giornaliera'}
        </Button>
        <Button variant="secondary" disabled={disabilitato} onClick={verificaStato} style={stileComando}>
          🔍 {comandoInCorso === 'STATUS' ? 'Verifica…' : 'Stato stampante'}
        </Button>
        {isAdmin && (
          <Button variant="danger-soft" disabled={disabilitato} onClick={apriConfermaZ} style={stileComando}>
            ⚠️ {comandoInCorso === 'Z' ? 'Chiusura in corso…' : 'Chiusura Z — Fiscale giornaliera'}
          </Button>
        )}
      </div>

      {etichetta('Log risposta')}
      <div className="ui-console">
        {log.length === 0 && <span className="riga-vuota">In attesa di comandi…</span>}
        {log.map((l, i) => (
          <div key={i} className={l.tipo === 'success' ? 'riga-ok' : l.tipo === 'error' ? 'riga-err' : 'riga-info'}>
            [{l.ts}] {l.messaggio}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <Messaggio tipo="warn">
          <strong>Attenzione:</strong> la Chiusura Z è fiscalmente definitiva e non reversibile.
          Usare solo a fine giornata dopo aver verificato i totali con il Report X.
        </Messaggio>
      </div>

      {dialogZ && stampante && (
        <Modal
          titolo="⚠️ Chiusura fiscale Z"
          onChiudi={() => setDialogZ(false)}
          larghezza={440}
          chiudiSuSfondo={false}
          footer={<>
            <Button variant="secondary" onClick={() => setDialogZ(false)}>Annulla</Button>
            <Button variant="danger" disabled={!confermaAbilitata} onClick={confermaZ}>
              {confermaAbilitata ? 'Conferma chiusura Z' : 'Attendere…'}
            </Button>
          </>}
        >
          <div style={{ whiteSpace: 'normal' }}>
            <div style={{ color: colors.text, marginBottom: 6 }}>
              Stampante: <strong>{stampante.nome}</strong> ({stampante.ip})
            </div>
            <div style={{ lineHeight: 1.5 }}>
              Questa operazione è <strong>definitiva</strong>: azzera i totalizzatori e trasmette i corrispettivi
              all'Agenzia delle Entrate. Non è reversibile.
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
