const {
  createSupabaseAuthClient,
  createSupabaseAdminClient,
  hasSupabaseAdmin
} = require('../config/supabase');

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const isUserAlreadyRegisteredError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('already') && message.includes('registered');
};

const createAuthError = (message, code = 'AUTH_ERROR') => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const requireAdminClient = () => {
  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    throw createAuthError(
      'SUPABASE_SERVICE_ROLE_KEY is required for user provisioning and password reset operations.',
      'SUPABASE_ADMIN_REQUIRED'
    );
  }

  return adminClient;
};

const listAllAuthUsers = async () => {
  const adminClient = requireAdminClient();
  const users = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw error;
    }

    const chunk = data?.users || [];
    users.push(...chunk);

    if (chunk.length < perPage) {
      break;
    }

    page += 1;
  }

  return users;
};

const findAuthUserByEmail = async (email) => {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return null;
  }

  const users = await listAllAuthUsers();
  return users.find((user) => normalizeEmail(user.email) === normalizedEmail) || null;
};

const getAuthUserById = async (authUserId) => {
  if (!authUserId) {
    return null;
  }

  const adminClient = requireAdminClient();
  const { data, error } = await adminClient.auth.admin.getUserById(authUserId);

  if (error) {
    throw error;
  }

  return data?.user || null;
};

const authenticateWithPassword = async (email, password) => {
  const authClient = createSupabaseAuthClient();

  const { data, error } = await authClient.auth.signInWithPassword({
    email: normalizeEmail(email),
    password
  });

  if (error) {
    throw error;
  }

  return data;
};

const getAuthUserFromAccessToken = async (accessToken) => {
  const authClient = createSupabaseAuthClient();
  const { data, error } = await authClient.auth.getUser(accessToken);

  if (error) {
    throw error;
  }

  return data?.user || null;
};

const refreshAuthSession = async (refreshToken) => {
  const authClient = createSupabaseAuthClient();
  const { data, error } = await authClient.auth.refreshSession({
    refresh_token: refreshToken
  });

  if (error) {
    throw error;
  }

  return data?.session || null;
};

const signOutAuthSession = async (accessToken) => {
  if (!accessToken) {
    return;
  }

  const authClient = createSupabaseAuthClient(accessToken);
  await authClient.auth.signOut();
};

const createAuthUser = async ({ email, password, role, fullName }) => {
  const adminClient = requireAdminClient();
  const normalizedEmail = normalizeEmail(email);

  const { data, error } = await adminClient.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: {
      role,
      full_name: fullName
    },
    app_metadata: {
      role
    }
  });

  if (!error) {
    return {
      user: data?.user || null,
      created: true
    };
  }

  if (!isUserAlreadyRegisteredError(error)) {
    throw error;
  }

  const existing = await findAuthUserByEmail(normalizedEmail);

  if (!existing) {
    throw error;
  }

  return {
    user: existing,
    created: false
  };
};

const updateAuthUser = async (authUserId, updates = {}) => {
  if (!authUserId) {
    throw createAuthError('Auth user id is required for update operation.', 'AUTH_USER_ID_REQUIRED');
  }

  const adminClient = requireAdminClient();
  const payload = {};

  if (updates.email !== undefined) {
    payload.email = normalizeEmail(updates.email);
  }

  if (updates.password !== undefined) {
    payload.password = updates.password;
  }

  if (updates.role !== undefined || updates.fullName !== undefined) {
    payload.user_metadata = {
      ...(updates.role !== undefined ? { role: updates.role } : {}),
      ...(updates.fullName !== undefined ? { full_name: updates.fullName } : {})
    };

    if (updates.role !== undefined) {
      payload.app_metadata = { role: updates.role };
    }
  }

  const { data, error } = await adminClient.auth.admin.updateUserById(authUserId, payload);

  if (error) {
    throw error;
  }

  return data?.user || null;
};

const updateCurrentUserPassword = async (accessToken, newPassword) => {
  const authClient = createSupabaseAuthClient(accessToken);
  const { data, error } = await authClient.auth.updateUser({ password: newPassword });

  if (error) {
    throw error;
  }

  return data?.user || null;
};

const deleteAuthUser = async (authUserId) => {
  if (!authUserId) {
    return;
  }

  const adminClient = requireAdminClient();
  const { error } = await adminClient.auth.admin.deleteUser(authUserId);

  if (error) {
    throw error;
  }
};

module.exports = {
  hasSupabaseAdmin,
  normalizeEmail,
  authenticateWithPassword,
  getAuthUserFromAccessToken,
  refreshAuthSession,
  signOutAuthSession,
  createAuthUser,
  updateAuthUser,
  updateCurrentUserPassword,
  deleteAuthUser,
  findAuthUserByEmail,
  getAuthUserById,
  requireAdminClient,
  createAuthError
};
