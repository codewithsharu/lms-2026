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
const isMissingHostedTargetTableError = (error) => (
  error?.code === 'PGRST205' &&
  String(error?.message || '').includes('hosted_assessment_student_targets')
);

const HOSTED_EXAM_ALLOWED_RESULT_MODES = ['after_end', 'immediate', 'manual'];
const HOSTED_EXAM_ALLOWED_PUBLISH_STATUSES = ['draft', 'published', 'closed'];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXAM_SESSION_HEADER = 'x-exam-session-token';
const EXAM_SESSION_META_KEY = '__sessionMeta';
const ATTEMPT_SECTION_META_KEY = '__sectionMeta';
const CODING_SUBMISSIONS_META_KEY = '__codingSubmissions';
const ONECOMPILER_API_BASE = 'https://api.onecompiler.com';
const ONECOMPILER_TIMEOUT_MS = Number.parseInt(process.env.ONECOMPILER_TIMEOUT_MS || '25000', 10);

const getOneCompilerApiKey = () => {
  const candidates = [
    process.env.ONECOMPILER_API_KEY,
    process.env.ONE_COMPILER_API_KEY,
    process.env.ONECOMPILER_ACCESS_TOKEN,
    process.env.ONECOMPILER_KEY
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
};

const readJsonOrText = async (response) => {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const callOneCompiler = async ({ url, method = 'GET', headers = {}, body }) => {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(ONECOMPILER_TIMEOUT_MS) ? ONECOMPILER_TIMEOUT_MS : 25000;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });

    const payload = await readJsonOrText(response);

    return {
      ok: response.ok,
      status: response.status,
      payload
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const normalizeIndexList = (rawValue) => {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return Array.from(new Set(
    rawValue
      .map((entry) => safeInt(entry, -1))
      .filter((entry) => Number.isFinite(entry) && entry >= 0)
  )).sort((left, right) => left - right);
};

const normalizePositiveMarks = (value, fallback = 1) => {
  const parsed = safeNumber(value, fallback);
  const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Number(safe.toFixed(2));
};

const safeInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const safeNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolvePublishStatusByWindow = (requestedStatus, parsedEndTime) => {
  if (requestedStatus !== 'published') return requestedStatus;

  if (!parsedEndTime || Number.isNaN(parsedEndTime.getTime())) {
    return requestedStatus;
  }

  return parsedEndTime <= new Date() ? 'closed' : requestedStatus;
};

const parseBooleanInput = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return fallback;
};

const normalizeChallengeIdList = (rawValue) => {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return [...new Set(
    rawValue
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )];
};

const normalizeCodingSection = (rawValue) => {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const enabled = parseBooleanInput(rawValue.enabled, false);
  if (!enabled) {
    return null;
  }

  const challengeIds = normalizeChallengeIdList(
    Array.isArray(rawValue.challenge_ids)
      ? rawValue.challenge_ids
      : []
  );

  if (challengeIds.length === 0) {
    return null;
  }

  const timeAllocationMinutes = Math.max(0, safeInt(rawValue.time_allocation_minutes, 0));

  return {
    enabled: true,
    section_order: ['mcq', 'coding'],
    challenge_ids: challengeIds,
    time_allocation_minutes: timeAllocationMinutes
  };
};

const validateCodingSectionInput = (rawValue) => {
  if (rawValue === undefined || rawValue === null) {
    return { normalized: null, error: null };
  }

  if (typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return { normalized: null, error: 'Invalid coding section payload' };
  }

  const enabled = parseBooleanInput(rawValue.enabled, false);
  if (!enabled) {
    return { normalized: null, error: null };
  }

  if (!Array.isArray(rawValue.challenge_ids)) {
    return {
      normalized: null,
      error: 'Coding challenges must be an array when coding section is enabled'
    };
  }

  const challengeIds = normalizeChallengeIdList(rawValue.challenge_ids);
  if (challengeIds.length === 0) {
    return {
      normalized: null,
      error: 'Select at least one coding challenge when coding section is enabled'
    };
  }

  const rawTimeAllocation = rawValue.time_allocation_minutes;
  let timeAllocationMinutes = 0;

  if (rawTimeAllocation !== undefined && rawTimeAllocation !== null && String(rawTimeAllocation).trim() !== '') {
    const parsedTime = Number(rawTimeAllocation);

    if (!Number.isFinite(parsedTime) || parsedTime < 0) {
      return {
        normalized: null,
        error: 'Coding time allocation must be a non-negative number'
      };
    }

    timeAllocationMinutes = Math.floor(parsedTime);
  }

  return {
    normalized: {
      enabled: true,
      section_order: ['mcq', 'coding'],
      challenge_ids: challengeIds,
      time_allocation_minutes: timeAllocationMinutes
    },
    error: null
  };
};

const getAttemptSectionState = (answers) => {
  if (!answers || typeof answers !== 'object') {
    return {
      currentSection: 'mcq',
      mcqCompletedAt: null,
      codingEnteredAt: null
    };
  }

  const meta = answers[ATTEMPT_SECTION_META_KEY];
  if (!meta || typeof meta !== 'object') {
    return {
      currentSection: 'mcq',
      mcqCompletedAt: null,
      codingEnteredAt: null
    };
  }

  const currentSection = meta.currentSection === 'coding' ? 'coding' : 'mcq';

  return {
    currentSection,
    mcqCompletedAt: meta.mcqCompletedAt || null,
    codingEnteredAt: meta.codingEnteredAt || null
  };
};

const applyAttemptSectionState = (answers, updates = {}) => {
  const current = getAttemptSectionState(answers);

  return {
    ...(answers && typeof answers === 'object' ? answers : {}),
    [ATTEMPT_SECTION_META_KEY]: {
      currentSection: updates.currentSection || current.currentSection,
      mcqCompletedAt: updates.mcqCompletedAt || current.mcqCompletedAt,
      codingEnteredAt: updates.codingEnteredAt || current.codingEnteredAt
    }
  };
};

const sanitizeCodingSectionForStudent = (codingSection, sectionState) => {
  const normalized = normalizeCodingSection(codingSection);
  if (!normalized) {
    return null;
  }

  const unlocked = Boolean(sectionState?.mcqCompletedAt) || sectionState?.currentSection === 'coding';

  return {
    ...normalized,
    unlocked,
    mcq_completed_at: sectionState?.mcqCompletedAt || null,
    coding_entered_at: sectionState?.codingEnteredAt || null
  };
};

const normalizeSessionTokenValue = (value) => {
  if (Array.isArray(value)) {
    return value.find((entry) => typeof entry === 'string' && entry.trim()) || '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return '';
};

const getExamSessionToken = (req) => {
  const fromBody = normalizeSessionTokenValue(req.body?.sessionToken);
  const fromQuery = normalizeSessionTokenValue(req.query?.sessionToken);
  const fromHeader = normalizeSessionTokenValue(req.get(EXAM_SESSION_HEADER));

  return fromBody || fromQuery || fromHeader || null;
};

const getAttemptSessionMeta = (answers) => {
  if (!answers || typeof answers !== 'object') {
    return { token: null, updatedAt: null };
  }

  const meta = answers[EXAM_SESSION_META_KEY];
  if (!meta || typeof meta !== 'object') {
    return { token: null, updatedAt: null };
  }

  return {
    token: meta.token || null,
    updatedAt: meta.updatedAt || null
  };
};

const applyAttemptSessionMeta = (answers, sessionToken) => ({
  ...(answers && typeof answers === 'object' ? answers : {}),
  [EXAM_SESSION_META_KEY]: {
    token: sessionToken,
    updatedAt: new Date().toISOString()
  }
});

const buildSessionConflictResponse = (message, attemptId) => ({
  error: message,
  sessionConflict: true,
  attemptId
});

const isUuid = (value) => UUID_REGEX.test(String(value || ''));

const normalizeStudentIdList = (rawValue) => {
  if (!Array.isArray(rawValue)) {
    return { normalized: [], invalid: [] };
  }

  const sanitized = rawValue
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  const invalid = sanitized.filter((value) => !isUuid(value));
  const normalized = [...new Set(sanitized.filter((value) => isUuid(value)))];

  return { normalized, invalid };
};

const doesTeacherAssignmentMatchStudent = (assignment, studentDetail) => {
  if (!assignment || !studentDetail) return false;

  const classMatch = !assignment.class_id || assignment.class_id === studentDetail.class_id;
  const sectionMatch = !assignment.section_id || assignment.section_id === studentDetail.section_id;
  const zoneMatch = !assignment.zone || assignment.zone === studentDetail.zone;

  return classMatch && sectionMatch && zoneMatch;
};

const getTeacherAssignmentScopes = async (teacherId) => {
  const { data, error } = await supabase
    .from('teacher_assignments')
    .select('class_id, section_id, zone')
    .eq('teacher_id', teacherId);

  if (error) throw error;

  return data || [];
};

const getTeacherAllowedStudentIdSet = async (teacherId) => {
  const assignmentScopes = await getTeacherAssignmentScopes(teacherId);

  if (assignmentScopes.length === 0) {
    return new Set();
  }

  const classIds = [...new Set(
    assignmentScopes
      .map((assignment) => assignment.class_id)
      .filter(Boolean)
  )];

  if (classIds.length === 0) {
    return new Set();
  }

  const { data: studentDetails, error: studentError } = await supabase
    .from('student_details')
    .select('user_id, class_id, section_id, zone')
    .in('class_id', classIds);

  if (studentError) throw studentError;

  const allowedStudentIds = new Set();

  (studentDetails || []).forEach((studentDetail) => {
    const isAllowed = assignmentScopes.some((assignment) => doesTeacherAssignmentMatchStudent(assignment, studentDetail));
    if (isAllowed && studentDetail.user_id) {
      allowedStudentIds.add(studentDetail.user_id);
    }
  });

  return allowedStudentIds;
};

const replaceHostedExamStudentTargets = async (hostedAssessmentId, studentIds = []) => {
  const { error: deleteError } = await supabase
    .from('hosted_assessment_student_targets')
    .delete()
    .eq('hosted_assessment_id', hostedAssessmentId);

  if (deleteError && isMissingHostedTargetTableError(deleteError)) {
    if (studentIds.length > 0) {
      throw deleteError;
    }

    return [];
  }

  if (deleteError) throw deleteError;

  if (studentIds.length === 0) {
    return [];
  }

  const insertRows = studentIds.map((studentId) => ({
    hosted_assessment_id: hostedAssessmentId,
    student_id: studentId
  }));

  const { data: insertedTargets, error: insertError } = await supabase
    .from('hosted_assessment_student_targets')
    .insert(insertRows)
    .select('hosted_assessment_id, student_id, student:student_id(id, full_name, email)');

  if (insertError) throw insertError;

  return insertedTargets || [];
};

const getStudentTargetMapForHostedExams = async (hostedAssessmentIds = []) => {
  const uniqueIds = [...new Set((hostedAssessmentIds || []).filter(Boolean))];

  if (uniqueIds.length === 0) {
    return { map: {}, setupRequired: false };
  }

  const { data, error } = await supabase
    .from('hosted_assessment_student_targets')
    .select('hosted_assessment_id, student_id, student:student_id(id, full_name, email)')
    .in('hosted_assessment_id', uniqueIds);

  if (error && isMissingHostedTargetTableError(error)) {
    return { map: {}, setupRequired: true };
  }

  if (error) throw error;

  const mapped = (data || []).reduce((acc, row) => {
    if (!row?.hosted_assessment_id) return acc;

    if (!acc[row.hosted_assessment_id]) {
      acc[row.hosted_assessment_id] = [];
    }

    acc[row.hosted_assessment_id].push({
      student_id: row.student_id,
      student: row.student || null
    });

    return acc;
  }, {});

  return { map: mapped, setupRequired: false };
};

const getAttemptStatsForHostedExams = async (hostedAssessmentIds = []) => {
  const uniqueIds = [...new Set((hostedAssessmentIds || []).filter(Boolean))];

  if (uniqueIds.length === 0) {
    return { map: {}, setupRequired: false };
  }

  const { data, error } = await supabase
    .from('assessment_attempts')
    .select('hosted_assessment_id, status')
    .in('hosted_assessment_id', uniqueIds);

  if (error && isMissingAttemptTableError(error)) {
    return { map: {}, setupRequired: true };
  }

  if (error) throw error;

  const mapped = (data || []).reduce((acc, row) => {
    const hostedAssessmentId = row?.hosted_assessment_id;
    if (!hostedAssessmentId) return acc;

    if (!acc[hostedAssessmentId]) {
      acc[hostedAssessmentId] = {
        started: 0,
        in_progress: 0,
        submitted: 0
      };
    }

    acc[hostedAssessmentId].started += 1;

    if (row.status === 'submitted' || row.status === 'auto_submitted') {
      acc[hostedAssessmentId].submitted += 1;
    }

    if (row.status === 'in_progress') {
      acc[hostedAssessmentId].in_progress += 1;
    }

    return acc;
  }, {});

  return { map: mapped, setupRequired: false };
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
          blankAnswer,
          marks: normalizePositiveMarks(item?.marks ?? item?.score ?? item?.points, 1)
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
        correctOptions,
        marks: normalizePositiveMarks(item?.marks ?? item?.score ?? item?.points, 1)
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

const isExamAssignedToStudent = (exam, studentDetail, studentId, targetedStudentIds = []) => {
  if (!exam || !studentDetail) return false;

  const targetedSet = new Set((targetedStudentIds || []).filter(Boolean));

  if (targetedSet.size > 0) {
    return targetedSet.has(studentId);
  }

  if (exam.class_id && exam.class_id !== studentDetail.class_id) return false;

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

const roundToTwo = (value) => Number(safeNumber(value, 0).toFixed(2));

const normalizeQuestionScoreList = (rawValue) => {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Number(entry.toFixed(2)));
};

const sumScoreList = (scores = []) => roundToTwo(
  scores.reduce((sum, score) => sum + safeNumber(score, 0), 0)
);

const getCodingSubmissionMap = (answers) => {
  if (!answers || typeof answers !== 'object') {
    return {};
  }

  const submissions = answers[CODING_SUBMISSIONS_META_KEY];
  if (!submissions || typeof submissions !== 'object' || Array.isArray(submissions)) {
    return {};
  }

  return Object.entries(submissions).reduce((accumulator, [challengeId, entry]) => {
    const normalizedChallengeId = String(challengeId || '').trim();

    if (!normalizedChallengeId || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return accumulator;
    }

    accumulator[normalizedChallengeId] = entry;
    return accumulator;
  }, {});
};

const normalizeChallengeProblemList = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (Array.isArray(payload.problems)) {
    return payload.problems;
  }

  if (Array.isArray(payload.challenge?.problems)) {
    return payload.challenge.problems;
  }

  return [];
};

const extractChallengeScoreProfile = (payload) => {
  const problems = normalizeChallengeProblemList(payload);
  const questionScores = problems.map((problem) => (
    normalizePositiveMarks(problem?.properties?.score ?? problem?.score ?? problem?.points, 1)
  ));

  return {
    questionScores,
    totalPossibleScore: sumScoreList(questionScores),
    questionCount: questionScores.length
  };
};

const fetchChallengeScoreProfile = async (challengeId, apiKey) => {
  if (!challengeId || !apiKey) {
    return null;
  }

  try {
    const upstream = await callOneCompiler({
      url: `${ONECOMPILER_API_BASE}/v1/challenges/${encodeURIComponent(challengeId)}?access_token=${encodeURIComponent(apiKey)}`
    });

    if (!upstream.ok) {
      return null;
    }

    return extractChallengeScoreProfile(upstream.payload);
  } catch {
    return null;
  }
};

const calculateCodingChallengeSummary = (submission, fallbackProfile) => {
  const safeSubmission = submission && typeof submission === 'object' && !Array.isArray(submission)
    ? submission
    : {};
  const fallbackScores = normalizeQuestionScoreList(fallbackProfile?.questionScores);
  const submissionScores = normalizeQuestionScoreList(safeSubmission.questionScores);
  const resolvedQuestionScores = submissionScores.length > 0 ? submissionScores : fallbackScores;

  const submissionTotalPossibleScore = safeNumber(safeSubmission.totalPossibleScore, 0);
  const fallbackTotalPossibleScore = safeNumber(fallbackProfile?.totalPossibleScore, 0);
  let totalPossibleScore = 0;

  if (submissionTotalPossibleScore > 0) {
    totalPossibleScore = roundToTwo(submissionTotalPossibleScore);
  } else if (fallbackTotalPossibleScore > 0) {
    totalPossibleScore = roundToTwo(fallbackTotalPossibleScore);
  } else if (resolvedQuestionScores.length > 0) {
    totalPossibleScore = sumScoreList(resolvedQuestionScores);
  }

  let passedQuestionIndexes = normalizeIndexList(safeSubmission.passedQuestionIndexes);
  const allTestCasesPassedFlag = parseBooleanInput(safeSubmission.allTestCasesPassed, false);

  if (allTestCasesPassedFlag && resolvedQuestionScores.length > 0) {
    passedQuestionIndexes = Array.from({ length: resolvedQuestionScores.length }, (_, index) => index);
  }

  const hintedPassedCount = Math.max(
    passedQuestionIndexes.length,
    safeInt(safeSubmission.passedQuestionCount, 0)
  );

  if (passedQuestionIndexes.length === 0 && hintedPassedCount > 0 && resolvedQuestionScores.length > 0) {
    const inferredCount = Math.min(hintedPassedCount, resolvedQuestionScores.length);
    passedQuestionIndexes = Array.from({ length: inferredCount }, (_, index) => index);
  }

  if (resolvedQuestionScores.length > 0) {
    passedQuestionIndexes = passedQuestionIndexes.filter((index) => index < resolvedQuestionScores.length);
  }

  const hintedQuestionCount = Math.max(
    resolvedQuestionScores.length,
    safeInt(safeSubmission.totalQuestionCount, 0)
  );
  const totalQuestionCount = hintedQuestionCount;

  let passedQuestionCount = Math.max(passedQuestionIndexes.length, hintedPassedCount);
  if (allTestCasesPassedFlag && totalQuestionCount > 0) {
    passedQuestionCount = totalQuestionCount;
  }
  if (totalQuestionCount > 0) {
    passedQuestionCount = Math.min(totalQuestionCount, passedQuestionCount);
  }

  const allTestCasesPassed = totalQuestionCount > 0
    ? (allTestCasesPassedFlag || passedQuestionCount >= totalQuestionCount)
    : allTestCasesPassedFlag;

  let score = 0;

  if (resolvedQuestionScores.length > 0 && passedQuestionIndexes.length > 0) {
    score = roundToTwo(
      passedQuestionIndexes.reduce((sum, index) => sum + safeNumber(resolvedQuestionScores[index], 0), 0)
    );
  } else if (allTestCasesPassed && totalPossibleScore > 0) {
    score = totalPossibleScore;
  }

  if (totalPossibleScore <= 0 && resolvedQuestionScores.length > 0) {
    totalPossibleScore = sumScoreList(resolvedQuestionScores);
  }

  if (totalPossibleScore <= 0 && score > 0) {
    totalPossibleScore = score;
  }

  if (totalPossibleScore > 0) {
    score = Math.min(score, totalPossibleScore);
  }

  return {
    score: roundToTwo(score),
    totalPossibleScore: roundToTwo(totalPossibleScore),
    passedQuestionCount,
    totalQuestionCount,
    allTestCasesPassed,
    questionScores: resolvedQuestionScores
  };
};

const calculateCodingSummary = async ({ codingSection, rawAnswers }) => {
  const normalizedCodingSection = normalizeCodingSection(codingSection);

  if (!normalizedCodingSection) {
    return {
      score: 0,
      totalMarks: 0,
      passedQuestionCount: 0,
      totalQuestionCount: 0,
      challengeBreakdown: {}
    };
  }

  const submissions = getCodingSubmissionMap(rawAnswers);
  const challengeIds = normalizedCodingSection.challenge_ids;
  const apiKey = getOneCompilerApiKey();

  const challengeEntries = await Promise.all(
    challengeIds.map(async (challengeId) => {
      const submission = submissions[challengeId] && typeof submissions[challengeId] === 'object'
        ? submissions[challengeId]
        : {};
      const submissionScores = normalizeQuestionScoreList(submission.questionScores);
      const shouldFetchFallback = submissionScores.length === 0;
      const fallbackProfile = shouldFetchFallback ? await fetchChallengeScoreProfile(challengeId, apiKey) : null;
      const summary = calculateCodingChallengeSummary(submission, fallbackProfile);

      return [challengeId, summary];
    })
  );

  const challengeBreakdown = Object.fromEntries(challengeEntries);
  const score = roundToTwo(
    challengeEntries.reduce((sum, [, summary]) => sum + safeNumber(summary?.score, 0), 0)
  );
  const totalMarks = roundToTwo(
    challengeEntries.reduce((sum, [, summary]) => sum + safeNumber(summary?.totalPossibleScore, 0), 0)
  );
  const passedQuestionCount = challengeEntries.reduce(
    (sum, [, summary]) => sum + safeInt(summary?.passedQuestionCount, 0),
    0
  );
  const totalQuestionCount = challengeEntries.reduce(
    (sum, [, summary]) => sum + safeInt(summary?.totalQuestionCount, 0),
    0
  );

  return {
    score,
    totalMarks,
    passedQuestionCount,
    totalQuestionCount,
    challengeBreakdown
  };
};

const calculateAttemptSummary = (questions, rawAnswers, configuredTotalMarks) => {
  const answers = rawAnswers && typeof rawAnswers === 'object' ? rawAnswers : {};
  const totalQuestions = questions.length;
  const configuredMarks = safeNumber(configuredTotalMarks, 0);

  let correctCount = 0;
  let score = 0;
  let questionMarksTotal = 0;
  const normalizedAnswers = {};

  questions.forEach((question, index) => {
    const key = String(index);
    const normalized = normalizeSubmittedAnswer(question, answers[key]);
    const questionMarks = normalizePositiveMarks(question?.marks, 1);
    questionMarksTotal += questionMarks;

    normalizedAnswers[key] = normalized;

    if (isAnswerCorrect(question, normalized)) {
      correctCount += 1;
      score += questionMarks;
    }
  });

  const totalMarks = questionMarksTotal > 0
    ? questionMarksTotal
    : (configuredMarks > 0 ? configuredMarks : totalQuestions);
  score = roundToTwo(score);
  const percentage = totalMarks > 0 ? Number(((score / totalMarks) * 100).toFixed(2)) : 0;

  return {
    normalizedAnswers,
    correctCount,
    totalQuestions,
    totalMarks: roundToTwo(totalMarks),
    score,
    percentage,
    configuredTotalMarks: roundToTwo(configuredMarks > 0 ? configuredMarks : totalMarks)
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

// Teacher: delete template (soft delete)
router.delete('/templates/:id', verifyToken, hasRole('teacher'), async (req, res) => {
  try {
    const { id } = req.params;

    const { data: template, error } = await supabase
      .from('assessment_templates')
      .update({ is_active: false })
      .eq('id', id)
      .eq('teacher_id', req.user.id)
      .select('id')
      .single();

    if (error && isMissingAssessmentTableError(error)) {
      return res.status(503).json({
        error: 'Assessment module is not initialized yet. Please run migration when DB access is available.',
        setupRequired: true
      });
    }

    if (error || !template) {
      return res.status(404).json({ error: 'Template not found for this teacher' });
    }

    res.json({ message: 'Template deleted successfully', templateId: template.id });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to delete template') });
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
      allow_resume,
      duration_minutes,
      max_attempts,
      result_mode,
      publish_status,
      start_time,
      end_time,
      exam_title,
      instructions,
      coding_section,
      assigned_student_ids = []
    } = req.body;

    if (!template_id || !duration_minutes || !max_attempts || !result_mode || !publish_status) {
      return res.status(400).json({ error: 'template_id, duration, attempts, result mode and publish status are required' });
    }

    const { normalized: normalizedStudentIds, invalid: invalidStudentIds } = normalizeStudentIdList(assigned_student_ids);

    if (invalidStudentIds.length > 0) {
      return res.status(400).json({ error: 'One or more assigned student IDs are invalid' });
    }

    if (normalizedStudentIds.length > 0) {
      const allowedStudents = await getTeacherAllowedStudentIdSet(req.user.id);
      const unauthorizedStudents = normalizedStudentIds.filter((studentId) => !allowedStudents.has(studentId));

      if (unauthorizedStudents.length > 0) {
        return res.status(403).json({ error: 'One or more selected students are outside your class assignment scope' });
      }
    }

    const parsedDuration = safeInt(duration_minutes, 0);
    const parsedAttempts = safeInt(max_attempts, 0);
    const parsedAllowResume = parseBooleanInput(allow_resume, true);

    if (parsedDuration <= 0) {
      return res.status(400).json({ error: 'Duration must be greater than 0 minutes' });
    }

    if (parsedAttempts <= 0) {
      return res.status(400).json({ error: 'Max attempts must be at least 1' });
    }

    if (!HOSTED_EXAM_ALLOWED_RESULT_MODES.includes(result_mode)) {
      return res.status(400).json({ error: 'Invalid result mode' });
    }

    if (!HOSTED_EXAM_ALLOWED_PUBLISH_STATUSES.includes(publish_status)) {
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

    const { normalized: normalizedCodingSection, error: codingSectionError } = validateCodingSectionInput(coding_section);

    if (codingSectionError) {
      return res.status(400).json({ error: codingSectionError });
    }

    const finalPublishStatus = resolvePublishStatusByWindow(String(publish_status), parsedEndTime);
    const autoClosedOnCreate = publish_status === 'published' && finalPublishStatus === 'closed';

    const { data: template, error: templateError } = await supabase
      .from('assessment_templates')
      .select('id, teacher_id, question_count, template_data')
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

    const validTemplateQuestions = normalizeQuestionList(template.template_data);
    if (validTemplateQuestions.length === 0 || safeInt(template.question_count, 0) <= 0) {
      return res.status(400).json({
        error: 'Cannot schedule exam because the selected template has zero valid questions'
      });
    }

    const payload = {
      template_id,
      host_id: req.user.id,
      class_id: class_id || null,
      section_id: section_id || null,
      zone: zone || null,
      allow_resume: parsedAllowResume,
      duration_minutes: parsedDuration,
      max_attempts: parsedAttempts,
      result_mode,
      publish_status: finalPublishStatus,
      start_time: parsedStartTime ? parsedStartTime.toISOString() : null,
      end_time: parsedEndTime ? parsedEndTime.toISOString() : null,
      coding_section: normalizedCodingSection,
      exam_title: String(exam_title || '').trim() || null,
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

    let specificStudents = [];

    try {
      const targetRows = await replaceHostedExamStudentTargets(data.id, normalizedStudentIds);
      specificStudents = targetRows.map((item) => ({
        id: item.student?.id || item.student_id,
        full_name: item.student?.full_name || null,
        email: item.student?.email || null
      }));
    } catch (targetError) {
      if (isMissingHostedTargetTableError(targetError)) {
        return res.status(503).json({
          error: 'Hosted assessment student target module is not initialized yet. Please run migration when DB access is available.',
          setupRequired: true
        });
      }

      throw targetError;
    }

    res.status(201).json({
      message: autoClosedOnCreate
        ? 'Exam window is already over, so status was saved as Closed'
        : 'Exam hosted successfully',
      hostedExam: {
        ...data,
        specific_students: specificStudents
      }
    });
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

    const hostedExams = data || [];
    const hostedExamIds = hostedExams.map((exam) => exam.id);
    const { map: targetMap, setupRequired } = await getStudentTargetMapForHostedExams(hostedExamIds);
    const { map: attemptStatsMap, setupRequired: attemptSetupRequired } = await getAttemptStatsForHostedExams(hostedExamIds);

    const enrichedExams = hostedExams.map((exam) => ({
      ...exam,
      ...(attemptStatsMap[exam.id]
        ? {
          attempts_started_count: attemptStatsMap[exam.id].started,
          attempts_submitted_count: attemptStatsMap[exam.id].submitted,
          attempts_in_progress_count: attemptStatsMap[exam.id].in_progress,
          is_locked_for_coding_section_edit: attemptStatsMap[exam.id].started > 0
        }
        : {
          attempts_started_count: 0,
          attempts_submitted_count: 0,
          attempts_in_progress_count: 0,
          is_locked_for_coding_section_edit: false
        }
      ),
      coding_section: normalizeCodingSection(exam.coding_section),
      specific_students: (targetMap[exam.id] || []).map((item) => ({
        id: item.student?.id || item.student_id,
        full_name: item.student?.full_name || null,
        email: item.student?.email || null
      }))
    }));

    res.json({
      hostedExams: enrichedExams,
      ...(setupRequired || attemptSetupRequired ? { setupRequired: true } : {})
    });
  } catch (error) {
    console.error('List hosted exams error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to fetch hosted exams') });
  }
});

// Teacher: update hosted exam after creation
router.put('/hosted/:id', verifyToken, hasRole('teacher'), async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existingHostedExam, error: existingError } = await supabase
      .from('hosted_assessments')
      .select('*')
      .eq('id', id)
      .eq('host_id', req.user.id)
      .single();

    if (existingError && isMissingHostedTableError(existingError)) {
      return res.status(503).json({
        error: 'Assessment module is not initialized yet. Please run migration when DB access is available.',
        setupRequired: true
      });
    }

    if (existingError || !existingHostedExam) {
      return res.status(404).json({ error: 'Hosted exam not found for this teacher' });
    }

    const {
      template_id,
      class_id,
      section_id,
      zone,
      allow_resume,
      duration_minutes,
      max_attempts,
      result_mode,
      publish_status,
      start_time,
      end_time,
      exam_title,
      instructions,
      coding_section,
      assigned_student_ids
    } = req.body;

    const resolvedDuration = duration_minutes !== undefined
      ? safeInt(duration_minutes, 0)
      : safeInt(existingHostedExam.duration_minutes, 0);
    const resolvedAttempts = max_attempts !== undefined
      ? safeInt(max_attempts, 0)
      : safeInt(existingHostedExam.max_attempts, 0);
    const resolvedAllowResume = allow_resume !== undefined
      ? parseBooleanInput(allow_resume, true)
      : existingHostedExam.allow_resume !== false;
    const resolvedTemplateId = template_id !== undefined
      ? String(template_id || '').trim()
      : String(existingHostedExam.template_id || '').trim();
    const resolvedResultMode = result_mode !== undefined
      ? String(result_mode)
      : existingHostedExam.result_mode;
    const resolvedPublishStatus = publish_status !== undefined
      ? String(publish_status)
      : existingHostedExam.publish_status;
    const templateChanged = resolvedTemplateId !== String(existingHostedExam.template_id || '');

    if (!resolvedTemplateId) {
      return res.status(400).json({ error: 'template_id is required' });
    }

    if (resolvedDuration <= 0) {
      return res.status(400).json({ error: 'Duration must be greater than 0 minutes' });
    }

    if (resolvedAttempts <= 0) {
      return res.status(400).json({ error: 'Max attempts must be at least 1' });
    }

    if (!HOSTED_EXAM_ALLOWED_RESULT_MODES.includes(resolvedResultMode)) {
      return res.status(400).json({ error: 'Invalid result mode' });
    }

    if (!HOSTED_EXAM_ALLOWED_PUBLISH_STATUSES.includes(resolvedPublishStatus)) {
      return res.status(400).json({ error: 'Invalid publish status' });
    }

    const startInput = start_time !== undefined
      ? (start_time || null)
      : existingHostedExam.start_time;
    const endInput = end_time !== undefined
      ? (end_time || null)
      : existingHostedExam.end_time;

    const parsedStartTime = startInput ? new Date(startInput) : null;
    const parsedEndTime = endInput ? new Date(endInput) : null;

    if (parsedStartTime && Number.isNaN(parsedStartTime.getTime())) {
      return res.status(400).json({ error: 'Invalid start time' });
    }

    if (parsedEndTime && Number.isNaN(parsedEndTime.getTime())) {
      return res.status(400).json({ error: 'Invalid end time' });
    }

    if (parsedStartTime && parsedEndTime && parsedEndTime <= parsedStartTime) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    if (resolvedPublishStatus === 'published' && (!parsedStartTime || !parsedEndTime)) {
      return res.status(400).json({ error: 'Start and end time are required to publish an exam' });
    }

    const finalPublishStatus = resolvePublishStatusByWindow(resolvedPublishStatus, parsedEndTime);
    const autoClosedOnUpdate = resolvedPublishStatus === 'published' && finalPublishStatus === 'closed';

    const { data: linkedTemplate, error: linkedTemplateError } = await supabase
      .from('assessment_templates')
      .select('id, teacher_id, question_count, template_data')
      .eq('id', resolvedTemplateId)
      .eq('teacher_id', req.user.id)
      .single();

    if (linkedTemplateError && isMissingAssessmentTableError(linkedTemplateError)) {
      return res.status(503).json({
        error: 'Assessment module is not initialized yet. Please run migration when DB access is available.',
        setupRequired: true
      });
    }

    if (linkedTemplateError || !linkedTemplate) {
      return res.status(404).json({ error: 'Linked template not found for this hosted exam' });
    }

    const validLinkedTemplateQuestions = normalizeQuestionList(linkedTemplate.template_data);
    if (validLinkedTemplateQuestions.length === 0 || safeInt(linkedTemplate.question_count, 0) <= 0) {
      return res.status(400).json({
        error: 'Cannot save hosted exam because its template has zero valid questions'
      });
    }

    let normalizedStudentIds = null;

    if (assigned_student_ids !== undefined) {
      const { normalized, invalid } = normalizeStudentIdList(assigned_student_ids);

      if (invalid.length > 0) {
        return res.status(400).json({ error: 'One or more assigned student IDs are invalid' });
      }

      if (normalized.length > 0) {
        const allowedStudents = await getTeacherAllowedStudentIdSet(req.user.id);
        const unauthorizedStudents = normalized.filter((studentId) => !allowedStudents.has(studentId));

        if (unauthorizedStudents.length > 0) {
          return res.status(403).json({ error: 'One or more selected students are outside your class assignment scope' });
        }
      }

      normalizedStudentIds = normalized;
    }

    const codingSectionUpdate = coding_section !== undefined
      ? validateCodingSectionInput(coding_section)
      : { normalized: normalizeCodingSection(existingHostedExam.coding_section), error: null };

    if (codingSectionUpdate.error) {
      return res.status(400).json({ error: codingSectionUpdate.error });
    }

    const resolvedCodingSection = codingSectionUpdate.normalized;
    const existingCodingSection = normalizeCodingSection(existingHostedExam.coding_section);
    const codingSectionChanged = JSON.stringify(resolvedCodingSection || null) !== JSON.stringify(existingCodingSection || null);

    if (codingSectionChanged || templateChanged) {
      const { count: attemptsStartedCount, error: attemptCountError } = await supabase
        .from('assessment_attempts')
        .select('id', { head: true, count: 'exact' })
        .eq('hosted_assessment_id', id);

      if (attemptCountError && isMissingAttemptTableError(attemptCountError)) {
        return res.status(503).json({
          error: 'Assessment attempts module is not initialized yet. Please run migration when DB access is available.',
          setupRequired: true
        });
      }

      if (attemptCountError) throw attemptCountError;

      if (safeInt(attemptsStartedCount, 0) > 0) {
        if (templateChanged) {
          return res.status(409).json({
            error: 'Template cannot be changed after student attempts have started for this exam'
          });
        }

        return res.status(409).json({
          error: 'Coding section cannot be changed after student attempts have started for this exam'
        });
      }
    }

    const updatePayload = {
      template_id: resolvedTemplateId,
      class_id: class_id !== undefined ? (class_id || null) : existingHostedExam.class_id,
      section_id: section_id !== undefined ? (section_id || null) : existingHostedExam.section_id,
      zone: zone !== undefined ? (zone || null) : existingHostedExam.zone,
      allow_resume: resolvedAllowResume,
      duration_minutes: resolvedDuration,
      max_attempts: resolvedAttempts,
      result_mode: resolvedResultMode,
      publish_status: finalPublishStatus,
      start_time: parsedStartTime ? parsedStartTime.toISOString() : null,
      end_time: parsedEndTime ? parsedEndTime.toISOString() : null,
      coding_section: resolvedCodingSection,
      exam_title: exam_title !== undefined
        ? (String(exam_title || '').trim() || null)
        : existingHostedExam.exam_title,
      instructions: instructions !== undefined
        ? (instructions ? String(instructions).trim() : null)
        : existingHostedExam.instructions
    };

    const { data: updatedHostedExam, error: updateError } = await supabase
      .from('hosted_assessments')
      .update(updatePayload)
      .eq('id', id)
      .eq('host_id', req.user.id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    let specificStudents = [];

    if (normalizedStudentIds !== null) {
      try {
        const targetRows = await replaceHostedExamStudentTargets(id, normalizedStudentIds);
        specificStudents = targetRows.map((item) => ({
          id: item.student?.id || item.student_id,
          full_name: item.student?.full_name || null,
          email: item.student?.email || null
        }));
      } catch (targetError) {
        if (isMissingHostedTargetTableError(targetError)) {
          return res.status(503).json({
            error: 'Hosted assessment student target module is not initialized yet. Please run migration when DB access is available.',
            setupRequired: true
          });
        }

        throw targetError;
      }
    } else {
      const { map: targetMap } = await getStudentTargetMapForHostedExams([id]);
      specificStudents = (targetMap[id] || []).map((item) => ({
        id: item.student?.id || item.student_id,
        full_name: item.student?.full_name || null,
        email: item.student?.email || null
      }));
    }

    res.json({
      message: autoClosedOnUpdate
        ? 'Exam window is already over, so status was saved as Closed'
        : 'Hosted exam updated successfully',
      hostedExam: {
        ...updatedHostedExam,
        specific_students: specificStudents
      }
    });
  } catch (error) {
    console.error('Update hosted exam error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to update hosted exam') });
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

    const { data: hostedExams, error } = await supabase
      .from('hosted_assessments')
      .select(`
        id,
        duration_minutes,
        max_attempts,
        allow_resume,
        result_mode,
        publish_status,
        start_time,
        end_time,
        coding_section,
        class_id,
        section_id,
        zone,
        exam_title,
        template:template_id(id, title, subject, question_count, total_marks, passing_percentage)
      `)
      .in('publish_status', ['published', 'closed'])
      .order('created_at', { ascending: false });

    if (error && isMissingHostedTableError(error)) {
      return res.json({ exams: [], setupRequired: true });
    }

    if (error) throw error;

    const hostedExamList = hostedExams || [];
    const { map: targetMap } = await getStudentTargetMapForHostedExams(hostedExamList.map((exam) => exam.id));

    const filtered = hostedExamList.filter((exam) => {
      const targetedStudentIds = (targetMap[exam.id] || []).map((item) => item.student_id);
      return isExamAssignedToStudent(exam, studentDetail, req.user.id, targetedStudentIds);
    });
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
        title: exam.exam_title || exam.template?.title || 'Assessment',
        subject: exam.template?.subject || 'N/A',
        coding_section: normalizeCodingSection(exam.coding_section),
        attemptsUsed,
        remainingAttempts: Math.max(0, maxAttempts - attemptsUsed),
        hasInProgressAttempt: Boolean(inProgressAttempt),
        inProgressAttemptId: inProgressAttempt?.id || null,
        latestSubmittedAttempt: submittedAttempts[0] || null,
        canResume: inProgressAttempt ? exam.allow_resume !== false : false,
        canAttempt: inProgressAttempt ? (exam.allow_resume !== false) : attemptsUsed < maxAttempts
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
        allow_resume,
        duration_minutes,
        max_attempts,
        result_mode,
        publish_status,
        start_time,
        end_time,
        coding_section,
        exam_title,
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

    const { map: startTargetMap } = await getStudentTargetMapForHostedExams([hostedAssessmentId]);
    const targetedStudentIds = (startTargetMap[hostedAssessmentId] || []).map((item) => item.student_id);

    if (!isExamAssignedToStudent(hostedExam, studentDetail, req.user.id, targetedStudentIds)) {
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

    if (activeAttempt && hostedExam.allow_resume === false) {
      return res.status(400).json({
        error: 'Resume is disabled for this assessment by your teacher'
      });
    }

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
          answers: applyAttemptSectionState({}, { currentSection: 'mcq' }),
          total_questions: totalQuestions,
          total_marks: configuredTotalMarks
        })
        .select('*')
        .single();

      if (createError) throw createError;

      activeAttempt = createdAttempt;
    }

    const remainingSeconds = getRemainingSeconds(activeAttempt, hostedExam);
    const sectionState = getAttemptSectionState(activeAttempt.answers);
    const codingSectionForStudent = sanitizeCodingSectionForStudent(hostedExam.coding_section, sectionState);

    if (remainingSeconds <= 0) {
      return res.status(400).json({ error: 'This attempt has already timed out. Please submit it from the attempt page.' });
    }

    res.json({
      hostedAssessment: {
        id: hostedExam.id,
        title: hostedExam.exam_title || hostedExam.template?.title || 'Assessment',
        subject: hostedExam.template?.subject || 'N/A',
        instructions: hostedExam.instructions || '',
        allow_resume: hostedExam.allow_resume !== false,
        result_mode: hostedExam.result_mode,
        start_time: hostedExam.start_time,
        end_time: hostedExam.end_time,
        duration_minutes: hostedExam.duration_minutes,
        max_attempts: hostedExam.max_attempts,
        coding_section: codingSectionForStudent
      },
      attempt: {
        id: activeAttempt.id,
        attempt_number: activeAttempt.attempt_number,
        status: activeAttempt.status,
        started_at: activeAttempt.started_at,
        answers: activeAttempt.answers || {},
        current_section: sectionState.currentSection,
        section_completion_order: {
          mcq_completed_at: sectionState.mcqCompletedAt,
          coding_entered_at: sectionState.codingEnteredAt
        },
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
    const forceTakeover = String(req.query?.forceTakeover || '').toLowerCase() === 'true';
    const sessionToken = getExamSessionToken(req);

    const { data: attempt, error: attemptError } = await supabase
      .from('assessment_attempts')
      .select(`
        *,
        hosted:hosted_assessment_id(
          id,
          class_id,
          section_id,
          zone,
          allow_resume,
          duration_minutes,
          max_attempts,
          result_mode,
          publish_status,
          start_time,
          end_time,
          coding_section,
          exam_title,
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

    const sessionMeta = getAttemptSessionMeta(attempt.answers);
    const hasDifferentSession = Boolean(sessionMeta.token && sessionToken && sessionMeta.token !== sessionToken);

    if (hasDifferentSession && !forceTakeover) {
      return res.status(409).json(buildSessionConflictResponse(
        'This attempt is active in another browser session. Resume here to safely continue.',
        attempt.id
      ));
    }

    let resolvedAttempt = attempt;

    if (sessionToken && (!sessionMeta.token || forceTakeover)) {
      const { data: updatedAttempt, error: updateError } = await supabase
        .from('assessment_attempts')
        .update({
          answers: applyAttemptSessionMeta(attempt.answers, sessionToken)
        })
        .eq('id', attempt.id)
        .select('*')
        .single();

      if (updateError) throw updateError;

      // Preserve already-joined hosted/template data from the original fetch.
      // The update query selects only assessment_attempts columns.
      resolvedAttempt = {
        ...updatedAttempt,
        hosted: attempt.hosted
      };
    }

    const questions = normalizeQuestionList(resolvedAttempt.hosted?.template?.template_data);

    if (questions.length === 0) {
      return res.status(400).json({ error: 'Assessment questions are not configured' });
    }

    const remainingSeconds = getRemainingSeconds(resolvedAttempt, resolvedAttempt.hosted);
    const sectionState = getAttemptSectionState(resolvedAttempt.answers);
    const codingSectionForStudent = sanitizeCodingSectionForStudent(resolvedAttempt.hosted?.coding_section, sectionState);

    res.json({
      hostedAssessment: {
        id: resolvedAttempt.hosted?.id,
        title: resolvedAttempt.hosted?.exam_title || resolvedAttempt.hosted?.template?.title || 'Assessment',
        subject: resolvedAttempt.hosted?.template?.subject || 'N/A',
        instructions: resolvedAttempt.hosted?.instructions || '',
        allow_resume: resolvedAttempt.hosted?.allow_resume !== false,
        result_mode: resolvedAttempt.hosted?.result_mode,
        start_time: resolvedAttempt.hosted?.start_time,
        end_time: resolvedAttempt.hosted?.end_time,
        duration_minutes: resolvedAttempt.hosted?.duration_minutes,
        max_attempts: resolvedAttempt.hosted?.max_attempts,
        coding_section: codingSectionForStudent
      },
      attempt: {
        id: resolvedAttempt.id,
        attempt_number: resolvedAttempt.attempt_number,
        status: resolvedAttempt.status,
        started_at: resolvedAttempt.started_at,
        submitted_at: resolvedAttempt.submitted_at,
        answers: resolvedAttempt.answers || {},
        score: resolvedAttempt.score,
        total_marks: resolvedAttempt.total_marks,
        percentage: resolvedAttempt.percentage,
        correct_count: resolvedAttempt.correct_count,
        total_questions: resolvedAttempt.total_questions,
        current_section: sectionState.currentSection,
        section_completion_order: {
          mcq_completed_at: sectionState.mcqCompletedAt,
          coding_entered_at: sectionState.codingEnteredAt
        },
        remaining_seconds: remainingSeconds
      },
      questions: sanitizeQuestionsForStudent(questions)
    });
  } catch (error) {
    console.error('Get student attempt error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to fetch attempt details') });
  }
});

// Student: mark MCQ section complete and unlock coding section
router.post('/student/attempts/:attemptId/mark-mcq-complete', verifyToken, hasRole('student'), async (req, res) => {
  try {
    const { attemptId } = req.params;
    const sessionToken = getExamSessionToken(req);

    if (!sessionToken) {
      return res.status(400).json({ error: 'Session token is required for secure exam session' });
    }

    const { data: attempt, error: attemptError } = await supabase
      .from('assessment_attempts')
      .select(`
        *,
        hosted:hosted_assessment_id(
          id,
          duration_minutes,
          coding_section
        )
      `)
      .eq('id', attemptId)
      .eq('student_id', req.user.id)
      .single();

    if (attemptError || !attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    if (attempt.status !== 'in_progress') {
      return res.status(400).json({ error: 'Only in-progress attempts can transition sections' });
    }

    const codingSection = normalizeCodingSection(attempt.hosted?.coding_section);
    if (!codingSection) {
      return res.status(400).json({ error: 'Coding section is not enabled for this assessment' });
    }

    const activeSessionToken = getAttemptSessionMeta(attempt.answers).token;
    const hasDifferentSession = Boolean(activeSessionToken && activeSessionToken !== sessionToken);

    if (hasDifferentSession) {
      return res.status(409).json(buildSessionConflictResponse(
        'This attempt is active in another browser session. Resume here to safely continue.',
        attempt.id
      ));
    }

    const existingSectionState = getAttemptSectionState(attempt.answers);
    const nowIso = new Date().toISOString();
    const answersWithSection = applyAttemptSectionState(attempt.answers, {
      currentSection: 'coding',
      mcqCompletedAt: existingSectionState.mcqCompletedAt || nowIso,
      codingEnteredAt: existingSectionState.codingEnteredAt || nowIso
    });

    const nextAnswers = applyAttemptSessionMeta(answersWithSection, sessionToken);

    const { data: updatedAttempt, error: updateError } = await supabase
      .from('assessment_attempts')
      .update({
        answers: nextAnswers
      })
      .eq('id', attempt.id)
      .select('*')
      .single();

    if (updateError) {
      throw updateError;
    }

    const nextSectionState = getAttemptSectionState(updatedAttempt.answers);

    res.json({
      message: 'MCQ section marked complete. Coding section unlocked.',
      coding_section: sanitizeCodingSectionForStudent(codingSection, nextSectionState),
      attempt: {
        id: updatedAttempt.id,
        current_section: nextSectionState.currentSection,
        section_completion_order: {
          mcq_completed_at: nextSectionState.mcqCompletedAt,
          coding_entered_at: nextSectionState.codingEnteredAt
        }
      },
      remaining_seconds: getRemainingSeconds(updatedAttempt, attempt.hosted)
    });
  } catch (error) {
    console.error('Mark MCQ complete error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to unlock coding section') });
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
          coding_section,
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

    const mcqSummary = calculateAttemptSummary(
      questions,
      mergedAnswers,
      attempt.hosted?.template?.total_marks
    );

    const codingSummary = await calculateCodingSummary({
      codingSection: attempt.hosted?.coding_section,
      rawAnswers: mergedAnswers
    });

    const finalScore = roundToTwo(mcqSummary.score + codingSummary.score);
    const finalTotalMarks = roundToTwo(mcqSummary.totalMarks + codingSummary.totalMarks);
    const finalPercentage = finalTotalMarks > 0
      ? roundToTwo((finalScore / finalTotalMarks) * 100)
      : 0;
    const finalCorrectCount = mcqSummary.correctCount + codingSummary.passedQuestionCount;
    const finalTotalQuestions = mcqSummary.totalQuestions + codingSummary.totalQuestionCount;

    const metadataAnswers = Object.fromEntries(
      Object.entries(mergedAnswers).filter(([key]) => key.startsWith('__'))
    );
    const finalAnswers = {
      ...mcqSummary.normalizedAnswers,
      ...metadataAnswers
    };

    const codingSection = normalizeCodingSection(attempt.hosted?.coding_section);
    if (codingSection) {
      const nowIso = new Date().toISOString();
      const sectionState = getAttemptSectionState(finalAnswers);
      finalAnswers[ATTEMPT_SECTION_META_KEY] = {
        currentSection: 'coding',
        mcqCompletedAt: sectionState.mcqCompletedAt || nowIso,
        codingEnteredAt: sectionState.codingEnteredAt || nowIso
      };
    }

    const { data: updatedAttempt, error: updateError } = await supabase
      .from('assessment_attempts')
      .update({
        status: submittedStatus,
        answers: finalAnswers,
        score: finalScore,
        total_marks: finalTotalMarks,
        percentage: finalPercentage,
        correct_count: finalCorrectCount,
        total_questions: finalTotalQuestions,
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

// Student: autosave in-progress attempt answers
router.post('/student/attempts/:attemptId/autosave', verifyToken, hasRole('student'), async (req, res) => {
  try {
    const { attemptId } = req.params;
    const incomingAnswers = req.body?.answers;
    const incomingCodingSubmissions = req.body?.codingSubmissions;
    const sessionToken = getExamSessionToken(req);

    if (!sessionToken) {
      return res.status(400).json({ error: 'Session token is required for secure exam session' });
    }

    const { data: attempt, error: attemptError } = await supabase
      .from('assessment_attempts')
      .select(`
        *,
        hosted:hosted_assessment_id(
          id,
          duration_minutes,
          result_mode,
          publish_status,
          start_time,
          end_time,
          template:template_id(id, total_marks, template_data)
        )
      `)
      .eq('id', attemptId)
      .eq('student_id', req.user.id)
      .single();

    if (attemptError || !attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    if (attempt.status !== 'in_progress') {
      return res.status(400).json({ error: 'Only in-progress attempts can be autosaved' });
    }

    const activeSession = getAttemptSessionMeta(attempt.answers).token;
    const hasDifferentSession = Boolean(activeSession && activeSession !== sessionToken);

    if (hasDifferentSession) {
      return res.status(409).json(buildSessionConflictResponse(
        'This attempt is active in another browser session. Resume here to safely continue.',
        attempt.id
      ));
    }

    const safeIncoming = (incomingAnswers && typeof incomingAnswers === 'object') ? incomingAnswers : {};
    const safeCodingSubmissions = (
      incomingCodingSubmissions && typeof incomingCodingSubmissions === 'object'
    ) ? incomingCodingSubmissions : null;
    const mergedAnswers = {
      ...(attempt.answers && typeof attempt.answers === 'object' ? attempt.answers : {}),
      ...safeIncoming,
      ...(safeCodingSubmissions !== null ? { [CODING_SUBMISSIONS_META_KEY]: safeCodingSubmissions } : {})
    };

    const { data: updatedAttempt, error: updateError } = await supabase
      .from('assessment_attempts')
      .update({
        answers: applyAttemptSessionMeta(mergedAnswers, sessionToken)
      })
      .eq('id', attempt.id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    const remainingSeconds = getRemainingSeconds(updatedAttempt, attempt.hosted);

    res.json({
      message: 'Autosaved successfully',
      autosavedAt: updatedAttempt.updated_at,
      remaining_seconds: remainingSeconds,
      attempt: {
        id: updatedAttempt.id,
        status: updatedAttempt.status,
        updated_at: updatedAttempt.updated_at
      }
    });
  } catch (error) {
    console.error('Autosave student attempt error:', error);
    res.status(500).json({ error: getApiErrorMessage(error, 'Failed to autosave attempt') });
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
        exam_title,
        template:template_id(id, title, subject, question_count, total_marks, passing_percentage)
      `)
      .eq('publish_status', 'published')
      .order('created_at', { ascending: false });

    if (hostedError && isMissingHostedTableError(hostedError)) {
      return res.json({ results: [], setupRequired: true });
    }

    if (hostedError) throw hostedError;

    const hostedExamList = hostedExams || [];
    const { map: resultTargetMap } = await getStudentTargetMapForHostedExams(hostedExamList.map((exam) => exam.id));

    const scopedExams = hostedExamList.filter((exam) => {
      const targetedStudentIds = (resultTargetMap[exam.id] || []).map((item) => item.student_id);
      return isExamAssignedToStudent(exam, studentDetail, req.user.id, targetedStudentIds);
    });
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
        title: exam.exam_title || exam.template?.title || 'Assessment',
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
      .in('publish_status', ['published', 'closed']);

    if (error && isMissingHostedTableError(error)) {
      return res.json({ assigned: 0, inProgress: 0, upcoming: 0, completed: 0, setupRequired: true });
    }

    if (error) throw error;

    const now = new Date();

    const hostedExamList = hostedExams || [];
    const { map: metricTargetMap } = await getStudentTargetMapForHostedExams(hostedExamList.map((exam) => exam.id));

    const exams = hostedExamList.filter((exam) => {
      const targetedStudentIds = (metricTargetMap[exam.id] || []).map((item) => item.student_id);
      return isExamAssignedToStudent(exam, studentDetail, req.user.id, targetedStudentIds);
    });

    const publishedExams = exams.filter((exam) => exam.publish_status === 'published');

    const inProgress = publishedExams.filter((exam) => {
      if (!exam.start_time || !exam.end_time) return false;
      return new Date(exam.start_time) <= now && now <= new Date(exam.end_time);
    }).length;

    const upcoming = publishedExams.filter((exam) => {
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
