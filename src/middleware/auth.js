require("dotenv").config();
const { CognitoJwtVerifier } = require("aws-jwt-verify");

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse: "access",
  clientId: process.env.COGNITO_CLIENT_ID,
});

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const payload = await verifier.verify(token);

    req.user = {
      userId: payload.sub,
      email: payload.email,
      role: payload["custom:role"],
      teamId: payload["custom:teamId"],
    };

    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

const isManager = (req, res, next) => {
  if (req.user.role !== "manager") {
    return res.status(403).json({ message: "Access denied. Managers only." });
  }

  next();
};
const enforceTeamAccess = (req, itemTeamId) => {
  if (req.user.role === "manager") return true;
  return req.user.teamId === itemTeamId;
};
module.exports = { authenticate, isManager, enforceTeamAccess };