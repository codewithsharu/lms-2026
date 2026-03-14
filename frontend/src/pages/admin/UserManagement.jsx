import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  FiPlus,
  FiUpload,
  FiDownload,
  FiSearch,
  FiEdit2,
  FiTrash2,
  FiKey,
  FiUser,
  FiMail,
  FiPhone,
  FiUsers,
  FiBriefcase,
  FiLayers
} from 'react-icons/fi';
import { userAPI, classAPI } from '../../services/api';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import InputField from '../../components/ui/InputField';
import SelectField from '../../components/ui/SelectField';
import Modal from '../../components/ui/Modal';

const zones = [
  { value: 'blue', label: 'Blue' },
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' }
];

const UserManagement = ({ fixedRole = '' }) => {
  const [searchParams] = useSearchParams();
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState(fixedRole);

  const [showCreateModal, setShowCreateModal] = useState(searchParams.get('action') === 'create');
  const [showUploadModal, setShowUploadModal] = useState(searchParams.get('action') === 'upload');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const getEmptyEditFormData = () => ({
    role: '',
    full_name: '',
    email: '',
    phone: '',
    is_active: true,
    roll_number: '',
    class_id: '',
    section_id: '',
    zone: '',
    employee_id: '',
    department: '',
    new_password: ''
  });

  const [formData, setFormData] = useState({
    role: 'student',
    full_name: '',
    email: '',
    phone: '',
    roll_number: '',
    class_id: '',
    section_id: '',
    zone: '',
    employee_id: ''
  });

  const [editFormData, setEditFormData] = useState(getEmptyEditFormData());
  const [formLoading, setFormLoading] = useState(false);

  const fileInputRef = useRef(null);
  const [uploadResults, setUploadResults] = useState(null);

  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [editSections, setEditSections] = useState([]);
  const [classesLoading, setClassesLoading] = useState(true);

  const hasAvailableClasses = classes.length > 0;
  const studentCreationBlocked = formData.role === 'student' && !classesLoading && !hasAvailableClasses;
  const activeRoleFilter = fixedRole || roleFilter;

  const entityLabel = fixedRole === 'student' ? 'Student' : fixedRole === 'teacher' ? 'Teacher' : 'User';
  const entityPluralLabel = fixedRole === 'student' ? 'Students' : fixedRole === 'teacher' ? 'Teachers' : 'Users';

  const pageTitle = `${entityLabel} Management`;
  const pageSubtitle =
    fixedRole === 'student'
      ? 'Manage student profiles, enrollment details, and account status.'
      : fixedRole === 'teacher'
        ? 'Manage teacher profiles, employee details, and account status.'
        : 'Manage all teacher and student user accounts.';

  useEffect(() => {
    fetchUsers();
    fetchClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, searchQuery, activeRoleFilter]);

  useEffect(() => {
    if (!showCreateModal || classesLoading || hasAvailableClasses || formData.role !== 'student') {
      return;
    }

    setFormData((prev) => ({
      ...prev,
      role: 'teacher',
      class_id: '',
      section_id: ''
    }));
  }, [showCreateModal, classesLoading, hasAvailableClasses, formData.role]);

  useEffect(() => {
    if (formData.class_id) {
      fetchSections(formData.class_id);
    } else {
      setSections([]);
    }
  }, [formData.class_id]);

  useEffect(() => {
    if (!showEditModal || editFormData.role !== 'student') {
      setEditSections([]);
      return;
    }

    if (editFormData.class_id) {
      fetchEditSections(editFormData.class_id);
    } else {
      setEditSections([]);
    }
  }, [showEditModal, editFormData.class_id, editFormData.role]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await userAPI.getAll({
        page: pagination.page,
        limit: 10,
        search: searchQuery,
        role: activeRoleFilter
      });
      setUsers(response.data.users);
      setPagination(response.data.pagination);
    } catch {
      toast.error('Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const fetchClasses = async () => {
    try {
      setClassesLoading(true);
      const response = await classAPI.getAll({ is_active: true });
      setClasses(response.data);
    } catch {
      setClasses([]);
      console.error('Failed to fetch classes');
    } finally {
      setClassesLoading(false);
    }
  };

  const fetchSections = async (classId) => {
    try {
      const response = await classAPI.getSections(classId);
      setSections(response.data);
    } catch {
      setSections([]);
    }
  };

  const fetchEditSections = async (classId) => {
    try {
      const response = await classAPI.getSections(classId);
      setEditSections(response.data);
    } catch {
      setEditSections([]);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();

    if (formData.role === 'student' && classesLoading) {
      toast.error('Please wait while classes are loading');
      return;
    }

    if (formData.role === 'student' && !hasAvailableClasses) {
      toast.error('Create a class first before adding students');
      return;
    }

    if (formData.role === 'student' && !formData.class_id) {
      toast.error('Class is required for students');
      return;
    }

    setFormLoading(true);

    try {
      const response = await userAPI.create(formData);
      toast.success(`${entityLabel} created successfully!`);

      if (response.data.generatedPassword) {
        toast.success(`Password: ${response.data.generatedPassword}`, { duration: 10000 });
      }

      setShowCreateModal(false);
      resetForm();
      fetchUsers();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to create user');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    try {
      await userAPI.delete(selectedUser.id);
      toast.success(`${entityLabel} deleted successfully`);
      setShowDeleteModal(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to delete user');
    }
  };

  const openEditModal = (user) => {
    const isStudent = user.role === 'student';
    const isTeacher = user.role === 'teacher';

    setSelectedUser(user);
    setEditFormData({
      role: user.role || '',
      full_name: user.full_name || '',
      email: user.email || '',
      phone: user.phone || '',
      is_active: user.is_active ?? true,
      roll_number: isStudent ? user.details?.roll_number || '' : '',
      class_id: isStudent ? user.details?.classes?.id || '' : '',
      section_id: isStudent ? user.details?.sections?.id || '' : '',
      zone: isStudent ? user.details?.zone || '' : '',
      employee_id: isTeacher ? user.details?.employee_id || '' : '',
      department: isTeacher ? user.details?.department || '' : '',
      new_password: ''
    });
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setSelectedUser(null);
    setEditFormData(getEmptyEditFormData());
    setEditSections([]);
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();

    if (!selectedUser) return;

    if (editFormData.role === 'student' && !editFormData.class_id) {
      toast.error('Class is required for students');
      return;
    }

    if (editFormData.new_password && editFormData.new_password.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }

    setFormLoading(true);

    try {
      const payload = {
        full_name: editFormData.full_name,
        email: editFormData.email,
        phone: editFormData.phone || null,
        is_active: editFormData.is_active
      };

      if (editFormData.new_password) {
        payload.new_password = editFormData.new_password;
      }

      if (editFormData.role === 'student') {
        payload.roll_number = editFormData.roll_number;
        payload.class_id = editFormData.class_id;
        payload.section_id = editFormData.section_id || null;
        payload.zone = editFormData.zone || null;
      }

      if (editFormData.role === 'teacher') {
        payload.employee_id = editFormData.employee_id;
        payload.department = editFormData.department || null;
      }

      await userAPI.update(selectedUser.id, payload);
      toast.success(`${entityLabel} updated successfully`);
      closeEditModal();
      fetchUsers();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to update user');
    } finally {
      setFormLoading(false);
    }
  };

  const handleResetPassword = async (userId) => {
    try {
      const response = await userAPI.resetPassword(userId);
      toast.success(`New password: ${response.data.newPassword}`, { duration: 10000 });
    } catch {
      toast.error('Failed to reset password');
    }
  };

  const handleBulkUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setFormLoading(true);
      const response = await userAPI.bulkUpload(file);
      setUploadResults(response.data);
      toast.success(`Uploaded ${response.data.summary.successful} users`);
      fetchUsers();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Upload failed');
    } finally {
      setFormLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDownloadTemplate = async (type) => {
    try {
      const response = await userAPI.downloadTemplate(type);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        type === 'teacher' ? 'teacher_upload_template.xlsx' : 'student_upload_template.xlsx'
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      toast.error(`Failed to download ${type} template`);
    }
  };

  const resetForm = () => {
    setFormData({
      role: fixedRole || (!classesLoading && !hasAvailableClasses ? 'teacher' : 'student'),
      full_name: '',
      email: '',
      phone: '',
      roll_number: '',
      class_id: '',
      section_id: '',
      zone: '',
      employee_id: ''
    });
    setSections([]);
  };

  const getZoneClasses = (zone) => {
    if (zone === 'blue') return 'status-badge info';
    if (zone === 'red') return 'status-badge error';
    if (zone === 'green') return 'status-badge success';
    return 'status-badge warning';
  };

  const renderRoleDetails = (user) => {
    if (user.role === 'student') {
      return (
        <div className="space-y-1.5">
          {user.details?.roll_number && <p className="text-sm text-slate-600">Roll: {user.details.roll_number}</p>}
          {user.details?.classes?.name && (
            <p className="text-sm text-slate-600">Class: {user.details.classes.name}</p>
          )}
          {user.details?.sections?.name && (
            <p className="text-sm text-slate-600">Section: {user.details.sections.name}</p>
          )}
          {user.details?.zone && (
            <span className={`${getZoneClasses(user.details.zone)} capitalize`}>{user.details.zone}</span>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-1">
        {user.details?.employee_id && <p className="text-sm text-slate-600">ID: {user.details.employee_id}</p>}
        {user.details?.department && <p className="text-sm text-slate-600">Dept: {user.details.department}</p>}
      </div>
    );
  };

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1>{pageTitle}</h1>
            <p>{pageSubtitle}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setShowUploadModal(true)}>
              <FiUpload className="h-4 w-4" />
              Bulk Upload
            </Button>
            <Button
              onClick={() => {
                if (fixedRole) {
                  setFormData((prev) => ({ ...prev, role: fixedRole }));
                }
                setShowCreateModal(true);
              }}
            >
              <FiPlus className="h-4 w-4" />
              Add {entityLabel}
            </Button>
          </div>
        </div>

        <Card>
          <Card.Body className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <InputField
              className="md:col-span-8"
              leftIcon={FiSearch}
              placeholder={`Search ${entityPluralLabel.toLowerCase()} by name or email`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {!fixedRole && (
              <SelectField
                className="md:col-span-4"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option value="">All Roles</option>
                <option value="student">Students</option>
                <option value="teacher">Teachers</option>
              </SelectField>
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Body className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="section-title">{entityPluralLabel} Directory</h2>
              <p className="body-sm">{pagination.total} total records</p>
            </div>

            <div className="table-shell overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Details</th>
                    <th>Status</th>
                    <th className="w-[170px] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(5)].map((_, i) => (
                      <tr key={i}>
                        <td>
                          <div className="h-5 w-40 animate-pulse rounded bg-slate-100" />
                        </td>
                        <td>
                          <div className="h-5 w-20 animate-pulse rounded bg-slate-100" />
                        </td>
                        <td>
                          <div className="h-5 w-32 animate-pulse rounded bg-slate-100" />
                        </td>
                        <td>
                          <div className="h-5 w-20 animate-pulse rounded bg-slate-100" />
                        </td>
                        <td>
                          <div className="ml-auto h-5 w-24 animate-pulse rounded bg-slate-100" />
                        </td>
                      </tr>
                    ))
                  ) : users.length > 0 ? (
                    users.map((user) => (
                      <tr key={user.id} className="align-top">
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                              {user.full_name?.charAt(0)?.toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-slate-800">{user.full_name}</p>
                              <p className="text-sm text-slate-500">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`${user.role === 'student' ? 'status-badge info' : 'status-badge success'} capitalize`}>
                            {user.role}
                          </span>
                        </td>
                        <td>{renderRoleDetails(user)}</td>
                        <td>
                          <span className={user.is_active ? 'status-badge success' : 'status-badge error'}>
                            {user.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-start justify-end gap-2">
                            <Button variant="secondary" className="!h-9 !w-9 !p-0" onClick={() => openEditModal(user)}>
                              <FiEdit2 className="h-[15px] w-[15px]" />
                            </Button>
                            <Button variant="secondary" className="!h-9 !w-9 !p-0" onClick={() => handleResetPassword(user.id)}>
                              <FiKey className="h-[15px] w-[15px]" />
                            </Button>
                            <Button
                              variant="secondary"
                              className="!h-9 !w-9 !p-0 !border-red-200 !text-red-600 hover:!bg-red-50"
                              onClick={() => {
                                setSelectedUser(user);
                                setShowDeleteModal(true);
                              }}
                            >
                              <FiTrash2 className="h-[15px] w-[15px]" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5" className="py-14 text-center text-slate-500">
                        No {entityPluralLabel.toLowerCase()} found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {pagination.totalPages > 1 && (
              <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="body-sm">
                  Showing {users.length} of {pagination.total} {entityPluralLabel.toLowerCase()}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={pagination.page === 1}
                    onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={pagination.page === pagination.totalPages}
                    onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card.Body>
        </Card>
      </div>

      <Modal
        open={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          resetForm();
        }}
        title={`Create ${entityLabel}`}
        subtitle="Add account details and role-specific information."
        maxWidth="max-w-2xl"
        footer={
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                setShowCreateModal(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="create-user-form" disabled={formLoading || studentCreationBlocked} className="w-full">
              {formLoading ? 'Creating...' : `Create ${entityLabel}`}
            </Button>
          </div>
        }
      >
        <form id="create-user-form" onSubmit={handleCreateUser} className="space-y-4">
          {fixedRole ? (
            <div className="surface-card-muted p-4">
              <p className="text-sm text-slate-700">
                User Type: <span className="font-medium capitalize">{fixedRole}</span>
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="form-label !mb-0">User Type</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, role: 'student' })}
                  disabled={!classesLoading && !hasAvailableClasses}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    formData.role === 'student' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'
                  } ${!classesLoading && !hasAvailableClasses ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <div className="mb-2 inline-flex rounded-lg bg-blue-100 p-2 text-blue-700">
                    <FiUsers className="h-4 w-4" />
                  </div>
                  <p className="font-medium">Student</p>
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, role: 'teacher' })}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    formData.role === 'teacher' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'
                  }`}
                >
                  <div className="mb-2 inline-flex rounded-lg bg-blue-100 p-2 text-blue-700">
                    <FiBriefcase className="h-4 w-4" />
                  </div>
                  <p className="font-medium">Teacher</p>
                </button>
              </div>
              {!classesLoading && !hasAvailableClasses && (
                <p className="text-sm text-amber-600">Create at least one class before adding students.</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <InputField
              className="md:col-span-2"
              label="Full Name *"
              leftIcon={FiUser}
              required
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              placeholder="John Doe"
            />
            <InputField
              label="Email *"
              type="email"
              leftIcon={FiMail}
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="john@example.com"
            />
            <InputField
              label="Phone"
              leftIcon={FiPhone}
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="1234567890"
            />
          </div>

          {formData.role === 'student' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <InputField
                label="Roll Number *"
                required
                value={formData.roll_number}
                onChange={(e) => setFormData({ ...formData, roll_number: e.target.value })}
                placeholder="STU001"
              />
              <SelectField
                label="Class *"
                required
                value={formData.class_id}
                onChange={(e) => setFormData({ ...formData, class_id: e.target.value, section_id: '' })}
                disabled={classesLoading || !hasAvailableClasses}
              >
                <option value="">{classesLoading ? 'Loading classes...' : 'Select Class'}</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Section"
                value={formData.section_id}
                onChange={(e) => setFormData({ ...formData, section_id: e.target.value })}
                disabled={!formData.class_id}
              >
                <option value="">Select Section</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Zone"
                value={formData.zone}
                onChange={(e) => setFormData({ ...formData, zone: e.target.value })}
              >
                <option value="">Select Zone</option>
                {zones.map((zone) => (
                  <option key={zone.value} value={zone.value}>
                    {zone.label}
                  </option>
                ))}
              </SelectField>
            </div>
          )}

          {formData.role === 'teacher' && (
            <InputField
              label="Employee ID *"
              required
              value={formData.employee_id}
              onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
              placeholder="EMP001"
            />
          )}
        </form>
      </Modal>

      <Modal
        open={showEditModal && !!selectedUser}
        onClose={closeEditModal}
        title={`Edit ${entityLabel} Profile`}
        subtitle="Update account details and role information."
        maxWidth="max-w-2xl"
        footer={
          <div className="flex flex-col justify-end gap-3 sm:flex-row">
            <Button variant="secondary" className="w-full sm:w-40" onClick={closeEditModal}>
              Cancel
            </Button>
            <Button type="submit" form="edit-user-form" disabled={formLoading} className="w-full sm:w-44">
              {formLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        }
      >
        {selectedUser && (
          <form id="edit-user-form" onSubmit={handleUpdateUser} className="space-y-5">
            <div className="surface-card-muted p-4">
              <p className="text-sm text-slate-700">
                User Type: <span className="font-medium capitalize">{editFormData.role}</span>
              </p>
            </div>

            <div className="surface-card-muted p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Basic Details</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <InputField
                  className="md:col-span-2"
                  label="Full Name *"
                  leftIcon={FiUser}
                  required
                  value={editFormData.full_name}
                  onChange={(e) => setEditFormData({ ...editFormData, full_name: e.target.value })}
                  placeholder="John Doe"
                />
                <InputField
                  label="Email *"
                  type="email"
                  leftIcon={FiMail}
                  required
                  value={editFormData.email}
                  onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                  placeholder="john@example.com"
                />
                <InputField
                  label="Phone"
                  leftIcon={FiPhone}
                  value={editFormData.phone}
                  onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                  placeholder="1234567890"
                />
                <SelectField
                  label="Status"
                  value={editFormData.is_active ? 'true' : 'false'}
                  onChange={(e) => setEditFormData({ ...editFormData, is_active: e.target.value === 'true' })}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </SelectField>
                <div>
                  <InputField
                    label="New Password"
                    value={editFormData.new_password}
                    onChange={(e) => setEditFormData({ ...editFormData, new_password: e.target.value })}
                    placeholder="Leave empty to keep current"
                  />
                  <p className="mt-1 text-xs text-slate-500">Minimum 6 characters if changing password.</p>
                </div>
              </div>
            </div>

            {editFormData.role === 'student' && (
              <div className="surface-card-muted p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Academic Details</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <InputField
                    label="Roll Number *"
                    required
                    value={editFormData.roll_number}
                    onChange={(e) => setEditFormData({ ...editFormData, roll_number: e.target.value })}
                    placeholder="STU001"
                  />
                  <SelectField
                    label="Class *"
                    required
                    value={editFormData.class_id}
                    onChange={(e) => setEditFormData({ ...editFormData, class_id: e.target.value, section_id: '' })}
                    disabled={classesLoading || !hasAvailableClasses}
                  >
                    <option value="">{classesLoading ? 'Loading classes...' : 'Select Class'}</option>
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.id}>
                        {cls.name}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    label="Section"
                    value={editFormData.section_id}
                    onChange={(e) => setEditFormData({ ...editFormData, section_id: e.target.value })}
                    disabled={!editFormData.class_id}
                  >
                    <option value="">Select Section</option>
                    {editSections.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.name}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    label="Zone"
                    value={editFormData.zone}
                    onChange={(e) => setEditFormData({ ...editFormData, zone: e.target.value })}
                  >
                    <option value="">Select Zone</option>
                    {zones.map((zone) => (
                      <option key={zone.value} value={zone.value}>
                        {zone.label}
                      </option>
                    ))}
                  </SelectField>
                </div>
              </div>
            )}

            {editFormData.role === 'teacher' && (
              <div className="surface-card-muted p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Employment Details</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <InputField
                    label="Employee ID *"
                    required
                    value={editFormData.employee_id}
                    onChange={(e) => setEditFormData({ ...editFormData, employee_id: e.target.value })}
                    placeholder="EMP001"
                  />
                  <InputField
                    label="Department"
                    value={editFormData.department}
                    onChange={(e) => setEditFormData({ ...editFormData, department: e.target.value })}
                    placeholder="Computer Science"
                  />
                </div>
              </div>
            )}
          </form>
        )}
      </Modal>

      <Modal
        open={showUploadModal}
        onClose={() => {
          setShowUploadModal(false);
          setUploadResults(null);
        }}
        title={`Bulk Upload ${entityPluralLabel}`}
        subtitle="Import records in one go using your Excel file."
        maxWidth="max-w-2xl"
        footer={
          uploadResults ? (
            <Button
              className="w-full"
              onClick={() => {
                setShowUploadModal(false);
                setUploadResults(null);
              }}
            >
              Done
            </Button>
          ) : null
        }
      >
        {!uploadResults ? (
          <div className="space-y-4">
            {!classesLoading && !hasAvailableClasses && (
              <div className="alert" style={{ background: '#FFFBEB', borderColor: '#FCD34D', color: '#92400E' }}>
                Student uploads need an existing class. Create a class first, or upload teacher records only.
              </div>
            )}

            <div className="surface-card-muted flex flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="rounded-full bg-blue-100 p-3 text-blue-700">
                <FiLayers className="h-6 w-6" />
              </div>
              <p className="text-sm text-slate-700">Upload an Excel file (.xlsx or .xls)</p>
              <p className="text-sm text-slate-500">Password will be the email prefix before @ for each user.</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleBulkUpload}
                className="hidden"
              />
              <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={formLoading}>
                <FiUpload className="h-4 w-4" />
                {formLoading ? 'Uploading...' : 'Upload File'}
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Button variant="secondary" onClick={() => handleDownloadTemplate('student')}>
                <FiDownload className="h-4 w-4" />
                Student Template
              </Button>
              <Button variant="secondary" onClick={() => handleDownloadTemplate('teacher')}>
                <FiDownload className="h-4 w-4" />
                Teacher Template
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="surface-card-muted p-4 text-center">
                <p className="text-2xl font-semibold text-green-600">{uploadResults.summary.successful}</p>
                <p className="text-sm text-slate-500">Successful</p>
              </div>
              <div className="surface-card-muted p-4 text-center">
                <p className="text-2xl font-semibold text-red-600">{uploadResults.summary.failed}</p>
                <p className="text-sm text-slate-500">Failed</p>
              </div>
            </div>

            {uploadResults.results.failed.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Row Errors</p>
                <div className="hide-scrollbar max-h-52 space-y-2 overflow-y-auto">
                  {uploadResults.results.failed.map((item, i) => (
                    <div key={i} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {item.row?.email || 'Unknown'}: {item.error}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={showDeleteModal && !!selectedUser}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedUser(null);
        }}
        title={`Delete ${entityLabel}`}
        subtitle="This action is permanent and cannot be undone."
        maxWidth="max-w-md"
        footer={
          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                setShowDeleteModal(false);
                setSelectedUser(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="danger" className="w-full" onClick={handleDeleteUser}>
              Delete
            </Button>
          </div>
        }
      >
        {selectedUser && (
          <p className="text-sm text-slate-600">
            Are you sure you want to delete <span className="font-semibold text-slate-800">{selectedUser.full_name}</span>?
          </p>
        )}
      </Modal>
    </Layout>
  );
};

export default UserManagement;
