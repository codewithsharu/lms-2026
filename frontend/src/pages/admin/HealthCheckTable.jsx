import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FiAlertCircle, FiArrowLeft, FiCheckCircle, FiDatabase, FiRefreshCw, FiTable } from 'react-icons/fi';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import StatCard from '../../components/ui/StatCard';
import Button from '../../components/ui/Button';
import { systemAPI } from '../../services/api';

const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : '—');

const HealthCheckTable = () => {
  const { tableName } = useParams();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dbStatus, setDbStatus] = useState(null);

  const fetchStatus = useCallback(async (showToast = false) => {
    try {
      setLoading((prev) => (dbStatus ? prev : true));
      setRefreshing(Boolean(dbStatus));
      const response = await systemAPI.getDbStatus();
      setDbStatus(response.data);
      if (showToast) toast.success('Table details refreshed');
    } catch {
      if (showToast) toast.error('Failed to refresh table details');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dbStatus]);

  useEffect(() => {
    fetchStatus(false);
  }, [fetchStatus]);

  const selectedTable = useMemo(() => {
    const tables = dbStatus?.schema?.tables || [];
    return tables.find((table) => table.table === tableName) || null;
  }, [dbStatus, tableName]);

  const columns = selectedTable?.schema?.columns || [];
  const sampleRows = selectedTable?.sampleRows || [];

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2">
              <Link to="/admin/health-check" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-dark">
                <FiArrowLeft className="h-4 w-4" />
                Back to Health Check
              </Link>
            </div>
            <h1 className="capitalize">{tableName} Details</h1>
            <p className="text-gray-500">Professional schema and real data preview for testing and validation.</p>
          </div>
          <Button variant="secondary" onClick={() => fetchStatus(true)} disabled={refreshing || loading}>
            <FiRefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : !selectedTable ? (
          <Card>
            <Card.Body>
              <p className="text-sm text-slate-600">Table not found in current health-check response.</p>
            </Card.Body>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                icon={FiDatabase}
                label="Status"
                value={selectedTable.exists ? 'Configured' : 'Missing'}
                iconColorClass={selectedTable.exists ? 'bg-emerald-600' : 'bg-red-500'}
              />
              <StatCard
                icon={FiTable}
                label="Rows"
                value={selectedTable.rowCount ?? '—'}
                iconColorClass="bg-primary"
              />
              <StatCard
                icon={FiCheckCircle}
                label="Columns"
                value={columns.length}
                iconColorClass="bg-slate-700"
              />
              <StatCard
                icon={FiAlertCircle}
                label="Sample Rows"
                value={sampleRows.length}
                iconColorClass="bg-indigo-600"
              />
            </div>

            <Card>
              <Card.Header>
                <div className="flex flex-col gap-1">
                  <h2 className="section-title">Table Meta</h2>
                  <p className="text-sm text-gray-500">
                    Schema: {selectedTable.schema?.tableSchema || 'public'} • Source: {selectedTable.schema?.source || 'unknown'}
                  </p>
                </div>
              </Card.Header>
              <Card.Body>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="surface-card-muted p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Latest Updated</p>
                    <p className="mt-1 text-sm font-medium text-slate-800">{formatDateTime(selectedTable.latestUpdatedAt)}</p>
                  </div>
                  <div className="surface-card-muted p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Latest Created</p>
                    <p className="mt-1 text-sm font-medium text-slate-800">{formatDateTime(selectedTable.latestCreatedAt)}</p>
                  </div>
                </div>

                {selectedTable.error && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {selectedTable.error}
                  </div>
                )}
              </Card.Body>
            </Card>

            <Card>
              <Card.Header>
                <h2 className="section-title">Schema Columns</h2>
              </Card.Header>
              <Card.Body>
                {columns.length > 0 ? (
                  <div className="table-shell overflow-x-auto">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Column Name</th>
                        </tr>
                      </thead>
                      <tbody>
                        {columns.map((columnName, index) => (
                          <tr key={columnName}>
                            <td>{index + 1}</td>
                            <td className="font-medium text-slate-800">{columnName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No schema columns available.</p>
                )}
              </Card.Body>
            </Card>

            <Card>
              <Card.Header>
                <h2 className="section-title">Real Data Preview</h2>
              </Card.Header>
              <Card.Body>
                {sampleRows.length > 0 && columns.length > 0 ? (
                  <div className="table-shell overflow-x-auto">
                    <table>
                      <thead>
                        <tr>
                          {columns.map((columnName) => (
                            <th key={columnName}>{columnName}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sampleRows.map((row, rowIndex) => (
                          <tr key={`${selectedTable.table}-sample-${rowIndex}`}>
                            {columns.map((columnName) => (
                              <td key={`${selectedTable.table}-${rowIndex}-${columnName}`} className="align-top">
                                {row[columnName] === null || row[columnName] === undefined ? 'NULL' : String(row[columnName])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No sample data available for this table yet.</p>
                )}
              </Card.Body>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
};

export default HealthCheckTable;
