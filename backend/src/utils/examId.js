// backend/src/utils/examId.js
// LockLens Exam ID Format: LL-XXXXTTTT-FFFF-DDD
// LL     = LockLens prefix
// XXXX   = 4-char random salt (A-Z0-9)
// TTTT   = 4-char timestamp fragment (last 4 hex digits of unix timestamp)
// FFFF   = 4-char hex bitmask (14 features, bits 0-13)
// DDD    = 3-char hex duration in minutes

const FEATURE_NAMES = [
  'Tab Switch Detection',        // bit 0
  'Focus Loss Detection',        // bit 1
  'Copy/Paste Blocking',         // bit 2
  'Screen Share Blocking',       // bit 3
  'Screenshot Blocking',         // bit 4
  'Right-Click Disable',         // bit 5
  'Fullscreen Enforcement',      // bit 6
  'Object Detection (AI)',       // bit 7
  'Multiple Person Detection',   // bit 8
  'Double Camera Angle',         // bit 9
  'AI Tool Detection',           // bit 10
  'Eye Tracking',                // bit 11
  'Audio Monitoring',            // bit 12
  'Periodic Face Verification',  // bit 13
];

function generateExamId(featureBitmask, durationMinutes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const salt = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const ts = (Date.now() & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
  const features = (featureBitmask & 0x3FFF).toString(16).toUpperCase().padStart(4, '0');
  const duration = Math.min(durationMinutes, 0xFFF).toString(16).toUpperCase().padStart(3, '0');
  return `LL-${salt}${ts}-${features}-${duration}`;
}

function decodeExamId(examId) {
  // Validate format
  const regex = /^LL-([A-Z0-9]{4})([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{3})$/i;
  const match = examId.toUpperCase().match(regex);
  if (!match) return null;

  const [, salt, tsFragment, featuresHex, durationHex] = match;
  const featureBitmask = parseInt(featuresHex, 16);
  const durationMinutes = parseInt(durationHex, 16);

  const enabledFeatures = [];
  for (let i = 0; i < 14; i++) {
    if (featureBitmask & (1 << i)) {
      enabledFeatures.push({ index: i, name: FEATURE_NAMES[i] });
    }
  }

  return {
    examId,
    salt,
    tsFragment,
    featureBitmask,
    durationMinutes,
    enabledFeatures,
    featureFlags: Object.fromEntries(
      FEATURE_NAMES.map((name, i) => [
        name.toLowerCase().replace(/[^a-z]+/g, '_'),
        !!(featureBitmask & (1 << i))
      ])
    )
  };
}

function validateExamId(examId) {
  const regex = /^LL-([A-Z0-9]{4})([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{3})$/i;
  return regex.test(examId);
}

module.exports = { generateExamId, decodeExamId, validateExamId, FEATURE_NAMES };
