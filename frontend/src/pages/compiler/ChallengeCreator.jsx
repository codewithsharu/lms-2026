import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiEdit3, FiPlayCircle, FiPlus, FiSend, FiTrash2 } from 'react-icons/fi';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import InputField from '../../components/ui/InputField';
import Alert from '../../components/ui/Alert';
import { compilerAPI } from '../../services/api';
import CompilerTopBar from './CompilerTopBar';
import { SUPPORTED_LANGUAGES } from './challengePresets';
import { buildCompilerPath, isTeacherCompilerPath } from './routePaths';

const DIFFICULTY_OPTIONS = ['easy', 'medium', 'hard'];

const firstTruthyString = (values = []) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
};

const isFailureStatus = (statusValue) => {
  const normalized = String(statusValue || '').trim().toLowerCase();
  return ['failed', 'error', 'fail', 'failure'].includes(normalized);
};

const isApiFailurePayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  if (isFailureStatus(payload.status)) {
    return true;
  }

  if (payload.success === false) {
    return true;
  }

  return false;
};

const extractChallengeId = (payload) => firstTruthyString([
  payload?.challengeId,
  payload?.challenge_id,
  payload?.id,
  payload?._id,
  payload?.doc?.challengeId,
  payload?.doc?.id,
  payload?.doc?._id,
  payload?.challenge?.challengeId,
  payload?.challenge?.id,
  payload?.challenge?._id,
  payload?.data?.challengeId,
  payload?.data?.id,
  payload?.data?._id,
  payload?.result?.challengeId,
  payload?.result?.id
]);

const createEmptyTestCase = (index) => ({
  id: index,
  label: `case-${index}`,
  input: '',
  output: ''
});

const createEmptyQuestion = () => ({
  problemId: '',
  title: '',
  markdown: '',
  score: 1,
  difficultyLevel: 'easy',
  supportedLanguages: ['python', 'java', 'c', 'cpp'],
  ignoreCase: true,
  validations: []
});

const createEmptyChallengeForm = () => ({
  challengeId: '',
  title: '',
  markdown: '',
  tagsText: '',
  visibility: 'unlisted',
  questions: [createEmptyQuestion()]
});

const buildFormFromPayload = (payload) => {
  const challenge = payload?.challenge || {};
  const problems = Array.isArray(payload?.problems) ? payload.problems : [];

  const questions = problems.length > 0
    ? problems.map((problem) => {
      const codeOptions = problem?.properties?.options?.code || {};
      const validations = Array.isArray(codeOptions.validations)
        ? codeOptions.validations
            .map((validation, index) => ({
              id: Number.isFinite(Number(validation?.id)) ? Number(validation.id) : index + 1,
              label: String(validation?.label || `case-${index + 1}`),
              input: String(validation?.input ?? ''),
              output: String(validation?.output ?? '')
            }))
            .filter((entry) => entry.label || entry.input || entry.output)
        : [];

      return {
        problemId: String(problem?._id || problem?.id || '').trim(),
        title: String(problem?.title || ''),
        markdown: String(problem?.markdown || ''),
        score: Number(problem?.properties?.score || 1),
        difficultyLevel: String(problem?.properties?.difficultyLevel || 'easy'),
        supportedLanguages: Array.isArray(codeOptions.supportedLanguages) && codeOptions.supportedLanguages.length > 0
          ? codeOptions.supportedLanguages.map((value) => String(value))
          : ['python', 'java', 'c', 'cpp'],
        ignoreCase: codeOptions.ignoreCase !== false,
        validations: validations
      };
    })
    : [createEmptyQuestion()];

  return {
    challengeId: String(challenge?._id || challenge?.id || '').trim(),
    title: String(challenge?.title || ''),
    markdown: String(challenge?.markdown || ''),
    tagsText: Array.isArray(challenge?.tags)
      ? challenge.tags.join(', ')
      : String(challenge?.tags || ''),
    visibility: String(challenge?.visibility || 'unlisted'),
    questions
  };
};

