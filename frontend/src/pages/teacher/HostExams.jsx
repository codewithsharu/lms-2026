import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiClock, FiEdit2, FiPlayCircle, FiPlus, FiRotateCcw, FiSave } from 'react-icons/fi';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import InputField from '../../components/ui/InputField';
import SelectField from '../../components/ui/SelectField';
import Modal from '../../components/ui/Modal';
import { assessmentAPI, teacherAPI } from '../../services/api';

const publishStatusOptions = ['draft', 'published', 'closed'];

const toDateTimeLocal = (isoValue) => {
  if (!isoValue) return '';

  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return '';

  const offsetMs = parsed.getTimezoneOffset() * 60000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
};

const toReadableDateTime = (isoValue) => {
  if (!isoValue) return 'Not set';

  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return 'Invalid time';

  return parsed.toLocaleString();
};

const buildAssignmentScope = (assignments = []) => {
  const classMap = new Map();

  assignments.forEach((assignment) => {
    const classId = assignment.class?.id;
    if (!classId) return;

    if (!classMap.has(classId)) {
      classMap.set(classId, {
        classId,
        className: assignment.class?.name || 'Unknown Class',
        sectionsMap: new Map(),
        zonesSet: new Set()
      });
    }

    const current = classMap.get(classId);

    if (assignment.section?.id) {
      current.sectionsMap.set(assignment.section.id, {
        id: assignment.section.id,
        name: assignment.section.name || 'Section'
      });
    }

    if (assignment.zone) {
      current.zonesSet.add(assignment.zone);
    }
  });

  return Array.from(classMap.values()).map((entry) => ({
    classId: entry.classId,
    className: entry.className,
    sections: Array.from(entry.sectionsMap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    zones: Array.from(entry.zonesSet.values()).sort()
  }));
};

const buildStudentScope = (assignments = []) => {
  const studentMap = new Map();

  assignments.forEach((assignment) => {
    const classId = assignment.class?.id || null;
    const assignmentSectionId = assignment.section?.id || null;
    const assignmentZone = assignment.zone || null;

    (assignment.students || []).forEach((student) => {
      const studentId = student.id;
      if (!studentId) return;

      if (!studentMap.has(studentId)) {
        studentMap.set(studentId, {
          id: studentId,
          full_name: student.full_name || 'Student',
          email: student.email || '',
          classIds: new Set(),
          sectionIds: new Set(),
          zones: new Set()
        });
      }

      const current = studentMap.get(studentId);

      if (classId) current.classIds.add(classId);
      if (student.section?.id || assignmentSectionId) current.sectionIds.add(student.section?.id || assignmentSectionId);
      if (student.zone || assignmentZone) current.zones.add(student.zone || assignmentZone);
    });
  });

  return Array.from(studentMap.values()).map((student) => ({
    id: student.id,
    full_name: student.full_name,
    email: student.email,
    classIds: Array.from(student.classIds),
    sectionIds: Array.from(student.sectionIds),
    zones: Array.from(student.zones)
  }));
};

const getStatusClass = (status) => {
  if (status === 'published') return 'success';
  if (status === 'closed') return 'warning';
  return 'info';
};

const HostExams = () => {
  const navigate = useNavigate();
  const [hostedExams, setHostedExams] = useState([]);
  const [assignmentScope, setAssignmentScope] = useState([]);
  const [studentScope, setStudentScope] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revokingExamId, setRevokingExamId] = useState(null);
  const [selectedExam, setSelectedExam] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editFormData, setEditFormData] = useState({
    class_id: '',
    section_id: '',
    zone: '',
    specific_student_id: '',
    allow_resume: true,
    publish_status: 'draft',
    start_time: '',
    end_time: '',
    max_attempts: 1,
    duration_minutes: 60
  });

  const fetchHostedExams = async () => {
    try {
      setLoading(true);
      const [hostedRes, assignedRes] = await Promise.all([
        assessmentAPI.getHostedExams(),
        teacherAPI.getAssignedStudents()
      ]);

      setHostedExams(hostedRes.data.hostedExams || []);

      const assignments = assignedRes.data?.assignments || [];
      setAssignmentScope(buildAssignmentScope(assignments));
      setStudentScope(buildStudentScope(assignments));
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load hosted exams');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHostedExams();
  }, []);

  const selectedClassScope = useMemo(
    () => assignmentScope.find((item) => item.classId === editFormData.class_id) || null,
    [assignmentScope, editFormData.class_id]
  );

  const zoneOptions = useMemo(() => {
    if (selectedClassScope?.zones?.length > 0) {
      return selectedClassScope.zones;
    }

    const uniqueZones = new Set();
    assignmentScope.forEach((scope) => {
      (scope.zones || []).forEach((zone) => uniqueZones.add(zone));
    });

    return uniqueZones.size > 0 ? Array.from(uniqueZones) : ['blue', 'red', 'green'];
  }, [assignmentScope, selectedClassScope]);

  const filteredStudentOptions = useMemo(() => {
    return studentScope.filter((student) => {
      if (editFormData.class_id && !student.classIds.includes(editFormData.class_id)) {
        return false;
      }

      if (editFormData.section_id && !student.sectionIds.includes(editFormData.section_id)) {
        return false;
      }

      if (editFormData.zone && !student.zones.includes(editFormData.zone)) {
        return false;
      }

      return true;
    });
  }, [studentScope, editFormData.class_id, editFormData.section_id, editFormData.zone]);

  useEffect(() => {
    if (!editFormData.specific_student_id) return;

    const stillValid = filteredStudentOptions.some((student) => student.id === editFormData.specific_student_id);
    if (!stillValid) {
      setEditFormData((prev) => ({ ...prev, specific_student_id: '' }));
    }
  }, [editFormData.specific_student_id, filteredStudentOptions]);

  const openEditModal = (exam) => {
    setSelectedExam(exam);
    setEditFormData({
      class_id: exam.class_id || '',
      section_id: exam.section_id || '',
      zone: exam.zone || '',
      specific_student_id: exam.specific_students?.[0]?.id || '',
      allow_resume: exam.allow_resume !== false,
      publish_status: exam.publish_status || 'draft',
      start_time: toDateTimeLocal(exam.start_time),
      end_time: toDateTimeLocal(exam.end_time),
      max_attempts: Number(exam.max_attempts || 1),
      duration_minutes: Number(exam.duration_minutes || 60)
    });
  };

  const closeEditModal = () => {
    setSelectedExam(null);
    setSaving(false);
  };

  const handleSaveEdits = async () => {
    if (!selectedExam) return;

    const attempts = Number(editFormData.max_attempts);
    const duration = Number(editFormData.duration_minutes);

    if (!Number.isFinite(attempts) || attempts <= 0) {
      toast.error('Max attempts must be at least 1');
      return;
    }

    if (!Number.isFinite(duration) || duration <= 0) {
      toast.error('Duration must be greater than 0 minutes');
      return;
    }

    if (
      editFormData.start_time &&
      editFormData.end_time &&
      new Date(editFormData.end_time) <= new Date(editFormData.start_time)
    ) {
      toast.error('End time must be after start time');
      return;
    }

    if (editFormData.publish_status === 'published' && (!editFormData.start_time || !editFormData.end_time)) {
      toast.error('Start and end time are required to publish an exam');
      return;
    }

    try {
      setSaving(true);

      const response = await assessmentAPI.updateHostedExam(selectedExam.id, {
        class_id: editFormData.class_id || null,
        section_id: editFormData.section_id || null,
        zone: editFormData.zone || null,
        allow_resume: editFormData.allow_resume,
        publish_status: editFormData.publish_status,
        start_time: editFormData.start_time || null,
        end_time: editFormData.end_time || null,
        max_attempts: attempts,
        duration_minutes: duration,
        assigned_student_ids: editFormData.specific_student_id
          ? [editFormData.specific_student_id]
          : []
      });

      toast.success(response.data?.message || 'Hosted exam updated successfully');
      closeEditModal();
      fetchHostedExams();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to update hosted exam');
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeExam = async (exam) => {
    if (!exam?.id || exam.publish_status !== 'published') return;

    const confirmed = window.confirm('Revoke this scheduled exam? It will move back to Draft and won\'t be visible to students.');
    if (!confirmed) return;

    try {
      setRevokingExamId(exam.id);
      await assessmentAPI.updateHostedExam(exam.id, { publish_status: 'draft' });
      toast.success('Exam moved back to Draft');
      fetchHostedExams();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to revoke exam');
    } finally {
      setRevokingExamId(null);
    }
  };

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1>Scheduled Exam</h1>
            <p>Review your hosted exams first, then create a new hosted exam from a template.</p>
          </div>
          <Button onClick={() => navigate('/teacher/assessments/host/new')}>
            <FiPlus className="h-4 w-4" />
            Schedule New Exam
          </Button>
        </div>

        <Card>
          <Card.Header>
            <h2 className="section-title">Scheduled Exam List</h2>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, index) => (
                  <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : hostedExams.length > 0 ? (
              <div className="table-shell overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Template</th>
                      <th>Scope</th>
                      <th>Window</th>
                      <th>Duration</th>
                      <th>Attempts</th>
                      <th>Resume</th>
                      <th>Status</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hostedExams.map((exam) => (
                      <tr key={exam.id}>
                        <td>
                          <p className="font-medium text-slate-800">{exam.template?.title || 'Template missing'}</p>
                          <p className="text-xs text-slate-500">ID: {exam.id.slice(0, 8)}</p>
                        </td>
                        <td>
                          <p>{exam.class?.name || 'All Classes'}</p>
                          <p className="text-xs text-slate-500">
                            {exam.specific_students?.length > 0
                              ? `Specific: ${exam.specific_students[0]?.full_name || exam.specific_students[0]?.email || 'Student'}`
                              : `${exam.section?.name || 'All Sections'} • ${exam.zone || 'All Zones'}`}
                          </p>
                        </td>
                        <td>
                          <p className="text-xs text-slate-600">{toReadableDateTime(exam.start_time)}</p>
                          <p className="text-xs text-slate-500">{toReadableDateTime(exam.end_time)}</p>
                        </td>
                        <td>
                          <span className="inline-flex items-center gap-1 text-sm">
                            <FiClock className="h-4 w-4 text-slate-400" />
                            {exam.duration_minutes} min
                          </span>
                        </td>
                        <td>{exam.max_attempts}</td>
                        <td>
                          <span className={`status-badge ${exam.allow_resume === false ? 'warning' : 'success'}`}>
                            {exam.allow_resume === false ? 'No' : 'Yes'}
                          </span>
                        </td>
                        <td>
                          <span className={`status-badge ${getStatusClass(exam.publish_status)}`}>
                            {exam.publish_status}
                          </span>
                        </td>
                        <td>
                          <div className="flex justify-end gap-2">
                            {exam.publish_status === 'published' && (
                              <Button
                                variant="secondary"
                                className="py-1.5! px-3! border-red-200! bg-red-50! text-red-700! hover:bg-red-100! inline-flex items-center gap-1.5"
                                onClick={() => handleRevokeExam(exam)}
                                disabled={revokingExamId === exam.id}
                              >
                                <FiRotateCcw className="h-4 w-4" />
                                {revokingExamId === exam.id ? 'Revoking...' : 'Revoke'}
                              </Button>
                            )}
                            <Button
                              variant="secondary"
                              className="py-1.5! px-3! inline-flex items-center gap-1.5"
                              onClick={() => openEditModal(exam)}
                            >
                              <FiEdit2 className="h-4 w-4" />
                              Edit
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-10 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-primary">
                  <FiPlayCircle className="h-7 w-7" />
                </div>
                <p className="text-base font-medium text-slate-800">No Scheduled exams yet</p>
                <p className="mt-1 text-sm text-slate-500">Click “Scheduled Exam” to create and publish assessments for your students.</p>
              </div>
            )}
          </Card.Body>
        </Card>

        <Modal
          open={Boolean(selectedExam)}
          onClose={closeEditModal}
          title="Edit Hosted Exam"
          subtitle={selectedExam ? selectedExam.template?.title || 'Hosted assessment' : ''}
          maxWidth="max-w-3xl"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeEditModal} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSaveEdits} disabled={saving}>
                <FiSave className="h-4 w-4" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SelectField
              label="Publish Status"
              value={editFormData.publish_status}
              onChange={(event) => setEditFormData((prev) => ({ ...prev, publish_status: event.target.value }))}
            >
              {publishStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </option>
              ))}
            </SelectField>

            <InputField
              label="Max Attempts"
              type="number"
              min="1"
              value={editFormData.max_attempts}
              onChange={(event) => setEditFormData((prev) => ({ ...prev, max_attempts: event.target.value }))}
            />

            <InputField
              label="Duration (minutes)"
              type="number"
              min="1"
              value={editFormData.duration_minutes}
              onChange={(event) => setEditFormData((prev) => ({ ...prev, duration_minutes: event.target.value }))}
            />

            <SelectField
              label="Allow Resume"
              value={editFormData.allow_resume ? 'true' : 'false'}
              onChange={(event) => setEditFormData((prev) => ({
                ...prev,
                allow_resume: event.target.value === 'true'
              }))}
            >
              <option value="true">Allow resume after exit</option>
              <option value="false">Do not allow resume after exit</option>
            </SelectField>

            <SelectField
              label="Class"
              value={editFormData.class_id}
              onChange={(event) => setEditFormData((prev) => ({
                ...prev,
                class_id: event.target.value,
                section_id: '',
                zone: '',
                specific_student_id: ''
              }))}
            >
              <option value="">All Assigned Classes</option>
              {assignmentScope.map((scope) => (
                <option key={scope.classId} value={scope.classId}>{scope.className}</option>
              ))}
            </SelectField>

            <SelectField
              label="Section"
              value={editFormData.section_id}
              onChange={(event) => setEditFormData((prev) => ({
                ...prev,
                section_id: event.target.value,
                specific_student_id: ''
              }))}
            >
              <option value="">All Sections</option>
              {(selectedClassScope?.sections || []).map((section) => (
                <option key={section.id} value={section.id}>{section.name}</option>
              ))}
            </SelectField>

            <SelectField
              label="Zone"
              value={editFormData.zone}
              onChange={(event) => setEditFormData((prev) => ({
                ...prev,
                zone: event.target.value,
                specific_student_id: ''
              }))}
            >
              <option value="">All Zones</option>
              {zoneOptions.map((zone) => (
                <option key={zone} value={zone}>{zone.charAt(0).toUpperCase() + zone.slice(1)}</option>
              ))}
            </SelectField>

            <SelectField
              label="Specific Student"
              value={editFormData.specific_student_id}
              onChange={(event) => setEditFormData((prev) => ({ ...prev, specific_student_id: event.target.value }))}
            >
              <option value="">None (use class/section/zone scope)</option>
              {filteredStudentOptions.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.full_name} {student.email ? `(${student.email})` : ''}
                </option>
              ))}
            </SelectField>

            <InputField
              label="Start Date/Time"
              type="datetime-local"
              value={editFormData.start_time}
              onChange={(event) => setEditFormData((prev) => ({ ...prev, start_time: event.target.value }))}
            />

            <InputField
              label="End Date/Time"
              type="datetime-local"
              value={editFormData.end_time}
              onChange={(event) => setEditFormData((prev) => ({ ...prev, end_time: event.target.value }))}
            />
          </div>
        </Modal>
      </div>
    </Layout>
  );
};

export default HostExams;
