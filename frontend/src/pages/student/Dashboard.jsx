import { useEffect, useState } from 'react';
import { FiClipboard, FiBarChart2, FiAward, FiClock } from 'react-icons/fi';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import { useAuth } from '../../context/AuthContext';
import { assessmentAPI } from '../../services/api';
import Card from '../../components/ui/Card';
import StatCard from '../../components/ui/StatCard';

const StudentDashboard = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    assigned: 0,
    inProgress: 0,
    upcoming: 0,
    completed: 0
  });
  const [availableExams, setAvailableExams] = useState([]);

  useEffect(() => {
    const fetchAssessmentData = async () => {
      try {
        setLoading(true);
        const [metricsRes, availableRes] = await Promise.all([
          assessmentAPI.getStudentMetrics(),
          assessmentAPI.getStudentAvailable()
        ]);

        setMetrics({
          assigned: metricsRes.data?.assigned || 0,
          inProgress: metricsRes.data?.inProgress || 0,
          upcoming: metricsRes.data?.upcoming || 0,
          completed: metricsRes.data?.completed || 0
        });
        setAvailableExams(availableRes.data?.exams || []);
      } catch {
        toast.error('Failed to load assessment data');
      } finally {
        setLoading(false);
      }
    };

    fetchAssessmentData();
  }, []);

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1>Welcome, {user?.full_name}</h1>
            <p>Track your class progress, upcoming tests, and profile details.</p>
          </div>
          {user?.details?.zone && (
            <div className="inline-flex items-center rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700">
              Zone: {user.details.zone.charAt(0).toUpperCase() + user.details.zone.slice(1)}
            </div>
          )}
        </div>

        <Card>
          <Card.Header>
            <h2 className="section-title">Your Profile</h2>
          </Card.Header>
          <Card.Body>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Name</p>
                <p className="mt-1 font-medium text-gray-800">{user?.full_name}</p>
              </div>
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Email</p>
                <p className="mt-1 font-medium text-gray-800 break-all">{user?.email}</p>
              </div>
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Roll Number</p>
                <p className="mt-1 font-medium text-gray-800">{user?.details?.roll_number || 'N/A'}</p>
              </div>
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Class</p>
                <p className="mt-1 font-medium text-gray-800">{user?.details?.classes?.name || 'N/A'}</p>
              </div>
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Section</p>
                <p className="mt-1 font-medium text-gray-800">{user?.details?.sections?.name || 'N/A'}</p>
              </div>
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Zone</p>
                <p className="mt-1 font-medium text-gray-800 capitalize">{user?.details?.zone || 'N/A'}</p>
              </div>
            </div>
          </Card.Body>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard 
            icon={FiClipboard} 
            label="Assigned Tests" 
            value={loading ? '...' : metrics.assigned} 
            iconColorClass="bg-primary" 
          />
          <StatCard 
            icon={FiBarChart2} 
            label="In Progress" 
            value={loading ? '...' : metrics.inProgress} 
            iconColorClass="bg-primary-dark" 
          />
          <StatCard 
            icon={FiAward} 
            label="Upcoming" 
            value={loading ? '...' : metrics.upcoming} 
            iconColorClass="bg-slate-500" 
          />
          <StatCard 
            icon={FiClock} 
            label="Completed" 
            value={loading ? '...' : metrics.completed} 
            iconColorClass="bg-slate-700" 
          />
        </div>

        <Card>
          <Card.Header>
            <h2 className="section-title">Available Assessments</h2>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, index) => (
                  <div key={index} className="h-16 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : availableExams.length > 0 ? (
              <div className="table-shell overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Assessment</th>
                      <th>Subject</th>
                      <th>Duration</th>
                      <th>Attempts</th>
                      <th>Window</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableExams.map((exam) => (
                      <tr key={exam.id}>
                        <td className="font-medium text-slate-800">{exam.title || exam.template?.title || 'Untitled Assessment'}</td>
                        <td>{exam.subject || exam.template?.subject || 'N/A'}</td>
                        <td>{exam.duration_minutes} min</td>
                        <td>{exam.max_attempts}</td>
                        <td>
                          <p className="text-xs text-slate-600">
                            {exam.start_time ? new Date(exam.start_time).toLocaleString() : 'No start'}
                          </p>
                          <p className="text-xs text-slate-500">
                            {exam.end_time ? new Date(exam.end_time).toLocaleString() : 'No end'}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-10 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100">
                  <FiClipboard className="h-7 w-7 text-primary" />
                </div>
                <h3 className="mb-2 text-base font-medium text-gray-800">No Assessments Yet</h3>
                <p className="mx-auto max-w-md text-sm text-gray-500">
                  Teachers have not assigned assessments for your class/section/zone yet.
                </p>
              </div>
            )}
          </Card.Body>
        </Card>

      </div>
    </Layout>
  );
};

export default StudentDashboard;
