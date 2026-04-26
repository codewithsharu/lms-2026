import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Area,
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
import {
  FiActivity,
  FiBook,
  FiCalendar,
  FiCode,
  FiLayers,
  FiRefreshCw,
  FiShield,
  FiUserCheck,
  FiUsers,
  FiUserX
} from 'react-icons/fi';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import StatCard from '../../components/ui/StatCard';
import SelectField from '../../components/ui/SelectField';
import Button from '../../components/ui/Button';
import { assessmentAPI, auditLogAPI, classAPI, compilerAPI, userAPI } from '../../services/api';

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' }
];

const CHART_COLORS = {
  primary: '#2563EB',
  primaryLight: '#60A5FA',
  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
  slate: '#64748B',
  violet: '#7C3AED',
  cyan: '#0891B2'
};

const ROLE_PIE_COLORS = ['#2563EB', '#14B8A6', '#6366F1'];
const STATUS_PIE_COLORS = ['#16A34A', '#EF4444'];

const getDateLabel = (date) => date.toLocaleDateString('en-US', {
  month: 'short',
  day: 'numeric'
});

const createRecentDateBuckets = (days) => {
  const safeDays = Number.isFinite(days) ? Math.max(days, 1) : 30;
  const buckets = [];
  const today = new Date();

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const itemDate = new Date(today);
    itemDate.setHours(0, 0, 0, 0);
    itemDate.setDate(itemDate.getDate() - offset);

    buckets.push({
      key: itemDate.toISOString().slice(0, 10),
      label: getDateLabel(itemDate)
    });
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

const formatCompactDateTime = (isoValue) => {
  if (!isoValue) return 'Not synced yet';

  return new Date(isoValue).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatNumber = (value) => new Intl.NumberFormat('en-US').format(Number(value) || 0);

const percentage = (numerator, denominator) => {
  if (!denominator) return 0;
  return Math.round((Number(numerator) / Number(denominator)) * 100);
};

const EmptyChartState = ({ message }) => (
  <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
    {message}
  </div>
);

const buildUserGrowthSeries = (users, days) => {
  const buckets = createRecentDateBuckets(days);
  const map = new Map(buckets.map((item) => [item.key, { label: item.label, users: 0 }]));

  users.forEach((user) => {
    const key = toDateKey(user?.created_at);
    if (!key || !map.has(key)) return;

    const current = map.get(key);
    current.users += 1;
  });

  return buckets.map((item) => map.get(item.key));
};

const buildAuditTrendSeries = (logs, days) => {
  const buckets = createRecentDateBuckets(days);
  const map = new Map(buckets.map((item) => [item.key, { label: item.label, events: 0, failed: 0 }]));

  logs.forEach((log) => {
    const key = toDateKey(log?.created_at);
    if (!key || !map.has(key)) return;

    const current = map.get(key);
    current.events += 1;

    if (Number(log?.response_status) >= 400) {
      current.failed += 1;
    }
  });

  return buckets.map((item) => map.get(item.key));
};

const getTagSummary = (challenges = []) => {
  const tagMap = new Map();

  challenges.forEach((challenge) => {
    const tags = Array.isArray(challenge?.tags) ? challenge.tags : [];

    if (tags.length === 0) {
      tagMap.set('Untagged', (tagMap.get('Untagged') || 0) + 1);
      return;
    }

    tags.forEach((tag) => {
      const normalized = String(tag || '').trim() || 'Untagged';
      tagMap.set(normalized, (tagMap.get(normalized) || 0) + 1);
    });
  });

  return Array.from(tagMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 6);
};

const fetchAllUsers = async () => {
  const limit = 200;
  const maxPages = 20;

  let page = 1;
  let totalPages = 1;
  let totalUsers = 0;
  const records = [];

  do {
    const response = await userAPI.getAll({ page, limit });
    const rows = response.data?.users || [];
    const pagination = response.data?.pagination || {};

    totalPages = Number(pagination.totalPages) || 1;
    totalUsers = Number(pagination.total) || totalUsers;

    records.push(...rows);
    page += 1;
  } while (page <= totalPages && page <= maxPages);

  return {
    records,
    totalUsers,
    truncated: totalPages > maxPages
  };
};

const safeRequest = async (requestFactory, fallbackData) => {
  try {
    const response = await requestFactory();
    return { response, failed: false };
  } catch (error) {
    console.error('Analytics request failed:', error);
    return {
      response: { data: fallbackData },
      failed: true
    };
  }
};

const AdminAnalytics = () => {
  const [selectedRange, setSelectedRange] = useState('30');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const [analytics, setAnalytics] = useState({
    users: [],
    classes: [],
    challenges: [],
    auditLogs: [],
    totals: {
      totalUsers: 0,
      teachers: 0,
      students: 0,
      admins: 0,
      activeUsers: 0,
      inactiveUsers: 0,
      totalClasses: 0,
      activeClasses: 0,
      sections: 0,
      classStudents: 0,
      classTeachers: 0
    },
    assessments: {
      templates: 0,
      hosted: 0,
      published: 0,
      setupRequired: false
    },
    auditStats: {
      successful: 0,
      failed: 0,
      loginEvents: 0,
      total: 0
    },
    warnings: [],
    usersTruncated: false
  });

  const loadAnalytics = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const usersSnapshotPromise = fetchAllUsers();

      const teacherCountPromise = safeRequest(
        () => userAPI.getAll({ role: 'teacher', page: 1, limit: 1 }),
        { pagination: { total: 0 } }
      );

      const studentCountPromise = safeRequest(
        () => userAPI.getAll({ role: 'student', page: 1, limit: 1 }),
        { pagination: { total: 0 } }
      );

      const classPromise = safeRequest(
        () => classAPI.getAll(),
        []
      );

      const assessmentPromise = safeRequest(
        () => assessmentAPI.getAdminMetrics(),
        { templates: 0, hosted: 0, published: 0, setupRequired: false }
      );

      const auditPromise = safeRequest(
        () => auditLogAPI.getAll({ page: 1, limit: 100, sort_by: 'newest' }),
        { logs: [], stats: { successful: 0, failed: 0, loginEvents: 0 }, pagination: { total: 0 } }
      );

      const challengePromise = safeRequest(
        () => compilerAPI.listChallenges({ limit: 200 }),
        { challenges: [], total: 0 }
      );

      const [
        usersSnapshot,
        teacherCountResult,
        studentCountResult,
        classResult,
        assessmentResult,
        auditResult,
        challengeResult
      ] = await Promise.all([
        usersSnapshotPromise,
        teacherCountPromise,
        studentCountPromise,
        classPromise,
        assessmentPromise,
        auditPromise,
        challengePromise
      ]);

      const allUsers = Array.isArray(usersSnapshot.records) ? usersSnapshot.records : [];
      const totalUsers = Number(usersSnapshot.totalUsers) || allUsers.length;

      const teachers = Number(teacherCountResult.response?.data?.pagination?.total)
        || allUsers.filter((user) => user.role === 'teacher').length;

      const students = Number(studentCountResult.response?.data?.pagination?.total)
        || allUsers.filter((user) => user.role === 'student').length;

      const admins = Math.max(totalUsers - teachers - students, 0);

      const activeUsers = allUsers.filter((user) => user.is_active).length;
      const inactiveUsers = Math.max(allUsers.length - activeUsers, 0);

      const classes = Array.isArray(classResult.response?.data) ? classResult.response.data : [];
      const totalClasses = classes.length;
      const activeClasses = classes.filter((item) => item.is_active).length;
      const sections = classes.reduce((sum, item) => sum + (Number(item.section_count) || 0), 0);
      const classStudents = classes.reduce((sum, item) => sum + (Number(item.student_count) || 0), 0);
      const classTeachers = classes.reduce((sum, item) => sum + (Number(item.teacher_count) || 0), 0);

      const assessmentData = assessmentResult.response?.data || {};
      const assessments = {
        templates: Number(assessmentData.templates) || 0,
        hosted: Number(assessmentData.hosted) || 0,
        published: Number(assessmentData.published) || 0,
        setupRequired: Boolean(assessmentData.setupRequired)
      };

      const auditData = auditResult.response?.data || {};
      const auditLogs = Array.isArray(auditData.logs) ? auditData.logs : [];
      const auditStats = {
        successful: Number(auditData.stats?.successful)
          || auditLogs.filter((log) => Number(log.response_status) >= 200 && Number(log.response_status) < 300).length,
        failed: Number(auditData.stats?.failed)
          || auditLogs.filter((log) => Number(log.response_status) >= 400).length,
        loginEvents: Number(auditData.stats?.loginEvents)
          || auditLogs.filter((log) => log.action_type === 'LOGIN').length,
        total: Number(auditData.pagination?.total) || auditLogs.length
      };

      const challengeData = challengeResult.response?.data || {};
      const challenges = Array.isArray(challengeData.challenges) ? challengeData.challenges : [];

      const warnings = [];

      if (usersSnapshot.truncated) {
        warnings.push(`Detailed user metrics are based on ${allUsers.length} most recent users.`);
      }

      if (assessments.setupRequired) {
        warnings.push('Assessment analytics is partially unavailable because setup is not completed.');
      }

      if (challengeResult.failed) {
        warnings.push('Compiler challenge analytics is currently unavailable.');
      }

      if (auditResult.failed) {
        warnings.push('Audit log analytics is currently unavailable.');
      }

      setAnalytics({
        users: allUsers,
        classes,
        challenges,
        auditLogs,
        totals: {
          totalUsers,
          teachers,
          students,
          admins,
          activeUsers,
          inactiveUsers,
          totalClasses,
          activeClasses,
          sections,
          classStudents,
          classTeachers
        },
        assessments,
        auditStats,
        warnings,
        usersTruncated: usersSnapshot.truncated
      });

      setLastSyncedAt(new Date().toISOString());
    } catch (error) {
      console.error('Failed to load analytics:', error);
      toast.error('Unable to load analytics data right now');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const selectedDays = Number(selectedRange) || 30;

  const rolePieData = useMemo(() => ([
    { name: 'Students', value: analytics.totals.students },
    { name: 'Teachers', value: analytics.totals.teachers },
    { name: 'Admins', value: analytics.totals.admins }
  ].filter((item) => item.value > 0)), [analytics.totals]);

  const statusPieData = useMemo(() => ([
    { name: 'Active', value: analytics.totals.activeUsers },
    { name: 'Inactive', value: analytics.totals.inactiveUsers }
  ].filter((item) => item.value > 0)), [analytics.totals]);

  const userGrowthData = useMemo(
    () => buildUserGrowthSeries(analytics.users, selectedDays),
    [analytics.users, selectedDays]
  );

  const topClassEnrollment = useMemo(() => (
    [...analytics.classes]
      .sort((left, right) => (Number(right.student_count) || 0) - (Number(left.student_count) || 0))
      .slice(0, 8)
      .map((item) => ({
        name: item.name,
        students: Number(item.student_count) || 0,
        teachers: Number(item.teacher_count) || 0
      }))
  ), [analytics.classes]);

  const zoneDistribution = useMemo(() => {
    const bucket = {
      blue: 0,
      red: 0,
      green: 0,
      unassigned: 0
    };

    analytics.users
      .filter((user) => user.role === 'student')
      .forEach((student) => {
        const rawZone = String(student?.details?.zone || '').trim().toLowerCase();
        const zone = rawZone && bucket[rawZone] !== undefined ? rawZone : 'unassigned';
        bucket[zone] += 1;
      });

    return [
      { name: 'Blue', value: bucket.blue, fill: '#2563EB' },
      { name: 'Red', value: bucket.red, fill: '#DC2626' },
      { name: 'Green', value: bucket.green, fill: '#16A34A' },
      { name: 'Unassigned', value: bucket.unassigned, fill: '#64748B' }
    ].filter((item) => item.value > 0);
  }, [analytics.users]);

  const assessmentBars = useMemo(() => ([
    { name: 'Templates', value: analytics.assessments.templates },
    { name: 'Hosted', value: analytics.assessments.hosted },
    { name: 'Published', value: analytics.assessments.published }
  ]), [analytics.assessments]);

  const auditTrendData = useMemo(
    () => buildAuditTrendSeries(analytics.auditLogs, selectedDays),
    [analytics.auditLogs, selectedDays]
  );

  const challengeTagData = useMemo(
    () => getTagSummary(analytics.challenges),
    [analytics.challenges]
  );

  const insightItems = useMemo(() => {
    const activeRate = percentage(analytics.totals.activeUsers, analytics.totals.totalUsers || analytics.users.length);
    const publishRate = percentage(analytics.assessments.published, analytics.assessments.hosted || 0);
    const failedAuditRate = percentage(
      analytics.auditStats.failed,
      analytics.auditStats.successful + analytics.auditStats.failed
    );

    return [
      {
        label: 'Active User Rate',
        value: `${activeRate}%`,
        subtitle: `${formatNumber(analytics.totals.activeUsers)} of ${formatNumber(analytics.totals.totalUsers || analytics.users.length)}`,
        tone: 'text-green-700 bg-green-50 border-green-100'
      },
      {
        label: 'Published Exam Rate',
        value: `${publishRate}%`,
        subtitle: `${formatNumber(analytics.assessments.published)} published out of ${formatNumber(analytics.assessments.hosted)} hosted`,
        tone: 'text-blue-700 bg-blue-50 border-blue-100'
      },
      {
        label: 'Audit Failure Rate',
        value: `${failedAuditRate}%`,
        subtitle: `${formatNumber(analytics.auditStats.failed)} failed API actions`,
        tone: 'text-amber-700 bg-amber-50 border-amber-100'
      },
      {
        label: 'Student-Teacher Ratio',
        value: analytics.totals.teachers > 0
          ? `${(analytics.totals.students / analytics.totals.teachers).toFixed(1)} : 1`
          : 'N/A',
        subtitle: `${formatNumber(analytics.totals.students)} students and ${formatNumber(analytics.totals.teachers)} teachers`,
        tone: 'text-violet-700 bg-violet-50 border-violet-100'
      }
    ];
  }, [analytics]);

  const tooltipStyle = {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: '8px',
    fontSize: '12px'
  };

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1>Admin Analytics</h1>
            <p>Track users, classes, assessments, audit activity, and coding challenges in one dashboard.</p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <SelectField
              label="Date Window"
              value={selectedRange}
              onChange={(event) => setSelectedRange(event.target.value)}
              className="min-w-44"
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>

            <Button variant="secondary" onClick={() => loadAnalytics({ silent: true })} disabled={refreshing}>
              <FiRefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <FiCalendar className="h-4 w-4" />
          <span>Last synced: {formatCompactDateTime(lastSyncedAt)}</span>
          {analytics.usersTruncated && (
            <span className="status-badge warning">Detailed user data sampled</span>
          )}
        </div>

        {analytics.warnings.length > 0 && (
          <Card>
            <Card.Body className="space-y-2">
              {analytics.warnings.map((warning) => (
                <p key={warning} className="text-sm text-amber-700">
                  {warning}
                </p>
              ))}
            </Card.Body>
          </Card>
        )}

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((item) => (
              <div key={item} className="surface-card p-5 animate-pulse">
                <div className="h-4 w-28 rounded bg-slate-100" />
                <div className="mt-3 h-8 w-20 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <StatCard icon={FiUsers} label="Total Users" value={formatNumber(analytics.totals.totalUsers)} iconColorClass="bg-blue-600" />
              <StatCard icon={FiUserCheck} label="Active Users" value={formatNumber(analytics.totals.activeUsers)} iconColorClass="bg-emerald-600" />
              <StatCard icon={FiUserX} label="Inactive Users" value={formatNumber(analytics.totals.inactiveUsers)} iconColorClass="bg-rose-600" />
              <StatCard icon={FiBook} label="Classes" value={formatNumber(analytics.totals.totalClasses)} iconColorClass="bg-indigo-600" />
              <StatCard icon={FiLayers} label="Published Exams" value={formatNumber(analytics.assessments.published)} iconColorClass="bg-cyan-600" />
              <StatCard icon={FiShield} label="Audit Failures" value={formatNumber(analytics.auditStats.failed)} iconColorClass="bg-amber-600" />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card>
                <Card.Header>
                  <h2 className="section-title">User Growth Trend</h2>
                  <p className="body-sm">New users created across the selected period.</p>
                </Card.Header>
                <Card.Body className="h-72">
                  {userGrowthData.some((item) => item.users > 0) ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={userGrowthData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Line
                          type="monotone"
                          dataKey="users"
                          stroke={CHART_COLORS.primary}
                          strokeWidth={2.5}
                          dot={{ r: 2 }}
                          activeDot={{ r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChartState message="No recent user registrations to plot." />
                  )}
                </Card.Body>
              </Card>

              <Card>
                <Card.Header>
                  <h2 className="section-title">Role Distribution</h2>
                  <p className="body-sm">Students, teachers, and admin account mix.</p>
                </Card.Header>
                <Card.Body className="h-72">
                  {rolePieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={rolePieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={60}
                          outerRadius={92}
                          paddingAngle={2}
                        >
                          {rolePieData.map((entry, index) => (
                            <Cell key={entry.name} fill={ROLE_PIE_COLORS[index % ROLE_PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => formatNumber(value)} contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChartState message="No role data available yet." />
                  )}
                </Card.Body>
              </Card>

              <Card>
                <Card.Header>
                  <h2 className="section-title">Account Status Split</h2>
                  <p className="body-sm">Active versus inactive accounts.</p>
                </Card.Header>
                <Card.Body className="h-72">
                  {statusPieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusPieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={92}
                          paddingAngle={3}
                        >
                          {statusPieData.map((entry, index) => (
                            <Cell key={entry.name} fill={STATUS_PIE_COLORS[index % STATUS_PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => formatNumber(value)} contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChartState message="No account status data available." />
                  )}
                </Card.Body>
              </Card>

              <Card>
                <Card.Header>
                  <h2 className="section-title">Class Enrollment</h2>
                  <p className="body-sm">Top classes by enrolled students and assigned teachers.</p>
                </Card.Header>
                <Card.Body className="h-72">
                  {topClassEnrollment.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topClassEnrollment}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="students" fill={CHART_COLORS.primary} radius={[6, 6, 0, 0]} />
                        <Bar dataKey="teachers" fill={CHART_COLORS.violet} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChartState message="No class data available yet." />
                  )}
                </Card.Body>
              </Card>

              <Card>
                <Card.Header>
                  <h2 className="section-title">Assessment Snapshot</h2>
                  <p className="body-sm">Templates, hosted exams, and published exams.</p>
                </Card.Header>
                <Card.Body className="h-72">
                  {assessmentBars.some((item) => item.value > 0) ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={assessmentBars}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value) => formatNumber(value)} contentStyle={tooltipStyle} />
                        <Bar dataKey="value" fill={CHART_COLORS.cyan} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChartState message="No assessment metrics to display." />
                  )}
                </Card.Body>
              </Card>

              <Card>
                <Card.Header>
                  <h2 className="section-title">Audit Activity</h2>
                  <p className="body-sm">Recent API actions and failed request trend.</p>
                </Card.Header>
                <Card.Body className="h-72">
                  {auditTrendData.some((item) => item.events > 0) ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={auditTrendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Area
                          type="monotone"
                          dataKey="events"
                          stroke={CHART_COLORS.slate}
                          fill="#E2E8F0"
                          fillOpacity={0.6}
                        />
                        <Area
                          type="monotone"
                          dataKey="failed"
                          stroke={CHART_COLORS.danger}
                          fill="#FEE2E2"
                          fillOpacity={0.65}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChartState message="No audit trend data to render." />
                  )}
                </Card.Body>
              </Card>

              <Card>
                <Card.Header>
                  <h2 className="section-title">Student Zone Distribution</h2>
                  <p className="body-sm">Current student spread across zone buckets.</p>
                </Card.Header>
                <Card.Body className="h-72">
                  {zoneDistribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={zoneDistribution}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value) => formatNumber(value)} contentStyle={tooltipStyle} />
                        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                          {zoneDistribution.map((entry) => (
                            <Cell key={entry.name} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChartState message="No student zone data available." />
                  )}
                </Card.Body>
              </Card>

              <Card>
                <Card.Header>
                  <h2 className="section-title">Challenge Tag Mix</h2>
                  <p className="body-sm">Top challenge tags from coding question bank.</p>
                </Card.Header>
                <Card.Body className="h-72">
                  {challengeTagData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={challengeTagData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value) => formatNumber(value)} contentStyle={tooltipStyle} />
                        <Bar dataKey="value" fill={CHART_COLORS.warning} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChartState message="No challenge tag data available." />
                  )}
                </Card.Body>
              </Card>
            </div>

            <Card>
              <Card.Header>
                <h2 className="section-title">Operational Insights</h2>
                <p className="body-sm">Fast summary ratios to guide admin actions.</p>
              </Card.Header>
              <Card.Body>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {insightItems.map((item) => (
                    <div key={item.label} className={`rounded-xl border p-4 ${item.tone}`}>
                      <p className="text-xs uppercase tracking-wide">{item.label}</p>
                      <p className="mt-2 text-2xl font-semibold">{item.value}</p>
                      <p className="mt-1 text-xs opacity-85">{item.subtitle}</p>
                    </div>
                  ))}
                </div>
              </Card.Body>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={FiBook} label="Active Classes" value={formatNumber(analytics.totals.activeClasses)} iconColorClass="bg-indigo-700" />
              <StatCard icon={FiLayers} label="Sections" value={formatNumber(analytics.totals.sections)} iconColorClass="bg-sky-700" />
              <StatCard icon={FiActivity} label="Audit Login Events" value={formatNumber(analytics.auditStats.loginEvents)} iconColorClass="bg-emerald-700" />
              <StatCard icon={FiCode} label="Challenges" value={formatNumber(analytics.challenges.length)} iconColorClass="bg-amber-700" />
            </div>
          </>
        )}
      </div>
    </Layout>
  );
};

export default AdminAnalytics;
