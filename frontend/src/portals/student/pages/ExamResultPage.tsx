// frontend/src/portals/student/pages/ExamResultPage.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { resultApi } from '../../../services/api';

export default function ExamResultPage() {
  const { studentSessionId } = useParams<{ studentSessionId: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentSessionId) return;
    resultApi.byStudentSession(studentSessionId)
      .then(setResult)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [studentSessionId]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading results…</div>;
  if (!result) return <div className="min-h-screen flex items-center justify-center text-gray-400">Results not found.</div>;

  const { question_results, score, total_points, percentage, violations, exam } = result;

  const getColor = (pct: number) => pct >= 80 ? 'text-green-400' : pct >= 60 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Score card */}
        <div className="card p-8 text-center mb-8">
          <h1 className="text-xl font-bold text-white mb-1">{exam?.title}</h1>
          <p className="text-gray-400 text-sm mb-6">Your Result</p>
          <div className={`text-7xl font-bold mb-2 ${getColor(percentage)}`}>{percentage}%</div>
          <p className="text-gray-300 text-lg">{score} / {total_points} points</p>
          {violations?.length > 0 && (
            <div className="mt-4 badge-violation mx-auto w-fit">{violations.length} violation{violations.length !== 1 ? 's' : ''} recorded</div>
          )}
        </div>

        {/* Question breakdown */}
        <div className="space-y-3 mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Question Breakdown</h2>
          {question_results?.map((q: any, i: number) => (
            <div key={q.id} className={`card p-4 border ${q.is_correct ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm text-gray-400 mb-1">Q{i + 1}</p>
                  <p className="text-white text-sm">{q.question}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs">
                    {q.student_answer ? (
                      <span className={q.is_correct ? 'text-green-400' : 'text-red-400'}>
                        Your answer: {q.student_answer} — {q.options[q.student_answer]}
                      </span>
                    ) : (
                      <span className="text-gray-500">Not answered</span>
                    )}
                    {!q.is_correct && (
                      <span className="text-green-400">Correct: {q.correct_answer} — {q.options[q.correct_answer]}</span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-lg font-bold ${q.is_correct ? 'text-green-400' : 'text-red-400'}`}>
                    {q.is_correct ? `+${q.points}` : '0'}
                  </span>
                  <p className="text-xs text-gray-500">{q.is_correct ? '✓ Correct' : '✗ Wrong'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Violations */}
        {violations?.length > 0 && (
          <div className="card p-6 mb-8">
            <h2 className="text-lg font-semibold text-white mb-4">Violations Recorded</h2>
            <div className="space-y-2">
              {violations.map((v: any) => (
                <div key={v.id} className="flex items-center justify-between text-sm">
                  <span className="text-red-400">{v.type.replace(/_/g, ' ')}</span>
                  <span className="text-gray-500">{new Date(v.timestamp * 1000).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={() => navigate('/student')} className="btn-ghost flex-1">← Dashboard</button>
          <button
            onClick={() => { window.close(); setTimeout(() => navigate('/student'), 300); }}
            className="btn-ghost flex-1"
          >
            ✕ Close Tab
          </button>
        </div>
      </div>
    </div>
  );
}
