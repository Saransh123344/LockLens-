// backend/src/middleware/auth.js
const jwt = require('jsonwebtoken');

function authMiddleware(requiredRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log(`[Auth] ❌ No token on ${req.method} ${req.path}`);
      return res.status(401).json({ error: 'No token provided. Please log in.' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        console.error('[Auth] ❌ JWT_SECRET not set in .env!');
        return res.status(500).json({ error: 'Server misconfiguration: JWT_SECRET missing' });
      }

      const decoded = jwt.verify(token, secret);
      req.user = decoded;

      if (requiredRoles.length > 0 && !requiredRoles.includes(decoded.role)) {
        console.log(`[Auth] ❌ Role mismatch on ${req.method} ${req.path} — required: [${requiredRoles}], got: "${decoded.role}" (user: ${decoded.email})`);
        return res.status(403).json({
          error: `Insufficient permissions. You are logged in as "${decoded.role}" but this action requires: ${requiredRoles.join(' or ')}.`,
          yourRole: decoded.role,
          required: requiredRoles
        });
      }

      next();
    } catch (err) {
      console.log(`[Auth] ❌ Token error on ${req.method} ${req.path}:`, err.message);
      return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    }
  };
}

module.exports = { authMiddleware };
