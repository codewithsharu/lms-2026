import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  FiActivity,
  FiAlertCircle,
  FiCheckCircle,
  FiChevronRight,
  FiClock,
  FiEye,
  FiFilter,
  FiRefreshCw,
  FiSearch,
  FiShield,
  FiSliders,
  FiUser
} from 'react-icons/fi';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import StatCard from '../../components/ui/StatCard';
import InputField from '../../components/ui/InputField';
import SelectField from '../../components/ui/SelectField';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import { auditLogAPI } from '../../services/api';

const actionOptions = ['ALL', 'LOGIN', 'LOGOUT', 'READ', 'CREATE', 'UPDATE', 'DELETE', 'API_CALL'];
const roleOptions = ['ALL', 'admin', 'teacher', 'student'];
const statusOptions = ['ALL', 'SUCCESS', 'FAILED'];
const sortOptions = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' }
];

const formatTime = (isoValue) => new Date(isoValue).toLocaleString();
const formatRelativeTime = (isoValue) => {
  const diffMs = Date.now() - new Date(isoValue).getTime();
  const minutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const getActionBadgeClass = (action) => {
  if (action === 'LOGIN' || action === 'CREATE') return 'success';
  if (action === 'UPDATE' || action === 'READ' || action === 'API_CALL') return 'info';
  if (action === 'DELETE') return 'warning';
  return 'info';
};

const getStatusBadgeClass = (status) => {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 400) return 'error';
  return 'info';
};

const getStatusLabel = (status) => {
  if (status >= 200 && status < 300) return 'SUCCESS';
  if (status >= 400) return 'FAILED';
  return 'PENDING';
};

const toTitleCase = (value) => {
  if (!value) return 'Unknown';
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
};

