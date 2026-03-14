const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const XLSX = require('xlsx');
const supabase = require('../config/supabase');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');

const router = express.Router();

// Configure multer for Excel file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.endsWith('.xlsx') ||
      file.originalname.endsWith('.xls')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Generate random password
const generatePassword = (length = 10) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

const getPasswordFromEmailPrefix = (email) => {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const atIndex = normalizedEmail.indexOf('@');

  if (atIndex <= 0) {
    return null;
  }

  const localPart = normalizedEmail.slice(0, atIndex).trim();
  return localPart || null;
};

const getClassById = async (classId) => {
  const { data: classData, error } = await supabase
    .from('classes')
    .select('id, name, is_active')
    .eq('id', classId)
    .maybeSingle();
  if (error) throw error;

  return classData;
};

const getClassByName = async (className) => {
  const normalizedClassName = typeof className === 'string' ? className.trim() : '';

  const { data: classData, error } = await supabase
    .from('classes')
    .select('id, name, is_active')
    .eq('name', normalizedClassName)
    .maybeSingle();

  if (error) throw error;

  return classData;
};

const validateStudentEnrollment = async ({ classId, sectionId }) => {
  if (!classId) {
    return {
      valid: false,
      error: 'Class is required for students. Create a class first.'
    };
  }

  const classData = await getClassById(classId);

  if (!classData) {
    return {
      valid: false,
      error: 'Selected class was not found. Create the class first.'
    };
  }

  if (classData.is_active === false) {
    return {
      valid: false,
      error: 'Selected class is inactive. Assign students only to active classes.'
    };
  }

  if (!sectionId) {
    return { valid: true, classData, sectionData: null };
  }

  const { data: sectionData, error: sectionError } = await supabase
    .from('sections')
    .select('id, name')
    .eq('id', sectionId)
    .eq('class_id', classId)
    .maybeSingle();

  if (sectionError) throw sectionError;

  if (!sectionData) {
    return {
      valid: false,
      error: 'Selected section does not belong to the selected class.'
    };
  }

  return { valid: true, classData, sectionData };
};

const resolveStudentEnrollmentByNames = async ({ className, sectionName }) => {
  const normalizedClassName = typeof className === 'string' ? className.trim() : '';
  const normalizedSectionName = typeof sectionName === 'string' ? sectionName.trim() : '';

  if (!normalizedClassName) {
    return {
      valid: false,
      error: 'Class name is required for student uploads. Create the class first.'
    };
  }

  const classData = await getClassByName(normalizedClassName);

  if (!classData) {
    return {
      valid: false,
      error: `Class "${normalizedClassName}" was not found. Create it before uploading students.`
    };
  }

  if (classData.is_active === false) {
    return {
      valid: false,
      error: `Class "${normalizedClassName}" is inactive. Upload students only to active classes.`
    };
  }

  if (!normalizedSectionName) {
    return {
      valid: true,
      classId: classData.id,
      sectionId: null
    };
  }

  const { data: sectionData, error: sectionError } = await supabase
    .from('sections')
    .select('id, name')
    .eq('class_id', classData.id)
    .eq('name', normalizedSectionName)
    .maybeSingle();

  if (sectionError) throw sectionError;

  if (!sectionData) {
    return {
      valid: false,
      error: `Section "${normalizedSectionName}" was not found in class "${normalizedClassName}".`
    };
  }

  return {
    valid: true,
    classId: classData.id,
    sectionId: sectionData.id
  };
};

const cleanupUserDependencies = async ({ userId, role }) => {
  if (role === 'student') {
    const { error: studentDetailsError } = await supabase
      .from('student_details')
      .delete()
      .eq('user_id', userId);

    if (studentDetailsError) throw studentDetailsError;
  }

  if (role === 'teacher') {
    const { error: teacherAssignmentsError } = await supabase
      .from('teacher_assignments')
      .delete()
      .eq('teacher_id', userId);

    if (teacherAssignmentsError) throw teacherAssignmentsError;

    const { error: teacherDetailsError } = await supabase
      .from('teacher_details')
      .delete()
      .eq('user_id', userId);

    if (teacherDetailsError) throw teacherDetailsError;
  }

  const { error: auditLogsError } = await supabase
    .from('audit_logs')
    .update({ user_id: null })
    .eq('user_id', userId);

  if (auditLogsError) throw auditLogsError;

  const { error: createdByError } = await supabase
    .from('users')
    .update({ created_by: null })
    .eq('created_by', userId);

  if (createdByError) throw createdByError;
};

