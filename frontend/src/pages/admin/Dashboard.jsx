import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FiUsers, FiUserPlus, FiBook, FiActivity, FiArrowRight } from 'react-icons/fi';
import { assessmentAPI, userAPI } from '../../services/api';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import StatCard from '../../components/ui/StatCard';
import Button from '../../components/ui/Button';

const AdminDashboard = () => {
  const [stats, setStats] = useState({
    totalUsers: 0,
    teachers: 0,
    students: 0,
    assessmentsPublished: 0,
    recentUsers: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const [userResponse, assessmentResponse] = await Promise.all([
        userAPI.getAll({ limit: 100 }),
        assessmentAPI.getAdminMetrics().catch(() => ({ data: { published: 0 } }))
      ]);

      const users = userResponse.data.users;
      
      setStats({
        totalUsers: userResponse.data.pagination.total,
        teachers: users.filter(u => u.role === 'teacher').length,
        students: users.filter(u => u.role === 'student').length,
        assessmentsPublished: assessmentResponse.data?.published || 0,
        recentUsers: users.slice(0, 5)
      });
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1>Admin Dashboard</h1>
            <p className="text-gray-500">A quick overview of users, classes, and activity.</p>
          </div>
          <div className="status-badge info">Overview</div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="surface-card p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-20 mb-2"></div>
                <div className="h-7 bg-gray-200 rounded w-16"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard 
              icon={FiUsers} 
              label="Total Users" 
              value={stats.totalUsers} 
              iconColorClass="bg-primary" 
            />
            <StatCard 
              icon={FiUserPlus} 
              label="Teachers" 
              value={stats.teachers} 
              iconColorClass="bg-primary-dark" 
            />
            <StatCard 
              icon={FiBook} 
              label="Students" 
              value={stats.students} 
              iconColorClass="bg-slate-600" 
            />
            <StatCard 
              icon={FiActivity} 
              label="Published Exams" 
              value={stats.assessmentsPublished} 
              iconColorClass="bg-slate-700" 
            />
          </div>
        )}

        <Card className="overflow-hidden">
          <Card.Header>
            <div className="flex items-center justify-between gap-3">
              <h2 className="section-title">Recent Users</h2>
              <Link to="/admin/students" className="text-sm text-primary hover:text-primary-dark font-medium inline-flex items-center gap-1">
                View all
                <FiArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </Card.Header>
          <Card.Body className="p-0">
            {loading ? (
              <div className="p-6 space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-4 animate-pulse">
                    <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                    <div className="flex-1">
                      <div className="h-4 bg-gray-200 rounded w-32 mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded w-24"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : stats.recentUsers.length > 0 ? (
              <div className="table-shell rounded-none border-0">
                <table>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Email</th>
                      <th>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentUsers.map(user => (
                      <tr key={user.id}>
                        <td className="font-medium text-gray-800">{user.full_name}</td>
                        <td>{user.email}</td>
                        <td>
                          <span className={`status-badge ${user.role === 'teacher' ? 'info' : 'warning'}`}>
                            {user.role}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-center text-gray-500 py-10">No users yet. Start by creating your first record.</p>
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <h2 className="section-title">Quick Actions</h2>
          </Card.Header>
          <Card.Body>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Link to="/admin/students?action=create">
                <Button className="w-full justify-between" variant="primary">
                  <span>Add Student</span>
                  <FiArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link to="/admin/teachers?action=create">
                <Button className="w-full justify-between" variant="secondary">
                  <span>Add Teacher</span>
                  <FiArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link to="/admin/students?action=upload">
                <Button className="w-full justify-between" variant="primary">
                  <span>Bulk Students</span>
                  <FiArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link to="/admin/classes">
                <Button className="w-full justify-between" variant="secondary">
                  <span>Manage Classes</span>
                  <FiArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </Card.Body>
        </Card>
      </div>
    </Layout>
  );
};

export default AdminDashboard;
