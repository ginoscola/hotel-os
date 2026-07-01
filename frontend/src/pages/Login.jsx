import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import axios from 'axios'

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
      navigate('/dashboard/gruppo', { replace: true })
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

      navigate('/dashboard/gruppo', { replace: true })
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

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f1f5f9',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
        padding: '2.5rem 2rem',
        width: '100%',
        maxWidth: 380,
      }}>
        {/* Logo / titolo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img
            src="/hotelos-icon.svg"
            alt="HotelOS"
            style={{ width: 200, height: 200, borderRadius: 36, marginBottom: 18 }}
          />
          <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>
            Accedi per continuare
          </p>
        </div>

        {/* Avviso sessione scaduta */}
        {sessioneScaduta && (
          <div style={{
            background: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: '1.25rem',
            fontSize: 13,
            color: '#92400e',
          }}>
            Sessione scaduta, effettua nuovamente il login.
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              required
              style={{
                width: '100%',
                padding: '9px 12px',
                fontSize: 14,
                border: '1px solid #d1d5db',
                borderRadius: 6,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{
                width: '100%',
                padding: '9px 12px',
                fontSize: 14,
                border: '1px solid #d1d5db',
                borderRadius: 6,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Messaggio errore */}
          {errore && (
            <div style={{
              background: '#fee2e2',
              border: '1px solid #fca5a5',
              borderRadius: 6,
              padding: '10px 14px',
              fontSize: 13,
              color: '#991b1b',
            }}>
              {errore}
            </div>
          )}

          <button
            type="submit"
            disabled={caricamento || !username || !password}
            style={{
              marginTop: 4,
              padding: '10px',
              background: caricamento || !username || !password ? '#93c5fd' : '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 15,
              fontWeight: 700,
              cursor: caricamento || !username || !password ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {caricamento ? 'Accesso in corso…' : 'Accedi'}
          </button>
        </form>
      </div>
    </div>
  )
}
