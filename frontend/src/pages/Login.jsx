import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { FiMail, FiLock, FiEye, FiEyeOff, FiArrowRight } from 'react-icons/fi';
import '../styles/login.css';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname;

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error('Please fill in all fields');
      return;
    }

    setLoading(true);

    try {
      const user = await login(email, password);
      toast.success(`Welcome back, ${user.full_name}!`);

      const dashboardPath = {
        admin: '/admin',
        teacher: '/teacher',
        student: '/student'
      };

      navigate(from || dashboardPath[user.role] || '/', { replace: true });
    } catch (error) {
      const message = error.response?.data?.error || 'Login failed. Please try again.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* ── Left Panel ── */}
      <div className="login-brand">
        <div className="login-brand-glow" />
        <div className="login-brand-glow-2" />
        <div className="login-brand-grid" />

        {/* Top — Logo */}
        <div className="login-brand-top">
          <p className="login-wordmark">Assignment Portal</p>
        </div>

        {/* Center — Headline + Features */}
        <div className="login-brand-center">
          <h1 style={{ fontWeight: 400, lineHeight: 1.1, fontSize: '2.1rem', maxWidth: 420 }}>
            Smart Assignment Management<br />for Students & Faculty
          </h1>
          <p className="login-brand-tagline">A centralized academic platform designed to simplify assignment submission, tracking, and evaluation.</p>

          <div className="login-features">
            <div className="login-feature">
              <div className="login-feature-dot" />
              <span>Efficient assignment submission and management</span>
            </div>
            <div className="login-feature">
              <div className="login-feature-dot" />
              <span>Real-time progress tracking and notifications</span>
            </div>
            <div className="login-feature">
              <div className="login-feature-dot" />
              <span>Secure access for students, faculty, and administrators</span>
            </div>
            <div className="login-feature">
              <div className="login-feature-dot" />
              <span>Reliable system built to support academic workflows</span>
            </div>
          </div>
        </div>

        <div className="login-brand-bottom">
          <p className="login-trust-line">Trusted by institutions to streamline academic tasks and collaboration.</p>
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="login-form-panel">
        <div className="login-form-container">
          <h2>Sign in</h2>
          <p className="form-subtitle">Enter your credentials to continue.</p>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label className="form-label">Email</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <FiMail className="h-4 w-4 text-gray-400" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@institution.edu"
                  autoComplete="email"
                  className="form-input with-left-icon"
                  id="login-email"
                />
              </div>
            </div>

            <div className="login-field">
              <label className="form-label">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <FiLock className="h-4 w-4 text-gray-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="form-input with-left-icon with-right-icon"
                  id="login-password"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <FiEyeOff className="h-4 w-4" /> : <FiEye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="login-forgot-row">
              <label className="login-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                Remember me
              </label>
              <button type="button" className="login-forgot-link">
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="login-submit-btn"
              id="login-submit"
            >
              {loading ? (
                <>
                  <div className="spinner" />
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <span>Sign in</span>
                  <FiArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="login-divider">
            <span>Need access?</span>
          </div>

          <div className="login-form-footer">
            <p>
              Contact your workspace{' '}
              <span className="contact-link">administrator</span>
              {' '}to get started
            </p>
          </div>

          <p className="login-copyright">© 2026 Assignment Portal</p>
        </div>
      </div>
    </div>
  );
};

export default Login;
