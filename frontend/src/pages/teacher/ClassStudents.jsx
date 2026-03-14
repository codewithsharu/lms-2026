import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useLocation, useParams } from 'react-router-dom';
import { FiArrowLeft, FiEdit2, FiTrash2, FiX, FiSearch, FiUsers, FiLayers } from 'react-icons/fi';
import Layout from '../../components/Layout';
import { teacherAPI } from '../../services/api';
import Alert from '../../components/ui/Alert';

const getZoneBadgeClass = (zoneValue) => {
  const normalized = String(zoneValue || '').toLowerCase();
  if (normalized === 'blue') return 'status-badge info';
  if (normalized === 'red') return 'status-badge error';
  if (normalized === 'green') return 'status-badge success';
  return 'status-badge warning';
};

const TeacherClassStudents = () => {
  const { classId, sectionId } = useParams();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [editFormData, setEditFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    roll_number: '',
    section_id: '',
    zone: ''
  });
  const [assignedData, setAssignedData] = useState({
    assignments: [],
    summary: {
      total_assignments: 0,
      total_students: 0
    }
  });

  const fetchAssignedStudents = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await teacherAPI.getAssignedStudents();
      setAssignedData(response.data);
    } catch (fetchError) {
      setError(fetchError.response?.data?.error || 'Failed to load class students');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignedStudents();
  }, []);

  const classAssignments = useMemo(() => {
    return (assignedData.assignments || []).filter((assignment) => {
      if (assignment.class?.id !== classId) {
        return false;
      }

      if (sectionId === 'all') {
        return true;
      }

      return assignment.section?.id === sectionId;
    });
  }, [assignedData.assignments, classId, sectionId]);

  const className = useMemo(() => {
    if (location.state?.className) {
      return location.state.className;
    }

    return classAssignments[0]?.class?.name || 'Class Students';
  }, [location.state, classAssignments]);

  const sectionName = useMemo(() => {
    if (location.state?.sectionName) {
      return location.state.sectionName;
    }

    if (sectionId === 'all') {
      return 'All Sections';
    }

    return classAssignments[0]?.section?.name || 'Section';
  }, [location.state, sectionId, classAssignments]);

  const students = useMemo(() => {
    const uniqueStudents = new Map();

    classAssignments.forEach((assignment) => {
      (assignment.students || []).forEach((student) => {
        if (!uniqueStudents.has(student.id)) {
          uniqueStudents.set(student.id, {
            ...student,
            zones: new Set(),
            sections: new Set(),
            sectionIds: new Set(),
            rawSectionId: student.section?.id || null,
            rawZone: student.zone || null
          });
        }

        const existingStudent = uniqueStudents.get(student.id);
        existingStudent.zones.add(student.zone || 'N/A');
        existingStudent.sections.add(student.section?.name || 'N/A');
        if (student.section?.id) {
          existingStudent.sectionIds.add(student.section.id);
        }
        if (!existingStudent.rawSectionId && student.section?.id) {
          existingStudent.rawSectionId = student.section.id;
        }
        if (!existingStudent.rawZone && student.zone) {
          existingStudent.rawZone = student.zone;
        }
      });
    });

    return Array.from(uniqueStudents.values()).map((student) => ({
      ...student,
      zones: Array.from(student.zones),
      sections: Array.from(student.sections),
      sectionIds: Array.from(student.sectionIds)
    }));
  }, [classAssignments]);

  const filteredStudents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return students;

    return students.filter((student) => {
      const fullName = String(student.full_name || '').toLowerCase();
      const email = String(student.email || '').toLowerCase();
      const rollNumber = String(student.roll_number || '').toLowerCase();
      return fullName.includes(query) || email.includes(query) || rollNumber.includes(query);
    });
  }, [students, searchQuery]);

  const availableSections = useMemo(() => {
    const sectionMap = new Map();

    classAssignments.forEach((assignment) => {
      if (assignment.section?.id) {
        sectionMap.set(assignment.section.id, assignment.section.name);
      }
    });

    return Array.from(sectionMap.entries()).map(([id, name]) => ({ id, name }));
  }, [classAssignments]);

  const allowAllSections = useMemo(
    () => classAssignments.some((assignment) => !assignment.section?.id),
    [classAssignments]
  );

  const availableZones = useMemo(() => {
    const zoneSet = new Set();

    classAssignments.forEach((assignment) => {
      if (assignment.zone) {
        zoneSet.add(assignment.zone);
      }
    });

    return Array.from(zoneSet);
  }, [classAssignments]);

  const allowAllZones = useMemo(
    () => classAssignments.some((assignment) => !assignment.zone),
    [classAssignments]
  );

  const openEditModal = (student) => {
    setSelectedStudent(student);
    setEditFormData({
      full_name: student.full_name || '',
      email: student.email || '',
      phone: student.phone || '',
      roll_number: student.roll_number || '',
      section_id: student.rawSectionId || '',
      zone: student.rawZone || ''
    });
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setSelectedStudent(null);
    setFormLoading(false);
  };

  const openDeleteModal = (student) => {
    setSelectedStudent(student);
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    setShowDeleteModal(false);
    setSelectedStudent(null);
    setFormLoading(false);
  };

  const handleUpdateStudent = async (event) => {
    event.preventDefault();

    if (!selectedStudent) {
      return;
    }

    if (!allowAllSections && !editFormData.section_id) {
      toast.error('Section is required for this class assignment');
      return;
    }

    if (!allowAllZones && !editFormData.zone) {
      toast.error('Zone is required for this class assignment');
      return;
    }

    try {
      setFormLoading(true);
      await teacherAPI.updateStudentInClass(classId, selectedStudent.id, {
        full_name: editFormData.full_name,
        email: editFormData.email,
        phone: editFormData.phone || null,
        roll_number: editFormData.roll_number,
        section_id: editFormData.section_id || null,
        zone: editFormData.zone || null
      });

      toast.success('Student updated successfully');
      closeEditModal();
      fetchAssignedStudents();
    } catch (updateError) {
      toast.error(updateError.response?.data?.error || 'Failed to update student');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteStudent = async () => {
    if (!selectedStudent) {
      return;
    }

    try {
      setFormLoading(true);
      await teacherAPI.deleteStudentFromClass(classId, selectedStudent.id);
      toast.success('Student removed successfully');
      closeDeleteModal();
      fetchAssignedStudents();
    } catch (deleteError) {
      toast.error(deleteError.response?.data?.error || 'Failed to remove student');
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1>{className} Students</h1>
            <p>Section: {sectionName}</p>
          </div>
          <Link
            to="/teacher/classes"
            className="btn btn-secondary"
          >
            <FiArrowLeft className="w-4 h-4" />
            <span>Back to My Classes</span>
          </Link>
        </div>

        <div className="surface-card p-6">
          {loading && (
            <div className="space-y-3">
              {[...Array(5)].map((_, index) => (
                <div key={index} className="h-12 bg-gray-100 rounded-xl animate-pulse"></div>
              ))}
            </div>
          )}

          {!loading && error && (
            <Alert type="error">{error}</Alert>
          )}

          {!loading && !error && classAssignments.length === 0 && (
            <p className="text-gray-500">No class assignment found for this class.</p>
          )}

          {!loading && !error && classAssignments.length > 0 && (
            <>
              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="surface-card-muted p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Total Students</p>
                  <p className="mt-1 flex items-center gap-1.5 text-lg font-semibold text-primary">
                    <FiUsers className="h-4 w-4" />
                    {students.length}
                  </p>
                </div>
                <div className="surface-card-muted p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Selected Section</p>
                  <p className="mt-1 text-lg font-semibold text-gray-800">{sectionName}</p>
                </div>
                <div className="surface-card-muted p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Assignment Scope</p>
                  <p className="mt-1 flex items-center gap-1.5 text-lg font-semibold text-gray-800">
                    <FiLayers className="h-4 w-4 text-primary" />
                    {classAssignments.length}
                  </p>
                </div>
              </div>

              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <p className="text-sm text-gray-500">
                  Search by student name, email, or roll number. Showing {filteredStudents.length} of {students.length}.
                </p>
                <div className="relative w-full md:w-80">
                  <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search students"
                    className="w-full rounded-xl border border-gray-300 py-2.5 pl-9 pr-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              {students.length === 0 ? (
                <p className="text-gray-500">No students found in this class for your assignment scope.</p>
              ) : filteredStudents.length === 0 ? (
                <p className="text-gray-500">No students match your search.</p>
              ) : (
                <div className="table-shell overflow-x-auto">
                  <table>
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Student</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Roll No.</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Sections</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Zones</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredStudents.map((student) => (
                        <tr key={student.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-800">{student.full_name}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{student.email}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{student.roll_number}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            <div className="flex flex-wrap gap-1.5">
                              {student.sections.map((sectionName) => (
                                <span key={`${student.id}-${sectionName}`} className="status-badge info">
                                  {sectionName}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            <div className="flex flex-wrap gap-1.5">
                              {student.zones.map((zoneName) => (
                                <span
                                  key={`${student.id}-${zoneName}`}
                                  className={`${getZoneBadgeClass(zoneName)} capitalize`}
                                >
                                  {String(zoneName).toLowerCase()}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => openEditModal(student)}
                                className="h-9 w-9 p-0 inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                                title="Edit Student"
                              >
                                <FiEdit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => openDeleteModal(student)}
                                className="h-9 w-9 p-0 inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                                title="Remove Student"
                              >
                                <FiTrash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {showEditModal && selectedStudent && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="hide-scrollbar overflow-x-hidden bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-800">Edit Student</h2>
                <button onClick={closeEditModal} className="p-2 hover:bg-gray-100 rounded-lg">
                  <FiX className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleUpdateStudent} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={editFormData.full_name}
                    onChange={(event) => setEditFormData((prev) => ({ ...prev, full_name: event.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                  <input
                    type="email"
                    required
                    value={editFormData.email}
                    onChange={(event) => setEditFormData((prev) => ({ ...prev, email: event.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                  <input
                    type="tel"
                    value={editFormData.phone}
                    onChange={(event) => setEditFormData((prev) => ({ ...prev, phone: event.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Roll Number *</label>
                  <input
                    type="text"
                    required
                    value={editFormData.roll_number}
                    onChange={(event) => setEditFormData((prev) => ({ ...prev, roll_number: event.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Section {allowAllSections ? '(optional)' : '*'}
                  </label>
                  <select
                    required={!allowAllSections}
                    value={editFormData.section_id}
                    onChange={(event) => setEditFormData((prev) => ({ ...prev, section_id: event.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                  >
                    <option value="">{allowAllSections ? 'All Sections' : 'Select Section'}</option>
                    {availableSections.map((section) => (
                      <option key={section.id} value={section.id}>{section.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Zone {allowAllZones ? '(optional)' : '*'}
                  </label>
                  <select
                    required={!allowAllZones}
                    value={editFormData.zone}
                    onChange={(event) => setEditFormData((prev) => ({ ...prev, zone: event.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                  >
                    <option value="">{allowAllZones ? 'All Zones' : 'Select Zone'}</option>
                    {(allowAllZones ? ['blue', 'red', 'green'] : availableZones).map((zoneValue) => (
                      <option key={zoneValue} value={zoneValue}>
                        {zoneValue.charAt(0).toUpperCase() + zoneValue.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={closeEditModal}
                    className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formLoading}
                    className="flex-1 px-4 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl transition-colors disabled:opacity-50"
                  >
                    {formLoading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showDeleteModal && selectedStudent && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-md p-6">
              <h2 className="text-xl font-semibold text-gray-800">Remove Student</h2>
              <p className="text-gray-600 mt-2">
                Are you sure you want to remove <span className="font-semibold">{selectedStudent.full_name}</span>?
              </p>

              <div className="flex gap-3 pt-6">
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteStudent}
                  disabled={formLoading}
                  className="flex-1 px-4 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors disabled:opacity-50"
                >
                  {formLoading ? 'Removing...' : 'Remove'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default TeacherClassStudents;
