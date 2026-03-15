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
const isMissingAttemptTableError = (error) => (
  error?.code === 'PGRST205' &&
  String(error?.message || '').includes('assessment_attempts')
);

const safeInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const safeNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeQuestionList = (templateData) => {
  const list = templateData?.questions;
  if (!Array.isArray(list)) return [];

  return list
    .map((item) => {
      const type = item?.type === 'blank' ? 'blank' : 'mcq';
      const question = String(item?.question || '').trim();

      if (!question) return null;

      if (type === 'blank') {
        const blankAnswer = String(item?.blankAnswer ?? item?.blank_answer ?? item?.answer ?? '').trim();
        if (!blankAnswer) return null;

        return {
          type: 'blank',
          question,
          options: ['', '', '', ''],
          blankAnswer
        };
      }

      const options = Array.isArray(item?.options)
        ? item.options.map((option) => String(option || '').trim())
        : [];

      if (options.length !== 4 || options.some((option) => !option)) return null;

      const rawCorrectOptions = Array.isArray(item?.correctOptions)
        ? item.correctOptions
        : (Number.isInteger(item?.correctOption) ? [item.correctOption] : []);

      const correctOptions = [...new Set(rawCorrectOptions.filter((value) => Number.isInteger(value) && value >= 0 && value <= 3))];

      if (correctOptions.length === 0) return null;

      return {
        type: 'mcq',
        question,
        options,
        answerMode: item?.answerMode === 'multiple' || correctOptions.length > 1 ? 'multiple' : 'single',
        correctOptions
      };
    })
    .filter(Boolean);
};

const sanitizeQuestionsForStudent = (questions) => (
  questions.map((question, index) => ({
    index,
    type: question.type,
    question: question.question,
    answerMode: question.answerMode || 'single',
    options: question.type === 'mcq' ? question.options : []
  }))
);

const isWithinAttemptWindow = (exam) => {
  const now = new Date();
  const start = exam.start_time ? new Date(exam.start_time) : null;
  const end = exam.end_time ? new Date(exam.end_time) : null;

  if (start && Number.isNaN(start.getTime())) return { allowed: false, reason: 'Invalid start time configuration' };
  if (end && Number.isNaN(end.getTime())) return { allowed: false, reason: 'Invalid end time configuration' };
  if (start && now < start) return { allowed: false, reason: 'Assessment has not started yet' };
  if (end && now > end) return { allowed: false, reason: 'Assessment window has ended' };

  return { allowed: true };
};

const isExamAssignedToStudent = (exam, studentDetail) => {
  if (!exam || !studentDetail) return false;

  if (exam.class_id !== studentDetail.class_id) return false;

  const sectionMatch = !exam.section_id || exam.section_id === studentDetail.section_id;
  const zoneMatch = !exam.zone || exam.zone === studentDetail.zone;

  return sectionMatch && zoneMatch;
};

const getRemainingSeconds = (attempt, exam) => {
  const startedAt = attempt?.started_at ? new Date(attempt.started_at) : null;
  const durationMinutes = safeInt(exam?.duration_minutes, 0);

  if (!startedAt || Number.isNaN(startedAt.getTime()) || durationMinutes <= 0) return 0;

  const elapsed = Math.floor((Date.now() - startedAt.getTime()) / 1000);
  const total = durationMinutes * 60;

  return Math.max(0, total - Math.max(0, elapsed));
};

const normalizeSubmittedAnswer = (question, rawAnswer) => {
  if (question.type === 'blank') {
    return String(rawAnswer || '').trim();
  }

  if (question.answerMode === 'multiple') {
    if (!Array.isArray(rawAnswer)) return [];

    return [...new Set(
      rawAnswer
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 3)
    )].sort((a, b) => a - b);
  }

  const selected = Number(rawAnswer);
  return Number.isInteger(selected) && selected >= 0 && selected <= 3 ? selected : null;
};

const isAnswerCorrect = (question, normalizedAnswer) => {
  if (question.type === 'blank') {
    return String(normalizedAnswer || '').toLowerCase() === String(question.blankAnswer || '').trim().toLowerCase();
  }

  if (question.answerMode === 'multiple') {
    if (!Array.isArray(normalizedAnswer)) return false;
    if (normalizedAnswer.length !== question.correctOptions.length) return false;

    return normalizedAnswer.every((value, index) => value === question.correctOptions[index]);
  }

  return Number(normalizedAnswer) === Number(question.correctOptions[0]);
};

