// frontend/src/portals/student/StudentLayout.tsx
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function StudentLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const inExam = location.pathname.includes('/student/exam/');

  // In exam mode: no nav chrome
  if (inExam) return <Outlet />;

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <span className="font-bold text-white">LockLens</span>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">Student</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">{user?.name}</span>
          <button onClick={logout} className="text-sm text-gray-500 hover:text-red-400 transition-colors">Logout</button>
        </div>
      </header>
      <main className="p-6 max-w-2xl mx-auto">
        <Outlet />
      </main>
    </div>
  );
}
