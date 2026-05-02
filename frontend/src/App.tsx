// frontend/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';

// Shared
import LoginPage from './portals/shared/LoginPage';
import RegisterPage from './portals/shared/RegisterPage';

// Admin portal
import AdminLayout from './portals/admin/AdminLayout';
import AdminDashboard from './portals/admin/pages/AdminDashboard';
import CreateExamPage from './portals/admin/pages/CreateExamPage';
import ExamLibraryPage from './portals/admin/pages/ExamLibraryPage';
import AdminUsersPage from './portals/admin/pages/AdminUsersPage';

// Examiner portal
import ExaminerLayout from './portals/examiner/ExaminerLayout';
import ExaminerDashboard from './portals/examiner/pages/ExaminerDashboard';
import MonitorSessionPage from './portals/examiner/pages/MonitorSessionPage';
import SessionResultsPage from './portals/examiner/pages/SessionResultsPage';

// Student portal
import StudentLayout from './portals/student/StudentLayout';
import StudentDashboard from './portals/student/pages/StudentDashboard';
import ExamRoomPage from './portals/student/pages/ExamRoomPage';
import ExamResultPage from './portals/student/pages/ExamResultPage';

function RoleRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  if (user.role === 'examiner') return <Navigate to="/examiner" replace />;
  return <Navigate to="/student" replace />;
}

function ProtectedRoute({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user, isLoading, isAuthenticated } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!roles.includes(user!.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RoleRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Admin */}
      <Route path="/admin" element={<ProtectedRoute roles={['admin']}><AdminLayout /></ProtectedRoute>}>
        <Route index element={<AdminDashboard />} />
        <Route path="create-exam" element={<CreateExamPage />} />
        <Route path="exams" element={<ExamLibraryPage />} />
        <Route path="users" element={<AdminUsersPage />} />
      </Route>

      {/* Examiner */}
      <Route path="/examiner" element={<ProtectedRoute roles={['examiner']}><ExaminerLayout /></ProtectedRoute>}>
        <Route index element={<ExaminerDashboard />} />
        <Route path="session/:sessionId" element={<MonitorSessionPage />} />
        <Route path="results/:sessionId" element={<SessionResultsPage />} />
      </Route>

      {/* Student */}
      <Route path="/student" element={<ProtectedRoute roles={['student']}><StudentLayout /></ProtectedRoute>}>
        <Route index element={<StudentDashboard />} />
        <Route path="exam/:studentSessionId" element={<ExamRoomPage />} />
        <Route path="result/:studentSessionId" element={<ExamResultPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </SocketProvider>
    </AuthProvider>
  );
}
