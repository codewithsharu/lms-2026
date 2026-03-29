const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DEFAULT_REQUIRED_TABLES = [
  'users',
  'classes',
  'sections',
  'student_details',
  'teacher_details',
  'teacher_assignments',
  'audit_logs',
  'assessment_templates',
  'hosted_assessments',
  'hosted_assessment_student_targets',
  'assessment_attempts'
];

const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).toLowerCase() === 'true';
};

const parseDbUrl = (dbUrl) => {
  const parsed = new URL(dbUrl);
  const username = decodeURIComponent(parsed.username || '');
  const password = decodeURIComponent(parsed.password || '');
  const database = (parsed.pathname || '/postgres').replace(/^\//, '') || 'postgres';

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: username,
    password,
    database,
    ssl: { rejectUnauthorized: false }
  };
};

const getRequiredTables = () => {
  const raw = process.env.REQUIRED_SCHEMA_TABLES;

  if (!raw) return DEFAULT_REQUIRED_TABLES;

  const configured = raw
    .split(',')
    .map((table) => table.trim())
    .filter(Boolean);

  return configured.length > 0 ? configured : DEFAULT_REQUIRED_TABLES;
};

const getMissingTables = async (client, requiredTables) => {
  const { rows } = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [requiredTables]
  );

  const existing = new Set(rows.map((row) => row.table_name));
  return requiredTables.filter((tableName) => !existing.has(tableName));
};

const bootstrapSchemaOnStart = async () => {
  const autoSyncEnabled = parseBoolean(process.env.AUTO_SCHEMA_SYNC_ON_START, true);

  if (!autoSyncEnabled) {
    console.log('[SchemaSync] AUTO_SCHEMA_SYNC_ON_START=false, skipping schema bootstrap.');
    return;
  }

  const dbUrl = process.env.SUPABASE_DB_URL;

  if (!dbUrl) {
    console.warn('[SchemaSync] SUPABASE_DB_URL is missing, skipping schema bootstrap.');
    return;
  }

  const requiredTables = getRequiredTables();
  const schemaFile = process.env.SCHEMA_SQL_PATH || path.join(__dirname, 'schema.sql');

  if (!fs.existsSync(schemaFile)) {
    throw new Error(`[SchemaSync] Schema file not found: ${schemaFile}`);
  }

  const sql = fs.readFileSync(schemaFile, 'utf8');
  const client = new Client(parseDbUrl(dbUrl));

  await client.connect();

  try {
    const missingBefore = await getMissingTables(client, requiredTables);

    if (missingBefore.length > 0) {
      console.log(`[SchemaSync] Missing tables detected: ${missingBefore.join(', ')}. Applying ${path.basename(schemaFile)}...`);
    } else {
      console.log(`[SchemaSync] Required tables exist. Applying ${path.basename(schemaFile)} for idempotent schema migrations...`);
    }

    await client.query(sql);

    const missingAfter = await getMissingTables(client, requiredTables);

    if (missingAfter.length > 0) {
      throw new Error(`[SchemaSync] Schema apply incomplete. Still missing: ${missingAfter.join(', ')}`);
    }

    try {
      await client.query(`NOTIFY pgrst, 'reload schema';`);
      console.log('[SchemaSync] PostgREST schema reload triggered.');
    } catch (reloadError) {
      console.warn(`[SchemaSync] Could not trigger PostgREST schema reload: ${reloadError.message}`);
    }

    console.log('[SchemaSync] Schema synchronized successfully.');
  } finally {
    await client.end();
  }
};

module.exports = {
  bootstrapSchemaOnStart
};
