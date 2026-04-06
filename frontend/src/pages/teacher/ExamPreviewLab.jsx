import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiChevronDown, FiClock, FiCode, FiPlay, FiRefreshCw, FiSearch } from 'react-icons/fi';
import Layout from '../../components/Layout';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import InputField from '../../components/ui/InputField';
import { assessmentAPI, compilerAPI } from '../../services/api';

const clampNumber = (value, min, max, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
};

const extractProblemCount = (payload) => {
  if (Array.isArray(payload?.problems)) {
    return payload.problems.length;
  }

  if (Array.isArray(payload?.challenge?.problems)) {
    return payload.challenge.problems.length;
  }

  return 0;
};

const getTemplateQuestionCount = (template) => {
  const fromTemplateData = template?.template_data?.questions;

  if (Array.isArray(fromTemplateData)) {
    return fromTemplateData.length;
  }

  const fromQuestionCount = Number.parseInt(String(template?.question_count ?? ''), 10);
  if (Number.isFinite(fromQuestionCount) && fromQuestionCount > 0) {
    return fromQuestionCount;
  }

  return 0;
};

const buildTemplateOptionLabel = (template) => {
  const title = String(template?.title || 'Untitled');
  const subject = String(template?.subject || 'N/A');
  const id = String(template?.id || '');

  if (!id) {
    return `${title} (${subject})`;
  }

  return `${title} (${subject}) | ${id}`;
};

