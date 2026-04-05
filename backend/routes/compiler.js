const express = require('express');

const router = express.Router();

const ONECOMPILER_API_BASE = 'https://api.onecompiler.com';
const ONECOMPILER_PUBLIC_BASE = 'https://onecompiler.com';
const ONECOMPILER_TIMEOUT_MS = Number.parseInt(process.env.ONECOMPILER_TIMEOUT_MS || '25000', 10);

const languageExtensionMap = {
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  csharp: 'cs',
  go: 'go',
  ruby: 'rb',
  php: 'php'
};

const getOneCompilerApiKey = () => {
  const candidates = [
    process.env.ONECOMPILER_API_KEY,
    process.env.ONE_COMPILER_API_KEY,
    process.env.ONECOMPILER_ACCESS_TOKEN,
    process.env.ONECOMPILER_KEY
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
};

const getErrorMessageFromUpstream = (payload, fallback) => {
  if (!payload) return fallback;

  if (typeof payload === 'string') {
    return payload;
  }

  return (
    payload.error ||
    payload.message ||
    payload.reason ||
    payload.errorMessage ||
    payload?.data?.error ||
    fallback
  );
};

const toChallengeList = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.value)) {
    return payload.value;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return [];
};

const normalizeChallengeSummary = (row) => {
  const tags = Array.isArray(row?.tags)
    ? row.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];

  return {
    id: String(row?._id || row?.id || row?.challengeId || '').trim(),
    title: String(row?.title || row?.name || 'Untitled Challenge').trim(),
    slug: String(row?.link || row?.slug || '').trim() || null,
    tags,
    raw: row
  };
};

const readJsonOrText = async (response) => {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const callOneCompiler = async ({ url, method = 'GET', headers = {}, body }) => {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(ONECOMPILER_TIMEOUT_MS) ? ONECOMPILER_TIMEOUT_MS : 25000;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });

    const payload = await readJsonOrText(response);

    return {
      ok: response.ok,
      status: response.status,
      payload
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const normalizeRunFiles = (language, files, code, fileName) => {
  if (Array.isArray(files) && files.length > 0) {
    return files
      .map((file) => ({
        name: String(file?.name || '').trim(),
        content: String(file?.content || '')
      }))
      .filter((file) => file.name && file.content.length > 0);
  }

  if (!code || typeof code !== 'string') {
    return [];
  }

  const extension = languageExtensionMap[String(language || '').toLowerCase()] || 'txt';
  const fallbackName = `main.${extension}`;

  return [{
    name: String(fileName || fallbackName).trim() || fallbackName,
    content: code
  }];
};

const sendUpstreamFailure = (res, status, payload, fallbackMessage) => {
  return res.status(status).json({
    error: getErrorMessageFromUpstream(payload, fallbackMessage),
    upstream: payload
  });
};

const buildDeleteChallengeAttempts = ({ apiKey, challengeId }) => {
  const encodedApiKey = encodeURIComponent(apiKey);
  const encodedChallengeId = encodeURIComponent(challengeId);

  return [
    {
      name: 'delete-by-id',
      method: 'DELETE',
      url: `${ONECOMPILER_API_BASE}/v1/challenges/${encodedChallengeId}?access_token=${encodedApiKey}`
    },
    {
      name: 'post-delete-by-id',
      method: 'POST',
      url: `${ONECOMPILER_API_BASE}/v1/challenges/delete?access_token=${encodedApiKey}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId })
    },
    {
      name: 'post-delete-by-ids',
      method: 'POST',
      url: `${ONECOMPILER_API_BASE}/v1/challenges/delete?access_token=${encodedApiKey}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeIds: [challengeId] })
    },
    {
      name: 'post-delete-suffix',
      method: 'POST',
      url: `${ONECOMPILER_API_BASE}/v1/challenges/${encodedChallengeId}/delete?access_token=${encodedApiKey}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }
  ];
};

const attemptDeleteChallenge = async ({ apiKey, challengeId }) => {
  const attempts = buildDeleteChallengeAttempts({ apiKey, challengeId });
  const failures = [];

  for (const attempt of attempts) {
    const upstream = await callOneCompiler(attempt);

    if (upstream.ok) {
      return {
        ok: true,
        successfulAttempt: attempt.name,
        upstream
      };
    }

    failures.push({
      name: attempt.name,
      status: upstream.status,
      payload: upstream.payload
    });

    if (upstream.status === 401 || upstream.status === 403) {
      break;
    }
  }

  return {
    ok: false,
    failures
  };
};

router.get('/languages', async (req, res) => {
  try {
    const upstream = await callOneCompiler({
      url: `${ONECOMPILER_PUBLIC_BASE}/api/v1/languages`
    });

    if (!upstream.ok) {
      return sendUpstreamFailure(res, upstream.status, upstream.payload, 'Failed to fetch language list');
    }

    return res.json(upstream.payload);
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Language lookup timed out' });
    }

    return res.status(500).json({ error: 'Failed to fetch language list' });
  }
});

router.post('/challenges', async (req, res) => {
  try {
    const apiKey = getOneCompilerApiKey();

    if (!apiKey) {
      return res.status(500).json({ error: 'ONECOMPILER_API_KEY is not configured on server' });
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Challenge payload must be a JSON object' });
    }

    const upstream = await callOneCompiler({
      url: `${ONECOMPILER_API_BASE}/v1/challenges/create?access_token=${encodeURIComponent(apiKey)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });

    if (!upstream.ok) {
      return sendUpstreamFailure(res, upstream.status, upstream.payload, 'Challenge creation failed');
    }

    return res.status(upstream.status).json(upstream.payload);
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Challenge creation timed out' });
    }

    return res.status(500).json({ error: 'Failed to create challenge' });
  }
});

