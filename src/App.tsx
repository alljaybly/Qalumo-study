import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { GRADES, LANGUAGES, VIDEO_REVIEW_STATUSES } from './types';
import { DEFAULT_AI_SETTINGS } from './types';
import type { AiSettings, Assessment, BackupFile, PracticeAttempt, PracticeQuestion, PracticeSet, Profile, Resource, SchoolReport, SchoolReportSubjectResult, StudyData, VideoLibraryFile, VideoResource, VideoReviewStatus } from './types';
import { samplePracticeSets } from './data/samplePractice';
import { answerMatches, createId, isVideoResource, percentage, planVideoLibraryImport, validateBackup, validateVideoLibrary } from './data/logic';
import { askAi, testAiConnection, validateAiSettings } from './services/ai';
import { deleteAllLocalData, emptyStudyData, loadAiSettings, loadStudyData, loadVideoLibrary, saveAiSettings, saveFullBackup, saveStudyData, saveVideoLibrary } from './services/storage';
import { LIVE_QALUMO_APP_URL } from './config';
import HomeworkPage from './pages/HomeworkPage';
import StudyLibraryPage from './pages/StudyLibraryPage';

type Page = 'Home' | 'Results' | 'Practise' | 'Homework' | 'Study library' | 'Resources' | 'Settings' | 'Help';
type ResultDraft = { subject: string; topic: string; date: string; earned: string; total: string; note: string };
type ReportSubjectDraft = { id: string; subject: string; topic: string; format: SchoolReportSubjectResult['format']; earned: string; total: string; value: string; achievement: string };
type ReportDraft = { schoolYear: string; term: string; periodLabel: string; grade: string; reportDate: string; notes: string; subjects: ReportSubjectDraft[] };
type ResourceDraft = { title: string; subject: string; grade: string; topic: string; source: string; text: string };
type VideoDraft = { title: string; url: string; source: string; grade: string; subject: string; topic: string; language: string; note: string; reviewStatus: VideoReviewStatus };
type QuestionDraft = { id: string; prompt: string; kind: 'choice' | 'short'; options: string; answer: string; explanation: string };
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const navigation: Page[] = ['Home', 'Results', 'Practise', 'Homework', 'Study library', 'Resources', 'Settings', 'Help'];
const subjectSuggestions = [
  'Mathematics', 'English Home Language', 'English First Additional Language', 'Afrikaans',
  'isiZulu', 'Natural Sciences', 'Social Sciences', 'Technology', 'Life Orientation',
  'Economic and Management Sciences', 'Creative Arts', 'Geography', 'History', 'Life Sciences',
  'Physical Sciences', 'Accounting', 'Business Studies',
];
const today = () => {
  const date = new Date();
  const twoDigits = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
};
const emptyResultDraft = (): ResultDraft => ({ subject: '', topic: '', date: today(), earned: '', total: '', note: '' });
const emptyReportSubjectDraft = (): ReportSubjectDraft => ({ id: createId(), subject: '', topic: '', format: 'mark', earned: '', total: '', value: '', achievement: '' });
const emptyReportDraft = (grade: string = ''): ReportDraft => ({
  schoolYear: String(new Date().getFullYear()),
  term: '1',
  periodLabel: '',
  grade: GRADES.includes(grade as typeof GRADES[number]) ? grade : 'Grade 8',
  reportDate: '',
  notes: '',
  subjects: [emptyReportSubjectDraft()],
});
const emptyResourceDraft = (): ResourceDraft => ({ title: '', subject: '', grade: 'Grade 8', topic: '', source: '', text: '' });
const emptyVideoDraft = (): VideoDraft => ({ title: '', url: '', source: '', grade: 'Grade 8', subject: '', topic: '', language: 'English', note: '', reviewStatus: 'Needs review' });

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString();
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function cloneSetForEditing(set: PracticeSet): PracticeSet {
  return {
    ...set,
    id: set.id.startsWith('sample-') ? createId() : set.id,
    questions: set.questions.map((question) => ({ ...question, id: createId(), options: [...question.options] })),
  };
}

