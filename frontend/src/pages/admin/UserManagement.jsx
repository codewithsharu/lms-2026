import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
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
  const isStudentManagement = fixedRole === 'student';
  const isTeacherManagement = fixedRole === 'teacher';
  const [studentTab, setStudentTab] = useState('assigned');
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [showAssignStudentsModal, setShowAssignStudentsModal] = useState(false);
  const [assignTargetIds, setAssignTargetIds] = useState([]);
  const [assignFormData, setAssignFormData] = useState({ class_id: '', section_id: '', zone: '' });
  const [assignSections, setAssignSections] = useState([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const [deleteMode, setDeleteMode] = useState('single');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(searchParams.get('action') === 'create');
  const [showUploadModal, setShowUploadModal] = useState(searchParams.get('action') === 'upload');
  const [uploadProgress, setUploadProgress] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('123456789');
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);

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
  const activeStudentTab = isStudentManagement ? studentTab : '';
  const isUnassignedStudentsTab = isStudentManagement && studentTab === 'unassigned';
  const supportsBulkSelection = isStudentManagement || isTeacherManagement;
  const tableColumnCount = supportsBulkSelection ? 6 : 5;
  const selectedUsersCount = selectedUserIds.length;
  const selectedUsers = users.filter((user) => selectedUserIds.includes(user.id));
  const selectedActiveTeachersCount = isTeacherManagement
    ? selectedUsers.filter((user) => user.is_active).length
    : 0;
  const selectedInactiveTeachersCount = isTeacherManagement
    ? selectedUsers.filter((user) => !user.is_active).length
    : 0;
  const allCurrentUsersSelected = users.length > 0 && users.every((user) => selectedUserIds.includes(user.id));

  const entityLabel = fixedRole === 'student' ? 'Student' : fixedRole === 'teacher' ? 'Teacher' : 'User';
  const entityPluralLabel = fixedRole === 'student' ? 'Students' : fixedRole === 'teacher' ? 'Teachers' : 'Users';
  const currentListLabel = isStudentManagement
    ? (isUnassignedStudentsTab ? 'unassigned students' : 'assigned students')
    : entityPluralLabel.toLowerCase();

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
  }, [pagination.page, searchQuery, activeRoleFilter, activeStudentTab]);

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
      const params = {
        page: pagination.page,
        limit: 10,
        search: searchQuery,
        role: activeRoleFilter
      };

      if (isStudentManagement) {
        params.assignment_status = studentTab;
      }

      const response = await userAPI.getAll(params);
      const fetchedUsers = response.data?.users || [];

      setUsers(fetchedUsers);
      setSelectedUserIds((previousIds) => previousIds.filter((id) => fetchedUsers.some((user) => user.id === id)));
      setPagination(response.data?.pagination || { page: 1, total: 0, totalPages: 0 });
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

  const handleStudentTabChange = (tab) => {
    if (!isStudentManagement || tab === studentTab) return;

    setStudentTab(tab);
    setSelectedUserIds([]);
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const handleToggleUserSelection = (userId) => {
    setSelectedUserIds((currentIds) => {
      if (currentIds.includes(userId)) {
        return currentIds.filter((id) => id !== userId);
      }

      return [...currentIds, userId];
    });
  };

  const handleToggleSelectAllUsers = () => {
    if (allCurrentUsersSelected) {
      setSelectedUserIds([]);
      return;
    }

    setSelectedUserIds(users.map((user) => user.id));
  };

  const openAssignSelectedModal = (targetUserIds = selectedUserIds) => {
    const resolvedTargetIds = Array.isArray(targetUserIds) ? targetUserIds : selectedUserIds;
    const uniqueTargetIds = Array.from(new Set(resolvedTargetIds.filter(Boolean)));

    if (classesLoading) {
      toast.error('Please wait while classes are loading');
      return;
    }

    if (!hasAvailableClasses) {
      toast.error('Create an active class before assigning students');
      return;
    }

    if (uniqueTargetIds.length === 0) {
      toast.error('Select at least one student to assign');
      return;
    }

    setSelectedUserIds(uniqueTargetIds);
    setAssignTargetIds(uniqueTargetIds);
    setAssignFormData({ class_id: '', section_id: '', zone: '' });
    setAssignSections([]);
    setShowAssignStudentsModal(true);
  };

  const closeAssignSelectedModal = () => {
    setShowAssignStudentsModal(false);
    setAssignTargetIds([]);
    setAssignFormData({ class_id: '', section_id: '', zone: '' });
    setAssignSections([]);
  };

  const handleAssignClassChange = async (classId) => {
    setAssignFormData((prev) => ({ ...prev, class_id: classId, section_id: '' }));

    if (!classId) {
      setAssignSections([]);
      return;
    }

    try {
      const response = await classAPI.getSections(classId);
      setAssignSections(response.data || []);
    } catch {
      setAssignSections([]);
      toast.error('Failed to load class sections');
    }
  };

  const handleAssignStudents = async (e) => {
    e.preventDefault();

    if (!assignFormData.class_id) {
      toast.error('Class is required for assignment');
      return;
    }

    if (assignTargetIds.length === 0) {
      toast.error('No students selected for assignment');
      return;
    }

    setAssignLoading(true);

    try {
      const payload = {
        class_id: assignFormData.class_id,
        section_id: assignFormData.section_id || null,
        zone: assignFormData.zone || null
      };

      const results = await Promise.allSettled(
        assignTargetIds.map((userId) => userAPI.update(userId, payload))
      );

      const successCount = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = results.length - successCount;

      if (successCount > 0) {
        toast.success(`Assigned ${successCount} student${successCount === 1 ? '' : 's'} successfully`);
      }

      if (failedCount > 0) {
        const firstError = results.find((result) => result.status === 'rejected')?.reason?.response?.data?.error;
        toast.error(firstError ? `${failedCount} failed: ${firstError}` : `${failedCount} assignment(s) failed`);
      }

      if (successCount > 0) {
        setSelectedUserIds([]);
        closeAssignSelectedModal();
        await fetchUsers();
      }
    } finally {
      setAssignLoading(false);
    }
  };

  const openBulkDeleteModal = () => {
    if (selectedUserIds.length === 0) {
      toast.error(`Select at least one ${entityLabel.toLowerCase()} to delete`);
      return;
    }

    setDeleteMode('bulk');
    setSelectedUser(null);
    setShowDeleteModal(true);
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
    if (deleteMode === 'bulk') {
      if (selectedUserIds.length === 0) return;

      try {
        setDeleteLoading(true);

        if (isTeacherManagement) {
          const selectedTeachers = users.filter((user) => selectedUserIds.includes(user.id));
          const activeTeachers = selectedTeachers.filter((teacher) => teacher.is_active);
          const inactiveTeachers = selectedTeachers.filter((teacher) => !teacher.is_active);

          const deactivateResults = await Promise.allSettled(
            activeTeachers.map((teacher) => userAPI.update(teacher.id, { is_active: false }))
          );
          const deleteResults = await Promise.allSettled(
            inactiveTeachers.map((teacher) => userAPI.delete(teacher.id))
          );

          const deactivatedCount = deactivateResults.filter((result) => result.status === 'fulfilled').length;
          const deletedCount = deleteResults.filter((result) => result.status === 'fulfilled').length;
          const deactivateFailedCount = deactivateResults.length - deactivatedCount;
          const deleteFailedCount = deleteResults.length - deletedCount;
          const totalFailed = deactivateFailedCount + deleteFailedCount;

          if (deactivatedCount > 0) {
            toast.success(`Marked ${deactivatedCount} teacher${deactivatedCount === 1 ? '' : 's'} as inactive`);
          }

          if (deletedCount > 0) {
            toast.success(`Deleted ${deletedCount} inactive teacher${deletedCount === 1 ? '' : 's'}`);
          }

          if (totalFailed > 0) {
            const firstError = [...deactivateResults, ...deleteResults].find((result) => result.status === 'rejected')
              ?.reason?.response?.data?.error;
            toast.error(firstError ? `${totalFailed} action(s) failed: ${firstError}` : `${totalFailed} action(s) failed`);
          }
        } else {
          const results = await Promise.allSettled(selectedUserIds.map((userId) => userAPI.delete(userId)));
          const successCount = results.filter((result) => result.status === 'fulfilled').length;
          const failedCount = results.length - successCount;

          if (successCount > 0) {
            toast.success(`Deleted ${successCount} ${successCount === 1 ? 'user' : 'users'} successfully`);
          }

          if (failedCount > 0) {
            const firstError = results.find((result) => result.status === 'rejected')?.reason?.response?.data?.error;
            toast.error(firstError ? `${failedCount} failed: ${firstError}` : `${failedCount} delete action(s) failed`);
          }
        }

        setShowDeleteModal(false);
        setSelectedUserIds([]);
        setDeleteMode('single');
        await fetchUsers();
      } catch (error) {
        toast.error(error.response?.data?.error || 'Failed to process selected users');
      } finally {
        setDeleteLoading(false);
      }

      return;
    }

    if (!selectedUser) return;

    try {
      setDeleteLoading(true);
      await userAPI.delete(selectedUser.id);
      toast.success(`${entityLabel} deleted successfully`);
      setShowDeleteModal(false);
      setSelectedUser(null);
      setDeleteMode('single');
      await fetchUsers();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to delete user');
    } finally {
      setDeleteLoading(false);
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

        if (editFormData.class_id) {
          payload.class_id = editFormData.class_id;
          payload.section_id = editFormData.section_id || null;
        }

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

  const openResetPasswordModal = (user) => {
    setSelectedUser(user);
    setResetPasswordValue('123456789');
    setShowResetPasswordModal(true);
  };

  const closeResetPasswordModal = () => {
    setShowResetPasswordModal(false);
    setResetPasswordValue('123456789');
    setSelectedUser(null);
  };

  const handleResetPassword = async () => {
    if (!selectedUser) return;

    if (!resetPasswordValue || resetPasswordValue.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    try {
      setResetPasswordLoading(true);
      await userAPI.resetPassword(selectedUser.id, resetPasswordValue);
      toast.success('Password updated successfully');
      closeResetPasswordModal();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to update password');
    } finally {
      setResetPasswordLoading(false);
    }
  };

  const handleBulkUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setFormLoading(true);

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);

      if (!data.length) {
        toast.error('Excel file is empty');
        return;
      }

      const batchSize = 20;
      const batches = [];
      for (let i = 0; i < data.length; i += batchSize) {
        batches.push(data.slice(i, i + batchSize));
      }

      let totalSuccessful = 0;
      let totalFailed = 0;
      const allResults = { success: [], failed: [] };

      setUploadProgress({ total: batches.length, current: 0 });

      for (let i = 0; i < batches.length; i++) {
        const batchData = batches[i];
        const newSheet = XLSX.utils.json_to_sheet(batchData);
        const newWorkbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWorkbook, newSheet, sheetName);

        const excelBuffer = XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const batchFile = new File([blob], `batch_${i}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        const response = await userAPI.bulkUpload(batchFile);

        totalSuccessful += response.data.summary.successful || 0;
        totalFailed += response.data.summary.failed || 0;
        allResults.success.push(...(response.data.results?.success || []));
        allResults.failed.push(...(response.data.results?.failed || []));

        setUploadProgress({ total: batches.length, current: i + 1 });
      }

      setUploadResults({
        summary: { total: data.length, successful: totalSuccessful, failed: totalFailed },
        results: allResults
      });

      toast.success(`Uploaded ${totalSuccessful} users in ${batches.length} batches`);
      fetchUsers();
    } catch (error) {
      console.error('Bulk upload failed', error);
      toast.error(error.response?.data?.error || 'Upload failed');
    } finally {
      setFormLoading(false);
      setUploadProgress(null);
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
      toast.success(`${type === 'teacher' ? 'Teacher' : 'Student'} template downloaded`);
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
      const className = user.details?.classes?.name;

      return (
        <div className="space-y-1.5">
          {user.details?.roll_number && <p className="text-sm text-slate-600">Roll: {user.details.roll_number}</p>}
          {className ? <p className="text-sm text-slate-600">Class: {className}</p> : <p className="text-sm text-amber-600">Unassigned</p>}
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
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedUserIds([]);
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
            />
            {!fixedRole && (
              <SelectField
                className="md:col-span-4"
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value);
                  setSelectedUserIds([]);
                  setPagination((prev) => ({ ...prev, page: 1 }));
                }}
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

            {supportsBulkSelection && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                {isStudentManagement && (
                  <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-white p-1">
                    <button
                      type="button"
                      onClick={() => handleStudentTabChange('assigned')}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                        studentTab === 'assigned' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      Assigned Students
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStudentTabChange('unassigned')}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                        studentTab === 'unassigned' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      Unassigned Students
                    </button>
                  </div>
                )}

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-600">
                    {isTeacherManagement
                      ? 'Select one or more teachers to use bulk actions.'
                      : 'Select one or more students to use bulk actions.'}
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-600">{selectedUsersCount} selected</span>

                    {isUnassignedStudentsTab && (
                      <Button variant="secondary" onClick={() => openAssignSelectedModal()} disabled={selectedUsersCount === 0}>
                        <FiLayers className="h-4 w-4" />
                        Assign Selected
                      </Button>
                    )}

                    <Button
                      variant="secondary"
                      className="!border-red-200 !text-red-600 hover:!bg-red-50"
                      onClick={openBulkDeleteModal}
                      disabled={selectedUsersCount === 0}
                    >
                      <FiTrash2 className="h-4 w-4" />
                      Delete Selected
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="table-shell overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    {supportsBulkSelection && (
                      <th className="w-12">
                        <input
                          type="checkbox"
                          checked={allCurrentUsersSelected}
                          onChange={handleToggleSelectAllUsers}
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                          aria-label={`Select all visible ${entityPluralLabel.toLowerCase()}`}
                        />
                      </th>
                    )}
                    <th>User</th>
                    <th>Role</th>
                    <th>Details</th>
                    <th>Status</th>
                    <th className={`${isUnassignedStudentsTab ? 'w-[240px]' : 'w-[170px]'} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(5)].map((_, i) => (
                      <tr key={i}>
                        {supportsBulkSelection && (
                          <td>
                            <div className="h-5 w-5 animate-pulse rounded bg-slate-100" />
                          </td>
                        )}
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
                        {supportsBulkSelection && (
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedUserIds.includes(user.id)}
                              onChange={() => handleToggleUserSelection(user.id)}
                              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                              aria-label={`Select ${user.full_name}`}
                            />
                          </td>
                        )}
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
                            {isUnassignedStudentsTab && (
                              <Button
                                variant="secondary"
                                className="!h-9 !px-3"
                                onClick={() => openAssignSelectedModal([user.id])}
                              >
                                <FiLayers className="h-4 w-4" />
                                Assign
                              </Button>
                            )}
                            <Button variant="secondary" className="!h-9 !w-9 !p-0" onClick={() => openEditModal(user)}>
                              <FiEdit2 className="h-[15px] w-[15px]" />
                            </Button>
                            <Button variant="secondary" className="!h-9 !w-9 !p-0" onClick={() => openResetPasswordModal(user)}>
                              <FiKey className="h-[15px] w-[15px]" />
                            </Button>
                            <Button
                              variant="secondary"
                              className="!h-9 !w-9 !p-0 !border-red-200 !text-red-600 hover:!bg-red-50"
                              onClick={() => {
                                setDeleteMode('single');
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
                      <td colSpan={tableColumnCount} className="py-14 text-center text-slate-500">
                        {isStudentManagement
                          ? (isUnassignedStudentsTab ? 'No unassigned students found.' : 'No assigned students found.')
                          : `No ${entityPluralLabel.toLowerCase()} found.`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {pagination.totalPages > 1 && (
              <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="body-sm">
                  Showing {users.length} of {pagination.total} {currentListLabel}
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
                    label="Class"
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

            {uploadProgress && (
              <div className="space-y-2 mt-4">
                <div className="flex justify-between text-sm text-slate-600">
                  <span>Uploading batch {uploadProgress.current} of {uploadProgress.total}</span>
                  <span>{Math.round((uploadProgress.current / uploadProgress.total) * 100)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mt-4">
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
        open={showAssignStudentsModal}
        onClose={() => {
          if (assignLoading) return;
          closeAssignSelectedModal();
        }}
        title="Assign Selected Students"
        subtitle={`Assign class, section, and zone to ${assignTargetIds.length} selected student(s).`}
        maxWidth="max-w-lg"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" className="w-full" onClick={closeAssignSelectedModal} disabled={assignLoading}>
              Cancel
            </Button>
            <Button type="submit" form="assign-students-form" className="w-full" disabled={assignLoading || assignTargetIds.length === 0}>
              {assignLoading ? 'Assigning...' : 'Assign Students'}
            </Button>
          </div>
        }
      >
        <form id="assign-students-form" onSubmit={handleAssignStudents} className="space-y-4">
          <SelectField
            label="Class *"
            required
            value={assignFormData.class_id}
            onChange={(e) => handleAssignClassChange(e.target.value)}
            disabled={classesLoading || !hasAvailableClasses || assignLoading}
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
            value={assignFormData.section_id}
            onChange={(e) => setAssignFormData((prev) => ({ ...prev, section_id: e.target.value }))}
            disabled={!assignFormData.class_id || assignLoading}
          >
            <option value="">Select Section</option>
            {assignSections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Zone"
            value={assignFormData.zone}
            onChange={(e) => setAssignFormData((prev) => ({ ...prev, zone: e.target.value }))}
            disabled={assignLoading}
          >
            <option value="">Select Zone</option>
            {zones.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </SelectField>
        </form>
      </Modal>

      <Modal
        open={showResetPasswordModal && !!selectedUser}
        onClose={closeResetPasswordModal}
        title={`Reset Password - ${entityLabel}`}
        subtitle="Set a new password before confirming the reset."
        maxWidth="max-w-md"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" className="w-full" onClick={closeResetPasswordModal}>
              Cancel
            </Button>
            <Button className="w-full" onClick={handleResetPassword} disabled={resetPasswordLoading}>
              {resetPasswordLoading ? 'Updating...' : 'Update Password'}
            </Button>
          </div>
        }
      >
        {selectedUser && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              You are changing password for <span className="font-semibold text-slate-800">{selectedUser.full_name}</span>.
            </p>
            <InputField
              label="New Password"
              value={resetPasswordValue}
              onChange={(e) => setResetPasswordValue(e.target.value)}
              placeholder="Enter new password"
            />
            <p className="text-xs text-slate-500">Default value is <span className="font-medium">123456789</span>. You can edit it before saving.</p>
          </div>
        )}
      </Modal>

      <Modal
        open={showDeleteModal && (deleteMode === 'bulk' || !!selectedUser)}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedUser(null);
          setDeleteMode('single');
        }}
        title={
          deleteMode === 'bulk'
            ? (isTeacherManagement ? 'Manage Selected Teachers' : 'Delete Selected Users')
            : `Delete ${entityLabel}`
        }
        subtitle={
          deleteMode === 'bulk' && isTeacherManagement
            ? 'Active teachers will be changed to inactive. Inactive teachers will be deleted.'
            : 'This action is permanent and cannot be undone.'
        }
        maxWidth="max-w-md"
        footer={
          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="w-full"
              disabled={deleteLoading}
              onClick={() => {
                setShowDeleteModal(false);
                setSelectedUser(null);
                setDeleteMode('single');
              }}
            >
              Cancel
            </Button>
            <Button variant="danger" className="w-full" onClick={handleDeleteUser} disabled={deleteLoading}>
              {deleteLoading
                ? (deleteMode === 'bulk' && isTeacherManagement ? 'Processing...' : 'Deleting...')
                : (deleteMode === 'bulk' && isTeacherManagement ? 'Apply Bulk Action' : 'Delete')}
            </Button>
          </div>
        }
      >
        {deleteMode === 'bulk' ? (
          isTeacherManagement ? (
            <div className="space-y-2 text-sm text-slate-600">
              <p>
                Selected teachers: <span className="font-semibold text-slate-800">{selectedUsersCount}</span>
              </p>
              <p>
                Active to deactivate: <span className="font-semibold text-slate-800">{selectedActiveTeachersCount}</span>
              </p>
              <p>
                Inactive to delete: <span className="font-semibold text-slate-800">{selectedInactiveTeachersCount}</span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              Are you sure you want to delete <span className="font-semibold text-slate-800">{selectedUsersCount}</span> selected users?
            </p>
          )
        ) : (
          selectedUser && (
            <p className="text-sm text-slate-600">
              Are you sure you want to delete <span className="font-semibold text-slate-800">{selectedUser.full_name}</span>?
            </p>
          )
        )}
      </Modal>
    </Layout>
  );
};

export default UserManagement;