const calculateAttemptSummary = (questions, rawAnswers, configuredTotalMarks) => {
  const answers = rawAnswers && typeof rawAnswers === 'object' ? rawAnswers : {};
  const totalQuestions = questions.length;
  const totalMarks = safeNumber(configuredTotalMarks, totalQuestions > 0 ? totalQuestions : 0);
  const marksPerQuestion = totalQuestions > 0 ? (totalMarks / totalQuestions) : 0;

  let correctCount = 0;
  const normalizedAnswers = {};

  questions.forEach((question, index) => {
    const key = String(index);
    const normalized = normalizeSubmittedAnswer(question, answers[key]);
    normalizedAnswers[key] = normalized;

    if (isAnswerCorrect(question, normalized)) {
      correctCount += 1;
    }
  });

  const scoreRaw = correctCount * marksPerQuestion;
  const score = Number(scoreRaw.toFixed(2));
  const percentage = totalMarks > 0 ? Number(((score / totalMarks) * 100).toFixed(2)) : 0;

  return {
    normalizedAnswers,
    correctCount,
    totalQuestions,
    totalMarks: Number(totalMarks.toFixed(2)),
    score,
    percentage
  };
};

const getStudentDetail = async (userId) => {
  const { data, error } = await supabase
    .from('student_details')
    .select('class_id, section_id, zone')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return { detail: null, error: error || new Error('Student details not found') };
  }

  return { detail: data, error: null };
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
    const { detail: studentDetail, error: studentError } = await getStudentDetail(req.user.id);

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

    const filtered = (hostedExams || []).filter((exam) => isExamAssignedToStudent(exam, studentDetail));
    const hostedIds = filtered.map((exam) => exam.id);

    let attemptsByHosted = {};

    if (hostedIds.length > 0) {
      const { data: attempts, error: attemptsError } = await supabase
        .from('assessment_attempts')
        .select('id, hosted_assessment_id, status, attempt_number, score, percentage, submitted_at')
        .eq('student_id', req.user.id)
        .in('hosted_assessment_id', hostedIds)
        .order('created_at', { ascending: false });

      if (attemptsError && !isMissingAttemptTableError(attemptsError)) {
        throw attemptsError;
      }

      attemptsByHosted = (attempts || []).reduce((acc, item) => {
        if (!acc[item.hosted_assessment_id]) acc[item.hosted_assessment_id] = [];
        acc[item.hosted_assessment_id].push(item);
        return acc;
      }, {});
    }

    const enriched = filtered.map((exam) => {
      const attempts = attemptsByHosted[exam.id] || [];
      const inProgressAttempt = attempts.find((item) => item.status === 'in_progress') || null;
      const submittedAttempts = attempts.filter((item) => item.status === 'submitted' || item.status === 'auto_submitted');
      const attemptsUsed = attempts.length;
      const maxAttempts = safeInt(exam.max_attempts, 1);

      return {
        ...exam,
        attemptsUsed,
        remainingAttempts: Math.max(0, maxAttempts - attemptsUsed),
        hasInProgressAttempt: Boolean(inProgressAttempt),
        inProgressAttemptId: inProgressAttempt?.id || null,
        latestSubmittedAttempt: submittedAttempts[0] || null,
        canAttempt: inProgressAttempt ? true : attemptsUsed < maxAttempts
      };
    });

    res.json({ exams: enriched });
  } catch (error) {
    console.error('Student available exams error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to fetch available exams') });
  }
});

