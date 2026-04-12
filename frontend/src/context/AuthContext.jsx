/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const resolveProfileUser = (data) => {
    if (!data) return null;
    if (data.user) return data.user;
    return data;
  };

  useEffect(() => {
    const checkAuth = async () => {
      // Try to get user from localStorage first for faster UI
      const savedUser = localStorage.getItem('user');

      if (savedUser) {
        try {
          const parsed = JSON.parse(savedUser);
          if (parsed && parsed.id) {
            setUser(parsed);
          }
        } catch {
          localStorage.removeItem('user');
        }
      }

      // Always verify session with server so refresh works even without local cache
      try {
        const response = await authAPI.getProfile();
        const userData = resolveProfileUser(response.data);

        if (userData && userData.id) {
          setUser(userData);
          localStorage.setItem('user', JSON.stringify(userData));
        } else {
          localStorage.removeItem('user');
          setUser(null);
        }
      } catch {
        localStorage.removeItem('user');
        setUser(null);
      }

      setLoading(false);
    };

    checkAuth();
  }, []);

  const login = async (email, password) => {
    const response = await authAPI.login(email, password);
    const { user } = response.data;
    
    // Token is now stored in HTTP-only cookie by server
    localStorage.setItem('user', JSON.stringify(user));
    setUser(user);
    
    return user;
  };

  const logout = async () => {
    try {
      await authAPI.logout(); // Server clears the cookie
    } catch {
      // Even if API fails, clear local state
    }
    localStorage.removeItem('user');
    setUser(null);
  };

  const value = {
    user,
    loading,
    login,
    logout,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    isTeacher: user?.role === 'teacher',
    isStudent: user?.role === 'student',
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
