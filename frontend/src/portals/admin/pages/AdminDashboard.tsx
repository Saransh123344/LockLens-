// frontend/src/portals/admin/pages/AdminDashboard.tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { examApi } from '../../../services/api';
import type { Exam } from '../../../types';

interface Stats {
  totalExams: number;
  totalQuestions: number;
  totalProtections: number;
  totalMinutes: number;
}

export default function AdminDashboard() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    examApi.list().then(setExams).catch(console.error).finally(() => setLoading(false));
  }, []);

  const stats: Stats = exams.reduce((acc, e) => ({
    totalExams: acc.totalExams + 1,
    totalQuestions: acc.totalQuestions + (e.questions?.length || 0),
    totalProtections: acc.totalProtections + countBits(e.feature_bitmask),
    totalMinutes: acc.totalMinutes + e.duration_minutes,
  }), { totalExams: 0, totalQuestions: 0, totalProtections: 0, totalMinutes: 0 });

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400 mt-1">Overview of your exam management</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Exams', value: stats.totalExams, color: 'indigo', icon: '📋' },
          { label: 'Total Questions', value: stats.totalQuestions, color: 'emerald', icon: '❓' },
          { label: 'Active Protections', value: stats.totalProtections, color: 'violet', icon: '🛡️' },
          { label: 'Exam Minutes', value: stats.totalMinutes, color: 'amber', icon: '⏱️' },
        ].map(s => (
          <div key={s.label} className="card p-5">
            <div className="text-2xl mb-2">{s.icon}</div>
            <div className="text-3xl font-bold text-white">{loading ? '—' : s.value}</div>
            <div className="text-gray-400 text-sm mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Link to="/admin/create-exam" className="card p-6 hover:border-indigo-600/50 transition-colors group">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-600/20 rounded-xl flex items-center justify-center group-hover:bg-indigo-600/30 transition-colors">
              <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-white">Create New Exam</p>
              <p className="text-gray-400 text-sm">Set up questions & proctoring rules</p>
            </div>
          </div>
        </Link>
        <Link to="/admin/users" className="card p-6 hover:border-indigo-600/50 transition-colors group">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-violet-600/20 rounded-xl flex items-center justify-center group-hover:bg-violet-600/30 transition-colors">
              <svg className="w-6 h-6 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-white">Manage Users</p>
              <p className="text-gray-400 text-sm">Assign examiners to exams</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Recent exams */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Recent Exams</h2>
          <Link to="/admin/exams" className="text-indigo-400 text-sm hover:text-indigo-300">View all →</Link>
        </div>
        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : exams.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-gray-400 mb-4">No exams yet.</p>
            <Link to="/admin/create-exam" className="btn-primary">Create Your First Exam</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {exams.slice(0, 5).map(e => (
              <div key={e.id} className="card p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-white">{e.title}</p>
                  <p className="text-sm text-gray-400">{e.questions?.length || 0} questions · {e.duration_minutes} min · {countBits(e.feature_bitmask)} protections</p>
                </div>
                <span className="text-xs font-mono text-indigo-400 bg-indigo-600/10 px-2 py-1 rounded border border-indigo-600/20">
                  {e.exam_code}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function countBits(n: number): number {
  let count = 0;
  while (n) { count += n & 1; n >>= 1; }
  return count;
}
