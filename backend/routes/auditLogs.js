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

    let query = supabase
      .from('audit_logs')
      .select(
        'id, user_id, user_email, user_role, action_type, resource_type, resource_id, api_endpoint, http_method, request_body, response_status, ip_address, user_agent, changes, metadata, created_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending })
      .range(offset, offset + parsedLimit - 1);

    query = applyAuditFilters(query, { search, action_type, user_role, status, quick_view });

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      logs: data || [],
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

module.exports = router;
