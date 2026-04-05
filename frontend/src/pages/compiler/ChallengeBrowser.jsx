import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiExternalLink, FiPlayCircle, FiRefreshCcw, FiSearch } from 'react-icons/fi';
import Button from '../../components/ui/Button';
import InputField from '../../components/ui/InputField';
import Alert from '../../components/ui/Alert';
import { compilerAPI } from '../../services/api';
import CompilerTopBar from './CompilerTopBar';

const ChallengeBrowser = () => {
  const [searchText, setSearchText] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [challenges, setChallenges] = useState([]);

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

  const challengeCountLabel = useMemo(() => {
    const count = challenges.length;
    if (count === 1) return '1 challenge';
    return `${count} challenges`;
  }, [challenges]);

  return (
    <div className="compiler-shell">
      <CompilerTopBar
        title="Challenge Browser"
        subtitle="View all API-owned challenges and launch exam runner with one click."
        rightNode={(
          <Button type="button" variant="secondary" onClick={() => fetchChallenges(activeSearch)} disabled={loading}>
            <FiRefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        )}
      />

      <main className="compiler-main app-page">
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
              <p className="text-sm text-slate-500">No challenges found. Create one from Challenge Builder.</p>
            )}

            {!loading && challenges.length > 0 && (
              <div className="space-y-3">
                {challenges.map((item) => {
                  const challengeId = item.id;
                  const challengeUrl = item.slug
                    ? `https://onecompiler.com/challenges/${challengeId}/${item.slug}`
                    : `https://onecompiler.com/challenges/${challengeId}`;

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
                          <Link to={`/compiler/challenges/run/${encodeURIComponent(challengeId)}`} className="btn btn-primary">
                            <FiPlayCircle className="h-4 w-4" />
                            Run In Exam View
                          </Link>
                          <a href={challengeUrl} target="_blank" rel="noreferrer" className="btn btn-secondary">
                            <FiExternalLink className="h-4 w-4" />
                            Open On OneCompiler
                          </a>
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
    </div>
  );
};

export default ChallengeBrowser;
