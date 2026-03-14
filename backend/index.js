require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const supabase = require('./config/supabase');
const { auditMiddleware } = require('./middleware/audit');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const classRoutes = require('./routes/classes');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration for cookies
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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

// Base routes
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the College Assessment Platform API' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

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
      'audit_logs'
    ];

    const tables = await Promise.all(expectedTables.map(async (tableName) => {
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
          error: countError.message
        };
      }

      let latestUpdatedAt = null;
      let latestCreatedAt = null;

      const { data: updatedRow, error: updatedError } = await supabase
        .from(tableName)
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!updatedError && updatedRow?.updated_at) {
        latestUpdatedAt = updatedRow.updated_at;
      }

      const { data: createdRow, error: createdError } = await supabase
        .from(tableName)
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!createdError && createdRow?.created_at) {
        latestCreatedAt = createdRow.created_at;
      }

      return {
        table: tableName,
        exists: true,
        rowCount: count || 0,
        latestUpdatedAt,
        latestCreatedAt
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
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
