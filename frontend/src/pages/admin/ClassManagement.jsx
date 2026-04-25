import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  FiPlus,
  FiEdit2,
  FiTrash2,
  FiBook,
  FiUserPlus,
  FiChevronRight,
  FiCalendar,
  FiUpload,
  FiDownload
} from 'react-icons/fi';
import { classAPI } from '../../services/api';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import InputField from '../../components/ui/InputField';
import SelectField from '../../components/ui/SelectField';
import Modal from '../../components/ui/Modal';

const zoneBadgeClass = (zone) => {
  if (zone === 'blue') return 'status-badge info';
  if (zone === 'red') return 'status-badge error';
  if (zone === 'green') return 'status-badge success';
  return 'status-badge warning';
};

const normalizeSectionName = (name) => String(name || '').toUpperCase().trim();

const ClassManagement = () => {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedClass, setExpandedClass] = useState(null);
  const [classDetails, setClassDetails] = useState(null);

  const [showClassModal, setShowClassModal] = useState(false);
  const [showSectionModal, setShowSectionModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showBulkAssignModal, setShowBulkAssignModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const [editingClass, setEditingClass] = useState(null);
  const [editingSection, setEditingSection] = useState(null);
  const [selectedClassId, setSelectedClassId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [classForm, setClassForm] = useState({ name: '', description: '', academic_year: '' });
  const [sectionForm, setSectionForm] = useState({ name: '' });
  const [assignForm, setAssignForm] = useState({ teacher_id: '', section_id: '', zone: '' });
  const [bulkAssignFile, setBulkAssignFile] = useState(null);

  const [teachers, setTeachers] = useState([]);
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    fetchClasses();
  }, []);

  const fetchClasses = async () => {
    try {
      setLoading(true);
      const response = await classAPI.getAll();
      setClasses(response.data);
    } catch {
      toast.error('Failed to fetch classes');
    } finally {
      setLoading(false);
    }
  };

  const fetchClassDetails = async (classId) => {
    try {
      const [detailsResponse, sectionsResponse] = await Promise.all([
        classAPI.getById(classId),
        classAPI.getSections(classId)
      ]);

      const details = detailsResponse.data;
      const sectionStats = sectionsResponse.data || [];
      const sectionStatsMap = new Map(sectionStats.map((section) => [section.id, section]));

      const sectionTeacherCounts = (details.teacher_assignments || []).reduce((acc, assignment) => {
        const sectionId = assignment.section?.id;
        if (!sectionId) return acc;
        acc.set(sectionId, (acc.get(sectionId) || 0) + 1);
        return acc;
      }, new Map());

      const mergedSections = (details.sections || []).map((section) => {
        const stats = sectionStatsMap.get(section.id);
        return {
          ...section,
          student_count: stats?.student_count || 0,
          teacher_count: sectionTeacherCounts.get(section.id) || 0
        };
      });

      setClassDetails({
        ...details,
        sections: mergedSections
      });
    } catch {
      toast.error('Failed to fetch class details');
    }
  };

  const fetchTeachers = async () => {
    try {
      const response = await classAPI.getTeachers();
      setTeachers(response.data);
    } catch {
      toast.error('Failed to fetch teachers');
    }
  };

  const toggleExpand = async (classId) => {
    if (expandedClass === classId) {
      setExpandedClass(null);
      setClassDetails(null);
    } else {
      setExpandedClass(classId);
      await fetchClassDetails(classId);
    }
  };

  const handleCreateClass = async (e) => {
    e.preventDefault();
    setFormLoading(true);

    try {
      if (editingClass) {
        await classAPI.update(editingClass.id, classForm);
        toast.success('Class updated successfully');
      } else {
        await classAPI.create(classForm);
        toast.success('Class created successfully');
      }
      setShowClassModal(false);
      resetClassForm();
      fetchClasses();
      if (expandedClass) fetchClassDetails(expandedClass);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Operation failed');
    } finally {
      setFormLoading(false);
    }
  };

  const openEditClass = (cls) => {
    setEditingClass(cls);
    setClassForm({
      name: cls.name,
      description: cls.description || '',
      academic_year: cls.academic_year || ''
    });
    setShowClassModal(true);
  };

  const resetClassForm = () => {
    setEditingClass(null);
    setClassForm({ name: '', description: '', academic_year: '' });
  };

  const handleCreateSection = async (e) => {
    e.preventDefault();
    setFormLoading(true);

    try {
      const payload = {
        name: normalizeSectionName(sectionForm.name)
      };

      if (editingSection) {
        await classAPI.updateSection(selectedClassId, editingSection.id, payload);
        toast.success('Section updated successfully');
      } else {
        await classAPI.createSection(selectedClassId, payload);
        toast.success('Section created successfully');
      }

      setShowSectionModal(false);
      resetSectionForm();
      fetchClasses();
      fetchClassDetails(selectedClassId);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Operation failed');
    } finally {
      setFormLoading(false);
    }
  };

  const openAddSection = (classId) => {
    setSelectedClassId(classId);
    setEditingSection(null);
    setSectionForm({ name: '' });
    setShowSectionModal(true);
  };

  const openEditSection = (classId, section) => {
    setSelectedClassId(classId);
    setEditingSection(section);
    setSectionForm({
      name: normalizeSectionName(section.name)
    });
    setShowSectionModal(true);
  };

  const resetSectionForm = () => {
    setEditingSection(null);
    setSectionForm({ name: '' });
  };

  const openAssignTeacher = async (classId) => {
    setSelectedClassId(classId);
    setAssignForm({ teacher_id: '', section_id: '', zone: '' });
    await fetchTeachers();
    setShowAssignModal(true);
  };

  const openBulkAssignTeacher = (classId) => {
    setSelectedClassId(classId);
    setBulkAssignFile(null);
    setShowBulkAssignModal(true);
  };

  const handleAssignTeacher = async (e) => {
    e.preventDefault();
    setFormLoading(true);

    try {
      await classAPI.assignTeacher(selectedClassId, assignForm);
      toast.success('Teacher assigned successfully');
      setShowAssignModal(false);
      fetchClassDetails(selectedClassId);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Assignment failed');
    } finally {
      setFormLoading(false);
    }
  };

  const handleRemoveAssignment = async (assignmentId) => {
    try {
      await classAPI.removeAssignment(assignmentId);
      toast.success('Assignment removed');
      fetchClassDetails(expandedClass);
    } catch {
      toast.error('Failed to remove assignment');
    }
  };

  const handleBulkAssignTeachers = async (e) => {
    e.preventDefault();

    if (!selectedClassId) {
      toast.error('Please select a class first');
      return;
    }

    if (!bulkAssignFile) {
      toast.error('Please choose a CSV file');
      return;
    }

    setFormLoading(true);

    try {
      const response = await classAPI.bulkAssignTeachers(selectedClassId, bulkAssignFile);
      const summary = response.data?.summary || {};
      toast.success(`Bulk done: ${summary.created_count || 0} created, ${summary.skipped_count || 0} skipped`);
      setShowBulkAssignModal(false);
      setBulkAssignFile(null);
      fetchClassDetails(selectedClassId);
      fetchClasses();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Bulk assignment failed');
    } finally {
      setFormLoading(false);
    }
  };

  const openDeleteModal = (type, item, classId = null) => {
    setDeleteTarget({ type, item, classId });
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    try {
      if (deleteTarget.type === 'class') {
        const response = await classAPI.delete(deleteTarget.item.id);
        toast.success(response.data?.message || 'Class deleted successfully');

        if (expandedClass === deleteTarget.item.id) {
          setExpandedClass(null);
          setClassDetails(null);
        }
      } else if (deleteTarget.type === 'section') {
        await classAPI.deleteSection(deleteTarget.classId, deleteTarget.item.id);
        toast.success('Section deleted successfully');
        fetchClassDetails(deleteTarget.classId);
      }

      setShowDeleteModal(false);
      setDeleteTarget(null);
      fetchClasses();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Delete failed');
    }
  };

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1>Class Management</h1>
            <p>Manage classes, sections, and teacher assignments from one place.</p>
          </div>
          <Button
            onClick={() => {
              resetClassForm();
              setShowClassModal(true);
            }}
          >
            <FiPlus className="h-4 w-4" />
            Add Class
          </Button>
        </div>

        {loading ? (
          <Card>
            <Card.Body className="py-12 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="mt-4 text-sm text-slate-500">Loading classes...</p>
            </Card.Body>
          </Card>
        ) : classes.length === 0 ? (
          <Card>
            <Card.Body className="py-12 text-center">
              <FiBook className="mx-auto mb-3 h-12 w-12 text-slate-300" />
              <p className="text-sm text-slate-500">No classes found. Create your first class.</p>
            </Card.Body>
          </Card>
        ) : (
          <div className="space-y-4">
            {classes.map((cls) => (
              <Card key={cls.id} className="overflow-hidden">
                <div
                  className="flex cursor-pointer flex-col gap-4 p-4 transition hover:bg-slate-50 md:flex-row md:items-center md:justify-between"
                  onClick={() => toggleExpand(cls.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`rounded-lg p-1.5 transition-transform ${expandedClass === cls.id ? 'rotate-90' : ''}`}>
                      <FiChevronRight className="h-5 w-5 text-slate-400" />
                    </div>
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                      <FiBook className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-medium text-slate-800">{cls.name}</h3>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-500">
                        {cls.academic_year && (
                          <span className="inline-flex items-center gap-1">
                            <FiCalendar className="h-3.5 w-3.5" />
                            {cls.academic_year}
                          </span>
                        )}
                        <span>{cls.section_count} sections</span>
                        <span>{cls.student_count} students</span>
                        <span>{cls.teacher_count} teachers</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className={cls.is_active ? 'status-badge success' : 'status-badge warning'}>
                      {cls.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <Button variant="secondary" className="!h-9 !w-9 !p-0" onClick={() => openEditClass(cls)}>
                      <FiEdit2 className="h-[15px] w-[15px]" />
                    </Button>
                    <Button
                      variant="secondary"
                      className="!h-9 !w-9 !p-0 !border-red-200 !text-red-600 hover:!bg-red-50"
                      onClick={() => openDeleteModal('class', cls)}
                    >
                      <FiTrash2 className="h-[15px] w-[15px]" />
                    </Button>
                  </div>
                </div>

                {expandedClass === cls.id && classDetails && (
                  <div className="border-t border-slate-100 bg-slate-50 p-4">
                    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="surface-card-muted p-3">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Sections</p>
                        <p className="mt-1 text-lg font-medium text-slate-800">{classDetails.sections.length}</p>
                      </div>
                      <div className="surface-card-muted p-3">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Students</p>
                        <p className="mt-1 text-lg font-medium text-slate-800">
                          {classDetails.sections.reduce((sum, section) => sum + (section.student_count || 0), 0)}
                        </p>
                      </div>
                      <div className="surface-card-muted p-3">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Teacher Assignments</p>
                        <p className="mt-1 text-lg font-medium text-slate-800">{classDetails.teacher_assignments.length}</p>
                      </div>
                      <div className="surface-card-muted p-3">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Unassigned Sections</p>
                        <p className="mt-1 text-lg font-medium text-slate-800">
                          {
                            classDetails.sections.filter((section) => (section.teacher_count || 0) === 0)
                              .length
                          }
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <Card className="border-slate-200">
                        <Card.Header className="flex items-center justify-between">
                          <h4 className="text-sm font-medium text-slate-700">Sections</h4>
                          <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => openAddSection(cls.id)}>
                            <FiPlus className="h-4 w-4" />
                            Add Section
                          </Button>
                        </Card.Header>
                        <Card.Body>
                          {classDetails.sections.length === 0 ? (
                            <p className="text-sm text-slate-400">No sections yet.</p>
                          ) : (
                            <div className="space-y-2">
                              {classDetails.sections.map((section) => (
                                <div
                                  key={section.id}
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 md:flex md:items-start md:justify-between"
                                >
                                  <div>
                                    <p className="text-sm font-medium text-slate-700">{normalizeSectionName(section.name)}</p>
                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                      <span className="status-badge info">Strength: {section.student_count || 0}</span>
                                      <span className="status-badge success">Teachers: {section.teacher_count || 0}</span>
                                    </div>
                                  </div>
                                  <div className="mt-2 flex items-center gap-1.5 md:mt-0 md:justify-end">
                                    <Button
                                      variant="secondary"
                                      className="!h-8 !w-8 !p-0"
                                      onClick={() => openEditSection(cls.id, section)}
                                    >
                                      <FiEdit2 className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="secondary"
                                      className="!h-8 !w-8 !p-0 !border-red-200 !text-red-600 hover:!bg-red-50"
                                      onClick={() => openDeleteModal('section', section, cls.id)}
                                    >
                                      <FiTrash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </Card.Body>
                      </Card>

                      <Card className="border-slate-200">
                        <Card.Header className="flex items-center justify-between">
                          <h4 className="text-sm font-medium text-slate-700">Assigned Teachers</h4>
                          <div className="flex items-center gap-2">
                            <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => openBulkAssignTeacher(cls.id)}>
                              <FiUpload className="h-4 w-4" />
                              Bulk CSV
                            </Button>
                            <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => openAssignTeacher(cls.id)}>
                              <FiUserPlus className="h-4 w-4" />
                              Assign
                            </Button>
                          </div>
                        </Card.Header>
                        <Card.Body>
                          {classDetails.teacher_assignments.length === 0 ? (
                            <p className="text-sm text-slate-400">No teachers assigned yet.</p>
                          ) : (
                            <div className="space-y-2">
                              {classDetails.teacher_assignments.map((assignment) => (
                                <div
                                  key={assignment.id}
                                  className="flex items-start justify-between rounded-xl border border-slate-200 bg-white px-3 py-2"
                                >
                                  <div className="flex items-start gap-2.5">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-xs font-semibold text-green-700">
                                      {assignment.teacher?.full_name?.charAt(0)?.toUpperCase()}
                                    </div>
                                    <div>
                                      <p className="text-sm font-medium text-slate-700">{assignment.teacher?.full_name}</p>
                                      <p className="text-xs text-slate-500">{assignment.teacher?.email}</p>
                                      <div className="mt-1 flex flex-wrap items-center gap-2">
                                        {assignment.section && (
                                          <span className="status-badge info">Section: {normalizeSectionName(assignment.section.name)}</span>
                                        )}
                                        {assignment.zone && (
                                          <span className={`${zoneBadgeClass(assignment.zone)} capitalize`}>
                                            {assignment.zone}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <Button
                                    variant="secondary"
                                    className="!h-8 !w-8 !p-0 !border-red-200 !text-red-600 hover:!bg-red-50"
                                    onClick={() => handleRemoveAssignment(assignment.id)}
                                  >
                                    <FiTrash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </Card.Body>
                      </Card>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={showClassModal}
        onClose={() => {
          setShowClassModal(false);
          resetClassForm();
        }}
        title={editingClass ? 'Edit Class' : 'Create Class'}
        subtitle="Set class name, year, and optional description."
        maxWidth="max-w-lg"
        footer={
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              className="w-full sm:w-32"
              onClick={() => {
                setShowClassModal(false);
                resetClassForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="class-form" disabled={formLoading} className="w-full sm:w-36">
              {formLoading ? 'Saving...' : editingClass ? 'Update' : 'Create'}
            </Button>
          </div>
        }
      >
        <form id="class-form" onSubmit={handleCreateClass} className="space-y-4">
          <InputField
            label="Class Name *"
            required
            value={classForm.name}
            onChange={(e) => setClassForm({ ...classForm, name: e.target.value })}
            placeholder="e.g., CSE-2024"
          />

          <div>
            <label className="form-label">Description</label>
            <textarea
              value={classForm.description}
              onChange={(e) => setClassForm({ ...classForm, description: e.target.value })}
              className="form-input min-h-[100px] resize-y"
              placeholder="Class description"
            />
          </div>

          <InputField
            label="Academic Year"
            value={classForm.academic_year}
            onChange={(e) => setClassForm({ ...classForm, academic_year: e.target.value })}
            placeholder="e.g., 2024-2025"
          />
        </form>
      </Modal>

      <Modal
        open={showSectionModal}
        onClose={() => {
          setShowSectionModal(false);
          resetSectionForm();
        }}
        title={editingSection ? 'Edit Section' : 'Add Section'}
        subtitle="Use short section names (automatically saved in UPPERCASE)."
        maxWidth="max-w-lg"
        footer={
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              className="w-full sm:w-32"
              onClick={() => {
                setShowSectionModal(false);
                resetSectionForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="section-form" disabled={formLoading} className="w-full sm:w-36">
              {formLoading ? 'Saving...' : editingSection ? 'Update' : 'Add Section'}
            </Button>
          </div>
        }
      >
        <form id="section-form" onSubmit={handleCreateSection} className="space-y-4">
          <InputField
            label="Section Name *"
            required
            value={sectionForm.name}
            onChange={(e) => setSectionForm({ ...sectionForm, name: normalizeSectionName(e.target.value) })}
            placeholder="e.g., A, B, C"
          />
        </form>
      </Modal>

      <Modal
        open={showAssignModal}
        onClose={() => setShowAssignModal(false)}
        title="Assign Teacher"
        subtitle="Assign a teacher to this class, section, and zone."
        maxWidth="max-w-lg"
        footer={
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" className="w-full sm:w-32" onClick={() => setShowAssignModal(false)}>
              Cancel
            </Button>
            <Button type="submit" form="assign-form" disabled={formLoading} className="w-full sm:w-36" variant="success">
              {formLoading ? 'Assigning...' : 'Assign'}
            </Button>
          </div>
        }
      >
        <form id="assign-form" onSubmit={handleAssignTeacher} className="space-y-4">
          {classDetails?.sections?.length > 0 && (
            <div className="surface-card-muted p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Available Sections</p>
              <div className="flex flex-wrap gap-2">
                {classDetails.sections.map((section) => (
                  <span key={section.id} className="status-badge info">
                    {normalizeSectionName(section.name)} • {section.student_count || 0} students
                  </span>
                ))}
              </div>
            </div>
          )}

          <SelectField
            label="Teacher *"
            required
            value={assignForm.teacher_id}
            onChange={(e) => setAssignForm({ ...assignForm, teacher_id: e.target.value })}
          >
            <option value="">Select Teacher</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.full_name} ({teacher.email})
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Section"
            value={assignForm.section_id}
            onChange={(e) => setAssignForm({ ...assignForm, section_id: e.target.value })}
          >
            <option value="">All Sections</option>
            {classDetails?.sections?.map((section) => (
              <option key={section.id} value={section.id}>
                {normalizeSectionName(section.name)} ({section.student_count || 0} students)
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Zone"
            value={assignForm.zone}
            onChange={(e) => setAssignForm({ ...assignForm, zone: e.target.value })}
          >
            <option value="">All Zones</option>
            <option value="blue">Blue</option>
            <option value="red">Red</option>
            <option value="green">Green</option>
          </SelectField>
        </form>
      </Modal>

      <Modal
        open={showDeleteModal && !!deleteTarget}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteTarget(null);
        }}
        title="Confirm Delete"
        subtitle="This action cannot be undone."
        maxWidth="max-w-md"
        footer={
          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                setShowDeleteModal(false);
                setDeleteTarget(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="danger" className="w-full" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        }
      >
        {deleteTarget && (
          <p className="text-sm text-slate-600">
            Are you sure you want to delete this {deleteTarget.type}: <span className="font-medium text-slate-800">{deleteTarget.item.name}</span>?
          </p>
        )}
      </Modal>

      <Modal
        open={showBulkAssignModal}
        onClose={() => {
          setShowBulkAssignModal(false);
          setBulkAssignFile(null);
        }}
        title="Bulk Assign Teachers"
        subtitle="Upload a CSV to assign multiple teachers to this class in one step."
        maxWidth="max-w-xl"
        footer={
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              className="w-full sm:w-32"
              onClick={() => {
                setShowBulkAssignModal(false);
                setBulkAssignFile(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="bulk-assign-form" disabled={formLoading} className="w-full sm:w-40" variant="success">
              {formLoading ? 'Uploading...' : 'Upload CSV'}
            </Button>
          </div>
        }
      >
        <form id="bulk-assign-form" onSubmit={handleBulkAssignTeachers} className="space-y-4">
          <div className="surface-card-muted p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">CSV Columns</p>
            <p className="mt-1 text-sm text-slate-600">
              Required: <span className="font-medium">teacher_email</span> (or <span className="font-medium">teacher_id</span>)
            </p>
            <p className="text-sm text-slate-600">
              Optional: <span className="font-medium">section_name</span> / <span className="font-medium">section_id</span>, <span className="font-medium">zone</span> (blue/red/green)
            </p>
            <a
              href="/teacher-assignments-template.csv"
              download
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <FiDownload className="h-4 w-4" />
              Download CSV Template
            </a>
          </div>

          <div>
            <label className="form-label">Select CSV File *</label>
            <input
              type="file"
              accept=".csv,text/csv"
              className="form-input"
              onChange={(e) => setBulkAssignFile(e.target.files?.[0] || null)}
            />
          </div>
        </form>
      </Modal>
    </Layout>
  );
};

export default ClassManagement;
