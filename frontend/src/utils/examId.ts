// frontend/src/utils/examId.ts
import type { FeatureFlags } from '../types';

export const FEATURE_NAMES = [
  'Tab Switch Detection',
  'Focus Loss Detection',
  'Copy/Paste Blocking',
  'Screen Share Blocking',
  'Screenshot Blocking',
  'Right-Click Disable',
  'Fullscreen Enforcement',
  'Object Detection (AI)',
  'Multiple Person Detection',
  'Double Camera Angle',
  'AI Tool Detection',
  'Eye Tracking',
  'Audio Monitoring',
  'Periodic Face Verification',
];

export function decodeExamId(examId: string) {
  const regex = /^LL-([A-Z0-9]{4})([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{3})$/i;
  const match = examId.toUpperCase().match(regex);
  if (!match) return null;

  const [, salt, tsFragment, featuresHex, durationHex] = match;
  const featureBitmask = parseInt(featuresHex, 16);
  const durationMinutes = parseInt(durationHex, 16);

  const enabledFeatures: { index: number; name: string }[] = [];
  for (let i = 0; i < 14; i++) {
    if (featureBitmask & (1 << i)) {
      enabledFeatures.push({ index: i, name: FEATURE_NAMES[i] });
    }
  }

  const featureFlags: FeatureFlags = {
    tab_switch_detection: !!(featureBitmask & (1 << 0)),
    focus_loss_detection: !!(featureBitmask & (1 << 1)),
    copy_paste_blocking: !!(featureBitmask & (1 << 2)),
    screen_share_blocking: !!(featureBitmask & (1 << 3)),
    screenshot_blocking: !!(featureBitmask & (1 << 4)),
    right_click_disable: !!(featureBitmask & (1 << 5)),
    fullscreen_enforcement: !!(featureBitmask & (1 << 6)),
    object_detection_ai: !!(featureBitmask & (1 << 7)),
    multiple_person_detection: !!(featureBitmask & (1 << 8)),
    double_camera_angle: !!(featureBitmask & (1 << 9)),
    ai_tool_detection: !!(featureBitmask & (1 << 10)),
    eye_tracking: !!(featureBitmask & (1 << 11)),
    audio_monitoring: !!(featureBitmask & (1 << 12)),
    periodic_face_verification: !!(featureBitmask & (1 << 13)),
  };

  return { salt, tsFragment, featureBitmask, durationMinutes, enabledFeatures, featureFlags };
}

export function buildBitmask(flags: FeatureFlags): number {
  const keys: (keyof FeatureFlags)[] = [
    'tab_switch_detection', 'focus_loss_detection', 'copy_paste_blocking',
    'screen_share_blocking', 'screenshot_blocking', 'right_click_disable',
    'fullscreen_enforcement', 'object_detection_ai', 'multiple_person_detection',
    'double_camera_angle', 'ai_tool_detection', 'eye_tracking',
    'audio_monitoring', 'periodic_face_verification',
  ];
  let bitmask = 0;
  keys.forEach((key, i) => { if (flags[key]) bitmask |= (1 << i); });
  return bitmask;
}

export function validateExamCode(code: string): boolean {
  return /^LL-([A-Z0-9]{4})([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{3})$/i.test(code);
}
