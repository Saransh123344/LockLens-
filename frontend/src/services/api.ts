// api.ts — reads token from sessionStorage (per-tab), supports cross-device via env var
import axios from 'axios';

// For cross-device: set VITE_API_BASE_URL=http://<HOST_IP>:4000 in frontend/.env.local
// When blank, vite proxy handles it (localhost dev only)
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';

const api = axios.create({ baseURL: `${API_BASE}/api`, timeout: 20000 });

// Read from sessionStorage so each tab has its own auth
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('locklens_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      sessionStorage.removeItem('locklens_token');
      sessionStorage.removeItem('locklens_user');
      if (!window.location.pathname.includes('/login')) window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const authApi = {
  login:    (email: string, password: string) => api.post('/auth/login', { email, password }).then(r => r.data),
  register: (name: string, email: string, password: string, role: string) =>
    api.post('/auth/register', { name, email, password, role }).then(r => r.data),
  me:    () => api.get('/auth/me').then(r => r.data),
  users: (role?: string) => api.get('/auth/users', { params: { role } }).then(r => r.data),
};

export const examApi = {
  list:            () => api.get('/exams').then(r => r.data),
  get:             (id: string) => api.get(`/exams/${id}`).then(r => r.data),
  decode:          (code: string) => api.get(`/exams/decode/${code}`).then(r => r.data),
  validateStudent: (exam_code: string) => api.post('/exams/validate-student', { exam_code }).then(r => r.data),
  create:          (data: any) => api.post('/exams', data).then(r => r.data),
  update:          (id: string, data: any) => api.put(`/exams/${id}`, data).then(r => r.data),
  delete:          (id: string) => api.delete(`/exams/${id}`).then(r => r.data),
  assign:          (examId: string, examinerId: string) =>
    api.post(`/exams/${examId}/assign`, { examiner_id: examinerId }).then(r => r.data),
  lock:            (id: string) => api.post(`/exams/${id}/lock`).then(r => r.data),
  unlockExam:      (id: string) => api.post(`/exams/${id}/unlock-exam`).then(r => r.data),
  getAllowedStudents: (id: string) => api.get(`/exams/${id}/allowed-students`).then(r => r.data),
};

export const sessionApi = {
  list:             () => api.get('/sessions').then(r => r.data),
  get:              (id: string) => api.get(`/sessions/${id}`).then(r => r.data),
  unlock:           (id: string) => api.post(`/sessions/${id}/unlock`).then(r => r.data),
  end:              (id: string) => api.post(`/sessions/${id}/end`).then(r => r.data),
  joinByCode:       (exam_code: string) => api.post('/sessions/join-by-code', { exam_code }).then(r => r.data),
  getStudentStatus: (ssId: string) => api.get(`/sessions/student/${ssId}/status`).then(r => r.data),
  submit:           (ssId: string, answers: Record<string, string>) =>
    api.post(`/sessions/student/${ssId}/submit`, { answers }).then(r => r.data),
};

export const violationApi = {
  log: (data: { student_session_id: string; type: string; details?: string }) =>
    api.post('/violations', data).then(r => r.data),
  bySession:        (sessionId: string) => api.get(`/violations/session/${sessionId}`).then(r => r.data),
  byStudentSession: (ssId: string) => api.get(`/violations/student/${ssId}`).then(r => r.data),
};

export const resultApi = {
  bySession:        (sessionId: string) => api.get(`/results/session/${sessionId}`).then(r => r.data),
  byStudentSession: (ssId: string) => api.get(`/results/student/${ssId}`).then(r => r.data),
};

export default api;
