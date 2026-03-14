import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { FiBookOpen, FiLayers, FiUsers, FiPlus, FiX, FiUser, FiMail, FiEye, FiUpload, FiSearch } from 'react-icons/fi';
import Layout from '../../components/Layout';
import { teacherAPI } from '../../services/api';
import Alert from '../../components/ui/Alert';

const TeacherClasses = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [selectedClassForAdd, setSelectedClassForAdd] = useState(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [selectedClassForBulk, setSelectedClassForBulk] = useState(null);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkPreview, setBulkPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [studentFormData, setStudentFormData] = useState({
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

  const fetchAssignedData = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await teacherAPI.getAssignedStudents();
      setAssignedData(response.data);
    } catch (fetchError) {
      setError(fetchError.response?.data?.error || 'Failed to load assigned classes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignedData();
  }, []);

  const classSummaries = useMemo(() => {
    const classMap = new Map();

    (assignedData.assignments || []).forEach((assignment) => {
      const classId = assignment.class?.id || `unknown-${assignment.assignment_id}`;

      if (!classMap.has(classId)) {
        classMap.set(classId, {
          classId,
          className: assignment.class?.name || 'Unknown Class',
          sectionsMap: new Map(),
          zones: new Set(),
          allowAllSections: false,
          allowAllZones: false,
          totalStudents: 0
        });
      }

      const entry = classMap.get(classId);
      const sectionId = assignment.section?.id || null;
      const sectionKey = sectionId || '__all__';
      entry.sectionsMap.set(sectionKey, {
        id: sectionId,
        name: assignment.section?.name || 'All Sections'
      });

      if (!sectionId) {
        entry.allowAllSections = true;
      }

      entry.zones.add(assignment.zone || 'All Zones');

      if (!assignment.zone) {
        entry.allowAllZones = true;
      }

      entry.totalStudents += assignment.student_count || 0;
    });

    return Array.from(classMap.values()).map((entry) => ({
      ...entry,
      sections: Array.from(entry.sectionsMap.values()),
      zones: Array.from(entry.zones)
    }));
  }, [assignedData.assignments]);

  const filteredClassSummaries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return classSummaries;

    return classSummaries.filter((item) => {
      const className = item.className.toLowerCase();
      const sectionText = item.sections.map((section) => section.name.toLowerCase()).join(' ');
      return className.includes(query) || sectionText.includes(query);
    });
  }, [classSummaries, searchQuery]);

  const openAddStudentModal = (classItem) => {
    setSelectedClassForAdd(classItem);
    setStudentFormData({
      full_name: '',
      email: '',
      phone: '',
      roll_number: '',
      section_id: '',
      zone: ''
    });
    setShowAddStudentModal(true);
  };

  const openStudentsView = (classItem, section = null) => {
    const sectionParam = section?.id || 'all';

    navigate(`/teacher/${classItem.classId}/${sectionParam}/students`, {
      state: {
        className: classItem.className,
        sectionName: section?.name || 'All Sections'
      }
    });
  };

  const closeAddStudentModal = () => {
    setShowAddStudentModal(false);
    setSelectedClassForAdd(null);
    setFormLoading(false);
    setStudentFormData({
      full_name: '',
      email: '',
      phone: '',
      roll_number: '',
      section_id: '',
      zone: ''
    });
  };

  const handleAddStudent = async (event) => {
    event.preventDefault();

    if (!selectedClassForAdd) {
      return;
    }

    if (!selectedClassForAdd.allowAllSections && !studentFormData.section_id) {
      toast.error('Section is required for this class assignment');
      return;
    }

    if (!selectedClassForAdd.allowAllZones && !studentFormData.zone) {
      toast.error('Zone is required for this class assignment');
      return;
    }

    try {
      setFormLoading(true);
      const response = await teacherAPI.addStudentToClass(selectedClassForAdd.classId, {
        full_name: studentFormData.full_name,
        email: studentFormData.email,
        phone: studentFormData.phone || null,
        roll_number: studentFormData.roll_number,
        section_id: studentFormData.section_id || null,
        zone: studentFormData.zone || null
      });

      toast.success('Student added successfully');

      if (response.data.generatedPassword) {
        toast.success(`Password: ${response.data.generatedPassword}`, { duration: 10000 });
      }

      closeAddStudentModal();
      fetchAssignedData();
    } catch (submitError) {
      toast.error(submitError.response?.data?.error || 'Failed to add student');
    } finally {
      setFormLoading(false);
    }
  };

  const openBulkModal = (classItem) => {
    setSelectedClassForBulk(classItem);
    setBulkFile(null);
    setBulkPreview(null);
    setShowBulkModal(true);
  };

  const closeBulkModal = () => {
    setShowBulkModal(false);
    setSelectedClassForBulk(null);
    setBulkFile(null);
    setBulkPreview(null);
    setPreviewLoading(false);
    setImportLoading(false);
  };

  const handleBulkPreview = async () => {
    if (!selectedClassForBulk) return;

    if (!bulkFile) {
      toast.error('Please select a CSV file first');
      return;
    }

    try {
      setPreviewLoading(true);
      const response = await teacherAPI.previewBulkStudents(selectedClassForBulk.classId, bulkFile);
      setBulkPreview(response.data);

      const readyCount = response.data?.summary?.ready || 0;
      toast.success(`Preview ready: ${readyCount} row${readyCount === 1 ? '' : 's'} can be imported`);
    } catch (previewError) {
      toast.error(previewError.response?.data?.error || 'Failed to generate preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleBulkImport = async () => {
    if (!selectedClassForBulk || !bulkPreview?.candidates?.length) {
      toast.error('No valid rows available to import');
      return;
    }

    try {
      setImportLoading(true);
      const response = await teacherAPI.importBulkStudents(selectedClassForBulk.classId, bulkPreview.candidates);
      const createdCount = response.data?.summary?.created || 0;
      const skippedCount = response.data?.summary?.skipped || 0;

      toast.success(`Import finished: ${createdCount} created, ${skippedCount} skipped`);
      closeBulkModal();
      fetchAssignedData();
    } catch (importError) {
      toast.error(importError.response?.data?.error || 'Bulk import failed');
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header">
          <h1>My Classes</h1>
          <p>View your assigned classes, sections and zone mapping.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="min-h-[132px] bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="h-full flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-gray-500">Assigned Classes</p>
                <p className="text-4xl font-bold text-gray-800 mt-2 leading-none">{loading ? '...' : classSummaries.length}</p>
              </div>
              <div className="w-12 h-12 min-w-12 min-h-12 shrink-0 bg-primary rounded-xl flex items-center justify-center">
                <FiBookOpen className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>

          <div className="min-h-[132px] bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="h-full flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-gray-500">Class-Section Links</p>
                <p className="text-4xl font-bold text-gray-800 mt-2 leading-none">{loading ? '...' : assignedData.summary.total_assignments}</p>
              </div>
              <div className="w-12 h-12 min-w-12 min-h-12 shrink-0 bg-yellow-500 rounded-xl flex items-center justify-center">
                <FiLayers className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>

          <div className="min-h-[132px] bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="h-full flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-gray-500">Total Students</p>
                <p className="text-4xl font-bold text-gray-800 mt-2 leading-none">{loading ? '...' : assignedData.summary.total_students}</p>
              </div>
              <div className="w-12 h-12 min-w-12 min-h-12 shrink-0 bg-primary-dark rounded-xl flex items-center justify-center">
                <FiUsers className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        </div>

        <div className="surface-card p-6">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-lg font-semibold text-gray-800">Assigned Class List</h2>
            <div className="relative w-full md:w-80">
              <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search class or section"
                className="w-full rounded-xl border border-gray-300 py-2.5 pl-9 pr-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {loading && (
            <div className="space-y-3">
              {[...Array(3)].map((_, index) => (
                <div key={index} className="h-16 bg-gray-100 rounded-xl animate-pulse"></div>
              ))}
            </div>
          )}

          {!loading && error && (
            <Alert type="error">{error}</Alert>
          )}

          {!loading && !error && classSummaries.length === 0 && (
            <p className="text-gray-500">No class assignments found for your account.</p>
          )}

          {!loading && !error && classSummaries.length > 0 && filteredClassSummaries.length === 0 && (
            <p className="text-gray-500">No classes match your search.</p>
          )}

          {!loading && !error && filteredClassSummaries.length > 0 && (
            <div className="space-y-4">
              {filteredClassSummaries.map((item) => (
                <div key={item.classId} className="surface-card-muted p-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-semibold text-gray-800">{item.className}</p>
                        <p className="text-xs text-gray-500">
                          {item.sections.length} section option{item.sections.length === 1 ? '' : 's'} · {item.zones.length} zone option{item.zones.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      <span className="text-sm font-medium text-primary">
                        {item.totalStudents} student{item.totalStudents === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Sections</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.sections.map((section) => (
                            <span key={`${item.classId}-${section.name}`} className="status-badge info">
                              {section.name}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Zones</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.zones.map((zoneValue) => (
                            <span key={`${item.classId}-${zoneValue}`} className="status-badge warning capitalize">
                              {String(zoneValue).toLowerCase()}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => openStudentsView(item)}
                        className="btn btn-secondary !px-3 !py-1.5"
                      >
                        <FiEye className="w-4 h-4" />
                        <span className="text-sm font-medium">View All</span>
                      </button>
                      <button
                        onClick={() => openAddStudentModal(item)}
                        className="btn btn-primary !px-3 !py-1.5"
                      >
                        <FiPlus className="w-4 h-4" />
                        <span className="text-sm font-medium">Add Student</span>
                      </button>
                      <button
                        onClick={() => openBulkModal(item)}
                        className="btn btn-primary !px-3 !py-1.5"
                      >
                        <FiUpload className="w-4 h-4" />
                        <span className="text-sm font-medium">Bulk Add</span>
                      </button>
                    </div>

                    {item.sections.filter((section) => section.id).length > 0 && (
                      <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-blue-700">Section Wise View</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.sections
                            .filter((section) => section.id)
                            .map((section) => (
                              <button
                                key={`${item.classId}-view-${section.id}`}
                                type="button"
                                onClick={() => openStudentsView(item, section)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                              >
                                <FiEye className="h-3.5 w-3.5" />
                                {section.name}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showAddStudentModal && selectedClassForAdd && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="hide-scrollbar overflow-x-hidden bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-800">Add Student</h2>
                  <p className="text-sm text-gray-500 mt-1">Class: {selectedClassForAdd.className}</p>
                  <p className="text-xs text-gray-500 mt-1">Only sections and zones assigned to you are selectable.</p>
                </div>
                <button
                  onClick={closeAddStudentModal}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <FiX className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddStudent} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Full Name *</label>
                  <div className="relative">
                    <FiUser className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      required
                      value={studentFormData.full_name}
                      onChange={(event) => setStudentFormData((prev) => ({ ...prev, full_name: event.target.value }))}
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                      placeholder="Student Name"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                  <div className="relative">
                    <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="email"
                      required
                      value={studentFormData.email}
                      onChange={(event) => setStudentFormData((prev) => ({ ...prev, email: event.target.value }))}
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                      placeholder="student@example.com"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Roll Number *</label>
                  <input
                    type="text"
                    required
                    value={studentFormData.roll_number}
                    onChange={(event) => setStudentFormData((prev) => ({ ...prev, roll_number: event.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                    placeholder="STU001"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                  <input
                    type="tel"
                    value={studentFormData.phone}
                    onChange={(event) => setStudentFormData((prev) => ({ ...prev, phone: event.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                    placeholder="1234567890"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Section {selectedClassForAdd.allowAllSections ? '(optional)' : '*'}
                  </label>
                  <select
                    required={!selectedClassForAdd.allowAllSections}
                    value={studentFormData.section_id}
                    onChange={(event) => setStudentFormData((prev) => ({ ...prev, section_id: event.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                  >
                    <option value="">{selectedClassForAdd.allowAllSections ? 'All Sections' : 'Select Section'}</option>
                    {selectedClassForAdd.sections
                      .filter((section) => section.id)
                      .map((section) => (
                        <option key={section.id} value={section.id}>{section.name}</option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Zone {selectedClassForAdd.allowAllZones ? '(optional)' : '*'}
                  </label>
                  <select
                    required={!selectedClassForAdd.allowAllZones}
                    value={studentFormData.zone}
                    onChange={(event) => setStudentFormData((prev) => ({ ...prev, zone: event.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                  >
                    <option value="">{selectedClassForAdd.allowAllZones ? 'All Zones' : 'Select Zone'}</option>
                    {(selectedClassForAdd.allowAllZones
                      ? ['blue', 'red', 'green']
                      : selectedClassForAdd.zones.filter((zoneValue) => zoneValue && zoneValue !== 'All Zones'))
                      .map((zoneValue) => (
                        <option key={zoneValue} value={zoneValue}>
                          {zoneValue.charAt(0).toUpperCase() + zoneValue.slice(1)}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={closeAddStudentModal}
                    className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formLoading}
                    className="flex-1 px-4 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl transition-colors disabled:opacity-50"
                  >
                    {formLoading ? 'Adding...' : 'Add Student'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showBulkModal && selectedClassForBulk && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="hide-scrollbar overflow-x-hidden bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-800">Bulk Add Students</h2>
                  <p className="text-sm text-gray-500 mt-1">Class: {selectedClassForBulk.className}</p>
                </div>
                <button onClick={closeBulkModal} className="p-2 hover:bg-gray-100 rounded-lg">
                  <FiX className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-700">
                  <p className="font-medium text-gray-800 mb-2">CSV columns</p>
                  <p>Required: <span className="font-medium">full_name, email, roll_number</span></p>
                  <p>Optional: <span className="font-medium">phone, section_id or section_name, zone</span></p>
                  <p className="mt-1">Duplicates (CSV or existing database) are automatically skipped.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Upload CSV File</label>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setBulkFile(file);
                      setBulkPreview(null);
                    }}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleBulkPreview}
                    disabled={previewLoading}
                    className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {previewLoading ? 'Generating Preview...' : 'Preview'}
                  </button>
                  {bulkPreview && (
                    <button
                      type="button"
                      onClick={handleBulkImport}
                      disabled={importLoading || !bulkPreview.candidates?.length}
                      className="px-4 py-2 bg-primary-dark hover:bg-primary text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      {importLoading ? 'Importing...' : `Import ${bulkPreview.summary?.ready || 0} Student(s)`}
                    </button>
                  )}
                </div>

                {bulkPreview && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                        Total: <span className="font-semibold">{bulkPreview.summary?.total || 0}</span>
                      </div>
                      <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-blue-700">
                        Ready: <span className="font-semibold">{bulkPreview.summary?.ready || 0}</span>
                      </div>
                      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-700">
                        Skipped: <span className="font-semibold">{bulkPreview.summary?.skipped || 0}</span>
                      </div>
                    </div>

                    <div className="overflow-x-auto border border-gray-200 rounded-xl">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Row</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Roll</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(bulkPreview.rows || []).map((row) => (
                            <tr key={`${row.rowNumber}-${row.email}-${row.roll_number}`}>
                              <td className="px-3 py-2 text-gray-600">{row.rowNumber}</td>
                              <td className="px-3 py-2 text-gray-800">{row.full_name || '-'}</td>
                              <td className="px-3 py-2 text-gray-600">{row.email || '-'}</td>
                              <td className="px-3 py-2 text-gray-600">{row.roll_number || '-'}</td>
                              <td className="px-3 py-2">
                                <span className={`px-2 py-1 text-xs rounded-full ${row.status === 'ready' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {row.status}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-gray-600">{(row.reasons || []).join(', ') || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default TeacherClasses;
