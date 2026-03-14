import { useEffect, useMemo, useState } from 'react';
import { FiUsers, FiBookOpen, FiLayers, FiMapPin, FiUserCheck } from 'react-icons/fi';
import Layout from '../../components/Layout';
import { useAuth } from '../../context/AuthContext';
import { teacherAPI } from '../../services/api';
import Card from '../../components/ui/Card';
import StatCard from '../../components/ui/StatCard';
import Alert from '../../components/ui/Alert';

const TeacherDashboard = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assignedData, setAssignedData] = useState({
    assignments: [],
    summary: {
      total_assignments: 0,
      total_students: 0
    }
  });

  useEffect(() => {
    const fetchAssignedData = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await teacherAPI.getAssignedStudents();
        setAssignedData(response.data);
      } catch (fetchError) {
        setError(fetchError.response?.data?.error || 'Failed to load assigned classes and sections');
      } finally {
        setLoading(false);
      }
    };

    fetchAssignedData();
  }, []);

  const uniqueClassCount = useMemo(
    () => new Set((assignedData.assignments || []).map((item) => item.class?.id).filter(Boolean)).size,
    [assignedData.assignments]
  );

  const uniqueSectionCount = useMemo(
    () => new Set((assignedData.assignments || []).map((item) => item.section?.id).filter(Boolean)).size,
    [assignedData.assignments]
  );

  const openScopeCount = useMemo(
    () =>
      (assignedData.assignments || []).filter(
        (item) => !item.section?.id || !item.zone
      ).length,
    [assignedData.assignments]
  );

  const groupedAssignments = useMemo(() => {
    const groups = new Map();

    (assignedData.assignments || []).forEach((assignment) => {
      const classId = assignment.class?.id || assignment.class?.name || assignment.assignment_id;

      if (!groups.has(classId)) {
        groups.set(classId, {
          className: assignment.class?.name || 'Unknown Class',
          items: [],
          totalStudents: 0
        });
      }

      const group = groups.get(classId);
      group.items.push(assignment);
      group.totalStudents += assignment.student_count || 0;
    });

    return Array.from(groups.values()).sort((a, b) => b.totalStudents - a.totalStudents);
  }, [assignedData.assignments]);

  const zonePillClass = (zone) => {
    if (zone === 'blue') return 'status-badge info';
    if (zone === 'red') return 'status-badge error';
    if (zone === 'green') return 'status-badge success';
    return 'status-badge warning';
  };

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header">
          <h1>Welcome, {user?.full_name}</h1>
          <p>Overview of your current class, section, and zone assignments.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={FiUsers}
            label="My Students"
            value={loading ? '...' : assignedData.summary.total_students}
            iconColorClass="bg-success"
          />
          <StatCard
            icon={FiBookOpen}
            label="Assigned Classes"
            value={loading ? '...' : uniqueClassCount}
            iconColorClass="bg-primary"
          />
          <StatCard
            icon={FiLayers}
            label="Assigned Sections"
            value={loading ? '...' : uniqueSectionCount}
            iconColorClass="bg-warning"
          />
          <StatCard
            icon={FiUserCheck}
            label="Open Scope Assignments"
            value={loading ? '...' : openScopeCount}
            iconColorClass="bg-gray-600"
          />
        </div>

        <Card>
          <Card.Header>
            <h2 className="section-title">Assigned Workload</h2>
            <p className="body-sm mt-1">Grouped by class so you can quickly see sections and student strength.</p>
          </Card.Header>
          <Card.Body>
            {loading && (
              <div className="space-y-3">
                {[...Array(3)].map((_, index) => (
                  <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            )}

            {!loading && error && <Alert type="error">{error}</Alert>}

            {!loading && !error && groupedAssignments.length === 0 && (
              <p className="text-sm text-slate-500">No class/section assignments found for your account.</p>
            )}

            {!loading && !error && groupedAssignments.length > 0 && (
              <div className="space-y-4">
                {groupedAssignments.map((group) => (
                  <div key={group.className} className="surface-card-muted overflow-hidden">
                    <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="font-medium text-slate-800">{group.className}</p>
                      <span className="status-badge success">{group.totalStudents} students</span>
                    </div>

                    <div className="space-y-2 p-3">
                      {group.items.map((assignment) => (
                        <div
                          key={assignment.assignment_id}
                          className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <p className="text-sm font-medium text-slate-700">
                              {assignment.section?.name || 'All Sections'}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className={`${zonePillClass(assignment.zone)} capitalize`}>
                                <FiMapPin className="mr-1 inline-block h-3 w-3" />
                                {assignment.zone || 'All Zones'}
                              </span>
                              <span className="status-badge info">
                                {assignment.student_count} student{assignment.student_count === 1 ? '' : 's'}
                              </span>
                            </div>
                          </div>

                          <p className="text-xs text-slate-500">Assignment ID: {assignment.assignment_id.slice(0, 8)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <h2 className="section-title">Your Profile</h2>
          </Card.Header>
          <Card.Body>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm text-slate-500">Name</p>
                <p className="font-medium text-slate-800">{user?.full_name}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Email</p>
                <p className="font-medium text-slate-800">{user?.email}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Employee ID</p>
                <p className="font-medium text-slate-800">{user?.details?.employee_id || 'N/A'}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Department</p>
                <p className="font-medium text-slate-800">{user?.details?.department || 'N/A'}</p>
              </div>
            </div>
          </Card.Body>
        </Card>
      </div>
    </Layout>
  );
};

export default TeacherDashboard;
