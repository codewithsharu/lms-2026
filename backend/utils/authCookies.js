const DEFAULT_ACCESS_TOKEN_MAX_AGE_MS = 60 * 60 * 1000;
const DEFAULT_REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const isProduction = process.env.NODE_ENV === 'production';
const cookieSameSite = (process.env.COOKIE_SAME_SITE || (isProduction ? 'none' : 'lax')).toLowerCase();
const cookieSecure = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : cookieSameSite === 'none' || isProduction;
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

const buildCookieOptions = ({ maxAge, expires }) => ({
  httpOnly: true,
  secure: cookieSecure,
  sameSite: cookieSameSite,
  path: '/',
  ...(maxAge ? { maxAge } : {}),
  ...(expires ? { expires } : {}),
  ...(cookieDomain ? { domain: cookieDomain } : {})
});

const getAccessTokenCookieOptions = (maxAgeMs = DEFAULT_ACCESS_TOKEN_MAX_AGE_MS) => {
  const safeMaxAge = Number.isFinite(maxAgeMs) && maxAgeMs > 0
    ? maxAgeMs
    : DEFAULT_ACCESS_TOKEN_MAX_AGE_MS;

  return buildCookieOptions({
    maxAge: safeMaxAge,
    expires: new Date(Date.now() + safeMaxAge)
  });
};

const getRefreshTokenCookieOptions = (maxAgeMs = DEFAULT_REFRESH_TOKEN_MAX_AGE_MS) => {
  const safeMaxAge = Number.isFinite(maxAgeMs) && maxAgeMs > 0
    ? maxAgeMs
    : DEFAULT_REFRESH_TOKEN_MAX_AGE_MS;

  return buildCookieOptions({
    maxAge: safeMaxAge,
    expires: new Date(Date.now() + safeMaxAge)
  });
};

const getClearCookieOptions = () => buildCookieOptions({});

module.exports = {
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
  getClearCookieOptions,
  DEFAULT_ACCESS_TOKEN_MAX_AGE_MS,
  DEFAULT_REFRESH_TOKEN_MAX_AGE_MS
};
