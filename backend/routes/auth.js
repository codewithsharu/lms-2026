const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { logAction } = require('../middleware/audit');
const {
  authenticateWithPassword,
  createAuthUser,
  updateAuthUser,
  updateCurrentUserPassword,
  signOutAuthSession,
  normalizeEmail
} = require('../services/supabaseAuthService');
const {
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
  getClearCookieOptions
} = require('../utils/authCookies');

const router = express.Router();
const REFRESH_COOKIE_MAX_AGE_DAYS = Number.parseInt(process.env.AUTH_REFRESH_TOKEN_DAYS || '30', 10);
const REFRESH_COOKIE_MAX_AGE_MS = Number.isFinite(REFRESH_COOKIE_MAX_AGE_DAYS) && REFRESH_COOKIE_MAX_AGE_DAYS > 0
  ? REFRESH_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  : 30 * 24 * 60 * 60 * 1000;

const isMissingAuthUserIdColumnError = (error) => String(error?.message || '').toLowerCase().includes('auth_user_id');

const syncAuthUserLink = async (appUserId, authUserId) => {
  if (!appUserId || !authUserId) {
    return;
  }

  const { error } = await supabase
    .from('users')
    .update({ auth_user_id: authUserId })
    .eq('id', appUserId);

  if (error && !isMissingAuthUserIdColumnError(error)) {
    throw error;
  }
};

const attemptLegacyPasswordMigration = async ({ email, password }) => {
  const normalizedEmail = normalizeEmail(email);

  const { data: legacyUser, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (error || !legacyUser || !legacyUser.password_hash) {
    return null;
  }

  const isValidPassword = await bcrypt.compare(password, legacyUser.password_hash);

  if (!isValidPassword) {
    return null;
  }

  const provisionResult = await createAuthUser({
    email: legacyUser.email,
    password,
    role: legacyUser.role,
    fullName: legacyUser.full_name
  });

  if (!provisionResult?.user?.id) {
    return null;
  }

  await updateAuthUser(provisionResult.user.id, {
    password,
    role: legacyUser.role,
    fullName: legacyUser.full_name
  });

  await syncAuthUserLink(legacyUser.id, provisionResult.user.id);

  return authenticateWithPassword(legacyUser.email, password);
};

const getAppUserByAuthIdentity = async (authUser) => {
  let missingAuthColumn = false;
  let userRecord = null;

  if (authUser?.id) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();

    if (error && isMissingAuthUserIdColumnError(error)) {
      missingAuthColumn = true;
    } else if (error) {
      throw error;
    } else {
      userRecord = data;
    }
  }

  if (!userRecord) {
    const normalizedEmail = normalizeEmail(authUser?.email);
    if (!normalizedEmail) {
      return { userRecord: null, missingAuthColumn };
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (error) {
      throw error;
    }

    userRecord = data;
  }

  if (userRecord && !missingAuthColumn && authUser?.id && !userRecord.auth_user_id) {
    await supabase
      .from('users')
      .update({ auth_user_id: authUser.id })
      .eq('id', userRecord.id);

    userRecord.auth_user_id = authUser.id;
  }

  return { userRecord, missingAuthColumn };
};

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    let authPayload;
    try {
      authPayload = await authenticateWithPassword(email, password);
    } catch (authError) {
      try {
        authPayload = await attemptLegacyPasswordMigration({ email, password });
      } catch (migrationError) {
        if (migrationError?.code === 'SUPABASE_ADMIN_REQUIRED') {
          return res.status(500).json({ error: migrationError.message });
        }

        throw migrationError;
      }

      if (!authPayload) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
    }

    const session = authPayload?.session;
    const authUser = authPayload?.user;

    if (!session || !authUser) {
      return res.status(401).json({ error: 'Unable to establish session. Please try again.' });
    }

    const { userRecord: user } = await getAppUserByAuthIdentity(authUser);

    if (!user) {
      return res.status(403).json({ error: 'No application profile found for this account.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact administrator.' });
    }

    // Update last login
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // Get additional details based on role
    let additionalDetails = null;
    
    if (user.role === 'student') {
      const { data: studentData } = await supabase
        .from('student_details')
        .select(`
          *,
          classes:class_id(id, name),
          sections:section_id(id, name)
        `)
        .eq('user_id', user.id)
        .single();
      additionalDetails = studentData;
    } else if (user.role === 'teacher') {
      const { data: teacherData } = await supabase
        .from('teacher_details')
        .select('*')
        .eq('user_id', user.id)
        .single();
      additionalDetails = teacherData;
    }

    // Log the login action
    await logAction(
      { user: { id: user.id, email: user.email, role: user.role }, originalUrl: '/api/auth/login', method: 'POST', body: { email }, ip: req.ip, get: (h) => req.get(h) },
      'LOGIN',
      'user',
      user.id
    );

    const expiresInSeconds = Number.parseInt(session.expires_in, 10);
    const accessTokenMaxAgeMs = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? expiresInSeconds * 1000
      : undefined;

    res.cookie('token', session.access_token, getAccessTokenCookieOptions(accessTokenMaxAgeMs));

    if (session.refresh_token) {
      res.cookie('refresh_token', session.refresh_token, getRefreshTokenCookieOptions(REFRESH_COOKIE_MAX_AGE_MS));
    }

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        profile_photo: user.profile_photo,
        details: additionalDetails
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user profile
router.get('/me', async (req, res) => {
  const { verifyToken } = require('../middleware/auth');
  
  verifyToken(req, res, async () => {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('id, email, full_name, phone, profile_photo, role, created_at, last_login')
        .eq('id', req.user.id)
        .single();

      if (error || !user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get additional details based on role
      let additionalDetails = null;
      
      if (user.role === 'student') {
        const { data: studentData } = await supabase
          .from('student_details')
          .select(`
            *,
            classes:class_id(id, name),
            sections:section_id(id, name)
          `)
          .eq('user_id', user.id)
          .single();
        additionalDetails = studentData;
      } else if (user.role === 'teacher') {
        const { data: teacherData } = await supabase
          .from('teacher_details')
          .select('*')
          .eq('user_id', user.id)
          .single();
        additionalDetails = teacherData;
      }

      res.json({
        ...user,
        details: additionalDetails
      });

    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// Change password
router.put('/change-password', async (req, res) => {
  const { verifyToken } = require('../middleware/auth');
  
  verifyToken(req, res, async () => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current password and new password are required' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
      }

      try {
        await authenticateWithPassword(req.user.email, currentPassword);
      } catch {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      await updateCurrentUserPassword(req.authAccessToken, newPassword);

      await logAction(req, 'UPDATE', 'user', req.user.id, { field: 'password' });

      res.json({ message: 'Password changed successfully' });

    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// Logout (clear cookie and log it)
router.post('/logout', async (req, res) => {
  const { verifyToken } = require('../middleware/auth');
  
  verifyToken(req, res, async () => {
    try {
      await logAction(req, 'LOGOUT', 'user', req.user.id);

      try {
        await signOutAuthSession(req.authAccessToken);
      } catch {
        // Session revoke failures should not block logout response.
      }
      
      res.clearCookie('token', getClearCookieOptions());
      res.clearCookie('refresh_token', getClearCookieOptions());
      
      res.json({ message: 'Logged out successfully' });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

module.exports = router;
