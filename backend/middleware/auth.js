const supabase = require('../config/supabase');
const {
  getAuthUserFromAccessToken,
  refreshAuthSession,
  normalizeEmail
} = require('../services/supabaseAuthService');
const {
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions
} = require('../utils/authCookies');

const REFRESH_COOKIE_MAX_AGE_DAYS = Number.parseInt(process.env.AUTH_REFRESH_TOKEN_DAYS || '30', 10);
const REFRESH_COOKIE_MAX_AGE_MS = Number.isFinite(REFRESH_COOKIE_MAX_AGE_DAYS) && REFRESH_COOKIE_MAX_AGE_DAYS > 0
  ? REFRESH_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  : 30 * 24 * 60 * 60 * 1000;

const getBearerToken = (req) => {
  const authorization = req.get('authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  const token = authorization.slice(7).trim();
  return token || null;
};

const isMissingAuthUserIdColumnError = (error) => String(error?.message || '').toLowerCase().includes('auth_user_id');

const fetchAppUserByAuthId = async (authUserId) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, is_active, auth_user_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error && isMissingAuthUserIdColumnError(error)) {
    return { data: null, error: null, missingAuthColumn: true };
  }

  return { data, error, missingAuthColumn: false };
};

const fetchAppUserByEmail = async (email, includeAuthUserId = true) => {
  if (includeAuthUserId) {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, is_active, auth_user_id')
      .eq('email', email)
      .maybeSingle();

    if (error && isMissingAuthUserIdColumnError(error)) {
      const fallback = await supabase
        .from('users')
        .select('id, email, full_name, role, is_active')
        .eq('email', email)
        .maybeSingle();

      return {
        data: fallback.data ? { ...fallback.data, auth_user_id: null } : null,
        error: fallback.error,
        missingAuthColumn: true
      };
    }

    return { data, error, missingAuthColumn: false };
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, is_active')
    .eq('email', email)
    .maybeSingle();

  return {
    data: data ? { ...data, auth_user_id: null } : null,
    error,
    missingAuthColumn: true
  };
};

// Verify Supabase access token from HTTP-only cookie or Authorization header.
const verifyToken = async (req, res, next) => {
  try {
    let accessToken = req.cookies?.token || getBearerToken(req);
    let refreshToken = req.cookies?.refresh_token || null;
    let authUser = null;
    let session = null;

    if (!accessToken && !refreshToken) {
      return res.status(401).json({ error: 'Access denied. No session provided.' });
    }

    if (accessToken) {
      try {
        authUser = await getAuthUserFromAccessToken(accessToken);
      } catch {
        authUser = null;
      }
    }

    if (!authUser && refreshToken) {
      try {
        session = await refreshAuthSession(refreshToken);
        accessToken = session?.access_token || null;
        refreshToken = session?.refresh_token || refreshToken;

        if (accessToken) {
          authUser = await getAuthUserFromAccessToken(accessToken);
        }
      } catch {
        authUser = null;
      }
    }

    if (!authUser) {
      return res.status(401).json({ error: 'Invalid or expired session token.' });
    }

    const authEmail = normalizeEmail(authUser.email);

    if (!authEmail) {
      return res.status(401).json({ error: 'Invalid session. Auth email is missing.' });
    }

    let userRecord = null;
    let missingAuthColumn = false;

    if (authUser.id) {
      const authIdLookup = await fetchAppUserByAuthId(authUser.id);

      if (authIdLookup.error) {
        return res.status(500).json({ error: 'Failed to validate user account.' });
      }

      userRecord = authIdLookup.data;
      missingAuthColumn = authIdLookup.missingAuthColumn;
    }

    if (!userRecord) {
      const emailLookup = await fetchAppUserByEmail(authEmail, !missingAuthColumn);

      if (emailLookup.error) {
        return res.status(500).json({ error: 'Failed to validate user account.' });
      }

      userRecord = emailLookup.data;
      missingAuthColumn = emailLookup.missingAuthColumn;
    }

    if (!userRecord) {
      return res.status(401).json({ error: 'Invalid session. User not found.' });
    }

    if (!userRecord.is_active) {
      return res.status(403).json({ error: 'Account is deactivated.' });
    }

    if (!missingAuthColumn && !userRecord.auth_user_id && authUser.id) {
      await supabase
        .from('users')
        .update({ auth_user_id: authUser.id })
        .eq('id', userRecord.id);

      userRecord.auth_user_id = authUser.id;
    }

    if (session?.access_token) {
      const expiresInSeconds = Number.parseInt(session.expires_in, 10);
      const accessMaxAgeMs = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? expiresInSeconds * 1000
        : undefined;

      res.cookie('token', session.access_token, getAccessTokenCookieOptions(accessMaxAgeMs));

      if (session.refresh_token) {
        res.cookie('refresh_token', session.refresh_token, getRefreshTokenCookieOptions(REFRESH_COOKIE_MAX_AGE_MS));
      }
    }

    req.user = {
      id: userRecord.id,
      email: userRecord.email,
      full_name: userRecord.full_name,
      role: userRecord.role,
      is_active: userRecord.is_active,
      auth_user_id: userRecord.auth_user_id || authUser.id
    };
    req.authUser = authUser;
    req.authAccessToken = accessToken;
    req.authRefreshToken = refreshToken;

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid session token.' });
  }
};

// Check if user is admin
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }
  next();
};

// Check if user is teacher or admin
const isTeacherOrAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'teacher') {
    return res.status(403).json({ error: 'Access denied. Teacher or Admin privileges required.' });
  }
  next();
};

// Check specific roles
const hasRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Required roles: ${roles.join(', ')}` });
    }
    next();
  };
};

module.exports = {
  verifyToken,
  isAdmin,
  isTeacherOrAdmin,
  hasRole
};
