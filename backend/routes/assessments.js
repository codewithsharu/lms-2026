const express = require('express');
const supabase = require('../config/supabase');
const { verifyToken, hasRole, isAdmin } = require('../middleware/auth');

const router = express.Router();
const getApiErrorMessage = (error, fallback) => (
  process.env.NODE_ENV === 'production'
    ? fallback
    : (error?.message || fallback)
);
const isMissingAssessmentTableError = (error) => (
  error?.code === 'PGRST205' &&
  String(error?.message || '').includes('assessment_templates')
);
const isMissingHostedTableError = (error) => (
  error?.code === 'PGRST205' &&
  String(error?.message || '').includes('hosted_assessments')
);

const safeInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

// Teacher: create template
router.post('/templates', verifyToken, hasRole('teacher'), async (req, res) => {
  try {
    const {
      title,
      subject,
      description,
      question_count = 0,
      total_marks = 100,
      passing_percentage = 40,
      template_data = {}
    } = req.body;

    if (!title || !subject) {
      return res.status(400).json({ error: 'Title and subject are required' });
    }

    const payload = {
      teacher_id: req.user.id,
      title: String(title).trim(),
      subject: String(subject).trim(),
      description: description ? String(description).trim() : null,
      question_count: safeInt(question_count, 0),
      total_marks: safeInt(total_marks, 100),
      passing_percentage: safeInt(passing_percentage, 40),
      template_data,
      is_active: true
    };

    const { data, error } = await supabase
      .from('assessment_templates')
      .insert(payload)
      .select('*')
      .single();

    if (error && isMissingAssessmentTableError(error)) {
      return res.status(503).json({
        error: 'Assessment module is not initialized yet. Please run migration when DB access is available.',
        setupRequired: true
      });
    }

    if (error) throw error;

    res.status(201).json({ message: 'Template created successfully', template: data });
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to create template') });
  }
});

// Teacher: list templates
router.get('/templates', verifyToken, hasRole('teacher'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('assessment_templates')
      .select('*')
      .eq('teacher_id', req.user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error && isMissingAssessmentTableError(error)) {
      return res.json({ templates: [], setupRequired: true });
    }

    if (error) throw error;

    res.json({ templates: data || [] });
  } catch (error) {
    console.error('List templates error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to fetch templates') });
  }
});

// Teacher: update template
router.put('/templates/:id', verifyToken, hasRole('teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      subject,
      description,
      question_count,
      total_marks,
      passing_percentage,
      template_data
    } = req.body;

    const updateData = {
      ...(title !== undefined ? { title: String(title).trim() } : {}),
      ...(subject !== undefined ? { subject: String(subject).trim() } : {}),
      ...(description !== undefined ? { description: description ? String(description).trim() : null } : {}),
      ...(question_count !== undefined ? { question_count: safeInt(question_count, 0) } : {}),
      ...(total_marks !== undefined ? { total_marks: safeInt(total_marks, 100) } : {}),
      ...(passing_percentage !== undefined ? { passing_percentage: safeInt(passing_percentage, 40) } : {}),
      ...(template_data !== undefined ? { template_data } : {})
    };

    const { data, error } = await supabase
      .from('assessment_templates')
      .update(updateData)
      .eq('id', id)
      .eq('teacher_id', req.user.id)
      .select('*')
      .single();

    if (error && isMissingAssessmentTableError(error)) {
      return res.status(503).json({
        error: 'Assessment module is not initialized yet. Please run migration when DB access is available.',
        setupRequired: true
      });
    }

    if (error) throw error;

    res.json({ message: 'Template updated successfully', template: data });
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to update template') });
  }
});

