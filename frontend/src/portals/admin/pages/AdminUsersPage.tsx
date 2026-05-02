// frontend/src/portals/admin/pages/AdminUsersPage.tsx
import { useEffect, useState } from 'react';
import { authApi } from '../../../services/api';
import type { User } from '../../../types';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    authApi.users().then(setUsers).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = filter === 'all' ? users : users.filter(u => u.role === filter);

  const roleColors: Record<string, string> = {
    admin: 'text-violet-400 bg-violet-500/10 border-violet-500/30',
    examiner: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
    student: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Users</h1>
        <p className="text-gray-400 mt-1">{users.length} registered users</p>
      </div>

      <div className="flex gap-2 mb-6">
        {['all', 'admin', 'examiner', 'student'].map(r => (
          <button key={r} onClick={() => setFilter(r)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${filter === r ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
            {r}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-white font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-gray-400">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded border capitalize ${roleColors[u.role]}`}>{u.role}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-sm">
                    {new Date((u as any).created_at * 1000).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