const buildPayloadFromForm = (formState, basePayload = null) => {
  const tags = String(formState.tagsText || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const normalizedProblemIds = (formState.questions || [])
    .map((question) => String(question?.problemId || '').trim())
    .filter(Boolean);

  const baseChallenge = basePayload?.challenge && typeof basePayload.challenge === 'object' && !Array.isArray(basePayload.challenge)
    ? basePayload.challenge
    : {};

  const challengeProperties = {
    ...(baseChallenge?.properties && typeof baseChallenge.properties === 'object' ? baseChallenge.properties : {})
  };

  if (normalizedProblemIds.length > 0) {
    challengeProperties.problemIds = normalizedProblemIds;
  } else {
    delete challengeProperties.problemIds;
  }

  const baseProblems = Array.isArray(basePayload?.problems) ? basePayload.problems : [];
  const baseProblemsById = new Map(
    baseProblems
      .map((problem) => [String(problem?._id || problem?.id || '').trim(), problem])
      .filter(([problemId]) => Boolean(problemId))
  );

  const challengePayload = {
    ...baseChallenge,
    title: String(formState.title || '').trim(),
    markdown: String(formState.markdown || '').trim(),
    tags,
    visibility: String(formState.visibility || 'unlisted'),
    properties: challengeProperties
  };

  const normalizedChallengeId = String(formState.challengeId || '').trim();
  if (normalizedChallengeId) {
    challengePayload._id = normalizedChallengeId;
  } else {
    delete challengePayload._id;
  }

  return {
    challenge: challengePayload,
    problems: (formState.questions || []).map((question) => {
      const normalizedProblemId = String(question.problemId || '').trim();
      const baseProblem = normalizedProblemId
        ? (baseProblemsById.get(normalizedProblemId) || {})
        : {};

      const baseCodeOptions = baseProblem?.properties?.options?.code && typeof baseProblem.properties.options.code === 'object'
        ? baseProblem.properties.options.code
        : {};

      const baseValidationsById = new Map(
        (Array.isArray(baseCodeOptions.validations) ? baseCodeOptions.validations : [])
          .map((validation) => [Number(validation?.id), validation])
          .filter(([validationId]) => Number.isFinite(validationId))
      );

      const validations = (question.validations || [])
        .map((validation, index) => {
          const normalizedValidationId = Number.isFinite(Number(validation.id)) ? Number(validation.id) : index + 1;
          const baseValidation = baseValidationsById.get(normalizedValidationId) || {};

          return {
            ...baseValidation,
            id: normalizedValidationId,
            label: String(validation.label || `case-${index + 1}`).trim() || `case-${index + 1}`,
            input: String(validation.input || ''),
            output: String(validation.output || '')
          };
        })
        .filter((validation) => validation.output.length > 0 || validation.input.length > 0);

      const problemPayload = {
        ...baseProblem,
        title: String(question.title || '').trim(),
        markdown: String(question.markdown || '').trim(),
        properties: {
          ...(baseProblem?.properties && typeof baseProblem.properties === 'object' ? baseProblem.properties : {}),
          problemType: 'code',
          score: Number(question.score || 1),
          difficultyLevel: String(question.difficultyLevel || 'easy'),
          options: {
            ...(baseProblem?.properties?.options && typeof baseProblem.properties.options === 'object'
              ? baseProblem.properties.options
              : {}),
            code: {
              ...baseCodeOptions,
              supportedLanguages: (question.supportedLanguages || []).length > 0
                ? question.supportedLanguages
                : ['python'],
              validations,
              problemCategory: 'programmingLanguages',
              ignoreCase: question.ignoreCase !== false
            }
          }
        }
      };

      if (normalizedProblemId) {
        problemPayload._id = normalizedProblemId;
      } else {
        delete problemPayload._id;
      }

      return problemPayload;
    })
  };
};

const parsePayloadJson = (rawJson) => {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Invalid JSON format. Fix syntax and try again.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON payload must be an object.');
  }

  if (!parsed.challenge || !Array.isArray(parsed.problems)) {
    throw new Error('JSON payload must include challenge and problems array.');
  }

  return parsed;
};

const extractEditablePayload = (payload) => {
  const candidates = [
    payload,
    payload?.data,
    payload?.doc,
    payload?.result,
    payload?.value
  ];

  for (const candidate of candidates) {
    if (
      candidate
      && typeof candidate === 'object'
      && !Array.isArray(candidate)
      && candidate.challenge
      && Array.isArray(candidate.problems)
    ) {
      return candidate;
    }
  }

  return null;
};

