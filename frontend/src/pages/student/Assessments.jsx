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

  if (start && now < start) return 'upcoming';
  if (end && now > end) return 'ended';
  return 'live';
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

  const filteredExams = useMemo(() => {
    return exams.filter((exam) => {
      const status = getExamStatus(exam);
      const title = String(exam.template?.title || '').toLowerCase();
      const subject = String(exam.template?.subject || '').toLowerCase();
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
              className="w-full"
            />
            <div className="w-full lg:max-w-60">
              <label className="form-label">Status Filter</label>
              <div className="relative">
                <FiFilter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  className="form-select pl-9"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="all">All Statuses</option>
                  <option value="live">Live</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="ended">Ended</option>
                </select>
              </div>
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
                            <p className="font-medium text-slate-800">{exam.template?.title || 'Untitled Assessment'}</p>
                            <p className="text-xs text-slate-500">{exam.template?.subject || 'N/A'} • ID: {exam.id.slice(0, 8)}</p>
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
                            ) : exam.hasInProgressAttempt && exam.inProgressAttemptId ? (
                              <Button
                                variant="secondary"
                                className="px-3 py-1.5"
                                onClick={() => navigate(`/student/assessments/attempt/${exam.inProgressAttemptId}`)}
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
