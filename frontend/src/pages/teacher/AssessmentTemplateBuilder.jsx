import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiCheckCircle, FiClock, FiDownload, FiLoader, FiPlus, FiSave, FiTrash2, FiUpload, FiX } from 'react-icons/fi';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import InputField from '../../components/ui/InputField';
import { assessmentAPI } from '../../services/api';

const normalizeMarksValue = (rawValue, fallback = 1) => {
  const parsed = Number(rawValue);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Number(parsed.toFixed(2));
};

const calculateQuestionSetMarks = (questions = []) => Number(
  (questions || []).reduce((sum, question) => sum + normalizeMarksValue(question?.marks, 1), 0).toFixed(2)
);

const getEmptyQuestion = () => ({
  type: 'mcq',
  question: '',
  options: ['', '', '', ''],
  answerMode: 'single',
  correctOptions: [0],
  correctOption: 0,
  blankAnswer: '',
  marks: 1
});

const getQuestionTypeLabel = (type) => (type === 'blank' ? 'Fill in the Blank' : 'MCQ');

const normalizeQuestionFromJson = (item) => {
  const type = item?.type === 'blank' ? 'blank' : 'mcq';
  const question = String(item?.question || '').trim();

  if (!question) return null;

  if (type === 'blank') {
    const rawBlankAnswer = item?.blankAnswer ?? item?.blank_answer ?? item?.answer ?? '';
    const blankAnswer = String(rawBlankAnswer).trim();
    if (!blankAnswer) return null;

    return {
      type: 'blank',
      question,
      options: ['', '', '', ''],
      answerMode: 'single',
      correctOptions: [0],
      correctOption: 0,
      blankAnswer,
      marks: normalizeMarksValue(item?.marks ?? item?.score ?? item?.points, 1)
    };
  }

  const options = Array.isArray(item?.options) ? item.options.map((option) => String(option || '').trim()) : [];
  if (options.length !== 4 || options.some((option) => !option)) return null;

  const rawCorrectOptions = Array.isArray(item?.correctOptions)
    ? item.correctOptions
    : (Number.isInteger(item?.correctOption) ? [item.correctOption] : []);

  const correctOptions = [...new Set(rawCorrectOptions.filter((value) => Number.isInteger(value) && value >= 0 && value <= 3))];
  if (correctOptions.length === 0) return null;

  const answerMode = item?.answerMode === 'multiple' || correctOptions.length > 1 ? 'multiple' : 'single';

  return {
    type: 'mcq',
    question,
    options,
    answerMode,
    correctOptions,
    correctOption: correctOptions[0],
    blankAnswer: '',
    marks: normalizeMarksValue(item?.marks ?? item?.score ?? item?.points, 1)
  };
};

const getQuestionSetFromTemplate = (template) => {
  const maybeQuestions = template?.template_data?.questions;
  if (!Array.isArray(maybeQuestions)) return [];

  return maybeQuestions
    .map((item) => ({
      type: item?.type === 'blank' ? 'blank' : 'mcq',
      question: item?.question || '',
      options: Array.isArray(item?.options) && item.options.length === 4 ? item.options : ['', '', '', ''],
      answerMode: item?.answerMode === 'multiple' || (Array.isArray(item?.correctOptions) && item.correctOptions.length > 1)
        ? 'multiple'
        : 'single',
      correctOptions: Array.isArray(item?.correctOptions)
        ? item.correctOptions.filter((value) => Number.isInteger(value) && value >= 0 && value <= 3)
        : (Number.isInteger(item?.correctOption) ? [item.correctOption] : [0]),
      correctOption: Number.isInteger(item?.correctOption) ? item.correctOption : 0,
      blankAnswer: item?.blankAnswer ? String(item.blankAnswer) : '',
      marks: normalizeMarksValue(item?.marks ?? item?.score ?? item?.points, 1)
    }))
    .map((item) => ({
      ...item,
      correctOptions: item.correctOptions.length > 0 ? [...new Set(item.correctOptions)] : [0],
      correctOption: item.correctOptions.length > 0 ? item.correctOptions[0] : item.correctOption
    }))
    .filter((item) => item.question.trim().length > 0);
};