// Student: start or resume attempt
router.post('/student/hosted/:hostedAssessmentId/start', verifyToken, hasRole('student'), async (req, res) => {
  try {
    const { hostedAssessmentId } = req.params;
    const { detail: studentDetail, error: studentError } = await getStudentDetail(req.user.id);

    if (studentError || !studentDetail) {
      return res.status(404).json({ error: 'Student details not found' });
    }

    const { data: hostedExam, error: hostedError } = await supabase
      .from('hosted_assessments')
      .select(`
        id,
        class_id,
        section_id,
        zone,
        duration_minutes,
        max_attempts,
        result_mode,
        publish_status,
        start_time,
        end_time,
        instructions,
        template:template_id(id, title, subject, total_marks, passing_percentage, template_data)
      `)
      .eq('id', hostedAssessmentId)
      .single();

    if (hostedError && isMissingHostedTableError(hostedError)) {
      return res.status(503).json({ error: 'Assessment module is not initialized yet', setupRequired: true });
    }

    if (hostedError || !hostedExam) {
      return res.status(404).json({ error: 'Hosted assessment not found' });
    }

    if (hostedExam.publish_status !== 'published') {
      return res.status(400).json({ error: 'This assessment is not published' });
    }

    if (!isExamAssignedToStudent(hostedExam, studentDetail)) {
      return res.status(403).json({ error: 'This assessment is not assigned to your class scope' });
    }

    const windowState = isWithinAttemptWindow(hostedExam);
    if (!windowState.allowed) {
      return res.status(400).json({ error: windowState.reason });
    }

    const questions = normalizeQuestionList(hostedExam.template?.template_data);
    if (questions.length === 0) {
      return res.status(400).json({ error: 'Assessment questions are not configured' });
    }

    const { data: existingInProgress, error: existingError } = await supabase
      .from('assessment_attempts')
      .select('*')
      .eq('hosted_assessment_id', hostedAssessmentId)
      .eq('student_id', req.user.id)
      .eq('status', 'in_progress')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError && !isMissingAttemptTableError(existingError)) {
      throw existingError;
    }

    let activeAttempt = existingInProgress || null;

    if (!activeAttempt) {
      const { count: attemptCount, error: countError } = await supabase
        .from('assessment_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('hosted_assessment_id', hostedAssessmentId)
        .eq('student_id', req.user.id);

      if (countError && isMissingAttemptTableError(countError)) {
        return res.status(503).json({ error: 'Attempt module is not initialized yet', setupRequired: true });
      }

      if (countError) throw countError;

      const usedAttempts = safeInt(attemptCount, 0);
      const maxAttempts = safeInt(hostedExam.max_attempts, 1);

      if (usedAttempts >= maxAttempts) {
        return res.status(400).json({ error: 'Maximum attempts reached for this assessment' });
      }

      const totalQuestions = questions.length;
      const configuredTotalMarks = safeNumber(hostedExam.template?.total_marks, totalQuestions);

      const { data: createdAttempt, error: createError } = await supabase
        .from('assessment_attempts')
        .insert({
          hosted_assessment_id: hostedAssessmentId,
          student_id: req.user.id,
          attempt_number: usedAttempts + 1,
          status: 'in_progress',
          answers: {},
          total_questions: totalQuestions,
          total_marks: configuredTotalMarks
        })
        .select('*')
        .single();

      if (createError) throw createError;

      activeAttempt = createdAttempt;
    }

    const remainingSeconds = getRemainingSeconds(activeAttempt, hostedExam);

    if (remainingSeconds <= 0) {
      return res.status(400).json({ error: 'This attempt has already timed out. Please submit it from the attempt page.' });
    }

    res.json({
      hostedAssessment: {
        id: hostedExam.id,
        title: hostedExam.template?.title || 'Assessment',
        subject: hostedExam.template?.subject || 'N/A',
        instructions: hostedExam.instructions || '',
        result_mode: hostedExam.result_mode,
        start_time: hostedExam.start_time,
        end_time: hostedExam.end_time,
        duration_minutes: hostedExam.duration_minutes,
        max_attempts: hostedExam.max_attempts
      },
      attempt: {
        id: activeAttempt.id,
        attempt_number: activeAttempt.attempt_number,
        status: activeAttempt.status,
        started_at: activeAttempt.started_at,
        answers: activeAttempt.answers || {},
        remaining_seconds: remainingSeconds
      },
      questions: sanitizeQuestionsForStudent(questions)
    });
  } catch (error) {
    console.error('Start student attempt error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to start assessment attempt') });
  }
});

// Student: get attempt by id (resume support)
router.get('/student/attempts/:attemptId', verifyToken, hasRole('student'), async (req, res) => {
  try {
    const { attemptId } = req.params;

    const { data: attempt, error: attemptError } = await supabase
      .from('assessment_attempts')
      .select(`
        *,
        hosted:hosted_assessment_id(
          id,
          class_id,
          section_id,
          zone,
          duration_minutes,
          max_attempts,
          result_mode,
          publish_status,
          start_time,
          end_time,
          instructions,
          template:template_id(id, title, subject, total_marks, passing_percentage, template_data)
        )
      `)
      .eq('id', attemptId)
      .eq('student_id', req.user.id)
      .single();

    if (attemptError || !attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    const questions = normalizeQuestionList(attempt.hosted?.template?.template_data);

    if (questions.length === 0) {
      return res.status(400).json({ error: 'Assessment questions are not configured' });
    }

    const remainingSeconds = getRemainingSeconds(attempt, attempt.hosted);

    res.json({
      hostedAssessment: {
        id: attempt.hosted?.id,
        title: attempt.hosted?.template?.title || 'Assessment',
        subject: attempt.hosted?.template?.subject || 'N/A',
        instructions: attempt.hosted?.instructions || '',
        result_mode: attempt.hosted?.result_mode,
        start_time: attempt.hosted?.start_time,
        end_time: attempt.hosted?.end_time,
        duration_minutes: attempt.hosted?.duration_minutes,
        max_attempts: attempt.hosted?.max_attempts
      },
      attempt: {
        id: attempt.id,
        attempt_number: attempt.attempt_number,
        status: attempt.status,
        started_at: attempt.started_at,
        submitted_at: attempt.submitted_at,
        answers: attempt.answers || {},
        score: attempt.score,
        total_marks: attempt.total_marks,
        percentage: attempt.percentage,
        correct_count: attempt.correct_count,
        total_questions: attempt.total_questions,
        remaining_seconds: remainingSeconds
      },
      questions: sanitizeQuestionsForStudent(questions)
    });
  } catch (error) {
    console.error('Get student attempt error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to fetch attempt details') });
  }
});

