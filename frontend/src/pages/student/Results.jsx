import { useEffect, useMemo, useState } from 'react';
import { FiBarChart2, FiCheckCircle, FiClock, FiEye } from 'react-icons/fi';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import StatCard from '../../components/ui/StatCard';
import { assessmentAPI } from '../../services/api';

const formatScoreLine = (attempt) => {
  if (!attempt) return '';

  const score = Number(attempt.score ?? 0);
  const total = Number(attempt.total_marks ?? 0);
  const percentage = Number(attempt.percentage ?? 0);

  return `${score} / ${total}${Number.isFinite(percentage) ? ` (${percentage}%)` : ''}`;
};

const formatDateTime = (value) => {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Invalid date';
  return parsed.toLocaleString();
};

const formatShortDate = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleString();
};

const getVisibilityDetails = (item) => {
  if (item.resultVisible) {
    return {
      label: 'Visible',
      className: 'success',
      helper: 'Scores are released.'
    };
  }

  if (item.result_mode === 'manual') {
    return {
      label: 'Pending Manual Release',
      className: 'info',
      helper: 'Teacher will publish results.'
    };
  }

  return {
    label: 'Pending Until End',
    className: 'warning',
    helper: item.end_time ? `Opens after ${formatDateTime(item.end_time)}` : 'Opens after the exam window closes.'
  };
};

const StudentResults = () => {
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState([]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await assessmentAPI.getStudentResults();
      setResults(response.data?.results || []);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load results');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const resultSummary = useMemo(() => {
    const visible = results.filter((item) => item.resultVisible).length;
    const pending = results.filter((item) => !item.resultVisible && item.result_mode === 'after_end').length;
    const manual = results.filter((item) => item.result_mode === 'manual').length;
    const attempted = results.filter((item) => Boolean(item.latestAttempt)).length;

    return {
      visible,
      pending,
      manual,
      attempted
    };
  }, [results]);

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header">
          <h1>Student Results</h1>
          <p>Track result visibility for your assessments based on each teacher’s publish policy.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={FiBarChart2} label="Attempted Exams" value={loading ? '...' : resultSummary.attempted} iconColorClass="bg-primary" />
          <StatCard icon={FiEye} label="Visible Results" value={loading ? '...' : resultSummary.visible} iconColorClass="bg-success" />
          <StatCard icon={FiClock} label="Pending Results" value={loading ? '...' : resultSummary.pending} iconColorClass="bg-warning" />
          <StatCard icon={FiCheckCircle} label="Manual Release" value={loading ? '...' : resultSummary.manual} iconColorClass="bg-slate-700" />
        </div>

        <Card>
          <Card.Header>
            <h2 className="section-title">Result Availability</h2>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, index) => (
                  <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : results.length > 0 ? (
              <div className="table-shell overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Assessment</th>
                      <th>Attempts</th>
                      <th>Result Mode</th>
                      <th>Visibility</th>
                      <th>Latest Score</th>
                      <th>Best Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((item) => {
                      const visibility = getVisibilityDetails(item);

                      return (
                        <tr key={item.examId}>
                          <td>
                            <p className="font-medium text-slate-800">{item.title || 'Untitled Assessment'}</p>
                            <p className="text-xs text-slate-500">{item.subject || 'N/A'} • ID: {item.examId.slice(0, 8)}</p>
                          </td>
                          <td>
                            <p className="text-sm text-slate-700">{item.attemptsUsed || 0}</p>
                          </td>
                          <td className="capitalize">{String(item.result_mode || 'N/A').replace('_', ' ')}</td>
                          <td>
                            <span className={`status-badge ${visibility.className}`}>{visibility.label}</span>
                            {visibility.helper && <p className="text-xs text-slate-500 mt-1">{visibility.helper}</p>}
                          </td>
                          <td>
                            {item.latestAttempt ? (
                              item.resultVisible
                                ? (
                                  <div>
                                    <span className="text-sm font-medium text-slate-700">{formatScoreLine(item.latestAttempt)}</span>
                                    <p className="text-xs text-slate-500 mt-1">Attempt #{item.latestAttempt.attempt_number || 1} • {formatShortDate(item.latestAttempt.submitted_at)}</p>
                                  </div>
                                )
                                : <span className="text-sm text-slate-500">Hidden until release</span>
                            ) : (
                              <span className="text-sm text-slate-400">Not attempted</span>
                            )}
                          </td>
                          <td>
                            {item.bestAttempt ? (
                              item.resultVisible
                                ? (
                                  <div>
                                    <span className="text-sm font-medium text-slate-700">{formatScoreLine(item.bestAttempt)}</span>
                                    <p className="text-xs text-slate-500 mt-1">Best of {item.attemptsUsed || 0} attempt(s)</p>
                                  </div>
                                )
                                : <span className="text-sm text-slate-500">Hidden until release</span>
                            ) : (
                              <span className="text-sm text-slate-400">-</span>
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
                  <FiBarChart2 className="h-7 w-7" />
                </div>
                <h3 className="text-base font-medium text-slate-800">No assessments assigned yet</h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                  Once your teachers publish assessments, result visibility will appear here.
                </p>
              </div>
            )}
          </Card.Body>
        </Card>
      </div>
    </Layout>
  );
};

export default StudentResults;
