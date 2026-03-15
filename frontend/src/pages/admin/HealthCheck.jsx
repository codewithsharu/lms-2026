import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiAlertCircle, FiCheckCircle, FiDatabase, FiEye, FiRefreshCw } from 'react-icons/fi';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import StatCard from '../../components/ui/StatCard';
import Button from '../../components/ui/Button';
import { systemAPI } from '../../services/api';

const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : '—');

const HealthCheck = () => {
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = useCallback(async (showToast = false) => {
    try {
      setLoading((prev) => (dbStatus ? prev : true));
      setRefreshing(Boolean(dbStatus));
      const response = await systemAPI.getDbStatus();
      setDbStatus(response.data);
      if (showToast) toast.success('Health check refreshed');
    } catch {
      if (showToast) toast.error('Failed to refresh health check');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dbStatus]);

  useEffect(() => {
    fetchStatus(false);
  }, [fetchStatus]);

  const tableRows = dbStatus?.schema?.tables || [];

  const tableSummary = useMemo(() => {
    const total = dbStatus?.schema?.expectedTableCount || 0;
    const available = dbStatus?.schema?.accessibleTableCount || 0;
    return {
      total,
      available,
      missing: Math.max(0, total - available)
    };
  }, [dbStatus]);

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1>System Health Check</h1>
            <p className="text-gray-500">Visual check of currently configured Supabase tables for testing.</p>
          </div>
          <Button variant="secondary" onClick={() => fetchStatus(true)} disabled={refreshing || loading}>
            <FiRefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatCard icon={FiDatabase} label="Expected Tables" value={tableSummary.total} iconColorClass="bg-primary" />
          <StatCard icon={FiCheckCircle} label="Configured" value={tableSummary.available} iconColorClass="bg-emerald-600" />
          <StatCard icon={FiAlertCircle} label="Missing" value={tableSummary.missing} iconColorClass="bg-red-500" />
        </div>

        <Card>
          <Card.Header>
            <div className="flex flex-col gap-1">
              <h2 className="section-title">Supabase Tables</h2>
              <p className="text-sm text-gray-500">Status: {dbStatus?.status || 'Unknown'} {dbStatus?.checkedAt ? `• Checked at ${new Date(dbStatus.checkedAt).toLocaleString()}` : ''}</p>
            </div>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, index) => (
                  <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : tableRows.length > 0 ? (
              <div className="table-shell overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th>Status</th>
                      <th>Rows</th>
                      <th>Schema</th>
                      <th>Latest Updated</th>
                      <th>Latest Created</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((table) => (
                      <tr key={table.table}>
                        <td className="font-medium text-slate-800">{table.table}</td>
                        <td>
                          <span className={`status-badge ${table.exists ? 'success' : 'error'}`}>
                            {table.exists ? 'Configured' : 'Missing'}
                          </span>
                        </td>
                        <td>{table.rowCount ?? '—'}</td>
                        <td>
                          <Link
                            to={`/admin/health-check/${table.table}`}
                            className="btn btn-secondary !h-9 !px-3 inline-flex items-center gap-2"
                          >
                            <FiEye className="h-4 w-4" />
                            View Details
                          </Link>
                        </td>
                        <td>{formatDateTime(table.latestUpdatedAt)}</td>
                        <td>{formatDateTime(table.latestCreatedAt)}</td>
                        <td className="text-xs text-red-600 max-w-xs">{table.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No table status returned from backend health API.</p>
            )}
          </Card.Body>
        </Card>
      </div>
    </Layout>
  );
};

export default HealthCheck;
