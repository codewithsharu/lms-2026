import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiClock, FiCode, FiEdit2, FiEye, FiPlayCircle, FiPlus, FiRotateCcw, FiSave, FiTrash2, FiUnlock } from 'react-icons/fi';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import InputField from '../../components/ui/InputField';
import SelectField from '../../components/ui/SelectField';
import Modal from '../../components/ui/Modal';
import { assessmentAPI, classAPI, compilerAPI, teacherAPI } from '../../services/api';

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
        zonesSet: new Set(),
        hasAllSectionsAccess: false
      });
    }

    const current = classMap.get(classId);

    if (assignment.section?.id) {
      current.sectionsMap.set(assignment.section.id, {
        id: assignment.section.id,
        name: assignment.section.name || 'Section'
      });
    } else {
      current.hasAllSectionsAccess = true;
    }

    if (assignment.zone) {
      current.zonesSet.add(assignment.zone);
    }
  });

  return Array.from(classMap.values()).map((entry) => ({
    classId: entry.classId,
    className: entry.className,
    sections: Array.from(entry.sectionsMap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    zones: Array.from(entry.zonesSet.values()).sort(),
    hasAllSectionsAccess: entry.hasAllSectionsAccess
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

const extractChallengeQuestionCount = (payload) => {
  if (Array.isArray(payload?.problems)) {
    return payload.problems.length;
  }

  if (Array.isArray(payload?.challenge?.problems)) {
    return payload.challenge.problems.length;
  }

  return 0;
};

const HostExams = () => {
  const navigate = useNavigate();
  const [hostedExams, setHostedExams] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [assignmentScope, setAssignmentScope] = useState([]);
  const [studentScope, setStudentScope] = useState([]);
  const [challengeCatalog, setChallengeCatalog] = useState([]);
  const [codingQuestionCountByChallenge, setCodingQuestionCountByChallenge] = useState({});
  const [codingQuestionCountLoadingByChallenge, setCodingQuestionCountLoadingByChallenge] = useState({});
  const [challengeSearch, setChallengeSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [revokingExamId, setRevokingExamId] = useState(null);
  const [releasingResultsExamId, setReleasingResultsExamId] = useState(null);
  const [deletingExamId, setDeletingExamId] = useState(null);
  const [statusUpdatingExamId, setStatusUpdatingExamId] = useState(null);
  const [selectedExam, setSelectedExam] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editFormData, setEditFormData] = useState({
    exam_title: '',
    template_id: '',
    class_id: '',
    section_id: '',
    zone: '',
    specific_student_id: '',
    allow_resume: true,
    result_mode: 'after_end',
    publish_status: 'draft',
    start_time: '',
    end_time: '',
    instructions: '',
    max_attempts: 1,
    duration_minutes: 60,
    enable_coding_section: false,
    coding_challenge_ids: []
  });

  const fetchHostedExams = async () => {
    try {
      setLoading(true);
      const [hostedRes, assignedRes] = await Promise.all([
        assessmentAPI.getHostedExams(),
        teacherAPI.getAssignedStudents()
      ]);

      try {
        const templateRes = await assessmentAPI.getTemplates();
        setTemplates(templateRes.data?.templates || []);
      } catch {
        setTemplates([]);
      }

      setHostedExams(hostedRes.data.hostedExams || []);

      const assignments = assignedRes.data?.assignments || [];
      const baseScope = buildAssignmentScope(assignments);
      const hydratedScope = await Promise.all(baseScope.map(async (scope) => {
        if (!scope.hasAllSectionsAccess) {
          return scope;
        }

        try {
          const sectionsResponse = await classAPI.getSections(scope.classId);
          const sectionsMap = new Map((scope.sections || []).map((section) => [section.id, section]));

          (sectionsResponse.data || []).forEach((section) => {
            if (!section?.id) {
              return;
            }

            sectionsMap.set(section.id, {
              id: section.id,
              name: section.name || 'Section'
            });
          });

          return {
            ...scope,
            sections: Array.from(sectionsMap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)))
          };
        } catch {
          return scope;
        }
      }));

      setAssignmentScope(hydratedScope);
      setStudentScope(buildStudentScope(assignments));

      try {
        const challengeRes = await compilerAPI.listChallenges({ limit: 150 });
        setChallengeCatalog(challengeRes.data?.challenges || []);
      } catch {
        setChallengeCatalog([]);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load hosted exams');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHostedExams();
  }, []);

  useEffect(() => {
    const challengeIds = Array.from(new Set(
      (hostedExams || []).flatMap((exam) => (
        Array.isArray(exam?.coding_section?.challenge_ids)
          ? exam.coding_section.challenge_ids
          : []
      ))
    )).filter(Boolean);

    const pendingIds = challengeIds.filter((challengeId) => (
      !Object.prototype.hasOwnProperty.call(codingQuestionCountByChallenge, challengeId)
      && !codingQuestionCountLoadingByChallenge[challengeId]
    ));

    if (pendingIds.length === 0) {
      return;
    }

    const loadQuestionCounts = async () => {
      setCodingQuestionCountLoadingByChallenge((prev) => {
        const next = { ...prev };
        pendingIds.forEach((challengeId) => {
          next[challengeId] = true;
        });
        return next;
      });

      const results = await Promise.allSettled(
        pendingIds.map(async (challengeId) => {
          const response = await compilerAPI.getChallenge(challengeId);
          return {
            challengeId,
            questionCount: extractChallengeQuestionCount(response.data)
          };
        })
      );

      const countUpdates = {};
      const loadingUpdates = {};

      results.forEach((result, index) => {
        const challengeId = pendingIds[index];
        loadingUpdates[challengeId] = false;

        if (result.status === 'fulfilled') {
          countUpdates[challengeId] = result.value.questionCount;
        } else {
          countUpdates[challengeId] = 0;
        }
      });

      setCodingQuestionCountByChallenge((prev) => ({
        ...prev,
        ...countUpdates
      }));
      setCodingQuestionCountLoadingByChallenge((prev) => ({
        ...prev,
        ...loadingUpdates
      }));
    };

    loadQuestionCounts();
  }, [hostedExams, codingQuestionCountByChallenge, codingQuestionCountLoadingByChallenge]);

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

  const filteredChallengeCatalog = useMemo(() => {
    const keyword = String(challengeSearch || '').trim().toLowerCase();

    if (!keyword) {
      return challengeCatalog;
    }

    return challengeCatalog.filter((challenge) => {
      const title = String(challenge.title || '').toLowerCase();
      const id = String(challenge.id || '').toLowerCase();
      return title.includes(keyword) || id.includes(keyword);
    });
  }, [challengeCatalog, challengeSearch]);

  const isCodingSectionLocked = Boolean(selectedExam?.is_locked_for_coding_section_edit);
  const isTemplateLocked = Number(selectedExam?.attempts_started_count || 0) > 0;

  useEffect(() => {
    if (!editFormData.specific_student_id) return;

    const stillValid = filteredStudentOptions.some((student) => student.id === editFormData.specific_student_id);
    if (!stillValid) {
      setEditFormData((prev) => ({ ...prev, specific_student_id: '' }));
    }
  }, [editFormData.specific_student_id, filteredStudentOptions]);

  const openEditModal = (exam) => {
    const codingSection = exam.coding_section && exam.coding_section.enabled
      ? exam.coding_section
      : null;

    setSelectedExam(exam);
    setChallengeSearch('');
    setEditFormData({
      exam_title: exam.exam_title || '',
      template_id: exam.template_id || '',
      class_id: exam.class_id || '',
      section_id: exam.section_id || '',
      zone: exam.zone || '',
      specific_student_id: exam.specific_students?.[0]?.id || '',
      allow_resume: exam.allow_resume !== false,
      result_mode: exam.result_mode || 'after_end',
      publish_status: exam.publish_status || 'draft',
      start_time: toDateTimeLocal(exam.start_time),
      end_time: toDateTimeLocal(exam.end_time),
      instructions: exam.instructions || '',
      max_attempts: Number(exam.max_attempts || 1),
      duration_minutes: Number(exam.duration_minutes || 60),
      enable_coding_section: Boolean(codingSection?.enabled),
      coding_challenge_ids: Array.isArray(codingSection?.challenge_ids) ? codingSection.challenge_ids : []
    });
  };

  const closeEditModal = () => {
    setSelectedExam(null);
    setChallengeSearch('');
    setSaving(false);
  };

  const handleSaveEdits = async () => {
    if (!selectedExam) return;

    const codingSectionLocked = Boolean(selectedExam.is_locked_for_coding_section_edit);

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

    if (editFormData.enable_coding_section && editFormData.coding_challenge_ids.length === 0) {
      toast.error('Select at least one coding challenge when coding section is enabled');
      return;
    }

    if (!editFormData.template_id) {
      toast.error('Assessment template is required');
      return;
    }

    try {
      setSaving(true);

      const updatePayload = {
        exam_title: String(editFormData.exam_title || '').trim() || null,
        template_id: editFormData.template_id,
        class_id: editFormData.class_id || null,
        section_id: editFormData.section_id || null,
        zone: editFormData.zone || null,
        allow_resume: editFormData.allow_resume,
        result_mode: editFormData.result_mode,
        publish_status: editFormData.publish_status,
        start_time: editFormData.start_time || null,
        end_time: editFormData.end_time || null,
        instructions: editFormData.instructions || null,
        max_attempts: attempts,
        duration_minutes: duration,
        assigned_student_ids: []
      };

      if (!codingSectionLocked) {
        updatePayload.coding_section = editFormData.enable_coding_section
          ? {
            enabled: true,
            challenge_ids: editFormData.coding_challenge_ids
          }
          : null;
      }

      const response = await assessmentAPI.updateHostedExam(selectedExam.id, updatePayload);

      toast.success(response.data?.message || 'Hosted exam updated successfully');
      closeEditModal();
      fetchHostedExams();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to update hosted exam');
    } finally {
      setSaving(false);
    }
  };

  const toggleCodingChallenge = (challengeId) => {
    setEditFormData((prev) => {
      const exists = prev.coding_challenge_ids.includes(challengeId);

      return {
        ...prev,
        coding_challenge_ids: exists
          ? prev.coding_challenge_ids.filter((id) => id !== challengeId)
          : [...prev.coding_challenge_ids, challengeId]
      };
    });
  };

  const handleQuickStatusChange = async (exam, nextStatus) => {
    if (!exam?.id || !nextStatus || nextStatus === exam.publish_status) return;

    const previousStatus = exam.publish_status;

    setHostedExams((prev) => prev.map((item) => (
      item.id === exam.id
        ? { ...item, publish_status: nextStatus }
        : item
    )));

    try {
      setStatusUpdatingExamId(exam.id);
      const response = await assessmentAPI.updateHostedExam(exam.id, { publish_status: nextStatus });
      toast.success(response.data?.message || `Status updated to ${nextStatus}`);
      fetchHostedExams();
    } catch (error) {
      setHostedExams((prev) => prev.map((item) => (
        item.id === exam.id
          ? { ...item, publish_status: previousStatus }
          : item
      )));
      toast.error(error.response?.data?.error || 'Failed to update status');
    } finally {
      setStatusUpdatingExamId(null);
    }
  };

  const handleOpenStudentPreview = (exam) => {
    if (!exam?.id) {
      return;
    }

    const parsedQuestionCount = Number.parseInt(String(exam.template?.question_count ?? ''), 10);
    const parsedDuration = Number.parseInt(String(exam.duration_minutes ?? ''), 10);
    const safeMcqCount = Number.isFinite(parsedQuestionCount) && parsedQuestionCount > 0 ? parsedQuestionCount : 20;
    const safeDuration = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 60;
    const challengeIds = Array.isArray(exam.coding_section?.challenge_ids)
      ? exam.coding_section.challenge_ids.filter(Boolean)
      : [];
    const includeCoding = Boolean(exam.coding_section?.enabled && challengeIds.length > 0);
    const templateId = String(exam.template_id || exam.template?.id || '').trim();

    const params = new URLSearchParams();
    params.set('preview', '1');
    if (templateId) {
      params.set('templateId', templateId);
    }
    params.set('mcq', String(safeMcqCount));
    params.set('timer', String(safeDuration));
    params.set('coding', includeCoding ? '1' : '0');
    params.set('start', 'mcq');
    params.set('title', String(exam.exam_title || exam.template?.title || 'Assessment'));
    params.set('subject', String(exam.template?.subject || 'General Subject'));

    if (includeCoding) {
      params.set('challenges', challengeIds.join(','));
    }

    navigate(`/teacher/assessments/preview-lab/run/${encodeURIComponent(exam.id)}?${params.toString()}`);
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

  const handleReleaseResults = async (exam) => {
    if (!exam?.id || exam.result_mode !== 'manual') return;

    const confirmed = window.confirm(
      'Release results now? Already submitted attempts will become visible immediately, and future submissions will also show results immediately.'
    );
    if (!confirmed) return;

    try {
      setReleasingResultsExamId(exam.id);
      const response = await assessmentAPI.releaseHostedExamResults(exam.id);
      toast.success(response.data?.message || 'Results released successfully');
      fetchHostedExams();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to release results');
    } finally {
      setReleasingResultsExamId(null);
    }
  };

  const handleDeleteExam = async (exam) => {
    if (!exam?.id) return;

    const confirmed = window.confirm(
      'Delete this scheduled exam? Assigned students will be unassigned and all student submissions/marks for this exam will be deleted.'
    );
    if (!confirmed) return;

    try {
      setDeletingExamId(exam.id);
      const response = await assessmentAPI.deleteHostedExam(exam.id);
      toast.success(response.data?.message || 'Scheduled exam deleted successfully');
      fetchHostedExams();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to delete scheduled exam');
    } finally {
      setDeletingExamId(null);
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
                      <th>Exam Name</th>
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
                          {(() => {
                            const mcqQuestionCount = Number.parseInt(String(exam.template?.question_count ?? ''), 10);
                            const safeMcqQuestionCount = Number.isFinite(mcqQuestionCount) && mcqQuestionCount > 0
                              ? mcqQuestionCount
                              : 0;
                            const codingChallengeIds = Array.isArray(exam.coding_section?.challenge_ids)
                              ? exam.coding_section.challenge_ids
                              : [];
                            const codingQuestionCount = codingChallengeIds.reduce(
                              (total, challengeId) => total + Number(codingQuestionCountByChallenge[challengeId] || 0),
                              0
                            );
                            const isCodingCountLoading = codingChallengeIds.some(
                              (challengeId) => Boolean(codingQuestionCountLoadingByChallenge[challengeId])
                            );

                            return (
                              <>
                          <p className="font-medium text-slate-800">{exam.exam_title || exam.template?.title || 'Untitled Exam'}</p>
                          <p className="text-xs text-slate-500">
                            MCQ: {safeMcqQuestionCount} • Coding: {isCodingCountLoading ? '...' : codingQuestionCount}
                          </p>
                              </>
                            );
                          })()}
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
                        <td>
                          <p>{exam.max_attempts}</p>
                          <p className="text-xs text-slate-500">
                            Started: {exam.attempts_started_count || 0}
                          </p>
                        </td>
                        <td>
                          <span className={`status-badge ${exam.allow_resume === false ? 'warning' : 'success'}`}>
                            {exam.allow_resume === false ? 'No' : 'Yes'}
                          </span>
                        </td>
                        <td>
                          <div className="inline-flex flex-col gap-1">
                            <select
                              className="form-select min-w-[124px] py-1.5 text-sm capitalize"
                              value={exam.publish_status}
                              onChange={(event) => handleQuickStatusChange(exam, event.target.value)}
                              disabled={statusUpdatingExamId === exam.id}
                            >
                              {publishStatusOptions.map((status) => (
                                <option key={`${exam.id}-${status}`} value={status}>
                                  {status.charAt(0).toUpperCase() + status.slice(1)}
                                </option>
                              ))}
                            </select>
                            {statusUpdatingExamId === exam.id && (
                              <p className="text-[11px] text-slate-500">Updating...</p>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="secondary"
                              className="py-1.5! px-3! inline-flex items-center gap-1.5"
                              onClick={() => handleOpenStudentPreview(exam)}
                              disabled={
                                statusUpdatingExamId === exam.id
                                || revokingExamId === exam.id
                                || releasingResultsExamId === exam.id
                                || deletingExamId === exam.id
                              }
                            >
                              <FiEye className="h-4 w-4" />
                              Preview
                            </Button>
                            {exam.result_mode === 'manual' && ['published', 'closed'].includes(exam.publish_status) && (
                              <Button
                                variant="secondary"
                                className="py-1.5! px-3! border-emerald-200! bg-emerald-50! text-emerald-700! hover:bg-emerald-100! inline-flex items-center gap-1.5"
                                onClick={() => handleReleaseResults(exam)}
                                disabled={
                                  releasingResultsExamId === exam.id
                                  || revokingExamId === exam.id
                                  || statusUpdatingExamId === exam.id
                                  || deletingExamId === exam.id
                                }
                              >
                                <FiUnlock className="h-4 w-4" />
                                {releasingResultsExamId === exam.id ? 'Releasing...' : 'Release Results'}
                              </Button>
                            )}
                            {exam.publish_status === 'published' && (
                              <Button
                                variant="secondary"
                                className="py-1.5! px-3! border-red-200! bg-red-50! text-red-700! hover:bg-red-100! inline-flex items-center gap-1.5"
                                onClick={() => handleRevokeExam(exam)}
                                disabled={
                                  revokingExamId === exam.id
                                  || releasingResultsExamId === exam.id
                                  || statusUpdatingExamId === exam.id
                                  || deletingExamId === exam.id
                                }
                              >
                                <FiRotateCcw className="h-4 w-4" />
                                {revokingExamId === exam.id ? 'Revoking...' : 'Revoke'}
                              </Button>
                            )}
                            <Button
                              variant="secondary"
                              className="py-1.5! px-3! border-red-200! bg-red-50! text-red-700! hover:bg-red-100! inline-flex items-center gap-1.5"
                              onClick={() => handleDeleteExam(exam)}
                              disabled={
                                deletingExamId === exam.id
                                || statusUpdatingExamId === exam.id
                                || revokingExamId === exam.id
                                || releasingResultsExamId === exam.id
                              }
                              title="Delete scheduled exam"
                            >
                              <FiTrash2 className="h-4 w-4" />
                              {deletingExamId === exam.id ? 'Deleting...' : 'Delete'}
                            </Button>
                            <Button
                              variant="secondary"
                              className="py-1.5! px-3! inline-flex items-center gap-1.5"
                              onClick={() => openEditModal(exam)}
                              disabled={
                                statusUpdatingExamId === exam.id
                                || deletingExamId === exam.id
                                || releasingResultsExamId === exam.id
                              }
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
          subtitle={selectedExam ? selectedExam.exam_title || selectedExam.template?.title || 'Hosted assessment' : ''}
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
            <InputField
              className="md:col-span-2"
              label="Exam Title (optional)"
              value={editFormData.exam_title}
              maxLength={120}
              onChange={(event) => setEditFormData((prev) => ({ ...prev, exam_title: event.target.value }))}
              placeholder="Leave blank to use template title"
            />

            <SelectField
              className="md:col-span-2"
              label="Assessment Template"
              value={editFormData.template_id}
              disabled={isTemplateLocked}
              onChange={(event) => setEditFormData((prev) => ({ ...prev, template_id: event.target.value }))}
            >
              <option value="">Select template</option>
              {editFormData.template_id && !templates.some((item) => item.id === editFormData.template_id) && (
                <option value={editFormData.template_id}>Current Template ({editFormData.template_id.slice(0, 8)})</option>
              )}
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {`${template.title || 'Untitled'} (${template.subject || 'N/A'})`}
                </option>
              ))}
            </SelectField>

            {(isTemplateLocked || Boolean(selectedExam?.is_locked_for_coding_section_edit)) && (
              <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Template and coding section are locked for this exam because student attempts have already started.
                You can still update non-template, non-coding settings.
              </div>
            )}

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

            <SelectField
              label="Result Visibility"
              value={editFormData.result_mode}
              onChange={(event) => setEditFormData((prev) => ({ ...prev, result_mode: event.target.value }))}
            >
              <option value="after_end">After End Time</option>
              <option value="immediate">Immediate</option>
              <option value="manual">Manual Release</option>
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
                zone: ''
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
                section_id: event.target.value
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
                zone: event.target.value
              }))}
            >
              <option value="">All Zones</option>
              {zoneOptions.map((zone) => (
                <option key={zone} value={zone}>{zone.charAt(0).toUpperCase() + zone.slice(1)}</option>
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

            <div className="md:col-span-2">
              <label className="form-label">Instructions</label>
              <textarea
                className="form-input min-h-24"
                value={editFormData.instructions}
                onChange={(event) => setEditFormData((prev) => ({ ...prev, instructions: event.target.value }))}
                placeholder="Exam instructions visible to students"
              />
            </div>

            <div className="md:col-span-2 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-slate-50 p-4 lg:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className={`inline-flex items-center gap-2 text-sm font-semibold text-slate-800 ${isCodingSectionLocked ? 'cursor-not-allowed opacity-75' : ''}`}>
                  <input
                    type="checkbox"
                    checked={editFormData.enable_coding_section}
                    disabled={isCodingSectionLocked}
                    onChange={(event) => setEditFormData((prev) => ({
                      ...prev,
                      enable_coding_section: event.target.checked,
                      coding_challenge_ids: event.target.checked ? prev.coding_challenge_ids : []
                    }))}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200"
                  />
                  <FiCode className="h-4 w-4 text-indigo-600" />
                  Include Coding Section after MCQ
                </label>

                <span className={`status-badge ${isCodingSectionLocked ? 'warning' : (editFormData.enable_coding_section ? 'success' : 'info')}`}>
                  {isCodingSectionLocked
                    ? 'Locked after attempts started'
                    : editFormData.enable_coding_section
                      ? `${editFormData.coding_challenge_ids.length} selected`
                      : 'Disabled'}
                </span>
              </div>

              <p className="mt-1 text-xs text-slate-600">
                Students will complete MCQ first, then continue with coding challenges in the same attempt.
              </p>

              {editFormData.enable_coding_section && (
                <div className="mt-4 space-y-4">
                  <InputField
                    label="Search Coding Challenges"
                    value={challengeSearch}
                    disabled={isCodingSectionLocked}
                    onChange={(event) => setChallengeSearch(event.target.value)}
                    placeholder="Search by challenge title or ID"
                  />

                  <div className="max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2">
                    {filteredChallengeCatalog.length > 0 ? (
                      <div className="space-y-2">
                        {filteredChallengeCatalog.map((challenge) => {
                          const checked = editFormData.coding_challenge_ids.includes(challenge.id);

                          return (
                            <label
                              key={challenge.id}
                              className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition ${
                                checked
                                  ? 'border-indigo-200 bg-indigo-50/60 shadow-[0_1px_2px_rgba(79,70,229,0.12)]'
                                  : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                              } ${isCodingSectionLocked ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={isCodingSectionLocked}
                                onChange={() => toggleCodingChallenge(challenge.id)}
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200"
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-slate-800">
                                  {challenge.title || 'Untitled Challenge'}
                                </span>
                                <span
                                  className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                    checked
                                      ? 'border-indigo-200 bg-indigo-100 text-indigo-700'
                                      : 'border-slate-200 bg-slate-50 text-slate-500'
                                  }`}
                                >
                                  ID: {challenge.id}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="px-2 py-4 text-sm text-slate-500">No coding challenges found.</p>
                    )}
                  </div>

                  <p className="text-xs text-slate-600">
                    Selected coding challenges: <span className="font-semibold text-slate-800">{editFormData.coding_challenge_ids.length}</span>
                  </p>
                </div>
              )}
            </div>
          </div>
        </Modal>
      </div>
    </Layout>
  );
};

export default HostExams;
