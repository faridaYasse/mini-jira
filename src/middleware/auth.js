const { createRemoteJWKSet, jwtVerify } = require('jose');

const awsRegion = process.env.AWS_REGION || process.env.COGNITO_REGION || process.env.DYNAMODB_REGION;
const JWKS_URL = `https://cognito-idp.${awsRegion}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}/.well-known/jwks.json`;

// Cached JWKS instance — reused across requests
let jwks;

function getJWKS() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(JWKS_URL));
  }
  return jwks;
}

async function authenticateToken(req, res, next) {
  if (process.env.NODE_ENV !== 'production') {
    const raw = req.headers['x-mock-user'];
    if (!raw) {
      return res.status(401).json({ error: 'Missing x-mock-user header' });
    }
    try {
      req.user = JSON.parse(raw);
    } catch {
      return res.status(401).json({ error: 'Invalid x-mock-user JSON' });
    }
    const pending = getPendingApproval(req.user);
    if (pending) return res.status(403).json(pending);
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, getJWKS());
    req.user = {
      userId: payload.sub,
      role: normalizeRole(payload['custom:role']),
      teamId: payload['custom:teamId'] || '',
      email: payload.email,
      name: payload.name,
    };

    const pending = getPendingApproval(req.user);
    if (pending) return res.status(403).json(pending);

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function isManager(req, res, next) {
  if (normalizeRole(req.user?.role) !== 'manager') {
    return res.status(403).json({ error: 'Insufficient role' });
  }

  next();
}

function enforceTeamAccess(req, itemTeamId) {
  if (normalizeRole(req.user?.role) === 'manager') return true;
  return req.user?.teamId === itemTeamId;
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function getPendingApproval(user) {
  const role = normalizeRole(user?.role);

  if (!role || !['manager', 'employee'].includes(role)) {
    return {
      code: 'PENDING_APPROVAL',
      message: 'Your account is pending approval. Please ask a manager/admin to assign your role and team.',
    };
  }

  if (role === 'employee' && !user?.teamId) {
    return {
      code: 'PENDING_APPROVAL',
      message: 'Your account is pending approval. Please ask a manager/admin to assign your team.',
    };
  }

  return null;
}

module.exports = {
  authenticateToken,
  authenticate: authenticateToken,
  isManager,
  enforceTeamAccess
};
