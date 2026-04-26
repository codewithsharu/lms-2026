import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute, PublicRoute } from './components/ProtectedRoute';

// Pages
import Login from './pages/Login';
import AdminDashboard from './pages/admin/Dashboard';
import UserManagement from './pages/admin/UserManagement';
import ClassManagement from './pages/admin/ClassManagement';
import AuditLogs from './pages/admin/AuditLogs';
import AdminAnalytics from './pages/admin/Analytics';
import HealthCheck from './pages/admin/HealthCheck';
import HealthCheckTable from './pages/admin/HealthCheckTable';
import TeacherDashboard from './pages/teacher/Dashboard';
import TeacherStudents from './pages/teacher/Students';
import TeacherClasses from './pages/teacher/Classes';
import TeacherClassStudents from './pages/teacher/ClassStudents';
import TeacherAssessmentTemplates from './pages/teacher/AssessmentTemplates';
import TeacherAssessmentTemplateBuilder from './pages/teacher/AssessmentTemplateBuilder';
import TeacherHostExams from './pages/teacher/HostExams';
import TeacherHostExamCreate from './pages/teacher/HostExamCreate';
import TeacherExamPreviewLab from './pages/teacher/ExamPreviewLab';
import TeacherChallengeBrowser from './pages/teacher/ChallengeBrowser';
import TeacherChallengeBuilder from './pages/teacher/ChallengeBuilder';
import TeacherChallengeRunner from './pages/teacher/ChallengeRunner';
import TeacherAnalytics from './pages/teacher/Analytics';
import StudentDashboard from './pages/student/Dashboard';
import StudentAssessments from './pages/student/Assessments';
import StudentResults from './pages/student/Results';
import StudentAssessmentInstructions from './pages/student/AssessmentInstructions';
import StudentAssessmentAttempt from './pages/student/AssessmentAttempt';
import ChallengeRunner from './pages/compiler/ChallengeRunner';
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
                <AdminAnalytics />
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
          <Route
            path="/admin/audit-logs"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AuditLogs />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/health-check"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <HealthCheck />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/health-check/:tableName"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <HealthCheckTable />
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
                <Navigate to="/teacher/assessments/templates" replace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/assessments/templates"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherAssessmentTemplates />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/assessments/templates/:templateId/builder"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherAssessmentTemplateBuilder />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/assessments/host"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherHostExams />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/assessments/host/new"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherHostExamCreate />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/assessments/preview-lab"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherExamPreviewLab />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/assessments/preview-lab/run/:attemptId"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <StudentAssessmentAttempt />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/analytics"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherAnalytics />
              </ProtectedRoute>
            }
          />

          <Route
            path="/teacher/compiler"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <Navigate to="/teacher/compiler/challenges" replace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/compiler/challenges"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherChallengeBrowser />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/compiler/challenges/new"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherChallengeBuilder />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/compiler/challenges/run"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherChallengeRunner />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/compiler/challenges/run/:challengeId"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherChallengeRunner />
              </ProtectedRoute>
            }
          />

          <Route
            path="/compiler/challenges"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <Navigate to="/teacher/compiler/challenges" replace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/compiler/challenges/new"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <Navigate to="/teacher/compiler/challenges/new" replace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/compiler/challenges/run"
            element={
              <ProtectedRoute allowedRoles={['teacher', 'student']}>
                <ChallengeRunner />
              </ProtectedRoute>
            }
          />
          <Route
            path="/compiler/challenges/run/:challengeId"
            element={
              <ProtectedRoute allowedRoles={['teacher', 'student']}>
                <ChallengeRunner />
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
                <StudentAssessments />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/assessments/:hostedAssessmentId/instructions"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <StudentAssessmentInstructions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/assessments/attempt/:attemptId"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <StudentAssessmentAttempt />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/results"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <StudentResults />
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
            background: '#ffffff',
            color: '#0F172A',
            border: '1px solid #E2E8F0',
            borderRadius: '12px',
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.12)',
            padding: '12px 14px',
            fontSize: '14px',
            fontWeight: 500,
          },
          success: {
            style: {
              border: '1px solid #86EFAC',
              background: '#F0FDF4',
              color: '#166534',
            },
            iconTheme: {
              primary: '#16A34A',
              secondary: '#ECFDF5',
            }
          },
          error: {
            style: {
              border: '1px solid #FECACA',
              background: '#FEF2F2',
              color: '#991B1B',
            },
            iconTheme: {
              primary: '#DC2626',
              secondary: '#FEF2F2',
            }
          },
        }}
      />
    </AuthProvider>
  );
}

export default App;