router.get('/challenges', async (req, res) => {
  try {
    const apiKey = getOneCompilerApiKey();

    if (!apiKey) {
      return res.status(500).json({ error: 'ONECOMPILER_API_KEY is not configured on server' });
    }

    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const safeLimit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 200))
      : 50;

    const searchText = String(req.query.q || '').trim().toLowerCase();

    const reportPayload = {
      type: 'listAllChallengeIds',
      filters: {
        challengeIds: [],
        userIds: []
      }
    };

    const upstream = await callOneCompiler({
      url: `${ONECOMPILER_API_BASE}/v1/reports?access_token=${encodeURIComponent(apiKey)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reportPayload)
    });

    if (!upstream.ok) {
      return sendUpstreamFailure(res, upstream.status, upstream.payload, 'Failed to load challenges');
    }

    const allChallenges = toChallengeList(upstream.payload)
      .map(normalizeChallengeSummary)
      .filter((item) => item.id);

    const filteredChallenges = searchText
      ? allChallenges.filter((item) => (
        item.title.toLowerCase().includes(searchText)
        || item.id.toLowerCase().includes(searchText)
        || item.tags.some((tag) => tag.toLowerCase().includes(searchText))
      ))
      : allChallenges;

    return res.json({
      status: 'success',
      total: allChallenges.length,
      count: Math.min(filteredChallenges.length, safeLimit),
      challenges: filteredChallenges.slice(0, safeLimit)
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Challenge listing timed out' });
    }

    return res.status(500).json({ error: 'Failed to load challenges' });
  }
});

router.get('/challenges/:challengeId', async (req, res) => {
  try {
    const apiKey = getOneCompilerApiKey();

    if (!apiKey) {
      return res.status(500).json({ error: 'ONECOMPILER_API_KEY is not configured on server' });
    }

    const challengeId = String(req.params.challengeId || '').trim();

    if (!challengeId) {
      return res.status(400).json({ error: 'challengeId is required' });
    }

    const upstream = await callOneCompiler({
      url: `${ONECOMPILER_API_BASE}/v1/challenges/${encodeURIComponent(challengeId)}?access_token=${encodeURIComponent(apiKey)}`
    });

    if (!upstream.ok) {
      return sendUpstreamFailure(res, upstream.status, upstream.payload, 'Failed to fetch challenge');
    }

    return res.status(upstream.status).json(upstream.payload);
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Challenge lookup timed out' });
    }

    return res.status(500).json({ error: 'Failed to fetch challenge' });
  }
});

router.delete('/challenges/:challengeId', async (req, res) => {
  try {
    const apiKey = getOneCompilerApiKey();

    if (!apiKey) {
      return res.status(500).json({ error: 'ONECOMPILER_API_KEY is not configured on server' });
    }

    const challengeId = String(req.params.challengeId || '').trim();

    if (!challengeId) {
      return res.status(400).json({ error: 'challengeId is required' });
    }

    const deleteResult = await attemptDeleteChallenge({ apiKey, challengeId });

    if (!deleteResult.ok) {
      const failures = deleteResult.failures || [];
      const deleteEndpointUnavailable = failures.length > 0
        && failures.every((entry) => [404, 405].includes(entry.status));

      if (deleteEndpointUnavailable) {
        return res.status(502).json({
          error: 'Delete challenge is not available from upstream API for this account',
          attempts: failures.map((entry) => ({ name: entry.name, status: entry.status }))
        });
      }

      const preferredFailure = failures.find((entry) => ![404, 405].includes(entry.status)) || failures[0];
      return res.status(preferredFailure?.status || 500).json({
        error: getErrorMessageFromUpstream(preferredFailure?.payload, 'Failed to delete challenge'),
        upstream: preferredFailure?.payload,
        attempts: failures.map((entry) => ({ name: entry.name, status: entry.status }))
      });
    }

    return res.json({
      status: 'success',
      message: 'Challenge deleted successfully',
      challengeId,
      deletionMethod: deleteResult.successfulAttempt,
      upstream: deleteResult.upstream?.payload || null
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Challenge delete timed out' });
    }

    return res.status(500).json({ error: 'Failed to delete challenge' });
  }
});

router.get('/challenges/:challengeId/stats', async (req, res) => {
  try {
    const apiKey = getOneCompilerApiKey();

    if (!apiKey) {
      return res.status(500).json({ error: 'ONECOMPILER_API_KEY is not configured on server' });
    }

    const challengeId = String(req.params.challengeId || '').trim();

    if (!challengeId) {
      return res.status(400).json({ error: 'challengeId is required' });
    }

    const upstream = await callOneCompiler({
      url: `${ONECOMPILER_API_BASE}/v1/challenges/stats?access_token=${encodeURIComponent(apiKey)}&challengeIds=${encodeURIComponent(challengeId)}`
    });

    if (!upstream.ok) {
      return sendUpstreamFailure(res, upstream.status, upstream.payload, 'Failed to fetch challenge stats');
    }

    return res.status(upstream.status).json(upstream.payload);
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Challenge stats lookup timed out' });
    }

    return res.status(500).json({ error: 'Failed to fetch challenge stats' });
  }
});

router.get('/challenges/:challengeId/stats/summary', async (req, res) => {
  try {
    const apiKey = getOneCompilerApiKey();

    if (!apiKey) {
      return res.status(500).json({ error: 'ONECOMPILER_API_KEY is not configured on server' });
    }

    const challengeId = String(req.params.challengeId || '').trim();

    if (!challengeId) {
      return res.status(400).json({ error: 'challengeId is required' });
    }

    const upstream = await callOneCompiler({
      url: `${ONECOMPILER_API_BASE}/v1/challenges/stats/summary?access_token=${encodeURIComponent(apiKey)}&challengeIds=${encodeURIComponent(challengeId)}`
    });

    if (!upstream.ok) {
      return sendUpstreamFailure(res, upstream.status, upstream.payload, 'Failed to fetch challenge stats summary');
    }

    return res.status(upstream.status).json(upstream.payload);
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Challenge stats summary lookup timed out' });
    }

    return res.status(500).json({ error: 'Failed to fetch challenge stats summary' });
  }
});

router.post('/run', async (req, res) => {
  try {
    const apiKey = getOneCompilerApiKey();

    if (!apiKey) {
      return res.status(500).json({ error: 'ONECOMPILER_API_KEY is not configured on server' });
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Run payload must be a JSON object' });
    }

    const language = String(req.body.language || '').trim();
    if (!language) {
      return res.status(400).json({ error: 'language is required' });
    }

    const normalizedFiles = normalizeRunFiles(language, req.body.files, req.body.code, req.body.fileName);

    if (normalizedFiles.length === 0) {
      return res.status(400).json({ error: 'Provide files[] or code to execute' });
    }

    const runPayload = {
      ...req.body,
      language,
      files: normalizedFiles
    };

    delete runPayload.code;
    delete runPayload.fileName;

    const upstream = await callOneCompiler({
      url: `${ONECOMPILER_API_BASE}/v1/run`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify(runPayload)
    });

    if (!upstream.ok) {
      return sendUpstreamFailure(res, upstream.status, upstream.payload, 'Code execution failed');
    }

    return res.status(upstream.status).json(upstream.payload);
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Code execution timed out' });
    }

    return res.status(500).json({ error: 'Failed to run code' });
  }
});

module.exports = router;
