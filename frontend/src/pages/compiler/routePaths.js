export const isTeacherCompilerPath = (pathname = '') => String(pathname || '').startsWith('/teacher/compiler');

export const getCompilerRouteBase = (pathname = '') => (
  isTeacherCompilerPath(pathname)
    ? '/teacher/compiler/challenges'
    : '/compiler/challenges'
);

export const buildCompilerPath = (pathname = '', suffix = '') => {
  const basePath = getCompilerRouteBase(pathname);

  if (!suffix) {
    return basePath;
  }

  const normalizedSuffix = String(suffix).startsWith('/')
    ? String(suffix)
    : `/${String(suffix)}`;

  return `${basePath}${normalizedSuffix}`;
};
