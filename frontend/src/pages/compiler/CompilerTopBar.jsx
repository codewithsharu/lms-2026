import { Link, useLocation } from 'react-router-dom';

const navItems = [
  { to: '/compiler/challenges', label: 'Challenge Browser' },
  { to: '/compiler/challenges/new', label: 'Challenge Builder' },
  { to: '/compiler/challenges/run', label: 'Exam Runner' }
];

const isActivePath = (pathname, target) => {
  if (target === '/compiler/challenges') {
    return pathname === '/compiler/challenges';
  }

  return pathname === target || pathname.startsWith(`${target}/`);
};

const CompilerTopBar = ({ title, subtitle, rightNode = null }) => {
  const location = useLocation();

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
              className={`compiler-nav-link ${isActivePath(location.pathname, item.to) ? 'active' : ''}`}
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
