import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Editor from '@monaco-editor/react';
import {
  FiCheckCircle,
  FiXCircle,
  FiPlay,
  FiRotateCcw,
  FiMoon,
  FiMaximize2,
  FiChevronLeft,
  FiChevronRight,
  FiGrid
} from 'react-icons/fi';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import { compilerAPI } from '../../services/api';
import CompilerTopBar from './CompilerTopBar';
import { DEFAULT_CODE_BY_LANGUAGE, SUPPORTED_LANGUAGES } from './challengePresets';

const languageMap = SUPPORTED_LANGUAGES.reduce((acc, item) => {
  acc[item.id] = item;
  return acc;
}, {});

const toStringValue = (value) => String(value ?? '');

const firstTruthyString = (values = []) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
};

const normalizeProblemList = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (Array.isArray(payload.problems)) {
    return payload.problems;
  }

  if (Array.isArray(payload.challenge?.problems)) {
    return payload.challenge.problems;
  }

  return [];
};

const normalizeBatchResponse = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.value)) {
    return payload.value;
  }

  if (Array.isArray(payload?.results)) {
    return payload.results;
  }

  if (payload && typeof payload === 'object') {
    return [payload];
  }

  return [];
};

const extractRunStdout = (payload) => toStringValue(
  payload?.stdout ?? payload?.output ?? payload?.result?.stdout ?? payload?.result?.output
);

const extractRunError = (payload) => firstTruthyString([
  payload?.stderr,
  payload?.exception,
  payload?.error,
  payload?.message,
  payload?.result?.stderr,
  payload?.result?.exception
]);

const normalizeForComparison = (text, ignoreCase) => {
  let normalized = toStringValue(text).replace(/\r\n/g, '\n').trim();
  if (ignoreCase) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
};

const buildCaseResult = ({ testCase, execution, ignoreCase }) => {
  const stdout = extractRunStdout(execution);
  const stderr = extractRunError(execution);
  const normalizedActual = normalizeForComparison(stdout, ignoreCase);
  const normalizedExpected = normalizeForComparison(testCase.output, ignoreCase);
  const passed = !stderr && normalizedActual === normalizedExpected;

  return {
    testCase,
    passed,
    stdout,
    stderr,
    expected: testCase.output,
    executionTime: execution?.executionTime ?? null
  };
};

