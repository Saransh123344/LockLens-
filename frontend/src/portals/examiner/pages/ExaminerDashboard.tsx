// frontend/src/portals/examiner/pages/ExaminerDashboard.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sessionApi } from '../../../services/api';
import type { Session } from '../../../types';

export default function ExaminerDashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    sessionApi.list().then(setSessions).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleUnlock = async (sessionId: string) => {
    await sessionApi.unlock(sessionId);
    load();
  };

  const statusColor: Record<string, string> = {
    locked: 'badge-warning',
    active: 'badge-success',
    ended: 'text-gray-500 bg-gray-700/30 border-gray-600/30 text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center',
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">My Exam Sessions</h1>
        <p className="text-gray-400 mt-1">Manage and monitor your assigned exams</p>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : sessions.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-gray-400">No sessions assigned yet. Ask your admin to assign you to an exam.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sessions.map(s => (
            <div key={s.id} className="card p-5 space-y-3">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold text-white">{s.exam_title}</h3>
                <span className={statusColor[s.status]}>{s.status}</span>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="badge-info">{s.duration_minutes} min</span>
                <span className="badge-info">{s.student_count || 0} students</span>
                {(s.total_violations || 0) > 0 && (
                  <span className="badge-violation">{s.total_violations} violations</span>
                )}
              </div>

              <div className="font-mono text-xs text-indigo-400 bg-indigo-600/10 px-2 py-1 rounded border border-indigo-600/20">
                {s.exam_code}
              </div>

              <div className="flex gap-2 pt-2 border-t border-gray-800">
                {s.status === 'locked' && (
                  <button onClick={() => handleUnlock(s.id)} className="btn-primary text-sm flex-1">
                    ▶ Start Exam
                  </button>
                )}
                {s.status === 'active' && (
                  <button onClick={() => navigate(`/examiner/session/${s.id}`)} className="btn-primary text-sm flex-1">
                    📡 Monitor Live
                  </button>
                )}
                {s.status === 'ended' && (
                  <button onClick={() => navigate(`/examiner/results/${s.id}`)} className="btn-ghost text-sm flex-1">
                    📊 View Results
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
