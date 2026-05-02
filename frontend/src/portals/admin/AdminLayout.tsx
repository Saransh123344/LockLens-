// frontend/src/portals/admin/AdminLayout.tsx
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useEffect, useState } from 'react';
import { authApi } from '../../services/api';

const navItems = [
  { to: '/admin', label: 'Dashboard', end: true, d: 'M3 7h18M3 12h18M3 17h18' },
  { to: '/admin/create-exam', label: 'Create Exam', end: false, d: 'M12 4v16m8-8H4' },
  { to: '/admin/exams', label: 'Exam Library', end: false, d: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { to: '/admin/users', label: 'Users', end: false, d: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const [serverRole, setServerRole] = useState<string | null>(null);

  useEffect(() => {
    authApi.me().then((u: any) => setServerRole(u.role)).catch(() => {});
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-6 py-5 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <span className="font-bold text-white text-lg">LockLens</span>
              <p className="text-xs text-indigo-400">Admin Portal</p>
            </div>
          </div>
        </div>

        {/* Role warning if mismatch */}
        {serverRole && serverRole !== 'admin' && (
          <div className="mx-3 mt-3 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs">
            <p className="text-red-400 font-bold">⚠️ Role mismatch!</p>
            <p className="text-red-300 mt-1">Your account role is <strong>{serverRole}</strong>, not admin. You cannot create exams.</p>
            <button onClick={logout} className="text-red-400 underline mt-1 block">Log out and switch accounts</button>
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-600/30' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'}`
              }>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.d} />
              </svg>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-gray-800">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-200 truncate">{user?.name}</p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              {serverRole && (
                <p className={`text-xs mt-0.5 ${serverRole === 'admin' ? 'text-indigo-400' : 'text-red-400'}`}>
                  role: {serverRole}
                </p>
              )}
            </div>
            <button onClick={logout} className="text-gray-500 hover:text-red-400 transition-colors ml-2" title="Logout">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-gray-950">
        <Outlet />
      </main>
    </div>
  );
}
