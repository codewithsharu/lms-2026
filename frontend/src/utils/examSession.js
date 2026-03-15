const EXAM_SESSION_STORAGE_KEY = 'exam_secure_session_token';

const createSessionToken = () => {
  const randomA = Math.random().toString(36).slice(2);
  const randomB = Math.random().toString(36).slice(2);
  return `exam-${Date.now()}-${randomA}${randomB}`;
};

export const getExamSessionToken = () => {
  const existing = localStorage.getItem(EXAM_SESSION_STORAGE_KEY);
  if (existing) return existing;

  const generated = createSessionToken();
  localStorage.setItem(EXAM_SESSION_STORAGE_KEY, generated);
  return generated;
};

export const rotateExamSessionToken = () => {
  const generated = createSessionToken();
  localStorage.setItem(EXAM_SESSION_STORAGE_KEY, generated);
  return generated;
};
