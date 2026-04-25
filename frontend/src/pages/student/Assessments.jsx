import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiClock, FiFilter, FiPlayCircle, FiSearch } from 'react-icons/fi';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import InputField from '../../components/ui/InputField';
import StatCard from '../../components/ui/StatCard';
import Button from '../../components/ui/Button';
import { assessmentAPI } from '../../services/api';

const formatDateTime = (value) => {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Invalid date';
  return parsed.toLocaleString();
};

const getExamStatus = (exam) => {
  const now = new Date();
  const start = exam.start_time ? new Date(exam.start_time) : null;
  const end = exam.end_time ? new Date(exam.end_time) : null;

  if (exam.publish_status === 'closed') return 'ended';

  if (start && Number.isNaN(start.getTime())) return 'upcoming';
  if (end && Number.isNaN(end.getTime())) return 'ended';

  if (start && now < start) return 'upcoming';
  if (end && now > end) return 'ended';

  if (start && end) return 'live';
  if (start && !end) return now >= start ? 'live' : 'upcoming';
  if (!start && end) return now <= end ? 'live' : 'ended';

  return 'upcoming';
};

const statusBadgeClass = {
  live: 'success',
  upcoming: 'info',
  ended: 'warning'
};

const StudentAssessments = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchExams = async () => {
    try {
      setLoading(true);
      const response = await assessmentAPI.getStudentAvailable();
      setExams(response.data?.exams || []);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load assessments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExams();
  }, []);

  const counts = useMemo(() => {
    const live = exams.filter((exam) => getExamStatus(exam) === 'live').length;
    const upcoming = exams.filter((exam) => getExamStatus(exam) === 'upcoming').length;
    const ended = exams.filter((exam) => getExamStatus(exam) === 'ended').length;

    return {
      total: exams.length,
      live,
      upcoming,
      ended
    };
  }, [exams]);

  const statusOptions = useMemo(() => ([
    { value: 'all', label: 'All', count: counts.total },
    { value: 'live', label: 'Live', count: counts.live },
    { value: 'upcoming', label: 'Upcoming', count: counts.upcoming },
    { value: 'ended', label: 'Ended', count: counts.ended }
  ]), [counts]);

  const filteredExams = useMemo(() => {
    return exams.filter((exam) => {
      const status = getExamStatus(exam);
      const title = String(exam.title || exam.template?.title || '').toLowerCase();
      const subject = String(exam.subject || exam.template?.subject || '').toLowerCase();
      const keyword = searchTerm.trim().toLowerCase();

      const statusMatch = statusFilter === 'all' || status === statusFilter;
      const searchMatch = !keyword || title.includes(keyword) || subject.includes(keyword);

      return statusMatch && searchMatch;
    });
  }, [exams, statusFilter, searchTerm]);

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header">
          <h1>Student Assessments</h1>
          <p>View all assigned assessments, track live windows, and check what is upcoming.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={FiPlayCircle} label="Total Assigned" value={loading ? '...' : counts.total} iconColorClass="bg-primary" />
          <StatCard icon={FiPlayCircle} label="Live Now" value={loading ? '...' : counts.live} iconColorClass="bg-success" />
          <StatCard icon={FiClock} label="Upcoming" value={loading ? '...' : counts.upcoming} iconColorClass="bg-slate-500" />
          <StatCard icon={FiClock} label="Ended" value={loading ? '...' : counts.ended} iconColorClass="bg-slate-700" />
        </div>

        <Card>
          <Card.Body className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <InputField
              label="Search Assessments"
              leftIcon={FiSearch}
              placeholder="Search by title or subject"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full lg:flex-1"
            />
            <div className="w-full md:hidden">
              <label className="form-label">Status Filter</label>
              <div className="relative">
                <FiFilter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  className="form-select pl-9"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} ({loading ? '...' : option.count})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="hidden md:flex flex-wrap items-center gap-2">
              {statusOptions.map((option) => {
                const isActive = statusFilter === option.value;
                const countLabel = loading ? '...' : option.count;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatusFilter(option.value)}
                    aria-pressed={isActive}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span>{option.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                    }`}
                    >
                      {countLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <h2 className="section-title">Assessment List</h2>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, index) => (
                  <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : filteredExams.length > 0 ? (
              <div className="table-shell overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Assessment</th>
                      <th>Status</th>
                      <th>Duration</th>
                      <th>Exam Window</th>
                      <th>Attempts</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExams.map((exam) => {
                      const status = getExamStatus(exam);

                      return (
                        <tr key={exam.id}>
                          <td>
                            <p className="font-medium text-slate-800">{exam.title || exam.template?.title || 'Untitled Assessment'}</p>
                            <p className="text-xs text-slate-500">{exam.subject || exam.template?.subject || 'N/A'} • ID: {exam.id.slice(0, 8)}</p>
                          </td>
                          <td>
                            <span className={`status-badge ${statusBadgeClass[status] || 'info'}`}>
                              {status}
                            </span>
                          </td>
                          <td>{exam.duration_minutes} min</td>
                          <td>
                            <p className="text-xs text-slate-600">Start: {formatDateTime(exam.start_time)}</p>
                            <p className="text-xs text-slate-500">End: {formatDateTime(exam.end_time)}</p>
                          </td>
                          <td>
                            <p className="text-sm text-slate-700">
                              {exam.attemptsUsed || 0}/{exam.max_attempts}
                            </p>
                            <p className="text-xs text-slate-500">
                              {Math.max(0, exam.remainingAttempts || 0)} left
                            </p>
                          </td>
                          <td className="text-center">
                            {status === 'upcoming' ? (
                              <span className="status-badge info">Starts soon</span>
                            ) : status === 'ended' ? (
                              <span className="status-badge warning">Window closed</span>
                            ) : exam.hasInProgressAttempt && exam.allow_resume === false ? (
                              <span className="status-badge warning">Resume disabled</span>
                            ) : exam.hasInProgressAttempt && exam.inProgressAttemptId ? (
                              <Button
                                variant="secondary"
                                className="px-3 py-1.5"
                                onClick={() => navigate(
                                  `/student/assessments/attempt/${exam.inProgressAttemptId}`,
                                  { state: { autoTakeoverOnConflict: true } }
                                )}
                              >
                                Resume
                              </Button>
                            ) : exam.canAttempt ? (
                              <Button
                                className="px-3 py-1.5"
                                onClick={() => navigate(`/student/assessments/${exam.id}/instructions`)}
                              >
                                Start
                              </Button>
                            ) : (
                              <span className="status-badge error">No attempts left</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-10 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-primary">
                  <FiPlayCircle className="h-7 w-7" />
                </div>
                <h3 className="text-base font-medium text-slate-800">No matching assessments</h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                  Try changing your search keyword or status filter to view assigned assessments.
                </p>
              </div>
            )}
          </Card.Body>
        </Card>
      </div>
    </Layout>
  );
};

export default StudentAssessments;
