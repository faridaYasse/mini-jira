function requireRole(...roles) {
  return (req, res, next) => {
    const role = String(req.user?.role || '').toLowerCase();
    const allowedRoles = roles.map((item) => String(item).toLowerCase());

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Insufficient role' });
    }

    next();
  };
}

module.exports = { requireRole };
