import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiAlertTriangle, FiArrowLeft, FiCheckCircle, FiClipboard, FiClock, FiCode, FiLock, FiPlayCircle } from 'react-icons/fi';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { assessmentAPI } from '../../services/api';
import { getExamSessionToken } from '../../utils/examSession';

const formatDateTime = (value) => {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Invalid date';
  return parsed.toLocaleString();
};

const AssessmentInstructions = () => {
  const navigate = useNavigate();
  const { hostedAssessmentId } = useParams();

  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [exam, setExam] = useState(null);

  const isWindowOpen = useMemo(() => {
    if (!exam) return false;
    const now = new Date();
    const start = exam.start_time ? new Date(exam.start_time) : null;
    const end = exam.end_time ? new Date(exam.end_time) : null;

    if (start && now < start) return false;
    if (end && now > end) return false;
    return true;
  }, [exam]);

  useEffect(() => {
    const fetchExamInfo = async () => {
      try {
        setLoading(true);
        const response = await assessmentAPI.getStudentAvailable();
        const found = (response.data?.exams || []).find((item) => item.id === hostedAssessmentId);

        if (!found) {
          toast.error('Assessment not available for your profile');
          navigate('/student/assessments');
          return;
        }

        setExam(found);
      } catch (error) {
        toast.error(error.response?.data?.error || 'Failed to load assessment instructions');
        navigate('/student/assessments');
      } finally {
        setLoading(false);
      }
    };

    fetchExamInfo();
  }, [hostedAssessmentId, navigate]);

  const handleStart = async () => {
    if (!agreed) {
      toast.error('Please agree to the exam instructions to continue');
      return;
    }

    if (!isWindowOpen) {
      toast.error('This assessment is not open right now');
      return;
    }

    try {
      setStarting(true);
      const response = await assessmentAPI.startStudentAttempt(hostedAssessmentId, {
        sessionToken: getExamSessionToken()
      });
      const attemptId = response.data?.attempt?.id;

      if (!attemptId) {
        toast.error('Unable to initialize attempt');
        return;
      }

      navigate(`/student/assessments/attempt/${attemptId}`, {
        state: {
          shouldEnterFullscreen: true,
          attemptBootstrap: response.data
        }
      });
    } catch (error) {
      if (error.response?.data?.autoSubmittedAttempt) {
        toast.success('Your previous in-progress attempt was auto-submitted because resume is disabled.');
        navigate('/student/results');
        return;
      }

      if (error.response?.status === 409 && error.response?.data?.sessionConflict && error.response?.data?.attemptId) {
        toast.error(error.response?.data?.error || 'This exam is active in another session');
        navigate(`/student/assessments/attempt/${error.response.data.attemptId}`, {
          state: { autoTakeoverOnConflict: true }
        });
      } else {
        toast.error(error.response?.data?.error || 'Failed to start attempt');
      }
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="app-page">
          <Card>
            <Card.Body className="py-10 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="mt-3 text-sm text-slate-500">Loading instructions...</p>
            </Card.Body>
          </Card>
        </div>
      </Layout>
    );
  }

  if (!exam) return null;

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <button
              type="button"
              onClick={() => navigate('/student/assessments')}
              className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              <FiArrowLeft className="h-4 w-4" />
              Back to Assessments
            </button>
            <h1>Assessment Instructions</h1>
            <p>Read carefully before starting your attempt.</p>
          </div>
          <span className={`status-badge ${isWindowOpen ? 'success' : 'warning'}`}>
            {isWindowOpen ? 'Window Open' : 'Window Closed'}
          </span>
        </div>

        <Card>
          <Card.Body className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="surface-card-muted p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Assessment</p>
              <p className="mt-1 font-medium text-gray-800">{exam.title || exam.template?.title || 'Untitled'}</p>
            </div>
            <div className="surface-card-muted p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Subject</p>
              <p className="mt-1 font-medium text-gray-800">{exam.subject || exam.template?.subject || 'N/A'}</p>
            </div>
            <div className="surface-card-muted p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Duration</p>
              <p className="mt-1 font-medium text-gray-800">{exam.duration_minutes} minutes</p>
            </div>
            <div className="surface-card-muted p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Attempts</p>
              <p className="mt-1 font-medium text-gray-800">{Math.max(0, exam.remainingAttempts || 0)} remaining</p>
            </div>
            <div className="surface-card-muted p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Resume</p>
              <p className="mt-1 font-medium text-gray-800">{exam.allow_resume === false ? 'Not allowed' : 'Allowed'}</p>
            </div>
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <h2 className="section-title">Before You Start</h2>
          </Card.Header>
          <Card.Body>
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-start gap-2">
                <FiClock className="mt-0.5 h-4 w-4 text-slate-500" />
                <p>The timer starts immediately when you begin. Unsubmitted answers may be auto-submitted on timeout.</p>
              </div>
              <div className="flex items-start gap-2">
                <FiPlayCircle className="mt-0.5 h-4 w-4 text-slate-500" />
                <p>Once started, switch to full-screen and stay focused on the exam window.</p>
              </div>
              <div className="flex items-start gap-2">
                <FiLock className="mt-0.5 h-4 w-4 text-slate-500" />
                <p>
                  {exam.allow_resume === false
                    ? 'If you leave or reload after starting, the attempt may be auto-submitted using your latest saved answers because resume is disabled.'
                    : 'Leaving or reloading the page during attempt is discouraged and may interrupt your experience.'}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <FiClipboard className="mt-0.5 h-4 w-4 text-slate-500" />
                <p>Check your connection and read each question carefully before final submission.</p>
              </div>
            </div>

            {exam.instructions && (
              <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
                <p className="mb-1 font-medium">Teacher Instructions</p>
                <p>{exam.instructions}</p>
              </div>
            )}

            {exam.coding_section?.enabled && (
              <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">
                <p className="mb-1 inline-flex items-center gap-2 font-medium">
                  <FiCode className="h-4 w-4" />
                  Two-Set Assessment Flow
                </p>
                <p>Set 1: MCQ section</p>
                <p>Set 2: Coding section ({exam.coding_section.challenge_ids?.length || 0} challenge(s))</p>
                {Number(exam.coding_section.time_allocation_minutes || 0) > 0 && (
                  <p className="mt-1 text-xs text-indigo-700">Suggested coding time: {exam.coding_section.time_allocation_minutes} minutes</p>
                )}
                <p className="mt-2 text-xs text-indigo-700">After you submit MCQ, coding challenges will unlock in the same exam attempt.</p>
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p>Start: {formatDateTime(exam.start_time)}</p>
                <p>End: {formatDateTime(exam.end_time)}</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                <div className="flex items-start gap-2">
                  <FiAlertTriangle className="mt-0.5 h-4 w-4" />
                  <p>Your browser may ask permission for full-screen mode. Please allow it for exam integrity.</p>
                </div>
              </div>
            </div>

            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary"
              />
              <span className="text-sm text-slate-700">
                I have read all instructions and agree to follow the exam rules. I understand my attempt will run in full-screen mode until I submit.
              </span>
            </label>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => navigate('/student/assessments')}>Cancel</Button>
              <Button onClick={handleStart} disabled={starting || !agreed || !isWindowOpen}>
                <FiCheckCircle className="h-4 w-4" />
                {starting ? 'Starting...' : 'Agree & Start Assessment'}
              </Button>
            </div>
          </Card.Body>
        </Card>
      </div>
    </Layout>
  );
};

export default AssessmentInstructions;