// Teacher: host exam from existing template
router.post('/hosted', verifyToken, hasRole('teacher'), async (req, res) => {
  try {
    const {
      template_id,
      class_id,
      section_id,
      zone,
      duration_minutes,
      max_attempts,
      result_mode,
      publish_status,
      start_time,
      end_time,
      instructions
    } = req.body;

    if (!template_id || !duration_minutes || !max_attempts || !result_mode || !publish_status) {
      return res.status(400).json({ error: 'template_id, duration, attempts, result mode and publish status are required' });
    }

    const parsedDuration = safeInt(duration_minutes, 0);
    const parsedAttempts = safeInt(max_attempts, 0);

    if (parsedDuration <= 0) {
      return res.status(400).json({ error: 'Duration must be greater than 0 minutes' });
    }

    if (parsedAttempts <= 0) {
      return res.status(400).json({ error: 'Max attempts must be at least 1' });
    }

    const allowedResultModes = ['after_end', 'immediate', 'manual'];
    if (!allowedResultModes.includes(result_mode)) {
      return res.status(400).json({ error: 'Invalid result mode' });
    }

    const allowedPublishStatuses = ['draft', 'published', 'closed'];
    if (!allowedPublishStatuses.includes(publish_status)) {
      return res.status(400).json({ error: 'Invalid publish status' });
    }

    const parsedStartTime = start_time ? new Date(start_time) : null;
    const parsedEndTime = end_time ? new Date(end_time) : null;

    if (parsedStartTime && Number.isNaN(parsedStartTime.getTime())) {
      return res.status(400).json({ error: 'Invalid start time' });
    }

    if (parsedEndTime && Number.isNaN(parsedEndTime.getTime())) {
      return res.status(400).json({ error: 'Invalid end time' });
    }

    if (parsedStartTime && parsedEndTime && parsedEndTime <= parsedStartTime) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    if (publish_status === 'published' && (!parsedStartTime || !parsedEndTime)) {
      return res.status(400).json({ error: 'Start and end time are required to publish an exam' });
    }

    const { data: template, error: templateError } = await supabase
      .from('assessment_templates')
      .select('id, teacher_id')
      .eq('id', template_id)
      .eq('teacher_id', req.user.id)
      .single();

    if (templateError && isMissingAssessmentTableError(templateError)) {
      return res.status(503).json({
        error: 'Assessment module is not initialized yet. Please run migration when DB access is available.',
        setupRequired: true
      });
    }

    if (templateError || !template) {
      return res.status(404).json({ error: 'Template not found for this teacher' });
    }

    const payload = {
      template_id,
      host_id: req.user.id,
      class_id: class_id || null,
      section_id: section_id || null,
      zone: zone || null,
      duration_minutes: parsedDuration,
      max_attempts: parsedAttempts,
      result_mode,
      publish_status,
      start_time: parsedStartTime ? parsedStartTime.toISOString() : null,
      end_time: parsedEndTime ? parsedEndTime.toISOString() : null,
      instructions: instructions ? String(instructions).trim() : null
    };

    const { data, error } = await supabase
      .from('hosted_assessments')
      .insert(payload)
      .select('*')
      .single();

    if (error && isMissingHostedTableError(error)) {
      return res.status(503).json({
        error: 'Assessment module is not initialized yet. Please run migration when DB access is available.',
        setupRequired: true
      });
    }

    if (error) throw error;

    res.status(201).json({ message: 'Exam hosted successfully', hostedExam: data });
  } catch (error) {
    console.error('Host exam error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to host exam') });
  }
});

// Teacher: list hosted exams
router.get('/hosted', verifyToken, hasRole('teacher'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('hosted_assessments')
      .select(`
        *,
        template:template_id(id, title, subject, question_count, total_marks),
        class:class_id(id, name),
        section:section_id(id, name)
      `)
      .eq('host_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error && isMissingHostedTableError(error)) {
      return res.json({ hostedExams: [], setupRequired: true });
    }

    if (error) throw error;

    res.json({ hostedExams: data || [] });
  } catch (error) {
    console.error('List hosted exams error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to fetch hosted exams') });
  }
});

// Teacher metrics
router.get('/metrics/teacher', verifyToken, hasRole('teacher'), async (req, res) => {
  try {
    const { count: templateCount, error: templateError } = await supabase
      .from('assessment_templates')
      .select('*', { count: 'exact', head: true })
      .eq('teacher_id', req.user.id)
      .eq('is_active', true);

    if (templateError && isMissingAssessmentTableError(templateError)) {
      return res.json({ templates: 0, hosted: 0, published: 0, setupRequired: true });
    }

    if (templateError) throw templateError;

    const { count: hostedCount, error: hostedError } = await supabase
      .from('hosted_assessments')
      .select('*', { count: 'exact', head: true })
      .eq('host_id', req.user.id);

    if (hostedError && isMissingHostedTableError(hostedError)) {
      return res.json({ templates: templateCount || 0, hosted: 0, published: 0, setupRequired: true });
    }

    if (hostedError) throw hostedError;

    const { count: publishedCount, error: publishError } = await supabase
      .from('hosted_assessments')
      .select('*', { count: 'exact', head: true })
      .eq('host_id', req.user.id)
      .eq('publish_status', 'published');

    if (publishError) throw publishError;

    res.json({
      templates: templateCount || 0,
      hosted: hostedCount || 0,
      published: publishedCount || 0
    });
  } catch (error) {
    console.error('Teacher metrics error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to fetch teacher metrics') });
  }
});