const AssessmentTemplateBuilder = () => {
  const navigate = useNavigate();
  const { templateId } = useParams();

  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [builderSaving, setBuilderSaving] = useState(false);

  const [activeTemplate, setActiveTemplate] = useState(null);
  const [templateName, setTemplateName] = useState('');
  const [mcqList, setMcqList] = useState([]);
  const [newMcq, setNewMcq] = useState(getEmptyQuestion());
  const [editingIndex, setEditingIndex] = useState(null);
  const [insertAtIndex, setInsertAtIndex] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [importingJson, setImportingJson] = useState(false);
  const draftCreationRef = useRef(false);
  const initializeBuilderRef = useRef(null);
  const persistTemplateRef = useRef(null);

  const isLocalDraft = Boolean(activeTemplate?.isLocalDraft);
  const isPlaceholderDraft = Boolean(activeTemplate?.isPlaceholder);

  const initializeBuilder = async () => {
    try {
      setLoading(true);

      if (String(templateId).toLowerCase() === 'new') {
        const draftName = `MCQ-${Date.now()}`;
        draftCreationRef.current = false;
        setSetupRequired(false);
        setActiveTemplate({ id: 'draft', title: draftName, isLocalDraft: true, isPlaceholder: true });
        setTemplateName(draftName);
        setMcqList([]);
        setNewMcq(getEmptyQuestion());
        setLastSavedAt(null);
        return;
      }

      if (String(templateId).toLowerCase().startsWith('local-')) {
        setSetupRequired(true);
        setActiveTemplate({ id: templateId, title: templateId, isLocalDraft: true, isPlaceholder: false });
        setTemplateName(templateId);
        setMcqList([]);
        setNewMcq(getEmptyQuestion());
        setLastSavedAt(null);
        return;
      }

      const response = await assessmentAPI.getTemplates();
      setSetupRequired(Boolean(response.data.setupRequired));
      const templates = response.data.templates || [];
      const selected = templates.find((item) => item.id === templateId);

      if (!selected) {
        toast.error('Template not found');
        navigate('/teacher/assessments/templates');
        return;
      }

      setActiveTemplate({ ...selected, isLocalDraft: false });
      setTemplateName(selected.title || '');
      setMcqList(getQuestionSetFromTemplate(selected));
      setNewMcq(getEmptyQuestion());
      setLastSavedAt(null);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to open template builder');
      navigate('/teacher/assessments/templates');
    } finally {
      setLoading(false);
    }
  };

  initializeBuilderRef.current = initializeBuilder;

  useEffect(() => {
    initializeBuilderRef.current?.();
  }, [templateId]);

  useEffect(() => {
    if (!isPlaceholderDraft || mcqList.length === 0) {
      return;
    }

    if (draftCreationRef.current) {
      return;
    }

    const createDraft = async () => {
      try {
        draftCreationRef.current = true;
        setBuilderSaving(true);

        const response = await assessmentAPI.createTemplate({
          title: templateName?.trim() || `MCQ-${Date.now()}`,
          subject: 'MCQ',
          description: 'MCQ question set template',
          question_count: mcqList.length,
          total_marks: calculateQuestionSetMarks(mcqList),
          passing_percentage: 40,
          template_data: { questions: mcqList }
        });

        const createdTemplate = response.data.template;
        setActiveTemplate({ ...createdTemplate, isLocalDraft: false, isPlaceholder: false });
        setSetupRequired(false);
        setLastSavedAt(new Date());
        navigate(`/teacher/assessments/templates/${createdTemplate.id}/builder`, { replace: true });
        toast.success('Template draft created');
      } catch (error) {
        const pending = Boolean(error.response?.data?.setupRequired);

        if (!pending) {
          toast.error(error.response?.data?.error || 'Failed to create template draft');
          return;
        }

        const localId = `local-${Date.now()}`;
        setSetupRequired(true);
        setActiveTemplate({ id: localId, title: templateName || localId, isLocalDraft: true, isPlaceholder: false });
        setLastSavedAt(null);
        navigate(`/teacher/assessments/templates/${localId}/builder`, { replace: true });
      } finally {
        setBuilderSaving(false);
        draftCreationRef.current = false;
      }
    };

    createDraft();
  }, [isPlaceholderDraft, mcqList, templateName, navigate]);

  const isNewQuestionValid = useMemo(() => {
    if (!newMcq.question.trim()) return false;
    if (!Number.isFinite(Number(newMcq.marks)) || Number(newMcq.marks) <= 0) return false;
    if (newMcq.type === 'blank') {
      return newMcq.blankAnswer.trim().length > 0;
    }
    if (!newMcq.options.every((option) => option.trim().length > 0)) return false;
    if (!Array.isArray(newMcq.correctOptions) || newMcq.correctOptions.length === 0) return false;
    if (newMcq.answerMode === 'single' && newMcq.correctOptions.length !== 1) return false;
    return true;
  }, [newMcq]);

  const mcqCount = useMemo(() => mcqList.filter((item) => item.type !== 'blank').length, [mcqList]);
  const blankCount = useMemo(() => mcqList.filter((item) => item.type === 'blank').length, [mcqList]);
  const totalQuestionMarks = useMemo(() => calculateQuestionSetMarks(mcqList), [mcqList]);
  const showsBlankHint = newMcq.type === 'blank' && newMcq.question.trim() && !newMcq.question.includes('____');

  const persistTemplate = async (questions, name, showToast = false) => {
    if (!activeTemplate?.id || isLocalDraft || isPlaceholderDraft) return;

    try {
      setBuilderSaving(true);
      await assessmentAPI.updateTemplate(activeTemplate.id, {
        title: name?.trim() || activeTemplate.title || `MCQ-${activeTemplate.id.slice(0, 8)}`,
        subject: 'MCQ',
        description: 'MCQ question set template',
        question_count: questions.length,
        total_marks: calculateQuestionSetMarks(questions),
        template_data: { questions }
      });

      setLastSavedAt(new Date());
      if (showToast) {
        toast.success('Template saved');
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to save template');
    } finally {
      setBuilderSaving(false);
    }
  };

  persistTemplateRef.current = persistTemplate;

  useEffect(() => {
    if (!activeTemplate?.id || isLocalDraft || isPlaceholderDraft) return;

    const timer = setTimeout(() => {
      persistTemplateRef.current?.(mcqList, templateName, false);
    }, 900);

    return () => clearTimeout(timer);
  }, [mcqList, templateName, activeTemplate?.id, isLocalDraft, isPlaceholderDraft]);

  const resetQuestionForm = () => {
    setNewMcq(getEmptyQuestion());
    setEditingIndex(null);
    setInsertAtIndex(null);
  };

  const beginInsertAt = (index) => {
    setEditingIndex(null);
    setInsertAtIndex(index);
    setNewMcq(getEmptyQuestion());
  };

  const openQuestionForEdit = (index) => {
    const selected = mcqList[index];
    if (!selected) return;

    const fallbackCorrectOptions = Array.isArray(selected.correctOptions)
      ? selected.correctOptions
      : (Number.isInteger(selected.correctOption) ? [selected.correctOption] : [0]);

    setEditingIndex(index);
    setInsertAtIndex(null);
    setNewMcq({
      type: selected.type || 'mcq',
      question: selected.question,
      options: [...selected.options],
      answerMode: selected.answerMode === 'multiple' || fallbackCorrectOptions.length > 1 ? 'multiple' : 'single',
      correctOptions: fallbackCorrectOptions.length > 0 ? fallbackCorrectOptions : [0],
      correctOption: fallbackCorrectOptions.length > 0 ? fallbackCorrectOptions[0] : selected.correctOption,
      blankAnswer: selected.blankAnswer || '',
      marks: normalizeMarksValue(selected.marks, 1)
    });
  };

  const updateAnswerMode = (mode) => {
    setNewMcq((prev) => {
      if (prev.type !== 'mcq') return prev;

      const nextCorrectOptions = mode === 'single'
        ? [prev.correctOptions?.[0] ?? 0]
        : (prev.correctOptions?.length ? [...new Set(prev.correctOptions)] : [0]);

      return {
        ...prev,
        answerMode: mode,
        correctOptions: nextCorrectOptions,
        correctOption: nextCorrectOptions[0] ?? 0
      };
    });
  };

  const toggleCorrectOption = (optionIndex) => {
    setNewMcq((prev) => {
      if (prev.type !== 'mcq') return prev;

      const selected = new Set(prev.correctOptions || []);

      if (prev.answerMode === 'single') {
        return {
          ...prev,
          correctOptions: [optionIndex],
          correctOption: optionIndex
        };
      }

      if (selected.has(optionIndex)) {
        selected.delete(optionIndex);
      } else {
        selected.add(optionIndex);
      }

      const nextCorrectOptions = Array.from(selected).sort((a, b) => a - b);

      return {
        ...prev,
        correctOptions: nextCorrectOptions,
        correctOption: nextCorrectOptions[0] ?? 0
      };
    });
  };

  const upsertQuestion = () => {
    if (!isNewQuestionValid) {
      toast.error('Fill question, marks, all options, and select correct answer(s)');
      return;
    }

    const normalizedCorrectOptions = [...new Set((newMcq.correctOptions || []).filter((value) => Number.isInteger(value) && value >= 0 && value <= 3))];

    const normalizedQuestion = {
      type: newMcq.type,
      question: newMcq.question.trim(),
      options: newMcq.options.map((option) => option.trim()),
      answerMode: newMcq.answerMode,
      correctOptions: normalizedCorrectOptions,
      correctOption: normalizedCorrectOptions[0] ?? 0,
      blankAnswer: newMcq.blankAnswer.trim(),
      marks: normalizeMarksValue(newMcq.marks, 1)
    };

    if (editingIndex === null) {
      if (insertAtIndex === null) {
        setMcqList((prev) => ([...prev, normalizedQuestion]));
        toast.success('Question added');
      } else {
        setMcqList((prev) => {
          const next = [...prev];
          next.splice(insertAtIndex, 0, normalizedQuestion);
          return next;
        });
        toast.success(`Question inserted at position ${insertAtIndex + 1}`);
      }
    } else {
      setMcqList((prev) => prev.map((item, index) => (index === editingIndex ? normalizedQuestion : item)));
      toast.success('Question updated');
    }

    resetQuestionForm();
  };

  const deleteQuestion = (index) => {
    setMcqList((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    if (editingIndex === index) {
      resetQuestionForm();
      return;
    }
    if (editingIndex !== null && index < editingIndex) {
      setEditingIndex((prev) => (prev === null ? null : prev - 1));
    }

    if (insertAtIndex !== null) {
      if (index < insertAtIndex) {
        setInsertAtIndex((prev) => (prev === null ? null : prev - 1));
      } else if (index === insertAtIndex) {
        setInsertAtIndex(index);
      }
    }
  };

  const finalizeTemplate = async () => {
    if (mcqList.length === 0) {
      toast.error('Add at least one question before final save');
      return;
    }

    if (isLocalDraft) {
      try {
        setBuilderSaving(true);
        const response = await assessmentAPI.createTemplate({
          title: templateName?.trim() || `MCQ-${Date.now()}`,
          subject: 'MCQ',
          description: 'MCQ question set template',
          question_count: mcqList.length,
          total_marks: totalQuestionMarks,
          passing_percentage: 40,
          template_data: { questions: mcqList }
        });

        const createdTemplate = response.data.template;
        setActiveTemplate({ ...createdTemplate, isLocalDraft: false });
        setSetupRequired(false);
        setLastSavedAt(new Date());
        toast.success('Template saved');
        navigate(`/teacher/assessments/templates/${createdTemplate.id}/builder`, { replace: true });
      } catch (error) {
        toast.error(error.response?.data?.error || 'Failed to save template');
      } finally {
        setBuilderSaving(false);
      }
      return;
    }

    await persistTemplate(mcqList, templateName, true);
  };

  const importQuestionsFromJson = async (file) => {
    if (!file) return;

    try {
      setImportingJson(true);
      const rawText = await file.text();
      const parsed = JSON.parse(rawText);

      const rawQuestions = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.questions) ? parsed.questions : null);

      if (!rawQuestions) {
        toast.error('Invalid JSON format. Use an array or { questions: [...] }');
        return;
      }

      const normalized = rawQuestions
        .map((item) => normalizeQuestionFromJson(item))
        .filter(Boolean);

      if (normalized.length === 0) {
        toast.error('No valid questions found in JSON file');
        return;
      }

      setMcqList((prev) => [...prev, ...normalized]);
      toast.success(`${normalized.length} question(s) added from JSON`);
    } catch (error) {
      const message = error instanceof SyntaxError
        ? 'Invalid JSON syntax in uploaded file'
        : (error?.response?.data?.error || 'Failed to import JSON file');
      toast.error(message);
    } finally {
      setImportingJson(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="app-page">
          <Card>
            <Card.Body className="py-12 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="mt-4 text-sm text-slate-500">Opening builder...</p>
            </Card.Body>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2">
              <button
                type="button"
                onClick={() => navigate('/teacher/assessments/templates')}
                className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700"
              >
                <FiArrowLeft className="h-4 w-4" />
                Back to Templates
              </button>
            </div>
            <h1>Template Builder</h1>
            <p>Dedicated builder URL for this template with auto save and a cleaner question workflow.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/assessment-questions-template.json"
              download
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <FiDownload className="h-3.5 w-3.5 text-blue-600" />
              JSON Template
            </a>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50">
              <FiUpload className="h-3.5 w-3.5 text-emerald-600" />
              {importingJson ? 'Importing...' : 'Import JSON'}
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                disabled={importingJson}
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  importQuestionsFromJson(file);
                  event.target.value = '';
                }}
              />
            </label>
            <span className="status-badge info">Template ID: {isPlaceholderDraft ? 'Draft (unsaved)' : activeTemplate?.id}</span>
            {setupRequired && <span className="status-badge warning">Local Draft Mode</span>}
          </div>
        </div>

        <Card className="border-slate-200">
          <Card.Body className="space-y-5">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="lg:col-span-9">
                <InputField
                  label="Template Name"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="Aptitude MCQ Set - Week 1"
                />
              </div>
              <div className="lg:col-span-3 lg:flex lg:items-end">
                <div className="inline-flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                  {builderSaving ? (
                    <FiLoader className="h-4 w-4 animate-spin text-blue-600" />
                  ) : isLocalDraft ? (
                    <FiClock className="h-4 w-4 text-amber-600" />
                  ) : (
                    <FiCheckCircle className="h-4 w-4 text-emerald-600" />
                  )}
                  <span className="font-medium text-slate-700">Auto Save:</span>
                  <span className="text-slate-600">
                    {builderSaving
                      ? 'Saving...'
                      : isLocalDraft
                        ? 'Local draft'
                        : (lastSavedAt ? `Saved ${lastSavedAt.toLocaleTimeString()}` : 'Waiting')}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3">
                <p className="text-xs uppercase tracking-wide text-blue-700">Total Questions</p>
                <p className="mt-1 text-2xl font-semibold text-blue-900">{mcqList.length}</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
                <p className="text-xs uppercase tracking-wide text-emerald-700">MCQ Questions</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-900">{mcqCount}</p>
              </div>
              <div className="rounded-xl border border-violet-100 bg-violet-50/70 p-3">
                <p className="text-xs uppercase tracking-wide text-violet-700">Blank Questions</p>
                <p className="mt-1 text-2xl font-semibold text-violet-900">{blankCount}</p>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3">
                <p className="text-xs uppercase tracking-wide text-amber-700">Total Marks</p>
                <p className="mt-1 text-2xl font-semibold text-amber-900">{totalQuestionMarks}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-blue-50/40 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  {editingIndex !== null
                    ? `Edit Question ${editingIndex + 1}`
                    : (insertAtIndex !== null ? `Insert New Question at Position ${insertAtIndex + 1}` : 'Add Question')}
                </p>
                {(editingIndex !== null || insertAtIndex !== null) && (
                  <Button variant="secondary" className="!h-8 !px-3" onClick={resetQuestionForm}>
                    <FiX className="h-4 w-4" />
                    {editingIndex !== null ? 'Cancel Edit' : 'Cancel Insert'}
                  </Button>
                )}
              </div>

              {mcqList.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quick Switch</p>
                  <div className="flex flex-wrap gap-2">
                    {mcqList.map((_, index) => (
                      <button
                        key={`quick-switch-${index}`}
                        type="button"
                        onClick={() => openQuestionForEdit(index)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          editingIndex === index
                            ? 'border-blue-300 bg-blue-50 text-primary'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        Q{index + 1}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <InputField
                label={editingIndex === null ? `Question ${mcqList.length + 1}` : `Question ${editingIndex + 1}`}
                value={newMcq.question}
                onChange={(event) => setNewMcq((prev) => ({ ...prev, question: event.target.value }))}
                placeholder={newMcq.type === 'blank' ? 'Example: The capital of France is ____.' : 'Enter question text'}
              />

              <InputField
                label="Marks"
                type="number"
                min="1"
                step="0.5"
                value={newMcq.marks}
                onChange={(event) => setNewMcq((prev) => ({
                  ...prev,
                  marks: event.target.value === '' ? '' : Number(event.target.value)
                }))}
                placeholder="1"
              />

              {showsBlankHint && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  For fill-in-the-blank, use <span className="font-semibold">____</span> where the blank should appear.
                </div>
              )}

              <div className="space-y-2">
                <label className="form-label text-slate-700">Step 1: Choose Question Type</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewMcq((prev) => ({ ...prev, type: 'mcq', answerMode: prev.answerMode || 'single', correctOptions: prev.correctOptions?.length ? prev.correctOptions : [0], correctOption: prev.correctOptions?.[0] ?? 0 }))}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                      newMcq.type === 'mcq'
                        ? 'border-blue-300 bg-blue-100 text-blue-800 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Multiple Choice (MCQ)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewMcq((prev) => ({ ...prev, type: 'blank' }))}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                      newMcq.type === 'blank'
                        ? 'border-violet-300 bg-violet-100 text-violet-800 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Fill in the Blank
                  </button>
                </div>
              </div>

              {newMcq.type === 'mcq' ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 2: Add options and mark correct answer(s)</p>
                    <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                      <button
                        type="button"
                        onClick={() => updateAnswerMode('single')}
                        className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                          newMcq.answerMode === 'single'
                            ? 'bg-blue-100 text-blue-800'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        Single Correct
                      </button>
                      <button
                        type="button"
                        onClick={() => updateAnswerMode('multiple')}
                        className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                          newMcq.answerMode === 'multiple'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        Multiple Correct
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[0, 1, 2, 3].map((optionIndex) => (
                      <div key={optionIndex} className={`rounded-xl border p-3 ${newMcq.correctOptions.includes(optionIndex) ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-sm font-medium text-slate-700">Option {optionIndex + 1}</p>
                          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
                            <input
                              type="checkbox"
                              checked={newMcq.correctOptions.includes(optionIndex)}
                              onChange={() => toggleCorrectOption(optionIndex)}
                              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            Correct
                          </label>
                        </div>
                        <InputField
                          value={newMcq.options[optionIndex]}
                          onChange={(event) => {
                            const nextOptions = [...newMcq.options];
                            nextOptions[optionIndex] = event.target.value;
                            setNewMcq((prev) => ({ ...prev, options: nextOptions }));
                          }}
                          placeholder={`Option ${optionIndex + 1}`}
                        />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 2: Enter the blank answer</p>
                  <InputField
                    label="Blank Answer"
                    value={newMcq.blankAnswer}
                    onChange={(event) => setNewMcq((prev) => ({ ...prev, blankAnswer: event.target.value }))}
                    placeholder="Enter the correct word/phrase for blank"
                  />
                </>
              )}

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Live Preview</p>
                <p className="mt-1 text-sm font-medium text-slate-800">
                  {newMcq.question || 'Question preview will appear here as you type.'}
                </p>
                <p className="mt-1 text-xs text-slate-600">Marks: {normalizeMarksValue(newMcq.marks, 1)}</p>
                {newMcq.type === 'mcq' ? (
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-600">
                    {[0, 1, 2, 3].map((optionIndex) => (
                      <p
                        key={`preview-option-${optionIndex}`}
                        className={newMcq.correctOptions.includes(optionIndex) ? 'font-semibold text-emerald-700' : ''}
                      >
                        {String.fromCharCode(65 + optionIndex)}) {newMcq.options[optionIndex] || `Option ${optionIndex + 1}`}
                        {newMcq.correctOptions.includes(optionIndex) ? ' ✓' : ''}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-600">Expected answer: {newMcq.blankAnswer || '—'}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  {newMcq.type === 'mcq'
                    ? `Tick the checkbox on the right of each correct option (${newMcq.answerMode === 'single' ? 'single-correct mode' : 'multiple-correct mode'}).`
                    : 'Use ____ in question text where the blank appears.'}
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={resetQuestionForm}>
                    <FiX className="h-4 w-4" />
                    Clear
                  </Button>
                  <Button onClick={upsertQuestion} disabled={!isNewQuestionValid || builderSaving}>
                    {editingIndex === null ? <FiPlus className="h-4 w-4" /> : <FiCheckCircle className="h-4 w-4" />}
                    {editingIndex === null
                      ? (insertAtIndex !== null ? `Insert at ${insertAtIndex + 1}` : 'Add Question')
                      : 'Update Question'}
                  </Button>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-800">Question Set ({mcqList.length})</p>
                <div className="flex items-center gap-2 text-xs">
                  <span className="status-badge info">MCQ: {mcqCount}</span>
                  <span className="status-badge warning">Blank: {blankCount}</span>
                  <span className="status-badge success">Marks: {totalQuestionMarks}</span>
                </div>
              </div>

              {mcqList.length > 0 ? (
                <div className="table-shell overflow-x-auto">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Type</th>
                        <th>Question</th>
                        <th>Marks</th>
                        <th>Correct</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mcqList.map((mcq, index) => (
                        <tr key={`mcq-${index}`} className="group">
                          <td>{index + 1}</td>
                          <td>
                            <span className={`status-badge ${mcq.type === 'blank' ? 'warning' : 'info'}`}>
                              {getQuestionTypeLabel(mcq.type)}
                            </span>
                          </td>
                          <td>
                            <p className="font-medium text-slate-800">{mcq.question}</p>
                            {mcq.type === 'blank' ? (
                              <p className="text-xs text-slate-500 mt-1">Blank Answer: {mcq.blankAnswer || '—'}</p>
                            ) : (
                              <p className="text-xs text-slate-500 mt-1">
                                A) {mcq.options[0]} • B) {mcq.options[1]} • C) {mcq.options[2]} • D) {mcq.options[3]}
                              </p>
                            )}
                          </td>
                          <td>
                            {normalizeMarksValue(mcq.marks, 1)}
                          </td>
                          <td>
                            {mcq.type === 'blank'
                              ? 'Blank Answer'
                              : ((mcq.correctOptions && mcq.correctOptions.length > 0)
                                ? mcq.correctOptions.map((optionIndex) => `Option ${optionIndex + 1}`).join(', ')
                                : `Option ${(mcq.correctOption ?? 0) + 1}`)}
                          </td>
                          <td>
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="secondary"
                                className="!h-9 !px-3 !opacity-0 !pointer-events-none transition-opacity duration-150 group-hover:!opacity-100 group-hover:!pointer-events-auto group-focus-within:!opacity-100 group-focus-within:!pointer-events-auto"
                                onClick={() => beginInsertAt(index + 1)}
                              >
                                <FiPlus className="h-4 w-4" />
                                Insert Below
                              </Button>
                              <Button variant="secondary" className="!h-9 !px-3" onClick={() => openQuestionForEdit(index)}>
                                Edit
                              </Button>
                              <Button variant="danger" className="!h-9 !px-3" onClick={() => deleteQuestion(index)}>
                                <FiTrash2 className="h-4 w-4" />
                                Remove
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No questions added yet. Add questions one by one.</p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
              <Button variant="secondary" onClick={() => navigate('/teacher/assessments/templates')}>
                Close Builder
              </Button>
              {!isLocalDraft && (
                <Button variant="secondary" onClick={() => persistTemplate(mcqList, templateName, true)} disabled={builderSaving || mcqList.length === 0}>
                  <FiSave className="h-4 w-4" />
                  Save Now
                </Button>
              )}
              <Button onClick={finalizeTemplate} disabled={builderSaving || mcqList.length === 0}>
                <FiSave className="h-4 w-4" />
                {builderSaving ? 'Saving...' : 'Final Save Template'}
              </Button>
            </div>
          </Card.Body>
        </Card>
      </div>
    </Layout>
  );
};

export default AssessmentTemplateBuilder;
