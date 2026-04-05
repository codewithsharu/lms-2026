import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiEdit3, FiPlayCircle, FiPlus, FiRefreshCcw, FiSearch, FiTrash2 } from 'react-icons/fi';
import Button from '../../components/ui/Button';
import InputField from '../../components/ui/InputField';
import Alert from '../../components/ui/Alert';
import Modal from '../../components/ui/Modal';
import { compilerAPI } from '../../services/api';
import CompilerTopBar from './CompilerTopBar';
import { buildCompilerPath, isTeacherCompilerPath } from './routePaths';

const ChallengeBrowser = () => {
  const location = useLocation();
  const isPortalMode = isTeacherCompilerPath(location.pathname);
  const [searchText, setSearchText] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [challenges, setChallenges] = useState([]);
  const [deletingChallengeIds, setDeletingChallengeIds] = useState([]);
  const [pendingDeleteChallenge, setPendingDeleteChallenge] = useState(null);

  const fetchChallenges = async (queryText = '') => {
    try {
      setLoading(true);
      setError('');

      const response = await compilerAPI.listChallenges({
        q: queryText || undefined,
        limit: 100
      });

      setChallenges(Array.isArray(response.data?.challenges) ? response.data.challenges : []);
    } catch (fetchError) {
      const message = fetchError.response?.data?.error || 'Failed to load challenges';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChallenges('');
  }, []);

  const handleSearch = () => {
    const normalized = searchText.trim();
    setActiveSearch(normalized);
    fetchChallenges(normalized);
  };

  const openDeleteChallengeModal = (challengeId, challengeTitle) => {
    setPendingDeleteChallenge({
      challengeId,
      challengeTitle: challengeTitle || challengeId
    });
  };

  const closeDeleteChallengeModal = () => {
    if (!pendingDeleteChallenge) {
      return;
    }

    const isDeleting = deletingChallengeIds.includes(pendingDeleteChallenge.challengeId);
    if (isDeleting) {
      return;
    }

    setPendingDeleteChallenge(null);
  };

  const handleConfirmDeleteChallenge = async () => {
    if (!pendingDeleteChallenge?.challengeId) {
      return;
    }

    const challengeId = pendingDeleteChallenge.challengeId;

    try {
      setDeletingChallengeIds((prev) => (prev.includes(challengeId) ? prev : [...prev, challengeId]));
      await compilerAPI.deleteChallenge(challengeId);
      setChallenges((prev) => prev.filter((entry) => entry.id !== challengeId));
      setPendingDeleteChallenge(null);
      toast.success('Challenge deleted successfully');
    } catch (deleteError) {
      const message = deleteError.response?.data?.error || 'Failed to delete challenge';
      toast.error(message);
    } finally {
      setDeletingChallengeIds((prev) => prev.filter((entry) => entry !== challengeId));
    }
  };

  const challengeCountLabel = useMemo(() => {
    const count = challenges.length;
    if (count === 1) return '1 challenge';
    return `${count} challenges`;
  }, [challenges]);

  const createPath = useMemo(
    () => buildCompilerPath(location.pathname, '/new'),
    [location.pathname]
  );

  const headerActions = (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" onClick={() => fetchChallenges(activeSearch)} disabled={loading}>
        <FiRefreshCcw className="h-4 w-4" />
        Refresh
      </Button>
      <Link to={createPath} className="btn btn-primary">
        <FiPlus className="h-4 w-4" />
        Create Challenge
      </Link>
    </div>
  );

  return (
    <div className={isPortalMode ? 'portal-compiler' : 'compiler-shell'}>
      {isPortalMode ? (
        <div className="page-header mb-3 flex flex-col gap-4 lg:mb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1>Challenge Browser</h1>
            <p>View, edit, and run all API-owned challenges in one place.</p>
          </div>
          {headerActions}
        </div>
      ) : (
        <CompilerTopBar
          title="Challenge Browser"
          subtitle="View, edit, and run all API-owned challenges in one place."
          rightNode={headerActions}
        />
      )}

      <main className={isPortalMode ? 'app-page' : 'compiler-main app-page'}>
        <section className="compiler-card p-4 lg:p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
            <InputField
              label="Search by title, id or tag"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleSearch();
                }
              }}
              placeholder="sum, palindrome, 44jd..."
            />

            <div className="md:pt-7">
              <Button type="button" onClick={handleSearch} disabled={loading}>
                <FiSearch className="h-4 w-4" />
                Search
              </Button>
            </div>
          </div>

          <div className="mt-3 text-sm text-slate-500">Showing {challengeCountLabel}</div>
        </section>

        {error && <Alert>{error}</Alert>}

        <section className="compiler-card overflow-hidden">
          <div className="compiler-panel-head">
            <h2 className="section-title">Available Challenges</h2>
          </div>

          <div className="compiler-panel-body">
            {loading && <p className="text-sm text-slate-500">Loading challenge list...</p>}

            {!loading && challenges.length === 0 && (
              <p className="text-sm text-slate-500">No challenges found yet. Use Create Challenge to add one.</p>
            )}

            {!loading && challenges.length > 0 && (
              <div className="space-y-3">
                {challenges.map((item) => {
                  const challengeId = item.id;
                  const deleting = deletingChallengeIds.includes(challengeId);
                  const runPath = buildCompilerPath(
                    location.pathname,
                    `/run/${encodeURIComponent(challengeId)}`
                  );
                  const editPath = buildCompilerPath(
                    location.pathname,
                    `/new?sourceChallengeId=${encodeURIComponent(challengeId)}`
                  );

                  return (
                    <article key={challengeId} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <h3 className="text-base font-semibold text-slate-800">{item.title || 'Untitled Challenge'}</h3>
                          <p className="mt-1 text-xs text-slate-500">ID: {challengeId}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(item.tags || []).length > 0 ? (
                              item.tags.map((tag) => (
                                <span key={`${challengeId}-${tag}`} className="status-badge info">{tag}</span>
                              ))
                            ) : (
                              <span className="status-badge warning">No tags</span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Link to={runPath} className="btn btn-primary">
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
                          <button
                            type="button"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-rose-300 bg-white text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => openDeleteChallengeModal(challengeId, item.title)}
                            disabled={deleting}
                            title={deleting ? 'Deleting challenge...' : 'Delete challenge'}
                            aria-label={deleting ? 'Deleting challenge' : 'Delete challenge'}
                          >
                            <FiTrash2 className={`h-[18px] w-[18px] ${deleting ? 'animate-pulse' : ''}`} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>

      <Modal
        open={Boolean(pendingDeleteChallenge)}
        onClose={closeDeleteChallengeModal}
        title="Delete Challenge"
        subtitle="This action cannot be undone."
        footer={(
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={closeDeleteChallengeModal}
              disabled={pendingDeleteChallenge ? deletingChallengeIds.includes(pendingDeleteChallenge.challengeId) : false}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleConfirmDeleteChallenge}
              disabled={pendingDeleteChallenge ? deletingChallengeIds.includes(pendingDeleteChallenge.challengeId) : false}
            >
              {pendingDeleteChallenge && deletingChallengeIds.includes(pendingDeleteChallenge.challengeId)
                ? 'Deleting...'
                : 'Delete'}
            </Button>
          </div>
        )}
      >
        <p className="text-sm text-slate-700">
          Delete challenge <span className="font-semibold">"{pendingDeleteChallenge?.challengeTitle || ''}"</span>?
        </p>
      </Modal>
    </div>
  );
};

export default ChallengeBrowser;
