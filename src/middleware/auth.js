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
      role:   payload['custom:role'],
      teamId: payload['custom:teamId'],
      email:  payload.email,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function isManager(req, res, next) {
  if (req.user?.role !== 'manager') {
    return res.status(403).json({ error: 'Insufficient role' });
  }

  next();
}

function enforceTeamAccess(req, itemTeamId) {
  if (req.user?.role === 'manager') return true;
  return req.user?.teamId === itemTeamId;
}

module.exports = {
  authenticateToken,
  authenticate: authenticateToken,
  isManager,
  enforceTeamAccess
};
