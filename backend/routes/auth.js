const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { logAction } = require('../middleware/audit');

const router = express.Router();
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SESSION_EXPIRES_IN = '24h';

const getAuthCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge: SESSION_MAX_AGE_MS,
  expires: new Date(Date.now() + SESSION_MAX_AGE_MS),
  path: '/'
});

const getClearCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  path: '/'
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user by email
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact administrator.' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: SESSION_EXPIRES_IN }
    );

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

    // Set HTTP-only cookie with strict 24h lifetime
    res.cookie('token', token, getAuthCookieOptions());

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

      // Get current user with password
      const { data: user, error } = await supabase
        .from('users')
        .select('id, password_hash')
        .eq('id', req.user.id)
        .single();

      if (error || !user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
      
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      // Hash new password
      const salt = await bcrypt.genSalt(10);
      const newPasswordHash = await bcrypt.hash(newPassword, salt);

      // Update password
      const { error: updateError } = await supabase
        .from('users')
        .update({ password_hash: newPasswordHash })
        .eq('id', req.user.id);

      if (updateError) {
        throw updateError;
      }

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
      
      // Clear the cookie
      res.clearCookie('token', getClearCookieOptions());
      
      res.json({ message: 'Logged out successfully' });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

module.exports = router;
