// frontend/src/portals/admin/pages/ExamLibraryPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { examApi, authApi } from '../../../services/api';
import type { Exam, User } from '../../../types';
import { FEATURE_LABELS } from '../../../types';
import { v4 as uuidv4 } from 'uuid';
import { buildBitmask } from '../../../utils/examId';

export default function ExamLibraryPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [examiners, setExaminers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');
  const navigate = useNavigate();

  // Modals
  const [reviewExam, setReviewExam] = useState<Exam | null>(null);
  const [assignExam, setAssignExam] = useState<Exam | null>(null);
  const [selectedExaminer, setSelectedExaminer] = useState('');
  const [editExam, setEditExam] = useState<Exam | null>(null);
  const [editAllowedEmails, setEditAllowedEmails] = useState<string[]>([]);
  const [editEmailInput, setEditEmailInput] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([examApi.list(), authApi.users('examiner')])
      .then(([e, u]) => { setExams(e); setExaminers(u); })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this exam? This cannot be undone.')) return;
    try { await examApi.delete(id); load(); }
    catch(e: any) { alert(e.response?.data?.error || 'Delete failed'); }
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleAssign = async () => {
    if (!assignExam || !selectedExaminer) return;
    try {
      await examApi.assign(assignExam.id, selectedExaminer);
      alert('Examiner assigned!');
      setAssignExam(null);
      setSelectedExaminer('');
    } catch(e: any) { alert(e.response?.data?.error || 'Failed'); }
  };

  const handleToggleLock = async (exam: Exam) => {
    try {
      if ((exam as any).locked) {
        await examApi.unlockExam(exam.id);
      } else {
        if (!confirm('Lock this exam? Locked exams cannot be edited or reassigned.')) return;
        await examApi.lock(exam.id);
      }
      load();
    } catch(e: any) { alert(e.response?.data?.error || 'Failed'); }
  };

  const openEdit = async (exam: Exam) => {
    const full = await examApi.get(exam.id);
    setEditExam(full);
    setEditAllowedEmails(full.allowed_emails || []);
    setEditEmailInput('');
  };

  const handleEditSave = async () => {
    if (!editExam) return;
    setEditSaving(true);
    try {
      await examApi.update(editExam.id, {
        title: editExam.title,
        description: editExam.description,
        duration_minutes: editExam.duration_minutes,
        feature_bitmask: editExam.feature_bitmask,
        questions: editExam.questions,
        allowed_emails: editAllowedEmails,
      });
      setEditExam(null);
      load();
    } catch(e: any) { alert(e.response?.data?.error || 'Save failed'); }
    finally { setEditSaving(false); }
  };

  const countBits = (n: number) => { let c = 0; while(n) { c += n&1; n>>=1; } return c; };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Exam Library</h1>
          <p className="text-gray-400 mt-1">{exams.length} exam{exams.length!==1?'s':''}</p>
        </div>
        <button onClick={() => navigate('/admin/create-exam')} className="btn-primary">+ Create Exam</button>
      </div>

      {loading ? <p className="text-gray-500">Loading…</p> : exams.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-gray-400">No exams yet.</p>
          <button onClick={() => navigate('/admin/create-exam')} className="btn-primary mt-4">Create First Exam</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {exams.map(exam => {
            const locked = !!(exam as any).locked;
            const allowedCount = (exam as any).allowed_count || 0;
            return (
              <div key={exam.id} className={`card p-5 flex flex-col gap-3 ${locked ? 'border-amber-600/30' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-white leading-tight">{exam.title}</h3>
                  {locked && <span className="text-amber-400 text-xs bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full whitespace-nowrap">🔒 Locked</span>}
                </div>

                {exam.description && <p className="text-gray-400 text-sm line-clamp-2">{exam.description}</p>}

                <div className="flex flex-wrap gap-1.5 text-xs">
                  <span className="badge-info">{exam.questions?.length||0} questions</span>
                  <span className="badge-info">{exam.duration_minutes} min</span>
                  <span className="badge-info">{countBits(exam.feature_bitmask)} protections</span>
                  {allowedCount > 0 ? (
                    <span className="text-xs bg-purple-500/10 border border-purple-500/30 text-purple-300 px-2 py-0.5 rounded-full">{allowedCount} allowed</span>
                  ) : (
                    <span className="text-xs bg-green-500/10 border border-green-500/30 text-green-300 px-2 py-0.5 rounded-full">Open to all</span>
                  )}
                </div>

                {/* Feature dots */}
                <div className="flex flex-wrap gap-1.5">
                  {FEATURE_LABELS.filter(f => exam.feature_bitmask & (1 << f.bit)).map(f => (
                    <div key={f.key} title={f.label} className={`w-2 h-2 rounded-full ${f.category==='basic'?'bg-indigo-400':'bg-red-400'}`} />
                  ))}
                </div>

                {/* Exam code */}
                <div className="bg-gray-800 rounded-lg px-3 py-2 flex items-center justify-between">
                  <span className="font-mono text-sm text-indigo-300">{exam.exam_code}</span>
                  <button onClick={() => handleCopy(exam.exam_code)} className="text-xs text-gray-400 hover:text-white ml-2">
                    {copied === exam.exam_code ? '✓' : 'Copy'}
                  </button>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-800">
                  <button onClick={() => setReviewExam(exam)} className="btn-ghost text-xs py-2">📋 Review</button>
                  <button onClick={() => setAssignExam(exam)} disabled={locked} className="btn-ghost text-xs py-2 disabled:opacity-40">👤 Assign</button>
                  <button onClick={() => openEdit(exam)} disabled={locked} className="btn-ghost text-xs py-2 disabled:opacity-40">✏️ Edit</button>
                  <button onClick={() => handleToggleLock(exam)} className={`text-xs py-2 rounded-lg transition-colors font-semibold ${locked ? 'bg-amber-600/20 text-amber-300 hover:bg-amber-600/30' : 'bg-gray-800 text-gray-400 hover:text-amber-300 hover:bg-gray-700'}`}>
                    {locked ? '🔓 Unlock' : '🔒 Lock'}
                  </button>
                  <button onClick={() => handleDelete(exam.id)} className="col-span-2 text-xs py-1.5 text-gray-500 hover:text-red-400 transition-colors">Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Review Modal ── */}
      {reviewExam && (
        <Modal title={`Review: ${reviewExam.title}`} onClose={() => setReviewExam(null)}>
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-1">Exam Code</p>
              <p className="font-mono text-indigo-300 font-bold text-lg">{reviewExam.exam_code}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-2">Active Features:</p>
              <div className="flex flex-wrap gap-1.5">
                {FEATURE_LABELS.filter(f => reviewExam.feature_bitmask & (1 << f.bit)).map(f => (
                  <span key={f.key} className={f.category==='basic'?'badge-info':'badge-violation'}>{f.label}</span>
                ))}
                {FEATURE_LABELS.filter(f => reviewExam.feature_bitmask & (1 << f.bit)).length === 0 && (
                  <span className="text-gray-500 text-sm">No features enabled</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-2">Questions ({reviewExam.questions?.length}):</p>
              {reviewExam.questions?.map((q, i) => (
                <div key={q.id} className="border border-gray-800 rounded-lg p-3 mb-2">
                  <p className="font-medium text-white text-sm mb-2">Q{i+1}. {q.question}</p>
                  <div className="space-y-1">
                    {Object.entries(q.options).map(([opt, text]) => (
                      <div key={opt} className={`text-sm flex gap-2 ${q.correct_answer===opt?'text-green-400':'text-gray-400'}`}>
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${q.correct_answer===opt?'bg-green-500/20 border border-green-500/40':'bg-gray-700'}`}>{opt}</span>
                        {String(text)}{q.correct_answer===opt && <span className="text-xs text-green-500 ml-auto">✓</span>}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-600 mt-2">{q.points} pt{q.points!==1?'s':''}</p>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {/* ── Assign Modal ── */}
      {assignExam && (
        <Modal title={`Assign Examiner: ${assignExam.title}`} onClose={() => setAssignExam(null)}>
          <div className="space-y-4">
            <p className="text-gray-400 text-sm">The examiner will be able to unlock and monitor this exam.</p>
            <div>
              <label className="label">Examiner</label>
              <select className="input" value={selectedExaminer} onChange={e => setSelectedExaminer(e.target.value)}>
                <option value="">Select examiner…</option>
                {examiners.map(ex => <option key={ex.id} value={ex.id}>{ex.name} ({ex.email})</option>)}
              </select>
              {examiners.length === 0 && <p className="text-xs text-yellow-400 mt-1">No examiners registered yet. Ask them to register with "Examiner" role.</p>}
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setAssignExam(null)} className="btn-ghost">Cancel</button>
              <button onClick={handleAssign} className="btn-primary" disabled={!selectedExaminer}>Assign</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Edit Modal ── */}
      {editExam && (
        <Modal title={`Edit: ${editExam.title}`} onClose={() => setEditExam(null)} wide>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div>
              <label className="label">Title</label>
              <input className="input" value={editExam.title}
                onChange={e => setEditExam(ex => ex ? {...ex, title: e.target.value} : ex)} />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea className="input" rows={2} value={editExam.description}
                onChange={e => setEditExam(ex => ex ? {...ex, description: e.target.value} : ex)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Duration (min)</label>
                <input type="number" className="input" value={editExam.duration_minutes}
                  onChange={e => setEditExam(ex => ex ? {...ex, duration_minutes: +e.target.value} : ex)} />
              </div>
            </div>

            {/* Edit questions */}
            <div>
              <p className="label mb-2">Questions</p>
              {editExam.questions.map((q, i) => (
                <div key={q.id} className="border border-gray-800 rounded-lg p-3 mb-2">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-indigo-400 text-sm font-medium">Q{i+1}</span>
                    {editExam.questions.length > 1 && (
                      <button onClick={() => setEditExam(ex => ex ? {...ex, questions: ex.questions.filter((_,j) => j!==i)} : ex)}
                        className="text-xs text-red-400">Remove</button>
                    )}
                  </div>
                  <textarea className="input text-sm mb-2" rows={2} value={q.question}
                    onChange={e => setEditExam(ex => {
                      if(!ex) return ex;
                      const qs = [...ex.questions];
                      qs[i] = {...qs[i], question: e.target.value};
                      return {...ex, questions: qs};
                    })} placeholder="Question" />
                  <div className="grid grid-cols-2 gap-2">
                    {(['A','B','C','D'] as const).map(opt => (
                      <div key={opt} className="flex gap-2 items-center">
                        <button onClick={() => setEditExam(ex => {
                          if(!ex) return ex;
                          const qs = [...ex.questions];
                          qs[i] = {...qs[i], correct_answer: opt};
                          return {...ex, questions: qs};
                        })} className={`w-6 h-6 rounded-full text-xs font-bold flex-shrink-0 flex items-center justify-center ${q.correct_answer===opt?'bg-green-500 text-white':'bg-gray-700 text-gray-400'}`}>{opt}</button>
                        <input className="input text-sm flex-1" value={q.options[opt]}
                          onChange={e => setEditExam(ex => {
                            if(!ex) return ex;
                            const qs = [...ex.questions];
                            qs[i] = {...qs[i], options: {...qs[i].options, [opt]: e.target.value}};
                            return {...ex, questions: qs};
                          })} placeholder={`Option ${opt}`} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <button onClick={() => setEditExam(ex => ex ? {...ex, questions: [...ex.questions, {id: uuidv4(), question:'', options:{A:'',B:'',C:'',D:''}, correct_answer:'A', points:1}]} : ex)}
                className="btn-ghost w-full text-sm mt-1">+ Add Question</button>
            </div>

            {/* Allowed emails */}
            <div>
              <p className="label mb-2">Allowed Students</p>
              <p className="text-xs text-gray-500 mb-2">Leave empty = open to all. Current: {editAllowedEmails.length || 'open to all'}</p>
              <div className="flex gap-2">
                <input className="input flex-1 text-sm" placeholder="email@example.com" value={editEmailInput}
                  onChange={e => setEditEmailInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const emails = editEmailInput.split(/[\n,;]+/).map(x=>x.trim().toLowerCase()).filter(x=>x.includes('@'));
                      setEditAllowedEmails(prev => [...new Set([...prev,...emails])]);
                      setEditEmailInput('');
                    }
                  }} />
                <button onClick={() => {
                  const emails = editEmailInput.split(/[\n,;]+/).map(x=>x.trim().toLowerCase()).filter(x=>x.includes('@'));
                  setEditAllowedEmails(prev => [...new Set([...prev,...emails])]);
                  setEditEmailInput('');
                }} className="btn-ghost text-sm">Add</button>
              </div>
              {editAllowedEmails.length > 0 && (
                <div className="mt-2 bg-gray-800 rounded p-2 max-h-24 overflow-y-auto">
                  {editAllowedEmails.map(email => (
                    <div key={email} className="flex justify-between text-xs py-0.5">
                      <span className="text-gray-300">{email}</span>
                      <button onClick={() => setEditAllowedEmails(prev => prev.filter(e=>e!==email))} className="text-gray-600 hover:text-red-400">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-gray-800">
            <button onClick={() => setEditExam(null)} className="btn-ghost">Cancel</button>
            <button onClick={handleEditSave} className="btn-primary" disabled={editSaving}>
              {editSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className={`card ${wide ? 'w-full max-w-3xl' : 'w-full max-w-xl'} p-6`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
