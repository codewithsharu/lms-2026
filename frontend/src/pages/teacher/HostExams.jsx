import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiClock, FiPlayCircle, FiPlus } from 'react-icons/fi';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { assessmentAPI } from '../../services/api';

const HostExams = () => {
  const navigate = useNavigate();
  const [hostedExams, setHostedExams] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchHostedExams = async () => {
    try {
      setLoading(true);
      const hostedRes = await assessmentAPI.getHostedExams();
      setHostedExams(hostedRes.data.hostedExams || []);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load hosted exams');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHostedExams();
  }, []);

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1>Host Exams</h1>
            <p>Review your hosted exams first, then create a new hosted exam from a template.</p>
          </div>
          <Button onClick={() => navigate('/teacher/assessments/host/new')}>
            <FiPlus className="h-4 w-4" />
            Host New Exam
          </Button>
        </div>

        <Card>
          <Card.Header>
            <h2 className="section-title">Hosted Exam List</h2>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, index) => (
                  <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : hostedExams.length > 0 ? (
              <div className="table-shell overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Template</th>
                      <th>Scope</th>
                      <th>Duration</th>
                      <th>Attempts</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hostedExams.map((exam) => (
                      <tr key={exam.id}>
                        <td>
                          <p className="font-medium text-slate-800">{exam.template?.title || 'Template missing'}</p>
                          <p className="text-xs text-slate-500">ID: {exam.id.slice(0, 8)}</p>
                        </td>
                        <td>
                          <p>{exam.class?.name || 'All Classes'}</p>
                          <p className="text-xs text-slate-500">
                            {exam.section?.name || 'All Sections'} • {exam.zone || 'All Zones'}
                          </p>
                        </td>
                        <td>
                          <span className="inline-flex items-center gap-1 text-sm">
                            <FiClock className="h-4 w-4 text-slate-400" />
                            {exam.duration_minutes} min
                          </span>
                        </td>
                        <td>{exam.max_attempts}</td>
                        <td>
                          <span className={`status-badge ${exam.publish_status === 'published' ? 'success' : exam.publish_status === 'closed' ? 'warning' : 'info'}`}>
                            {exam.publish_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-10 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-primary">
                  <FiPlayCircle className="h-7 w-7" />
                </div>
                <p className="text-base font-medium text-slate-800">No hosted exams yet</p>
                <p className="mt-1 text-sm text-slate-500">Click “Host New Exam” to create and publish assessments for your students.</p>
              </div>
            )}
          </Card.Body>
        </Card>
      </div>
    </Layout>
  );
};

export default HostExams;
