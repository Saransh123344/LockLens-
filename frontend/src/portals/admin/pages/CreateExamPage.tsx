// frontend/src/portals/admin/pages/CreateExamPage.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { examApi } from '../../../services/api';
import { FEATURE_LABELS, type FeatureFlags, type Question } from '../../../types';
import { buildBitmask } from '../../../utils/examId';
import { useAuth } from '../../../contexts/AuthContext';

const defaultFlags: FeatureFlags = {
  tab_switch_detection: true, focus_loss_detection: true,
  copy_paste_blocking: true, screen_share_blocking: false,
  screenshot_blocking: false, right_click_disable: true,
  fullscreen_enforcement: true, object_detection_ai: false,
  multiple_person_detection: false, double_camera_angle: false,
  ai_tool_detection: false, eye_tracking: false,
  audio_monitoring: false, periodic_face_verification: false,
};

const newQ = (): Question => ({
  id: uuidv4(), question: '',
  options: { A: '', B: '', C: '', D: '' },
  correct_answer: 'A', points: 1,
});

export default function CreateExamPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(60);
  const [flags, setFlags] = useState<FeatureFlags>({ ...defaultFlags });

  // Step 2
  const [questions, setQuestions] = useState<Question[]>([newQ()]);

  // Step 3
  const [emailInput, setEmailInput] = useState('');
  const [allowedEmails, setAllowedEmails] = useState<string[]>([]);
  const [openToAll, setOpenToAll] = useState(true);
  const [lockAfterCreate, setLockAfterCreate] = useState(false);
  const [emailFileError, setEmailFileError] = useState('');

  const toggleFlag = (key: keyof FeatureFlags) => setFlags(f => ({ ...f, [key]: !f[key] }));

  const addEmail = () => {
    const emails = emailInput.split(/[\n,;]+/).map(e => e.trim().toLowerCase()).filter(e => e.includes('@'));
    const unique = [...new Set([...allowedEmails, ...emails])];
    setAllowedEmails(unique);
    setEmailInput('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmailFileError('');
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const emails = text.split(/[\n\r,;]+/).map(e => e.trim().toLowerCase()).filter(e => e.includes('@'));
        setAllowedEmails(prev => [...new Set([...prev, ...emails])]);
      };
      reader.readAsText(file);
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      // Dynamic import to avoid bundle bloat
      import('xlsx').then(XLSX => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const data = new Uint8Array(ev.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
          const emails: string[] = [];
          for (const row of rows) {
            for (const cell of row) {
              const val = String(cell || '').trim().toLowerCase();
              if (val.includes('@')) emails.push(val);
            }
          }
          setAllowedEmails(prev => [...new Set([...prev, ...emails])]);
        };
        reader.readAsArrayBuffer(file);
      }).catch(() => setEmailFileError('xlsx package not installed. Use CSV or paste emails manually.'));
    } else {
      setEmailFileError('Unsupported file. Use .xlsx, .csv, or .txt');
    }
    e.target.value = '';
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const payload = {
        title, description, duration_minutes: duration,
        feature_bitmask: buildBitmask(flags),
        questions,
        allowed_emails: openToAll ? [] : allowedEmails,
      };
      console.log('[CreateExam] Submitting as user role:', user?.role);
      const exam = await examApi.create(payload);
      if (lockAfterCreate) await examApi.lock(exam.id);
      navigate('/admin/exams');
    } catch (e: any) {
      const msg = e.response?.data?.error || e.message || 'Failed to create exam';
      setError(msg);
      console.error('[CreateExam] Error:', e.response?.data);
    } finally {
      setLoading(false);
    }
  };

  const basic = FEATURE_LABELS.filter(f => f.category === 'basic');
  const advanced = FEATURE_LABELS.filter(f => f.category === 'advanced');

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Create Exam</h1>
        {user && (
          <p className="text-xs text-gray-500 mt-1">
            Logged in as: <span className="text-indigo-400">{user.email}</span> · Role: <span className="text-indigo-400">{user.role}</span>
          </p>
        )}
        {/* Step indicator */}
        <div className="flex items-center gap-6 mt-4">
          {['Exam Setup', 'Questions', 'Students & Lock'].map((label, i) => (
            <div key={i} className={`flex items-center gap-2 ${i + 1 <= step ? 'text-indigo-400' : 'text-gray-600'}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
                i + 1 < step ? 'bg-indigo-600 border-indigo-600 text-white' :
                i + 1 === step ? 'border-indigo-500 text-indigo-400' : 'border-gray-700 text-gray-600'}`}>
                {i + 1 < step ? '✓' : i + 1}
              </div>
              <span className="text-sm font-medium hidden sm:block">{label}</span>
              {i < 2 && <span className="text-gray-700">→</span>}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3 mb-6 text-sm">
          <strong>Error:</strong> {error}
          {error.includes('logged in as') && (
            <p className="mt-1 text-xs text-red-400">You may need to log out and log back in as an Admin account.</p>
          )}
        </div>
      )}

      {/* ── STEP 1: Exam Setup ── */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="card p-6 space-y-4">
            <h2 className="font-semibold text-white">Basic Info</h2>
            <div>
              <label className="label">Exam Title *</label>
              <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Midterm CS101 2025" />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea className="input" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional instructions for students" />
            </div>
            <div>
              <label className="label">Duration (minutes) *</label>
              <input type="number" className="input w-40" min={5} max={360} value={duration} onChange={e => setDuration(+e.target.value)} />
            </div>
          </div>

          <div className="card p-6">
            <h2 className="font-semibold text-white mb-4">Proctoring Features</h2>
            <div className="mb-5">
              <p className="text-xs text-indigo-400 uppercase tracking-wider mb-3 font-semibold">Basic — Browser Level</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {basic.map(f => <FeatureToggle key={f.key} label={f.label} enabled={flags[f.key]} onToggle={() => toggleFlag(f.key)} color="indigo" />)}
              </div>
            </div>
            <div>
              <p className="text-xs text-red-400 uppercase tracking-wider mb-3 font-semibold">Advanced — AI Webcam</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {advanced.map(f => <FeatureToggle key={f.key} label={f.label} enabled={flags[f.key]} onToggle={() => toggleFlag(f.key)} color="red" />)}
              </div>
            </div>
            <p className="mt-4 pt-3 border-t border-gray-800 text-xs text-gray-500">
              {Object.values(flags).filter(Boolean).length}/{FEATURE_LABELS.length} features enabled
              <span className="ml-2 font-mono text-gray-600">mask: 0x{buildBitmask(flags).toString(16).toUpperCase().padStart(4,'0')}</span>
            </p>
          </div>

          <div className="flex justify-end">
            <button className="btn-primary" disabled={!title.trim() || duration < 5} onClick={() => setStep(2)}>
              Next: Add Questions →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Questions ── */}
      {step === 2 && (
        <div className="space-y-4">
          {questions.map((q, idx) => (
            <div key={q.id} className="card p-5">
              <div className="flex justify-between items-center mb-3">
                <span className="text-indigo-400 font-semibold text-sm">Question {idx + 1}</span>
                {questions.length > 1 && (
                  <button onClick={() => setQuestions(qs => qs.filter(x => x.id !== q.id))} className="text-gray-500 hover:text-red-400 text-sm">Remove</button>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <label className="label">Question *</label>
                  <textarea className="input" rows={2} value={q.question}
                    onChange={e => setQuestions(qs => qs.map(x => x.id === q.id ? { ...x, question: e.target.value } : x))}
                    placeholder="Type your question here…" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(['A','B','C','D'] as const).map(opt => (
                    <div key={opt}>
                      <label className="label flex items-center gap-2">
                        <button onClick={() => setQuestions(qs => qs.map(x => x.id === q.id ? { ...x, correct_answer: opt } : x))}
                          className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center transition-colors ${q.correct_answer === opt ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>{opt}</button>
                        <span className="text-xs text-gray-500">{q.correct_answer === opt ? '✓ correct' : `option ${opt}`}</span>
                      </label>
                      <input className="input" value={q.options[opt]}
                        onChange={e => setQuestions(qs => qs.map(x => x.id === q.id ? { ...x, options: { ...x.options, [opt]: e.target.value } } : x))}
                        placeholder={`Option ${opt}`} />
                    </div>
                  ))}
                </div>
                <div>
                  <label className="label">Points</label>
                  <input type="number" min={1} className="input w-24"
                    value={q.points}
                    onChange={e => setQuestions(qs => qs.map(x => x.id === q.id ? { ...x, points: +e.target.value } : x))} />
                </div>
              </div>
            </div>
          ))}

          <button onClick={() => setQuestions(q => [...q, newQ()])} className="btn-ghost w-full">+ Add Question</button>

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="btn-ghost">← Back</button>
            <button onClick={() => {
              const invalid = questions.some(q => !q.question.trim() || !q.options.A || !q.options.B || !q.options.C || !q.options.D);
              if (invalid) { setError('Fill all questions and their 4 options.'); return; }
              setError(''); setStep(3);
            }} className="btn-primary">
              Next: Students & Lock →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Allowed Students & Lock ── */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="card p-6 space-y-4">
            <h2 className="font-semibold text-white">Allowed Students</h2>
            <p className="text-gray-400 text-sm">Optionally restrict who can take this exam by email.</p>

            <div className="flex gap-3">
              <button onClick={() => { setOpenToAll(true); setAllowedEmails([]); }}
                className={`flex-1 py-3 rounded-lg border text-sm font-medium transition-all ${openToAll ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}>
                🌐 Open to All Students
              </button>
              <button onClick={() => setOpenToAll(false)}
                className={`flex-1 py-3 rounded-lg border text-sm font-medium transition-all ${!openToAll ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}>
                🔐 Allowed List Only
              </button>
            </div>

            {!openToAll && (
              <div className="space-y-3">
                <div>
                  <label className="label">Paste Emails (one per line, or comma-separated)</label>
                  <textarea className="input" rows={3} value={emailInput}
                    onChange={e => setEmailInput(e.target.value)}
                    placeholder="student1@college.edu&#10;student2@college.edu&#10;student3@college.edu" />
                  <button onClick={addEmail} className="btn-ghost mt-2 text-sm">Add Emails</button>
                </div>

                <div>
                  <label className="label">Or Upload File (.xlsx / .csv / .txt)</label>
                  <input type="file" accept=".xlsx,.xls,.csv,.txt" onChange={handleFileUpload}
                    className="block w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gray-700 file:text-gray-200 file:cursor-pointer hover:file:bg-gray-600" />
                  {emailFileError && <p className="text-red-400 text-xs mt-1">{emailFileError}</p>}
                  <p className="text-xs text-gray-500 mt-1">Excel: first column of emails. CSV/TXT: one email per line.</p>
                </div>

                {allowedEmails.length > 0 && (
                  <div className="bg-gray-800 rounded-lg p-3">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-gray-300 font-medium">{allowedEmails.length} student{allowedEmails.length !== 1 ? 's' : ''} allowed</span>
                      <button onClick={() => setAllowedEmails([])} className="text-xs text-red-400 hover:text-red-300">Clear all</button>
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {allowedEmails.map(email => (
                        <div key={email} className="flex items-center justify-between text-xs">
                          <span className="text-gray-300">{email}</span>
                          <button onClick={() => setAllowedEmails(prev => prev.filter(e => e !== email))}
                            className="text-gray-600 hover:text-red-400 ml-2">✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card p-6">
            <h2 className="font-semibold text-white mb-3">Exam Lock</h2>
            <button onClick={() => setLockAfterCreate(!lockAfterCreate)}
              className={`flex items-center justify-between w-full px-4 py-3 rounded-lg border text-sm transition-all ${lockAfterCreate ? 'bg-amber-600/15 border-amber-600/40 text-amber-300' : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600'}`}>
              <div className="text-left">
                <p className="font-medium">🔒 Lock exam after creation</p>
                <p className="text-xs mt-0.5 opacity-70">Locked exams cannot be edited or reassigned to a different examiner</p>
              </div>
              <div className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ml-3 ${lockAfterCreate ? 'bg-amber-500' : 'bg-gray-600'}`}>
                <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-transform ${lockAfterCreate ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
            </button>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="btn-ghost">← Back</button>
            <button onClick={handleSubmit} className="btn-primary" disabled={loading}>
              {loading ? 'Creating…' : `✓ Create Exam (${questions.length} questions)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FeatureToggle({ label, enabled, onToggle, color }: { label: string; enabled: boolean; onToggle: () => void; color: 'indigo' | 'red' }) {
  return (
    <button onClick={onToggle}
      className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-all text-left ${
        enabled
          ? color === 'indigo' ? 'bg-indigo-600/15 border-indigo-600/40 text-indigo-300' : 'bg-red-600/15 border-red-600/40 text-red-300'
          : 'bg-gray-800/50 border-gray-700 text-gray-500 hover:border-gray-600'}`}>
      <span>{label}</span>
      <div className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ml-2 ${enabled ? (color === 'indigo' ? 'bg-indigo-500' : 'bg-red-500') : 'bg-gray-600'}`}>
        <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
    </button>
  );
}
