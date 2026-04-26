import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { FiCalendar, FiRefreshCw, FiUsers, FiUserCheck, FiBook, FiActivity } from 'react-icons/fi';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import StatCard from '../../components/ui/StatCard';
import SelectField from '../../components/ui/SelectField';
import Button from '../../components/ui/Button';
import { teacherAPI, assessmentAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' }
];

const CHART_COLORS = {
  primary: '#2563EB',
  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
  slate: '#64748B'
};

const formatNumber = (value) => new Intl.NumberFormat('en-US').format(Number(value) || 0);
const percentage = (n, d) => {
  if (!d) return 0;
  return Math.round((Number(n) / Number(d)) * 100);
};

const getDateLabel = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const createRecentDateBuckets = (days) => {
  const safeDays = Number.isFinite(days) ? Math.max(days, 1) : 30;
  const buckets = [];
  const today = new Date();

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const itemDate = new Date(today);
    itemDate.setHours(0, 0, 0, 0);
    itemDate.setDate(itemDate.getDate() - offset);

    buckets.push({ key: itemDate.toISOString().slice(0, 10), label: getDateLabel(itemDate) });
  }

  return buckets;
};

const toDateKey = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed.toISOString().slice(0, 10);
};

const EmptyChartState = ({ message }) => (
  <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
    {message}
  </div>
);

const buildAttemptTrendSeries = (attempts = [], days) => {
  const buckets = createRecentDateBuckets(days);
  const map = new Map(buckets.map((item) => [item.key, { label: item.label, started: 0, submitted: 0 }]));

  (attempts || []).forEach((attempt) => {
    const key = toDateKey(attempt?.created_at || attempt?.started_at || attempt?.submitted_at);
    if (!key || !map.has(key)) return;
    const current = map.get(key);
    current.started += 1;
    if (attempt.status === 'submitted' || attempt.status === 'auto_submitted') current.submitted += 1;
  });

  return buckets.map((item) => map.get(item.key));
};