const parseExecutionMs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const matched = value.match(/[\d.]+/);
    if (matched) {
      const parsed = Number(matched[0]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const compilerVersionByLanguage = {
  python: 'Python 3.11',
  java: 'Java 17',
  c: 'GCC 11.2',
  cpp: 'G++ 11.2'
};

const toastIds = {
  challengeLoaded: 'challenge-loaded',
  challengeLoadFailed: 'challenge-load-failed',
  compileVerdict: 'compile-verdict',
  submitVerdict: 'submit-verdict'
};

const smoothScrollTo = (ref) => {
  if (!ref?.current) {
    return;
  }

  window.requestAnimationFrame(() => {
    ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
};

const ChallengeRunner = () => {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const initialChallengeId = params.challengeId || searchParams.get('challengeId') || '';

  const [challengeData, setChallengeData] = useState(null);
  const [challengeError, setChallengeError] = useState('');

  const [selectedProblemIndex, setSelectedProblemIndex] = useState(0);
  const [language, setLanguage] = useState('python');
  const [codeByQuestionLanguage, setCodeByQuestionLanguage] = useState({});

  const [runningCompile, setRunningCompile] = useState(false);
  const [compileState, setCompileState] = useState('idle');
  const [compileErrorDetails, setCompileErrorDetails] = useState('');

  const [runningCustom, setRunningCustom] = useState(false);
  const [useCustomInput, setUseCustomInput] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [customRunError, setCustomRunError] = useState('');
  const [customRunOutput, setCustomRunOutput] = useState('');

  const [runningTestCases, setRunningTestCases] = useState(false);
  const [testCaseError, setTestCaseError] = useState('');
  const [testCaseResults, setTestCaseResults] = useState([]);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState(null);
  const [testPanelView, setTestPanelView] = useState('testcase');
  const [attemptedQuestionIndexes, setAttemptedQuestionIndexes] = useState([]);

  const [leftPanePercent, setLeftPanePercent] = useState(36);
  const [isResizing, setIsResizing] = useState(false);
  const [editorTheme, setEditorTheme] = useState('vs-dark');
  const [isEditorExpanded, setIsEditorExpanded] = useState(false);
  const [showQuestionPalette, setShowQuestionPalette] = useState(false);

  const layoutRef = useRef(null);
  const submissionResultRef = useRef(null);
  const editorRef = useRef(null);

  const challengeMeta = useMemo(() => {
    const challenge = challengeData?.challenge || {};

    return {
      id: toStringValue(challenge?._id || challengeData?.challengeId || challengeData?.id || ''),
      title: toStringValue(challenge?.title || challengeData?.title || 'Untitled Challenge'),
      statement: toStringValue(challenge?.markdown || challengeData?.markdown || ''),
      slug: toStringValue(challenge?.link || challenge?.slug || ''),
      tags: Array.isArray(challenge?.tags) ? challenge.tags.map((tag) => toStringValue(tag)).filter(Boolean) : []
    };
  }, [challengeData]);

  const problems = useMemo(() => normalizeProblemList(challengeData), [challengeData]);

  const currentProblem = useMemo(() => {
    if (problems.length === 0) return null;
    return problems[selectedProblemIndex] || problems[0] || null;
  }, [problems, selectedProblemIndex]);

  const currentQuestionNumber = problems.length > 0 ? selectedProblemIndex + 1 : 0;
  const attemptedCount = attemptedQuestionIndexes.length;
  const isAttemptedComplete = problems.length > 0 && attemptedCount === problems.length;

  const currentQuestionStatement = useMemo(() => {
    if (!currentProblem) return '';
    return toStringValue(currentProblem.markdown || currentProblem.description || challengeMeta.statement || '');
  }, [currentProblem, challengeMeta.statement]);

  const testCases = useMemo(() => {
    const validations = currentProblem?.properties?.options?.code?.validations;
    if (!Array.isArray(validations)) {
      return [];
    }

    return validations.map((item, index) => ({
      id: Number(item?.id || index + 1),
      label: toStringValue(item?.label || `case-${index + 1}`),
      input: toStringValue(item?.input || ''),
      output: toStringValue(item?.output || '')
    }));
  }, [currentProblem]);

  const sampleCase = useMemo(() => testCases[0] || null, [testCases]);

  const ignoreCase = currentProblem?.properties?.options?.code?.ignoreCase !== false;

  const supportedLanguages = useMemo(() => {
    const fromProblem = currentProblem?.properties?.options?.code?.supportedLanguages;
    if (Array.isArray(fromProblem) && fromProblem.length > 0) {
      return fromProblem
        .map((entry) => toStringValue(entry))
        .filter((entry) => languageMap[entry]);
    }

    return ['python', 'java', 'c', 'cpp'];
  }, [currentProblem]);

  const evaluatedTestCases = useMemo(() => {
    if (!sampleCase) {
      return testCases;
    }

    return testCases.filter((entry) => entry.id !== sampleCase.id);
  }, [testCases, sampleCase]);

  const evaluatedTestCaseResults = useMemo(() => {
    if (!sampleCase) {
      return testCaseResults;
    }

    return testCaseResults.filter((entry) => entry.testCase.id !== sampleCase.id);
  }, [testCaseResults, sampleCase]);

  const resultByCaseId = useMemo(() => {
    return new Map(evaluatedTestCaseResults.map((entry) => [entry.testCase.id, entry]));
  }, [evaluatedTestCaseResults]);

  const selectedTestCase = useMemo(() => {
    if (!evaluatedTestCases.length) {
      return null;
    }

    return evaluatedTestCases.find((entry) => entry.id === selectedTestCaseId) || evaluatedTestCases[0];
  }, [evaluatedTestCases, selectedTestCaseId]);

  const selectedTestCaseResult = useMemo(() => {
    if (!selectedTestCase) {
      return null;
    }

    return resultByCaseId.get(selectedTestCase.id) || null;
  }, [selectedTestCase, resultByCaseId]);

  const failCount = useMemo(
    () => evaluatedTestCaseResults.filter((entry) => !entry.passed).length,
    [evaluatedTestCaseResults]
  );
  const hasSubmitted = evaluatedTestCaseResults.length > 0;
  const hasAnyTestCaseResult = testCaseResults.length > 0;
  const allPassed = hasSubmitted && failCount === 0;
  const isTestPanelUnlocked = hasAnyTestCaseResult;

  useEffect(() => {
    if (supportedLanguages.length === 0) {
      setLanguage('python');
      return;
    }

    if (!supportedLanguages.includes(language)) {
      setLanguage(supportedLanguages[0]);
    }
  }, [supportedLanguages, language]);

  useEffect(() => {
    setTestCaseResults([]);
    setSelectedTestCaseId(null);
    setTestPanelView('testcase');
    setCompileState('idle');
    setCompileErrorDetails('');
    setUseCustomInput(false);
    setCustomInput('');
    setCustomRunOutput('');
    setCustomRunError('');
    setTestCaseError('');
  }, [currentProblem, testCases.length]);

  useEffect(() => {
    if (!evaluatedTestCases.length) {
      setSelectedTestCaseId(null);
      return;
    }

    if (!evaluatedTestCases.some((entry) => entry.id === selectedTestCaseId)) {
      setSelectedTestCaseId(evaluatedTestCases[0].id);
    }
  }, [evaluatedTestCases, selectedTestCaseId]);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    const handlePointerMove = (event) => {
      if (!layoutRef.current) {
        return;
      }

      const rect = layoutRef.current.getBoundingClientRect();
      if (!rect.width) {
        return;
      }

      const relative = ((event.clientX - rect.left) / rect.width) * 100;
      setLeftPanePercent(clamp(relative, 24, 58));
    };

    const stopResize = () => setIsResizing(false);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
    };
  }, [isResizing]);

  const fileName = useMemo(() => {
    const extension = languageMap[language]?.extension || 'txt';
    return `main.${extension}`;
  }, [language]);

  const challengeStorageKey = useMemo(() => {
    const fromPayload = toStringValue(challengeMeta.id);
    const fromRoute = toStringValue(initialChallengeId);
    return fromPayload || fromRoute || 'challenge';
  }, [challengeMeta.id, initialChallengeId]);

  const currentQuestionStorageKey = useMemo(() => {
    if (!currentProblem) {
      return `q-${selectedProblemIndex}`;
    }

    return toStringValue(currentProblem._id || currentProblem.id || currentProblem.link || `q-${selectedProblemIndex}`);
  }, [currentProblem, selectedProblemIndex]);

  const activeCodeKey = `${challengeStorageKey}::${currentQuestionStorageKey}::${language}`;
  const activeCode = codeByQuestionLanguage[activeCodeKey] || DEFAULT_CODE_BY_LANGUAGE[language] || '';
  const activeCompilerLabel = compilerVersionByLanguage[language] || (languageMap[language]?.label || language);

  const handleEditorUndo = () => {
    if (!editorRef.current) {
      toast.error('Editor is not ready yet');
      return;
    }

    editorRef.current.trigger('keyboard', 'undo', null);
  };

  const handleThemeToggle = () => {
    setEditorTheme((prev) => (prev === 'vs' ? 'vs-dark' : 'vs'));
  };

  const markCurrentQuestionAttempted = () => {
    if (!problems.length) {
      return;
    }

    setAttemptedQuestionIndexes((prev) => {
      if (prev.includes(selectedProblemIndex)) {
        return prev;
      }

      return [...prev, selectedProblemIndex];
    });
  };

  const jumpToQuestion = (index) => {
    if (!problems.length) {
      return;
    }

    setSelectedProblemIndex(clamp(index, 0, problems.length - 1));
  };

  const moveQuestion = (offset) => {
    if (!problems.length) {
      return;
    }

    setSelectedProblemIndex((prev) => clamp(prev + offset, 0, problems.length - 1));
  };

  const loadChallenge = async (providedChallengeId = '') => {
    const challengeId = toStringValue(providedChallengeId).trim();

    if (!challengeId) {
      setChallengeError('Challenge ID is required in route');
      return;
    }

    try {
      setChallengeError('');
      const response = await compilerAPI.getChallenge(challengeId);
      const payload = response.data;
      setChallengeData(payload);
      setSelectedProblemIndex(0);
      setCodeByQuestionLanguage({});
      setTestCaseResults([]);
      setSelectedTestCaseId(null);
      setTestPanelView('testcase');
      setAttemptedQuestionIndexes([]);
      setCompileState('idle');
      setCompileErrorDetails('');
      setUseCustomInput(false);
      setCustomInput('');
      setCustomRunOutput('');
      setCustomRunError('');
      setTestCaseError('');
      toast.success('Challenge loaded', { id: `${toastIds.challengeLoaded}-${challengeId}` });
    } catch (error) {
      const message = error.response?.data?.error || 'Failed to load challenge';
      setChallengeError(message);
      setChallengeData(null);
      setCodeByQuestionLanguage({});
      setAttemptedQuestionIndexes([]);
      toast.error(message, { id: `${toastIds.challengeLoadFailed}-${challengeId || 'unknown'}` });
    }
  };

  useEffect(() => {
    if (!initialChallengeId) {
      return;
    }

    loadChallenge(initialChallengeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChallengeId]);

  const runCustomCode = async () => {
    if (!currentProblem) {
      setCustomRunError('Load a challenge first');
      setCompileState('failed');
      setCompileErrorDetails('Load a challenge first');
      return;
    }

    if (!activeCode.trim()) {
      setCustomRunError('Code is required');
      setCompileState('failed');
      setCompileErrorDetails('Code is required');
      return;
    }

    try {
      setRunningCustom(true);
      setCustomRunError('');

      const response = await compilerAPI.runCode({
        language,
        fileName,
        code: activeCode,
        stdin: customInput
      });

      const row = normalizeBatchResponse(response.data)[0] || {};
      const stdout = extractRunStdout(row);
      const stderr = extractRunError(row);

      setCustomRunOutput(stderr ? stderr : (stdout || '(no output)'));
      if (stderr) {
        setCompileState('failed');
        setCompileErrorDetails(stderr);
        setTestCaseResults([]);
        setTestCaseError('Compilation failed. Fix errors before viewing testcase results.');
        toast.error('Compilation failed');
      } else {
        setCompileState('success');
        setCompileErrorDetails('');
        setTestCaseError('');
        toast.success('Compiled and tested');
      }
    } catch (error) {
      const message = error.response?.data?.error || 'Failed to run custom input';
      setCompileState('failed');
      setCompileErrorDetails(message);
      setCustomRunError(message);
      setCustomRunOutput('');
      setTestCaseResults([]);
      toast.error(message);
    } finally {
      setRunningCustom(false);
    }
  };

  const runAgainstAllTestCases = async () => {
    const response = await compilerAPI.runCode({
      language,
      fileName,
      code: activeCode,
      stdin: testCases.map((item) => item.input)
    });

    const rows = normalizeBatchResponse(response.data);
    return testCases.map((testCase, index) => buildCaseResult({
      testCase,
      execution: rows[index] || {},
      ignoreCase
    }));
  };

  const runCompileCheck = async () => {
    if (testCases.length === 0) {
      setCompileState('failed');
      setCompileErrorDetails('No test cases found for this question');
      return;
    }

    if (!activeCode.trim()) {
      setCompileState('failed');
      setCompileErrorDetails('Code is required');
      return;
    }

    try {
      setRunningCompile(true);
      setTestCaseError('');
      setCompileState('idle');
      setCompileErrorDetails('');

      const mappedResults = await runAgainstAllTestCases();

      const errorEntry = mappedResults.find((entry) => entry.stderr);
      if (errorEntry) {
        setCompileState('failed');
        setCompileErrorDetails(errorEntry.stderr || 'Compilation failed');
        setTestCaseResults([]);
        setTestCaseError('Compilation failed. Fix errors before viewing testcase results.');
        toast.error('Compilation failed');
      } else {
        setCompileState('success');
        setCompileErrorDetails('');
        setTestCaseError('');
        setTestCaseResults(mappedResults);
        setTestPanelView('result');

        const consideredResults = sampleCase
          ? mappedResults.filter((entry) => entry.testCase.id !== sampleCase.id)
          : mappedResults;
        const passed = consideredResults.filter((entry) => entry.passed).length;

        if (consideredResults.length === 0 || passed === consideredResults.length) {
          toast.success('Compiled. All test cases passed.', { id: toastIds.compileVerdict });
        } else {
          toast.error('Compiled, but some test cases failed.', { id: toastIds.compileVerdict });
        }
      }

      smoothScrollTo(submissionResultRef);
    } catch (error) {
      const message = error.response?.data?.error || 'Compilation failed';
      setCompileState('failed');
      setCompileErrorDetails(message);
      setTestCaseResults([]);
      toast.error(message);
    } finally {
      setRunningCompile(false);
    }
  };

  const runCompileAndTest = async () => {
    markCurrentQuestionAttempted();

    if (useCustomInput) {
      setCompileState('idle');
      setCompileErrorDetails('');
      setTestCaseError('');
      setTestCaseResults([]);
      await runCustomCode();
      return;
    }

    await runCompileCheck();
  };

  const runAllTestCases = async () => {
    markCurrentQuestionAttempted();

    if (compileState !== 'success') {
      setTestPanelView('testcase');
      toast.error('Compile code first to unlock testcases');
      smoothScrollTo(submissionResultRef);
      return;
    }

    if (testCases.length === 0) {
      setTestCaseError('No test cases found for this question');
      return;
    }

    if (!activeCode.trim()) {
      setTestCaseError('Code is required');
      return;
    }

    try {
      setRunningTestCases(true);
      setTestCaseError('');

      const mappedResults = await runAgainstAllTestCases();

      const errorEntry = mappedResults.find((entry) => entry.stderr);
      if (errorEntry) {
        setCompileState('failed');
        setCompileErrorDetails(errorEntry.stderr || 'Compilation failed');
        setTestCaseResults([]);
        setTestCaseError('Compilation failed. Fix errors before viewing testcase results.');
        toast.error('Compilation failed');
        smoothScrollTo(submissionResultRef);
        return;
      }

      setCompileState('success');
      setCompileErrorDetails('');

      setTestCaseResults(mappedResults);
      setTestPanelView('result');
      const consideredResults = sampleCase
        ? mappedResults.filter((entry) => entry.testCase.id !== sampleCase.id)
        : mappedResults;
      const passed = consideredResults.filter((entry) => entry.passed).length;
      if (consideredResults.length === 0 || passed === consideredResults.length) {
        toast.success('Accepted', { id: toastIds.submitVerdict });
      } else {
        toast.error('Wrong Answer', { id: toastIds.submitVerdict });
      }
      smoothScrollTo(submissionResultRef);
    } catch (error) {
      const message = error.response?.data?.error || 'Failed to run test cases';
      setTestCaseError(message);
      setTestCaseResults([]);
      toast.error(message);
    } finally {
      setRunningTestCases(false);
    }
  };

  return (
    <div className="compiler-shell">
      <CompilerTopBar
        title="Exam Runner"
        subtitle="Interactive exam workspace with hidden tests and simple custom runner."
      />

      <main className="compiler-main compiler-main-wide app-page">
        {challengeError && <Alert className="mb-3">{challengeError}</Alert>}

        <div
          className={`runner-layout ${isResizing ? 'resizing' : ''}`}
          ref={layoutRef}
          style={{ '--runner-left': `${leftPanePercent}%` }}
        >
          <section className="compiler-card runner-pane">
            <div className="compiler-panel-head">
              <div>
                <h2 className="section-title">Problem Statement</h2>
                <p className="body-sm mt-1">Use the splitter to resize this pane when the question is long.</p>
              </div>
            </div>

            <div className="compiler-panel-body runner-pane-scroll">
              {problems.length > 0 ? (
                <>
                  <div className="runner-question-meta">
                    <span className="runner-question-meta-pill">
                      Question {currentQuestionNumber} of {problems.length}
                    </span>
                    <p className="runner-question-meta-title">{currentProblem?.title || 'Untitled Question'}</p>
                  </div>

                  <article className="runner-question-card mt-3">
                    <h3>{currentProblem?.title || 'Untitled Question'}</h3>
                    <p className="runner-question-text">{currentQuestionStatement || 'No statement available.'}</p>
                    <div className="runner-tag-row">
                      {(challengeMeta.tags || []).length > 0 ? (
                        challengeMeta.tags.map((tag) => (
                          <span key={tag} className="runner-tag">{tag}</span>
                        ))
                      ) : (
                        <span className="runner-tag muted">No tags</span>
                      )}
                    </div>
                  </article>

                  <article className="runner-case-card pending mt-3">
                    <p className="runner-field-label mt-0">Sample Input</p>
                    <pre className="compiler-inline-code runner-field-block">{sampleCase?.input || '(not available)'}</pre>

                    <p className="runner-field-label">Sample Output</p>
                    <pre className="compiler-inline-code runner-field-block expected">{sampleCase?.output || '(not available)'}</pre>
                  </article>

                </>
              ) : (
                <p className="text-sm text-slate-500">Load a challenge to view the problem statement.</p>
              )}
            </div>
          </section>

          <button
            type="button"
            className="runner-splitter"
            aria-label="Resize question and editor panels"
            title="Drag to resize question panel"
            onPointerDown={(event) => {
              event.preventDefault();
              setIsResizing(true);
            }}
          />

          <section className="compiler-card runner-pane">
            <div className="compiler-panel-body runner-editor-body">
              {problems.length > 0 && (
                <section className="runner-question-nav" aria-label="Question navigation">
                  <div className="runner-question-nav-main">
                    <button
                      type="button"
                      className="runner-question-nav-btn"
                      onClick={() => moveQuestion(-1)}
                      disabled={selectedProblemIndex === 0}
                      aria-label="Previous question"
                      title="Previous question"
                    >
                      <FiChevronLeft className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      className="runner-question-nav-current"
                      onClick={() => setShowQuestionPalette((prev) => !prev)}
                      title={currentProblem?.title || `Question ${currentQuestionNumber}`}
                    >
                      {currentQuestionNumber}
                    </button>

                    <button
                      type="button"
                      className="runner-question-nav-btn"
                      onClick={() => moveQuestion(1)}
                      disabled={selectedProblemIndex >= problems.length - 1}
                      aria-label="Next question"
                      title="Next question"
                    >
                      <FiChevronRight className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      className={`runner-question-nav-btn ${showQuestionPalette ? 'active' : ''}`}
                      onClick={() => setShowQuestionPalette((prev) => !prev)}
                      aria-label="Toggle question list"
                      title="Toggle question list"
                    >
                      <FiGrid className="h-4 w-4" />
                    </button>

                    <p className={`runner-question-nav-progress ${isAttemptedComplete ? 'is-complete' : 'is-incomplete'}`}>
                      Attempted: {attemptedCount}/{problems.length}
                    </p>

                    <button
                      type="button"
                      className="runner-question-nav-finish"
                    >
                      Finish test
                    </button>
                  </div>

                  {showQuestionPalette && (
                    <div className="runner-question-nav-strip">
                      {problems.map((problem, index) => (
                        <button
                          key={problem?._id || `question-chip-${index}`}
                          type="button"
                          className={`runner-question-nav-chip ${index === selectedProblemIndex ? 'active' : ''}`}
                          onClick={() => {
                            jumpToQuestion(index);
                            setShowQuestionPalette(false);
                          }}
                          title={problem?.title || `Question ${index + 1}`}
                        >
                          Q{index + 1}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}

              <section className={`runner-ide-shell ${isEditorExpanded ? 'expanded' : ''}`}>
                <div className="runner-ide-topbar">
                  <div className="runner-ide-meta">
                    <select
                      className="runner-ide-language"
                      value={language}
                      onChange={(event) => setLanguage(event.target.value)}
                    >
                      {supportedLanguages.map((languageId) => (
                        <option key={languageId} value={languageId}>
                          {languageMap[languageId]?.label || languageId}
                        </option>
                      ))}
                    </select>
                    <p className="runner-ide-compiler">Compiler: {activeCompilerLabel}</p>
                  </div>

                  <div className="runner-ide-tools">
                    <button
                      type="button"
                      className="runner-ide-tool-btn"
                      title="Undo"
                      onClick={handleEditorUndo}
                    >
                      <FiRotateCcw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className={`runner-ide-tool-btn ${editorTheme !== 'vs' ? 'active' : ''}`}
                      title={editorTheme === 'vs' ? 'Switch to dark mode' : 'Switch to light mode'}
                      onClick={handleThemeToggle}
                    >
                      <FiMoon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className={`runner-ide-tool-btn ${isEditorExpanded ? 'active' : ''}`}
                      title={isEditorExpanded ? 'Restore editor size' : 'Expand editor'}
                      onClick={() => setIsEditorExpanded((prev) => !prev)}
                    >
                      <FiMaximize2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="compiler-editor-shell runner-editor-shell-lg runner-ide-editor">
                  <Editor
                    height={isEditorExpanded ? '72vh' : '50vh'}
                    language={languageMap[language]?.monaco || 'python'}
                    theme={editorTheme}
                    value={activeCode}
                    onMount={(editorInstance) => {
                      editorRef.current = editorInstance;
                    }}
                    onChange={(value) => {
                      setCodeByQuestionLanguage((prev) => ({
                        ...prev,
                        [activeCodeKey]: toStringValue(value)
                      }));
                    }}
                    options={{
                      fontSize: 14,
                      minimap: { enabled: false },
                      scrollbar: {
                        alwaysConsumeMouseWheel: false
                      },
                      tabSize: 2,
                      automaticLayout: true,
                      wordWrap: 'off',
                      lineNumbersMinChars: 3,
                      smoothScrolling: true,
                      cursorBlinking: 'smooth'
                    }}
                  />
                </div>

                <div className="runner-ide-footer">
                  <label className="runner-ide-custom-toggle">
                    <input
                      type="checkbox"
                      checked={useCustomInput}
                      onChange={(event) => setUseCustomInput(event.target.checked)}
                    />
                    Use Custom Input
                  </label>

                  <div className="runner-ide-footer-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={runCompileAndTest}
                      disabled={(runningCompile || runningCustom) || !currentProblem}
                    >
                      <FiPlay className="h-4 w-4" />
                      {(runningCompile || runningCustom) ? 'Compiling...' : 'Compile and Test'}
                    </Button>

                    <Button
                      type="button"
                      onClick={runAllTestCases}
                      disabled={runningTestCases || !currentProblem || compileState !== 'success'}
                    >
                      <FiCheckCircle className="h-4 w-4" />
                      {runningTestCases ? 'Submitting...' : 'Submit Code'}
                    </Button>
                  </div>
                </div>
              </section>

              <section className="runner-compile-status-panel">
                <div className="runner-result-head">
                  <h3>Compilation Status</h3>
                  {compileState === 'success' && <span className="runner-compile-pill success">Compiled successfully</span>}
                  {compileState === 'failed' && <span className="runner-compile-pill fail">Compilation failed</span>}
                  {compileState === 'idle' && <span className="runner-compile-pill idle">Not checked</span>}
                </div>

                {compileState === 'success' && (
                  <p className="runner-compile-state-line success">
                    <FiCheckCircle className="h-4 w-4" />
                    Compiled successfully.
                  </p>
                )}

                {compileState === 'failed' && (
                  <>
                    <p className="runner-compile-state-line fail">
                      <FiXCircle className="h-4 w-4" />
                      Compilation failed.
                    </p>
                    <pre className="compiler-inline-code runner-compile-error">{compileErrorDetails || 'Compilation failed'}</pre>
                  </>
                )}

                {compileState === 'idle' && (
                  <p className="runner-compile-note">Click Compile to validate code before submitting.</p>
                )}
              </section>

              {useCustomInput && (
                <section className="runner-custom-inline">
                  <div className="runner-custom-inline-grid">
                    <article>
                      <p className="runner-field-label mt-0">Custom Input</p>
                      <textarea
                        className="form-input min-h-[130px] font-mono text-xs"
                        value={customInput}
                        onChange={(event) => setCustomInput(event.target.value)}
                        placeholder="Type custom input here"
                      />
                    </article>

                    <article>
                      <p className="runner-field-label mt-0">Custom Output</p>
                      <pre className="compiler-inline-code runner-console min-h-[130px]">
                        {customRunOutput || '(compile and test to see output)'}
                      </pre>
                    </article>
                  </div>
                  {customRunError && <Alert className="mt-2">{customRunError}</Alert>}
                </section>
              )}

              <section
                className={`runner-submit-panel runner-lc-testcase ${isTestPanelUnlocked ? '' : 'locked'}`}
                ref={submissionResultRef}
              >
                <div className="runner-lc-head">
                  <button
                    type="button"
                    className={`runner-lc-head-tab ${testPanelView === 'testcase' ? 'active' : ''}`}
                    onClick={() => setTestPanelView('testcase')}
                    disabled={!isTestPanelUnlocked}
                  >
                    Testcase
                  </button>

                  <span className="runner-lc-head-sep">&gt;</span>

                  <button
                    type="button"
                    className={`runner-lc-head-tab ${testPanelView === 'result' ? 'active' : ''}`}
                    onClick={() => setTestPanelView('result')}
                    disabled={!isTestPanelUnlocked || !hasSubmitted}
                  >
                    Test Result
                  </button>
                </div>

                {isTestPanelUnlocked && (
                  <>
                    <div className="runner-lc-case-tabs">
                      {evaluatedTestCases.length > 0 ? (
                        <>
                          {evaluatedTestCases.map((testCase, index) => {
                            const caseResult = resultByCaseId.get(testCase.id);
                            const caseStatus = caseResult ? (caseResult.passed ? 'pass' : 'fail') : 'pending';

                            return (
                              <button
                                key={`tc-${testCase.id}`}
                                type="button"
                                className={`runner-lc-case-tab ${selectedTestCase?.id === testCase.id ? 'active' : ''} ${caseStatus}`}
                                onClick={() => setSelectedTestCaseId(testCase.id)}
                              >
                                <span>Case {index + 1}</span>
                                {caseStatus === 'pass' && <FiCheckCircle className="runner-lc-case-mark pass" />}
                                {caseStatus === 'fail' && <FiXCircle className="runner-lc-case-mark fail" />}
                              </button>
                            );
                          })}
                        </>
                      ) : (
                        <p className="runner-lc-empty">Sample testcase is shown above. No hidden testcase found.</p>
                      )}
                    </div>

                    {testCaseError && <Alert className="mb-2">{testCaseError}</Alert>}

                    {hasSubmitted && (
                      <p className={`runner-lc-overall-line ${allPassed ? 'pass' : 'fail'}`}>
                        {allPassed
                          ? 'Accepted. All test cases passed.'
                          : `Wrong Answer. ${failCount} test case${failCount === 1 ? '' : 's'} failed.`}
                      </p>
                    )}

                    {testPanelView === 'testcase' ? (
                      selectedTestCase ? (
                        <div className="runner-lc-result-body">
                          <div className="runner-lc-result-grid">
                            <article className="runner-lc-field">
                              <p>expected output =</p>
                              <pre className="compiler-inline-code">{selectedTestCase.output || '(empty)'}</pre>
                            </article>

                            <article className="runner-lc-field">
                              <p>your output =</p>
                              <pre className="compiler-inline-code">
                                {selectedTestCaseResult
                                  ? (selectedTestCaseResult.stderr || selectedTestCaseResult.stdout || '(empty)')
                                  : '(run code to see output)'}
                              </pre>
                            </article>
                          </div>
                        </div>
                      ) : (
                        <p className="runner-lc-empty">Sample testcase is shown in question. Hidden testcase details appear here.</p>
                      )
                    ) : hasSubmitted && selectedTestCaseResult ? (
                      <div className="runner-lc-result-body">
                        <p className={`runner-lc-result-state ${selectedTestCaseResult.passed ? 'pass' : 'fail'}`}>
                          {selectedTestCaseResult.passed ? 'Accepted' : 'Failed'}
                          {' '}• Runtime {Math.round(parseExecutionMs(selectedTestCaseResult.executionTime))} ms
                        </p>

                        <div className="runner-lc-result-grid">
                          <article className="runner-lc-field">
                            <p>expected output =</p>
                            <pre className="compiler-inline-code">{selectedTestCaseResult.expected || '(empty)'}</pre>
                          </article>

                          <article className="runner-lc-field">
                            <p>your output =</p>
                            <pre className="compiler-inline-code">
                              {selectedTestCaseResult.stderr || selectedTestCaseResult.stdout || '(empty)'}
                            </pre>
                          </article>
                        </div>
                      </div>
                    ) : (
                      <p className="runner-lc-empty">Run Submit Code to see test result.</p>
                    )}
                  </>
                )}

              </section>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default ChallengeRunner;