// Student: submit attempt
router.post('/student/attempts/:attemptId/submit', verifyToken, hasRole('student'), async (req, res) => {
  try {
    const { attemptId } = req.params;
    const { answers = {}, forceAutoSubmit = false } = req.body || {};

    const { data: attempt, error: attemptError } = await supabase
      .from('assessment_attempts')
      .select(`
        *,
        hosted:hosted_assessment_id(
          id,
          class_id,
          section_id,
          zone,
          duration_minutes,
          max_attempts,
          result_mode,
          publish_status,
          start_time,
          end_time,
          instructions,
          template:template_id(id, title, subject, total_marks, passing_percentage, template_data)
        )
      `)
      .eq('id', attemptId)
      .eq('student_id', req.user.id)
      .single();

    if (attemptError || !attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    if (attempt.status === 'submitted' || attempt.status === 'auto_submitted') {
      return res.json({
        message: 'Attempt already submitted',
        attempt: {
          id: attempt.id,
          status: attempt.status,
          score: attempt.score,
          total_marks: attempt.total_marks,
          percentage: attempt.percentage,
          correct_count: attempt.correct_count,
          total_questions: attempt.total_questions,
          submitted_at: attempt.submitted_at
        }
      });
    }

    const questions = normalizeQuestionList(attempt.hosted?.template?.template_data);
    if (questions.length === 0) {
      return res.status(400).json({ error: 'Assessment questions are not configured' });
    }

    const remainingSeconds = getRemainingSeconds(attempt, attempt.hosted);
    const submittedStatus = (forceAutoSubmit || remainingSeconds <= 0) ? 'auto_submitted' : 'submitted';
    const mergedAnswers = {
      ...(attempt.answers && typeof attempt.answers === 'object' ? attempt.answers : {}),
      ...(answers && typeof answers === 'object' ? answers : {})
    };

    const scoreSummary = calculateAttemptSummary(
      questions,
      mergedAnswers,
      attempt.hosted?.template?.total_marks
    );

    const { data: updatedAttempt, error: updateError } = await supabase
      .from('assessment_attempts')
      .update({
        status: submittedStatus,
        answers: scoreSummary.normalizedAnswers,
        score: scoreSummary.score,
        total_marks: scoreSummary.totalMarks,
        percentage: scoreSummary.percentage,
        correct_count: scoreSummary.correctCount,
        total_questions: scoreSummary.totalQuestions,
        submitted_at: new Date().toISOString()
      })
      .eq('id', attempt.id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    const resultVisible = (
      attempt.hosted?.result_mode === 'immediate' ||
      (attempt.hosted?.result_mode === 'after_end' && attempt.hosted?.end_time && new Date() > new Date(attempt.hosted.end_time))
    );

    res.json({
      message: 'Attempt submitted successfully',
      resultVisible,
      resultMode: attempt.hosted?.result_mode,
      attempt: {
        id: updatedAttempt.id,
        status: updatedAttempt.status,
        score: updatedAttempt.score,
        total_marks: updatedAttempt.total_marks,
        percentage: updatedAttempt.percentage,
        correct_count: updatedAttempt.correct_count,
        total_questions: updatedAttempt.total_questions,
        submitted_at: updatedAttempt.submitted_at,
        attempt_number: updatedAttempt.attempt_number
      }
    });
  } catch (error) {
    console.error('Submit student attempt error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to submit attempt') });
  }
});