// Admin metrics
router.get('/metrics/admin', verifyToken, isAdmin, async (req, res) => {
  try {
    const { count: templateCount, error: templateError } = await supabase
      .from('assessment_templates')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    if (templateError && isMissingAssessmentTableError(templateError)) {
      return res.json({ templates: 0, hosted: 0, published: 0, setupRequired: true });
    }

    if (templateError) throw templateError;

    const { count: hostedCount, error: hostedError } = await supabase
      .from('hosted_assessments')
      .select('*', { count: 'exact', head: true });

    if (hostedError && isMissingHostedTableError(hostedError)) {
      return res.json({ templates: templateCount || 0, hosted: 0, published: 0, setupRequired: true });
    }

    if (hostedError) throw hostedError;

    const { count: publishedCount, error: publishError } = await supabase
      .from('hosted_assessments')
      .select('*', { count: 'exact', head: true })
      .eq('publish_status', 'published');

    if (publishError) throw publishError;

    res.json({
      templates: templateCount || 0,
      hosted: hostedCount || 0,
      published: publishedCount || 0
    });
  } catch (error) {
    console.error('Admin metrics error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to fetch admin metrics') });
  }
});

// Student: available exams by assignment scope
router.get('/student/available', verifyToken, hasRole('student'), async (req, res) => {
  try {
    const { data: studentDetail, error: studentError } = await supabase
      .from('student_details')
      .select('class_id, section_id, zone')
      .eq('user_id', req.user.id)
      .single();

    if (studentError || !studentDetail) {
      return res.status(404).json({ error: 'Student details not found' });
    }

    let query = supabase
      .from('hosted_assessments')
      .select(`
        id,
        duration_minutes,
        max_attempts,
        result_mode,
        publish_status,
        start_time,
        end_time,
        class_id,
        section_id,
        zone,
        template:template_id(id, title, subject, question_count, total_marks, passing_percentage)
      `)
      .eq('publish_status', 'published')
      .eq('class_id', studentDetail.class_id)
      .order('created_at', { ascending: false });

    const { data: hostedExams, error } = await query;

    if (error && isMissingHostedTableError(error)) {
      return res.json({ exams: [], setupRequired: true });
    }

    if (error) throw error;

    const filtered = (hostedExams || []).filter((exam) => {
      const sectionMatch = !exam.section_id || exam.section_id === studentDetail.section_id;
      const zoneMatch = !exam.zone || exam.zone === studentDetail.zone;
      return sectionMatch && zoneMatch;
    });

    res.json({ exams: filtered });
  } catch (error) {
    console.error('Student available exams error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to fetch available exams') });
  }
});

// Student metrics
router.get('/metrics/student', verifyToken, hasRole('student'), async (req, res) => {
  try {
    const { data: studentDetail, error: studentError } = await supabase
      .from('student_details')
      .select('class_id, section_id, zone')
      .eq('user_id', req.user.id)
      .single();

    if (studentError || !studentDetail) {
      return res.status(404).json({ error: 'Student details not found' });
    }

    const { data: hostedExams, error } = await supabase
      .from('hosted_assessments')
      .select('id, class_id, section_id, zone, publish_status, start_time, end_time')
      .eq('publish_status', 'published')
      .eq('class_id', studentDetail.class_id);

    if (error && isMissingHostedTableError(error)) {
      return res.json({ assigned: 0, inProgress: 0, upcoming: 0, completed: 0, setupRequired: true });
    }

    if (error) throw error;

    const now = new Date();

    const exams = (hostedExams || []).filter((exam) => {
      const sectionMatch = !exam.section_id || exam.section_id === studentDetail.section_id;
      const zoneMatch = !exam.zone || exam.zone === studentDetail.zone;
      return sectionMatch && zoneMatch;
    });

    const inProgress = exams.filter((exam) => {
      if (!exam.start_time || !exam.end_time) return false;
      return new Date(exam.start_time) <= now && now <= new Date(exam.end_time);
    }).length;

    const upcoming = exams.filter((exam) => {
      if (!exam.start_time) return false;
      return now < new Date(exam.start_time);
    }).length;

    res.json({
      assigned: exams.length,
      inProgress,
      upcoming,
      completed: 0
    });
  } catch (error) {
    console.error('Student metrics error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to fetch student metrics') });
  }
});

module.exports = router;