const TeacherAnalytics = () => {
  const { user } = useAuth();
  const [selectedRange, setSelectedRange] = useState('30');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const [assignments, setAssignments] = useState([]);
  const [assignedSummary, setAssignedSummary] = useState({ total_students: 0, total_assignments: 0 });
  const [hostedExams, setHostedExams] = useState([]);
  const [teacherMetrics, setTeacherMetrics] = useState({ templates: 0, hosted: 0, published: 0 });

  const [filters, setFilters] = useState({ classId: '', sectionId: '', examId: '', zone: '' });

  const loadMetrics = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);

    try {
      const [assignResp, metricsResp, hostedResp] = await Promise.all([
        teacherAPI.getAssignedStudents(),
        assessmentAPI.getTeacherMetrics(),
        assessmentAPI.getHostedExams()
      ]);

      const assignmentsData = assignResp.data || { assignments: [], summary: { total_assignments: 0, total_students: 0 } };
      setAssignments(Array.isArray(assignmentsData.assignments) ? assignmentsData.assignments : []);
      setAssignedSummary(assignmentsData.summary || { total_students: 0, total_assignments: 0 });

      setTeacherMetrics(metricsResp.data || { templates: 0, hosted: 0, published: 0 });

      const hosted = Array.isArray(hostedResp.data?.hostedExams) ? hostedResp.data.hostedExams : [];
      setHostedExams(hosted);
      setLastSyncedAt(new Date().toISOString());
    } catch (error) {
      console.error('Teacher analytics load failed', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  const assignedStudentsList = useMemo(() => {
    const map = new Map();
    (assignments || []).forEach((asg) => {
      (asg.students || []).forEach((stu) => {
        if (stu?.id && !map.has(stu.id)) map.set(stu.id, stu);
      });
    });
    return Array.from(map.values());
  }, [assignments]);

  const totalAssignedStudents = assignedSummary.total_students || assignedStudentsList.length;
  const assignedClassesCount = new Set(assignments.map((a) => a.class?.id || a.class?.id)).size || (assignments.length ? assignments.length : 0);
  const assignedSectionsCount = new Set(assignments.map((a) => a.section?.id || null)).size || 0;

  const examsCreated = Number(teacherMetrics.hosted) || hostedExams.length;

  const now = Date.now();
  const examsLive = hostedExams.filter((exam) => exam.publish_status === 'published' && (() => {
    try {
      const start = exam.start_time ? new Date(exam.start_time).getTime() : null;
      const end = exam.end_time ? new Date(exam.end_time).getTime() : null;
      if (start && end) return start <= now && now <= end;
      return exam.publish_status === 'published';
    } catch {
      return false;
    }
  })()).length;

  const totalStarted = hostedExams.reduce((sum, e) => sum + (Number(e.attempts_started_count) || 0), 0);
  const totalSubmitted = hostedExams.reduce((sum, e) => sum + (Number(e.attempts_submitted_count) || 0), 0);

  const submissionRate = totalStarted > 0 ? percentage(totalSubmitted, totalStarted) : 0;

  const studentsByClass = useMemo(() => (
    assignments.map((asg) => ({ name: asg.class?.name || 'Unknown', students: asg.student_count || (asg.students || []).length }))
  ), [assignments]);

  const studentsBySection = useMemo(() => {
    const buckets = [];
    assignments.forEach((asg) => {
      const className = asg.class?.name || 'Unknown';
      const sectionName = asg.section?.name || 'All Sections';
      const existing = buckets.find((b) => b.name === className && b.section === sectionName);
      const cnt = asg.student_count || (asg.students || []).length;
      if (existing) existing.value += cnt; else buckets.push({ name: className, section: sectionName, value: cnt });
    });
    return buckets;
  }, [assignments]);

  const statusPieData = useMemo(() => {
    const active = assignedStudentsList.filter((s) => s?.is_active).length;
    const inactive = Math.max(assignedStudentsList.length - active, 0);
    return [{ name: 'Active', value: active }, { name: 'Inactive', value: inactive }].filter((i) => i.value > 0);
  }, [assignedStudentsList]);

  const examsByStatus = useMemo(() => {
    const map = new Map();
    (hostedExams || []).forEach((exam) => {
      const key = String(exam.publish_status || 'draft');
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [hostedExams]);

  const selectedExam = useMemo(() => {
    if (!filters.examId) return hostedExams[0] || null;
    return hostedExams.find((e) => String(e.id) === String(filters.examId)) || null;
  }, [hostedExams, filters.examId]);

  const participationFunnel = useMemo(() => {
    if (!selectedExam) return null;
    const eligible = Array.isArray(selectedExam.specific_students) && selectedExam.specific_students.length > 0
      ? selectedExam.specific_students.length
      : totalAssignedStudents;

    const started = Number(selectedExam.attempts_started_count) || 0;
    const submitted = Number(selectedExam.attempts_submitted_count) || 0;

    return { eligible, started, submitted };
  }, [selectedExam, totalAssignedStudents]);

  const attemptTrendData = useMemo(() => {
    // We don't have per-attempt time-series from current teacher endpoints; show empty if not available
    return [];
  }, [hostedExams]);

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1>Teacher Analytics</h1>
            <p>Metrics and participation for your assigned classes and hosted exams.</p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <SelectField label="Date Window" value={selectedRange} onChange={(e) => setSelectedRange(e.target.value)} className="min-w-44">
              {RANGE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </SelectField>

            <Button variant="secondary" onClick={() => loadMetrics({ silent: true })} disabled={refreshing}>
              <FiRefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <FiCalendar className="h-4 w-4" />
          <span>Last synced: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'Not synced yet'}</span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="surface-card p-5 animate-pulse">
                <div className="h-4 w-28 rounded bg-slate-100" />
                <div className="mt-3 h-8 w-20 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <StatCard icon={FiUsers} label="Assigned Students" value={formatNumber(totalAssignedStudents)} iconColorClass="bg-blue-600" />
              <StatCard icon={FiBook} label="Assigned Classes" value={formatNumber(assignedClassesCount)} iconColorClass="bg-indigo-600" />
              <StatCard icon={FiActivity} label="Assigned Sections" value={formatNumber(assignedSectionsCount)} iconColorClass="bg-emerald-600" />
              <StatCard icon={FiBook} label="Exams Created" value={formatNumber(examsCreated)} iconColorClass="bg-cyan-600" />
              <StatCard icon={FiCalendar} label="Exams Live" value={formatNumber(examsLive)} iconColorClass="bg-amber-600" />
              <StatCard icon={FiUserCheck} label="Started Attempts" value={formatNumber(totalStarted)} iconColorClass="bg-emerald-600" />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 mt-4">
              <Card>
                <Card.Header>
                  <h2 className="section-title">Students by Class</h2>
                  <p className="body-sm">Enrollment within your assignment scope.</p>
                </Card.Header>
                <Card.Body className="h-72">
                  {studentsByClass.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={studentsByClass}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="students" fill={CHART_COLORS.primary} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChartState message="No assigned class/student data available." />
                  )}
                </Card.Body>
              </Card>

              <Card>
                <Card.Header>
                  <h2 className="section-title">Student Status</h2>
                  <p className="body-sm">Active vs inactive students in your assignments.</p>
                </Card.Header>
                <Card.Body className="h-72">
                  {statusPieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={statusPieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                          {statusPieData.map((entry, idx) => (
                            <Cell key={entry.name} fill={idx === 0 ? CHART_COLORS.success : CHART_COLORS.danger} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChartState message="No student status data available." />
                  )}
                </Card.Body>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 mt-4">
              <Card>
                <Card.Header>
                  <h2 className="section-title">Exams by Status</h2>
                  <p className="body-sm">Draft, published, and closed exams you created.</p>
                </Card.Header>
                <Card.Body className="h-72">
                  {examsByStatus.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={examsByStatus}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="value" fill={CHART_COLORS.primary} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChartState message="No exam data available." />
                  )}
                </Card.Body>
              </Card>

              <Card>
                <Card.Header>
                  <h2 className="section-title">Participation Funnel</h2>
                  <p className="body-sm">Eligible → Started → Submitted for selected exam.</p>
                </Card.Header>
                <Card.Body className="h-72 flex items-center justify-center">
                  {selectedExam ? (
                    <div className="w-full max-w-md">
                      <div className="flex justify-between">
                        <div>Eligible</div>
                        <div className="font-semibold">{formatNumber(participationFunnel.eligible)}</div>
                      </div>
                      <div className="mt-2 flex justify-between">
                        <div>Started</div>
                        <div className="font-semibold">{formatNumber(participationFunnel.started)}</div>
                      </div>
                      <div className="mt-2 flex justify-between">
                        <div>Submitted</div>
                        <div className="font-semibold">{formatNumber(participationFunnel.submitted)}</div>
                      </div>
                      <div className="mt-4 text-sm text-slate-600">Submission Rate: {submissionRate}%</div>
                    </div>
                  ) : (
                    <EmptyChartState message="Select an exam to see funnel details." />
                  )}
                </Card.Body>
              </Card>
            </div>

            <div className="mt-6">
              <Card>
                <Card.Header>
                  <h2 className="section-title">Hosted Exams</h2>
                  <p className="body-sm">List of exams you created with quick stats.</p>
                </Card.Header>
                <Card.Body>
                  <div className="overflow-auto">
                    <table className="table-auto w-full text-left">
                      <thead>
                        <tr>
                          <th className="px-3 py-2">Title</th>
                          <th className="px-3 py-2">Class</th>
                          <th className="px-3 py-2">Section</th>
                          <th className="px-3 py-2">Eligible</th>
                          <th className="px-3 py-2">Started</th>
                          <th className="px-3 py-2">Submitted</th>
                          <th className="px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(hostedExams || []).map((exam) => (
                          <tr key={exam.id} className="border-t">
                            <td className="px-3 py-2">{exam.exam_title || exam.template?.title || 'Untitled'}</td>
                            <td className="px-3 py-2">{exam.class?.name || '-'}</td>
                            <td className="px-3 py-2">{exam.section?.name || '-'}</td>
                            <td className="px-3 py-2">{formatNumber(Array.isArray(exam.specific_students) && exam.specific_students.length > 0 ? exam.specific_students.length : totalAssignedStudents)}</td>
                            <td className="px-3 py-2">{formatNumber(exam.attempts_started_count || 0)}</td>
                            <td className="px-3 py-2">{formatNumber(exam.attempts_submitted_count || 0)}</td>
                            <td className="px-3 py-2">{String(exam.publish_status || 'draft')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card.Body>
              </Card>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
};

export default TeacherAnalytics;
