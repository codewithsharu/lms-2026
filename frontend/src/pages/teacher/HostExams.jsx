import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FiChevronDown, FiClock, FiPlayCircle, FiSend } from 'react-icons/fi';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import InputField from '../../components/ui/InputField';
import { assessmentAPI, teacherAPI } from '../../services/api';

const SelectMenu = ({ label, value, onChange, options, disabled = false }) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const handleOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const selectedOption = options.find((option) => option.value === value) || options[0];

  return (
    <div className="relative" ref={wrapperRef}>
      {label && <label className="form-label">{label}</label>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={`form-select flex w-full items-center justify-between gap-2 text-left ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <span className="truncate">{selectedOption?.label || 'Select'}</span>
        <FiChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          {options.map((option) => (
            <button
              key={`${label}-${option.value || 'empty'}`}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                option.value === value
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const HostExams = () => {
  const [templates, setTemplates] = useState([]);
  const [hostedExams, setHostedExams] = useState([]);
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [assignmentScope, setAssignmentScope] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hosting, setHosting] = useState(false);

  const [formData, setFormData] = useState({
    template_id: '',
    class_id: '',
    section_id: '',
    zone: '',
    duration_minutes: 60,
    max_attempts: 1,
    result_mode: 'after_end',
    publish_status: 'draft',
    start_time: '',
    end_time: '',
    instructions: ''
  });

  const selectedTemplate = templates.find((item) => item.id === formData.template_id) || null;
  const selectedClassScope = assignmentScope.find((item) => item.classId === formData.class_id) || null;

  const planSuggestion = (() => {
    if (!selectedTemplate) {
      return {
        title: 'Select a template to get recommendations',
        details: 'Best-plan suggestions will appear after selecting a template.'
      };
    }

    const questions = Number(selectedTemplate.question_count || 0);
    if (questions >= 60) {
      return {
        title: 'Best Plan: Long Assessment',
        details: 'Use 90 minutes, 1 attempt, and publish results after end time for better control.'
      };
    }

    if (questions >= 30) {
      return {
        title: 'Best Plan: Standard Assessment',
        details: 'Use 60 minutes, 1-2 attempts, and publish results after end time.'
      };
    }

    return {
      title: 'Best Plan: Quick Assessment',
      details: 'Use 30 minutes, up to 2 attempts, and immediate results for fast feedback.'
    };
  })();

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      const [templateRes, hostedRes, assignedRes] = await Promise.all([
        assessmentAPI.getTemplates(),
        assessmentAPI.getHostedExams(),
        teacherAPI.getAssignedStudents()
      ]);

      setTemplates(templateRes.data.templates || []);
      setHostedExams(hostedRes.data.hostedExams || []);

      const assignments = assignedRes.data?.assignments || [];
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

        const entry = classMap.get(classId);

        if (assignment.section?.id) {
          entry.sectionsMap.set(assignment.section.id, {
            id: assignment.section.id,
            name: assignment.section.name || 'Section'
          });
        }

        if (assignment.zone) {
          entry.zonesSet.add(assignment.zone);
        }
      });

      const scopeList = Array.from(classMap.values()).map((item) => ({
        classId: item.classId,
        className: item.className,
        sections: Array.from(item.sectionsMap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))),
        zones: Array.from(item.zonesSet.values()).sort()
      }));

      setAssignmentScope(scopeList);
      setClasses(scopeList.map((item) => ({ id: item.classId, name: item.className })));
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load hosting data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (!formData.class_id) {
      setSections([]);
      return;
    }

    const classScope = assignmentScope.find((item) => item.classId === formData.class_id);
    setSections(classScope?.sections || []);

    if (formData.section_id && !classScope?.sections?.some((section) => section.id === formData.section_id)) {
      setFormData((prev) => ({ ...prev, section_id: '' }));
    }

    if (formData.zone && classScope?.zones?.length > 0 && !classScope.zones.includes(formData.zone)) {
      setFormData((prev) => ({ ...prev, zone: '' }));
    }
  }, [formData.class_id, assignmentScope, formData.section_id, formData.zone]);

  const handleHostExam = async (event) => {
    event.preventDefault();

    if (!formData.template_id) {
      toast.error('Please select a template first');
      return;
    }

    if (!formData.duration_minutes || !formData.max_attempts) {
      toast.error('Duration and attempts are required');
      return;
    }

    const duration = Number(formData.duration_minutes);
    const attempts = Number(formData.max_attempts);

    if (!Number.isFinite(duration) || duration <= 0) {
      toast.error('Duration must be greater than 0 minutes');
      return;
    }

    if (!Number.isFinite(attempts) || attempts <= 0) {
      toast.error('Max attempts must be at least 1');
      return;
    }

    if (formData.start_time && formData.end_time && new Date(formData.end_time) <= new Date(formData.start_time)) {
      toast.error('End time must be after start time');
      return;
    }

    if (formData.publish_status === 'published' && (!formData.start_time || !formData.end_time)) {
      toast.error('Start and end time are required to publish an exam');
      return;
    }

    try {
      setHosting(true);
      await assessmentAPI.hostExam(formData);
      toast.success('Exam hosted successfully');
      setFormData((prev) => ({ ...prev, template_id: '', instructions: '' }));
      fetchInitialData();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to host exam');
    } finally {
      setHosting(false);
    }
  };

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header">
          <h1>Host Exams</h1>
          <p>Select a previously created template and configure duration, attempts, results, and publish settings.</p>
        </div>

        <Card>
          <Card.Body>
            <p className="text-sm font-semibold text-slate-800">{planSuggestion.title}</p>
            <p className="mt-1 text-sm text-slate-600">{planSuggestion.details}</p>
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <h2 className="section-title">Host New Exam</h2>
          </Card.Header>
          <Card.Body>
            <form onSubmit={handleHostExam} className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <SelectMenu
                  label="Assessment Template *"
                  value={formData.template_id}
                  onChange={(nextValue) => setFormData({ ...formData, template_id: nextValue })}
                  options={[
                    { value: '', label: 'Select template' },
                    ...templates.map((template) => ({
                      value: template.id,
                      label: `${template.title} (${template.subject}) — ID: ${template.id.slice(0, 8)}`
                    }))
                  ]}
                />
              </div>

              <SelectMenu
                label="Class"
                value={formData.class_id}
                onChange={(nextValue) => setFormData({ ...formData, class_id: nextValue, section_id: '' })}
                options={[
                  { value: '', label: 'Select Assigned Class' },
                  ...classes.map((cls) => ({ value: cls.id, label: cls.name }))
                ]}
              />

              <SelectMenu
                label="Section"
                value={formData.section_id}
                onChange={(nextValue) => setFormData({ ...formData, section_id: nextValue })}
                disabled={!formData.class_id}
                options={[
                  { value: '', label: 'All Sections' },
                  ...sections.map((section) => ({ value: section.id, label: section.name }))
                ]}
              />

              <SelectMenu
                label="Zone"
                value={formData.zone}
                onChange={(nextValue) => setFormData({ ...formData, zone: nextValue })}
                options={[
                  { value: '', label: 'All Zones' },
                  ...((selectedClassScope?.zones?.length > 0
                    ? selectedClassScope.zones
                    : ['blue', 'red', 'green']).map((zone) => ({
                    value: zone,
                    label: `${zone.charAt(0).toUpperCase() + zone.slice(1)}`
                  })))
                ]}
              />

              <InputField
                label="Duration (minutes) *"
                type="number"
                min="1"
                value={formData.duration_minutes}
                onChange={(e) => setFormData({ ...formData, duration_minutes: e.target.value })}
                required
              />

              <InputField
                label="Max Attempts *"
                type="number"
                min="1"
                value={formData.max_attempts}
                onChange={(e) => setFormData({ ...formData, max_attempts: e.target.value })}
                required
              />

              <SelectMenu
                label="Result Visibility"
                value={formData.result_mode}
                onChange={(nextValue) => setFormData({ ...formData, result_mode: nextValue })}
                options={[
                  { value: 'after_end', label: 'After End Time' },
                  { value: 'immediate', label: 'Immediate' },
                  { value: 'manual', label: 'Manual Release' }
                ]}
              />

              <SelectMenu
                label="Publish Status"
                value={formData.publish_status}
                onChange={(nextValue) => setFormData({ ...formData, publish_status: nextValue })}
                options={[
                  { value: 'draft', label: 'Draft' },
                  { value: 'published', label: 'Published' },
                  { value: 'closed', label: 'Closed' }
                ]}
              />

              <InputField
                label="Start Date/Time"
                type="datetime-local"
                value={formData.start_time}
                onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
              />

              <InputField
                label="End Date/Time"
                type="datetime-local"
                value={formData.end_time}
                onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
              />

              <div className="md:col-span-2">
                <label className="form-label">Instructions</label>
                <textarea
                  className="form-input min-h-24"
                  value={formData.instructions}
                  onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                  placeholder="Exam instructions visible to students"
                />
              </div>

              <div className="md:col-span-2 flex justify-end">
                <Button type="submit" disabled={hosting || loading}>
                  <FiSend className="h-4 w-4" />
                  {hosting ? 'Hosting...' : 'Host Exam'}
                </Button>
              </div>
            </form>
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <h2 className="section-title">Hosted Exam List</h2>
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
                      <th>Duration</th>
                      <th>Attempts</th>
                      <th>Status</th>
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
                            {exam.section?.name || 'All Sections'} • {exam.zone || 'All Zones'}
                          </p>
                        </td>
                        <td>
                          <span className="inline-flex items-center gap-1 text-sm">
                            <FiClock className="h-4 w-4 text-slate-400" />
                            {exam.duration_minutes} min
                          </span>
                        </td>
                        <td>{exam.max_attempts}</td>
                        <td>
                          <span className={`status-badge ${exam.publish_status === 'published' ? 'success' : exam.publish_status === 'closed' ? 'warning' : 'info'}`}>
                            {exam.publish_status}
                          </span>
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
                <p className="text-base font-medium text-slate-800">No hosted exams yet</p>
                <p className="mt-1 text-sm text-slate-500">Host exams from your templates to make them available to students.</p>
              </div>
            )}
          </Card.Body>
        </Card>
      </div>
    </Layout>
  );
};

export default HostExams;