// Student: results from attempts
router.get('/student/results', verifyToken, hasRole('student'), async (req, res) => {
  try {
    const { detail: studentDetail, error: studentError } = await getStudentDetail(req.user.id);

    if (studentError || !studentDetail) {
      return res.status(404).json({ error: 'Student details not found' });
    }

    const { data: hostedExams, error: hostedError } = await supabase
      .from('hosted_assessments')
      .select(`
        id,
        class_id,
        section_id,
        zone,
        publish_status,
        result_mode,
        start_time,
        end_time,
        template:template_id(id, title, subject, question_count, total_marks, passing_percentage)
      `)
      .eq('publish_status', 'published')
      .eq('class_id', studentDetail.class_id)
      .order('created_at', { ascending: false });

    if (hostedError && isMissingHostedTableError(hostedError)) {
      return res.json({ results: [], setupRequired: true });
    }

    if (hostedError) throw hostedError;

    const scopedExams = (hostedExams || []).filter((exam) => isExamAssignedToStudent(exam, studentDetail));
    const hostedIds = scopedExams.map((exam) => exam.id);

    let attempts = [];

    if (hostedIds.length > 0) {
      const { data: attemptData, error: attemptError } = await supabase
        .from('assessment_attempts')
        .select('id, hosted_assessment_id, attempt_number, status, score, total_marks, percentage, correct_count, total_questions, submitted_at, created_at')
        .eq('student_id', req.user.id)
        .in('hosted_assessment_id', hostedIds)
        .order('created_at', { ascending: false });

      if (attemptError && !isMissingAttemptTableError(attemptError)) {
        throw attemptError;
      }

      attempts = attemptData || [];
    }

    const attemptsByExam = attempts.reduce((acc, item) => {
      if (!acc[item.hosted_assessment_id]) acc[item.hosted_assessment_id] = [];
      acc[item.hosted_assessment_id].push(item);
      return acc;
    }, {});

    const now = new Date();

    const results = scopedExams.map((exam) => {
      const examAttempts = attemptsByExam[exam.id] || [];
      const submittedAttempts = examAttempts.filter((attempt) => attempt.status === 'submitted' || attempt.status === 'auto_submitted');
      const latestAttempt = submittedAttempts[0] || null;
      const bestAttempt = submittedAttempts.reduce((best, current) => {
        if (!best) return current;
        return safeNumber(current.score, 0) > safeNumber(best.score, 0) ? current : best;
      }, null);

      const visible = (
        exam.result_mode === 'immediate' ||
        (exam.result_mode === 'after_end' && exam.end_time && now > new Date(exam.end_time))
      );

      return {
        examId: exam.id,
        title: exam.template?.title || 'Assessment',
        subject: exam.template?.subject || 'N/A',
        result_mode: exam.result_mode,
        start_time: exam.start_time,
        end_time: exam.end_time,
        attemptsUsed: examAttempts.length,
        latestAttempt,
        bestAttempt,
        resultVisible: visible
      };
    });

    res.json({ results });
  } catch (error) {
    console.error('Student results error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to fetch student results') });
  }
});

// Student metrics
router.get('/metrics/student', verifyToken, hasRole('student'), async (req, res) => {
  try {
    const { detail: studentDetail, error: studentError } = await getStudentDetail(req.user.id);

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

    const exams = (hostedExams || []).filter((exam) => isExamAssignedToStudent(exam, studentDetail));

    const inProgress = exams.filter((exam) => {
      if (!exam.start_time || !exam.end_time) return false;
      return new Date(exam.start_time) <= now && now <= new Date(exam.end_time);
    }).length;

    const upcoming = exams.filter((exam) => {
      if (!exam.start_time) return false;
      return now < new Date(exam.start_time);
    }).length;

    let completed = 0;
    const hostedIds = exams.map((exam) => exam.id);

    if (hostedIds.length > 0) {
      const { data: submittedAttempts, error: attemptError } = await supabase
        .from('assessment_attempts')
        .select('hosted_assessment_id')
        .eq('student_id', req.user.id)
        .in('hosted_assessment_id', hostedIds)
        .in('status', ['submitted', 'auto_submitted']);

      if (attemptError && !isMissingAttemptTableError(attemptError)) {
        throw attemptError;
      }

      completed = new Set((submittedAttempts || []).map((item) => item.hosted_assessment_id)).size;
    }

    res.json({
      assigned: exams.length,
      inProgress,
      upcoming,
      completed
    });
  } catch (error) {
    console.error('Student metrics error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to fetch student metrics') });
  }
});

module.exports = router;
