import { Link, useLocation } from 'react-router-dom';
import { buildCompilerPath } from './routePaths';

const isActivePath = (pathname, target, exact = false) => {
  if (exact) {
    return pathname === target;
  }

  return pathname === target || pathname.startsWith(`${target}/`);
};

const CompilerTopBar = ({ title, subtitle, rightNode = null }) => {
  const location = useLocation();
  const browserPath = buildCompilerPath(location.pathname);
  const builderPath = buildCompilerPath(location.pathname, '/new');
  const runnerPath = buildCompilerPath(location.pathname, '/run');

  const navItems = [
    { to: browserPath, label: 'Challenge Browser', exact: true },
    { to: builderPath, label: 'Challenge Builder' },
    { to: runnerPath, label: 'Exam Runner' }
  ];

  return (
    <header className="compiler-topbar">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3 flex-wrap justify-end">
        <nav className="compiler-nav">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`compiler-nav-link ${isActivePath(location.pathname, item.to, item.exact) ? 'active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {rightNode}
      </div>
    </header>
  );
};

export default CompilerTopBar;
