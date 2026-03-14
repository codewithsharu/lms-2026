import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute, PublicRoute } from './components/ProtectedRoute';

// Pages
import Login from './pages/Login';
import AdminDashboard from './pages/admin/Dashboard';
import UserManagement from './pages/admin/UserManagement';
import ClassManagement from './pages/admin/ClassManagement';
import TeacherDashboard from './pages/teacher/Dashboard';
import TeacherStudents from './pages/teacher/Students';
import TeacherClasses from './pages/teacher/Classes';
import TeacherClassStudents from './pages/teacher/ClassStudents';
import StudentDashboard from './pages/student/Dashboard';
import UnderDevelopment from './pages/UnderDevelopment';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route 
            path="/login" 
            element={
              <PublicRoute>
                <Login />
              </PublicRoute>
            } 
          />

          {/* Admin Routes */}
          <Route 
            path="/admin" 
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/students" 
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <UserManagement fixedRole="student" />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/teachers" 
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <UserManagement fixedRole="teacher" />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/users" 
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <Navigate to="/admin/students" replace />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/classes" 
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <ClassManagement />
              </ProtectedRoute>
            } 
          />
          <Route
            path="/admin/analytics"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <UnderDevelopment title="Admin Analytics" description="Analytics dashboard is under development." />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <UnderDevelopment title="Admin Settings" description="Settings module is under development." />
              </ProtectedRoute>
            }
          />

          {/* Teacher Routes */}
          <Route 
            path="/teacher" 
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherDashboard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/teacher/students" 
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherStudents />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/teacher/classes" 
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherClasses />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/teacher/:classId/:sectionId/students" 
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherClassStudents />
              </ProtectedRoute>
            } 
          />
          <Route
            path="/teacher/assessments"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <UnderDevelopment title="Teacher Assessments" description="Assessment tools are under development." />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/analytics"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <UnderDevelopment title="Teacher Analytics" description="Analytics module is under development." />
              </ProtectedRoute>
            }
          />

          {/* Student Routes */}
          <Route 
            path="/student" 
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <StudentDashboard />
              </ProtectedRoute>
            } 
          />
          <Route
            path="/student/assessments"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <UnderDevelopment title="Student Assessments" description="Assessment page is under development." />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/results"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <UnderDevelopment title="Student Results" description="Results page is under development." />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/profile"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <UnderDevelopment title="Student Profile" description="Profile page is under development." />
              </ProtectedRoute>
            }
          />

          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
      
      {/* Toast notifications */}
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#333',
            color: '#fff',
          },
          success: {
            style: {
              background: '#25D366',
            },
          },
          error: {
            style: {
              background: '#EF4444',
            },
          },
        }}
      />
    </AuthProvider>
  );
}

export default App;
