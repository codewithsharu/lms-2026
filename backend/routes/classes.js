const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const supabase = require('../config/supabase');
const { verifyToken, isAdmin, hasRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');
const {
  createAuthUser,
  updateAuthUser,
  deleteAuthUser,
  findAuthUserByEmail
} = require('../services/supabaseAuthService');

const router = express.Router();
const LEGACY_PASSWORD_PLACEHOLDER = '__SUPABASE_AUTH__';

const bulkUploadStorage = multer.memoryStorage();
const bulkUpload = multer({
  storage: bulkUploadStorage,
  fileFilter: (req, file, cb) => {
    if (file.originalname?.toLowerCase().endsWith('.csv') || file.mimetype === 'text/csv') {
      cb(null, true);
      return;
    }

    cb(new Error('Only CSV files are allowed'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

const getPasswordFromEmailPrefix = (email) => {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const atIndex = normalizedEmail.indexOf('@');

  if (atIndex <= 0) {
    return null;
  }

  const localPart = normalizedEmail.slice(0, atIndex).trim();
  return localPart || null;
};

const isMissingAuthUserIdColumnError = (error) => String(error?.message || '').toLowerCase().includes('auth_user_id');

const insertUserWithOptionalAuthLink = async (payload, selectClause = '*') => {
  const { auth_user_id: _authUserId, ...fallbackPayload } = payload;

  const withAuth = await supabase
    .from('users')
    .insert(payload)
    .select(selectClause)
    .single();

  if (!withAuth.error || !isMissingAuthUserIdColumnError(withAuth.error)) {
    return withAuth;
  }

  return supabase
    .from('users')
    .insert(fallbackPayload)
    .select(selectClause)
    .single();
};

const syncAuthUserIdOnAppUser = async (appUserId, authUserId) => {
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

const resolveAuthUserId = async ({ authUserId, email, appUserId = null }) => {
  if (authUserId) {
    return authUserId;
  }

  const authUser = await findAuthUserByEmail(email);

  if (!authUser?.id) {
    return null;
  }

  if (appUserId) {
    await syncAuthUserIdOnAppUser(appUserId, authUser.id);
  }

  return authUser.id;
};

const isAuthAdminMissingError = (error) => error?.code === 'SUPABASE_ADMIN_REQUIRED';

const hasSectionAccess = (assignments, sectionId) => {
  if (!sectionId) {
    return assignments.some((assignment) => assignment.section_id === null);
  }

  return assignments.some(
    (assignment) => assignment.section_id === null || assignment.section_id === sectionId
  );
};

const hasZoneAccess = (assignments, zone) => {
  if (!zone) {
    return assignments.some((assignment) => assignment.zone === null);
  }

  return assignments.some(
    (assignment) => assignment.zone === null || assignment.zone === zone
  );
};

const normalizeZone = (zoneValue) => {
  if (zoneValue === undefined || zoneValue === null) return null;
  const normalizedZone = String(zoneValue).trim().toLowerCase();
  if (!normalizedZone) return null;
  if (!['blue', 'red', 'green'].includes(normalizedZone)) return null;
  return normalizedZone;
};

const parseCsvRows = (fileBuffer) => {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  const pick = (row, keys) => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
        return String(row[key]).trim();
      }
    }
    return '';
  };

  return rawRows.map((row, index) => ({
    rowNumber: index + 2,
    full_name: pick(row, ['full_name', 'full name', 'name', 'Full Name', 'Name']),
    email: pick(row, ['email', 'Email']).toLowerCase(),
    phone: pick(row, ['phone', 'Phone']),
    roll_number: pick(row, ['roll_number', 'roll number', 'roll', 'Roll Number', 'Roll']),
    section_id: pick(row, ['section_id', 'section id', 'Section ID']),
    section_name: pick(row, ['section_name', 'section name', 'section', 'Section Name', 'Section']),
    zone: pick(row, ['zone', 'Zone'])
  }));
};

const parseBulkAssignmentRows = (fileBuffer) => {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  const pick = (row, keys) => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
        return String(row[key]).trim();
      }
    }
    return '';
  };

  return rawRows.map((row, index) => ({
    rowNumber: index + 2,
    teacher_id: pick(row, ['teacher_id', 'teacher id', 'Teacher ID']),
    teacher_email: pick(row, ['teacher_email', 'teacher email', 'email', 'Teacher Email', 'Email']).toLowerCase(),
    section_id: pick(row, ['section_id', 'section id', 'Section ID']),
    section_name: pick(row, ['section_name', 'section name', 'section', 'Section Name', 'Section']),
    zone: pick(row, ['zone', 'Zone'])
  }));
};

const getTeacherAssignmentsForClass = async (teacherId, classId) => {
  const { data: teacherAssignments, error } = await supabase
    .from('teacher_assignments')
    .select('id, section_id, zone')
    .eq('teacher_id', teacherId)
    .eq('class_id', classId);

  if (error) throw error;
  return teacherAssignments || [];
};

const getClassSectionsByClassId = async (classId) => {
  const { data: sections, error } = await supabase
    .from('sections')
    .select('id, name')
    .eq('class_id', classId);

  if (error) throw error;

  const byId = new Map();
  const byName = new Map();

  (sections || []).forEach((section) => {
    byId.set(section.id, section);
    byName.set(String(section.name).trim().toLowerCase(), section);
  });

  return { byId, byName };
};

const resolveSectionId = ({ sectionId, sectionName, sectionMaps }) => {
  if (sectionId) {
    const section = sectionMaps.byId.get(sectionId);
    return section ? section.id : null;
  }

  if (sectionName) {
    const section = sectionMaps.byName.get(String(sectionName).trim().toLowerCase());
    return section ? section.id : null;
  }

  return null;
};

const validateBulkStudentRow = ({ row, teacherAssignments, sectionMaps }) => {
  const errors = [];

  if (!row.full_name) errors.push('Full name is required');
  if (!row.email) errors.push('Email is required');
  if (!row.roll_number) errors.push('Roll number is required');

  if (row.email && (!row.email.includes('@') || row.email.startsWith('@') || row.email.endsWith('@'))) {
    errors.push('Invalid email format');
  }

  const resolvedSectionId = resolveSectionId({
    sectionId: row.section_id || null,
    sectionName: row.section_name || null,
    sectionMaps
  });

  if ((row.section_id || row.section_name) && !resolvedSectionId) {
    errors.push('Section not found in selected class');
  }

  const resolvedZone = row.zone ? normalizeZone(row.zone) : null;
  if (row.zone && !resolvedZone) {
    errors.push('Zone must be blue, red, or green');
  }

  if (!errors.length) {
    if (!hasSectionAccess(teacherAssignments, resolvedSectionId)) {
      errors.push('Teacher not assigned to this section');
    }

    if (!hasZoneAccess(teacherAssignments, resolvedZone)) {
      errors.push('Teacher not assigned to this zone');
    }
  }

  return {
    errors,
    normalized: {
      full_name: row.full_name,
      email: row.email,
      phone: row.phone || null,
      roll_number: row.roll_number,
      section_id: resolvedSectionId,
      zone: resolvedZone
    }
  };
};

// ==================== CLASSES ====================

// Get all classes (Admin only)
router.get('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const { is_active, search } = req.query;

    let query = supabase
      .from('classes')
      .select('*')
      .order('name');

    if (is_active !== undefined) {
      query = query.eq('is_active', is_active === 'true');
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data: classes, error } = await query;

    if (error) throw error;

    // Get section counts for each class
    const classesWithCounts = await Promise.all(classes.map(async (cls) => {
      const { count: sectionCount } = await supabase
        .from('sections')
        .select('*', { count: 'exact', head: true })
        .eq('class_id', cls.id);

      const { count: studentCount } = await supabase
        .from('student_details')
        .select('*', { count: 'exact', head: true })
        .eq('class_id', cls.id);

      const { count: teacherCount } = await supabase
        .from('teacher_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('class_id', cls.id);

      return {
        ...cls,
        section_count: sectionCount || 0,
        student_count: studentCount || 0,
        teacher_count: teacherCount || 0
      };
    }));

    res.json(classesWithCounts);
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get assigned students for logged-in teacher
router.get('/teacher/assigned-students', verifyToken, hasRole('teacher'), async (req, res) => {
  try {
    const { data: assignments, error: assignmentError } = await supabase
      .from('teacher_assignments')
      .select(`
        id, class_id, section_id, zone, created_at,
        class:class_id(id, name),
        section:section_id(id, name)
      `)
      .eq('teacher_id', req.user.id)
      .order('created_at', { ascending: false });

    if (assignmentError) throw assignmentError;

    if (!assignments || assignments.length === 0) {
      return res.json({
        assignments: [],
        summary: {
          total_assignments: 0,
          total_students: 0
        }
      });
    }

    const uniqueStudentIds = new Set();

    const assignmentsWithStudents = await Promise.all(assignments.map(async (assignment) => {
      let studentQuery = supabase
        .from('student_details')
        .select(`
          id, roll_number, zone,
          user:users!inner(id, full_name, email, phone, is_active),
          class:class_id(id, name),
          section:section_id(id, name)
        `)
        .eq('class_id', assignment.class_id)
        .eq('users.is_active', true)
        .order('roll_number');

      if (assignment.section_id) {
        studentQuery = studentQuery.eq('section_id', assignment.section_id);
      }

      if (assignment.zone) {
        studentQuery = studentQuery.eq('zone', assignment.zone);
      }

      const { data: assignmentStudents, error: studentError } = await studentQuery;

      if (studentError) throw studentError;

      const students = (assignmentStudents || []).map((student) => {
        const userData = Array.isArray(student.user) ? student.user[0] : student.user;

        if (userData?.id) {
          uniqueStudentIds.add(userData.id);
        }

        return {
          id: userData?.id || student.id,
          full_name: userData?.full_name || 'Unknown',
          email: userData?.email || '',
          phone: userData?.phone || null,
          roll_number: student.roll_number,
          zone: student.zone,
          class: student.class || null,
          section: student.section || null
        };
      });

      return {
        assignment_id: assignment.id,
        class: assignment.class || null,
        section: assignment.section || null,
        zone: assignment.zone,
        student_count: students.length,
        students
      };
    }));

    res.json({
      assignments: assignmentsWithStudents,
      summary: {
        total_assignments: assignmentsWithStudents.length,
        total_students: uniqueStudentIds.size
      }
    });
  } catch (error) {
    console.error('Get assigned students error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create student in an assigned class (Teacher only)
router.post('/teacher/classes/:classId/students', verifyToken, hasRole('teacher'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { email, full_name, phone, roll_number, section_id, zone } = req.body;

    if (!email || !full_name || !roll_number) {
      return res.status(400).json({ error: 'Email, full name, and roll number are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedFullName = String(full_name).trim();
    const normalizedRollNumber = String(roll_number).trim();
    const normalizedSectionId = section_id || null;
    const normalizedZone = zone || null;
    const normalizedPhone = phone || null;

    if (!normalizedFullName) {
      return res.status(400).json({ error: 'Full name is required' });
    }

    if (!normalizedRollNumber) {
      return res.status(400).json({ error: 'Roll number is required' });
    }

    const derivedPassword = getPasswordFromEmailPrefix(normalizedEmail);
    if (!derivedPassword) {
      return res.status(400).json({ error: 'A valid email is required' });
    }

    const { data: teacherAssignments, error: assignmentError } = await supabase
      .from('teacher_assignments')
      .select('id, section_id, zone')
      .eq('teacher_id', req.user.id)
      .eq('class_id', classId);

    if (assignmentError) throw assignmentError;

    if (!teacherAssignments || teacherAssignments.length === 0) {
      return res.status(403).json({ error: 'You are not assigned to this class' });
    }

    const sectionAllowed = hasSectionAccess(teacherAssignments, normalizedSectionId);

    if (!sectionAllowed) {
      return res.status(403).json({ error: 'You are not assigned to this section in the selected class' });
    }

    const zoneAllowed = hasZoneAccess(teacherAssignments, normalizedZone);

    if (!zoneAllowed) {
      return res.status(403).json({ error: 'You are not assigned to this zone in the selected class' });
    }

    if (normalizedSectionId) {
      const { data: sectionData, error: sectionError } = await supabase
        .from('sections')
        .select('id')
        .eq('id', normalizedSectionId)
        .eq('class_id', classId)
        .maybeSingle();

      if (sectionError) throw sectionError;

      if (!sectionData) {
        return res.status(400).json({ error: 'Selected section does not belong to the selected class' });
      }
    }

    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    let authProvisionResult;

    try {
      authProvisionResult = await createAuthUser({
        email: normalizedEmail,
        password: derivedPassword,
        role: 'student',
        fullName: normalizedFullName,
        isActive: true
      });
    } catch (authError) {
      if (isAuthAdminMissingError(authError)) {
        return res.status(500).json({ error: authError.message });
      }

      throw authError;
    }

    if (!authProvisionResult?.user?.id) {
      return res.status(500).json({ error: 'Failed to provision auth account for student.' });
    }

    if (!authProvisionResult.created) {
      await updateAuthUser(authProvisionResult.user.id, {
        password: derivedPassword,
        role: 'student',
        fullName: normalizedFullName,
        isActive: true
      });
    }

    const { data: newUser, error: userError } = await insertUserWithOptionalAuthLink(
      {
        email: normalizedEmail,
        password_hash: LEGACY_PASSWORD_PLACEHOLDER,
        auth_user_id: authProvisionResult.user.id,
        full_name: normalizedFullName,
        phone: normalizedPhone,
        role: 'student',
        created_by: req.user.id
      },
      'id, email, full_name, role'
    );

    if (userError) {
      if (authProvisionResult.created) {
        try {
          await deleteAuthUser(authProvisionResult.user.id);
        } catch {
          // Best effort rollback for provisioned auth account.
        }
      }

      throw userError;
    }

    const { error: studentError } = await supabase
      .from('student_details')
      .insert({
        user_id: newUser.id,
        roll_number: normalizedRollNumber,
        class_id: classId,
        section_id: normalizedSectionId,
        zone: normalizedZone
      });

    if (studentError) {
      await supabase.from('users').delete().eq('id', newUser.id);

      if (authProvisionResult.created) {
        try {
          await deleteAuthUser(authProvisionResult.user.id);
        } catch {
          // Best effort rollback for provisioned auth account.
        }
      }

      throw studentError;
    }

    await logAction(req, 'CREATE', 'user', newUser.id, {
      role: 'student',
      class_id: classId,
      section_id: normalizedSectionId,
      zone: normalizedZone,
      email: normalizedEmail
    });

    res.status(201).json({
      message: 'Student added successfully',
      user: newUser,
      generatedPassword: derivedPassword
    });
  } catch (error) {
    console.error('Teacher create student error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Duplicate entry. Email or roll number already exists.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Preview bulk student add from CSV (Teacher only)
router.post('/teacher/classes/:classId/students/bulk-preview', verifyToken, hasRole('teacher'), bulkUpload.single('file'), async (req, res) => {
  try {
    const { classId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }

    const teacherAssignments = await getTeacherAssignmentsForClass(req.user.id, classId);

    if (!teacherAssignments.length) {
      return res.status(403).json({ error: 'You are not assigned to this class' });
    }

    const sectionMaps = await getClassSectionsByClassId(classId);
    const parsedRows = parseCsvRows(req.file.buffer);

    if (!parsedRows.length) {
      return res.status(400).json({ error: 'CSV file is empty' });
    }

    const emailFrequency = new Map();
    const rollFrequency = new Map();

    parsedRows.forEach((row) => {
      if (row.email) {
        emailFrequency.set(row.email, (emailFrequency.get(row.email) || 0) + 1);
      }
      if (row.roll_number) {
        rollFrequency.set(row.roll_number, (rollFrequency.get(row.roll_number) || 0) + 1);
      }
    });

    const emailList = Array.from(emailFrequency.keys());
    const rollList = Array.from(rollFrequency.keys());

    const existingEmails = new Set();
    const existingRollNumbers = new Set();

    if (emailList.length) {
      const { data: existingUsers, error: existingUserError } = await supabase
        .from('users')
        .select('email')
        .in('email', emailList);

      if (existingUserError) throw existingUserError;

      (existingUsers || []).forEach((user) => existingEmails.add(user.email));
    }

    if (rollList.length) {
      const { data: existingStudents, error: existingStudentsError } = await supabase
        .from('student_details')
        .select('roll_number')
        .in('roll_number', rollList);

      if (existingStudentsError) throw existingStudentsError;

      (existingStudents || []).forEach((student) => existingRollNumbers.add(student.roll_number));
    }

    const previewRows = [];
    const candidates = [];

    parsedRows.forEach((row) => {
      const validation = validateBulkStudentRow({ row, teacherAssignments, sectionMaps });
      const reasons = [...validation.errors];

      if (row.email && (emailFrequency.get(row.email) || 0) > 1) {
        reasons.push('Duplicate email in CSV');
      }

      if (row.roll_number && (rollFrequency.get(row.roll_number) || 0) > 1) {
        reasons.push('Duplicate roll number in CSV');
      }

      if (row.email && existingEmails.has(row.email)) {
        reasons.push('Email already exists');
      }

      if (row.roll_number && existingRollNumbers.has(row.roll_number)) {
        reasons.push('Roll number already exists');
      }

      const uniqueReasons = Array.from(new Set(reasons));
      const status = uniqueReasons.length ? 'skipped' : 'ready';

      const previewRow = {
        rowNumber: row.rowNumber,
        full_name: row.full_name,
        email: row.email,
        roll_number: row.roll_number,
        section_id: validation.normalized.section_id,
        zone: validation.normalized.zone,
        status,
        reasons: uniqueReasons
      };

      previewRows.push(previewRow);

      if (status === 'ready') {
        candidates.push({
          full_name: validation.normalized.full_name,
          email: validation.normalized.email,
          phone: validation.normalized.phone,
          roll_number: validation.normalized.roll_number,
          section_id: validation.normalized.section_id,
          zone: validation.normalized.zone
        });
      }
    });

    res.json({
      message: 'Preview generated successfully',
      summary: {
        total: previewRows.length,
        ready: previewRows.filter((row) => row.status === 'ready').length,
        skipped: previewRows.filter((row) => row.status === 'skipped').length
      },
      rows: previewRows,
      candidates
    });
  } catch (error) {
    console.error('Teacher bulk preview error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Import students from validated preview rows (Teacher only)
router.post('/teacher/classes/:classId/students/bulk-import', verifyToken, hasRole('teacher'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { candidates } = req.body;

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'Candidates array is required' });
    }

    const teacherAssignments = await getTeacherAssignmentsForClass(req.user.id, classId);

    if (!teacherAssignments.length) {
      return res.status(403).json({ error: 'You are not assigned to this class' });
    }

    const sectionMaps = await getClassSectionsByClassId(classId);
    const results = [];
    const created = [];
    const seenEmails = new Set();
    const seenRolls = new Set();

    for (const candidate of candidates) {
      const row = {
        full_name: String(candidate.full_name || '').trim(),
        email: String(candidate.email || '').trim().toLowerCase(),
        phone: candidate.phone || null,
        roll_number: String(candidate.roll_number || '').trim(),
        section_id: candidate.section_id || null,
        section_name: '',
        zone: candidate.zone || null
      };

      const validation = validateBulkStudentRow({ row, teacherAssignments, sectionMaps });
      const reasons = [...validation.errors];

      if (seenEmails.has(row.email)) reasons.push('Duplicate email in upload');
      if (seenRolls.has(row.roll_number)) reasons.push('Duplicate roll number in upload');

      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', row.email)
        .maybeSingle();

      if (existingUser) reasons.push('Email already exists');

      const { data: existingStudent } = await supabase
        .from('student_details')
        .select('id')
        .eq('roll_number', row.roll_number)
        .maybeSingle();

      if (existingStudent) reasons.push('Roll number already exists');

      if (reasons.length) {
        results.push({
          email: row.email,
          roll_number: row.roll_number,
          status: 'skipped',
          reasons: Array.from(new Set(reasons))
        });
        continue;
      }

      const derivedPassword = getPasswordFromEmailPrefix(row.email);
      let authProvisionResult;

      try {
        authProvisionResult = await createAuthUser({
          email: row.email,
          password: derivedPassword,
          role: 'student',
          fullName: row.full_name,
          isActive: true
        });
      } catch (authError) {
        if (isAuthAdminMissingError(authError)) {
          results.push({
            email: row.email,
            roll_number: row.roll_number,
            status: 'skipped',
            reasons: [authError.message]
          });
          continue;
        }

        results.push({
          email: row.email,
          roll_number: row.roll_number,
          status: 'skipped',
          reasons: [authError.message || 'Failed to provision auth account']
        });
        continue;
      }

      if (!authProvisionResult?.user?.id) {
        results.push({
          email: row.email,
          roll_number: row.roll_number,
          status: 'skipped',
          reasons: ['Failed to provision auth account']
        });
        continue;
      }

      if (!authProvisionResult.created) {
        await updateAuthUser(authProvisionResult.user.id, {
          password: derivedPassword,
          role: 'student',
          fullName: row.full_name,
          isActive: true
        });
      }

      const { data: newUser, error: userError } = await insertUserWithOptionalAuthLink(
        {
          email: row.email,
          password_hash: LEGACY_PASSWORD_PLACEHOLDER,
          auth_user_id: authProvisionResult.user.id,
          full_name: row.full_name,
          phone: row.phone || null,
          role: 'student',
          created_by: req.user.id
        },
        'id, email, full_name'
      );

      if (userError) {
        if (authProvisionResult.created) {
          try {
            await deleteAuthUser(authProvisionResult.user.id);
          } catch {
            // Best effort rollback for provisioned auth account.
          }
        }

        results.push({
          email: row.email,
          roll_number: row.roll_number,
          status: 'skipped',
          reasons: [userError.message || 'Failed to create user']
        });
        continue;
      }

      const { error: studentError } = await supabase
        .from('student_details')
        .insert({
          user_id: newUser.id,
          roll_number: row.roll_number,
          class_id: classId,
          section_id: validation.normalized.section_id,
          zone: validation.normalized.zone
        });

      if (studentError) {
        await supabase.from('users').delete().eq('id', newUser.id);

        if (authProvisionResult.created) {
          try {
            await deleteAuthUser(authProvisionResult.user.id);
          } catch {
            // Best effort rollback for provisioned auth account.
          }
        }

        results.push({
          email: row.email,
          roll_number: row.roll_number,
          status: 'skipped',
          reasons: [studentError.message || 'Failed to create student details']
        });
        continue;
      }

      seenEmails.add(row.email);
      seenRolls.add(row.roll_number);

      await logAction(req, 'CREATE', 'user', newUser.id, {
        role: 'student',
        class_id: classId,
        section_id: validation.normalized.section_id,
        zone: validation.normalized.zone,
        email: row.email
      });

      results.push({
        email: row.email,
        roll_number: row.roll_number,
        status: 'created'
      });

      created.push({
        id: newUser.id,
        email: newUser.email,
        full_name: newUser.full_name,
        generatedPassword: derivedPassword
      });
    }

    res.json({
      message: 'Bulk import completed',
      summary: {
        total: results.length,
        created: results.filter((item) => item.status === 'created').length,
        skipped: results.filter((item) => item.status === 'skipped').length
      },
      results,
      created
    });
  } catch (error) {
    console.error('Teacher bulk import error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Update student in an assigned class (Teacher only)
router.put('/teacher/classes/:classId/students/:studentId', verifyToken, hasRole('teacher'), async (req, res) => {
  try {
    const { classId, studentId } = req.params;
    const { email, full_name, phone, roll_number, section_id, zone, is_active } = req.body;

    const normalizedSectionId = section_id !== undefined ? section_id || null : undefined;
    const normalizedZone = zone !== undefined ? zone || null : undefined;

    const { data: teacherAssignments, error: assignmentError } = await supabase
      .from('teacher_assignments')
      .select('id, section_id, zone')
      .eq('teacher_id', req.user.id)
      .eq('class_id', classId);

    if (assignmentError) throw assignmentError;

    if (!teacherAssignments || teacherAssignments.length === 0) {
      return res.status(403).json({ error: 'You are not assigned to this class' });
    }

    const { data: studentUser, error: studentUserError } = await supabase
      .from('users')
      .select('*')
      .eq('id', studentId)
      .maybeSingle();

    if (studentUserError) throw studentUserError;

    if (!studentUser || studentUser.role !== 'student') {
      return res.status(404).json({ error: 'Student not found' });
    }

    const { data: studentDetails, error: studentDetailsError } = await supabase
      .from('student_details')
      .select('user_id, class_id, section_id, zone, roll_number')
      .eq('user_id', studentId)
      .maybeSingle();

    if (studentDetailsError) throw studentDetailsError;

    if (!studentDetails || studentDetails.class_id !== classId) {
      return res.status(404).json({ error: 'Student does not belong to this class' });
    }

    const currentSectionAllowed = hasSectionAccess(teacherAssignments, studentDetails.section_id);
    const currentZoneAllowed = hasZoneAccess(teacherAssignments, studentDetails.zone);

    if (!currentSectionAllowed || !currentZoneAllowed) {
      return res.status(403).json({ error: 'You do not have access to modify this student' });
    }

    const effectiveSectionId = normalizedSectionId !== undefined ? normalizedSectionId : studentDetails.section_id;
    const effectiveZone = normalizedZone !== undefined ? normalizedZone : studentDetails.zone;

    if (normalizedSectionId !== undefined && normalizedSectionId) {
      const { data: sectionData, error: sectionError } = await supabase
        .from('sections')
        .select('id')
        .eq('id', normalizedSectionId)
        .eq('class_id', classId)
        .maybeSingle();

      if (sectionError) throw sectionError;

      if (!sectionData) {
        return res.status(400).json({ error: 'Selected section does not belong to the selected class' });
      }
    }

    const targetSectionAllowed = hasSectionAccess(teacherAssignments, effectiveSectionId);
    const targetZoneAllowed = hasZoneAccess(teacherAssignments, effectiveZone);

    if (!targetSectionAllowed) {
      return res.status(403).json({ error: 'You are not assigned to the selected section' });
    }

    if (!targetZoneAllowed) {
      return res.status(403).json({ error: 'You are not assigned to the selected zone' });
    }

    const userUpdateData = {};

    if (email !== undefined) {
      const normalizedEmail = String(email).trim().toLowerCase();
      if (!normalizedEmail || !getPasswordFromEmailPrefix(normalizedEmail)) {
        return res.status(400).json({ error: 'A valid email is required' });
      }
      userUpdateData.email = normalizedEmail;
    }

    if (full_name !== undefined) {
      const normalizedFullName = String(full_name).trim();
      if (!normalizedFullName) {
        return res.status(400).json({ error: 'Full name is required' });
      }
      userUpdateData.full_name = normalizedFullName;
    }

    if (phone !== undefined) userUpdateData.phone = phone || null;
    if (is_active !== undefined) userUpdateData.is_active = is_active;

    const effectiveEmail = userUpdateData.email || studentUser.email;
    const effectiveFullName = userUpdateData.full_name || studentUser.full_name;
    const effectiveIsActive = is_active !== undefined ? is_active : studentUser.is_active;

    try {
      let authUserId = await resolveAuthUserId({
        authUserId: studentUser.auth_user_id,
        email: studentUser.email,
        appUserId: studentUser.id
      });

      if (!authUserId) {
        const bootstrapPassword = getPasswordFromEmailPrefix(effectiveEmail) || 'Temp@12345';
        const provisionResult = await createAuthUser({
          email: effectiveEmail,
          password: bootstrapPassword,
          role: 'student',
          fullName: effectiveFullName,
          isActive: effectiveIsActive
        });

        authUserId = provisionResult?.user?.id || null;

        if (!authUserId) {
          return res.status(500).json({ error: 'Unable to provision auth account for student update.' });
        }

        await syncAuthUserIdOnAppUser(studentUser.id, authUserId);
      }

      const authUpdatePayload = {
        ...(userUpdateData.email !== undefined ? { email: userUpdateData.email } : {}),
        ...(userUpdateData.full_name !== undefined ? { fullName: userUpdateData.full_name } : {})
      };

      if (Object.keys(authUpdatePayload).length > 0) {
        await updateAuthUser(authUserId, authUpdatePayload);
      }
    } catch (authError) {
      if (isAuthAdminMissingError(authError)) {
        return res.status(500).json({ error: authError.message });
      }

      throw authError;
    }

    if (Object.keys(userUpdateData).length > 0) {
      const { error: updateUserError } = await supabase
        .from('users')
        .update(userUpdateData)
        .eq('id', studentId);

      if (updateUserError) throw updateUserError;
    }

    const studentUpdateData = {};

    if (roll_number !== undefined) {
      const normalizedRollNumber = String(roll_number).trim();
      if (!normalizedRollNumber) {
        return res.status(400).json({ error: 'Roll number is required' });
      }
      studentUpdateData.roll_number = normalizedRollNumber;
    }

    if (normalizedSectionId !== undefined) studentUpdateData.section_id = normalizedSectionId;
    if (normalizedZone !== undefined) studentUpdateData.zone = normalizedZone;

    if (Object.keys(studentUpdateData).length > 0) {
      const { error: updateStudentError } = await supabase
        .from('student_details')
        .update(studentUpdateData)
        .eq('user_id', studentId);

      if (updateStudentError) throw updateStudentError;
    }

    await logAction(req, 'UPDATE', 'user', studentId, {
      class_id: classId,
      user: userUpdateData,
      student_details: studentUpdateData
    });

    res.json({ message: 'Student updated successfully' });
  } catch (error) {
    console.error('Teacher update student error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Duplicate entry. Email or roll number already exists.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete student from an assigned class (Teacher only)
router.delete('/teacher/classes/:classId/students/:studentId', verifyToken, hasRole('teacher'), async (req, res) => {
  try {
    const { classId, studentId } = req.params;

    const { data: teacherAssignments, error: assignmentError } = await supabase
      .from('teacher_assignments')
      .select('id, section_id, zone')
      .eq('teacher_id', req.user.id)
      .eq('class_id', classId);

    if (assignmentError) throw assignmentError;

    if (!teacherAssignments || teacherAssignments.length === 0) {
      return res.status(403).json({ error: 'You are not assigned to this class' });
    }

    const { data: studentUser, error: studentUserError } = await supabase
      .from('users')
      .select('*')
      .eq('id', studentId)
      .maybeSingle();

    if (studentUserError) throw studentUserError;

    if (!studentUser || studentUser.role !== 'student') {
      return res.status(404).json({ error: 'Student not found' });
    }

    const { data: studentDetails, error: studentDetailsError } = await supabase
      .from('student_details')
      .select('user_id, class_id, section_id, zone')
      .eq('user_id', studentId)
      .maybeSingle();

    if (studentDetailsError) throw studentDetailsError;

    if (!studentDetails || studentDetails.class_id !== classId) {
      return res.status(404).json({ error: 'Student does not belong to this class' });
    }

    const sectionAllowed = hasSectionAccess(teacherAssignments, studentDetails.section_id);
    const zoneAllowed = hasZoneAccess(teacherAssignments, studentDetails.zone);

    if (!sectionAllowed || !zoneAllowed) {
      return res.status(403).json({ error: 'You do not have access to remove this student' });
    }

    const { error: auditLogsError } = await supabase
      .from('audit_logs')
      .update({ user_id: null })
      .eq('user_id', studentId);

    if (auditLogsError) throw auditLogsError;

    const { error: createdByError } = await supabase
      .from('users')
      .update({ created_by: null })
      .eq('created_by', studentId);

    if (createdByError) throw createdByError;

    try {
      const authUserId = await resolveAuthUserId({
        authUserId: studentUser.auth_user_id,
        email: studentUser.email,
        appUserId: studentUser.id
      });

      if (authUserId) {
        await deleteAuthUser(authUserId);
      }
    } catch (authError) {
      if (isAuthAdminMissingError(authError)) {
        return res.status(500).json({ error: authError.message });
      }

      throw authError;
    }

    const { error: deleteUserError } = await supabase
      .from('users')
      .delete()
      .eq('id', studentId);

    if (deleteUserError) throw deleteUserError;

    await logAction(req, 'DELETE', 'user', studentId, {
      class_id: classId,
      email: studentUser.email
    });

    res.json({ message: 'Student removed successfully' });
  } catch (error) {
    console.error('Teacher delete student error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single class with sections (Admin only)
router.get('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: classData, error } = await supabase
      .from('classes')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Get sections
    const { data: sections } = await supabase
      .from('sections')
      .select('*')
      .eq('class_id', id)
      .order('name');

    // Get assigned teachers
    const { data: assignments } = await supabase
      .from('teacher_assignments')
      .select(`
        id, zone, created_at,
        teacher:teacher_id(id, full_name, email),
        section:section_id(id, name)
      `)
      .eq('class_id', id);

    res.json({
      ...classData,
      sections: sections || [],
      teacher_assignments: assignments || []
    });
  } catch (error) {
    console.error('Get class error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create class (Admin only)
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const { name, description, academic_year } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Class name is required' });
    }

    const { data: newClass, error } = await supabase
      .from('classes')
      .insert({
        name,
        description: description || null,
        academic_year: academic_year || null
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Class name already exists' });
      }
      throw error;
    }

    await logAction(req, 'CREATE', 'class', newClass.id, { name });

    res.status(201).json({
      message: 'Class created successfully',
      class: newClass
    });
  } catch (error) {
    console.error('Create class error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update class (Admin only)
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, academic_year, is_active } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description || null;
    if (academic_year !== undefined) updateData.academic_year = academic_year || null;
    if (is_active !== undefined) updateData.is_active = is_active;
    updateData.updated_at = new Date().toISOString();

    const { data: updatedClass, error } = await supabase
      .from('classes')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Class name already exists' });
      }
      throw error;
    }

    if (!updatedClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    await logAction(req, 'UPDATE', 'class', id, updateData);

    res.json({
      message: 'Class updated successfully',
      class: updatedClass
    });
  } catch (error) {
    console.error('Update class error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete class (Admin only)
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: classData, error: classFetchError } = await supabase
      .from('classes')
      .select('id, name')
      .eq('id', id)
      .maybeSingle();

    if (classFetchError) throw classFetchError;

    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const { count: studentCount, error: studentCountError } = await supabase
      .from('student_details')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', id);

    if (studentCountError) throw studentCountError;

    const unassignedStudentCount = Number(studentCount) || 0;

    if (unassignedStudentCount > 0) {
      const { error: unassignError } = await supabase
        .from('student_details')
        .update({
          class_id: null,
          section_id: null,
          zone: null
        })
        .eq('class_id', id);

      if (unassignError) throw unassignError;
    }

    const { error } = await supabase
      .from('classes')
      .delete()
      .eq('id', id);

    if (error) throw error;

    await logAction(req, 'DELETE', 'class', id, {
      class_name: classData.name,
      unassigned_students: unassignedStudentCount
    });

    res.json({
      message: unassignedStudentCount > 0
        ? `Class deleted successfully. ${unassignedStudentCount} student(s) moved to unassigned.`
        : 'Class deleted successfully',
      unassigned_students: unassignedStudentCount
    });
  } catch (error) {
    console.error('Delete class error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== SECTIONS ====================

// Get sections for a class
router.get('/:classId/sections', verifyToken, async (req, res) => {
  try {
    const { classId } = req.params;

    const { data: sections, error } = await supabase
      .from('sections')
      .select('*')
      .eq('class_id', classId)
      .order('name');

    if (error) throw error;

    // Get student counts for each section
    const sectionsWithCounts = await Promise.all(sections.map(async (section) => {
      const { count } = await supabase
        .from('student_details')
        .select('*', { count: 'exact', head: true })
        .eq('section_id', section.id);

      return {
        ...section,
        student_count: count || 0
      };
    }));

    res.json(sectionsWithCounts);
  } catch (error) {
    console.error('Get sections error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create section (Admin only)
router.post('/:classId/sections', verifyToken, isAdmin, async (req, res) => {
  try {
    const { classId } = req.params;
    const { name, capacity } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Section name is required' });
    }

    // Verify class exists
    const { data: classData } = await supabase
      .from('classes')
      .select('id')
      .eq('id', classId)
      .single();

    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const { data: newSection, error } = await supabase
      .from('sections')
      .insert({
        class_id: classId,
        name,
        capacity: capacity || null
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Section name already exists in this class' });
      }
      throw error;
    }

    await logAction(req, 'CREATE', 'section', newSection.id, { class_id: classId, name });

    res.status(201).json({
      message: 'Section created successfully',
      section: newSection
    });
  } catch (error) {
    console.error('Create section error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update section (Admin only)
router.put('/:classId/sections/:sectionId', verifyToken, isAdmin, async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { name, capacity } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (capacity !== undefined) updateData.capacity = capacity || null;
    updateData.updated_at = new Date().toISOString();

    const { data: updatedSection, error } = await supabase
      .from('sections')
      .update(updateData)
      .eq('id', sectionId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Section name already exists in this class' });
      }
      throw error;
    }

    if (!updatedSection) {
      return res.status(404).json({ error: 'Section not found' });
    }

    await logAction(req, 'UPDATE', 'section', sectionId, updateData);

    res.json({
      message: 'Section updated successfully',
      section: updatedSection
    });
  } catch (error) {
    console.error('Update section error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete section (Admin only)
router.delete('/:classId/sections/:sectionId', verifyToken, isAdmin, async (req, res) => {
  try {
    const { sectionId } = req.params;

    // Check if section has students
    const { count: studentCount } = await supabase
      .from('student_details')
      .select('*', { count: 'exact', head: true })
      .eq('section_id', sectionId);

    if (studentCount > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete section with enrolled students. Remove students first.' 
      });
    }

    const { error } = await supabase
      .from('sections')
      .delete()
      .eq('id', sectionId);

    if (error) throw error;

    await logAction(req, 'DELETE', 'section', sectionId);

    res.json({ message: 'Section deleted successfully' });
  } catch (error) {
    console.error('Delete section error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== TEACHER ASSIGNMENTS ====================

// Get all teachers for assignment dropdown
router.get('/teachers/list', verifyToken, isAdmin, async (req, res) => {
  try {
    const { data: teachers, error } = await supabase
      .from('users')
      .select(`
        id, full_name, email,
        teacher_details(employee_id, department)
      `)
      .eq('role', 'teacher')
      .eq('is_active', true)
      .order('full_name');

    if (error) throw error;

    res.json(teachers);
  } catch (error) {
    console.error('Get teachers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Assign teacher to class (Admin only)
router.post('/:classId/assign-teacher', verifyToken, isAdmin, async (req, res) => {
  try {
    const { classId } = req.params;
    const { teacher_id, section_id, zone } = req.body;

    if (!teacher_id) {
      return res.status(400).json({ error: 'Teacher ID is required' });
    }

    // Verify teacher exists and is actually a teacher
    const { data: teacher } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', teacher_id)
      .eq('role', 'teacher')
      .single();

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Verify class exists
    const { data: classData } = await supabase
      .from('classes')
      .select('id')
      .eq('id', classId)
      .single();

    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const { data: assignment, error } = await supabase
      .from('teacher_assignments')
      .insert({
        teacher_id,
        class_id: classId,
        section_id: section_id || null,
        zone: zone || null
      })
      .select(`
        id, zone, created_at,
        teacher:teacher_id(id, full_name, email),
        section:section_id(id, name)
      `)
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'This teacher is already assigned to this class/section/zone combination' });
      }
      throw error;
    }

    await logAction(req, 'CREATE', 'teacher_assignment', assignment.id, { 
      teacher_id, class_id: classId, section_id, zone 
    });

    res.status(201).json({
      message: 'Teacher assigned successfully',
      assignment
    });
  } catch (error) {
    console.error('Assign teacher error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk assign teachers to class from CSV (Admin only)
router.post('/:classId/assign-teacher/bulk-upload', verifyToken, isAdmin, bulkUpload.single('file'), async (req, res) => {
  try {
    const { classId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }

    const { data: classData } = await supabase
      .from('classes')
      .select('id, name')
      .eq('id', classId)
      .single();

    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const rows = parseBulkAssignmentRows(req.file.buffer);

    if (!rows.length) {
      return res.status(400).json({ error: 'CSV file is empty' });
    }

    const { data: sections, error: sectionError } = await supabase
      .from('sections')
      .select('id, name')
      .eq('class_id', classId);

    if (sectionError) throw sectionError;

    const sectionsById = new Map();
    const sectionsByName = new Map();

    (sections || []).forEach((section) => {
      sectionsById.set(section.id, section);
      sectionsByName.set(String(section.name || '').trim().toLowerCase(), section);
    });

    const teacherIds = [...new Set(rows.map((row) => row.teacher_id).filter(Boolean))];
    const teacherEmails = [...new Set(rows.map((row) => row.teacher_email).filter(Boolean))];

    let teachersById = new Map();
    let teachersByEmail = new Map();

    if (teacherIds.length > 0) {
      const { data: teachersByIds, error: teacherIdError } = await supabase
        .from('users')
        .select('id, full_name, email')
        .eq('role', 'teacher')
        .eq('is_active', true)
        .in('id', teacherIds);

      if (teacherIdError) throw teacherIdError;

      teachersById = new Map((teachersByIds || []).map((teacher) => [teacher.id, teacher]));
      (teachersByIds || []).forEach((teacher) => {
        teachersByEmail.set(String(teacher.email || '').trim().toLowerCase(), teacher);
      });
    }

    if (teacherEmails.length > 0) {
      const { data: teachersByEmails, error: teacherEmailError } = await supabase
        .from('users')
        .select('id, full_name, email')
        .eq('role', 'teacher')
        .eq('is_active', true)
        .in('email', teacherEmails);

      if (teacherEmailError) throw teacherEmailError;

      (teachersByEmails || []).forEach((teacher) => {
        teachersById.set(teacher.id, teacher);
        teachersByEmail.set(String(teacher.email || '').trim().toLowerCase(), teacher);
      });
    }

    const { data: existingAssignments, error: existingError } = await supabase
      .from('teacher_assignments')
      .select('teacher_id, section_id, zone')
      .eq('class_id', classId);

    if (existingError) throw existingError;

    const normalizeAssignmentKey = (teacherId, sectionId, zone) => {
      return `${teacherId}::${sectionId || '__all_sections__'}::${zone || '__all_zones__'}`;
    };

    const existingAssignmentKeys = new Set(
      (existingAssignments || []).map((assignment) => normalizeAssignmentKey(
        assignment.teacher_id,
        assignment.section_id,
        assignment.zone
      ))
    );

    const pendingAssignmentKeys = new Set();
    const insertRows = [];
    const skippedRows = [];

    rows.forEach((row) => {
      const issues = [];

      if (!row.teacher_id && !row.teacher_email) {
        issues.push('Either teacher_id or teacher_email is required');
      }

      let teacher = null;
      if (row.teacher_id) {
        teacher = teachersById.get(row.teacher_id) || null;
      }

      if (row.teacher_email) {
        const byEmail = teachersByEmail.get(row.teacher_email) || null;

        if (!teacher) {
          teacher = byEmail;
        } else if (byEmail && byEmail.id !== teacher.id) {
          issues.push('teacher_id and teacher_email refer to different teachers');
        }
      }

      if (!teacher) {
        issues.push('Teacher not found or inactive');
      }

      let resolvedSectionId = null;

      if (row.section_id) {
        const section = sectionsById.get(row.section_id);
        if (!section) {
          issues.push('section_id not found in selected class');
        } else {
          resolvedSectionId = section.id;
        }
      } else if (row.section_name) {
        const section = sectionsByName.get(String(row.section_name).trim().toLowerCase());
        if (!section) {
          issues.push('section_name not found in selected class');
        } else {
          resolvedSectionId = section.id;
        }
      }

      const normalizedZone = row.zone ? normalizeZone(row.zone) : null;
      if (row.zone && !normalizedZone) {
        issues.push('zone must be blue, red, or green');
      }

      if (!issues.length && teacher) {
        const assignmentKey = normalizeAssignmentKey(teacher.id, resolvedSectionId, normalizedZone);

        if (existingAssignmentKeys.has(assignmentKey)) {
          issues.push('Assignment already exists');
        } else if (pendingAssignmentKeys.has(assignmentKey)) {
          issues.push('Duplicate assignment in CSV');
        } else {
          pendingAssignmentKeys.add(assignmentKey);
          insertRows.push({
            teacher_id: teacher.id,
            class_id: classId,
            section_id: resolvedSectionId,
            zone: normalizedZone
          });
        }
      }

      if (issues.length) {
        skippedRows.push({
          rowNumber: row.rowNumber,
          issues,
          teacher_id: row.teacher_id || null,
          teacher_email: row.teacher_email || null,
          section_id: row.section_id || null,
          section_name: row.section_name || null,
          zone: row.zone || null
        });
      }
    });

    let createdCount = 0;

    if (insertRows.length > 0) {
      const { data: createdAssignments, error: insertError } = await supabase
        .from('teacher_assignments')
        .insert(insertRows)
        .select('id');

      if (insertError) throw insertError;
      createdCount = createdAssignments?.length || 0;
    }

    await logAction(req, 'BULK_CREATE', 'teacher_assignment', null, {
      class_id: classId,
      class_name: classData.name,
      total_rows: rows.length,
      created_count: createdCount,
      skipped_count: skippedRows.length
    });

    res.status(201).json({
      message: 'Bulk assignment processing completed',
      summary: {
        total_rows: rows.length,
        created_count: createdCount,
        skipped_count: skippedRows.length
      },
      skipped_rows: skippedRows
    });
  } catch (error) {
    console.error('Bulk assign teachers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove teacher assignment (Admin only)
router.delete('/assignments/:assignmentId', verifyToken, isAdmin, async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const { error } = await supabase
      .from('teacher_assignments')
      .delete()
      .eq('id', assignmentId);

    if (error) throw error;

    await logAction(req, 'DELETE', 'teacher_assignment', assignmentId);

    res.json({ message: 'Teacher assignment removed successfully' });
  } catch (error) {
    console.error('Remove assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
