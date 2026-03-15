require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const supabase = require('./config/supabase');
const { auditMiddleware } = require('./middleware/audit');
const { bootstrapSchemaOnStart } = require('./database/bootstrap-schema');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const classRoutes = require('./routes/classes');
const auditLogRoutes = require('./routes/auditLogs');
const assessmentRoutes = require('./routes/assessments');

const app = express();
const PORT = process.env.PORT || 5000;

const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://lms-2026-pi.vercel.app'
];

const allowedOrigins = (
  process.env.FRONTEND_URLS || process.env.FRONTEND_URL || ''
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOriginAllowList = allowedOrigins.length > 0
  ? allowedOrigins
  : defaultAllowedOrigins;

// CORS configuration for cookies
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || corsOriginAllowList.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true, // Allow cookies to be sent
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// Middleware
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(auditMiddleware);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/assessments', assessmentRoutes);

// Base routes
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the College Assessment Platform API' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const sensitivePreviewFields = ['password', 'password_hash', 'token', 'secret', 'authorization', 'cookie'];

const sanitizePreviewValue = (fieldName, value) => {
  const normalizedFieldName = String(fieldName || '').toLowerCase();

  if (sensitivePreviewFields.includes(normalizedFieldName)) {
    return '[REDACTED]';
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'object') {
    try {
      const serialized = JSON.stringify(value);
      return serialized.length > 180 ? `${serialized.slice(0, 180)}...` : serialized;
    } catch {
      return '[OBJECT]';
    }
  }

  const stringValue = String(value);
  return stringValue.length > 180 ? `${stringValue.slice(0, 180)}...` : stringValue;
};

const buildSamplePreview = (row) => {
  if (!row || typeof row !== 'object') return null;

  return Object.entries(row).reduce((acc, [key, value]) => {
    acc[key] = sanitizePreviewValue(key, value);
    return acc;
  }, {});
};

// Test Supabase connection
app.get('/api/db-status', async (req, res) => {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      return res.status(500).json({
        status: 'error',
        message: 'Supabase credentials are not configured'
      });
    }

    const expectedTables = [
      'users',
      'classes',
      'sections',
      'student_details',
      'teacher_details',
      'teacher_assignments',
      'audit_logs',
      'assessment_templates',
      'hosted_assessments',
      'assessment_attempts'
    ];

    const expectedTableSchemas = {
      users: ['id', 'email', 'password_hash', 'full_name', 'phone', 'profile_photo', 'role', 'is_active', 'created_at', 'updated_at', 'created_by', 'last_login'],
      classes: ['id', 'name', 'description', 'academic_year', 'is_active', 'created_at', 'updated_at'],
      sections: ['id', 'class_id', 'name', 'description', 'is_active', 'created_at', 'updated_at'],
      student_details: ['id', 'user_id', 'roll_number', 'class_id', 'section_id', 'zone', 'date_of_birth', 'gender', 'address', 'guardian_name', 'guardian_phone', 'admission_date', 'created_at', 'updated_at'],
      teacher_details: ['id', 'user_id', 'employee_id', 'department', 'qualification', 'experience_years', 'specialization', 'joining_date', 'created_at', 'updated_at'],
      teacher_assignments: ['id', 'teacher_id', 'class_id', 'section_id', 'zone', 'assigned_at', 'assigned_by'],
      audit_logs: ['id', 'user_id', 'user_email', 'user_role', 'action_type', 'resource_type', 'resource_id', 'api_endpoint', 'http_method', 'request_body', 'response_status', 'ip_address', 'user_agent', 'changes', 'metadata', 'created_at'],
      assessment_templates: ['id', 'teacher_id', 'title', 'subject', 'description', 'question_count', 'total_marks', 'passing_percentage', 'template_data', 'is_active', 'created_at', 'updated_at'],
      hosted_assessments: ['id', 'template_id', 'host_id', 'class_id', 'section_id', 'zone', 'duration_minutes', 'max_attempts', 'result_mode', 'publish_status', 'start_time', 'end_time', 'instructions', 'created_at', 'updated_at'],
      assessment_attempts: ['id', 'hosted_assessment_id', 'student_id', 'attempt_number', 'status', 'answers', 'score', 'total_marks', 'percentage', 'correct_count', 'total_questions', 'started_at', 'submitted_at', 'created_at', 'updated_at']
    };

    const tables = await Promise.all(expectedTables.map(async (tableName) => {
      const { error: probeError } = await supabase
        .from(tableName)
        .select('id')
        .limit(1);

      if (probeError) {
        return {
          table: tableName,
          exists: false,
          rowCount: null,
          latestUpdatedAt: null,
          latestCreatedAt: null,
          schema: {
            tableSchema: 'public',
            source: 'expected',
            columns: expectedTableSchemas[tableName] || []
          },
          error: probeError.message
        };
      }

      const { count, error: countError } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });

      if (countError) {
        return {
          table: tableName,
          exists: false,
          rowCount: null,
          latestUpdatedAt: null,
          latestCreatedAt: null,
          schema: {
            tableSchema: 'public',
            source: 'expected',
            columns: expectedTableSchemas[tableName] || []
          },
          error: countError.message
        };
      }

      const { data: sampleRowsData, error: sampleError } = await supabase
        .from(tableName)
        .select('*')
        .limit(5);

      const sampleRows = Array.isArray(sampleRowsData) ? sampleRowsData : [];
      const sampleRow = sampleRows[0] || null;

      const inferredColumns = !sampleError && sampleRow && typeof sampleRow === 'object'
        ? Object.keys(sampleRow)
        : [];

      const schemaColumns = inferredColumns.length > 0
        ? inferredColumns
        : (expectedTableSchemas[tableName] || []);

      const hasUpdatedAt = schemaColumns.includes('updated_at');
      const hasCreatedAt = schemaColumns.includes('created_at');

      let latestUpdatedAt = null;
      let latestCreatedAt = null;

      if (hasCreatedAt) {
        const { data: createdRow, error: createdError } = await supabase
          .from(tableName)
          .select('created_at')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!createdError && createdRow?.created_at) {
          latestCreatedAt = createdRow.created_at;
        }
      }

      if (hasUpdatedAt) {
        const { data: updatedRow, error: updatedError } = await supabase
          .from(tableName)
          .select('updated_at')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!updatedError && updatedRow?.updated_at) {
          latestUpdatedAt = updatedRow.updated_at;
        }
      } else {
        latestUpdatedAt = latestCreatedAt;
      }

      return {
        table: tableName,
        exists: true,
        rowCount: count || 0,
        latestUpdatedAt,
        latestCreatedAt,
        sampleData: buildSamplePreview(sampleRow),
        sampleRows: sampleRows.map((row) => buildSamplePreview(row)),
        schema: {
          tableSchema: 'public',
          source: inferredColumns.length > 0 ? 'inferred' : 'expected',
          columns: schemaColumns
        }
      };
    }));

    const missingTables = tables
      .filter((tableInfo) => !tableInfo.exists)
      .map((tableInfo) => tableInfo.table);

    const status = missingTables.length === 0 ? 'connected' : 'partial';

    res.json({
      status,
      checkedAt: new Date().toISOString(),
      message: 'Supabase health check completed',
      schema: {
        expectedTableCount: expectedTables.length,
        accessibleTableCount: tables.filter((tableInfo) => tableInfo.exists).length,
        missingTables,
        tables
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const startServer = async () => {
  try {
    await bootstrapSchemaOnStart();

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('[Startup] Failed to initialize server:', error.message);
    process.exit(1);
  }
};

startServer();
