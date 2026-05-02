// frontend/src/types/index.ts

export type UserRole = 'admin' | 'examiner' | 'student';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface Question {
  id: string;
  question: string;
  options: Record<string, string>; // { A: '...', B: '...', C: '...', D: '...' }
  correct_answer: string;          // 'A' | 'B' | 'C' | 'D'
  points: number;
}

export interface Exam {
  id: string;
  exam_code: string;
  title: string;
  description: string;
  duration_minutes: number;
  feature_bitmask: number;
  questions: Question[];
  created_by: string;
  created_at: number;
}

export interface Session {
  id: string;
  exam_id: string;
  examiner_id?: string;
  status: 'locked' | 'active' | 'ended';
  started_at?: number;
  ended_at?: number;
  created_at: number;
  exam_title?: string;
  exam_code?: string;
  duration_minutes?: number;
  feature_bitmask?: number;
  student_count?: number;
  total_violations?: number;
}

export interface StudentSession {
  id: string;
  session_id: string;
  student_id: string;
  status: 'in_progress' | 'submitted' | 'terminated';
  answers: Record<string, string>;
  score?: number;
  total_points?: number;
  violation_count: number;
  flagged: number;
  joined_at: number;
  submitted_at?: number;
  student_name?: string;
  student_email?: string;
  session_status?: string;
}

export interface Violation {
  id: string;
  student_session_id: string;
  session_id: string;
  student_id: string;
  type: ViolationType;
  details?: string;
  screenshot_url?: string;
  timestamp: number;
  student_name?: string;
  student_email?: string;
}

export type ViolationType =
  | 'TAB_SWITCH'
  | 'FOCUS_LOSS'
  | 'COPY_PASTE'
  | 'SCREEN_SHARE'
  | 'SCREENSHOT'
  | 'RIGHT_CLICK'
  | 'FULLSCREEN_EXIT'
  | 'OBJECT_DETECTED'
  | 'MULTIPLE_PERSONS'
  | 'AI_TOOL_DETECTED'
  | 'GAZE_AWAY'
  | 'AUDIO_DETECTED'
  | 'FACE_MISMATCH'
  | 'FACE_ABSENT'
  | 'UNKNOWN';

export interface FeatureFlags {
  tab_switch_detection: boolean;
  focus_loss_detection: boolean;
  copy_paste_blocking: boolean;
  screen_share_blocking: boolean;
  screenshot_blocking: boolean;
  right_click_disable: boolean;
  fullscreen_enforcement: boolean;
  object_detection_ai: boolean;
  multiple_person_detection: boolean;
  double_camera_angle: boolean;
  ai_tool_detection: boolean;
  eye_tracking: boolean;
  audio_monitoring: boolean;
  periodic_face_verification: boolean;
}

export const FEATURE_LABELS: { key: keyof FeatureFlags; label: string; category: 'basic' | 'advanced'; bit: number }[] = [
  { key: 'tab_switch_detection', label: 'Tab Switch Detection', category: 'basic', bit: 0 },
  { key: 'focus_loss_detection', label: 'Focus Loss Detection', category: 'basic', bit: 1 },
  { key: 'copy_paste_blocking', label: 'Copy/Paste Blocking', category: 'basic', bit: 2 },
  { key: 'screen_share_blocking', label: 'Screen Share Blocking', category: 'basic', bit: 3 },
  { key: 'screenshot_blocking', label: 'Screenshot Blocking', category: 'basic', bit: 4 },
  { key: 'right_click_disable', label: 'Right-Click Disable', category: 'basic', bit: 5 },
  { key: 'fullscreen_enforcement', label: 'Fullscreen Enforcement', category: 'basic', bit: 6 },
  { key: 'object_detection_ai', label: 'Object Detection (AI)', category: 'advanced', bit: 7 },
  { key: 'multiple_person_detection', label: 'Multiple Person Detection', category: 'advanced', bit: 8 },
  { key: 'double_camera_angle', label: 'Double Camera Angle', category: 'advanced', bit: 9 },
  { key: 'ai_tool_detection', label: 'AI Tool Detection', category: 'advanced', bit: 10 },
  { key: 'eye_tracking', label: 'Eye Tracking', category: 'advanced', bit: 11 },
  { key: 'audio_monitoring', label: 'Audio Monitoring', category: 'advanced', bit: 12 },
  { key: 'periodic_face_verification', label: 'Periodic Face Verification', category: 'advanced', bit: 13 },
];

export interface DecodedExamId {
  examId: string;
  featureBitmask: number;
  durationMinutes: number;
  enabledFeatures: { index: number; name: string }[];
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}
