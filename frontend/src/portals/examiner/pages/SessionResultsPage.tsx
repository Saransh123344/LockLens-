// frontend/src/portals/examiner/pages/SessionResultsPage.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { resultApi, sessionApi } from '../../../services/api';
import type { Session, StudentSession } from '../../../types';

export default function SessionResultsPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [results, setResults] = useState<StudentSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    Promise.all([sessionApi.get(sessionId), resultApi.bySession(sessionId)])
      .then(([sess, res]) => { setSession(sess); setResults(res); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sessionId]);

  const getGrade = (pct: number) => {
    if (pct >= 90) return { grade: 'A', color: 'text-green-400' };
    if (pct >= 80) return { grade: 'B', color: 'text-blue-400' };
    if (pct >= 70) return { grade: 'C', color: 'text-yellow-400' };
    if (pct >= 60) return { grade: 'D', color: 'text-orange-400' };
    return { grade: 'F', color: 'text-red-400' };
  };

  if (loading) return <div className="p-8 text-gray-400">Loading results…</div>;

  const submitted = results.filter(r => r.status === 'submitted');
  const avg = submitted.length > 0
    ? Math.round(submitted.reduce((a, r) => a + (r.total_points ? (r.score! / r.total_points) * 100 : 0), 0) / submitted.length)
    : 0;

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => navigate('/examiner')} className="text-gray-400 hover:text-white">← Back</button>
        <div>
          <h1 className="text-2xl font-bold text-white">Results: {session?.exam_title}</h1>
          <p className="text-gray-400 mt-1">{results.length} students · avg {avg}%</p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Students', value: results.length },
          { label: 'Submitted', value: submitted.length },
          { label: 'Avg Score', value: `${avg}%` },
          { label: 'Flagged', value: results.filter(r => r.flagged).length },
        ].map(s => (
          <div key={s.label} className="card p-4 text-center">
            <p className="text-2xl font-bold text-white">{s.value}</p>
            <p className="text-gray-400 text-sm mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Results table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Grade</th>
              <th className="px-4 py-3">Violations</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Flagged</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {results.map(r => {
              const pct = r.total_points ? Math.round((r.score! / r.total_points) * 100) : 0;
              const { grade, color } = getGrade(pct);
              return (
                <tr key={r.id} className={`hover:bg-gray-800/50 ${r.flagged ? 'bg-red-900/5' : ''}`}>
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{r.student_name}</p>
                    <p className="text-gray-500 text-xs">{r.student_email}</p>
                  </td>
                  <td className="px-4 py-3 text-white">
                    {r.status === 'submitted' ? `${r.score}/${r.total_points} (${pct}%)` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {r.status === 'submitted' ? <span className={`font-bold text-lg ${color}`}>{grade}</span> : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {(r.violation_count || 0) > 0
                      ? <span className="badge-violation">{r.violation_count}</span>
                      : <span className="text-gray-500">0</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs capitalize ${r.status === 'submitted' ? 'text-green-400' : r.status === 'terminated' ? 'text-red-400' : 'text-yellow-400'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {r.flagged ? <span className="text-red-400 text-sm">⚠ Yes</span> : <span className="text-gray-500 text-sm">No</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
