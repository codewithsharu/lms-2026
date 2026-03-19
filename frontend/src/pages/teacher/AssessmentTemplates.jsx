import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiBookOpen, FiCheckCircle, FiEdit2, FiEye, FiFileText, FiHash, FiPlus, FiTrash2 } from 'react-icons/fi';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import { assessmentAPI } from '../../services/api';

const AssessmentTemplates = () => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deletingTemplateId, setDeletingTemplateId] = useState(null);
  const [previewTemplate, setPreviewTemplate] = useState(null);

  const getTemplateQuestions = (template) => {
    const questions = template?.template_data?.questions;
    return Array.isArray(questions) ? questions : [];
  };

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const response = await assessmentAPI.getTemplates();
      setTemplates(response.data.templates || []);
      setSetupRequired(Boolean(response.data.setupRequired));
    } catch (error) {
      const setupPending = Boolean(error.response?.data?.setupRequired);
      if (setupPending) {
        setSetupRequired(true);
        setTemplates([]);
      } else {
        toast.error('Failed to fetch templates');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleDeleteTemplate = async (template) => {
    if (!template?.id) return;

    const confirmed = window.confirm(`Delete template "${template.title || 'Untitled'}"? This will remove it from your list.`);
    if (!confirmed) return;

    try {
      setDeletingTemplateId(template.id);
      await assessmentAPI.deleteTemplate(template.id);
      toast.success('Template deleted successfully');
      fetchTemplates();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to delete template');
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const previewQuestions = getTemplateQuestions(previewTemplate);
  const previewMcqCount = previewQuestions.filter((question) => (question?.type || 'mcq') !== 'blank').length;
  const previewBlankCount = previewQuestions.filter((question) => question?.type === 'blank').length;

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
             <h1>Question Bank</h1>
             <p>Create MCQ templates question-by-question. Template ID is later used to host exams directly.</p>
          </div>
          <Button onClick={() => navigate('/teacher/assessments/templates/new/builder')}>
            <FiPlus className="h-4 w-4" />
            Create Question bank
          </Button>
        </div>

        <Card>
          <Card.Body>
            {setupRequired && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Assessment module setup is pending. You can still open the dedicated builder in local draft mode.
              </div>
            )}

            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, index) => (
                  <div key={index} className="h-16 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : templates.length > 0 ? (
              <div className="table-shell overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Template ID</th>
                      <th>Name</th>
                      <th>Questions</th>
                      <th>Updated</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((template) => (
                      <tr key={template.id}>
                        <td className="font-medium text-slate-800">{template.id}</td>
                        <td>
                          <p className="font-medium text-slate-800">{template.title || 'Untitled MCQ Template'}</p>
                        </td>
                        <td>{template.question_count}</td>
                        <td>{template.updated_at ? new Date(template.updated_at).toLocaleString() : '—'}</td>
                        <td>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="secondary"
                              className="h-9! px-3! border-blue-200! bg-blue-50! text-blue-700! hover:bg-blue-100!"
                              onClick={() => setPreviewTemplate(template)}
                            >
                              <FiEye className="h-4 w-4" />
                              View
                            </Button>
                            <Button
                              variant="secondary"
                              className="h-9! px-3! border-emerald-200! bg-emerald-50! text-emerald-700! hover:bg-emerald-100!"
                              onClick={() => navigate(`/teacher/assessments/templates/${template.id}/builder`)}
                            >
                              <FiEdit2 className="h-4 w-4" />
                              Open Builder
                            </Button>
                            <Button
                              variant="secondary"
                              className="h-9! w-9! p-0! border-red-200! bg-red-50! text-red-700! hover:bg-red-100!"
                              onClick={() => handleDeleteTemplate(template)}
                              disabled={deletingTemplateId === template.id}
                              aria-label={deletingTemplateId === template.id ? 'Deleting template' : 'Delete template'}
                              title={deletingTemplateId === template.id ? 'Deleting template' : 'Delete template'}
                            >
                              <FiTrash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-primary">
                  <FiBookOpen className="h-7 w-7" />
                </div>
                <p className="text-base font-medium text-slate-800">No Question bank created at</p>
                <p className="mt-1 text-sm text-slate-500">Open the dedicated builder page and create your first template.</p>
              </div>
            )}
          </Card.Body>
        </Card>

        <Modal
          open={Boolean(previewTemplate)}
          onClose={() => setPreviewTemplate(null)}
          title={previewTemplate?.title || 'Template Preview'}
          subtitle={previewTemplate ? `Template ID: ${previewTemplate.id}` : ''}
          maxWidth="max-w-5xl"
          footer={
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setPreviewTemplate(null)}>
                Close
              </Button>
            </div>
          }
        >
          {previewTemplate && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200">
                  <FiHash className="h-3.5 w-3.5 text-blue-600" />
                  ID: {previewTemplate.id}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200">
                  <FiFileText className="h-3.5 w-3.5 text-emerald-600" />
                  {previewTemplate.subject || 'MCQ'}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200">
                  <FiCheckCircle className="h-3.5 w-3.5 text-violet-600" />
                  Updated {previewTemplate.updated_at ? new Date(previewTemplate.updated_at).toLocaleString() : '—'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-blue-700">Total Questions</p>
                  <p className="mt-1 text-xl font-semibold text-blue-900">{previewQuestions.length}</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-emerald-700">MCQ</p>
                  <p className="mt-1 text-xl font-semibold text-emerald-900">{previewMcqCount}</p>
                </div>
                <div className="rounded-xl border border-violet-100 bg-violet-50/70 p-3 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-violet-700">Fill in the Blank</p>
                  <p className="mt-1 text-xl font-semibold text-violet-900">{previewBlankCount}</p>
                </div>
              </div>

              {previewQuestions.length === 0 ? (
                <p className="text-sm text-slate-500">No questions in this template yet.</p>
              ) : (
                <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                  {previewQuestions.map((question, index) => {
                    const isBlank = question?.type === 'blank';
                    const correctOptions = Array.isArray(question?.correctOptions)
                      ? question.correctOptions
                      : (Number.isInteger(question?.correctOption) ? [question.correctOption] : []);

                    return (
                      <div key={`preview-question-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-800">Q{index + 1}. {question?.question || 'Untitled question'}</p>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${isBlank ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
                              {isBlank ? 'Blank' : 'MCQ'}
                            </span>
                            {!isBlank && (
                              <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                                {(question?.answerMode === 'multiple' || (correctOptions?.length || 0) > 1) ? 'Multiple Correct' : 'Single Correct'}
                              </span>
                            )}
                          </div>
                        </div>

                        {isBlank ? (
                          <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2 text-sm text-violet-800">
                            Answer: <span className="font-semibold">{question?.blankAnswer || '—'}</span>
                          </div>
                        ) : (
                          <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-slate-700 md:grid-cols-2">
                            {(question?.options || []).map((option, optionIndex) => (
                              <div
                                key={`preview-option-${index}-${optionIndex}`}
                                className={`rounded-lg border px-3 py-2 ${correctOptions.includes(optionIndex) ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50/60 text-slate-700'}`}
                              >
                                <span className="font-medium">{String.fromCharCode(65 + optionIndex)})</span> {option || `Option ${optionIndex + 1}`}
                                {correctOptions.includes(optionIndex) ? <span className="ml-1 font-semibold">✓</span> : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Modal>
      </div>
    </Layout>
  );
};

export default AssessmentTemplates;
