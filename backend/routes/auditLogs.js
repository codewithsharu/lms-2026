const express = require('express');
const supabase = require('../config/supabase');
const { verifyToken, isAdmin } = require('../middleware/auth');

const router = express.Router();

const applyAuditFilters = (query, filters) => {
  const {
    search,
    action_type,
    user_role,
    status,
    quick_view
  } = filters;

  if (search) {
    query.or(
      `user_email.ilike.%${search}%,api_endpoint.ilike.%${search}%,action_type.ilike.%${search}%,resource_type.ilike.%${search}%`
    );
  }

  if (action_type && action_type !== 'ALL') {
    query.eq('action_type', action_type);
  }

  if (user_role && user_role !== 'ALL') {
    query.eq('user_role', user_role);
  }

  if (status === 'SUCCESS') {
    query.gte('response_status', 200).lt('response_status', 300);
  } else if (status === 'FAILED') {
    query.gte('response_status', 400);
  }

  if (quick_view === 'FAILED') {
    query.gte('response_status', 400);
  } else if (quick_view === 'AUTH') {
    query.ilike('api_endpoint', '%/auth/%');
  } else if (quick_view === 'ADMIN') {
    query.eq('user_role', 'admin');
  }

  return query;
};

const getBatchSize = (rawValue) => {
  const parsedValue = parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue)) {
    return 500;
  }

  return Math.min(Math.max(parsedValue, 100), 1000);
};

router.get('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const {
      search = '',
      action_type = 'ALL',
      user_role = 'ALL',
      status = 'ALL',
      quick_view = 'ALL',
      sort_by = 'newest',
      page = 1,
      limit = 13
    } = req.query;

    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 13, 1), 100);
    const offset = (parsedPage - 1) * parsedLimit;
    const ascending = sort_by === 'oldest';
    const filters = { search, action_type, user_role, status, quick_view };

    let query = supabase
      .from('audit_logs')
      .select(
        'id, user_id, user_email, user_role, action_type, resource_type, resource_id, api_endpoint, http_method, request_body, response_status, ip_address, user_agent, changes, metadata, created_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending })
      .range(offset, offset + parsedLimit - 1);

    query = applyAuditFilters(query, filters);

    const { data, error, count } = await query;

    if (error) throw error;

    const [successfulResult, failedResult, loginEventsResult] = await Promise.all([
      applyAuditFilters(
        supabase
          .from('audit_logs')
          .select('id', { count: 'exact', head: true }),
        filters
      )
        .gte('response_status', 200)
        .lt('response_status', 300),
      applyAuditFilters(
        supabase
          .from('audit_logs')
          .select('id', { count: 'exact', head: true }),
        filters
      )
        .gte('response_status', 400),
      applyAuditFilters(
        supabase
          .from('audit_logs')
          .select('id', { count: 'exact', head: true }),
        filters
      )
        .eq('action_type', 'LOGIN')
    ]);

    if (successfulResult.error) throw successfulResult.error;
    if (failedResult.error) throw failedResult.error;
    if (loginEventsResult.error) throw loginEventsResult.error;

    res.json({
      logs: data || [],
      stats: {
        successful: successfulResult.count || 0,
        failed: failedResult.count || 0,
        loginEvents: loginEventsResult.count || 0
      },
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total: count || 0,
        totalPages: Math.max(1, Math.ceil((count || 0) / parsedLimit))
      }
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

router.delete('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const batchSize = getBatchSize(req.query.batch_size);

    const { data: batchRows, error: fetchBatchError } = await supabase
      .from('audit_logs')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (fetchBatchError) throw fetchBatchError;

    if (!Array.isArray(batchRows) || batchRows.length === 0) {
      return res.json({
        message: 'No audit logs to clear',
        deleted: 0,
        hasMore: false,
        batchSize
      });
    }

    const batchIds = batchRows.map((row) => row.id).filter(Boolean);

    if (batchIds.length === 0) {
      return res.json({
        message: 'No valid audit logs to clear',
        deleted: 0,
        hasMore: false,
        batchSize
      });
    }

    const { error: deleteBatchError } = await supabase
      .from('audit_logs')
      .delete()
      .in('id', batchIds);

    if (deleteBatchError) throw deleteBatchError;

    const hasMore = batchIds.length === batchSize;

    res.json({
      message: 'Audit logs batch cleared successfully',
      deleted: batchIds.length,
      hasMore,
      batchSize
    });
  } catch (error) {
    console.error('Clear audit logs error:', error);
    res.status(500).json({ error: 'Failed to clear audit logs' });
  }
});

module.exports = router;