const isMeaningfulObject = (value) => {
  if (!value) return false;
  if (typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
};

const getFallbackStats = (auditLogs = []) => ({
  successful: auditLogs.filter((log) => log.response_status >= 200 && log.response_status < 300).length,
  failed: auditLogs.filter((log) => log.response_status >= 400).length,
  loginEvents: auditLogs.filter((log) => log.action_type === 'LOGIN').length
});

const AuditLogs = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedLog, setSelectedLog] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ successful: 0, failed: 0, loginEvents: 0 });
  const [loading, setLoading] = useState(true);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 13, total: 0, totalPages: 1 });
  const [autoSync, setAutoSync] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const syncErrorNotifiedRef = useRef(false);
  const pageSize = 13;

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);

      const response = await auditLogAPI.getAll({
        search: searchQuery.trim(),
        action_type: actionFilter,
        user_role: roleFilter,
        status: statusFilter,
        sort_by: sortBy,
        page: currentPage,
        limit: pageSize
      });

      const fetchedLogs = response.data?.logs || [];
      const fallbackStats = getFallbackStats(fetchedLogs);
      const apiStats = response.data?.stats;

      setLogs(fetchedLogs);
      setStats({
        successful: Number.isFinite(Number(apiStats?.successful))
          ? Number(apiStats.successful)
          : fallbackStats.successful,
        failed: Number.isFinite(Number(apiStats?.failed))
          ? Number(apiStats.failed)
          : fallbackStats.failed,
        loginEvents: Number.isFinite(Number(apiStats?.loginEvents))
          ? Number(apiStats.loginEvents)
          : fallbackStats.loginEvents
      });
      setPagination(response.data?.pagination || { page: 1, limit: pageSize, total: 0, totalPages: 1 });
      setLastSyncedAt(new Date());

      if (syncErrorNotifiedRef.current) {
        toast.success('Audit log sync restored');
        syncErrorNotifiedRef.current = false;
      }
    } catch (error) {
      console.error('Failed to fetch audit logs', error);
      setLogs([]);
      setStats({ successful: 0, failed: 0, loginEvents: 0 });
      setPagination({ page: 1, limit: pageSize, total: 0, totalPages: 1 });

      if (!syncErrorNotifiedRef.current) {
        toast.error('Unable to sync audit logs. Retrying automatically.');
        syncErrorNotifiedRef.current = true;
      }
    } finally {
      setLoading(false);
    }
  }, [searchQuery, actionFilter, roleFilter, statusFilter, sortBy, currentPage, pageSize]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoSync) return undefined;

    const timer = setInterval(() => {
      fetchLogs();
    }, 10000);

    return () => clearInterval(timer);
  }, [autoSync, fetchLogs]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, actionFilter, roleFilter, statusFilter, sortBy]);

  const activeFilterCount = [
    actionFilter !== 'ALL',
    roleFilter !== 'ALL',
    statusFilter !== 'ALL',
    searchQuery.trim().length > 0
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setSearchQuery('');
    setActionFilter('ALL');
    setRoleFilter('ALL');
    setStatusFilter('ALL');
    setSortBy('newest');
    setCurrentPage(1);
  };

  const clearAuditLogs = async () => {
    const confirmationMessage = activeFilterCount > 0
      ? 'Clear all audit logs? Active filters are ignored and every audit record will be deleted. Batch processing will be used for large datasets.'
      : 'Clear all audit logs? This deletes every audit record. Batch processing will be used for large datasets.';

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    try {
      setClearingLogs(true);
      
      let totalDeleted = 0;
      let hasMore = true;
      let batches = 0;
      const loadingToastId = toast.loading('Clearing logs (this may take a while)...');

      while (hasMore) {
        const response = await auditLogAPI.clearAll({ batch_size: 500 });
        const deleted = Number(response.data?.deleted) || 0;
        batches += 1;
        totalDeleted += deleted;
        hasMore = response.data?.hasMore === true;
      }
      
      toast.dismiss(loadingToastId);

      if (totalDeleted === 0) {
        toast('No audit logs to clear');
      } else if (batches > 1) {
        toast.success(`Cleared ${totalDeleted} audit logs in ${batches} batches`);
      } else {
        toast.success(`Cleared ${totalDeleted} audit logs`);
      }

      setSelectedLog(null);

      if (currentPage !== 1) {
        setCurrentPage(1);
      } else {
        await fetchLogs();
      }
    } catch (error) {
      console.error('Failed to clear audit logs', error);
      toast.error('Unable to clear audit logs. Please try again.');
    } finally {
      setClearingLogs(false);
    }
  };

  const activeFilterSummary = [
    searchQuery.trim() ? `Search: ${searchQuery.trim()}` : null,
    actionFilter !== 'ALL' ? `Action: ${actionFilter}` : null,
    roleFilter !== 'ALL' ? `Role: ${roleFilter}` : null,
    statusFilter !== 'ALL' ? `Status: ${statusFilter}` : null
  ].filter(Boolean);

  const totalPages = Math.max(1, pagination.totalPages || 1);

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1>Audit Logs</h1>
            <p className="text-gray-500">Track every API request and user action across the platform.</p>
          </div>
          <div className="status-badge info">Live Logs</div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={FiActivity} label="Visible Logs" value={pagination.total || 0} iconColorClass="bg-primary" />
          <StatCard icon={FiCheckCircle} label="Successful" value={stats.successful} iconColorClass="bg-emerald-600" />
          <StatCard icon={FiAlertCircle} label="Failed" value={stats.failed} iconColorClass="bg-red-500" />
          <StatCard icon={FiClock} label="Login Events" value={stats.loginEvents} iconColorClass="bg-slate-700" />
        </div>

        <Card>
          <Card.Body className="py-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <FiShield className="w-4 h-4 text-primary" />
                <span>Showing {logs.length} of {pagination.total || 0} audit records</span>
                {activeFilterCount > 0 && <span>{activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active</span>}
              </div>
              <div className="text-xs text-gray-500">Live audit records from backend API</div>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
              <span>{lastSyncedAt ? `Last synced: ${lastSyncedAt.toLocaleTimeString()}` : 'Waiting for first sync...'}</span>
              <button
                type="button"
                onClick={() => setAutoSync((prev) => !prev)}
                className={`px-3 py-1.5 rounded-full border font-semibold transition-colors ${
                  autoSync
                    ? 'bg-blue-50 text-primary border-blue-200'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                Auto Sync: {autoSync ? 'ON' : 'OFF'}
              </button>
            </div>

          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <FiSliders className="w-4 h-4 text-primary" />
                <span>Filters</span>
              </div>

              <div className="flex flex-col lg:flex-row lg:items-end gap-3 lg:gap-4">
              <InputField
                label="Search"
                leftIcon={FiSearch}
                className="w-full lg:flex-1"
                placeholder="Search email, endpoint, action, status..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              <SelectField
                label="Action"
                className="w-full sm:w-52"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
              >
                {actionOptions.map((action) => (
                  <option key={action} value={action}>
                    {action === 'ALL' ? 'All Actions' : action}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="User Role"
                className="w-full sm:w-44"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role === 'ALL' ? 'All Roles' : role}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Status"
                className="w-full sm:w-44"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status === 'ALL' ? 'All Statuses' : status}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Sort"
                className="w-full sm:w-44"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>

              <Button
                variant="danger"
                className="w-full sm:w-auto h-[42px] mt-0 lg:mt-[23px] inline-flex items-center justify-center gap-2"
                onClick={clearAuditLogs}
                disabled={loading || clearingLogs}
              >
                <FiRefreshCw className={`w-4 h-4 ${clearingLogs ? 'animate-spin' : ''}`} />
                {clearingLogs ? 'Clearing...' : 'Clear'}
              </Button>
            </div>

              <p className="text-xs text-gray-500 pt-1">
                {activeFilterSummary.length > 0
                  ? `Active filters: ${activeFilterSummary.join(' • ')}`
                  : 'Use filters to narrow down records quickly.'}
              </p>
            </div>
          </Card.Header>

          <Card.Body className="p-0">
            <div className="md:hidden p-4 space-y-3">
              {logs.length > 0 ? (
                logs.map((log) => (
                  <div key={log.id} className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800 truncate">{log.user_email}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{formatTime(log.created_at)} · {formatRelativeTime(log.created_at)}</p>
                      </div>
                      <Button
                        variant="secondary"
                        className="!py-1 !px-2 inline-flex items-center gap-1"
                        onClick={() => setSelectedLog(log)}
                      >
                        <FiEye className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={`status-badge ${getActionBadgeClass(log.action_type)}`}>{log.action_type}</span>
                      <span className={`status-badge ${getStatusBadgeClass(log.response_status)}`}>{getStatusLabel(log.response_status)}</span>
                      <span className="status-badge info">{log.http_method}</span>
                    </div>

                    <p className="mt-2 text-sm text-gray-600 truncate">{log.api_endpoint}</p>
                  </div>
                ))
              ) : (
                <div className="text-center py-10 text-gray-500">No logs found for the current filters.</div>
              )}
            </div>

            <div className="hidden md:block table-shell rounded-none border-0">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>User</th>
                    <th>Action</th>
                    <th>Resource</th>
                    <th className="w-[150px]">Status</th>
                    <th>Request</th>
                    <th className="text-right">View</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length > 0 ? (
                    logs.map((log) => (
                      <tr key={log.id}>
                        <td className="text-gray-600 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span>{formatTime(log.created_at)}</span>
                            <span className="text-xs text-gray-400">{formatRelativeTime(log.created_at)}</span>
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center gap-2 min-w-[220px]">
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                              <FiUser className="w-4 h-4" />
                            </span>
                            <div>
                              <p className="font-medium text-gray-800 leading-tight">{log.user_email}</p>
                              <p className="text-xs text-gray-500 uppercase">{log.user_role}</p>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`status-badge ${getActionBadgeClass(log.action_type)}`}>
                            {log.action_type}
                          </span>
                        </td>
                        <td>{toTitleCase(log.resource_type)}</td>
                        <td className="w-[150px]">
                          <span className={`status-badge whitespace-nowrap ${getStatusBadgeClass(log.response_status)}`}>
                            {getStatusLabel(log.response_status)} {log.response_status}
                          </span>
                        </td>
                        <td className="max-w-[280px]">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="status-badge info">{log.http_method}</span>
                            <span className="truncate" title={log.api_endpoint}>{log.api_endpoint}</span>
                          </div>
                        </td>
                        <td>
                          <div className="flex justify-end">
                            <Button
                              variant="secondary"
                              className="!py-1.5 !px-3 inline-flex items-center gap-1.5"
                              onClick={() => setSelectedLog(log)}
                            >
                              <FiEye className="w-4 h-4" />
                              View
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-gray-500">
                        <div className="flex flex-col items-center gap-3">
                          <p>No logs found for the current filters.</p>
                          <Button variant="secondary" className="inline-flex items-center gap-2" onClick={clearAllFilters}>
                            <FiFilter className="w-4 h-4" />
                            Reset filters
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="border-t border-gray-100 px-4 py-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p className="text-sm text-gray-600">
                  {(pagination.total || 0) > 0
                    ? `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, pagination.total)} of ${pagination.total}`
                    : 'Showing 0 records'}
                </p>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                  <div className="flex items-center gap-2 min-w-0 sm:min-w-65">
                    <span className="text-xs text-gray-500 whitespace-nowrap">Page</span>
                    <input
                      type="range"
                      min={1}
                      max={totalPages}
                      step={1}
                      value={currentPage}
                      onChange={(event) => setCurrentPage(Number(event.target.value))}
                      disabled={loading || totalPages === 1}
                      aria-label="Select audit log page"
                      className="w-full accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <span className="text-sm text-gray-600 whitespace-nowrap">{currentPage}/{totalPages}</span>
                  </div>

                  <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    className="!py-1.5 !px-3"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={loading || currentPage === 1}
                  >
                    Previous
                  </Button>

                  <Button
                    variant="secondary"
                    className="!py-1.5 !px-3"
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={loading || currentPage === totalPages}
                  >
                    Next
                  </Button>
                  </div>
                </div>
              </div>
            </div>
          </Card.Body>
        </Card>

        <Modal
          open={!!selectedLog}
          onClose={() => setSelectedLog(null)}
          title="Audit Log Details"
          subtitle={selectedLog ? `${selectedLog.action_type} • ${selectedLog.user_email}` : ''}
          maxWidth="max-w-3xl"
          footer={
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setSelectedLog(null)}>
                Close
              </Button>
            </div>
          }
        >
          {selectedLog && (
            <div className="space-y-5">
              {(() => {
                const queryParams = selectedLog.metadata?.query_params;
                const routeParams = selectedLog.metadata?.route_params;
                const durationMs = selectedLog.metadata?.duration_ms;
                const payloadBytes = selectedLog.metadata?.payload_bytes;
                const payload = selectedLog.request_body;
                const hasChanges = isMeaningfulObject(selectedLog.changes);

                return (
                  <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`status-badge ${getActionBadgeClass(selectedLog.action_type)}`}>{selectedLog.action_type}</span>
                <span className={`status-badge ${getStatusBadgeClass(selectedLog.response_status)}`}>{selectedLog.response_status}</span>
                <span className="status-badge info">{selectedLog.http_method}</span>
                <span className="status-badge info uppercase">{selectedLog.user_role}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Timestamp</p>
                  <p className="mt-1 font-medium text-gray-800">{formatTime(selectedLog.created_at)}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Request</p>
                  <p className="mt-1 font-medium text-gray-800 break-words">{selectedLog.http_method} {selectedLog.api_endpoint}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Resource</p>
                  <p className="mt-1 font-medium text-gray-800">{toTitleCase(selectedLog.resource_type)}</p>
                  {selectedLog.resource_id && (
                    <p className="text-xs text-gray-500 mt-1 break-all">ID: {selectedLog.resource_id}</p>
                  )}
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Status / IP</p>
                  <p className="mt-1 font-medium text-gray-800">{selectedLog.response_status} • {selectedLog.ip_address}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 md:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-gray-500">User Agent</p>
                  <p className="mt-1 font-medium text-gray-800 break-words">{selectedLog.user_agent}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Payload Size</p>
                  <p className="mt-1 font-medium text-gray-800">{payloadBytes || 0} bytes</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Duration</p>
                  <p className="mt-1 font-medium text-gray-800">{durationMs ? `${durationMs} ms` : 'N/A'}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Payload</p>
                  <pre className="text-xs bg-gray-900 text-gray-100 rounded-xl p-3 overflow-auto hide-scrollbar">{JSON.stringify(payload || {}, null, 2)}</pre>
                </div>

                {isMeaningfulObject(queryParams) && (
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-2">Query Params</p>
                    <pre className="text-xs bg-gray-900 text-gray-100 rounded-xl p-3 overflow-auto hide-scrollbar">{JSON.stringify(queryParams, null, 2)}</pre>
                  </div>
                )}

                {isMeaningfulObject(routeParams) && (
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-2">Route Params</p>
                    <pre className="text-xs bg-gray-900 text-gray-100 rounded-xl p-3 overflow-auto hide-scrollbar">{JSON.stringify(routeParams, null, 2)}</pre>
                  </div>
                )}

                {hasChanges && (
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-2">Changes</p>
                    <pre className="text-xs bg-gray-900 text-gray-100 rounded-xl p-3 overflow-auto hide-scrollbar">{JSON.stringify(selectedLog.changes, null, 2)}</pre>
                  </div>
                )}

                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 flex items-center gap-2">
                  <FiChevronRight className="w-3.5 h-3.5 text-primary" />
                  Showing only essential data for troubleshooting: IP, request, payload, params, and changes.
                </div>
              </div>
                  </>
                );
              })()}
            </div>
          )}
        </Modal>
      </div>
    </Layout>
  );
};

export default AuditLogs;