// Get all users (Admin only)
router.get('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const { role, class_id, section_id, zone, search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('users')
      .select('id, email, full_name, phone, profile_photo, role, is_active, created_at, last_login', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (role) {
      query = query.eq('role', role);
    }

    if (search) {
      query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
    }

    const { data: users, error, count } = await query;

    if (error) throw error;

    // Get additional details for each user
    const usersWithDetails = await Promise.all(users.map(async (user) => {
      let details = null;
      
      if (user.role === 'student') {
        const { data } = await supabase
          .from('student_details')
          .select(`
            roll_number, zone,
            classes:class_id(id, name),
            sections:section_id(id, name)
          `)
          .eq('user_id', user.id)
          .single();
        details = data;
      } else if (user.role === 'teacher') {
        const { data } = await supabase
          .from('teacher_details')
          .select('employee_id, department')
          .eq('user_id', user.id)
          .single();
        details = data;
      }
      
      return { ...user, details };
    }));

    res.json({
      users: usersWithDetails,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single user (Admin only)
router.get('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, full_name, phone, profile_photo, role, is_active, created_at, last_login')
      .eq('id', id)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let details = null;
    
    if (user.role === 'student') {
      const { data } = await supabase
        .from('student_details')
        .select(`
          roll_number, zone,
          classes:class_id(id, name),
          sections:section_id(id, name)
        `)
        .eq('user_id', user.id)
        .single();
      details = data;
    } else if (user.role === 'teacher') {
      const { data } = await supabase
        .from('teacher_details')
        .select('employee_id, department')
        .eq('user_id', user.id)
        .single();
      details = data;
    }

    res.json({ ...user, details });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create single user (Admin only)
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const {
      email,
      full_name,
      phone,
      profile_photo,
      role,
      // Student specific
      roll_number,
      class_id,
      section_id,
      zone,
      // Teacher specific
      employee_id,
      department
    } = req.body;

    // Validation
    if (!email || !full_name || !role) {
      return res.status(400).json({ error: 'Email, full name, and role are required' });
    }

    if (!['student', 'teacher'].includes(role)) {
      return res.status(400).json({ error: 'Role must be either student or teacher' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const derivedPassword = getPasswordFromEmailPrefix(normalizedEmail);

    if (!derivedPassword) {
      return res.status(400).json({ error: 'A valid email is required' });
    }

    if (role === 'student' && !roll_number) {
      return res.status(400).json({ error: 'Roll number is required for students' });
    }

    if (role === 'teacher' && !employee_id) {
      return res.status(400).json({ error: 'Employee ID is required for teachers' });
    }

    // Convert empty strings to null for optional fields
    const sanitizedClassId = class_id || null;
    const sanitizedSectionId = section_id || null;
    const sanitizedZone = zone || null;
    const sanitizedDepartment = department || null;
    const sanitizedPhone = phone || null;

    if (role === 'student') {
      const enrollmentValidation = await validateStudentEnrollment({
        classId: sanitizedClassId,
        sectionId: sanitizedSectionId
      });

      if (!enrollmentValidation.valid) {
        return res.status(400).json({ error: enrollmentValidation.error });
      }
    }

    // Check if email already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Password is always derived from email local part (before @)
    const userPassword = derivedPassword;
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(userPassword, salt);

    // Create user
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({
        email: normalizedEmail,
        password_hash: passwordHash,
        full_name,
        phone: sanitizedPhone,
        profile_photo: profile_photo || null,
        role,
        created_by: req.user.id
      })
      .select()
      .single();

    if (userError) throw userError;

    // Create role-specific details
    if (role === 'student') {
      const { error: studentError } = await supabase
        .from('student_details')
        .insert({
          user_id: newUser.id,
          roll_number,
          class_id: sanitizedClassId,
          section_id: sanitizedSectionId,
          zone: sanitizedZone
        });

      if (studentError) {
        // Rollback user creation
        await supabase.from('users').delete().eq('id', newUser.id);
        throw studentError;
      }
    } else if (role === 'teacher') {
      const { error: teacherError } = await supabase
        .from('teacher_details')
        .insert({
          user_id: newUser.id,
          employee_id,
          department: sanitizedDepartment
        });

      if (teacherError) {
        // Rollback user creation
        await supabase.from('users').delete().eq('id', newUser.id);
        throw teacherError;
      }
    }

    await logAction(req, 'CREATE', 'user', newUser.id, { role, email: normalizedEmail });

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: newUser.id,
        email: newUser.email,
        full_name: newUser.full_name,
        role: newUser.role
      },
      generatedPassword: userPassword
    });

  } catch (error) {
    console.error('Create user error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Duplicate entry. Email, roll number, or employee ID already exists.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user (Admin only)
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      email,
      full_name,
      phone,
      profile_photo,
      is_active,
      new_password,
      // Student specific
      roll_number,
      class_id,
      section_id,
      zone,
      // Teacher specific
      employee_id,
      department
    } = req.body;

    // Get current user
    const { data: currentUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent updating admin users (except by themselves)
    if (currentUser.role === 'admin' && req.user.id !== id) {
      return res.status(403).json({ error: 'Cannot modify other admin users' });
    }

    // Update user basic info
    const updateData = {};
    if (email !== undefined) {
      const normalizedEmail = String(email).trim().toLowerCase();
      if (!normalizedEmail || !getPasswordFromEmailPrefix(normalizedEmail)) {
        return res.status(400).json({ error: 'A valid email is required' });
      }
      updateData.email = normalizedEmail;
    }
    if (full_name !== undefined) {
      const normalizedFullName = String(full_name).trim();
      if (!normalizedFullName) {
        return res.status(400).json({ error: 'Full name is required' });
      }
      updateData.full_name = normalizedFullName;
    }
    if (phone !== undefined) updateData.phone = phone;
    if (profile_photo !== undefined) updateData.profile_photo = profile_photo;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (new_password !== undefined && new_password !== '') {
      const passwordValue = String(new_password);
      if (passwordValue.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
      }
      const salt = await bcrypt.genSalt(10);
      updateData.password_hash = await bcrypt.hash(passwordValue, salt);
    }

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', id);

      if (updateError) throw updateError;
    }

    // Update role-specific details
    let roleSpecificChanges = null;

    if (currentUser.role === 'student') {
      const studentUpdate = {};
      if (roll_number !== undefined) {
        const normalizedRollNumber = String(roll_number).trim();
        if (!normalizedRollNumber) {
          return res.status(400).json({ error: 'Roll number is required for students' });
        }
        studentUpdate.roll_number = normalizedRollNumber;
      }

      const normalizedClassId = class_id !== undefined ? class_id || null : undefined;
      const normalizedSectionId = section_id !== undefined ? section_id || null : undefined;

      if (normalizedClassId !== undefined || normalizedSectionId !== undefined) {
        const { data: currentStudentDetails, error: currentStudentError } = await supabase
          .from('student_details')
          .select('class_id, section_id')
          .eq('user_id', id)
          .maybeSingle();

        if (currentStudentError) throw currentStudentError;

        const effectiveClassId = normalizedClassId !== undefined
          ? normalizedClassId
          : currentStudentDetails?.class_id || null;

        const effectiveSectionId = normalizedSectionId !== undefined
          ? normalizedSectionId
          : currentStudentDetails?.section_id || null;

        const enrollmentValidation = await validateStudentEnrollment({
          classId: effectiveClassId,
          sectionId: effectiveSectionId
        });

        if (!enrollmentValidation.valid) {
          return res.status(400).json({ error: enrollmentValidation.error });
        }
      }

      if (normalizedClassId !== undefined) studentUpdate.class_id = normalizedClassId;
      if (normalizedSectionId !== undefined) studentUpdate.section_id = normalizedSectionId;
      if (zone !== undefined) studentUpdate.zone = zone || null;

      if (Object.keys(studentUpdate).length > 0) {
        const { error: studentError } = await supabase
          .from('student_details')
          .update(studentUpdate)
          .eq('user_id', id);

        if (studentError) throw studentError;
        roleSpecificChanges = { student_details: studentUpdate };
      }
    } else if (currentUser.role === 'teacher') {
      const teacherUpdate = {};
      if (employee_id !== undefined) {
        const normalizedEmployeeId = String(employee_id).trim();
        if (!normalizedEmployeeId) {
          return res.status(400).json({ error: 'Employee ID is required for teachers' });
        }
        teacherUpdate.employee_id = normalizedEmployeeId;
      }
      if (department !== undefined) teacherUpdate.department = department || null;

      if (Object.keys(teacherUpdate).length > 0) {
        const { error: teacherError } = await supabase
          .from('teacher_details')
          .update(teacherUpdate)
          .eq('user_id', id);

        if (teacherError) throw teacherError;
        roleSpecificChanges = { teacher_details: teacherUpdate };
      }
    }

    const auditAfter = {
      ...updateData,
      ...(roleSpecificChanges || {})
    };

    if (auditAfter.password_hash) {
      auditAfter.password_hash = '[REDACTED]';
    }

    await logAction(req, 'UPDATE', 'user', id, { before: currentUser, after: auditAfter });

    res.json({ message: 'User updated successfully' });

  } catch (error) {
    console.error('Update user error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Duplicate entry. Email, roll number, or employee ID already exists.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user (Admin only)
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Get current user
    const { data: currentUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deleting admin users
    if (currentUser.role === 'admin') {
      return res.status(403).json({ error: 'Cannot delete admin users' });
    }

    await cleanupUserDependencies({
      userId: id,
      role: currentUser.role
    });

    // Delete user after dependent records and references are cleaned up
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    await logAction(req, 'DELETE', 'user', id, { deleted_user: currentUser.email });

    res.json({ message: 'User deleted successfully' });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset user password (Admin only)
router.post('/:id/reset-password', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;

    // Get current user
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('id, email, role')
      .eq('id', id)
      .single();

    if (fetchError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate or use provided password
    const userPassword = new_password || generatePassword();
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(userPassword, salt);

    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: passwordHash })
      .eq('id', id);

    if (updateError) throw updateError;

    await logAction(req, 'UPDATE', 'user', id, { action: 'password_reset' });

    res.json({
      message: 'Password reset successfully',
      ...(new_password ? {} : { newPassword: userPassword })
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk upload users via Excel (Admin only)
router.post('/bulk-upload', verifyToken, isAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Excel file is required' });
    }

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    if (!data.length) {
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    const results = {
      success: [],
      failed: []
    };

    for (const row of data) {
      try {
        const {
          user_type,
          full_name,
          email,
          phone,
          roll_number,
          employee_id,
          class_name,
          section_name,
          zone,
          department
        } = row;

        // Validation
        if (!user_type || !full_name || !email) {
          results.failed.push({
            row,
            error: 'Missing required fields: user_type, full_name, or email'
          });
          continue;
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const derivedPassword = getPasswordFromEmailPrefix(normalizedEmail);

        if (!derivedPassword) {
          results.failed.push({
            row,
            error: 'A valid email is required'
          });
          continue;
        }

        const role = user_type.toLowerCase();
        if (!['student', 'teacher'].includes(role)) {
          results.failed.push({
            row,
            error: 'Invalid user_type. Must be "student" or "teacher"'
          });
          continue;
        }

        if (role === 'student' && !roll_number) {
          results.failed.push({
            row,
            error: 'Roll number is required for students'
          });
          continue;
        }

        if (role === 'student' && !class_name) {
          results.failed.push({
            row,
            error: 'Class name is required for students. Create the class first.'
          });
          continue;
        }

        if (role === 'teacher' && !employee_id) {
          results.failed.push({
            row,
            error: 'Employee ID is required for teachers'
          });
          continue;
        }

        // Check for existing email
        const { data: existingUser } = await supabase
          .from('users')
          .select('id')
          .eq('email', normalizedEmail)
          .single();

        if (existingUser) {
          results.failed.push({
            row,
            error: 'Email already exists'
          });
          continue;
        }

        // Get class and section IDs if provided
        let classId = null;
        let sectionId = null;

        if (role === 'student') {
          const enrollmentResolution = await resolveStudentEnrollmentByNames({
            className: class_name,
            sectionName: section_name
          });

          if (!enrollmentResolution.valid) {
            results.failed.push({
              row,
              error: enrollmentResolution.error
            });
            continue;
          }

          classId = enrollmentResolution.classId;
          sectionId = enrollmentResolution.sectionId;
        }

        // Password is always derived from email local part (before @)
        const userPassword = derivedPassword;
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(userPassword, salt);

        // Create user
        const { data: newUser, error: userError } = await supabase
          .from('users')
          .insert({
            email: normalizedEmail,
            password_hash: passwordHash,
            full_name,
            phone: phone || null,
            role,
            created_by: req.user.id
          })
          .select()
          .single();

        if (userError) {
          results.failed.push({
            row,
            error: userError.message
          });
          continue;
        }

        // Create role-specific details
        if (role === 'student') {
          const { error: studentError } = await supabase
            .from('student_details')
            .insert({
              user_id: newUser.id,
              roll_number,
              class_id: classId,
              section_id: sectionId,
              zone: zone ? zone.toLowerCase() : null
            });

          if (studentError) {
            await supabase.from('users').delete().eq('id', newUser.id);
            results.failed.push({
              row,
              error: studentError.message
            });
            continue;
          }
        } else if (role === 'teacher') {
          const { error: teacherError } = await supabase
            .from('teacher_details')
            .insert({
              user_id: newUser.id,
              employee_id,
              department: department || null
            });

          if (teacherError) {
            await supabase.from('users').delete().eq('id', newUser.id);
            results.failed.push({
              row,
              error: teacherError.message
            });
            continue;
          }
        }

        results.success.push({
          email: normalizedEmail,
          full_name,
          role,
          generatedPassword: userPassword
        });

      } catch (rowError) {
        results.failed.push({
          row,
          error: rowError.message
        });
      }
    }

    await logAction(req, 'BULK_CREATE', 'user', null, {
      total: data.length,
      success: results.success.length,
      failed: results.failed.length
    });

    res.json({
      message: 'Bulk upload completed',
      summary: {
        total: data.length,
        successful: results.success.length,
        failed: results.failed.length
      },
      results
    });

  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download Excel template
router.get('/template/download', verifyToken, isAdmin, (req, res) => {
  const templateType = String(req.query.type || '').trim().toLowerCase();
  let templateData;
  let fileName;
  let sheetName;

  if (templateType === 'student') {
    templateData = [
      {
        user_type: 'student',
        full_name: 'John Doe',
        email: 'john.doe@example.com',
        phone: '1234567890',
        roll_number: 'STU001',
        class_name: 'CSE-2024',
        section_name: 'A',
        zone: 'blue'
      }
    ];
    fileName = 'student_upload_template.xlsx';
    sheetName = 'Students';
  } else if (templateType === 'teacher') {
    templateData = [
      {
        user_type: 'teacher',
        full_name: 'Jane Smith',
        email: 'jane.smith@example.com',
        phone: '0987654321',
        employee_id: 'EMP001',
        department: 'Computer Science'
      }
    ];
    fileName = 'teacher_upload_template.xlsx';
    sheetName = 'Teachers';
  } else {
    return res.status(400).json({ error: 'Template type is required. Use type=student or type=teacher.' });
  }

  const worksheet = XLSX.utils.json_to_sheet(templateData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

module.exports = router;
