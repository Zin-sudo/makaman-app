import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { useState, useEffect } from 'react'

import Login from './screens/Login'
import Signup from './screens/Signup'
import PendingApproval from './screens/PendingApproval'
import Settings from './screens/Settings'

import TechnicianHome from './screens/technician/TechnicianHome'
import TicketForm from './screens/technician/TicketForm'

import OpsQueue from './screens/ops/OpsQueue'
import TicketReview from './screens/ops/TicketReview'
import PrintPreview from './screens/ops/PrintPreview'

import AdminHome from './screens/admin/AdminHome'
import PriceLists from './screens/admin/PriceLists'
import JobTypes from './screens/admin/JobTypes'
import Numbering from './screens/admin/Numbering'
import Users from './screens/admin/Users'

import FounderReport from './screens/founder/FounderReport'

function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  if (online) return null
  return <div className="offline-banner">Offline — working locally. Tickets will sync when signal returns.</div>
}

function RequireAuth({ children }) {
  const { user, loading, status } = useAuth()
  if (loading) return <div className="center-screen">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (status === 'pending') return <Navigate to="/pending" replace />
  return children
}

function RequireRole({ roles, children }) {
  const { role } = useAuth()
  if (!roles.includes(role)) return <Navigate to="/" replace />
  return children
}

function Home() {
  const { role } = useAuth()
  if (role === 'technician') return <Navigate to="/technician" replace />
  if (role === 'ops_manager') return <Navigate to="/ops" replace />
  if (role === 'admin') return <Navigate to="/ops" replace />
  if (role === 'founder') return <Navigate to="/founder" replace />
  return <Navigate to="/login" replace />
}

export default function App() {
  return (
    <>
      <OfflineBanner />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/pending" element={<PendingApproval />} />

        <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />

        <Route
          path="/technician"
          element={
            <RequireAuth>
              <RequireRole roles={['technician', 'admin']}><TechnicianHome /></RequireRole>
            </RequireAuth>
          }
        />
        <Route
          path="/technician/ticket/:localId"
          element={
            <RequireAuth>
              <RequireRole roles={['technician', 'admin']}><TicketForm /></RequireRole>
            </RequireAuth>
          }
        />

        <Route
          path="/ops"
          element={
            <RequireAuth>
              <RequireRole roles={['ops_manager', 'admin']}><OpsQueue /></RequireRole>
            </RequireAuth>
          }
        />
        <Route
          path="/ops/ticket/:ticketId"
          element={
            <RequireAuth>
              <RequireRole roles={['ops_manager', 'admin']}><TicketReview /></RequireRole>
            </RequireAuth>
          }
        />
        <Route
          path="/ops/ticket/:ticketId/print"
          element={
            <RequireAuth>
              <RequireRole roles={['ops_manager', 'admin']}><PrintPreview /></RequireRole>
            </RequireAuth>
          }
        />

        <Route
          path="/admin"
          element={<RequireAuth><RequireRole roles={['admin']}><AdminHome /></RequireRole></RequireAuth>}
        />
        <Route
          path="/admin/price-lists"
          element={<RequireAuth><RequireRole roles={['admin']}><PriceLists /></RequireRole></RequireAuth>}
        />
        <Route
          path="/admin/job-types"
          element={<RequireAuth><RequireRole roles={['admin']}><JobTypes /></RequireRole></RequireAuth>}
        />
        <Route
          path="/admin/numbering"
          element={<RequireAuth><RequireRole roles={['admin']}><Numbering /></RequireRole></RequireAuth>}
        />
        <Route
          path="/admin/users"
          element={<RequireAuth><RequireRole roles={['admin']}><Users /></RequireRole></RequireAuth>}
        />

        <Route
          path="/founder"
          element={<RequireAuth><RequireRole roles={['founder', 'admin']}><FounderReport /></RequireRole></RequireAuth>}
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