const ExamPreviewLab = () => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [includeCoding, setIncludeCoding] = useState(true);
  const [startSection, setStartSection] = useState('mcq');
  const [challengeSearch, setChallengeSearch] = useState('');
  const [loadingChallenges, setLoadingChallenges] = useState(false);
  const [challengeCatalog, setChallengeCatalog] = useState([]);
  const [selectedChallengeIds, setSelectedChallengeIds] = useState([]);
  const [questionCountByChallenge, setQuestionCountByChallenge] = useState({});
  const [loadingCountByChallenge, setLoadingCountByChallenge] = useState({});
  const templateDropdownRef = useRef(null);

  const fetchTemplates = async () => {
    try {
      setLoadingTemplates(true);
      const response = await assessmentAPI.getTemplates();
      const templateList = Array.isArray(response.data?.templates) ? response.data.templates : [];
      setTemplates(templateList);

      setSelectedTemplateId((prev) => {
        if (prev && templateList.some((item) => item.id === prev)) {
          return prev;
        }

        return templateList[0]?.id || '';
      });
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load templates');
      setTemplates([]);
      setSelectedTemplateId('');
    } finally {
      setLoadingTemplates(false);
    }
  };

  const fetchChallenges = async () => {
    try {
      setLoadingChallenges(true);
      const response = await compilerAPI.listChallenges({ limit: 120 });
      const challenges = Array.isArray(response.data?.challenges) ? response.data.challenges : [];
      setChallengeCatalog(challenges);

      setSelectedChallengeIds((prev) => prev.filter((id) => challenges.some((item) => item.id === id)));
      setQuestionCountByChallenge((prev) => {
        const next = {};

        challenges.forEach((item) => {
          if (Object.prototype.hasOwnProperty.call(prev, item.id)) {
            next[item.id] = prev[item.id];
          }
        });

        return next;
      });
      setLoadingCountByChallenge((prev) => {
        const next = {};

        challenges.forEach((item) => {
          if (Object.prototype.hasOwnProperty.call(prev, item.id)) {
            next[item.id] = prev[item.id];
          }
        });

        return next;
      });
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load coding challenges');
    } finally {
      setLoadingChallenges(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
    fetchChallenges();
  }, []);

  const filteredTemplateOptions = useMemo(() => {
    const keyword = String(templateSearch || '').trim().toLowerCase();

    if (!keyword) {
      return templates;
    }

    return templates.filter((template) => {
      const title = String(template.title || '').toLowerCase();
      const subject = String(template.subject || '').toLowerCase();
      const id = String(template.id || '').toLowerCase();
      const optionLabel = buildTemplateOptionLabel(template).toLowerCase();

      return title.includes(keyword)
        || subject.includes(keyword)
        || id.includes(keyword)
        || optionLabel.includes(keyword);
    });
  }, [templates, templateSearch]);

  const selectedTemplate = useMemo(() => {
    return templates.find((template) => template.id === selectedTemplateId) || null;
  }, [templates, selectedTemplateId]);

  const selectedTemplateLabel = useMemo(() => {
    if (!selectedTemplate) {
      return 'Select template';
    }

    return buildTemplateOptionLabel(selectedTemplate);
  }, [selectedTemplate]);

  useEffect(() => {
    if (!templateDropdownOpen) {
      return undefined;
    }

    const handleOutsideClick = (event) => {
      if (!templateDropdownRef.current?.contains(event.target)) {
        setTemplateDropdownOpen(false);
        setTemplateSearch('');
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [templateDropdownOpen]);

  const handleTemplateSelect = (templateId) => {
    setSelectedTemplateId(templateId);
    setTemplateDropdownOpen(false);
    setTemplateSearch('');
  };

  const selectedTemplateQuestionCount = useMemo(() => {
    return getTemplateQuestionCount(selectedTemplate);
  }, [selectedTemplate]);

  const filteredChallenges = useMemo(() => {
    const normalizedSearch = String(challengeSearch || '').trim().toLowerCase();

    if (!normalizedSearch) {
      return challengeCatalog;
    }

    return challengeCatalog.filter((item) => {
      const title = String(item.title || '').toLowerCase();
      const id = String(item.id || '').toLowerCase();
      const tagText = Array.isArray(item.tags)
        ? item.tags.join(' ').toLowerCase()
        : '';

      return title.includes(normalizedSearch)
        || id.includes(normalizedSearch)
        || tagText.includes(normalizedSearch);
    });
  }, [challengeCatalog, challengeSearch]);

  useEffect(() => {
    const idsToInspect = [
      ...selectedChallengeIds,
      ...filteredChallenges.slice(0, 30).map((item) => item.id)
    ];
    const uniqueIds = Array.from(new Set(idsToInspect.filter(Boolean)));

    const pendingIds = uniqueIds.filter((id) => (
      !Object.prototype.hasOwnProperty.call(questionCountByChallenge, id)
      && !loadingCountByChallenge[id]
    ));

    if (pendingIds.length === 0) {
      return;
    }

    let cancelled = false;

    const loadProblemCounts = async () => {
      setLoadingCountByChallenge((prev) => {
        const next = { ...prev };
        pendingIds.forEach((id) => {
          next[id] = true;
        });
        return next;
      });

      const results = await Promise.allSettled(
        pendingIds.map(async (challengeId) => {
          const response = await compilerAPI.getChallenge(challengeId);
          return {
            challengeId,
            count: extractProblemCount(response.data)
          };
        })
      );

      if (cancelled) {
        return;
      }

      const countUpdates = {};
      const loadingUpdates = {};

      results.forEach((result, index) => {
        const challengeId = pendingIds[index];
        loadingUpdates[challengeId] = false;

        if (result.status === 'fulfilled') {
          countUpdates[challengeId] = result.value.count;
        } else {
          countUpdates[challengeId] = 0;
        }
      });

      setQuestionCountByChallenge((prev) => ({ ...prev, ...countUpdates }));
      setLoadingCountByChallenge((prev) => ({ ...prev, ...loadingUpdates }));
    };

    loadProblemCounts();

    return () => {
      cancelled = true;
    };
  }, [selectedChallengeIds, filteredChallenges, questionCountByChallenge, loadingCountByChallenge]);

  const selectedQuestionCount = useMemo(() => {
    return selectedChallengeIds.reduce((total, challengeId) => {
      return total + Number(questionCountByChallenge[challengeId] || 0);
    }, 0);
  }, [selectedChallengeIds, questionCountByChallenge]);

  const selectedCountLoading = useMemo(() => {
    return selectedChallengeIds.some((challengeId) => Boolean(loadingCountByChallenge[challengeId]));
  }, [selectedChallengeIds, loadingCountByChallenge]);

  const selectedQuestionLabel = useMemo(() => {
    if (selectedCountLoading) {
      const challengeCount = selectedChallengeIds.length;
      return `Calculating questions for ${challengeCount} selected challenge${challengeCount === 1 ? '' : 's'}...`;
    }

    const questionsLabel = `${selectedQuestionCount} question${selectedQuestionCount === 1 ? '' : 's'}`;
    const challengeCount = selectedChallengeIds.length;
    const challengesLabel = `${challengeCount} challenge${challengeCount === 1 ? '' : 's'}`;

    return `${questionsLabel} from ${challengesLabel}`;
  }, [selectedQuestionCount, selectedChallengeIds.length, selectedCountLoading]);

  const toggleChallenge = (challengeId) => {
    setSelectedChallengeIds((prev) => {
      if (prev.includes(challengeId)) {
        return prev.filter((id) => id !== challengeId);
      }

      return [...prev, challengeId];
    });
  };

  const launchPreview = () => {
    if (!selectedTemplate) {
      toast.error('Select a template to preview MCQ section');
      return;
    }

    const safeMcq = Math.max(1, getTemplateQuestionCount(selectedTemplate));
    if (safeMcq <= 0) {
      toast.error('Selected template has no MCQ questions');
      return;
    }

    const safeDuration = clampNumber(durationMinutes, 5, 300, 60);
    const effectiveCoding = includeCoding && selectedChallengeIds.length > 0;

    if (includeCoding && selectedChallengeIds.length === 0) {
      toast.error('Select at least one coding challenge to preview coding section');
      return;
    }

    const params = new URLSearchParams();
    params.set('preview', '1');
    params.set('templateId', selectedTemplate.id);
    params.set('mcq', String(safeMcq));
    params.set('timer', String(safeDuration));
    params.set('coding', effectiveCoding ? '1' : '0');
    params.set('start', effectiveCoding && startSection === 'coding' ? 'coding' : 'mcq');
    params.set('title', String(selectedTemplate.title || 'Assessment'));
    params.set('subject', String(selectedTemplate.subject || 'General Subject'));

    if (effectiveCoding) {
      params.set('challenges', selectedChallengeIds.join(','));
    }

    navigate(`/teacher/assessments/preview-lab/run/demo?${params.toString()}`);
  };

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header">
          <h1>Exam Preview Lab</h1>
          <p>Configure a dummy exam and open the student attempt window directly for fast UI testing.</p>
        </div>

        <Card>
          <Card.Header>
            <h2 className="section-title text-base">Preview Configuration</h2>
          </Card.Header>
          <Card.Body className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div className="relative" ref={templateDropdownRef}>
                <label className="form-label">Assessment Template (MCQ Source)</label>
                <button
                  type="button"
                  className="form-select flex w-full items-center justify-between gap-2 text-left"
                  onClick={() => {
                    setTemplateDropdownOpen((prev) => !prev);
                    setTemplateSearch('');
                  }}
                  disabled={loadingTemplates}
                >
                  <span className={selectedTemplate ? 'text-slate-800' : 'text-slate-400'}>{selectedTemplateLabel}</span>
                  <FiChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${templateDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {templateDropdownOpen && (
                  <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg">
                    <div className="border-b border-slate-100 p-2">
                      <input
                        className="form-input"
                        placeholder="Search template"
                        value={templateSearch}
                        onChange={(event) => setTemplateSearch(event.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="max-h-64 overflow-y-auto p-1">
                      {filteredTemplateOptions.length === 0 ? (
                        <p className="px-2 py-2 text-xs text-slate-500">No templates match your search.</p>
                      ) : (
                        filteredTemplateOptions.map((template) => {
                          const isSelected = selectedTemplateId === template.id;

                          return (
                            <button
                              key={template.id}
                              type="button"
                              className={`w-full rounded-lg px-2 py-2 text-left transition-colors ${
                                isSelected
                                  ? 'bg-indigo-50 text-indigo-700'
                                  : 'text-slate-700 hover:bg-slate-50'
                              }`}
                              onClick={() => handleTemplateSelect(template.id)}
                            >
                              <p className="truncate text-sm font-semibold">{template.title || 'Untitled'}</p>
                              <p className="truncate text-xs text-slate-500">{`${template.subject || 'N/A'} | ${template.id}`}</p>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              <InputField
                label="Timer (minutes)"
                type="number"
                min={5}
                max={300}
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(event.target.value)}
                leftIcon={FiClock}
              />

              <div>
                <label className="form-label">Start Section</label>
                <select
                  className="form-select"
                  value={startSection}
                  onChange={(event) => setStartSection(event.target.value)}
                  disabled={!includeCoding}
                >
                  <option value="mcq">MCQ</option>
                  <option value="coding">Coding</option>
                </select>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              MCQ from template: {selectedTemplateQuestionCount} question(s)
            </p>

            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={includeCoding}
                onChange={(event) => setIncludeCoding(event.target.checked)}
              />
              Include coding section
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <p className="text-sm text-slate-600">
                {includeCoding
                  ? `Selected coding questions: ${selectedQuestionLabel}`
                  : 'Coding section disabled for this preview'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={fetchTemplates} disabled={loadingTemplates}>
                  <FiRefreshCw className={`h-4 w-4 ${loadingTemplates ? 'animate-spin' : ''}`} />
                  Refresh Templates
                </Button>
                <Button type="button" variant="secondary" onClick={fetchChallenges} disabled={loadingChallenges}>
                  <FiRefreshCw className={`h-4 w-4 ${loadingChallenges ? 'animate-spin' : ''}`} />
                  Refresh Challenges
                </Button>
              </div>
            </div>
          </Card.Body>
        </Card>

        {includeCoding && (
          <Card>
            <Card.Header>
              <div className="flex items-center justify-between gap-2">
                <h2 className="section-title text-base">Coding Challenges</h2>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                  {selectedQuestionLabel}
                </span>
              </div>
            </Card.Header>
            <Card.Body className="space-y-3">
              <InputField
                label="Search Challenges"
                placeholder="Search by title, id, or tag"
                value={challengeSearch}
                onChange={(event) => setChallengeSearch(event.target.value)}
                leftIcon={FiSearch}
              />

              {loadingChallenges ? (
                <p className="text-sm text-slate-500">Loading challenge list...</p>
              ) : challengeCatalog.length === 0 ? (
                <p className="text-sm text-slate-500">No challenges found. Create challenges first to test coding preview.</p>
              ) : filteredChallenges.length === 0 ? (
                <p className="text-sm text-slate-500">No challenges match your search.</p>
              ) : (
                <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {filteredChallenges.map((item) => {
                    const checked = selectedChallengeIds.includes(item.id);
                    const isLoadingCount = Boolean(loadingCountByChallenge[item.id]);
                    const questionCount = Number(questionCountByChallenge[item.id] || 0);

                    return (
                      <label
                        key={item.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 transition-colors ${
                          checked
                            ? 'border-indigo-200 bg-indigo-50'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleChallenge(item.id)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">{item.title || 'Untitled Challenge'}</p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">ID: {item.id}</p>
                          <p className="mt-0.5 text-xs font-medium text-slate-600">
                            {isLoadingCount
                              ? 'Loading question count...'
                              : `${questionCount} question${questionCount === 1 ? '' : 's'} inside this challenge`}
                          </p>
                          {(item.tags || []).length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {item.tags.slice(0, 4).map((tag) => (
                                <span
                                  key={`${item.id}-${tag}`}
                                  className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </Card.Body>
          </Card>
        )}

        <Card>
          <Card.Body className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-800">Ready to preview student exam window</p>
              <p className="mt-1 text-xs text-slate-500">
                {includeCoding
                  ? `Coding part will use ${selectedQuestionLabel}.`
                  : 'Coding section is disabled for this preview run.'}
              </p>
            </div>
            <Button type="button" onClick={launchPreview}>
              <FiPlay className="h-4 w-4" />
              Open Student Preview
            </Button>
          </Card.Body>
        </Card>

        <Card className="border border-dashed border-blue-200 bg-blue-50/50">
          <Card.Body>
            <div className="flex items-start gap-2 text-sm text-blue-800">
              <FiCode className="mt-0.5 h-4 w-4" />
              <p>
                This lab opens a mock student attempt using MCQ from your selected template plus optional coding challenges.
                No real student data is modified during preview testing.
              </p>
            </div>
          </Card.Body>
        </Card>
      </div>
    </Layout>
  );
};

export default ExamPreviewLab;
