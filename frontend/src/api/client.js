import axios from 'axios'

// Da rete locale (pagina aperta su 192.168.x.x:8080) le chiamate vanno dirette al backend
// sulla porta 8081 dello stesso server, senza uscire su internet e rientrare dal tunnel
// Cloudflare: upload grandi (PDF cedolini ~20 MB) andavano in timeout per l'uplink lento.
// Da fuori LAN resta VITE_API_URL (indirizzo pubblico).
function risolviApiUrl() {
  const { protocol, hostname, port } = window.location
  if (/^192\.168\./.test(hostname) && port === '8080') {
    return `${protocol}//${hostname}:8081`
  }
  return import.meta.env.VITE_API_URL || 'http://localhost:8000'
}

export const API_URL = risolviApiUrl()

const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
})

// Allega il token JWT a ogni richiesta
api.interceptors.request.use(config => {
  const token = localStorage.getItem('auth_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Gestisce 401: token scaduto o invalido → redirect al login
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('auth_user')
      // Evita loop se già sulla pagina di login
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login?sessione_scaduta=1'
      }
    }
    return Promise.reject(error)
  }
)

export default api