function App() {
  const [data, setData] = useState<StudyData>(() => emptyStudyData());
  const [videoResources, setVideoResources] = useState<VideoResource[]>([]);
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [apiKey, setApiKey] = useState('');
  const [page, setPage] = useState<Page>('Home');
  const [loading, setLoading] = useState(true);
  const [storageReady, setStorageReady] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    Promise.allSettled([loadStudyData(), loadAiSettings(), loadVideoLibrary()])
      .then(([dataResult, aiResult, videoResult]) => {
        if (dataResult.status === 'fulfilled') {
          setData(dataResult.value);
          setStorageReady(true);
        } else {
          setError(dataResult.reason instanceof Error ? dataResult.reason.message : 'Local storage could not be opened.');
        }
        if (aiResult.status === 'fulfilled') {
          setAiSettings(aiResult.value);
        } else if (dataResult.status === 'fulfilled') {
          setError('AI connection preferences could not be loaded. The assistant remains off; other saved study data is available.');
        }
        if (videoResult.status === 'fulfilled' && Array.isArray(videoResult.value)) {
          const validVideos = videoResult.value.filter(isVideoResource);
          setVideoResources(validVideos);
          if (validVideos.length !== videoResult.value.length) setError('Some saved video-library records were invalid and were not loaded. Other local study data remains available.');
        } else if (videoResult.status === 'rejected') {
          setError(videoResult.reason instanceof Error ? videoResult.reason.message : 'The video library could not be loaded.');
        } else {
          setError('The saved video library is not valid. Other local study data remains available.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function persist(next: StudyData, confirmation?: string): Promise<boolean> {
    try {
      await saveStudyData(next);
      setData(next);
      setStorageReady(true);
      setError('');
      setMessage(confirmation ?? 'Saved on this device.');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your changes could not be saved on this device.');
      setMessage('');
      return false;
    }
  }

  async function persistVideoLibrary(next: VideoResource[], confirmation?: string): Promise<boolean> {
    try {
      await saveVideoLibrary(next);
      setVideoResources(next);
      setError('');
      setMessage(confirmation ?? 'Video library saved on this device.');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The video library could not be saved on this device.');
      setMessage('');
      return false;
    }
  }

  async function persistAiSettings(next: AiSettings): Promise<boolean> {
    try {
      await saveAiSettings(next);
      setAiSettings(next);
      setError('');
      setMessage('AI settings saved on this device. The API key was not saved.');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI settings could not be saved on this device.');
      setMessage('');
      return false;
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setMessage('Qalumo was added to this device.');
      setInstallPrompt(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The browser could not start app installation.');
    }
  }

  if (loading) {
    return <main className="loading-screen"><span className="loader" aria-hidden="true" />Opening Qalumo on this device…</main>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setPage('Home')}>
          <span className="brand-mark" aria-hidden="true">Q</span>
          <span><strong>Qalumo</strong><small>Study companion</small></span>
        </button>
        <div className="topbar-right">
          <span className="device-label"><span className="online-dot" />Saved only on this device</span>
          <button className="button button-light header-help" type="button" onClick={() => { setPage('Help'); setError(''); setMessage(''); }}>Help</button>
          {installPrompt && <button className="button button-outline install-button" onClick={installApp}>Install app</button>}
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar" aria-label="Main navigation">
          <nav>{navigation.map((item, index) => (
            <button key={item} className={`nav-item ${page === item ? 'active' : ''}`} onClick={() => { setPage(item); setError(''); setMessage(''); }}>
              <span className="nav-index" aria-hidden="true">0{index + 1}</span>{item}
            </button>
          ))}</nav>
          <div className="sidebar-note">
            <span className="eyebrow">A helpful reminder</span>
            <p>Small steps count. A result is information, not a measure of your worth.</p>
          </div>
        </aside>

        <main className="main-content">
          <div className="mobile-nav" aria-label="Main navigation">
            {navigation.map((item) => <button key={item} className={page === item ? 'active' : ''} onClick={() => { setPage(item); setError(''); setMessage(''); }}>{item}</button>)}
          </div>
          {(error || message) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`} role={error ? 'alert' : 'status'}>
            <span>{error || message}</span>
            <button aria-label="Dismiss message" onClick={() => { setError(''); setMessage(''); }}>×</button>
          </div>}
          {!storageReady && !error && <div className="notice notice-warn" role="status">Local storage is not ready yet. Your changes will not be saved until storage is available.</div>}
          {page === 'Home' && <HomePage data={data} setPage={setPage} aiSettings={aiSettings} apiKey={apiKey} setError={setError} setMessage={setMessage} />}
          {page === 'Results' && <ResultsPage data={data} persist={persist} />}
          {page === 'Practise' && <PracticePage data={data} persist={persist} />}
          {page === 'Homework' && <HomeworkPage data={data} persist={persist} aiSettings={aiSettings} apiKey={apiKey} />}
          {page === 'Study library' && <StudyLibraryPage data={data} persist={persist} aiSettings={aiSettings} apiKey={apiKey} setPage={setPage} />}
          {page === 'Resources' && <ResourcesPage data={data} videoResources={videoResources} persist={persist} persistVideoLibrary={persistVideoLibrary} aiSettings={aiSettings} apiKey={apiKey} setError={setError} setMessage={setMessage} />}
          {page === 'Settings' && <SettingsPage data={data} videoResources={videoResources} persist={persist} setData={setData} setVideoResources={setVideoResources} setError={setError} setMessage={setMessage} aiSettings={aiSettings} persistAiSettings={persistAiSettings} apiKey={apiKey} setApiKey={setApiKey} setAiSettings={setAiSettings} />}
          {page === 'Help' && <HelpPage setPage={setPage} />}
          <footer className="app-footer">
            <span>Qalumo · Offline-first and private</span>
            <span>Curriculum content is user-provided unless a source is shown. No official CAPS alignment is claimed.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-intro"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="intro-copy">{description}</p></div>{action}</div>;
}

function HomePage({ data, setPage, aiSettings, apiKey, setError, setMessage }: {
  data: StudyData;
  setPage: (page: Page) => void;
  aiSettings: AiSettings;
  apiKey: string;
  setError: (message: string) => void;
  setMessage: (message: string) => void;
}) {
  const results = [...data.assessments].sort((a, b) => b.date.localeCompare(a.date));
  const groups = new Map<string, Assessment[]>();
  data.assessments.forEach((result) => {
    const key = result.subject;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  });
  const topicGroups = new Map<string, Assessment[]>();
  data.assessments.filter((result) => result.topic.trim()).forEach((result) => {
    const key = `${result.subject}::${result.topic.trim()}`;
    topicGroups.set(key, [...(topicGroups.get(key) ?? []), result]);
  });
  const suggestions = new Map<string, Assessment[]>();
  data.assessments.filter((result) => result.topic.trim()
    && data.practiceSuggestionThreshold !== null
    && result.earned / result.total * 100 < data.practiceSuggestionThreshold).forEach((result) => {
    const key = `${result.subject}::${result.topic.trim().toLocaleLowerCase()}`;
    suggestions.set(key, [...(suggestions.get(key) ?? []), result]);
  });
  const displayName = data.profile.nickname.trim() || 'learner';

  return <>
    <PageIntro eyebrow="Your study space" title={`Welcome${data.profile.nickname ? `, ${data.profile.nickname}` : ''}.`} description="A quiet place to notice progress, practise a little, and keep useful notes close." action={<button className="button button-primary" onClick={() => setPage('Results')}>Add a result <span aria-hidden="true">+</span></button>} />
    <section className="welcome-strip">
      <div><p className="eyebrow">One step at a time</p><h2>{data.profile.grade ? `${data.profile.grade} study space` : 'Make this space yours'}</h2><p>{data.profile.grade ? `Welcome back, ${displayName}. Your work stays on this device.` : 'Add a nickname, grade, and subjects to get started. A real name is not needed.'}</p></div>
      <button className="button button-light" onClick={() => setPage(data.profile.grade ? 'Practise' : 'Settings')}>{data.profile.grade ? 'Choose a practice set' : 'Set up learner profile'} <span aria-hidden="true">→</span></button>
    </section>

    <div className="stat-grid">
      <article className="stat-card"><span className="stat-label">Assessments recorded</span><strong>{data.assessments.length}</strong><span>Original marks stay visible</span></article>
      <article className="stat-card"><span className="stat-label">Practice sessions</span><strong>{data.practiceHistory.length}</strong><span>Saved on this device</span></article>
      <article className="stat-card"><span className="stat-label">Saved resources</span><strong>{data.resources.length}</strong><span>Available offline after saving</span></article>
    </div>

    <div className="section-heading"><div><p className="eyebrow">Your evidence</p><h2>Progress at a glance</h2></div><button className="text-button" onClick={() => setPage('Results')}>View results →</button></div>
    {groups.size === 0 ? <div className="empty-card"><span className="empty-icon">01</span><h3>Your progress starts here</h3><p>Add an assessment to see subject results, topic trends, and evidence-based practice suggestions. No topic will be assumed when one is not recorded.</p><button className="button button-primary" onClick={() => setPage('Results')}>Record a result</button></div> : <div className="progress-grid">
      {[...groups.entries()].map(([subject, entries]) => {
        const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
        const average = Math.round(sorted.reduce((sum, item) => sum + percentage(item.earned, item.total), 0) / sorted.length);
        const latest = sorted[sorted.length - 1];
        const previous = sorted.length > 1 ? percentage(sorted[sorted.length - 2].earned, sorted[sorted.length - 2].total) : null;
        const latestPercent = percentage(latest.earned, latest.total);
        const trend = previous === null ? 'One result recorded' : latestPercent > previous ? 'Latest result is up from the one before' : latestPercent < previous ? 'Latest result is down from the one before' : 'Latest result is unchanged';
        return <article className="progress-card" key={subject}><div className="progress-head"><span className="subject-dot" /><h3>{subject}</h3></div><div className="progress-value">{average}<span>%</span></div><p className="muted">{entries.length} result{entries.length === 1 ? '' : 's'} · {trend}</p><div className="progress-track" role="img" aria-label={`${subject} average ${average}%`}><span style={{ width: `${average}%` }} /></div><p className="evidence-line">Latest: {latest.earned} / {latest.total} on {formatDate(latest.date)}</p></article>;
      })}
    </div>}

    {groups.size > 0 && <section className="topic-progress-section"><div className="section-heading compact"><div><p className="eyebrow">Recorded topics only</p><h2>Topic progress</h2></div></div>
      {topicGroups.size === 0 ? <div className="soft-card"><p>No assessment topics have been entered yet. Add a topic when recording a result to see topic trends; Qalumo will not guess topic coverage.</p></div> : <div className="progress-grid">
        {[...topicGroups.entries()].map(([key, entries]) => {
          const [subject, topic] = key.split('::');
          const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
          const average = Math.round(sorted.reduce((sum, item) => sum + percentage(item.earned, item.total), 0) / sorted.length);
          const latest = sorted[sorted.length - 1];
          const previous = sorted.length > 1 ? percentage(sorted[sorted.length - 2].earned, sorted[sorted.length - 2].total) : null;
          const latestPercent = percentage(latest.earned, latest.total);
          const trend = previous === null ? 'One result recorded' : latestPercent > previous ? 'Latest result is up' : latestPercent < previous ? 'Latest result is down' : 'Latest result is unchanged';
          return <article className="progress-card" key={key}><div className="progress-head"><span className="subject-dot" /><h3>{subject} · {topic}</h3></div><div className="progress-value">{average}<span>%</span></div><p className="muted">{entries.length} result{entries.length === 1 ? '' : 's'} · {trend}</p><div className="progress-track" role="img" aria-label={`${subject}, ${topic} average ${average}%`}><span style={{ width: `${average}%` }} /></div><p className="evidence-line">Latest: {latest.earned} / {latest.total} on {formatDate(latest.date)}</p></article>;
        })}
      </div>}
    </section>}

    <section className="suggestions-section">
      <div className="section-heading compact"><div><p className="eyebrow">Practice ideas</p><h2>Topics that may need practice</h2></div></div>
      {suggestions.size === 0 ? <div className="soft-card"><p>{data.practiceSuggestionThreshold === null ? 'Practice prompts are off until a caregiver chooses a threshold in Results. No universal pass mark is assumed.' : data.assessments.length ? `No topic results are below the caregiver-selected ${displayPercent(data.practiceSuggestionThreshold)} threshold, or no topic has been recorded.` : 'Add an individual assessment result with a topic to see prompts based on that evidence.'}</p></div> : <div className="suggestion-list">
        {[...suggestions.entries()].map(([key, entries]) => {
          const [subject, topic] = key.split('::');
          const evidence = entries.sort((a, b) => b.date.localeCompare(a.date));
          return <article className="suggestion-card" key={key}><span className="suggestion-icon" aria-hidden="true">↗</span><div><h3>{topic.replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase())} <span>· {subject}</span></h3><p>App-generated prompt based on {evidence.length} recorded result{evidence.length === 1 ? '' : 's'} below your chosen {displayPercent(data.practiceSuggestionThreshold ?? 0)} threshold.</p><small>Evidence: {evidence.map((entry) => `${entry.earned}/${entry.total} (${percentage(entry.earned, entry.total)}%) on ${formatDate(entry.date)}`).join(' · ')}</small><AiAssistant context={`Selected topic: ${topic}\nSubject: ${subject}`} settings={aiSettings} apiKey={apiKey} setError={setError} setMessage={setMessage} /></div><button className="text-button" onClick={() => setPage('Practise')}>Practise →</button></article>;
        })}
      </div>}
    </section>
    {results.length > 0 && <section className="recent-section"><div className="section-heading compact"><div><p className="eyebrow">Recently recorded</p><h2>Latest results</h2></div></div><div className="table-wrap"><table><thead><tr><th>Subject / topic</th><th>Date</th><th>Mark</th><th>Percentage</th></tr></thead><tbody>{results.slice(0, 3).map((result) => <tr key={result.id}><td><strong>{result.subject}</strong><small>{result.topic || 'No topic recorded'}</small></td><td>{formatDate(result.date)}</td><td>{result.earned} / {result.total}</td><td><span className="percent-pill">{percentage(result.earned, result.total)}%</span></td></tr>)}</tbody></table></div></section>}
  </>;
}

function ResultsPage({ data, persist }: { data: StudyData; persist: (data: StudyData, confirmation?: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState<ResultDraft>(emptyResultDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const sorted = [...data.assessments].sort((a, b) => b.date.localeCompare(a.date));
  const update = (field: keyof ResultDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));

  async function saveResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const earned = Number(draft.earned);
    const total = Number(draft.total);
    if (!draft.subject.trim() || !draft.date) {
      setFormError('Add a subject and assessment date.');
      return;
    }
    if (draft.earned.trim() === '' || draft.total.trim() === '' || !Number.isFinite(earned) || !Number.isFinite(total)) {
      setFormError('Enter a number for both marks.');
      return;
    }
    if (total <= 0 || earned < 0 || earned > total) {
      setFormError('The total must be greater than zero, and the mark earned must be from zero up to the total.');
      return;
    }
    const result: Assessment = {
      id: editingId ?? createId(),
      subject: draft.subject.trim(),
      topic: draft.topic.trim(),
      date: draft.date,
      earned,
      total,
      note: draft.note.trim(),
    };
    const next = { ...data, assessments: editingId ? data.assessments.map((entry) => entry.id === editingId ? result : entry) : [...data.assessments, result] };
    if (await persist(next, editingId ? 'Assessment updated.' : 'Assessment added.')) {
      setDraft(emptyResultDraft());
      setEditingId(null);
      setFormError('');
    }
  }

  function editResult(result: Assessment) {
    setDraft({ subject: result.subject, topic: result.topic, date: result.date, earned: String(result.earned), total: String(result.total), note: result.note });
    setEditingId(result.id);
    setFormError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function removeResult(result: Assessment) {
    if (!window.confirm(`Delete the ${result.subject} result from ${formatDate(result.date)}? This cannot be undone.`)) return;
    if (await persist({ ...data, assessments: data.assessments.filter((entry) => entry.id !== result.id) }, 'Assessment deleted.')) {
      if (editingId === result.id) {
        setDraft(emptyResultDraft());
        setEditingId(null);
      }
    }
  }

  return <>
    <PageIntro eyebrow="Results" title="Record what you’ve learned." description="Keep the original mark and total together. Percentages are calculated by Qalumo." />
    <SchoolReportResults data={data} persist={persist} />
    <div className="section-heading results-subheading"><div><p className="eyebrow">Individual assessments</p><h2>Other assessment results</h2></div></div>
    <div className="two-column">
      <section className="form-card"><div className="card-title"><span className="step-number">{editingId ? 'Edit' : '01'}</span><div><h2>{editingId ? 'Edit assessment' : 'Add an assessment'}</h2><p>Fields with * are needed to save a result.</p></div></div>
        <form onSubmit={saveResult} noValidate>
          <label>Subject *<input list="result-subjects" value={draft.subject} onChange={(event) => update('subject', event.target.value)} placeholder="e.g. Mathematics" required /></label>
          <datalist id="result-subjects">{subjectSuggestions.map((subject) => <option key={subject} value={subject} />)}</datalist>
          <label>Topic (optional)<input value={draft.topic} onChange={(event) => update('topic', event.target.value)} placeholder="e.g. Fractions" /></label>
          <div className="form-row"><label>Date *<input type="date" value={draft.date} onChange={(event) => update('date', event.target.value)} required /></label><label>Mark earned *<input type="number" min="0" step="any" value={draft.earned} onChange={(event) => update('earned', event.target.value)} placeholder="e.g. 18" required /></label></div>
          <label>Total possible *<input type="number" min="0.01" step="any" value={draft.total} onChange={(event) => update('total', event.target.value)} placeholder="e.g. 25" required /></label>
          <label>Note (optional)<textarea value={draft.note} onChange={(event) => update('note', event.target.value)} rows={3} placeholder="Anything you would like to remember?" /></label>
          {formError && <p className="field-error" role="alert">{formError}</p>}
          <div className="form-actions"><button className="button button-primary" type="submit">{editingId ? 'Save changes' : 'Save result'}</button>{editingId && <button className="button button-outline" type="button" onClick={() => { setDraft(emptyResultDraft()); setEditingId(null); setFormError(''); }}>Cancel edit</button>}</div>
        </form>
      </section>
      <section className="results-panel"><div className="section-heading compact"><div><p className="eyebrow">{data.assessments.length} saved</p><h2>Your assessment results</h2></div></div>
        {sorted.length === 0 ? <div className="empty-card small-empty"><h3>No results yet</h3><p>When you add an assessment, its mark and app-calculated percentage will appear here.</p></div> : <div className="result-list">{sorted.map((result) => <article className="result-card" key={result.id}><div className="result-top"><div><span className="result-subject">{result.subject}</span><small>{result.topic || 'No topic recorded'} · {formatDate(result.date)}</small></div><span className="percent-pill">{percentage(result.earned, result.total)}%</span></div><div className="mark-line"><strong>{result.earned} / {result.total}</strong><span>original mark</span></div>{result.note && <p className="result-note">{result.note}</p>}<div className="record-actions"><button className="text-button" onClick={() => editResult(result)}>Edit</button><button className="text-button danger-text" onClick={() => removeResult(result)}>Delete</button></div></article>)}</div>}
      </section>
    </div>
    <p className="small-print">Percentages help compare results with different totals. A lower result may be a reason to practise, but it does not define a learner.</p>
  </>;
}

function reportResultPercent(result: SchoolReportSubjectResult): number | null {
  if (result.format === 'mark') return result.earned / result.total * 100;
  return result.format === 'percentage' ? result.value : null;
}

function displayPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function reportPeriodTitle(report: SchoolReport): string {
  return `Term ${report.term}${report.periodLabel ? ` · ${report.periodLabel}` : ''} · ${report.schoolYear}`;
}

function displayReportResult(result: SchoolReportSubjectResult): string {
  if (result.format === 'mark') {
    return `${result.earned} / ${result.total} (original mark; ${displayPercent(reportResultPercent(result) ?? 0)} calculated)`;
  }
  if (result.format === 'percentage') return `${displayPercent(result.value)} (percentage entered)`;
  return `Achievement/comment: ${result.achievement}`;
}

function SchoolReportResults({ data, persist }: {
  data: StudyData;
  persist: (data: StudyData, confirmation?: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<ReportDraft>(() => emptyReportDraft(data.profile.grade));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState('');
  const [criteriaError, setCriteriaError] = useState('');
  const [thresholdText, setThresholdText] = useState(data.practiceSuggestionThreshold === null ? '' : String(data.practiceSuggestionThreshold));
  const [showDismissed, setShowDismissed] = useState(false);

  const sortedReports = [...data.schoolReports].sort((a, b) =>
    b.schoolYear - a.schoolYear || b.term - a.term || b.reportDate.localeCompare(a.reportDate),
  );
  const trendGroups = new Map<string, { subject: string; topic: string; entries: { report: SchoolReport; result: SchoolReportSubjectResult }[] }>();
  for (const report of data.schoolReports) {
    for (const result of report.subjects) {
      const key = `${result.subject.trim().toLocaleLowerCase()}::${result.topic.trim().toLocaleLowerCase()}`;
      const group = trendGroups.get(key) ?? { subject: result.subject, topic: result.topic, entries: [] };
      group.entries.push({ report, result });
      trendGroups.set(key, group);
    }
  }
  const sortedTrendGroups = [...trendGroups.entries()].sort(([, a], [, b]) =>
    a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic),
  );
  const threshold = data.practiceSuggestionThreshold ?? 0;
  const suggestions = data.practiceSuggestionThreshold === null ? [] : data.schoolReports.flatMap((report) =>
    report.subjects.flatMap((result) => {
      const value = reportResultPercent(result);
      return value !== null && value < threshold
        ? [{ report, result, value }]
        : [];
    }),
  ).sort((a, b) => b.report.schoolYear - a.report.schoolYear || b.report.term - a.report.term);
  const visibleSuggestions = suggestions.filter(({ result }) => showDismissed || !data.dismissedReportSuggestions.includes(result.id));

  function updateDraft(field: keyof Omit<ReportDraft, 'subjects'>, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateSubject(index: number, field: keyof ReportSubjectDraft, value: string) {
    setDraft((current) => ({
      ...current,
      subjects: current.subjects.map((subject, subjectIndex) => subjectIndex === index
        ? { ...subject, [field]: value }
        : subject),
    }));
  }

  function editReport(report: SchoolReport) {
    setDraft({
      schoolYear: String(report.schoolYear),
      term: String(report.term),
      periodLabel: report.periodLabel,
      grade: report.grade,
      reportDate: report.reportDate,
      notes: report.notes,
      subjects: report.subjects.map((result) => ({
        id: result.id,
        subject: result.subject,
        topic: result.topic,
        format: result.format,
        earned: result.format === 'mark' ? String(result.earned) : '',
        total: result.format === 'mark' ? String(result.total) : '',
        value: result.format === 'percentage' ? String(result.value) : '',
        achievement: result.format === 'achievement' ? result.achievement : '',
      })),
    });
    setEditingId(report.id);
    setShowForm(true);
    setFormError('');
    document.getElementById('school-report-results')?.scrollIntoView({ behavior: 'smooth' });
  }

  function cancelReportEdit() {
    setDraft(emptyReportDraft(data.profile.grade));
    setEditingId(null);
    setShowForm(false);
    setFormError('');
  }

  async function saveReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const schoolYear = Number(draft.schoolYear);
    if (!Number.isInteger(schoolYear) || schoolYear < 1900 || schoolYear > 9999) {
      setFormError('Enter a valid school year.');
      return;
    }
    if (!['1', '2', '3', '4'].includes(draft.term)) {
      setFormError('Choose one of the four school terms.');
      return;
    }
    if (!GRADES.includes(draft.grade as typeof GRADES[number])) {
      setFormError('Choose a grade from Grade R to Grade 12.');
      return;
    }
    if (draft.reportDate && !isCalendarDate(draft.reportDate)) {
      setFormError('Enter a valid report date or leave the date blank.');
      return;
    }
    if (!draft.subjects.length) {
      setFormError('Add at least one subject result to this report.');
      return;
    }

    const subjectResults: SchoolReportSubjectResult[] = [];
    for (const subject of draft.subjects) {
      if (!subject.subject.trim()) {
        setFormError('Enter a subject for each subject result.');
        return;
      }
      if (subject.format === 'mark') {
        const earned = Number(subject.earned);
        const total = Number(subject.total);
        if (!subject.earned.trim() || !subject.total.trim() || !Number.isFinite(earned) || !Number.isFinite(total)
          || total <= 0 || earned < 0 || earned > total) {
          setFormError(`Enter a valid mark earned and total possible for ${subject.subject.trim()}. The total must be positive and the mark cannot exceed it.`);
          return;
        }
        subjectResults.push({ id: subject.id, subject: subject.subject.trim(), topic: subject.topic.trim(), format: 'mark', earned, total });
      } else if (subject.format === 'percentage') {
        const value = Number(subject.value);
        if (!subject.value.trim() || !Number.isFinite(value) || value < 0 || value > 100) {
          setFormError(`Enter a percentage from 0 to 100 for ${subject.subject.trim()}.`);
          return;
        }
        subjectResults.push({ id: subject.id, subject: subject.subject.trim(), topic: subject.topic.trim(), format: 'percentage', value });
      } else {
        if (!subject.achievement.trim()) {
          setFormError(`Enter the achievement level or comment for ${subject.subject.trim()}.`);
          return;
        }
        subjectResults.push({ id: subject.id, subject: subject.subject.trim(), topic: subject.topic.trim(), format: 'achievement', achievement: subject.achievement.trim() });
      }
    }

    const report: SchoolReport = {
      id: editingId ?? createId(),
      schoolYear,
      term: Number(draft.term) as SchoolReport['term'],
      periodLabel: draft.periodLabel.trim(),
      grade: draft.grade as typeof GRADES[number],
      reportDate: draft.reportDate,
      notes: draft.notes.trim(),
      subjects: subjectResults,
    };
    const previous = editingId ? data.schoolReports.find((item) => item.id === editingId) : undefined;
    const changedResultIds = previous?.subjects.map((result) => result.id) ?? [];
    const next = {
      ...data,
      schoolReports: previous
        ? data.schoolReports.map((item) => item.id === editingId ? report : item)
        : [...data.schoolReports, report],
      dismissedReportSuggestions: data.dismissedReportSuggestions.filter((id) => !changedResultIds.includes(id)),
    };
    if (await persist(next, editingId ? 'School report updated.' : 'School report saved.')) cancelReportEdit();
  }

  async function deleteReport(report: SchoolReport) {
    if (!window.confirm(`Delete the ${reportPeriodTitle(report)} school report? This cannot be undone.`)) return;
    const resultIds = report.subjects.map((result) => result.id);
    const next = {
      ...data,
      schoolReports: data.schoolReports.filter((item) => item.id !== report.id),
      dismissedReportSuggestions: data.dismissedReportSuggestions.filter((id) => !resultIds.includes(id)),
    };
    if (await persist(next, 'School report deleted.')) {
      if (editingId === report.id) cancelReportEdit();
    }
  }

  async function saveThreshold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = thresholdText.trim() ? Number(thresholdText) : null;
    if (value !== null && (!Number.isFinite(value) || value < 1 || value > 100)) {
      setCriteriaError('Choose a percentage greater than 0 and no higher than 100, or leave it blank to turn suggestions off.');
      return;
    }
    setCriteriaError('');
    await persist({ ...data, practiceSuggestionThreshold: value }, value === null
      ? 'Result practice suggestions are off.'
      : `Practice prompts now flag recorded numeric results below your chosen ${displayPercent(value)} threshold.`);
  }

  async function disableThreshold() {
    if (await persist({ ...data, practiceSuggestionThreshold: null }, 'Result practice suggestions are off.')) setThresholdText('');
  }

  async function setSuggestionDismissed(resultId: string, dismissed: boolean) {
    const current = new Set(data.dismissedReportSuggestions);
    if (dismissed) current.add(resultId);
    else current.delete(resultId);
    await persist({ ...data, dismissedReportSuggestions: [...current] }, dismissed
      ? 'Suggestion dismissed. The recorded report result is unchanged.'
      : 'Suggestion restored.');
  }

  return <section className="school-report-area" id="school-report-results" aria-labelledby="school-report-title">
    <div className="section-heading school-report-heading">
      <div>
        <p className="eyebrow">Past and current reports · recorded facts</p>
        <h2 id="school-report-title">School report results</h2>
        <p className="section-copy">Save several subjects together for each school term. This report history is separate from individual assessment entries below.</p>
      </div>
      <button className="button button-primary" type="button" onClick={() => { cancelReportEdit(); setShowForm(true); }}>Add school report <span aria-hidden="true">+</span></button>
    </div>

    <div className="notice notice-info report-suggestion-note"><span>Qalumo does not assume a universal pass mark. Practice suggestions are off until a caregiver chooses a threshold. A suggestion is an app-generated prompt with its reason shown; it does not change the recorded result or diagnose ability.</span></div>

    {showForm && <form className="form-card report-editor" onSubmit={saveReport} noValidate>
      <div className="editor-heading"><div><p className="eyebrow">{editingId ? 'Update recorded facts' : 'Caregiver-entered report'}</p><h3>{editingId ? 'Edit school report' : 'Add a school report'}</h3></div><button type="button" className="icon-button" aria-label="Close school report form" onClick={cancelReportEdit}>×</button></div>
      <div className="form-row">
        <label>School year *<input type="number" min="1900" max="9999" step="1" value={draft.schoolYear} onChange={(event) => updateDraft('schoolYear', event.target.value)} required /></label>
        <label>Term / quarter *<select value={draft.term} onChange={(event) => updateDraft('term', event.target.value)}>{[1, 2, 3, 4].map((term) => <option key={term} value={term}>Term {term}</option>)}</select></label>
      </div>
      <div className="form-row">
        <label>Period label (optional)<input maxLength={80} value={draft.periodLabel} onChange={(event) => updateDraft('periodLabel', event.target.value)} placeholder="e.g. Quarter 1, Mid-year" /></label>
        <label>Grade *<select value={draft.grade} onChange={(event) => updateDraft('grade', event.target.value)}>{GRADES.map((grade) => <option key={grade}>{grade}</option>)}</select></label>
      </div>
      <label>Report date (optional)<input type="date" value={draft.reportDate} onChange={(event) => updateDraft('reportDate', event.target.value)} /></label>
      <div className="report-subject-list">
        <div className="section-heading compact"><div><h4>Subject results</h4><p>Add all the subjects shown on this report. Topic is optional.</p></div></div>
        {draft.subjects.map((subject, index) => <article className="report-subject-editor" key={subject.id}>
          <div className="report-subject-editor-title"><h5>Subject {index + 1}</h5>{draft.subjects.length > 1 && <button type="button" className="text-button danger-text" onClick={() => setDraft((current) => ({ ...current, subjects: current.subjects.filter((_, subjectIndex) => subjectIndex !== index) }))}>Remove subject</button>}</div>
          <div className="form-row"><label>Subject *<input list="school-report-subjects" maxLength={100} value={subject.subject} onChange={(event) => updateSubject(index, 'subject', event.target.value)} placeholder="e.g. Mathematics" required /></label><label>Topic (optional)<input maxLength={120} value={subject.topic} onChange={(event) => updateSubject(index, 'topic', event.target.value)} placeholder="Leave blank for a subject-level result" /></label></div>
          <label>Result format *<select value={subject.format} onChange={(event) => updateSubject(index, 'format', event.target.value)}><option value="mark">Mark earned and total possible</option><option value="percentage">Percentage</option><option value="achievement">Text achievement level or comment</option></select></label>
          {subject.format === 'mark' && <div className="form-row"><label>Mark earned *<input type="number" min="0" step="any" value={subject.earned} onChange={(event) => updateSubject(index, 'earned', event.target.value)} required /></label><label>Total possible *<input type="number" min="0.01" step="any" value={subject.total} onChange={(event) => updateSubject(index, 'total', event.target.value)} required /></label></div>}
          {subject.format === 'percentage' && <label>Percentage entered *<input type="number" min="0" max="100" step="any" value={subject.value} onChange={(event) => updateSubject(index, 'value', event.target.value)} placeholder="0–100" required /></label>}
          {subject.format === 'achievement' && <label>Achievement level or comment *<textarea rows={2} maxLength={500} value={subject.achievement} onChange={(event) => updateSubject(index, 'achievement', event.target.value)} placeholder="Enter the wording shown on the report" required /></label>}
        </article>)}
      </div>
      <datalist id="school-report-subjects">{subjectSuggestions.map((subject) => <option key={subject} value={subject} />)}</datalist>
      <button className="button button-outline" type="button" onClick={() => setDraft((current) => ({ ...current, subjects: [...current.subjects, emptyReportSubjectDraft()] }))}>Add another subject</button>
      <label>Report notes (optional)<textarea rows={3} maxLength={1000} value={draft.notes} onChange={(event) => updateDraft('notes', event.target.value)} placeholder="Optional context to keep with this report" /></label>
      {formError && <p className="field-error" role="alert">{formError}</p>}
      <div className="form-actions"><button className="button button-primary" type="submit">{editingId ? 'Save report changes' : 'Save school report'}</button><button className="button button-outline" type="button" onClick={cancelReportEdit}>Cancel</button></div>
    </form>}

    <section className="report-trends" aria-labelledby="report-trends-title">
      <div className="section-heading compact"><div><p className="eyebrow">Recorded report results</p><h3 id="report-trends-title">Subject and topic trends</h3></div></div>
      {sortedTrendGroups.length === 0 ? <div className="soft-card"><p>Add reports with the same subject or topic over time to compare their recorded results. No topic coverage is guessed.</p></div>
        : <div className="report-trend-grid">{sortedTrendGroups.map(([key, group]) => {
          const entries = [...group.entries].sort((a, b) => a.report.schoolYear - b.report.schoolYear || a.report.term - b.report.term || a.report.reportDate.localeCompare(b.report.reportDate));
          const numericEntries = entries.map(({ report, result }) => ({ report, result, value: reportResultPercent(result) })).filter((item): item is { report: SchoolReport; result: SchoolReportSubjectResult; value: number } => item.value !== null);
          const delta = numericEntries.length > 1 ? numericEntries[numericEntries.length - 1].value - numericEntries[0].value : null;
          return <article className="report-trend-card" key={key}>
            <div className="report-trend-title"><h4>{group.subject}</h4><span className="tag">{group.topic || 'No topic recorded'}</span></div>
            {delta !== null && <p className="report-trend-delta">Recorded numeric results changed {delta > 0 ? 'up' : delta < 0 ? 'down' : 'by'} {Math.abs(delta).toFixed(1)} percentage points from the first to latest numeric result in these reports. This is a comparison, not an explanation.</p>}
            <ul>{entries.map(({ report, result }) => <li key={`${report.id}-${result.id}`}><span>{reportPeriodTitle(report)}</span><strong>{displayReportResult(result)}</strong></li>)}</ul>
          </article>;
        })}</div>}
    </section>

    <section className="report-suggestions" aria-labelledby="report-suggestions-title">
      <div className="section-heading compact"><div><p className="eyebrow">App-generated prompts · not recorded report facts</p><h3 id="report-suggestions-title">Possible areas to practise</h3></div></div>
      <form className="report-threshold" onSubmit={saveThreshold}>
        <label>My optional practice threshold (%)
          <input type="number" min="1" max="100" step="any" value={thresholdText} onChange={(event) => setThresholdText(event.target.value)} placeholder="Off unless you choose a value" />
          <small>When saved, numeric school-report results and topic-based individual assessment results below this percentage can appear as practice prompts. Marks keep their original values; percentages are only used to compare results. This is your chosen prompt, not a universal pass mark.</small>
        </label>
        <div className="form-actions"><button className="button button-outline" type="submit">Save practice criteria</button>{data.practiceSuggestionThreshold !== null && <button className="text-button" type="button" onClick={() => void disableThreshold()}>Turn suggestions off</button>}</div>
      </form>
      {criteriaError && <p className="field-error" role="alert">{criteriaError}</p>}
      {data.practiceSuggestionThreshold === null
        ? <div className="soft-card"><p>Suggestions are off. Choose and save your own threshold above if you want Qalumo to flag numeric results below it.</p></div>
        : visibleSuggestions.length === 0
          ? <div className="soft-card"><p>{suggestions.length ? 'All matching suggestions are currently dismissed. You can show them again below.' : `No recorded numeric subject results are below your chosen ${displayPercent(threshold)} threshold.`}</p></div>
          : <div className="report-suggestion-list">{visibleSuggestions.map(({ report, result, value }) => {
            const dismissed = data.dismissedReportSuggestions.includes(result.id);
            return <article className={`report-suggestion-card ${dismissed ? 'is-dismissed' : ''}`} key={result.id}>
              <span className="tag tag-amber">App-generated suggestion</span>
              <div><h4>{result.subject}{result.topic ? ` · ${result.topic}` : ''}</h4><p>{reportPeriodTitle(report)} · {displayReportResult(result)}</p><p>Why shown: this recorded numeric result is {displayPercent(value)}, below the caregiver-selected {displayPercent(threshold)} threshold.</p></div>
              <button className="text-button" type="button" onClick={() => editReport(report)}>Correct report</button>
              <button className="text-button" type="button" onClick={() => void setSuggestionDismissed(result.id, !dismissed)}>{dismissed ? 'Restore suggestion' : 'Dismiss suggestion'}</button>
            </article>;
          })}</div>}
      {data.dismissedReportSuggestions.length > 0 && <label className="show-dismissed-control"><input type="checkbox" checked={showDismissed} onChange={(event) => setShowDismissed(event.target.checked)} /> Show dismissed suggestions</label>}
    </section>

    <section className="school-report-list" aria-labelledby="saved-school-reports-title">
      <div className="section-heading compact"><div><p className="eyebrow">{sortedReports.length} saved report{sortedReports.length === 1 ? '' : 's'}</p><h3 id="saved-school-reports-title">Past and current reports</h3></div></div>
      {sortedReports.length === 0 ? <div className="empty-card small-empty"><h3>No school reports yet</h3><p>Add a report above to keep several subject results together. Historical and current years can both be recorded.</p></div>
        : <div className="saved-school-reports">{sortedReports.map((report) => <article className="saved-school-report" key={report.id}>
          <div className="saved-report-heading"><div><span className="eyebrow">Recorded school report</span><h4>{reportPeriodTitle(report)}</h4><p>{report.grade}{report.reportDate ? ` · Report date ${formatDate(report.reportDate)}` : ''}</p></div><div className="record-actions"><button className="text-button" type="button" onClick={() => editReport(report)}>Edit</button><button className="text-button danger-text" type="button" onClick={() => void deleteReport(report)}>Delete</button></div></div>
          <ul className="saved-report-subjects">{report.subjects.map((result) => <li key={result.id}><div><strong>{result.subject}</strong><small>{result.topic || 'No topic recorded'}</small></div><span className="tag">Recorded</span><p>{displayReportResult(result)}</p></li>)}</ul>
          {report.notes && <p className="saved-report-notes"><strong>Notes:</strong> {report.notes}</p>}
        </article>)}</div>}
    </section>
  </section>;
}

function buildDraft(set?: PracticeSet): { title: string; subject: string; grade: string; questions: QuestionDraft[] } {
  return {
    title: set?.title ?? '',
    subject: set?.subject ?? '',
    grade: set?.grade ?? 'Grade 8',
    questions: set?.questions.map((question) => ({
      id: question.id, prompt: question.prompt, kind: question.kind,
      options: question.options.join(', '), answer: question.answer, explanation: question.explanation,
    })) ?? [{ id: createId(), prompt: '', kind: 'short', options: '', answer: '', explanation: '' }],
  };
}

function PracticePage({ data, persist }: { data: StudyData; persist: (data: StudyData, confirmation?: string) => Promise<boolean> }) {
  const allSets = [...samplePracticeSets, ...data.practiceSets];
  const [setId, setSetId] = useState(samplePracticeSets[0].id);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { value: string; correct: boolean }>>({});
  const [answer, setAnswer] = useState('');
  const [checked, setChecked] = useState(false);
  const [finished, setFinished] = useState<PracticeAttempt | null>(null);
  const [editor, setEditor] = useState<ReturnType<typeof buildDraft> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorError, setEditorError] = useState('');
  const [feedback, setFeedback] = useState('');
  const currentSet = allSets.find((set) => set.id === setId) ?? samplePracticeSets[0];
  const question = currentSet.questions[index];
  const isSample = currentSet.id.startsWith('sample-');

  useEffect(() => {
    setIndex(0);
    setAnswers({});
    setAnswer('');
    setChecked(false);
    setFinished(null);
  }, [setId]);

  function chooseSet(value: string) {
    setSetId(value);
    setEditor(null);
    setFeedback('');
  }

  function startEditor(set?: PracticeSet) {
    const copy = set ? cloneSetForEditing(set) : undefined;
    setEditingId(set && !set.id.startsWith('sample-') ? set.id : null);
    setEditor(buildDraft(copy));
    setEditorError('');
  }

  function updateQuestion(questionIndex: number, field: keyof QuestionDraft, value: string) {
    setEditor((current) => current ? ({
      ...current,
      questions: current.questions.map((item, itemIndex) => itemIndex === questionIndex ? { ...item, [field]: value } : item),
    }) : current);
  }

  function removeQuestion(questionIndex: number) {
    setEditor((current) => current ? ({ ...current, questions: current.questions.filter((_, itemIndex) => itemIndex !== questionIndex) }) : current);
  }

  async function saveSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !editor.title.trim() || !editor.subject.trim()) {
      setEditorError('Add a title and subject for this set.');
      return;
    }
    if (!GRADES.includes(editor.grade as typeof GRADES[number])) {
      setEditorError('Choose a grade for this set.');
      return;
    }
    const questions: PracticeQuestion[] = [];
    for (const [questionIndex, draft] of editor.questions.entries()) {
      if (!draft.prompt.trim() || !draft.answer.trim()) {
        setEditorError(`Question ${questionIndex + 1} needs a question and an answer.`);
        return;
      }
      const options = draft.kind === 'choice' ? draft.options.split(',').map((option) => option.trim()).filter(Boolean) : [];
      if (draft.kind === 'choice' && (options.length < 2 || !options.some((option) => answerMatches(option, draft.answer)))) {
        setEditorError(`Question ${questionIndex + 1} needs at least two choices, including the correct answer.`);
        return;
      }
      questions.push({
        id: draft.id || createId(), prompt: draft.prompt.trim(), kind: draft.kind, options,
        answer: draft.answer.trim(), explanation: draft.explanation.trim(),
      });
    }
    if (questions.length === 0) {
      setEditorError('Add at least one question before saving this set.');
      return;
    }
    const savedSet: PracticeSet = { id: editingId ?? createId(), title: editor.title.trim(), subject: editor.subject.trim(), grade: editor.grade as typeof GRADES[number], questions };
    const next = { ...data, practiceSets: editingId ? data.practiceSets.map((set) => set.id === editingId ? savedSet : set) : [...data.practiceSets, savedSet] };
    if (await persist(next, 'Practice set saved on this device.')) {
      setSetId(savedSet.id);
      setEditor(null);
      setEditingId(null);
      setEditorError('');
      setFeedback('');
    }
  }

  async function deleteSet() {
    if (isSample || !window.confirm(`Delete “${currentSet.title}”? Saved practice history will remain.`)) return;
    if (await persist({ ...data, practiceSets: data.practiceSets.filter((set) => set.id !== currentSet.id) }, 'Practice set deleted.')) {
      setSetId(samplePracticeSets[0].id);
    }
  }

  function checkAnswer() {
    const correct = answerMatches(answer, question.answer);
    setAnswers((current) => ({ ...current, [question.id]: { value: answer, correct } }));
    setChecked(true);
    setFeedback(correct ? 'That is correct.' : 'Not quite. Take a moment to review the explanation.');
  }

  async function finishSet(nextAnswers = answers) {
    const incorrect = currentSet.questions.filter((item) => !nextAnswers[item.id]?.correct).map((item) => ({
      prompt: item.prompt,
      learnerAnswer: nextAnswers[item.id]?.value ?? '',
      correctAnswer: item.answer,
      explanation: item.explanation,
    }));
    const attempt: PracticeAttempt = {
      id: createId(), setTitle: currentSet.title, subject: currentSet.subject, grade: currentSet.grade,
      date: today(), score: currentSet.questions.length - incorrect.length,
      total: currentSet.questions.length, incorrect,
    };
    setFinished(attempt);
    await persist({ ...data, practiceHistory: [attempt, ...data.practiceHistory] }, 'Practice session saved.');
  }

  function checkAndContinue() {
    if (!checked) return;
    if (index < currentSet.questions.length - 1) {
      setIndex((current) => current + 1);
      setAnswer('');
      setChecked(false);
      setFeedback('');
    } else {
      void finishSet();
    }
  }

  return <>
    <PageIntro eyebrow="Practise" title="Try a few, at your pace." description="Practise app samples or make your own sets. Answers are checked on this device; no AI or essay marking is used." action={<button className="button button-primary" onClick={() => startEditor()}>Create a set <span aria-hidden="true">+</span></button>} />
    <div className="content-card practice-content">
      <div className="practice-toolbar">
        <label className="select-label">Choose a practice set
          <select value={setId} onChange={(event) => chooseSet(event.target.value)}>{allSets.map((set) => <option key={set.id} value={set.id}>{set.title}</option>)}</select>
        </label>
        <div className="set-meta"><span className="tag">{currentSet.grade}</span><span className="tag">{currentSet.subject}</span>{isSample && <span className="tag tag-amber">App sample · not an official exam</span>}</div>
        <div className="inline-actions">
          <button className="button button-outline" onClick={() => startEditor(currentSet)}>{isSample ? 'Make an editable copy' : 'Edit set'}</button>
          {!isSample && <button className="text-button danger-text" onClick={deleteSet}>Delete set</button>}
        </div>
      </div>
      {editor ? <form className="set-editor" onSubmit={saveSet} noValidate>
        <div className="editor-heading"><div><p className="eyebrow">Caregiver / learner editor</p><h2>{editingId ? 'Edit your practice set' : 'Create an editable practice set'}</h2></div><button type="button" className="icon-button" aria-label="Close practice set editor" onClick={() => { setEditor(null); setEditorError(''); }}>×</button></div>
        <div className="form-row"><label>Set title *<input value={editor.title} onChange={(event) => setEditor((current) => current ? { ...current, title: event.target.value } : current)} required /></label><label>Subject *<input value={editor.subject} list="practice-subjects" onChange={(event) => setEditor((current) => current ? { ...current, subject: event.target.value } : current)} required /></label><datalist id="practice-subjects">{subjectSuggestions.map((subject) => <option key={subject} value={subject} />)}</datalist><label>Grade *<select value={editor.grade} onChange={(event) => setEditor((current) => current ? { ...current, grade: event.target.value } : current)}>{GRADES.map((grade) => <option key={grade}>{grade}</option>)}</select></label></div>
        {editor.questions.map((item, itemIndex) => <div className="question-editor" key={item.id}><div className="question-editor-head"><h3>Question {itemIndex + 1}</h3>{editor.questions.length > 1 && <button type="button" className="text-button danger-text" onClick={() => removeQuestion(itemIndex)}>Remove</button>}</div><label>Question *<textarea rows={2} value={item.prompt} onChange={(event) => updateQuestion(itemIndex, 'prompt', event.target.value)} /></label><div className="form-row"><label>Answer type<select value={item.kind} onChange={(event) => updateQuestion(itemIndex, 'kind', event.target.value)}><option value="short">Short answer / number</option><option value="choice">Multiple choice</option></select></label><label>Correct answer *<input value={item.answer} onChange={(event) => updateQuestion(itemIndex, 'answer', event.target.value)} /></label></div>{item.kind === 'choice' && <label>Choices, separated by commas *<input value={item.options} onChange={(event) => updateQuestion(itemIndex, 'options', event.target.value)} placeholder="e.g. 10, 20, 25, 40" /></label>}<label>Explanation (optional)<textarea rows={2} value={item.explanation} onChange={(event) => updateQuestion(itemIndex, 'explanation', event.target.value)} /></label></div>)}
        <button type="button" className="button button-outline" onClick={() => setEditor((current) => current ? { ...current, questions: [...current.questions, { id: createId(), prompt: '', kind: 'short', options: '', answer: '', explanation: '' }] } : current)}>Add a question</button>
        {editorError && <p className="field-error" role="alert">{editorError}</p>}
        <div className="form-actions"><button className="button button-primary" type="submit">Save practice set</button><button className="button button-outline" type="button" onClick={() => setEditor(null)}>Cancel</button></div>
        <p className="small-print">Short answers are checked by a simple text or number comparison. Questions and content are not verified against CAPS.</p>
      </form> : finished ? <div className="finished-panel">
        <span className="completion-mark" aria-hidden="true">✓</span><p className="eyebrow">Practice complete</p><h2>{finished.score} of {finished.total} correct</h2><p>You can review every answer below. This score is saved on this device only.</p>
        {finished.incorrect.length > 0 ? <div className="review-list"><h3>Review these answers</h3>{finished.incorrect.map((item, itemIndex) => <article className="review-card" key={`${item.prompt}-${itemIndex}`}><h4>{item.prompt}</h4><p><strong>Your answer:</strong> {item.learnerAnswer || 'No answer entered'}</p><p><strong>Correct answer:</strong> {item.correctAnswer}</p>{item.explanation && <p>{item.explanation}</p>}</article>)}</div> : <div className="soft-card"><p>All answers correct. Nice steady work.</p></div>}
        <button className="button button-primary" onClick={() => { setFinished(null); setAnswers({}); setIndex(0); setAnswer(''); setChecked(false); setFeedback(''); }}>Practise this set again</button>
      </div> : <div className="question-panel">
        <div className="question-progress"><span>Question {index + 1} of {currentSet.questions.length}</span><div className="progress-track"><span style={{ width: `${((index + 1) / currentSet.questions.length) * 100}%` }} /></div></div>
        <h2>{question.prompt}</h2>
        {question.kind === 'choice' ? <fieldset className="choice-list"><legend className="sr-only">Choose one answer</legend>{question.options.map((option) => <label key={option} className={`choice-option ${answer === option ? 'selected' : ''}`}><input type="radio" name={`answer-${question.id}`} value={option} checked={answer === option} disabled={checked} onChange={() => setAnswer(option)} /><span>{option}</span></label>)}</fieldset> : <label className="answer-field">Your answer<input autoComplete="off" disabled={checked} value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !checked && answer.trim()) { event.preventDefault(); checkAnswer(); } }} /></label>}
        {checked && <div className={`answer-feedback ${answers[question.id]?.correct ? 'feedback-correct' : 'feedback-review'}`} role="status"><strong>{feedback}</strong><p><span>Correct answer: {question.answer}</span>{question.explanation && <> · {question.explanation}</>}</p></div>}
        <div className="question-actions">{!checked ? <button className="button button-primary" disabled={!answer.trim()} onClick={checkAnswer}>Check answer</button> : <button className="button button-primary" onClick={checkAndContinue}>{index === currentSet.questions.length - 1 ? 'Finish and review' : 'Next question'} <span aria-hidden="true">→</span></button>}</div>
      </div>}
    </div>
    {data.practiceHistory.length > 0 && <section className="history-section"><div className="section-heading compact"><div><p className="eyebrow">On this device</p><h2>Recent practice</h2></div></div><div className="history-list">{data.practiceHistory.slice(0, 5).map((attempt) => <article key={attempt.id}><div><strong>{attempt.setTitle}</strong><small>{attempt.subject} · {formatDate(attempt.date)}</small></div><span className="percent-pill">{attempt.score} / {attempt.total}</span></article>)}</div></section>}
    <div className="notice notice-info"><span>The sample set is a small app-created example, not an official exam or full curriculum. Caregivers can check and edit all practice content.</span></div>
  </>;
}

function HelpPage({ setPage }: { setPage: (page: Page) => void }) {
  return <article className="help-page" aria-labelledby="help-title">
    <PageIntro
      eyebrow="Help"
      title="How Qalumo works"
      description="A plain-language guide to setting up, recording results, practising, and keeping useful resources."
      action={<><a className="button button-primary" href={LIVE_QALUMO_APP_URL} target="_blank" rel="noreferrer">Open Qalumo</a><button className="button button-outline" type="button" onClick={() => window.print()}>Print this guide</button></>}
    />
    <div className="help-content">
      <section className="content-card help-start" aria-labelledby="start-here-title">
        <h2 id="start-here-title">Start here</h2>
        <p>Tick items as you go. This checklist is only for this screen and is not saved.</p>
        <ul className="help-checklist">
          <li><label><input type="checkbox" /> Set up or check the learner details in Settings.</label></li>
          <li><label><input type="checkbox" /> Add a school report or individual assessment result in Results.</label></li>
          <li><label><input type="checkbox" /> Try a practice set and review the answers.</label></li>
          <li><label><input type="checkbox" /> Save homework and try an editable study step.</label></li>
          <li><label><input type="checkbox" /> Create a study test or select material for a library package.</label></li>
          <li><label><input type="checkbox" /> Save a useful note or a caregiver-reviewed video link in Resources.</label></li>
          <li><label><input type="checkbox" /> Export a full-app backup when you want a separate copy of learner progress.</label></li>
        </ul>
        <div className="help-quick-links" aria-label="Go to a Qalumo section">
          <button type="button" className="button button-primary" onClick={() => setPage('Settings')}>Learner profile</button>
          <button type="button" className="button button-outline" onClick={() => setPage('Results')}>Results</button>
          <button type="button" className="button button-outline" onClick={() => setPage('Practise')}>Practise</button>
          <button type="button" className="button button-outline" onClick={() => setPage('Homework')}>Homework</button>
          <button type="button" className="button button-outline" onClick={() => setPage('Study library')}>Study library</button>
          <button type="button" className="button button-outline" onClick={() => setPage('Resources')}>Resources</button>
        </div>
      </section>

      <section className="content-card help-section" aria-labelledby="learner-setup-title">
        <h2 id="learner-setup-title">1. Set up a learner profile</h2>
        <ol>
          <li>Open <strong>Settings</strong> from the main navigation.</li>
          <li>Enter a name or nickname if you want one, choose a grade and preferred language, and enter school subjects.</li>
          <li>Select <strong>Save profile</strong>. You can return to Settings to check or edit these details.</li>
        </ol>
        <p><strong>One learner profile per browser:</strong> this version keeps one profile and one set of study records in each browser on this device. It does not offer a list of learner profiles or a profile switch. The shared video library is separate and can be reused with that profile.</p>
      </section>

      <section className="content-card help-section" aria-labelledby="results-guide-title">
        <h2 id="results-guide-title">2. Add results and read practice suggestions</h2>
        <ol>
          <li>Open <strong>Results</strong> and choose <strong>Add a result</strong>.</li>
          <li>Enter the subject, mark earned, total possible, and date. A topic and note are optional. Save the result.</li>
          <li>Qalumo shows the original mark and calculates a percentage. Optional practice prompts use only the threshold a caregiver chooses in Results; suggestions are off until a threshold is set.</li>
        </ol>
        <p>A topic is used only when it was entered. A suggestion is a prompt for practice, not a diagnosis or a judgment about the learner. The chosen threshold is not a universal pass mark.</p>
      </section>

      <section className="content-card help-section" aria-labelledby="school-report-help-title">
        <h2 id="school-report-help-title">3. Enter school report results</h2>
        <ol>
          <li>Open <strong>Results → School report results → Add school report</strong>.</li>
          <li>Enter the school year, one of Terms 1–4, grade, and any optional period label, report date, or notes.</li>
          <li>Add a subject row for each subject on the report. Choose the format printed on the report: mark earned and total possible, percentage, or text achievement/comment. A topic is optional; leave it blank for subject-only results.</li>
          <li>Save the report. Past years stay alongside current reports. Use <strong>Edit</strong> to correct a report or <strong>Delete</strong> to remove it after confirmation.</li>
        </ol>
        <p>Report cards and trend lists are recorded facts. Optional practice prompts are labelled separately and explain which selected threshold and recorded result caused a prompt. A caregiver can edit the report or dismiss a prompt; dismissing it does not change the report value.</p>
      </section>

      <section className="content-card help-section" aria-labelledby="practice-guide-title">
        <h2 id="practice-guide-title">4. Practise and review</h2>
        <ol>
          <li>Open <strong>Practise</strong> and choose a sample set or a set entered by a caregiver.</li>
          <li>Answer each question and select <strong>Check answer</strong>. Qalumo shows whether it matches the stored answer and any explanation.</li>
          <li>Finish the set to see the score and review incorrect answers. Practice history is saved on this device.</li>
        </ol>
        <p>Answer checking compares the response with the stored answer; it does not mark essays or understand every equivalent explanation. Sample content is not claimed to be an official exam or complete curriculum.</p>
      </section>

      <section className="content-card help-section" aria-labelledby="homework-guide-title">
        <h2 id="homework-guide-title">5. Add and understand homework</h2>
        <ol>
          <li>Open <strong>Homework → Add homework</strong>. Choose a TXT, text-based PDF, or DOCX file, or paste/type text. File text is extracted locally in this browser; Qalumo does not upload it. Files larger than 20 MB are not accepted.</li>
          <li>Review and correct the extracted text. Scanned or image-only PDFs may produce no text because OCR is not included; paste or type the assignment instead.</li>
          <li>Add a title, grade, subject, due date if useful, and your notes. Save. You can reopen, edit, archive, or delete an item; deletion asks before also removing its linked breakdown and prompts.</li>
          <li>Use the editable starter steps, questions, and brainstorming prompts without AI. They are generic templates; edit them to match the teacher’s instructions.</li>
          <li>Optional AI buttons can explain wording, list instructions and deliverables, suggest steps, make comprehension questions, or brainstorm. Each request requires confirmation and sends only the selected homework text and chosen task. Check suggestions against class instructions and trusted materials, and do your own work.</li>
        </ol>
        <p>AI actions require an online API or a separately installed local compatible service. The optional LLM feature has <strong>not been tested end-to-end in this project</strong>; requests may fail. Qalumo does not claim AI works offline. AI-generated explanations and questions are not guaranteed correct.</p>
      </section>

      <section className="content-card help-section" aria-labelledby="study-library-guide-title">
        <h2 id="study-library-guide-title">6. Build and practise a study library</h2>
        <ol>
          <li>Open <strong>Study library → Create practice test</strong> to add questions yourself. Choose grade, subject, optional topic, source, and whether it is a practice test or question set.</li>
          <li>Use multiple choice or True/False for automatic answer checking. Short answers can use an answer key or a rubric labelled for self-marking. Self-marked questions are excluded from the numeric score.</li>
          <li>In Study library, choose one saved homework item or note to request an AI question draft, if AI is configured. Confirm before sending; review and edit every draft before saving or practising. Otherwise, add questions manually.</li>
          <li>Each test keeps its source title where available, so learners can check the original homework or note. Qalumo does not provide a complete or authoritative all-subject test bank.</li>
        </ol>
      </section>

      <section className="content-card help-section" aria-labelledby="study-transfer-guide-title">
        <h2 id="study-transfer-guide-title">7. Transfer a selected study library package</h2>
        <ol>
          <li>In <strong>Study library → Select items for a package</strong>, check only the homework, notes, practice tests, or earlier practice sets you want to share.</li>
          <li>Choose <strong>Export selected study library</strong>. The package contains only those choices, not a learner profile, assessment results, practice history, settings, API keys, or videos. Homework text and learner notes can still contain private information, so review selections first.</li>
          <li>Move the downloaded JSON file to a permitted folder (for example, Google Drive), then download it on the other device. Google Drive requires internet. Choose <strong>Import study library package</strong>, inspect its preview and duplicate count, select skip or keep both, then choose merge.</li>
        </ol>
        <p>Import adds selected library content without replacing learner data or existing items. This is manual file transfer, not automatic/background syncing. A public app URL lets people open the app; it does not give them access to another device’s IndexedDB. A person using the same browser profile or device may be able to access local app data.</p>
      </section>

      <section className="content-card help-section" aria-labelledby="video-guide-title">
        <h2 id="video-guide-title">8. Find and manage video lessons</h2>
        <ol>
          <li>Open <strong>Resources</strong> and go to <strong>Video lessons</strong>. Search by words or filter by grade, subject, topic, language, or review status.</li>
          <li>A caregiver selects <strong>Add a video lesson</strong> and enters its title, HTTP/HTTPS link, source, grade, subject, topic, language, and a short note.</li>
          <li>New links start as <strong>Needs review</strong>. A caregiver should open and check the original video before changing the status to <strong>Reviewed</strong>. This label records the caregiver’s review; it is not an independent verification by Qalumo.</li>
          <li>Use <strong>Edit</strong> to change a saved entry or <strong>Delete</strong> to remove it after confirming. <strong>Open video</strong> opens the original link in a new tab; Qalumo does not autoplay or save video files.</li>
        </ol>
      </section>

      <section className="content-card help-section" aria-labelledby="transfer-guide-title">
        <h2 id="transfer-guide-title">9. Transfer the video library</h2>
        <ol>
          <li>In Resources, use <strong>Export video library</strong> to download a versioned file containing video links and notes only.</li>
          <li>Move that file to the other device using a method you choose, then choose <strong>Import video library</strong> in its Resources area. This video-only file does not include homework, notes, tests, or learner progress.</li>
          <li>Check the preview and choose <strong>Merge video library</strong>. Import adds new video links and skips duplicate URLs; it does not replace existing entries or transfer learner profiles, assessment results, or practice history.</li>
        </ol>
        <p>This creates a file for manual transfer. Qalumo does not automatically sync devices.</p>
      </section>

      <section className="content-card help-section" aria-labelledby="backup-guide-title">
        <h2 id="backup-guide-title">10. Full-app backup and restore</h2>
        <ol>
          <li>Open <strong>Settings → Full app backup and restore</strong>, then select <strong>Export full-app backup</strong> to save learner records, homework, study tests/history, notes, and the video library.</li>
          <li>To restore, select <strong>Import full-app backup</strong> and choose a Qalumo backup file.</li>
          <li>Read the confirmation carefully: restoring replaces the current learner data, homework, resources, practice and study-test history, and video library on this device with the backup contents. Export anything you may need before continuing.</li>
        </ol>
        <p>AI settings and API keys are not in the backup. Keep backup files private; anyone with a copy may be able to read its learner records.</p>
      </section>

      <section className="content-card help-section" aria-labelledby="offline-guide-title">
        <h2 id="offline-guide-title">11. What works offline?</h2>
        <p>Qalumo’s production build passed simulated desktop-browser checks: after opening online and loading the app assets, the app shell, styled pages, saved records, and TXT/PDF/DOCX extraction were available in a browser reload with the local preview server stopped. This is a simulated desktop-browser check, not a physical-device test.</p>
        <p>Saved learner records and resources are stored locally in the browser on that device. They are not automatically synced between a phone and laptop. To share selected homework, notes, or tests, use <strong>Study library → Export selected study library</strong>, move the file yourself, and import it on the other device. This is a manual file transfer.</p>
        <p>Video playback, new web research, and online AI require internet. Video playback also depends on the original video remaining available. The optional LLM feature has <strong>not been tested end-to-end</strong>; do not assume it works offline.</p>
        <div className="ai-disclosure"><strong>AI status: not yet tested end-to-end</strong><p>AI may need internet or a separately configured local compatible service and may fail. Do not assume it works offline. Check generated explanations, questions, and answers against class instructions and trusted learning materials; they are not guaranteed correct. Never put API keys in files you export.</p></div>
      </section>

      <section className="content-card help-section" aria-labelledby="install-guide-title">
        <h2 id="install-guide-title">12. Install Qalumo on a device</h2>
        <div className="install-prerequisite"><strong>Live app: <a href={LIVE_QALUMO_APP_URL} target="_blank" rel="noreferrer">Open Qalumo</a></strong><p>Installation requires opening this HTTPS link in a compatible browser. The app must load online at least once before you test it offline.</p></div>
        <p><strong>Important:</strong> <code>localhost</code> works only on the device running the local development server. A laptop’s localhost address is not the phone’s app address. A local HTTP network address (for example, a laptop IP on Wi-Fi) may help check the layout temporarily, but it is not the HTTPS release needed for normal PWA installation/offline testing.</p>
        <h3>Android phone with Chrome</h3>
        <ol>
          <li>Open <a href={LIVE_QALUMO_APP_URL} target="_blank" rel="noreferrer">the Qalumo HTTPS app address</a> on the phone in Chrome while online.</li>
          <li>Open Chrome’s three-dot menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. Menu wording can differ by browser/version.</li>
          <li>Follow the prompt and confirm the installation. Open the installed app online at least once so its app files can load.</li>
          <li>Only then try offline mode. Previously saved Qalumo records/resources and the cached app shell may work; video playback and new internet research still need internet.</li>
        </ol>
        <h3>Windows 10 with Chrome or Edge</h3>
        <ol>
          <li>Open <a href={LIVE_QALUMO_APP_URL} target="_blank" rel="noreferrer">the Qalumo HTTPS app address</a> in Chrome or Edge while online.</li>
          <li>If the browser offers an install icon in the address bar or an <strong>Install this site as an app</strong> menu item, choose it and confirm. Browser support and menu wording can vary.</li>
          <li>After installation, launch Qalumo from the Windows Start menu, taskbar shortcut, or the app shortcut created by the browser. Open it online once before checking offline behavior.</li>
        </ol>
        <p>The simulated desktop-browser offline checks passed, but installation and offline use have <strong>not yet been tested on the physical Redmi phone or Windows 10 laptop</strong>. Phone and laptop data remain separate. A study-library package is the manual method for sharing selected study items; a video-library file transfers video links only.</p>
      </section>

      <section className="content-card help-section" aria-labelledby="device-compatibility-title">
        <h2 id="device-compatibility-title">13. Device compatibility</h2>
        <ul className="compatibility-list">
          <li><strong>Intended phone test device:</strong> Android 13 Redmi, 4 GB RAM, MediaTek Helio G85.</li>
          <li><strong>Intended computer test device:</strong> Windows 10 laptop, 6 GB RAM.</li>
        </ul>
        <p>These are planned test targets, not verified minimum requirements or a guarantee of performance. Actual performance depends on the browser, free memory and storage, and enabled features. Local AI may not run well on the phone.</p>
        <p>We still need to test installation and offline behavior on the actual phone and laptop. Passing a simulated desktop-browser check does not confirm behavior on those devices.</p>
      </section>

      <section className="content-card help-section" aria-labelledby="publish-guide-title">
        <h2 id="publish-guide-title">How updates are published</h2>
        <p>The live static app is hosted on Cloudflare Pages at <a href={LIVE_QALUMO_APP_URL} target="_blank" rel="noreferrer">qalumo-study.pages.dev</a>. To publish an update, first run <code>npm run build</code>. Then check this Qalumo project’s deployment method in the Cloudflare Pages dashboard and publish the new <code>dist</code> build using that method.</p>
        <p>This project’s source files do not contain a Cloudflare Pages or GitHub Actions deployment workflow, so automatic GitHub deployment is not confirmed. If the Pages project is configured for Direct Upload, upload the new <code>dist</code> folder from the dashboard. If it is connected to a Git repository, follow the branch/build settings shown in Pages and verify the resulting deployment there. Do not assume a Git push publishes an update unless that integration is configured and its deployment succeeds.</p>
        <p>Cloudflare account requirements, plan limits, and pricing can change; check the current terms in the dashboard. Do not put learner data or API keys in a public deployment.</p>
      </section>

      <section className="content-card help-section help-glossary" aria-labelledby="glossary-title">
        <h2 id="glossary-title">A few useful words</h2>
        <dl>
          <div><dt>Topic</dt><dd>A smaller area within a subject, such as fractions in Mathematics. Qalumo uses only the topic entered with a result or resource.</dd></div>
          <div><dt>Reviewed</dt><dd>A caregiver has checked the original video link and marked it. Qalumo does not verify its content, captions, or curriculum alignment.</dd></div>
          <div><dt>Video library</dt><dd>The caregiver-managed collection of video links and notes saved on this device, shared separately from learner records.</dd></div>
          <div><dt>Study library package</dt><dd>A versioned file of only homework, notes, and practice tests that a caregiver or learner explicitly selects to transfer.</dd></div>
          <div><dt>Import</dt><dd>Bring records from a file into Qalumo. Study-library and video-library imports merge their own content; they do not transfer the learner profile or progress.</dd></div>
          <div><dt>Full-app backup</dt><dd>A JSON copy of learner records and the video library. Restoring it can replace the current records on this device.</dd></div>
        </dl>
      </section>
      <p className="help-no-promises">Qalumo is a record-keeping and practice tool. It cannot promise a particular learning or school result.</p>
    </div>
  </article>;
}

function ResourcesPage({ data, videoResources, persist, persistVideoLibrary, aiSettings, apiKey, setError, setMessage }: {
  data: StudyData;
  videoResources: VideoResource[];
  persist: (data: StudyData, confirmation?: string) => Promise<boolean>;
  persistVideoLibrary: (videos: VideoResource[], confirmation?: string) => Promise<boolean>;
  aiSettings: AiSettings;
  apiKey: string;
  setError: (message: string) => void;
  setMessage: (message: string) => void;
}) {
  const [draft, setDraft] = useState<ResourceDraft>(emptyResourceDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const update = (field: keyof ResourceDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return data.resources;
    return data.resources.filter((resource) => [resource.title, resource.subject, resource.grade, resource.topic, resource.source, resource.text].some((value) => value.toLocaleLowerCase().includes(term)));
  }, [data.resources, search]);

  async function saveResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.title.trim() || !draft.subject.trim() || !draft.text.trim() || !GRADES.includes(draft.grade as typeof GRADES[number])) {
      setFormError('Add a title, subject, grade, and note text before saving.');
      return;
    }
    const resource: Resource = {
      id: editingId ?? createId(), title: draft.title.trim(), subject: draft.subject.trim(),
      grade: draft.grade as typeof GRADES[number], topic: draft.topic.trim(), source: draft.source.trim(), text: draft.text.trim(),
    };
    const next = { ...data, resources: editingId ? data.resources.map((item) => item.id === editingId ? resource : item) : [resource, ...data.resources] };
    if (await persist(next, editingId ? 'Resource updated.' : 'Resource saved for offline use.')) {
      setDraft(emptyResourceDraft());
      setEditingId(null);
      setShowForm(false);
      setFormError('');
    }
  }

  async function removeResource(resource: Resource) {
    if (!window.confirm(`Delete “${resource.title}”? This cannot be undone.`)) return;
    if (await persist({ ...data, resources: data.resources.filter((item) => item.id !== resource.id) }, 'Resource deleted.')) {
      if (editingId === resource.id) {
        setDraft(emptyResourceDraft());
        setEditingId(null);
        setShowForm(false);
      }
    }
  }

  return <>
    <PageIntro eyebrow="Resources" title="Keep useful notes close." description="Save text notes and caregiver-added video links. Qalumo does not fetch or recommend videos." action={<div className="resource-actions"><button className="button button-outline" onClick={() => { setDraft(emptyResourceDraft()); setEditingId(null); setShowForm(true); }}>Add a text note</button><button className="button button-primary" onClick={() => document.getElementById('video-lessons')?.scrollIntoView({ behavior: 'smooth' })}>Go to video lessons ↓</button></div>} />
    <div className="resource-search"><label htmlFor="resource-search">Search saved notes</label><div className="search-control"><span aria-hidden="true">⌕</span><input id="resource-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, subject, topic, or text" /></div><small>Search works offline and covers only notes saved in this app on this device.</small></div>
    {showForm && <form className="form-card resource-form" onSubmit={saveResource} noValidate><div className="editor-heading"><div><p className="eyebrow">Saved on this device</p><h2>{editingId ? 'Edit resource' : 'Add text resource'}</h2></div><button type="button" className="icon-button" aria-label="Close resource form" onClick={() => { setShowForm(false); setFormError(''); }}>×</button></div><div className="form-row"><label>Title *<input value={draft.title} onChange={(event) => update('title', event.target.value)} required /></label><label>Subject *<input list="resource-subjects" value={draft.subject} onChange={(event) => update('subject', event.target.value)} required /></label><datalist id="resource-subjects">{subjectSuggestions.map((subject) => <option key={subject} value={subject} />)}</datalist></div><div className="form-row"><label>Grade *<select value={draft.grade} onChange={(event) => update('grade', event.target.value)}>{GRADES.map((grade) => <option key={grade}>{grade}</option>)}</select></label><label>Topic (optional)<input value={draft.topic} onChange={(event) => update('topic', event.target.value)} /></label></div><label>Source or reference (optional)<input value={draft.source} onChange={(event) => update('source', event.target.value)} placeholder="e.g. class notes, page 12" /></label><label>Note text *<textarea rows={6} value={draft.text} onChange={(event) => update('text', event.target.value)} required placeholder="Type or paste study notes here. They will be stored on this device." /></label>{formError && <p className="field-error" role="alert">{formError}</p>}<div className="form-actions"><button className="button button-primary" type="submit">{editingId ? 'Save changes' : 'Save resource'}</button><button className="button button-outline" type="button" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancel</button></div></form>}
    {data.resources.length === 0 ? <div className="empty-card"><span className="empty-icon">R</span><h2>No notes saved yet</h2><p>Add your own class notes, study summaries, or references. Resources are entered by typing or pasting text; Homework can extract text from supported PDF files. New web research needs internet.</p><button className="button button-primary" onClick={() => setShowForm(true)}>Add your first resource</button></div> : filtered.length === 0 ? <div className="empty-card"><h2>No matching notes</h2><p>Try a different search, or save a note with this topic.</p><button className="button button-outline" onClick={() => setSearch('')}>Clear search</button></div> : <div className="resource-grid">{filtered.map((resource) => <article className="resource-card" key={resource.id}><div className="resource-tags"><span className="tag">{resource.grade}</span><span className="tag">{resource.subject}</span></div><h2>{resource.title}</h2>{resource.topic && <p className="resource-topic">{resource.topic}</p>}<p className="resource-body">{resource.text}</p>{resource.source && <p className="resource-source">Source: {resource.source}</p>}<div className="record-actions"><button className="text-button" onClick={() => { setDraft({ title: resource.title, subject: resource.subject, grade: resource.grade, topic: resource.topic, source: resource.source, text: resource.text }); setEditingId(resource.id); setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button><button className="text-button danger-text" onClick={() => removeResource(resource)}>Delete</button></div><AiAssistant key={resource.id} context={`Selected saved resource: ${resource.title}\nSubject: ${resource.subject}\nGrade: ${resource.grade}\nTopic: ${resource.topic || 'not specified'}\nResource text:\n${resource.text}`} settings={aiSettings} apiKey={apiKey} setError={setError} setMessage={setMessage} /></article>)}</div>}
    <VideoLessons videos={videoResources} persistVideoLibrary={persistVideoLibrary} setError={setError} setMessage={setMessage} />
  </>;
}

function VideoLessons({ videos, persistVideoLibrary, setError, setMessage }: {
  videos: VideoResource[];
  persistVideoLibrary: (videos: VideoResource[], confirmation?: string) => Promise<boolean>;
  setError: (message: string) => void;
  setMessage: (message: string) => void;
}) {
  const [draft, setDraft] = useState<VideoDraft>(emptyVideoDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState('');
  const [search, setSearch] = useState('');
  const [filterGrade, setFilterGrade] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterTopic, setFilterTopic] = useState('');
  const [filterLanguage, setFilterLanguage] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [libraryPreview, setLibraryPreview] = useState<{ videos: VideoResource[]; invalidCount: number; addedCount: number; skippedCount: number } | null>(null);
  const update = (field: keyof VideoDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));

  const videoSubjects = [...new Set(videos.map((video) => video.subject))].sort();
  const filteredVideos = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const topic = filterTopic.trim().toLocaleLowerCase();
    const language = filterLanguage.trim().toLocaleLowerCase();
    return videos.filter((video) => {
      const matchesSearch = !term || [video.title, video.url, video.source, video.grade, video.subject, video.topic, video.language, video.note, video.reviewStatus]
        .some((value) => value.toLocaleLowerCase().includes(term));
      return matchesSearch
        && (!filterGrade || video.grade === filterGrade)
        && (!filterSubject || video.subject === filterSubject)
        && (!topic || video.topic.toLocaleLowerCase().includes(topic))
        && (!language || video.language.toLocaleLowerCase().includes(language))
        && (!filterStatus || video.reviewStatus === filterStatus);
    }).sort((a, b) => a.title.localeCompare(b.title));
  }, [videos, search, filterGrade, filterSubject, filterTopic, filterLanguage, filterStatus]);

  async function saveVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.title.trim() || !draft.url.trim() || !draft.source.trim() || !draft.subject.trim()
      || !draft.topic.trim() || !draft.language.trim() || !draft.note.trim()) {
      setFormError('Complete every field before saving the video lesson.');
      return;
    }
    if (!isHttpUrl(draft.url)) {
      setFormError('Enter a valid video URL that starts with http:// or https://. URLs containing embedded credentials are not allowed.');
      return;
    }
    if (!GRADES.includes(draft.grade as typeof GRADES[number])) {
      setFormError('Choose a valid grade from Grade R to Grade 12.');
      return;
    }
    const video: VideoResource = {
      id: editingId ?? createId(),
      title: draft.title.trim(),
      url: draft.url.trim(),
      source: draft.source.trim(),
      grade: draft.grade as typeof GRADES[number],
      subject: draft.subject.trim(),
      topic: draft.topic.trim(),
      language: draft.language.trim(),
      note: draft.note.trim(),
      reviewStatus: draft.reviewStatus,
    };
    const nextVideos = editingId
      ? videos.map((item) => item.id === editingId ? video : item)
      : [...videos, video];
    if (await persistVideoLibrary(nextVideos, editingId ? 'Video lesson updated.' : 'Video lesson saved on this device.')) {
      setDraft(emptyVideoDraft());
      setEditingId(null);
      setShowForm(false);
      setFormError('');
    }
  }

  function editVideo(video: VideoResource) {
    setDraft({
      title: video.title,
      url: video.url,
      source: video.source,
      grade: video.grade,
      subject: video.subject,
      topic: video.topic,
      language: video.language,
      note: video.note,
      reviewStatus: video.reviewStatus,
    });
    setEditingId(video.id);
    setShowForm(true);
    setFormError('');
    document.getElementById('video-lessons')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function deleteVideo(video: VideoResource) {
    if (!window.confirm(`Delete “${video.title}” from saved video lessons? This cannot be undone.`)) return;
    if (await persistVideoLibrary(videos.filter((item) => item.id !== video.id), 'Video lesson deleted.')) {
      if (editingId === video.id) {
        setEditingId(null);
        setDraft(emptyVideoDraft());
        setShowForm(false);
      }
    }
  }

  function clearFilters() {
    setSearch('');
    setFilterGrade('');
    setFilterSubject('');
    setFilterTopic('');
    setFilterLanguage('');
    setFilterStatus('');
  }

  function exportVideoLibrary() {
    const file: VideoLibraryFile = { format: 'Qalumo video library', version: 1, exportedAt: new Date().toISOString(), videos };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qalumo-video-library-${today()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function previewVideoLibrary(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const validation = validateVideoLibrary(parsed);
      if (!validation.file) {
        setLibraryPreview(null);
        setError(validation.error ?? 'This video library could not be validated.');
        return;
      }
      const plan = planVideoLibraryImport(validation.file.videos, videos);
      setLibraryPreview({
        videos: validation.file.videos,
        invalidCount: validation.invalidCount,
        addedCount: plan.additions.length,
        skippedCount: plan.skipped,
      });
      setFormError('');
      setError('');
    } catch {
      setLibraryPreview(null);
      setError('This file could not be read as JSON. Choose a valid Qalumo video library file.');
    }
  }

  async function importVideoLibrary() {
    if (!libraryPreview) return;
    const plan = planVideoLibraryImport(libraryPreview.videos, videos);
    if (plan.additions.length === 0) {
      setLibraryPreview(null);
      setMessage(`No new video links were added. ${plan.skipped} duplicate(s) skipped${libraryPreview.invalidCount ? `; ${libraryPreview.invalidCount} invalid record(s) ignored` : ''}. Learner data was not changed.`);
      setError('');
      return;
    }
    if (await persistVideoLibrary(
      [...videos, ...plan.additions],
      `Video library merged: ${plan.additions.length} added, ${plan.skipped} duplicates skipped, ${libraryPreview.invalidCount} invalid records ignored. Learner data was not changed.`,
    )) {
      setLibraryPreview(null);
      setFormError('');
    }
  }

  return <section className="video-lessons-section" id="video-lessons">
    <div className="section-heading compact video-section-heading">
      <div><p className="eyebrow">Caregiver-added links only</p><h2>Video lessons</h2></div>
      <div className="resource-actions video-library-actions">
        <button className="button button-primary" type="button" onClick={() => { setDraft(emptyVideoDraft()); setEditingId(null); setFormError(''); setShowForm(true); }}>Add a video lesson <span aria-hidden="true">+</span></button>
        <button className="button button-outline" type="button" onClick={exportVideoLibrary}>Export video library</button>
        <label className="button button-outline file-button">Import video library<input type="file" accept=".json,application/json" onChange={previewVideoLibrary} /></label>
      </div>
    </div>
    <div className="notice notice-info video-offline-note"><span>Qalumo saves video titles, links, and caregiver notes—not video files. Playback needs internet and the original video to remain available. No videos are automatically searched or recommended.</span></div>
    <p className="field-hint video-library-hint">Export creates a versioned file with video links and notes only; it can be transferred to another device. Import previews then merges videos, skips duplicate links, and does not transfer or change learner progress. Qalumo does not sync devices automatically.</p>
    {libraryPreview && <div className="video-import-preview" role="region" aria-label="Video library import preview">
        <h4>Import preview</h4>
        <p>{libraryPreview.addedCount} new link(s) will be added; {libraryPreview.skippedCount} duplicate(s) will be skipped; {libraryPreview.invalidCount} invalid record(s) will be ignored.</p>
        <div className="form-actions"><button className="button button-primary" type="button" onClick={importVideoLibrary}>{libraryPreview.addedCount ? 'Merge video library' : 'Finish — no new links'}</button><button className="button button-outline" type="button" onClick={() => setLibraryPreview(null)}>Cancel</button></div>
      </div>}
    {showForm && <form className="form-card video-form" onSubmit={saveVideo} noValidate>
      <div className="editor-heading"><div><p className="eyebrow">Caregiver-managed resource</p><h3>{editingId ? 'Edit video lesson' : 'Add video lesson'}</h3></div><button type="button" className="icon-button" aria-label="Close video form" onClick={() => { setShowForm(false); setFormError(''); }}>×</button></div>
      <div className="form-row"><label>Title *<input maxLength={160} value={draft.title} onChange={(event) => update('title', event.target.value)} required /></label><label>Video URL *<input type="url" value={draft.url} onChange={(event) => update('url', event.target.value)} placeholder="https://…" required /><small>Only HTTP or HTTPS links are allowed. The original video opens in a new tab; Qalumo does not embed or download it.</small></label></div>
      <div className="form-row"><label>Source / platform name *<input maxLength={100} value={draft.source} onChange={(event) => update('source', event.target.value)} placeholder="e.g. YouTube, school website" required /></label><label>Subject *<input list="video-subjects" maxLength={100} value={draft.subject} onChange={(event) => update('subject', event.target.value)} required /><datalist id="video-subjects">{subjectSuggestions.map((subject) => <option key={subject} value={subject} />)}{videoSubjects.map((subject) => <option key={subject} value={subject} />)}</datalist></label></div>
      <div className="form-row"><label>Grade *<select value={draft.grade} onChange={(event) => update('grade', event.target.value)}>{GRADES.map((grade) => <option key={grade}>{grade}</option>)}</select></label><label>Topic *<input maxLength={120} value={draft.topic} onChange={(event) => update('topic', event.target.value)} required /></label></div>
      <div className="form-row"><label>Language *<input list="video-languages" maxLength={80} value={draft.language} onChange={(event) => update('language', event.target.value)} placeholder="e.g. English" required /><datalist id="video-languages">{LANGUAGES.map((language) => <option key={language} value={language} />)}</datalist></label><label>Review status *<select value={draft.reviewStatus} onChange={(event) => update('reviewStatus', event.target.value)}>{VIDEO_REVIEW_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label></div>
      <label>Caregiver note on what it explains *<textarea rows={3} maxLength={500} value={draft.note} onChange={(event) => update('note', event.target.value)} placeholder="Briefly describe what this video covers." required /></label>
      {formError && <p className="field-error" role="alert">{formError}</p>}
      <div className="form-actions"><button className="button button-primary" type="submit">{editingId ? 'Save changes' : 'Save video lesson'}</button><button className="button button-outline" type="button" onClick={() => { setShowForm(false); setEditingId(null); setFormError(''); }}>Cancel</button></div>
      <p className="small-print">Only mark a link Reviewed after a caregiver has checked the original video. Qalumo does not verify claims, captions, age suitability, or curriculum alignment.</p>
    </form>}
    {videos.length > 0 && <div className="video-filters">
      <label>Search video lessons<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, platform, topic, or notes" /></label>
      <label>Grade<select value={filterGrade} onChange={(event) => setFilterGrade(event.target.value)}><option value="">All grades</option>{GRADES.map((grade) => <option key={grade}>{grade}</option>)}</select></label>
      <label>Subject<select value={filterSubject} onChange={(event) => setFilterSubject(event.target.value)}><option value="">All subjects</option>{videoSubjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
      <label>Topic<input value={filterTopic} onChange={(event) => setFilterTopic(event.target.value)} placeholder="Any topic" /></label>
      <label>Language<input value={filterLanguage} onChange={(event) => setFilterLanguage(event.target.value)} placeholder="Any language" /></label>
      <label>Review status<select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}><option value="">All statuses</option>{VIDEO_REVIEW_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
      <button className="text-button" type="button" onClick={clearFilters}>Clear filters</button>
    </div>}
    {videos.length === 0 ? <div className="empty-card video-empty"><span className="empty-icon">V</span><h3>No video lessons saved</h3><p>A caregiver can add a link and mark its review status after checking the original content. Example entries are not included because Qalumo has not independently verified any videos.</p><button className="button button-outline" onClick={() => { setDraft(emptyVideoDraft()); setShowForm(true); }}>Add a video lesson</button></div>
      : filteredVideos.length === 0 ? <div className="empty-card video-empty"><h3>No matching video lessons</h3><p>Change or clear the filters to find another saved link.</p><button className="button button-outline" onClick={clearFilters}>Clear filters</button></div>
        : <div className="video-resource-grid">{filteredVideos.map((video) => <article className="video-resource-card" key={video.id}>
          <div className="video-resource-header"><span className={video.reviewStatus === 'Reviewed' ? 'tag review-reviewed' : 'tag review-needed'}>{video.reviewStatus}</span><span className="tag">{video.grade}</span></div>
          <h3>{video.title}</h3><p className="video-meta">{video.subject} · {video.topic} · {video.language}</p>
          <p className="resource-source">Source / platform: <strong>{video.source}</strong></p>
          <p className="resource-body">{video.note}</p>
          <p className="video-offline-caption">Playback requires internet and the original link to remain available. The video is not saved offline.</p>
          <div className="video-card-actions"><a className="button button-outline" href={video.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${video.title} from ${video.source} in a new tab (external link)`}>Open video ↗ <span className="external-indicator">External link</span></a><div className="record-actions"><button className="text-button" onClick={() => editVideo(video)}>Edit</button><button className="text-button danger-text" onClick={() => deleteVideo(video)}>Delete</button></div></div>
        </article>)}</div>}
  </section>;
}

function AiAssistant({ context, settings, apiKey, setError, setMessage }: {
  context: string;
  settings: AiSettings;
  apiKey: string;
  setError: (message: string) => void;
  setMessage: (message: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [requestError, setRequestError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestError('');
    setAnswer('');
    if (settings.mode === 'off') {
      setRequestError('AI assistant is off. You can continue using all other Qalumo features.');
      return;
    }
    const configError = validateAiSettings(settings);
    if (configError) {
      setRequestError(configError);
      return;
    }
    if (settings.mode === 'online' && !apiKey.trim()) {
      setRequestError('Enter your API key in Settings. It is kept only for this browser session.');
      return;
    }
    const disclosure = settings.mode === 'online'
      ? 'This request sends your question and only the selected topic or resource context to your configured online provider. The provider may charge fees and has its own data-handling terms. Qalumo does not guarantee provider privacy. Continue?'
      : `This request sends only your question and the selected topic or resource context to the local service at ${settings.baseUrl}. Continue?`;
    if (!window.confirm(disclosure)) return;

    setBusy(true);
    try {
      setAnswer(await askAi(settings, apiKey, context, question));
      setMessage('');
      setError('');
    } catch (cause) {
      setRequestError(cause instanceof Error ? cause.message : 'The assistant request could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="ai-assistant">
    <button className="ai-toggle" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>{open ? 'Close assistant' : 'Ask AI'} <span className="tag">Optional</span></button>
    {open && settings.mode === 'off'
      ? <p className="field-hint">AI assistant is off. All other Qalumo features work without it. Turn on and configure an assistant in Settings if you choose.</p>
      : open && <form onSubmit={submit}>
        <label>Your question about this selected {context.startsWith('Selected saved resource:') ? 'resource' : 'topic'}
          <textarea rows={2} maxLength={1000} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question about this material" required />
        </label>
        <button className="button button-outline" type="submit" disabled={busy || !question.trim()}>{busy ? 'Waiting for service…' : 'Send question'}</button>
      </form>}
    {open && requestError && <p className="ai-error" role="alert">{requestError}</p>}
    {open && answer && <div className="ai-answer" role="status"><strong>AI suggestion — check this against your saved learning resources.</strong><p>{answer}</p></div>}
  </section>;
}

function SettingsPage({ data, videoResources, persist, setData, setVideoResources, setError, setMessage, aiSettings, persistAiSettings, apiKey, setApiKey, setAiSettings }: {
  data: StudyData;
  videoResources: VideoResource[];
  persist: (data: StudyData, confirmation?: string) => Promise<boolean>;
  setData: (data: StudyData) => void;
  setVideoResources: (videos: VideoResource[]) => void;
  setError: (message: string) => void;
  setMessage: (message: string) => void;
  aiSettings: AiSettings;
  persistAiSettings: (settings: AiSettings) => Promise<boolean>;
  apiKey: string;
  setApiKey: (key: string) => void;
  setAiSettings: (settings: AiSettings) => void;
}) {
  const [nickname, setNickname] = useState(data.profile.nickname);
  const [grade, setGrade] = useState(data.profile.grade);
  const [language, setLanguage] = useState<Profile['language']>(data.profile.language);
  const [subjects, setSubjects] = useState(data.profile.subjects.join(', '));
  const [profileError, setProfileError] = useState('');
  const [aiDraft, setAiDraft] = useState(aiSettings);
  const [aiError, setAiError] = useState('');
  const [aiStatus, setAiStatus] = useState('');
  const [testingAi, setTestingAi] = useState(false);

  useEffect(() => {
    setNickname(data.profile.nickname);
    setGrade(data.profile.grade);
    setLanguage(data.profile.language);
    setSubjects(data.profile.subjects.join(', '));
  }, [data.profile]);

  function updateAiDraft(field: keyof AiSettings, value: string) {
    setAiDraft((current) => ({ ...current, [field]: value }));
  }

  async function saveAiConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateAiSettings(aiDraft);
    if (validationError) {
      setAiError(validationError);
      setAiStatus('');
      return;
    }
    if (await persistAiSettings(aiDraft)) {
      setAiSettings(aiDraft);
      setAiError('');
      setAiStatus('Configuration saved on this device. The API key remains only in memory for this session.');
    }
  }

  async function testConnection() {
    setAiError('');
    setAiStatus('');
    const validationError = validateAiSettings(aiDraft);
    if (validationError) {
      setAiError(validationError);
      return;
    }
    if (aiDraft.mode === 'online' && !apiKey.trim()) {
      setAiError('Enter your API key for this session before testing the online connection.');
      return;
    }
    const disclosure = aiDraft.mode === 'online'
      ? 'This test sends only a short connection-check prompt to your configured provider; it does not send learner records. The provider may charge fees and has its own data-handling terms. Qalumo cannot guarantee provider privacy. Continue?'
      : `This test sends only a short connection-check prompt to the local compatible service at ${aiDraft.baseUrl}. No learner records are sent. Continue?`;
    if (!window.confirm(disclosure)) return;
    setTestingAi(true);
    try {
      await testAiConnection(aiDraft, apiKey);
      setAiStatus('Connection test succeeded. No learner records were sent.');
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : 'The connection test could not be completed.');
    } finally {
      setTestingAi(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const profile: Profile = {
      nickname: nickname.trim(),
      grade: grade as Profile['grade'],
      language,
      subjects: [...new Set(subjects.split(/[,;\n]/).map((subject) => subject.trim()).filter(Boolean))],
    };
    if (!await persist({ ...data, profile }, 'Learner profile saved on this device.')) {
      setProfileError('The profile could not be saved. Check the message above and try again.');
      return;
    }
    setProfileError('');
  }

  function exportBackup() {
    const backup: BackupFile = { format: 'Qalumo backup', version: 1, exportedAt: new Date().toISOString(), data, videoResources };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qalumo-backup-${today()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage('JSON backup downloaded. Keep it somewhere private.');
    setError('');
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const validation = validateBackup(parsed);
      if (!validation.backup) {
        setError(validation.error ?? 'This backup could not be validated.');
        return;
      }
      if (!window.confirm('A full backup restore replaces the learner profile, results, homework, resources, practice sets/history, study tests/history, and current video library on this device with the file contents. Export anything you may need first. AI settings and API keys are not included. Continue?')) return;
      try {
        await saveFullBackup(validation.backup.data, validation.backup.videoResources ?? []);
        setData(validation.backup.data);
        setVideoResources(validation.backup.videoResources ?? []);
        setError('');
        setMessage('Backup imported. This device now contains the data from that file.');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The backup could not be saved on this device.');
      }
    } catch {
      setError('This file could not be read as JSON. Choose a valid Qalumo backup file.');
    }
  }

  async function clearAll() {
    const confirmed = window.confirm('Delete the learner profile, results, homework, resources, practice sets and history, study tests and history, video library, and saved AI connection settings on this device? This cannot be undone. Export anything you may need first.');
    if (!confirmed) return;
    try {
      await deleteAllLocalData();
      const empty = emptyStudyData();
      setData(empty);
      setVideoResources([]);
      setNickname('');
      setGrade('');
      setLanguage('English');
      setSubjects('');
      setApiKey('');
      setAiDraft(DEFAULT_AI_SETTINGS);
      setAiSettings(DEFAULT_AI_SETTINGS);
      setError('');
      setMessage('All Qalumo data stored on this device has been deleted.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Local data could not be deleted.');
    }
  }

  return <>
    <PageIntro eyebrow="Settings" title="Make Qalumo yours." description="A nickname is enough. Profile details and study records stay in this browser on this device." />
    <div className="settings-grid">
      <section className="form-card"><div className="card-title"><span className="step-number">01</span><div><h2>Learner profile</h2><p>No real name or account is required.</p></div></div>
        <form onSubmit={saveProfile} noValidate><label>Name or nickname<input maxLength={50} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="Optional" /></label><label>Grade<select value={grade} onChange={(event) => setGrade(event.target.value as Profile['grade'])}><option value="">Choose a grade</option>{GRADES.map((item) => <option key={item}>{item}</option>)}</select></label><label>Preferred language<select value={language} onChange={(event) => setLanguage(event.target.value as Profile['language'])}>{LANGUAGES.map((item) => <option key={item}>{item}</option>)}</select></label><p className="field-hint">The app interface is currently in English. This preference is saved for the learner profile.</p><label>Subjects<input value={subjects} onChange={(event) => setSubjects(event.target.value)} placeholder="Separate subjects with commas" /><small>Enter any subjects used at school; add or change them whenever you like.</small></label>{profileError && <p className="field-error" role="alert">{profileError}</p>}<button className="button button-primary" type="submit">Save profile</button></form>
      </section>
      <div className="settings-side">
        <section className="content-card"><div className="card-title"><span className="step-number">02</span><div><h2>Full app backup and restore</h2><p>Private copy of all learner data on this device.</p></div></div><p>Export includes the learner profile, results, homework and notes, resources, tests, practice history, and video library. Restoring replaces current learner data, homework, study material, and video library after confirmation. AI settings and API keys are not included.</p><div className="form-actions"><button className="button button-outline" onClick={exportBackup}>Export full-app backup</button><label className="button button-outline file-button">Import full-app backup<input type="file" accept=".json,application/json" onChange={importBackup} /></label></div><p className="field-hint">Keep backup files private. Phone and laptop data do not sync automatically. For selected study content, use Study library → Export/Import study library package; for caregiver video links only, use Resources → video library transfer.</p></section>
        <section className="content-card ai-settings-card"><div className="card-title"><span className="step-number">03</span><div><h2>AI assistant</h2><p>Optional. Off by default; all other Qalumo features work without AI.</p></div></div>
          <div className="ai-disclosure"><strong>Before connecting</strong><p>Online requests send your question and only the selected topic or resource context to the configured provider. The provider may charge fees and has its own data-handling terms. Qalumo cannot guarantee provider privacy. Test connection sends only a short test prompt, not learner records. You choose before each request whether to send it.</p></div>
          <form onSubmit={saveAiConfiguration}>
            <label>AI mode<select value={aiDraft.mode} onChange={(event) => {
              const mode = event.target.value as AiSettings['mode'];
              setAiDraft((current) => ({ ...current, mode, ...(mode === 'local' ? { baseUrl: current.mode === 'off' && !current.baseUrl ? DEFAULT_AI_SETTINGS.baseUrl : current.baseUrl } : {}) }));
              if (mode === 'off') setApiKey('');
              setAiError('');
              setAiStatus('');
            }}><option value="off">Off</option><option value="online">Online API</option><option value="local">Local compatible service</option></select></label>
            {aiDraft.mode !== 'off' && <>
              <label>{aiDraft.mode === 'online' ? 'Provider / API base URL *' : 'Local service base URL *'}<input type="url" required value={aiDraft.baseUrl} onChange={(event) => updateAiDraft('baseUrl', event.target.value)} placeholder={aiDraft.mode === 'local' ? 'http://localhost:1234/v1' : 'https://your-provider.example/v1'} /><small>Uses an OpenAI-compatible chat-completions endpoint. No provider is selected or bundled.</small></label>
              <label>Model name *<input required value={aiDraft.model} onChange={(event) => updateAiDraft('model', event.target.value)} placeholder="Enter a model name supported by your service" /></label>
              {aiDraft.mode === 'online' ? <label>API key for this session<input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Not saved; cleared when this app session ends" /><small>Qalumo keeps this key in memory only. It is never stored, exported, put in a URL, or logged. Do not put keys in the base URL. Use only HTTPS.</small></label> : <div className="ai-disclosure local-disclosure"><p>You must install and run a compatible local LLM service yourself and configure it to allow browser requests (CORS). The URL must point to this device or a local network address. Qalumo does not install or include a model. A local model may not run on this phone; you can still use all non-AI features.</p></div>}
            </>}
            {aiError && <p className="field-error" role="alert">{aiError}</p>}
            {aiStatus && <p className="ai-success" role="status">{aiStatus}</p>}
            <div className="form-actions"><button className="button button-primary" type="submit">Save AI settings</button>{aiDraft.mode !== 'off' && <button className="button button-outline" type="button" disabled={testingAi} onClick={testConnection}>{testingAi ? 'Testing…' : 'Test connection'}</button>}</div>
          </form>
        </section>
        <section className="content-card privacy-card"><div className="card-title"><span className="step-number">04</span><div><h2>Privacy and limits</h2><p>What this first version does and does not do.</p></div></div><ul><li>Study data is stored locally in this browser using IndexedDB.</li><li>AI is optional; no AI request is made unless you choose to send a question or selected study text. Qalumo has no account, backend, tracking, or analytics.</li><li>New web research needs internet. Offline search covers only notes you save.</li><li>Curriculum and practice content is user-provided unless a source is shown; official CAPS alignment is not verified.</li><li>AI answers and question drafts are suggestions, not official guidance. Check them against saved learning resources. AI does not silently create or automatically mark tests.</li><li>Homework supports TXT, text-based PDF, and DOCX text extraction. Image-only PDF OCR is not included. There is no automatic essay marking or cross-device sync.</li><li>The optional LLM feature has not been tested end-to-end in this project and may require internet or a separately configured local service.</li></ul></section>
        <section className="content-card delete-card"><h2>Delete all local data</h2><p>Removes the learner profile, results, homework, resources, video library, practice and study-test history, tests, and saved AI connection settings from this device. The in-memory API key will also be cleared. This cannot be undone.</p><button className="button button-danger" onClick={clearAll}>Delete all local data</button></section>
      </div>
    </div>
  </>;
}

export default App;
