import { FiClipboard, FiBarChart2, FiAward, FiClock } from 'react-icons/fi';
import Layout from '../../components/Layout';
import { useAuth } from '../../context/AuthContext';
import Card from '../../components/ui/Card';
import StatCard from '../../components/ui/StatCard';

const StudentDashboard = () => {
  const { user } = useAuth();

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1>Welcome, {user?.full_name}</h1>
            <p>Track your class progress, upcoming tests, and profile details.</p>
          </div>
          {user?.details?.zone && (
            <div className="inline-flex items-center rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700">
              Zone: {user.details.zone.charAt(0).toUpperCase() + user.details.zone.slice(1)}
            </div>
          )}
        </div>

        <Card>
          <Card.Header>
            <h2 className="section-title">Your Profile</h2>
          </Card.Header>
          <Card.Body>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Name</p>
                <p className="mt-1 font-medium text-gray-800">{user?.full_name}</p>
              </div>
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Email</p>
                <p className="mt-1 font-medium text-gray-800 break-all">{user?.email}</p>
              </div>
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Roll Number</p>
                <p className="mt-1 font-medium text-gray-800">{user?.details?.roll_number || 'N/A'}</p>
              </div>
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Class</p>
                <p className="mt-1 font-medium text-gray-800">{user?.details?.classes?.name || 'N/A'}</p>
              </div>
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Section</p>
                <p className="mt-1 font-medium text-gray-800">{user?.details?.sections?.name || 'N/A'}</p>
              </div>
              <div className="surface-card-muted p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Zone</p>
                <p className="mt-1 font-medium text-gray-800 capitalize">{user?.details?.zone || 'N/A'}</p>
              </div>
            </div>
          </Card.Body>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard 
            icon={FiClipboard} 
            label="Pending Tests" 
            value={0} 
            iconColorClass="bg-primary" 
          />
          <StatCard 
            icon={FiBarChart2} 
            label="Completed" 
            value={0} 
            iconColorClass="bg-primary-dark" 
          />
          <StatCard 
            icon={FiAward} 
            label="Avg. Score" 
            value="N/A" 
            iconColorClass="bg-slate-500" 
          />
          <StatCard 
            icon={FiClock} 
            label="Total Time" 
            value="0h" 
            iconColorClass="bg-slate-700" 
          />
        </div>

        <Card>
          <Card.Body className="py-10 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100">
              <FiClipboard className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-base font-medium text-gray-800 mb-2">No Assessments Yet</h3>
            <p className="mx-auto max-w-md text-sm text-gray-500">
              Teachers have not assigned assessments yet. New items will appear here automatically.
            </p>
          </Card.Body>
        </Card>

      </div>
    </Layout>
  );
};

export default StudentDashboard;
