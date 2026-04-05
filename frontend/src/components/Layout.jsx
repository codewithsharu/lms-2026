import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getRoleBadgeClass } from '../utils/uiTheme';
import { 
  FiHome, FiUsers, FiSettings, FiLogOut, FiMenu, FiX,
  FiBook, FiClipboard, FiBarChart2, FiUser, FiChevronRight, FiChevronLeft, FiActivity, FiDatabase, FiTerminal, FiMonitor
} from 'react-icons/fi';

const Layout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    if (logoutLoading) return;

    setLogoutLoading(true);

    try {
      await logout();
      navigate('/login');
    } finally {
      setLogoutLoading(false);
    }
  };

  // Navigation items based on role
  const getNavItems = () => {
    const baseItems = {
      admin: [
        { name: 'Audit Logs', path: '/admin/audit-logs', icon: FiActivity },
        { name: 'Health Check', path: '/admin/health-check', icon: FiDatabase },
        { name: 'Dashboard', path: '/admin', icon: FiHome },
        { name: 'Students', path: '/admin/students', icon: FiUsers },
        { name: 'Teachers', path: '/admin/teachers', icon: FiUser },
        { name: 'Classes', path: '/admin/classes', icon: FiBook },
        { name: 'Analytics', path: '/admin/analytics', icon: FiBarChart2 },
        { name: 'Settings', path: '/admin/settings', icon: FiSettings },
      ],
      teacher: [
        { name: 'Dashboard', path: '/teacher', icon: FiHome },
        { name: 'My Students', path: '/teacher/students', icon: FiUsers },
        { name: 'My Classes', path: '/teacher/classes', icon: FiBook },
        { name: 'Question Bank', path: '/teacher/assessments/templates', icon: FiClipboard },
        { name: 'Challenges', path: '/teacher/compiler/challenges', icon: FiTerminal },
        { name: 'Schedule Exams', path: '/teacher/assessments/host', icon: FiActivity },
        { name: 'Exam Preview Lab', path: '/teacher/assessments/preview-lab', icon: FiMonitor },
        { name: 'Analytics', path: '/teacher/analytics', icon: FiBarChart2 },
      ],
      student: [
        { name: 'Dashboard', path: '/student', icon: FiHome },
        { name: 'Assessments', path: '/student/assessments', icon: FiClipboard },
        { name: 'Challenge Runner', path: '/compiler/challenges/run', icon: FiTerminal },
        { name: 'Results', path: '/student/results', icon: FiBarChart2 },
        { name: 'Profile', path: '/student/profile', icon: FiUser },
      ],
    };

    return baseItems[user?.role] || [];
  };

  const navItems = getNavItems();

  const roleBadgeClass = getRoleBadgeClass(user?.role);

  const matchesItemPath = (itemPath) => {
    if (location.pathname === itemPath) return true;
    if (itemPath === '/admin' || itemPath === '/teacher' || itemPath === '/student') return false;
    return location.pathname.startsWith(`${itemPath}/`);
  };

  const currentNavItem = navItems
    .filter((item) => matchesItemPath(item.path))
    .sort((a, b) => b.path.length - a.path.length)[0] || null;

  const isItemActive = (itemPath) => currentNavItem?.path === itemPath;

  const roleHomePath = {
    admin: '/admin',
    teacher: '/teacher',
    student: '/student'
  }[user?.role] || '/';

  const toTitleCaseLabel = (value = '') => {
    const normalized = String(value || '').replace(/[-_]+/g, ' ').trim();

    if (!normalized) {
      return '';
    }

    return normalized
      .split(/\s+/)
      .map((token) => (
        token.length <= 2
          ? token.toUpperCase()
          : `${token.charAt(0).toUpperCase()}${token.slice(1)}`
      ))
      .join(' ');
  };

  const isLikelyIdSegment = (segment = '') => {
    const value = String(segment || '').trim();

    if (!value) {
      return false;
    }

    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) {
      return true;
    }

    if (/^[0-9a-f]{16,}$/i.test(value)) {
      return true;
    }

    return value.length > 16 && !/[aeiou]/i.test(value);
  };

  const secondaryBreadcrumbLabel = useMemo(() => {
    const path = location.pathname;

    if (/\/compiler\/challenges\/run(?:\/|$)/.test(path)) {
      return 'Exam Runner';
    }

    if (/\/compiler\/challenges\/new(?:\/|$)/.test(path)) {
      const isEditMode = new URLSearchParams(location.search).has('sourceChallengeId');
      return isEditMode ? 'Edit Challenge' : 'Create Challenge';
    }

    if (!currentNavItem) {
      return '';
    }

    if (path === currentNavItem.path || path === `${currentNavItem.path}/`) {
      return '';
    }

    let remainder = path.startsWith(currentNavItem.path)
      ? path.slice(currentNavItem.path.length)
      : '';

    remainder = String(remainder || '').replace(/^\/+|\/+$/g, '');
    if (!remainder) {
      return '';
    }

    const remainderParts = remainder.split('/').filter(Boolean);
    let candidate = remainderParts[remainderParts.length - 1];

    if (isLikelyIdSegment(candidate) && remainderParts.length > 1) {
      candidate = remainderParts[remainderParts.length - 2];
    }

    const derived = toTitleCaseLabel(candidate);
    if (!derived) {
      return '';
    }

    if (derived.toLowerCase() === String(currentNavItem.name || '').toLowerCase()) {
      return '';
    }

    return derived;
  }, [location.pathname, location.search, currentNavItem]);

  const breadcrumbs = useMemo(() => {
    const items = [{ label: 'EDU LMS', path: roleHomePath }];

    if (currentNavItem) {
      items.push({ label: currentNavItem.name, path: currentNavItem.path });
    }

    if (secondaryBreadcrumbLabel) {
      items.push({ label: secondaryBreadcrumbLabel, path: location.pathname });
    }

    return items;
  }, [roleHomePath, currentNavItem, secondaryBreadcrumbLabel, location.pathname]);

  const getIconTone = (path) => {
    if (path.includes('students')) {
      return 'bg-blue-50 text-blue-600 group-hover:bg-blue-100 group-hover:text-blue-700';
    }

    if (path.includes('teachers') || path.includes('profile')) {
      return 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100 group-hover:text-indigo-700';
    }

    if (path.includes('classes')) {
      return 'bg-amber-50 text-amber-600 group-hover:bg-amber-100 group-hover:text-amber-700';
    }

    if (path.includes('analytics') || path.includes('results')) {
      return 'bg-violet-50 text-violet-600 group-hover:bg-violet-100 group-hover:text-violet-700';
    }

    if (path.includes('audit-logs')) {
      return 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100 group-hover:text-emerald-700';
    }

    if (path.includes('health-check')) {
      return 'bg-teal-50 text-teal-600 group-hover:bg-teal-100 group-hover:text-teal-700';
    }

    if (path.includes('settings')) {
      return 'bg-slate-100 text-slate-600 group-hover:bg-slate-200 group-hover:text-slate-700';
    }

    if (path.includes('assessments')) {
      return 'bg-cyan-50 text-cyan-600 group-hover:bg-cyan-100 group-hover:text-cyan-700';
    }

    if (path.includes('/compiler/')) {
      return 'bg-orange-50 text-orange-600 group-hover:bg-orange-100 group-hover:text-orange-700';
    }

    return 'bg-gray-100 text-gray-500 group-hover:bg-gray-200 group-hover:text-gray-700';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 z-50 flex h-full flex-col overflow-hidden bg-white border-r border-gray-200 shadow-sm transform transition-all duration-300
        ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-64'}
        lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="h-17 flex items-center justify-between px-4 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-sm">
              <FiBook className="w-5 h-5 text-white" />
            </div>
            {!sidebarCollapsed && (
            <div>
              <p className="text-sm font-semibold tracking-wide text-gray-900">EDU LMS</p>
              <p className="text-[11px] text-gray-500">Learning Platform</p>
            </div>
            )}
          </div>
          <button 
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100"
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className={`sidebar-nav-scroll flex-1 min-h-0 py-5 space-y-1.5 overflow-y-auto overscroll-contain ${sidebarCollapsed ? 'pl-2 pr-3' : 'pl-3 pr-4'}`}>
          <p className={`pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 ${sidebarCollapsed ? 'px-2 text-center' : 'px-3'}`}>
            Navigation
          </p>
          {navItems.map((item) => {
            const isActive = isItemActive(item.path);
            const Icon = item.icon;
            const iconToneClass = getIconTone(item.path);
            
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                title={sidebarCollapsed ? item.name : undefined}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-200 ${
                  isActive
                    ? 'bg-blue-50 text-primary border border-blue-200 shadow-[0_1px_2px_rgba(37,99,235,0.08)]'
                    : 'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900 border border-transparent'
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                    isActive
                      ? 'bg-primary text-white'
                      : iconToneClass
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </span>
                {!sidebarCollapsed && <span className="font-medium text-[0.95rem]">{item.name}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className={`border-t border-gray-200 bg-white ${sidebarCollapsed ? 'p-2' : 'p-4'}`}>
          <div className={`rounded-2xl border border-gray-200 bg-gray-50 ${sidebarCollapsed ? 'p-2' : 'p-3'}`}>
            <div className={`mb-3 flex items-center gap-3 ${sidebarCollapsed ? 'justify-center mb-2' : ''}`}>
              <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-sm">
                <span className="text-white font-semibold text-sm">
                  {user?.full_name?.charAt(0)?.toUpperCase() || 'U'}
                </span>
              </div>
              {!sidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{user?.full_name}</p>
                <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
              </div>
              )}
            </div>
            <button
              onClick={handleLogout}
              disabled={logoutLoading}
              title="Logout"
              className={`w-full flex items-center justify-center gap-2 text-red-600 border border-red-200 rounded-xl transition-colors ${logoutLoading ? 'opacity-60' : 'hover:bg-red-50'} ${sidebarCollapsed ? 'px-2 py-2' : 'px-4 py-2.5'}`}
            >
              {logoutLoading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {!sidebarCollapsed && <span className="font-medium">Logging out...</span>}
                </>
              ) : (
                <>
                  <FiLogOut className="w-4 h-4" />
                  {!sidebarCollapsed && <span className="font-medium">Logout</span>}
                </>
              )}
            </button>
          </div>
        </div>
      </aside>

      <button
        onClick={() => setSidebarCollapsed((prev) => !prev)}
        className="hidden lg:inline-flex fixed top-1/2 z-50 h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-500 shadow-sm hover:border-blue-200 hover:text-primary transition-all duration-300"
        style={{ left: sidebarCollapsed ? '5rem' : '16rem' }}
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {sidebarCollapsed ? <FiChevronRight className="w-4 h-4" /> : <FiChevronLeft className="w-4 h-4" />}
      </button>

      {/* Main content */}
      <div className={`${sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'} min-h-screen transition-all duration-300`}>
        {/* Top bar */}
        <header className="h-16 bg-white/95 backdrop-blur border-b border-gray-200 flex items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg hover:bg-gray-100"
            >
              <FiMenu className="w-6 h-6" />
            </button>
            <div className="hidden sm:flex items-center gap-2 text-sm text-gray-500 min-w-0">
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;

                return (
                  <div key={`${crumb.path}-${crumb.label}-${index}`} className="flex min-w-0 items-center gap-2">
                    {index > 0 && <FiChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}

                    {isLast ? (
                      <span className="truncate font-medium text-gray-900">{crumb.label}</span>
                    ) : (
                      <Link
                        to={crumb.path}
                        className="truncate font-medium text-gray-700 transition-colors hover:text-primary"
                      >
                        {crumb.label}
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 text-xs font-semibold rounded-full ${roleBadgeClass}`}>
              {user?.role?.toUpperCase()}
            </span>
            <div className="hidden md:block text-right">
              <p className="text-xs text-gray-500">Signed in</p>
              <p className="text-sm font-medium text-gray-800 truncate max-w-45">{user?.full_name}</p>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;
