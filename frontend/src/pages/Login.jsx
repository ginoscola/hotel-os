import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import axios from 'axios'
import { Button, Field, Input, Messaggio } from '../components/ui'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errore, setErrore] = useState('')
  const [caricamento, setCaricamento] = useState(false)

  // Mostra messaggio se la sessione è scaduta
  const sessioneScaduta = new URLSearchParams(location.search).get('sessione_scaduta') === '1'

  // Se già loggato, vai alla dashboard
  useEffect(() => {
    if (localStorage.getItem('auth_token')) {
      navigate('/home', { replace: true })
    }
  }, [navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setErrore('')
    setCaricamento(true)
    try {
      const form = new URLSearchParams()
      form.append('username', username)
      form.append('password', password)
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
      const { data } = await axios.post(`${apiUrl}/auth/login`, form, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      localStorage.setItem('auth_token', data.access_token)
      localStorage.setItem('auth_user', JSON.stringify({ username: data.username, ruolo: data.ruolo }))

      // Carica e salva i permessi modulo per ProtectedRoute
      try {
        const { data: moduli } = await axios.get(`${apiUrl}/modules/`, {
          headers: { Authorization: `Bearer ${data.access_token}` },
        })
        const permessi = {}
        moduli.forEach(m => {
          permessi[m.code] = {
            puo_vedere: m.puo_vedere,
            puo_modificare: m.puo_modificare,
            puo_importare: m.puo_importare,
          }
        })
        localStorage.setItem('moduli_permessi', JSON.stringify(permessi))
      } catch {
        localStorage.removeItem('moduli_permessi')
      }

      navigate('/home', { replace: true })
    } catch (err) {
      if (err.response?.status === 401) {
        setErrore('Credenziali errate. Verifica username e password.')
      } else if (err.response?.status === 429) {
        setErrore('Troppi tentativi falliti. Riprova tra 15 minuti.')
      } else {
        setErrore('Errore di connessione. Riprova tra qualche istante.')
      }
    } finally {
      setCaricamento(false)
    }
  }

  const pieno = { width: '100%' }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-page-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="ui-card" style={{ width: '100%', maxWidth: 380, padding: '40px 32px', boxShadow: 'var(--shadow-pop)' }}>
        {/* Logo / titolo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/hotelos-icon.svg" alt="HotelOS" style={{ width: 200, height: 200, borderRadius: 36, marginBottom: 18 }} />
          <p className="ui-text-muted" style={{ margin: 0, fontSize: 'var(--fs-base)' }}>Accedi per continuare</p>
        </div>

        {/* Avviso sessione scaduta */}
        {sessioneScaduta && <Messaggio tipo="warn">Sessione scaduta, effettua nuovamente il login.</Messaggio>}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Username" style={pieno}>
            <Input type="text" value={username} onChange={e => setUsername(e.target.value)}
              autoFocus autoComplete="username" required
              style={{ ...pieno, padding: '9px 12px', fontSize: 'var(--fs-md)' }} />
          </Field>

          <Field label="Password" style={pieno}>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="current-password" required
              style={{ ...pieno, padding: '9px 12px', fontSize: 'var(--fs-md)' }} />
          </Field>

          {/* Messaggio errore */}
          {errore && <div style={{ marginBottom: -16 }}><Messaggio tipo="err">{errore}</Messaggio></div>}

          <Button type="submit" disabled={caricamento || !username || !password}
            style={{ ...pieno, marginTop: 4, padding: 10, fontSize: 'var(--fs-lg)', fontWeight: 700 }}>
            {caricamento ? 'Accesso in corso…' : 'Accedi'}
          </Button>
        </form>
      </div>
    </div>
  )
}