const getEditablePayloadChallengeId = (payload) => firstTruthyString([
  payload?.challenge?._id,
  payload?.challenge?.id,
  payload?.challengeId,
  payload?.id,
  payload?._id
]);

const ChallengeCreator = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isPortalMode = isTeacherCompilerPath(location.pathname);
  const sourceChallengeId = String(searchParams.get('sourceChallengeId') || '').trim();
  const [editableSourcePayload, setEditableSourcePayload] = useState(null);
  const [formState, setFormState] = useState(() => createEmptyChallengeForm());
  const [jsonInput, setJsonInput] = useState(() => JSON.stringify(buildPayloadFromForm(createEmptyChallengeForm()), null, 2));
  const [jsonError, setJsonError] = useState('');
  const [sourceLoadError, setSourceLoadError] = useState('');
  const [loadingSourceChallenge, setLoadingSourceChallenge] = useState(false);
  const [isEditingJson, setIsEditingJson] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const payload = useMemo(
    () => buildPayloadFromForm(formState, editableSourcePayload),
    [formState, editableSourcePayload]
  );
  const payloadJson = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  const challengeId = useMemo(() => extractChallengeId(result), [result]);
  const runnerPath = useMemo(
    () => (challengeId
      ? buildCompilerPath(location.pathname, `/run/${encodeURIComponent(challengeId)}`)
      : ''),
    [location.pathname, challengeId]
  );
  const editPath = useMemo(
    () => (challengeId
      ? buildCompilerPath(location.pathname, `/new?sourceChallengeId=${encodeURIComponent(challengeId)}`)
      : ''),
    [location.pathname, challengeId]
  );

  const pageTitle = sourceChallengeId ? 'Edit Challenge' : 'Challenge Builder';
  const pageSubtitle = sourceChallengeId
    ? 'Load, review, and edit challenge content in one place.'
    : 'Simple challenge flow: form and JSON stay in sync.';

  useEffect(() => {
    let cancelled = false;

    const loadSourceChallenge = async () => {
      if (!sourceChallengeId) {
        setEditableSourcePayload(null);
        setSourceLoadError('');
        setLoadingSourceChallenge(false);
        return;
      }

      try {
        setLoadingSourceChallenge(true);
        setSourceLoadError('');

        const response = await compilerAPI.getChallenge(sourceChallengeId);
        const editablePayload = extractEditablePayload(response.data);

        if (!editablePayload) {
          throw new Error('This challenge payload cannot be edited in builder format');
        }

        if (cancelled) {
          return;
        }

        setEditableSourcePayload(editablePayload);
        setFormState(buildFormFromPayload(editablePayload));
        setJsonInput(JSON.stringify(editablePayload, null, 2));
        setJsonError('');
        setError('');
        setResult(null);
        setIsEditingJson(false);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        const message = loadError.response?.data?.error
          || loadError.message
          || 'Failed to load challenge for editing';
        setSourceLoadError(message);
        toast.error(message);
      } finally {
        if (!cancelled) {
          setLoadingSourceChallenge(false);
        }
      }
    };

    loadSourceChallenge();

    return () => {
      cancelled = true;
    };
  }, [sourceChallengeId]);

  useEffect(() => {
    if (isEditingJson) {
      return;
    }

    setJsonInput(payloadJson);
  }, [payloadJson, isEditingJson]);

  const handleJsonInputChange = (nextJson) => {
    setJsonInput(nextJson);

    try {
      const parsedPayload = parsePayloadJson(nextJson);
      setEditableSourcePayload(parsedPayload);
      setFormState(buildFormFromPayload(parsedPayload));
      setJsonError('');
      setResult(null);
      setError('');
    } catch {
      setJsonError('JSON is invalid. Form updates automatically once JSON becomes valid.');
    }
  };

  const handleJsonEditorBlur = () => {
    setIsEditingJson(false);

    try {
      const parsedPayload = parsePayloadJson(jsonInput);
      setJsonInput(JSON.stringify(parsedPayload, null, 2));
      setJsonError('');
    } catch {
      // Keep user text as-is so they can continue editing invalid JSON.
    }
  };

  const updateChallengeField = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const updateQuestionField = (questionIndex, field, value) => {
    setFormState((prev) => ({
      ...prev,
      questions: prev.questions.map((question, index) => (
        index === questionIndex
          ? { ...question, [field]: value }
          : question
      ))
    }));
  };

  const toggleQuestionLanguage = (questionIndex, languageId) => {
    setFormState((prev) => ({
      ...prev,
      questions: prev.questions.map((question, index) => {
        if (index !== questionIndex) return question;

        const active = new Set(question.supportedLanguages || []);
        if (active.has(languageId)) {
          active.delete(languageId);
        } else {
          active.add(languageId);
        }

        return {
          ...question,
          supportedLanguages: Array.from(active)
        };
      })
    }));
  };

  const addQuestion = () => {
    setFormState((prev) => ({
      ...prev,
      questions: [...prev.questions, createEmptyQuestion()]
    }));
  };

  const removeQuestion = (questionIndex) => {
    setFormState((prev) => {
      if (prev.questions.length === 1) return prev;

      return {
        ...prev,
        questions: prev.questions.filter((_, index) => index !== questionIndex)
      };
    });
  };

  const addTestCase = (questionIndex) => {
    setFormState((prev) => ({
      ...prev,
      questions: prev.questions.map((question, index) => {
        if (index !== questionIndex) return question;

        const nextIndex = (question.validations || []).length + 1;
        return {
          ...question,
          validations: [...(question.validations || []), createEmptyTestCase(nextIndex)]
        };
      })
    }));
  };

  const updateTestCase = (questionIndex, testCaseIndex, field, value) => {
    setFormState((prev) => ({
      ...prev,
      questions: prev.questions.map((question, index) => {
        if (index !== questionIndex) return question;

        return {
          ...question,
          validations: (question.validations || []).map((testCase, currentIndex) => (
            currentIndex === testCaseIndex
              ? { ...testCase, [field]: value }
              : testCase
          ))
        };
      })
    }));
  };

  const removeTestCase = (questionIndex, testCaseIndex) => {
    setFormState((prev) => ({
      ...prev,
      questions: prev.questions.map((question, index) => {
        if (index !== questionIndex) return question;
        if ((question.validations || []).length === 1) return question;

        return {
          ...question,
          validations: question.validations.filter((_, currentIndex) => currentIndex !== testCaseIndex)
        };
      })
    }));
  };

  const submitChallenge = async (requestPayload) => {
    try {
      setSubmitting(true);
      setError('');

      const isEditMode = Boolean(sourceChallengeId);
      const fallbackChallengeId = getEditablePayloadChallengeId(requestPayload);
      const targetChallengeId = firstTruthyString([
        requestPayload?.challenge?._id,
        sourceChallengeId,
        fallbackChallengeId
      ]);

      if (isEditMode && !targetChallengeId) {
        throw new Error('Challenge ID is missing for update');
      }

      const normalizedRequestPayload = {
        ...requestPayload,
        challenge: {
          ...(requestPayload?.challenge || {})
        }
      };

      if (isEditMode && targetChallengeId) {
        normalizedRequestPayload.challenge._id = targetChallengeId;
      }

      const response = isEditMode
        ? await compilerAPI.updateChallenge(targetChallengeId, normalizedRequestPayload)
        : await compilerAPI.createChallenge(normalizedRequestPayload);

      if (isApiFailurePayload(response.data)) {
        throw new Error(
          firstTruthyString([
            response.data?.error,
            response.data?.message,
            sourceChallengeId ? 'Challenge update failed' : 'Challenge creation failed'
          ])
        );
      }

      const editableResponsePayload = extractEditablePayload(response.data);
      const syncedPayload = editableResponsePayload || normalizedRequestPayload;

      setEditableSourcePayload(syncedPayload);
      setFormState(buildFormFromPayload(syncedPayload));
      setJsonInput(JSON.stringify(syncedPayload, null, 2));
      setResult(response.data);

      const recreatedByBackend = response.data?._meta?.recreated === true;
      const recreatedChallengeId = extractChallengeId(response.data);

      if (sourceChallengeId) {
        toast.success(
          recreatedByBackend
            ? `Challenge updated by creating a new version${recreatedChallengeId ? ` (${recreatedChallengeId})` : ''}`
            : 'Challenge updated successfully'
        );
      } else {
        toast.success('Challenge created successfully');
      }
    } catch (requestError) {
      const message = requestError.response?.data?.error
        || requestError.message
        || (sourceChallengeId ? 'Challenge update failed' : 'Challenge creation failed');
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const createChallenge = async () => {
    let requestPayload;
    try {
      requestPayload = parsePayloadJson(jsonInput);
      setJsonError('');
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : 'Invalid JSON payload';
      setJsonError(message);
      toast.error(message);
      return;
    }

    await submitChallenge(requestPayload);
  };

  return (
    <div className={isPortalMode ? 'portal-compiler' : 'compiler-shell'}>
      {isPortalMode ? (
        <div className="page-header">
          <h1>{pageTitle}</h1>
          <p>{pageSubtitle}</p>
        </div>
      ) : (
        <CompilerTopBar
          title={pageTitle}
          subtitle={pageSubtitle}
        />
      )}

      <main className={isPortalMode ? 'app-page' : 'compiler-main app-page'}>
        {sourceChallengeId && (
          <section className="compiler-card mb-4 p-4 lg:p-5">
            <p className="text-sm font-medium text-slate-700 break-all">
              Editing challenge ID: <span className="font-mono">{sourceChallengeId}</span>
            </p>
            {loadingSourceChallenge && (
              <p className="mt-1 text-xs text-slate-500">Loading challenge content...</p>
            )}
            {sourceLoadError && <Alert className="mt-2">{sourceLoadError}</Alert>}
          </section>
        )}

        <section className="compiler-card p-4 lg:p-5">
          <InputField
            label="Challenge Title"
            value={formState.title}
            onChange={(event) => updateChallengeField('title', event.target.value)}
            placeholder="Caesar Cipher Practice"
          />

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <InputField
              label="Tags (comma separated)"
              value={formState.tagsText}
              onChange={(event) => updateChallengeField('tagsText', event.target.value)}
              placeholder="strings, cipher, practice"
            />

            <div>
              <label className="form-label" htmlFor="visibility-select">Visibility</label>
              <select
                id="visibility-select"
                className="form-select"
                value={formState.visibility}
                onChange={(event) => updateChallengeField('visibility', event.target.value)}
              >
                <option value="unlisted">unlisted</option>
                <option value="public">public</option>
                <option value="private">private</option>
              </select>
            </div>
          </div>

          <div className="mt-3">
            <label className="form-label" htmlFor="challenge-markdown">Challenge Description / Instructions</label>
            <textarea
              id="challenge-markdown"
              className="form-input min-h-[120px]"
              value={formState.markdown}
              onChange={(event) => updateChallengeField('markdown', event.target.value)}
            />
          </div>
        </section>

        {error && <Alert>{error}</Alert>}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_430px]">
          <section className="compiler-card p-4 lg:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title">Questions and Test Cases</h2>
              <Button type="button" variant="secondary" onClick={addQuestion}>
                <FiPlus className="h-4 w-4" />
                Add Question
              </Button>
            </div>

            <div className="space-y-4">
              {formState.questions.map((question, questionIndex) => (
                <article key={`question-${questionIndex}`} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-slate-800">Question {questionIndex + 1}</p>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                      onClick={() => removeQuestion(questionIndex)}
                    >
                      <FiTrash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <div className="lg:col-span-2">
                      <InputField
                        label="Question Title"
                        value={question.title}
                        onChange={(event) => updateQuestionField(questionIndex, 'title', event.target.value)}
                      />
                    </div>

                    <InputField
                      label="Score"
                      type="number"
                      min="1"
                      value={question.score}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        updateQuestionField(
                          questionIndex,
                          'score',
                          nextValue === '' ? '' : Number(nextValue)
                        );
                      }}
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div>
                      <label className="form-label" htmlFor={`difficulty-${questionIndex}`}>Difficulty</label>
                      <select
                        id={`difficulty-${questionIndex}`}
                        className="form-select"
                        value={question.difficultyLevel}
                        onChange={(event) => updateQuestionField(questionIndex, 'difficultyLevel', event.target.value)}
                      >
                        {DIFFICULTY_OPTIONS.map((difficulty) => (
                          <option key={difficulty} value={difficulty}>{difficulty}</option>
                        ))}
                      </select>
                    </div>

                    <label className="mt-7 inline-flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={question.ignoreCase}
                        onChange={(event) => updateQuestionField(questionIndex, 'ignoreCase', event.target.checked)}
                      />
                      Ignore case when checking output
                    </label>
                  </div>

                  <div className="mt-3">
                    <label className="form-label" htmlFor={`question-markdown-${questionIndex}`}>Question Statement</label>
                    <textarea
                      id={`question-markdown-${questionIndex}`}
                      className="form-input min-h-[110px]"
                      value={question.markdown}
                      onChange={(event) => updateQuestionField(questionIndex, 'markdown', event.target.value)}
                    />
                  </div>

                  <div className="mt-3">
                    <p className="form-label">Supported Languages</p>
                    <div className="flex flex-wrap gap-2">
                      {SUPPORTED_LANGUAGES.map((language) => {
                        const active = question.supportedLanguages.includes(language.id);

                        return (
                          <button
                            key={`${questionIndex}-${language.id}`}
                            type="button"
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${active ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-300 bg-white text-slate-600'}`}
                            onClick={() => toggleQuestionLanguage(questionIndex, language.id)}
                          >
                            {language.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-700">Test Cases</p>
                      <Button type="button" variant="secondary" onClick={() => addTestCase(questionIndex)}>
                        <FiPlus className="h-4 w-4" />
                        Add Case
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {question.validations.map((testCase, testCaseIndex) => (
                        <div key={`tc-${questionIndex}-${testCaseIndex}`} className="rounded-lg border border-slate-200 bg-white p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <InputField
                              label="Label"
                              className="flex-1"
                              value={testCase.label}
                              onChange={(event) => updateTestCase(questionIndex, testCaseIndex, 'label', event.target.value)}
                            />
                            <button
                              type="button"
                              className="mt-7 inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                              onClick={() => removeTestCase(questionIndex, testCaseIndex)}
                            >
                              <FiTrash2 className="h-3.5 w-3.5" />
                              Remove
                            </button>
                          </div>

                          <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
                            <div>
                              <label className="form-label">Input</label>
                              <textarea
                                className="form-input min-h-[80px] font-mono text-xs"
                                value={testCase.input}
                                onChange={(event) => updateTestCase(questionIndex, testCaseIndex, 'input', event.target.value)}
                              />
                            </div>
                            <div>
                              <label className="form-label">Expected Output</label>
                              <textarea
                                className="form-input min-h-[80px] font-mono text-xs"
                                value={testCase.output}
                                onChange={(event) => updateTestCase(questionIndex, testCaseIndex, 'output', event.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="app-page">
            <Card className="compiler-card">
              <Card.Header>
                <h3 className="section-title">Editable JSON Payload</h3>
                <p className="body-sm mt-1">Form and JSON are synced both ways automatically.</p>
              </Card.Header>
              <Card.Body>
                <textarea
                  className="form-input min-h-[420px] font-mono text-xs"
                  value={jsonInput}
                  onChange={(event) => handleJsonInputChange(event.target.value)}
                  onFocus={() => setIsEditingJson(true)}
                  onBlur={handleJsonEditorBlur}
                  spellCheck={false}
                  placeholder="Paste payload JSON here"
                />

                {jsonError && <Alert className="mt-2">{jsonError}</Alert>}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" onClick={createChallenge} disabled={submitting}>
                    <FiSend className="h-4 w-4" />
                    {submitting
                      ? (sourceChallengeId ? 'Saving...' : 'Creating...')
                      : (sourceChallengeId ? 'Save Challenge' : 'Create Challenge')}
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </section>
        </div>

        {result && (
          <section className="compiler-card p-4 lg:p-5">
            <h2 className="section-title">Challenge API Response</h2>
            <p className="mt-1 text-sm text-slate-500">View or continue editing this challenge from here.</p>

            {challengeId ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Challenge ID</p>
                <p className="font-mono text-sm text-slate-800 break-all">{challengeId}</p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Link to={runnerPath} className="btn btn-primary">
                    <FiPlayCircle className="h-4 w-4" />
                    View Challenge
                  </Link>
                  <Link
                    to={editPath}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
                    title="Edit challenge"
                    aria-label="Edit challenge"
                  >
                    <FiEdit3 className="h-[18px] w-[18px]" />
                  </Link>
                </div>
              </div>
            ) : (
              <Alert>Challenge ID not detected automatically. Check raw response below.</Alert>
            )}

            <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Raw Response JSON</summary>
              <pre className="mt-3 max-h-[300px] overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </section>
        )}
      </main>
    </div>
  );
};

export default ChallengeCreator;
