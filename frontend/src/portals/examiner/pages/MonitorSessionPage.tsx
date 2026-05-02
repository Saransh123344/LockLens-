// frontend/src/portals/examiner/pages/MonitorSessionPage.tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../../../contexts/SocketContext';
import { sessionApi, violationApi } from '../../../services/api';
import type { Session, StudentSession, Violation } from '../../../types';

interface LiveStudent extends StudentSession {
  online: boolean;
  lastFrame?: string;
  answeredCount?: number;
  questionCount?: number;
}

export default function MonitorSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { socket } = useSocket();
  const navigate = useNavigate();

  const [session, setSession] = useState<Session | null>(null);
  const [students, setStudents] = useState<Map<string, LiveStudent>>(new Map());
  const [violations, setViolations] = useState<Violation[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusedStudent, setFocusedStudent] = useState<LiveStudent | null>(null);
  const [warnMsg, setWarnMsg] = useState('');
  const [endConfirm, setEndConfirm] = useState(false);

  const violationsRef = useRef<HTMLDivElement>(null);

  const loadSession = useCallback(async () => {
    if (!sessionId) return;
    const [sess, viols] = await Promise.all([
      sessionApi.get(sessionId),
      violationApi.bySession(sessionId)
    ]);
    setSession(sess);
    setViolations(viols.reverse());

    // Init student map
    const map = new Map<string, LiveStudent>();
    for (const s of sess.students || []) {
      map.set(s.id, { ...s, online: false });
    }
    setStudents(map);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { loadSession(); }, [loadSession]);

  // Socket listeners
  useEffect(() => {
    if (!socket || !sessionId) return;
    socket.emit('examiner:join', { sessionId });

    socket.on('session:students', (list: StudentSession[]) => {
      setStudents(prev => {
        const map = new Map(prev);
        for (const s of list) {
          // Key MUST be student_session.id to match webcam_frame / online lookups
          const existing = map.get(s.id);
          map.set(s.id, {
            ...s,
            online:     existing?.online     || false,
            lastFrame:  existing?.lastFrame,
            answeredCount: existing?.answeredCount,
            questionCount: existing?.questionCount,
          });
        }
        return map;
      });
    });

    socket.on('student:online', (data: any) => {
      // Map keyed by student_session id — match by studentSessionId
      setStudents(prev => {
        const map = new Map(prev);
        const ssId = data.studentSessionId;
        const existing = map.get(ssId);
        if (existing) map.set(ssId, { ...existing, online: true });
        return map;
      });
    });

    socket.on('student:offline', (data: any) => {
      setStudents(prev => {
        const map = new Map(prev);
        // Try to find by studentSessionId first, fall back to scanning by userId
        let found = map.get(data.studentSessionId);
        if (found) {
          map.set(data.studentSessionId, { ...found, online: false });
        } else {
          for (const [key, s] of map) {
            if (s.student_id === data.studentId) { map.set(key, { ...s, online: false }); break; }
          }
        }
        return map;
      });
    });

    socket.on('student:webcam_frame', (data: any) => {
      setStudents(prev => {
        const map = new Map(prev);
        const ssId = data.studentSessionId;
        const existing = map.get(ssId);
        if (existing) {
          map.set(ssId, { ...existing, lastFrame: data.frame, online: true });
        } else {
          // Try scanning (handles race before session list arrives)
          for (const [key, s] of map) {
            if (s.student_id === data.studentId) {
              map.set(key, { ...s, lastFrame: data.frame, online: true });
              break;
            }
          }
        }
        return map;
      });
    });

    socket.on('student:progress', (data: any) => {
      setStudents(prev => {
        const map = new Map(prev);
        const ssId = data.studentSessionId;
        const existing = map.get(ssId);
        if (existing) map.set(ssId, { ...existing, answeredCount: data.answeredCount, questionCount: data.questionCount });
        return map;
      });
    });

    socket.on('student:submitted', (data: any) => {
      setStudents(prev => {
        const map = new Map(prev);
        for (const [key, s] of map) {
          if (s.id === data.studentSessionId) {
            map.set(key, { ...s, status: 'submitted', score: data.score, total_points: data.total });
          }
        }
        return map;
      });
    });

    socket.on('violation:new', (v: Violation & { student_name: string }) => {
      setViolations(prev => [v, ...prev]);
      setStudents(prev => {
        const map = new Map(prev);
        const existing = map.get(v.student_id);
        if (existing) map.set(v.student_id, { ...existing, violation_count: (existing.violation_count || 0) + 1, flagged: 1 });
        return map;
      });
      // Auto-scroll violation feed
      setTimeout(() => violationsRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 100);
    });

    return () => {
      socket.off('session:students');
      socket.off('student:online');
      socket.off('student:offline');
      socket.off('student:webcam_frame');
      socket.off('student:progress');
      socket.off('student:submitted');
      socket.off('violation:new');
    };
  }, [socket, sessionId]);

  const handleEndSession = async () => {
    await sessionApi.end(sessionId!);
    navigate('/examiner');
  };

  const handleWarnStudent = () => {
    if (!focusedStudent || !warnMsg.trim()) return;
    socket?.emit('examiner:warn_student', { studentSessionId: focusedStudent.id, message: warnMsg });
    setWarnMsg('');
    alert('Warning sent');
  };

  const handleTerminate = () => {
    if (!focusedStudent) return;
    if (!confirm(`Terminate ${focusedStudent.student_name}'s exam?`)) return;
    socket?.emit('examiner:terminate_student', { studentSessionId: focusedStudent.id, sessionId });
    setFocusedStudent(null);
  };

  const studentList = Array.from(students.values());

  if (loading) return <div className="p-8 text-gray-400">Loading session…</div>;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Main grid */}
      <div className="flex-1 overflow-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-white">{session?.exam_title}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="badge-success">● Live</span>
              <span className="text-gray-400 text-sm">{studentList.length} students</span>
              <span className="text-gray-400 text-sm">{violations.length} violations</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => navigate(`/examiner/results/${sessionId}`)} className="btn-ghost text-sm">Results</button>
            <button onClick={() => setEndConfirm(true)} className="btn-danger text-sm">End Session</button>
          </div>
        </div>

        {studentList.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-500">
            <div className="text-center">
              <p className="text-lg">Waiting for students to join…</p>
              <p className="text-sm mt-2">Share the exam code: <span className="font-mono text-indigo-400">{session?.exam_code}</span></p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {studentList.map(s => (
              <StudentCard
                key={s.id}
                student={s}
                onClick={() => setFocusedStudent(s)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Violation Feed Sidebar */}
      <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800">
          <h2 className="font-semibold text-white">Violation Feed</h2>
          <p className="text-xs text-gray-400">{violations.length} total</p>
        </div>
        <div ref={violationsRef} className="flex-1 overflow-y-auto p-3 space-y-2">
          {violations.length === 0 ? (
            <p className="text-gray-600 text-sm text-center mt-8">No violations yet</p>
          ) : (
            violations.map(v => (
              <div key={v.id} className="bg-gray-800 rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-red-400 font-medium text-xs">{v.type.replace(/_/g, ' ')}</span>
                  <span className="text-gray-500 text-xs">{new Date(v.timestamp * 1000).toLocaleTimeString()}</span>
                </div>
                <p className="text-gray-300">{v.student_name}</p>
                {v.details && <p className="text-gray-500 text-xs mt-1 truncate">{v.details}</p>}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Focused Student Modal */}
      {focusedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <div className="card w-full max-w-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">{focusedStudent.student_name}</h3>
                <p className="text-gray-400 text-sm">{focusedStudent.student_email}</p>
              </div>
              <button onClick={() => setFocusedStudent(null)} className="text-gray-500 hover:text-white">✕</button>
            </div>

            {/* Webcam feed */}
            <div className="bg-gray-800 rounded-lg overflow-hidden aspect-video flex items-center justify-center">
              {focusedStudent.lastFrame ? (
                <img src={`data:image/jpeg;base64,${focusedStudent.lastFrame}`} className="w-full h-full object-contain" alt="webcam" />
              ) : (
                <p className="text-gray-500">No webcam feed</p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="card p-3">
                <p className="text-2xl font-bold text-white">{focusedStudent.violation_count || 0}</p>
                <p className="text-xs text-gray-400">Violations</p>
              </div>
              <div className="card p-3">
                <p className="text-2xl font-bold text-white">{focusedStudent.answeredCount || 0}/{focusedStudent.questionCount || '?'}</p>
                <p className="text-xs text-gray-400">Progress</p>
              </div>
              <div className="card p-3">
                <p className={`text-sm font-bold ${focusedStudent.online ? 'text-green-400' : 'text-gray-500'}`}>
                  {focusedStudent.status === 'submitted' ? 'SUBMITTED' : focusedStudent.online ? 'ONLINE' : 'OFFLINE'}
                </p>
                <p className="text-xs text-gray-400">Status</p>
              </div>
            </div>

            <div className="flex gap-2">
              <input className="input flex-1" placeholder="Warning message…" value={warnMsg} onChange={e => setWarnMsg(e.target.value)} />
              <button onClick={handleWarnStudent} className="btn-primary text-sm whitespace-nowrap">Send Warning</button>
            </div>

            <div className="flex justify-end">
              <button onClick={handleTerminate} className="btn-danger text-sm">Terminate Session</button>
            </div>
          </div>
        </div>
      )}

      {/* End session confirm */}
      {endConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <div className="card p-6 max-w-sm w-full space-y-4">
            <h3 className="font-bold text-white text-lg">End Session?</h3>
            <p className="text-gray-400 text-sm">This will force-submit all in-progress student sessions and end the exam for everyone.</p>
            <div className="flex gap-3">
              <button onClick={() => setEndConfirm(false)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={handleEndSession} className="btn-danger flex-1">End Session</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StudentCard({ student, onClick }: { student: LiveStudent; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`card p-3 text-left hover:border-indigo-600/50 transition-all ${student.flagged ? 'border-red-600/40' : ''}`}>
      {/* Webcam preview */}
      <div className="bg-gray-800 rounded-lg overflow-hidden aspect-video flex items-center justify-center mb-2 relative">
        {student.lastFrame ? (
          <img src={`data:image/jpeg;base64,${student.lastFrame}`} className="w-full h-full object-contain" alt="webcam" />
        ) : (
          <div className="text-gray-600 text-xs">{student.online ? 'Connecting…' : 'Offline'}</div>
        )}
        <div className={`absolute top-1 right-1 w-2 h-2 rounded-full ${student.online ? 'bg-green-400' : 'bg-gray-600'}`} />
      </div>

      <p className="text-white text-sm font-medium truncate">{student.student_name}</p>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-gray-400">
          {student.status === 'submitted' ? '✓ Submitted' : `${student.answeredCount || 0}/${student.questionCount || '?'} answered`}
        </span>
        {(student.violation_count || 0) > 0 && (
          <span className="text-xs text-red-400 font-medium">{student.violation_count} ⚠</span>
        )}
      </div>
    </button>
  );
}
