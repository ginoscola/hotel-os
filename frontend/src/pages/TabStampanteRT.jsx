/**
 * TabStampanteRT — invio comandi X/Z/STATUS al registratore telematico Epson FP-81 II.
 * Chiamata diretta browser → stampante (nessun proxy backend): l'IP è letto da hotels.rt_ip.
 * Il controllo "solo admin per Z" è applicato solo lato interfaccia (nessuna enforcement server-side,
 * dato che il browser parla direttamente con la stampante).
 */
import { useState } from 'react'

const CONFERMA_Z_DELAY_MS = 2000

function buildSOAP(command) {
  // STATUS riusa la lettura X: l'Epson FP-81 II non espone un comando di stato dedicato via fpmate.cgi.
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

export default function TabStampanteRT({ hotels, isAdmin }) {
  const stampanti = (hotels || []).filter(h => h.rt_ip)
  const [selezionata, setSelezionata] = useState(stampanti[0]?.code || null)
  const [comandoInCorso, setComandoInCorso] = useState(null)
  const [log, setLog] = useState([])
  const [dialogZ, setDialogZ] = useState(false)
  const [confermaAbilitata, setConfermaAbilitata] = useState(false)

  const stampante = stampanti.find(s => s.code === selezionata) || null

  function aggiungiLog(messaggio, tipo = 'info') {
    setLog(prev => [
      ...prev.slice(-19),
      { ts: new Date().toLocaleTimeString('it-IT'), messaggio, tipo },
    ])
  }

  async function inviaComando(cmd) {
    if (!stampante) return
    setComandoInCorso(cmd)
    aggiungiLog(`→ ${cmd} su ${stampante.name} (${stampante.rt_ip})…`, 'info')
    try {
      const resp = await fetch(urlStampante(stampante.rt_ip), {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' },
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
          const msg = cmd === 'Z' ? 'Chiusura fiscale completata'
            : cmd === 'STATUS' ? 'Stampante raggiungibile e operativa'
            : 'Report X stampato correttamente'
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

  function apriConfermaZ() {
    setConfermaAbilitata(false)
    setDialogZ(true)
    setTimeout(() => setConfermaAbilitata(true), CONFERMA_Z_DELAY_MS)
  }

  function confermaZ() {
    setDialogZ(false)
    inviaComando('Z')
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: '0 0 2px' }}>
        Controllo Registratori Telematici
      </h2>
      <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 20px' }}>
        Invia comandi agli RT Epson FP-81 II senza tastiera fisica.
      </p>

      <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', marginBottom: 8 }}>
        Seleziona stampante
      </div>

      {stampanti.length === 0 && (
        <div style={{ padding: '14px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: '0.85rem', color: '#64748b', marginBottom: 20 }}>
          Nessun registratore telematico configurato. Imposta l'IP in Admin → Stagioni/Hotel (campo <code>rt_ip</code>).
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {stampanti.map(s => {
          const vpn = !s.rt_ip.startsWith('192.168.100.')
          const attiva = s.code === selezionata
          return (
            <label key={s.code} onClick={() => setSelezionata(s.code)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              border: `2px solid ${attiva ? '#1e3a5f' : '#e2e8f0'}`,
              background: attiva ? '#eff6ff' : '#fff',
              borderRadius: 12, cursor: 'pointer',
            }}>
              <span style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${attiva ? '#1e3a5f' : '#cbd5e1'}`,
                background: attiva ? '#1e3a5f' : 'transparent',
                boxShadow: attiva ? 'inset 0 0 0 3px #fff' : 'none',
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e293b' }}>{s.name}</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace' }}>{s.rt_ip}</div>
              </div>
              <span style={{
                fontSize: '0.7rem', fontWeight: 700, padding: '3px 9px', borderRadius: 20,
                background: vpn ? '#dcfce7' : '#e0e7ff',
                color: vpn ? '#166534' : '#3730a3',
              }}>{vpn ? 'VPN' : 'LAN'}</span>
            </label>
          )
        })}
      </div>

      <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', marginBottom: 8 }}>
        Comandi
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        <button disabled={!stampante || !!comandoInCorso} onClick={() => inviaComando('X')} style={btnSt('#e8f4fd', '#1565c0', !stampante || !!comandoInCorso)}>
          📊 {comandoInCorso === 'X' ? 'Invio…' : 'Report X — Lettura giornaliera'}
        </button>
        <button disabled={!stampante || !!comandoInCorso} onClick={() => inviaComando('STATUS')} style={btnSt('#f0f4ff', '#3949ab', !stampante || !!comandoInCorso)}>
          🔍 {comandoInCorso === 'STATUS' ? 'Verifica…' : 'Stato stampante'}
        </button>
        {isAdmin && (
          <button disabled={!stampante || !!comandoInCorso} onClick={apriConfermaZ} style={btnSt('#fdecea', '#c62828', !stampante || !!comandoInCorso)}>
            ⚠️ {comandoInCorso === 'Z' ? 'Chiusura in corso…' : 'Chiusura Z — Fiscale giornaliera'}
          </button>
        )}
      </div>

      <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', marginBottom: 8 }}>
        Log risposta
      </div>
      <div style={{ background: '#1a1a2e', borderRadius: 10, padding: 14, minHeight: 90, maxHeight: 220, overflowY: 'auto' }}>
        {log.length === 0 && <span style={{ color: '#555', fontFamily: 'monospace', fontSize: '0.75rem' }}>In attesa di comandi…</span>}
        {log.map((l, i) => (
          <div key={i} style={{
            fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: 1.7,
            color: l.tipo === 'success' ? '#69f0ae' : l.tipo === 'error' ? '#ff6b6b' : '#ffd54f',
          }}>
            [{l.ts}] {l.messaggio}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, background: '#fff8e1', borderLeft: '4px solid #ffc107', borderRadius: 8, padding: '12px 14px', fontSize: '0.78rem', color: '#795548', lineHeight: 1.5 }}>
        <strong style={{ color: '#5d4037' }}>Attenzione:</strong> la Chiusura Z è fiscalmente definitiva e non reversibile.
        Usare solo a fine giornata dopo aver verificato i totali con il Report X.
      </div>

      {dialogZ && stampante && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 420 }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#c62828', marginBottom: 10 }}>⚠️ Chiusura fiscale Z</div>
            <div style={{ fontSize: '0.85rem', color: '#334155', marginBottom: 6 }}>
              Stampante: <strong>{stampante.name}</strong> ({stampante.rt_ip})
            </div>
            <div style={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5, marginBottom: 18 }}>
              Questa operazione è <strong>definitiva</strong>: azzera i totalizzatori e trasmette i corrispettivi
              all'Agenzia delle Entrate. Non è reversibile.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDialogZ(false)} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer', fontSize: '0.85rem' }}>
                Annulla
              </button>
              <button disabled={!confermaAbilitata} onClick={confermaZ} style={{
                padding: '9px 16px', borderRadius: 8, border: 'none', color: '#fff', fontSize: '0.85rem', fontWeight: 700,
                background: confermaAbilitata ? '#c62828' : '#f3a5a5',
                cursor: confermaAbilitata ? 'pointer' : 'not-allowed',
              }}>
                {confermaAbilitata ? 'Conferma chiusura Z' : 'Attendere…'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function btnSt(bg, color, disabled) {
  return {
    padding: '13px 18px', border: 'none', borderRadius: 12, fontSize: '0.9rem', fontWeight: 600,
    textAlign: 'left', background: bg, color,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  }
}
