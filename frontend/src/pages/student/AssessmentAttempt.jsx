import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiAlertTriangle, FiCheckCircle, FiClock, FiFlag, FiLock, FiSend, FiShield, FiTarget } from 'react-icons/fi';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Modal from '../../components/ui/Modal';
import { assessmentAPI } from '../../services/api';
import { getExamSessionToken } from '../../utils/examSession';

const formatTimer = (seconds) => {
  const safe = Math.max(0, Number(seconds || 0));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

const normalizeAnswerForQuestion = (question, rawAnswer) => {
  if (question.type === 'blank') {
    return String(rawAnswer || '');
  }

  if (question.answerMode === 'multiple') {
    return Array.isArray(rawAnswer) ? rawAnswer : [];
  }

  return Number.isInteger(rawAnswer) ? rawAnswer : null;
};

const getDefaultAnswerForQuestion = (question) => {
  if (!question) return null;
  if (question.type === 'blank') return '';
  if (question.answerMode === 'multiple') return [];
  return null;
};

const hasAnswerValue = (question, value) => {
  if (!question) return false;
  if (question.type === 'blank') return String(value || '').trim().length > 0;
  if (question.answerMode === 'multiple') return Array.isArray(value) && value.length > 0;
  return Number.isInteger(value);
};

const AssessmentAttempt = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { attemptId } = useParams();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [attemptData, setAttemptData] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [savedResponses, setSavedResponses] = useState({});
  const [markedForReview, setMarkedForReview] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [submittedSummary, setSubmittedSummary] = useState(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showFullscreenLock, setShowFullscreenLock] = useState(false);
  const [sessionConflict, setSessionConflict] = useState(null);
  const [resumingHere, setResumingHere] = useState(false);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState(null);

  const hasAutoSubmittedRef = useRef(false);
  const sessionTokenRef = useRef(getExamSessionToken());
  const skipNextAutosaveRef = useRef(true);
  const hasBootstrapAttemptRef = useRef(false);

  const buildAutosavePayload = (questionList, currentAnswers, currentSaved, currentMarked) => {
    const payload = {};

    questionList.forEach((question) => {
      const key = String(question.index);
      payload[key] = currentAnswers[key] ?? getDefaultAnswerForQuestion(question);
    });

    payload.__uiSavedResponses = currentSaved;
    payload.__uiMarkedForReview = currentMarked;

    return payload;
  };

  const hydrateAttemptState = (payload) => {
    const attempt = payload?.attempt;
    const hostedAssessment = payload?.hostedAssessment;
    const questionList = Array.isArray(payload?.questions) ? payload.questions : [];

    if (!attempt || !hostedAssessment || questionList.length === 0) {
      return false;
    }

    setAttemptData({ attempt, hostedAssessment });
    setQuestions(questionList);

    const initialAnswers = {};
    const initialSaved = {};
    const persistedSaved = attempt.answers?.__uiSavedResponses;
    const persistedMarked = attempt.answers?.__uiMarkedForReview;

    questionList.forEach((question) => {
      const key = String(question.index);
      const normalized = normalizeAnswerForQuestion(question, attempt.answers?.[key]);
      initialAnswers[key] = normalized;
      initialSaved[key] = typeof persistedSaved?.[key] === 'boolean'
        ? persistedSaved[key]
        : hasAnswerValue(question, normalized);
    });

    setAnswers(initialAnswers);
    setSavedResponses(initialSaved);
    setMarkedForReview(
      persistedMarked && typeof persistedMarked === 'object'
        ? persistedMarked
        : {}
    );
    setTimeLeft(Number(attempt.remaining_seconds || 0));
    skipNextAutosaveRef.current = true;

    if (attempt.status === 'submitted' || attempt.status === 'auto_submitted') {
      setSubmittedSummary({
        status: attempt.status,
        score: attempt.score,
        total_marks: attempt.total_marks,
        percentage: attempt.percentage,
        correct_count: attempt.correct_count,
        total_questions: attempt.total_questions,
        resultVisible: true,
        resultMode: hostedAssessment.result_mode
      });
    }

    return true;
  };

  const loadAttempt = async ({ forceTakeover = false, silent = false } = {}) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      setSessionConflict(null);
      const response = await assessmentAPI.getStudentAttempt(attemptId, {
        sessionToken: sessionTokenRef.current,
        forceTakeover
      });

      if (!hydrateAttemptState(response.data)) {
        toast.error('Attempt data not available');
        if (!hasBootstrapAttemptRef.current) {
          navigate('/student/assessments');
        }
        return;
      }
    } catch (error) {
      if (error.response?.status === 409 && error.response?.data?.sessionConflict) {
        setShowSubmitModal(false);
        setSessionConflict({
          message: error.response?.data?.error || 'This attempt is active in another session.',
          attemptId: error.response?.data?.attemptId || attemptId
        });
        return;
      }

      const fallbackMessage = error.response?.data?.error || 'Failed to load attempt';

      if (!hasBootstrapAttemptRef.current) {
        toast.error(fallbackMessage);
        navigate('/student/assessments');
      } else {
        console.error('Attempt refresh failed, using bootstrap payload:', fallbackMessage);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const bootstrapPayload = location.state?.attemptBootstrap;

    if (hydrateAttemptState(bootstrapPayload)) {
      hasBootstrapAttemptRef.current = true;
      setLoading(false);
      loadAttempt({ silent: true });
      return;
    }

    hasBootstrapAttemptRef.current = false;
    loadAttempt();
  }, [attemptId]);

  useEffect(() => {
    const onFullScreenChange = () => {
      const fullscreenActive = Boolean(document.fullscreenElement);
      setIsFullscreen(fullscreenActive);

      if (!fullscreenActive && !submittedSummary && attemptData) {
        setShowFullscreenLock(true);
        document.documentElement.requestFullscreen().catch(() => {
          setShowFullscreenLock(true);
        });
      }

      if (fullscreenActive) {
        setShowFullscreenLock(false);
      }
    };

    document.addEventListener('fullscreenchange', onFullScreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullScreenChange);
  }, [submittedSummary, attemptData]);

  useEffect(() => {
    if (!attemptData || submittedSummary) return;

    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {
        setShowFullscreenLock(true);
      });
    }
  }, [attemptData, submittedSummary, location.state]);

  useEffect(() => {
    if (!attemptData || submittedSummary) return;

    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [attemptData, submittedSummary]);

  useEffect(() => {
    if (!attemptData || submittedSummary) return;

    if (timeLeft <= 0) {
      if (!hasAutoSubmittedRef.current) {
        hasAutoSubmittedRef.current = true;
        handleSubmit(true);
      }
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft, attemptData, submittedSummary]);

  useEffect(() => {
    if (!attemptData || submittedSummary) return;
    if (!attemptData?.attempt?.id) return;

    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }

    const timer = setTimeout(async () => {
      try {
        await assessmentAPI.autosaveStudentAttempt(
          attemptData.attempt.id,
          {
            answers: buildAutosavePayload(questions, answers, savedResponses, markedForReview)
          },
          {
            sessionToken: sessionTokenRef.current
          }
        );

        setLastAutoSavedAt(new Date());
      } catch (error) {
        if (error.response?.status === 409 && error.response?.data?.sessionConflict) {
          setSessionConflict({
            message: error.response?.data?.error || 'This attempt is active in another session.',
            attemptId: error.response?.data?.attemptId || attemptId
          });
          return;
        }

        console.error('Autosave failed:', error);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [answers, savedResponses, markedForReview, attemptData, submittedSummary, questions, attemptId]);

  const answeredCount = useMemo(() => {
    return questions.filter((question) => Boolean(savedResponses[String(question.index)])).length;
  }, [questions, savedResponses]);

  const markedCount = useMemo(() => {
    return questions.filter((question) => Boolean(markedForReview[String(question.index)])).length;
  }, [questions, markedForReview]);

  const unansweredCount = useMemo(() => Math.max(0, questions.length - answeredCount), [questions.length, answeredCount]);

  const currentQuestion = questions[currentIndex] || null;

  const setSingleChoice = (questionIndex, optionIndex) => {
    const key = String(questionIndex);
    setAnswers((prev) => ({ ...prev, [key]: optionIndex }));
    setSavedResponses((prev) => ({ ...prev, [key]: true }));
  };

  const toggleMultipleChoice = (questionIndex, optionIndex) => {
    const key = String(questionIndex);

    setAnswers((prev) => {
      const existing = Array.isArray(prev[key]) ? prev[key] : [];
      const selected = new Set(existing);

      if (selected.has(optionIndex)) selected.delete(optionIndex);
      else selected.add(optionIndex);

      const nextSelection = Array.from(selected).sort((a, b) => a - b);
      setSavedResponses((savedPrev) => ({ ...savedPrev, [key]: nextSelection.length > 0 }));

      return {
        ...prev,
        [key]: nextSelection
      };
    });
  };

  const setBlankAnswer = (questionIndex, value) => {
    const key = String(questionIndex);
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setSavedResponses((prev) => ({ ...prev, [key]: String(value || '').trim().length > 0 }));
  };

  const handleSubmit = async (forceAutoSubmit = false) => {
    if (!attemptData || submitting || submittedSummary) return;

    try {
      setSubmitting(true);
      const response = await assessmentAPI.submitStudentAttempt(attemptId, {
        answers,
        forceAutoSubmit
      }, {
        sessionToken: sessionTokenRef.current
      });

      const attempt = response.data?.attempt;
      setSubmittedSummary({
        ...attempt,
        resultVisible: Boolean(response.data?.resultVisible),
        resultMode: response.data?.resultMode
      });

      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }

      toast.success(forceAutoSubmit ? 'Time is up. Attempt auto-submitted.' : 'Assessment submitted successfully');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to submit assessment');
    } finally {
      setSubmitting(false);
    }
  };

  const reEnterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      setIsFullscreen(true);
      setShowFullscreenLock(false);
    } catch {
      setShowFullscreenLock(true);
    }
  };

  const confirmSubmitFromModal = async () => {
    setShowSubmitModal(false);
    await handleSubmit(false);
  };

  const handleSessionTakeover = async () => {
    try {
      setResumingHere(true);
      await loadAttempt({ forceTakeover: true });
      toast.success('Session moved to this browser safely.');
    } finally {
      setResumingHere(false);
    }
  };

  const clearCurrentResponse = () => {
    if (!currentQuestion) return;
    const key = String(currentQuestion.index);
    setAnswers((prev) => ({
      ...prev,
      [key]: getDefaultAnswerForQuestion(currentQuestion)
    }));
    setSavedResponses((prev) => ({ ...prev, [key]: false }));
  };

  const toggleReviewForCurrent = () => {
    if (!currentQuestion) return;
    const key = String(currentQuestion.index);
    setMarkedForReview((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const saveAndNext = () => {
    if (!currentQuestion) return;

    const key = String(currentQuestion.index);
    const currentValue = answers[key];
    const hasValue = hasAnswerValue(currentQuestion, currentValue);

    setSavedResponses((prev) => ({
      ...prev,
      [key]: hasValue
    }));

    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1));
    } else {
      toast.success(hasValue ? 'Answer saved for current question' : 'No answer selected for current question');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8">
        <Card className="mx-auto max-w-3xl">
          <Card.Body className="py-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="mt-3 text-sm text-slate-500">Loading assessment attempt...</p>
          </Card.Body>
        </Card>
      </div>
    );
  }

  if (!attemptData) return null;

  if (submittedSummary) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8">
        <Card className="mx-auto max-w-3xl">
          <Card.Header>
            <h2 className="section-title">Assessment Submitted</h2>
          </Card.Header>
          <Card.Body className="space-y-4">
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              <div className="flex items-start gap-2">
                <FiCheckCircle className="mt-0.5 h-4 w-4" />
                <p>
                  Your attempt has been submitted successfully ({submittedSummary.status === 'auto_submitted' ? 'auto-submitted on timeout' : 'manual submission'}).
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Score</p>
                <p className="mt-1 text-lg font-semibold text-slate-800">
                  {submittedSummary.resultVisible ? `${submittedSummary.score ?? 0} / ${submittedSummary.total_marks ?? 0}` : 'Hidden'}
                </p>
              </div>
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Percentage</p>
                <p className="mt-1 text-lg font-semibold text-slate-800">
                  {submittedSummary.resultVisible ? `${submittedSummary.percentage ?? 0}%` : 'Hidden'}
                </p>
              </div>
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Correct</p>
                <p className="mt-1 text-lg font-semibold text-slate-800">
                  {submittedSummary.resultVisible ? `${submittedSummary.correct_count ?? 0} / ${submittedSummary.total_questions ?? 0}` : 'Hidden'}
                </p>
              </div>
            </div>

            {!submittedSummary.resultVisible && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                Result mode is <span className="font-medium capitalize">{String(submittedSummary.resultMode || '').replace('_', ' ') || 'restricted'}</span>. Your teacher controls when marks are visible.
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => navigate('/student/assessments')}>Back to Assessments</Button>
              <Button onClick={() => navigate('/student/results')}>Go to Results</Button>
            </div>
          </Card.Body>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-100 p-2 pb-28 sm:p-3 sm:pb-32 lg:p-4 lg:pb-32">
      <div className="flex w-full flex-col gap-3">
        <div className="sticky top-2 z-20 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 lg:text-xl">{attemptData.hostedAssessment.title}</h1>
              <p className="text-sm text-slate-500">{attemptData.hostedAssessment.subject} • Attempt {attemptData.attempt.attempt_number}</p>
              {lastAutoSavedAt && (
                <p className="mt-1 text-xs text-slate-500">
                  Autosaved at {lastAutoSavedAt.toLocaleTimeString()}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 lg:max-w-[70%]">
              <span className="status-badge info">Answered: {answeredCount}/{questions.length}</span>
              <span className="status-badge warning">Review: {markedCount}</span>
              <span className={`status-badge ${timeLeft <= 60 ? 'error' : 'warning'}`}>
                <FiClock className="mr-1 h-3.5 w-3.5" />
                {formatTimer(timeLeft)}
              </span>
              <span className={`status-badge ${isFullscreen ? 'success' : 'error'}`}>
                <FiLock className="mr-1 h-3.5 w-3.5" />
                {isFullscreen ? 'Fullscreen Locked' : 'Fullscreen Required'}
              </span>
              <Button
                onClick={() => setShowSubmitModal(true)}
                disabled={submitting}
                className="px-6 py-2.5 shadow-md"
              >
                <FiCheckCircle className="h-4 w-4" />
                {submitting ? 'Submitting...' : 'Finalize & Submit'}
              </Button>
            </div>
          </div>

        </div>

        {!isFullscreen && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <div className="flex items-start gap-2">
              <FiLock className="mt-0.5 h-4 w-4" />
              <p>Fullscreen is mandatory during the assessment. Re-entering fullscreen automatically.</p>
            </div>
          </div>
        )}

        <div className="grid min-h-[calc(100vh-190px)] grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="order-2 flex h-full min-h-105 flex-col lg:order-2">
            <Card.Header>
              <div className="flex items-center justify-between">
                <h2 className="section-title text-base">Questions</h2>
                <span className="text-xs text-slate-500">{answeredCount}/{questions.length}</span>
              </div>
            </Card.Header>
            <Card.Body className="hide-scrollbar flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
              {questions.map((question, index) => {
                const key = String(question.index);
                const isSaved = Boolean(savedResponses[key]);
                const isMarked = Boolean(markedForReview[key]);

                return (
                  <button
                    key={question.index}
                    type="button"
                    onClick={() => setCurrentIndex(index)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                      currentIndex === index
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : isMarked
                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="font-medium">Q{index + 1}</span>
                    <span className="flex items-center gap-1.5">
                      {isMarked && <FiFlag className="h-4 w-4 text-amber-600" />}
                      {isSaved ? <FiCheckCircle className="h-4 w-4 text-green-600" /> : <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />}
                    </span>
                  </button>
                );
              })}
              </div>
            </Card.Body>
          </Card>

          <Card className="order-1 flex h-full min-h-105 flex-col lg:order-1">
            <Card.Header>
              <div className="flex items-center justify-between gap-3">
                <h2 className="section-title text-base">Question {currentIndex + 1} of {questions.length}</h2>
                <span className="text-xs text-slate-500 capitalize">{currentQuestion?.type} {currentQuestion?.answerMode === 'multiple' ? '(multiple correct)' : ''}</span>
              </div>
            </Card.Header>
            <Card.Body className="hide-scrollbar flex-1 overflow-y-auto">
              {currentQuestion ? (
                <div className="space-y-5">
                  <p className="text-lg font-medium leading-relaxed text-slate-800">{currentQuestion.question}</p>

                  {currentQuestion.type === 'blank' ? (
                    <input
                      type="text"
                      className="form-input text-base"
                      placeholder="Type your answer"
                      value={String(answers[String(currentQuestion.index)] || '')}
                      onChange={(event) => setBlankAnswer(currentQuestion.index, event.target.value)}
                    />
                  ) : (
                    <div className="space-y-3">
                      {currentQuestion.options.map((option, optionIndex) => {
                        const key = String(currentQuestion.index);
                        const value = answers[key];
                        const selected = currentQuestion.answerMode === 'multiple'
                          ? (Array.isArray(value) && value.includes(optionIndex))
                          : (Number.isInteger(value) && value === optionIndex);

                        return (
                          <button
                            key={`${currentQuestion.index}-${optionIndex}`}
                            type="button"
                            onClick={() => {
                              if (currentQuestion.answerMode === 'multiple') {
                                toggleMultipleChoice(currentQuestion.index, optionIndex);
                              } else {
                                setSingleChoice(currentQuestion.index, optionIndex);
                              }
                            }}
                            className={`w-full rounded-xl border p-3.5 text-left text-[15px] transition-colors ${
                              selected
                                ? 'border-blue-300 bg-blue-50 text-blue-800'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <span className="font-medium">{String.fromCharCode(65 + optionIndex)}.</span> {option}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-2 text-xs text-slate-500">
                    Use the bottom exam action dock for navigation and answer controls.
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <div className="flex items-start gap-2">
                    <FiAlertTriangle className="mt-0.5 h-4 w-4" />
                    <p>No question found. Please refresh and try again.</p>
                  </div>
                </div>
              )}
            </Card.Body>
          </Card>
        </div>

        <div className="fixed bottom-3 left-2 right-2 z-30 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:left-3 sm:right-3 lg:left-4 lg:right-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <FiShield className="h-4 w-4 text-blue-600" />
              <span>Exam actions are pinned here for quick access.</span>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <Button
                onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                disabled={currentIndex === 0}
              >
                Previous
              </Button>
              <Button variant="danger" onClick={clearCurrentResponse}>
                Clear Response
              </Button>
              <Button
                variant="secondary"
                onClick={toggleReviewForCurrent}
                className={currentQuestion && markedForReview[String(currentQuestion.index)] ? 'border-amber-300 bg-amber-50 text-amber-700' : ''}
              >
                <FiFlag className="h-4 w-4" />
                {currentQuestion && markedForReview[String(currentQuestion.index)] ? 'Marked for Review' : 'Mark for Review'}
              </Button>
              <Button
                variant="success"
                onClick={saveAndNext}
                disabled={!currentQuestion}
                className="px-5"
              >
                {currentIndex >= questions.length - 1 ? 'Save' : 'Save & Next'}
              </Button>
            </div>
          </div>
        </div>

        <Modal
          open={Boolean(sessionConflict)}
          onClose={() => navigate('/student/assessments')}
          title="Resume Here Safely"
          subtitle="Another browser session is active for this attempt"
          maxWidth="max-w-xl"
          footer={(
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => navigate('/student/assessments')}>
                Back
              </Button>
              <Button onClick={handleSessionTakeover} disabled={resumingHere}>
                <FiLock className="h-4 w-4" />
                {resumingHere ? 'Resuming Here...' : 'Resume Here & Logout Other Session'}
              </Button>
            </div>
          )}
        >
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            {sessionConflict?.message || 'This attempt is active in another browser session.'}
          </div>
          <p className="mt-3 text-sm text-slate-600">
            To prevent conflicts, only one active session can write answers. Continuing here will safely end access from the other browser.
          </p>
        </Modal>

        <Modal
          open={showSubmitModal}
          onClose={() => setShowSubmitModal(false)}
          title="Confirm Submission"
          subtitle="Review your attempt summary before final submit"
          maxWidth="max-w-2xl"
          footer={(
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowSubmitModal(false)}>
                Continue Attempt
              </Button>
              <Button onClick={confirmSubmitFromModal} disabled={submitting} className="px-5 shadow-sm">
                <FiCheckCircle className="h-4 w-4" />
                {submitting ? 'Submitting...' : 'Confirm Final Submit'}
              </Button>
            </div>
          )}
        >
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <div className="flex items-start gap-3">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-blue-700">
                <FiShield className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-blue-900">Final Exam Review</p>
                <p className="mt-1 text-sm text-blue-800">Check your summary carefully before final submission.</p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="surface-card-muted p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total Questions</p>
              <p className="mt-1 text-lg font-semibold text-slate-800">{questions.length}</p>
            </div>
            <div className="surface-card-muted p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Attempted (Saved)</p>
              <p className="mt-1 text-lg font-semibold text-slate-800">{answeredCount}</p>
            </div>
            <div className="surface-card-muted p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Unanswered</p>
              <p className="mt-1 text-lg font-semibold text-slate-800">{unansweredCount}</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <div className="flex items-start gap-2">
                <FiFlag className="mt-0.5 h-4 w-4" />
                <p>Marked for review: <span className="font-semibold">{markedCount}</span></p>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <div className="flex items-start gap-2">
                <FiTarget className="mt-0.5 h-4 w-4" />
                <p>Completion status: <span className="font-semibold">{Math.round((answeredCount / Math.max(1, questions.length)) * 100)}%</span></p>
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            After submission, you cannot edit your answers. Fullscreen lock will be released only after submit.
          </div>
        </Modal>

        {showFullscreenLock && !submittedSummary && (
          <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-950/70 p-4">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <FiLock className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Fullscreen Required</h3>
              <p className="mt-2 text-sm text-slate-600">
                This assessment must stay in fullscreen mode. Fullscreen will be re-enabled to continue. You can exit only after submission.
              </p>
              <div className="mt-5 flex justify-end">
                <Button onClick={reEnterFullscreen}>Continue Exam</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AssessmentAttempt;
