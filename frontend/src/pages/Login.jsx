import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { FiMail, FiLock, FiEye, FiEyeOff, FiArrowRight } from 'react-icons/fi';
import InputField from '../components/ui/InputField';
import Button from '../components/ui/Button';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-[480px] bg-white border border-gray-200 rounded-none sm:rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.08)] overflow-hidden">
        <div className="bg-primary px-8 py-9 text-center">
          <p className="text-xs tracking-[0.24em] text-primary-light uppercase">Assessment</p>
          <h1 className="mt-2 text-[1.95rem] leading-9 font-medium text-white">College Portal</h1>
          <div className="mx-auto mt-4 h-[2px] w-14 bg-primary-light/80" />
        </div>

        <div className="px-8 py-8 sm:px-9">
          <div className="text-center mb-7">
            <h2 className="text-[1.9rem] leading-9 font-medium text-gray-900">Welcome Back</h2>
            <p className="mt-2 text-[1.15rem] text-gray-500 font-normal">Sign in to your account to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <InputField
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              autoComplete="email"
              leftIcon={FiMail}
              inputClassName="!rounded-none !h-12"
            />

            <InputField
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              leftIcon={FiLock}
              inputClassName="!rounded-none !h-12"
              rightNode={(
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <FiEyeOff className="h-5 w-5" /> : <FiEye className="h-5 w-5" />}
                </button>
              )}
            />

            <div className="flex justify-end -mt-1">
              <button type="button" className="text-sm text-gray-600 hover:text-primary transition-colors">
                Forgot password?
              </button>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full !py-3 !rounded-none !bg-primary hover:!bg-primary-dark !tracking-[0.14em] !uppercase"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                  <span>Signing In</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <FiArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-8 border-t border-gray-200 pt-7 text-center">
            <p className="text-[0.95rem] text-gray-600 font-normal">
              Need access? <span className="text-primary font-medium">Contact Admin</span>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-gray-500 pb-6 px-8">© 2026 College Assessment Platform</p>
      </div>
    </div>
  );
};

export default Login;
