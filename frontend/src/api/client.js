import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
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
