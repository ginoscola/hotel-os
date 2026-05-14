import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import NavBar from './components/NavBar.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Login from './pages/Login.jsx'
import Import from './pages/Import.jsx'
import ImportBulk from './pages/ImportBulk.jsx'
import DashboardHotel from './pages/DashboardHotel.jsx'
import DashboardGruppo from './pages/DashboardGruppo.jsx'
import Admin from './pages/Admin.jsx'
import AdminUtenti from './pages/AdminUtenti.jsx'
import Budget from './pages/Budget.jsx'
import Usali from './pages/Usali.jsx'
import Dipendenti from './pages/Dipendenti.jsx'
import Corrispettivi from './pages/Corrispettivi.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <NavBar />
      <main style={{ padding: '1.5rem 2rem' }}>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Redirect root → dashboard gruppo */}
          <Route path="/" element={<Navigate to="/dashboard/gruppo" replace />} />

          {/* ── Modulo Revenue ── */}
          <Route path="/dashboard/hotel/:hotelCode" element={
            <ProtectedRoute moduleCode="revenue"><DashboardHotel /></ProtectedRoute>
          } />
          <Route path="/dashboard/hotel" element={
            <ProtectedRoute moduleCode="revenue"><DashboardHotel /></ProtectedRoute>
          } />
          <Route path="/dashboard/gruppo" element={
            <ProtectedRoute moduleCode="revenue"><DashboardGruppo /></ProtectedRoute>
          } />
          <Route path="/import" element={
            <ProtectedRoute ruoloRichiesto="admin" moduleCode="revenue"><Import /></ProtectedRoute>
          } />
          <Route path="/import/bulk" element={
            <ProtectedRoute ruoloRichiesto="admin" moduleCode="revenue"><ImportBulk /></ProtectedRoute>
          } />
          <Route path="/admin" element={
            <ProtectedRoute ruoloRichiesto="admin" moduleCode="revenue"><Admin /></ProtectedRoute>
          } />
          <Route path="/admin/utenti" element={
            <ProtectedRoute ruoloRichiesto="admin" moduleCode="revenue"><AdminUtenti /></ProtectedRoute>
          } />

          {/* ── Altri moduli ── */}
          <Route path="/budget" element={
            <ProtectedRoute moduleCode="budget"><Budget /></ProtectedRoute>
          } />
          <Route path="/usali" element={
            <ProtectedRoute moduleCode="usali"><Usali /></ProtectedRoute>
          } />
          <Route path="/dipendenti" element={
            <ProtectedRoute moduleCode="dipendenti"><Dipendenti /></ProtectedRoute>
          } />
          <Route path="/corrispettivi" element={
            <ProtectedRoute moduleCode="corrispettivi"><Corrispettivi /></ProtectedRoute>
          } />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
