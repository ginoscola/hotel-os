import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Pagina placeholder per moduli non ancora implementati.
 * Riceve le informazioni del modulo (nome, icona, colore) come props.
 */
export default function WorkInProgress({ nome, icona, colore = '#6b7280' }) {
  const navigate = useNavigate()
  const [progresso, setProgresso] = useState(0)

  // Animazione barra avanzamento decorativa
  useEffect(() => {
    const timer = setTimeout(() => setProgresso(35), 300)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '60vh', gap: '1.5rem',
      textAlign: 'center', padding: '2rem',
    }}>
      <div style={{ fontSize: 64 }}>{icona || '🔧'}</div>

      <h1 style={{ margin: 0, fontSize: '1.8rem', color: '#111827' }}>{nome}</h1>

      <div style={{
        background: '#f3f4f6', borderRadius: 12, padding: '1.5rem 2.5rem',
        maxWidth: 480, width: '100%',
      }}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 700, color: '#374151', fontSize: '1.1rem' }}>
          Modulo in sviluppo
        </p>
        <p style={{ margin: 0, color: '#6b7280', fontSize: '0.95rem' }}>
          Questa sezione sarà disponibile in una prossima versione
        </p>
      </div>

      {/* Barra avanzamento decorativa */}
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{
          height: 6, background: '#e5e7eb', borderRadius: 99, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${progresso}%`,
            background: colore,
            borderRadius: 99,
            transition: 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
          }} />
        </div>
        <p style={{ margin: '0.5rem 0 0', fontSize: 12, color: '#9ca3af' }}>
          Sviluppo in corso…
        </p>
      </div>

      <button
        onClick={() => navigate('/dashboard/gruppo')}
        style={{
          marginTop: '0.5rem', padding: '10px 24px',
          background: colore, color: '#fff',
          border: 'none', borderRadius: 8,
          cursor: 'pointer', fontWeight: 600, fontSize: '0.95rem',
        }}
      >
        ← Torna a Revenue &amp; Statistiche
      </button>
    </div>
  )
}
