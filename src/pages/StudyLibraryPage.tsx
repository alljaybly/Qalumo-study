import { useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { answerMatches, createId, planStudyLibraryImport, validateStudyLibraryPackage } from '../data/logic';
import { askAi, validateAiSettings } from '../services/ai';
import { GRADES } from '../types';
import type { AiSettings, Grade, HomeworkItem, Resource, StudyData, StudyLibraryPackage, StudyTest, StudyTestAttempt, StudyTestQuestion } from '../types';

type Props = {
  data: StudyData;
  persist: (data: StudyData, confirmation?: string) => Promise<boolean>;
  aiSettings: AiSettings;
  apiKey: string;
  setPage: (page: 'Homework' | 'Practise' | 'Resources') => void;
};

type QuestionDraft = Omit<StudyTestQuestion, 'id'> & { id: string };
type TestDraft = Omit<StudyTest, 'id' | 'questions'> & { questions: QuestionDraft[] };
type DuplicatePolicy = 'skip' | 'keep-both';
type ImportState = { file: StudyLibraryPackage; name: string };

const emptyQuestion = (): QuestionDraft => ({
  id: createId(),
  prompt: '',
  kind: 'multiple-choice',
  options: [],
  answer: '',
  rubric: '',
  explanation: '',
  selfMark: false,
});

function emptyTestDraft(grade: Grade | ''): TestDraft {
  return {
    title: '',
    grade: grade || 'Grade 8',
    subject: '',
    topic: '',
    type: 'practice-test',
    sourceType: 'caregiver',
    sourceId: '',
    sourceTitle: '',
    questions: [emptyQuestion()],
  };
}

function buildTestDraft(test: StudyTest): TestDraft {
  return {
    ...test,
    questions: test.questions.map((question) => ({ ...question, id: createId() })),
  };
}

function totalPackageItems(file: StudyLibraryPackage): number {
  return file.homework.length + file.notes.length + file.tests.length + file.practiceSets.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAiQuestionDraft(value: string): StudyTestQuestion[] {
  const json = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value;
  const parsed: unknown = JSON.parse(json);
  const rows = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && 'questions' in parsed && Array.isArray(parsed.questions)
      ? parsed.questions
      : null;
  if (!rows || rows.length === 0 || rows.length > 10) throw new Error('The AI reply must contain 1–10 questions in a JSON array.');
  return rows.map((row): StudyTestQuestion => {
    if (!isRecord(row)) throw new Error('One AI question was not a valid object.');
    const item = row;
    const kind = item.kind;
    if (typeof item.prompt !== 'string' || !item.prompt.trim()
      || (kind !== 'multiple-choice' && kind !== 'true-false' && kind !== 'short-answer')) {
      throw new Error('Each AI question needs a prompt and a supported kind.');
    }
    const options = kind === 'multiple-choice' && Array.isArray(item.options)
      ? item.options.filter((option): option is string => typeof option === 'string').map((option) => option.trim()).filter(Boolean)
      : [];
    const answer = typeof item.answer === 'string' ? item.answer.trim() : '';
    const rubric = typeof item.rubric === 'string' ? item.rubric.trim() : '';
    const selfMark = kind === 'short-answer' && item.selfMark === true;
    if (kind === 'multiple-choice' && (options.length < 2 || !answer || !options.some((option) => answerMatches(option, answer)))) {
      throw new Error('An AI multiple-choice question needs at least two options, including the answer.');
    }
    if (kind === 'true-false' && answer !== 'True' && answer !== 'False') {
      throw new Error('An AI true/false question must use True or False as its answer.');
    }
    if (kind === 'short-answer' && !selfMark && !answer) {
      throw new Error('An AI short-answer question needs an answer key or must be marked for self-review.');
    }
    if (selfMark && !rubric) throw new Error('An AI self-mark question needs a review rubric.');
    return {
      id: createId(),
      prompt: item.prompt.trim(),
      kind,
      options,
      answer,
      rubric,
      explanation: typeof item.explanation === 'string' ? item.explanation.trim() : '',
      selfMark,
    };
  });
}

export default function StudyLibraryPage({ data, persist, aiSettings, apiKey, setPage }: Props) {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(() => new Set());
  const [showTestEditor, setShowTestEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testDraft, setTestDraft] = useState<TestDraft>(() => emptyTestDraft(data.profile.grade));
  const [testError, setTestError] = useState('');
  const [sourceChoice, setSourceChoice] = useState('');
  const [aiQuestions, setAiQuestions] = useState('');
  const [aiQuestionError, setAiQuestionError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [practiceTestId, setPracticeTestId] = useState('');
  const [practiceAnswers, setPracticeAnswers] = useState<Record<string, string>>({});
  const [practiceSelfReviewed, setPracticeSelfReviewed] = useState<Record<string, boolean>>({});
  const [practiceAttempt, setPracticeAttempt] = useState<StudyTestAttempt | null>(null);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [duplicatePolicy, setDuplicatePolicy] = useState<DuplicatePolicy>('skip');
  const [importError, setImportError] = useState('');
  const [importBusy, setImportBusy] = useState(false);

  const selectedSource = useMemo(() => {
    if (sourceChoice.startsWith('homework:')) {
      return data.homework.find((item) => item.id === sourceChoice.slice('homework:'.length));
    }
    if (sourceChoice.startsWith('note:')) {
      return data.resources.find((item) => item.id === sourceChoice.slice('note:'.length));
    }
    return undefined;
  }, [data.homework, data.resources, sourceChoice]);

  const skipImportPlan = importState
    ? planStudyLibraryImport(importState.file, data, 'skip')
    : undefined;
  const packageItemCount = importState ? totalPackageItems(importState.file) : 0;
  const duplicateCount = skipImportPlan?.skippedDuplicates ?? 0;
  const importedCount = packageItemCount - (duplicatePolicy === 'skip' ? duplicateCount : 0);
  const activePracticeTest = data.studyTests.find((test) => test.id === practiceTestId);

  function toggleSelected(key: string) {
    setSelectedItems((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function startNewTest(source?: HomeworkItem | Resource) {
    const draft = emptyTestDraft(data.profile.grade);
    if (source) {
      const isHomework = 'extractedText' in source;
      draft.title = `${source.title} — practice questions`;
      draft.grade = source.grade;
      draft.subject = source.subject;
      draft.topic = isHomework ? '' : source.topic;
      draft.sourceType = isHomework ? 'homework' : 'note';
      draft.sourceId = source.id;
      draft.sourceTitle = source.title;
    }
    setTestDraft(draft);
    setEditingId(null);
    setShowTestEditor(true);
    setTestError('');
    setAiQuestions('');
    setAiQuestionError('');
  }

  function startEditTest(test: StudyTest) {
    setTestDraft(buildTestDraft(test));
    setEditingId(test.id);
    setShowTestEditor(true);
    setTestError('');
    setAiQuestions('');
    setAiQuestionError('');
  }

  function updateQuestion(index: number, patch: Partial<QuestionDraft>) {
    setTestDraft((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) => questionIndex === index
        ? { ...question, ...patch }
        : question),
    }));
  }

  function updateTest<K extends keyof TestDraft>(key: K, value: TestDraft[K]) {
    setTestDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!testDraft.title.trim() || !testDraft.subject.trim() || !GRADES.includes(testDraft.grade as Grade)) {
      setTestError('Add a title, subject, and valid grade before saving.');
      return;
    }
    const questions: StudyTestQuestion[] = [];
    for (const [index, question] of testDraft.questions.entries()) {
      if (!question.prompt.trim()) {
        setTestError(`Question ${index + 1} needs a prompt.`);
        return;
      }
      if (question.kind === 'multiple-choice') {
        const options = question.options.map((option) => option.trim()).filter(Boolean);
        if (options.length < 2 || !question.answer.trim() || !options.some((option) => answerMatches(option, question.answer))) {
          setTestError(`Question ${index + 1} needs at least two choices, including the correct answer.`);
          return;
        }
        questions.push({ ...question, options, answer: question.answer.trim(), selfMark: false });
      } else if (question.kind === 'true-false') {
        if (question.answer !== 'True' && question.answer !== 'False') {
          setTestError(`Question ${index + 1} needs a True or False answer.`);
          return;
        }
        questions.push({ ...question, options: [], selfMark: false });
      } else if (question.selfMark) {
        if (!question.rubric.trim()) {
          setTestError(`Question ${index + 1} needs a rubric for self-marking.`);
          return;
        }
        questions.push({ ...question, options: [], answer: question.answer.trim(), rubric: question.rubric.trim() });
      } else {
        if (!question.answer.trim()) {
          setTestError(`Question ${index + 1} needs an answer key, or choose self-marking and add a rubric.`);
          return;
        }
        questions.push({ ...question, options: [], rubric: question.rubric.trim(), answer: question.answer.trim() });
      }
    }
    if (!questions.length) {
      setTestError('Add at least one question before saving this test.');
      return;
    }
    const existing = editingId ? data.studyTests.find((test) => test.id === editingId) : undefined;
    const test: StudyTest = {
      ...testDraft,
      id: editingId ?? createId(),
      title: testDraft.title.trim(),
      subject: testDraft.subject.trim(),
      topic: testDraft.topic.trim(),
      sourceTitle: testDraft.sourceTitle.trim(),
      questions,
    };
    if (await persist({
      ...data,
      studyTests: existing
        ? data.studyTests.map((entry) => entry.id === test.id ? test : entry)
        : [test, ...data.studyTests],
    }, existing ? 'Study test updated.' : 'Study test saved. Review its source and answers before practice.')) {
      setShowTestEditor(false);
      setEditingId(null);
      setTestError('');
      setAiQuestions('');
    }
  }

  async function removeTest(test: StudyTest) {
    if (!window.confirm(`Delete “${test.title}”? Its saved practice history will remain.`)) return;
    if (await persist({ ...data, studyTests: data.studyTests.filter((entry) => entry.id !== test.id) }, 'Study test deleted.')) {
      if (practiceTestId === test.id) setPracticeTestId('');
      if (editingId === test.id) setShowTestEditor(false);
    }
  }

  async function draftQuestionsWithAi() {
    setAiQuestionError('');
    setAiQuestions('');
    if (!selectedSource) {
      setAiQuestionError('Choose a homework item or saved note first. You can also create a test manually.');
      return;
    }
    if (aiSettings.mode === 'off') {
      setAiQuestionError('AI is off. You can create and edit questions manually below.');
      return;
    }
    const configError = validateAiSettings(aiSettings);
    if (configError) {
      setAiQuestionError(configError);
      return;
    }
    if (aiSettings.mode === 'online' && !apiKey.trim()) {
      setAiQuestionError('Enter your API key for this session in Settings. It is not saved or exported.');
      return;
    }
    const sourceText = 'extractedText' in selectedSource ? selectedSource.extractedText : selectedSource.text;
    if (!sourceText.trim()) {
      setAiQuestionError('This source has no text to use. Add text to the source or create questions manually.');
      return;
    }
    if (showTestEditor && testDraft.questions.some((question) => question.prompt.trim())
      && !window.confirm('Replace the unsaved questions in the current editor with an AI draft?')) return;
    const disclosure = aiSettings.mode === 'online'
      ? 'This sends only the selected homework or note text and a request for draft questions to your configured online provider. The provider may charge fees and has its own data-handling terms. Qalumo cannot guarantee provider privacy. AI is not yet tested end-to-end in this project. Continue?'
      : `This sends only the selected homework or note text to the local service at ${aiSettings.baseUrl}. Qalumo has not tested AI end-to-end in this project. Continue?`;
    if (!window.confirm(disclosure)) return;
    setAiBusy(true);
    try {
      const result = await askAi(
        aiSettings,
        apiKey,
        `${selectedSource.title}\n${selectedSource.subject}\n\n${sourceText}`,
        'Create exactly 3 draft questions based only on the supplied study text for this learner’s grade. Return JSON only as an array of objects with keys prompt, kind (multiple-choice, true-false, or short-answer), options (string array), answer (string), rubric (string), explanation (string), and selfMark (boolean). For short-answer questions that need self-marking, include a useful rubric and set selfMark true. Do not claim official exam status or curriculum alignment. These are drafts to check against class materials.',
        1600,
      );
      setAiQuestions(result);
      const sourceIsHomework = 'extractedText' in selectedSource;
      setTestDraft({
        ...emptyTestDraft(selectedSource.grade),
        title: `${selectedSource.title} — AI draft questions`,
        subject: selectedSource.subject,
        topic: sourceIsHomework ? '' : selectedSource.topic,
        sourceType: sourceIsHomework ? 'homework' : 'note',
        sourceId: selectedSource.id,
        sourceTitle: selectedSource.title,
      });
      setShowTestEditor(true);
    } catch (cause) {
      setAiQuestionError(cause instanceof Error ? cause.message : 'The AI question draft could not be completed. Create questions manually instead.');
    } finally {
      setAiBusy(false);
    }
  }

  function useAiDraft() {
    try {
      const questions = parseAiQuestionDraft(aiQuestions);
      if (testDraft.questions.some((question) => question.prompt.trim())
        && !window.confirm('Replace the questions currently in the editor with this AI draft?')) return;
      setTestDraft((current) => ({ ...current, questions }));
      setAiQuestionError('');
    } catch (cause) {
      setAiQuestionError(cause instanceof Error ? cause.message : 'The AI draft could not be read. You can still add questions manually.');
    }
  }

  async function startPractice(test: StudyTest) {
    setPracticeTestId(test.id);
    setPracticeAnswers({});
    setPracticeSelfReviewed({});
    setPracticeAttempt(null);
  }

  async function finishPractice(test: StudyTest) {
    const objective = test.questions.filter((question) => !question.selfMark);
    const correctCount = objective.filter((question) => answerMatches(practiceAnswers[question.id] ?? '', question.answer)).length;
    const review = test.questions.flatMap((question) => {
      const learnerAnswer = practiceAnswers[question.id] ?? '';
      const correct = question.selfMark
        ? Boolean(practiceSelfReviewed[question.id])
        : answerMatches(learnerAnswer, question.answer);
      if (correct && !question.selfMark) return [];
      return [{
        prompt: question.prompt,
        learnerAnswer,
        expectedAnswer: question.answer,
        rubric: question.rubric,
        explanation: question.explanation,
        selfMark: question.selfMark,
      }];
    });
    const attempt: StudyTestAttempt = {
      id: createId(),
      testId: test.id,
      setTitle: test.title,
      subject: test.subject,
      grade: test.grade,
      date: new Date().toISOString().slice(0, 10),
      score: correctCount,
      total: objective.length,
      selfMarked: test.questions.filter((question) => question.selfMark).length,
      incorrect: review,
    };
    if (await persist({
      ...data,
      studyTestHistory: [attempt, ...data.studyTestHistory],
    }, 'Study-test practice saved on this device.')) {
      setPracticeAttempt(attempt);
    }
  }

  function cancelPractice() {
    setPracticeTestId('');
    setPracticeAttempt(null);
    setPracticeAnswers({});
    setPracticeSelfReviewed({});
  }

  function exportSelected() {
    const file: StudyLibraryPackage = {
      format: 'Qalumo study library',
      version: 1,
      exportedAt: new Date().toISOString(),
      homework: data.homework.filter((item) => selectedItems.has(`homework:${item.id}`)),
      notes: data.resources.filter((item) => selectedItems.has(`note:${item.id}`)),
      tests: data.studyTests.filter((item) => selectedItems.has(`test:${item.id}`)),
      practiceSets: data.practiceSets.filter((item) => selectedItems.has(`practice:${item.id}`)),
    };
    const count = totalPackageItems(file);
    if (!count) {
      setImportError('Select at least one homework item, note, or practice test before exporting.');
      return;
    }
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qalumo-study-library-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setImportError('');
    setSelectedItems(new Set());
  }

  async function readPackage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError('');
    setImportBusy(true);
    setImportState(null);
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('This package is larger than 50 MB. Choose a smaller file.');
      const parsed: unknown = JSON.parse(await file.text());
      const result = validateStudyLibraryPackage(parsed);
      if (!result.file) throw new Error(result.error ?? 'This study library package could not be validated.');
      setImportState({ file: result.file, name: file.name });
      setDuplicatePolicy('skip');
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : 'This file could not be read as a valid study library package. Nothing was imported.');
    } finally {
      setImportBusy(false);
    }
  }

  async function mergePackage() {
    if (!importState) return;
    const plan = planStudyLibraryImport(importState.file, data, duplicatePolicy);
    const next = {
      ...data,
      homework: [...plan.homework, ...data.homework],
      resources: [...plan.notes, ...data.resources],
      studyTests: [...plan.tests, ...data.studyTests],
      practiceSets: [...plan.practiceSets, ...data.practiceSets],
    };
    const added = plan.homework.length + plan.notes.length + plan.tests.length + plan.practiceSets.length;
    if (await persist(next, `Study library merged: ${added} added, ${plan.skippedDuplicates} duplicate${plan.skippedDuplicates === 1 ? '' : 's'} skipped.`)) {
      setImportState(null);
      setImportError('');
    }
  }

  function sourceForTest(test: StudyTest): HomeworkItem | Resource | undefined {
    if (test.sourceType === 'homework') return data.homework.find((item) => item.id === test.sourceId);
    if (test.sourceType === 'note') return data.resources.find((item) => item.id === test.sourceId);
    return undefined;
  }

  const [practiceSetHistoryVisible, setPracticeSetHistoryVisible] = useState(false);
  const practiceSets = data.practiceSets;

  return <>
    <header className="page-intro">
      <div><p className="eyebrow">Study section</p><h1>Your study library.</h1><p className="intro-copy">Keep notes and practice tests by grade, subject, topic, and source. Items stay on this device unless you explicitly select them for a library package.</p></div>
      <div className="study-library-intro-actions"><button className="button button-outline" type="button" onClick={() => setPage('Homework')}>Go to homework</button><button className="button button-primary" type="button" onClick={() => startNewTest()}>Create practice test <span aria-hidden="true">+</span></button></div>
    </header>

    <section className="content-card study-library-transfer" aria-labelledby="study-transfer-title">
      <div className="card-title"><span className="step-number">01</span><div><h2 id="study-transfer-title">Transfer selected study material</h2><p>Choose exact items below. This package is separate from full-app backups and video-list files.</p></div></div>
      <div className="study-transfer-warning"><strong>Review before sharing:</strong> selected homework text, learner notes, and test content go into the package. Learner name, assessment results, practice history, settings, API keys, and videos do not. Do not select content you do not want to share.</div>
      <div className="study-transfer-actions">
        <button className="button button-primary" type="button" onClick={exportSelected}>Export selected study library</button>
        <label className={`button button-outline file-button ${importBusy ? 'disabled-file-button' : ''}`}>Import study library package<input type="file" accept=".json,application/json" onChange={(event) => void readPackage(event)} disabled={importBusy} /></label>
        {importBusy && <span className="progress-message" role="status">Checking package locally…</span>}
      </div>
      <p className="field-hint">To transfer: export on one device, move the file through a folder you are allowed to use (such as Google Drive), download it on the other device, then import it. This is manual file transfer, not automatic sync; Google Drive needs internet.</p>
      {importError && <p className="field-error" role="alert">{importError}</p>}
      {importState && <div className="study-import-preview" role="region" aria-label="Study library import preview">
        <h3>Preview: {importState.name}</h3>
        <p>Valid package version 1 · {importState.file.homework.length} homework · {importState.file.notes.length} notes · {importState.file.tests.length} study tests · {importState.file.practiceSets.length} earlier practice sets.</p>
        <p>Duplicates against this device: <strong>{duplicateCount}</strong>. New items available: <strong>{importedCount}</strong>. Learner profile, marks, and history will not be changed.</p>
        <fieldset><legend>What should happen to duplicate items?</legend>
          <label><input type="radio" name="duplicate-policy" checked={duplicatePolicy === 'skip'} onChange={() => setDuplicatePolicy('skip')} /> Skip duplicates (recommended)</label>
          <label><input type="radio" name="duplicate-policy" checked={duplicatePolicy === 'keep-both'} onChange={() => setDuplicatePolicy('keep-both')} /> Keep both by adding a separate copy</label>
        </fieldset>
        <p className="field-hint">Import merges records; it never replaces existing items. Malformed packages are rejected as a whole.</p>
        <div className="form-actions"><button className="button button-primary" type="button" onClick={() => void mergePackage()}>Merge study library</button><button className="button button-outline" type="button" onClick={() => setImportState(null)}>Cancel import</button></div>
      </div>}
    </section>

    <section className="study-library-content" aria-labelledby="study-library-items-title">
      <div className="section-heading"><div><p className="eyebrow">Saved on this device</p><h2 id="study-library-items-title">Select items for a package</h2></div></div>
      <div className="content-card study-library-list">
        <div className="study-library-subsection"><div className="section-heading compact"><div><h3>Homework material</h3><p>Selecting homework includes its saved text, learner notes, and manual breakdown.</p></div></div>
          {data.homework.length ? <div className="study-selection-list">{data.homework.map((item) => <div key={item.id} className="study-selection-row"><label><input type="checkbox" checked={selectedItems.has(`homework:${item.id}`)} onChange={() => toggleSelected(`homework:${item.id}`)} /><span><strong>{item.title}</strong><small>{item.grade} · {item.subject}{item.archived ? ' · Archived' : ''}</small></span></label><button type="button" className="text-button" onClick={() => setPage('Homework')}>Open homework</button></div>)}</div> : <p className="muted">No homework saved. Add it from Homework.</p>}
          <button type="button" className="text-button" onClick={() => setPage('Homework')}>Add or manage homework</button>
        </div>
        <div className="study-library-subsection"><div className="section-heading compact"><div><h3>Study notes</h3><p>Saved text resources can be shared as notes.</p></div></div>
          {data.resources.length ? <div className="study-selection-list">{data.resources.map((item) => <div key={item.id} className="study-selection-row"><label><input type="checkbox" checked={selectedItems.has(`note:${item.id}`)} onChange={() => toggleSelected(`note:${item.id}`)} /><span><strong>{item.title}</strong><small>{item.grade} · {item.subject}{item.topic ? ` · ${item.topic}` : ''}{item.source ? ` · ${item.source}` : ''}</small></span></label><button type="button" className="text-button" onClick={() => setPage('Resources')}>Manage in Resources</button></div>)}</div> : <p className="muted">No text notes saved. Add them in Resources.</p>}
          <button type="button" className="text-button" onClick={() => setPage('Resources')}>Add or manage notes in Resources</button>
        </div>
        <div className="study-library-subsection"><div className="section-heading compact"><div><h3>Practice tests and question sets</h3><p>Caregiver-entered or carefully reviewed draft questions. No complete test bank is provided.</p></div></div>
          {data.studyTests.length ? <div className="study-test-grid">{data.studyTests.map((test) => {
            const linkedSource = sourceForTest(test);
            return <article className="study-test-card" key={test.id}>
              <label className="study-test-select"><input type="checkbox" checked={selectedItems.has(`test:${test.id}`)} onChange={() => toggleSelected(`test:${test.id}`)} /><span>Select for export</span></label>
              <span className="tag">{test.type === 'practice-test' ? 'Practice test' : 'Question set'}</span><h4>{test.title}</h4>
              <p>{test.grade} · {test.subject}{test.topic ? ` · ${test.topic}` : ''}</p>
              <p className="field-hint">Source: {test.sourceTitle || 'Caregiver-entered'}{linkedSource ? ' · linked on this device' : test.sourceType !== 'caregiver' ? ' · source record not present on this device' : ''}</p>
              <p>{test.questions.length} questions · {test.questions.filter((question) => !question.selfMark).length} objectively marked · {test.questions.filter((question) => question.selfMark).length} self-mark</p>
              <div className="inline-actions"><button className="button button-outline" type="button" onClick={() => { void startPractice(test); }}>Practise</button><button className="text-button" type="button" onClick={() => startEditTest(test)}>Edit</button><button className="text-button danger-text" type="button" onClick={() => void removeTest(test)}>Delete</button></div>
            </article>;
          })}</div> : <div className="empty-card small-empty"><h3>No study tests yet</h3><p>Create your own questions or, when configured, ask AI for a draft based on one selected homework item or saved note. Review every question and answer before practice.</p><button className="button button-outline" type="button" onClick={() => startNewTest()}>Create a test manually</button></div>}
          {practiceSets.length > 0 && <div className="earlier-practice-section"><h4>Earlier practice sets</h4><p>These are the sets already in Qalumo’s Practise area. Select them for transfer without changing their existing format.</p>
            <div className="study-selection-list">{practiceSets.map((set) => <div key={set.id} className="study-selection-row"><label><input type="checkbox" checked={selectedItems.has(`practice:${set.id}`)} onChange={() => toggleSelected(`practice:${set.id}`)} /><span><strong>{set.title}</strong><small>{set.grade} · {set.subject} · {set.questions.length} questions</small></span></label><button type="button" className="text-button" onClick={() => setPage('Practise')}>Open Practise</button></div>)}</div>
          </div>}
        </div>
      </div>
    </section>

    <section className="content-card study-ai-drafter">
      <div className="section-heading"><div><p className="eyebrow">Optional AI draft</p><h2>Draft questions from selected study material</h2></div></div>
      <p>Choose one homework item or saved note. Qalumo sends only that item’s text and a question-generation request after confirmation. AI-generated content is a draft, not an official exam or guaranteed correct.</p>
      <div className="form-row"><label>Selected source
        <select value={sourceChoice} onChange={(event) => { setSourceChoice(event.target.value); setAiQuestionError(''); setAiQuestions(''); }}>
          <option value="">Choose one source</option>
          <optgroup label="Homework">{data.homework.map((item) => <option key={item.id} value={`homework:${item.id}`}>{item.title} · {item.subject}</option>)}</optgroup>
          <optgroup label="Saved notes">{data.resources.map((item) => <option key={item.id} value={`note:${item.id}`}>{item.title} · {item.subject}</option>)}</optgroup>
        </select>
      </label><div className="study-ai-source-summary">{selectedSource ? <><strong>{selectedSource.title}</strong><span>{selectedSource.subject} · {selectedSource.grade}</span></> : <span>Only one selected item is used; learner profile and results are not sent.</span>}</div></div>
      {aiSettings.mode === 'off' && <p className="field-hint">AI is off. Create questions manually above; Qalumo does not invent a test bank.</p>}
      <div className="form-actions"><button className="button button-primary" type="button" onClick={() => void draftQuestionsWithAi()} disabled={aiBusy || !selectedSource || aiSettings.mode === 'off'}>{aiBusy ? 'Requesting draft…' : 'Draft questions with AI'}</button><button className="button button-outline" type="button" onClick={() => startNewTest(selectedSource)}>Create a manual test from this source</button></div>
      {aiBusy && <p className="progress-message" role="status">Waiting for the configured AI service…</p>}
      {aiQuestionError && <p className="field-error" role="alert">{aiQuestionError}</p>}
      {aiQuestions && <div className="ai-answer"><strong>AI draft — check every question and answer against class instructions and trusted materials.</strong><pre>{aiQuestions}</pre><button type="button" className="button button-outline" onClick={useAiDraft}>Load valid questions into editor</button></div>}
    </section>

    {showTestEditor && <form className="form-card study-test-editor" onSubmit={(event) => void saveTest(event)} noValidate>
      <div className="editor-heading"><div><p className="eyebrow">Study library editor</p><h2>{editingId ? 'Edit study test' : 'Create practice test or question set'}</h2></div><button type="button" className="icon-button" aria-label="Close study test editor" onClick={() => setShowTestEditor(false)}>×</button></div>
      <div className="study-test-source-note">Questions created from homework or notes keep a source title. Review their content; AI drafts are not guaranteed correct or official.</div>
      <div className="form-row"><label>Title *<input maxLength={160} value={testDraft.title} onChange={(event) => updateTest('title', event.target.value)} required /></label><label>Type<select value={testDraft.type} onChange={(event) => updateTest('type', event.target.value as TestDraft['type'])}><option value="practice-test">Practice test</option><option value="question-set">Question set</option></select></label></div>
      <div className="form-row"><label>Grade *<select value={testDraft.grade} onChange={(event) => updateTest('grade', event.target.value as Grade)}>{GRADES.map((grade) => <option key={grade}>{grade}</option>)}</select></label><label>Subject *<input maxLength={100} value={testDraft.subject} onChange={(event) => updateTest('subject', event.target.value)} required /></label><label>Topic (optional)<input maxLength={120} value={testDraft.topic} onChange={(event) => updateTest('topic', event.target.value)} /></label></div>
      <div className="form-row"><label>Source type<select value={testDraft.sourceType} onChange={(event) => { updateTest('sourceType', event.target.value as TestDraft['sourceType']); updateTest('sourceId', ''); updateTest('sourceTitle', ''); }}><option value="caregiver">Caregiver / learner provided</option><option value="homework">Homework</option><option value="note">Saved note</option></select></label><label>Source item
        {testDraft.sourceType === 'homework' ? <select value={testDraft.sourceId} onChange={(event) => { const item = data.homework.find((entry) => entry.id === event.target.value); updateTest('sourceId', event.target.value); updateTest('sourceTitle', item?.title ?? ''); }}><option value="">Choose homework</option>{data.homework.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          : testDraft.sourceType === 'note' ? <select value={testDraft.sourceId} onChange={(event) => { const item = data.resources.find((entry) => entry.id === event.target.value); updateTest('sourceId', event.target.value); updateTest('sourceTitle', item?.title ?? ''); }}><option value="">Choose saved note</option>{data.resources.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
            : <input maxLength={160} value={testDraft.sourceTitle} onChange={(event) => updateTest('sourceTitle', event.target.value)} placeholder="e.g. Class notes or caregiver material" />}
      </label></div>
      <div className="study-questions-editor"><div className="section-heading compact"><div><h3>Questions</h3><p>Multiple choice and true/false are objectively marked. Short answers may use a key or be labelled for self-marking.</p></div><button className="button button-outline" type="button" onClick={() => updateTest('questions', [...testDraft.questions, emptyQuestion()])}>Add question</button></div>
        {testDraft.questions.map((question, index) => <article className="study-question-editor" key={question.id}>
          <div className="editor-heading"><h4>Question {index + 1}</h4>{testDraft.questions.length > 1 && <button className="text-button danger-text" type="button" onClick={() => updateTest('questions', testDraft.questions.filter((item) => item.id !== question.id))}>Remove</button>}</div>
          <label>Question prompt *<textarea rows={2} maxLength={1000} value={question.prompt} onChange={(event) => updateQuestion(index, { prompt: event.target.value })} /></label>
          <label>Question type<select value={question.kind} onChange={(event) => {
            const kind = event.target.value as StudyTestQuestion['kind'];
            updateQuestion(index, { kind, options: [], answer: kind === 'true-false' ? 'True' : '', rubric: '', selfMark: false });
          }}><option value="multiple-choice">Multiple choice</option><option value="true-false">True / False</option><option value="short-answer">Short answer</option></select></label>
          {question.kind === 'multiple-choice' && <><label>Choices (one per line)<textarea rows={3} value={question.options.join('\n')} onChange={(event) => updateQuestion(index, { options: event.target.value.split('\n') })} /></label><label>Correct answer *<select value={question.answer} onChange={(event) => updateQuestion(index, { answer: event.target.value })}><option value="">Choose the correct option</option>{question.options.map((option, optionIndex) => option.trim() && <option key={`${optionIndex}-${option}`} value={option.trim()}>{option.trim()}</option>)}</select></label></>}
          {question.kind === 'true-false' && <label>Correct answer *<select value={question.answer} onChange={(event) => updateQuestion(index, { answer: event.target.value })}><option value="True">True</option><option value="False">False</option></select></label>}
          {question.kind === 'short-answer' && <><label className="inline-checkbox"><input type="checkbox" checked={question.selfMark} onChange={(event) => updateQuestion(index, { selfMark: event.target.checked, answer: '', rubric: '' })} /> This needs self-marking, not automatic marking</label>
            {question.selfMark ? <label>Answer guide / rubric *<textarea rows={3} maxLength={1500} value={question.rubric} onChange={(event) => updateQuestion(index, { rubric: event.target.value })} placeholder="What should the learner compare their answer with?" /></label> : <label>Answer key *<textarea rows={2} maxLength={1000} value={question.answer} onChange={(event) => updateQuestion(index, { answer: event.target.value })} /></label>}</>}
          <label>Explanation or worked guidance (optional)<textarea rows={2} maxLength={1500} value={question.explanation} onChange={(event) => updateQuestion(index, { explanation: event.target.value })} /></label>
        </article>)}
      </div>
      {testError && <p className="field-error" role="alert">{testError}</p>}
      <div className="form-actions"><button className="button button-primary" type="submit">{editingId ? 'Save test changes' : 'Save practice test'}</button><button className="button button-outline" type="button" onClick={() => { setShowTestEditor(false); setTestError(''); }}>Cancel</button></div>
    </form>}

    {activePracticeTest && <PracticeTestPanel
      test={activePracticeTest}
      answers={practiceAnswers}
      selfReviewed={practiceSelfReviewed}
      attempt={practiceAttempt}
      history={data.studyTestHistory.filter((item) => item.testId === activePracticeTest.id)}
      setAnswers={setPracticeAnswers}
      setSelfReviewed={setPracticeSelfReviewed}
      onFinish={() => void finishPractice(activePracticeTest)}
      onCancel={cancelPractice}
    />}

    <section className="study-test-history content-card">
      <div className="section-heading"><div><p className="eyebrow">On this device</p><h2>Study-test practice history</h2></div><button className="text-button" type="button" onClick={() => setPracticeSetHistoryVisible(!practiceSetHistoryVisible)}>{practiceSetHistoryVisible ? 'Hide' : 'Show'} history</button></div>
      {practiceSetHistoryVisible && (data.studyTestHistory.length
        ? <div className="study-test-history-list">{data.studyTestHistory.slice(0, 10).map((attempt) => <article key={attempt.id}><div><strong>{attempt.setTitle}</strong><small>{attempt.subject} · {attempt.date}</small></div><span className="tag tag-green">{attempt.score}/{attempt.total} objective · {attempt.selfMarked} self-marked</span></article>)}</div>
        : <p className="muted">No study-test practice sessions saved yet.</p>)}
    </section>
  </>;
}

function PracticeTestPanel({ test, answers, selfReviewed, attempt, history, setAnswers, setSelfReviewed, onFinish, onCancel }: {
  test: StudyTest;
  answers: Record<string, string>;
  selfReviewed: Record<string, boolean>;
  attempt: StudyTestAttempt | null;
  history: StudyTestAttempt[];
  setAnswers: (answers: Record<string, string>) => void;
  setSelfReviewed: (answers: Record<string, boolean>) => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  return <section className="content-card study-practice-panel" aria-labelledby="study-practice-title">
    <div className="section-heading"><div><p className="eyebrow">Practice mode</p><h2 id="study-practice-title">{test.title}</h2></div><button type="button" className="icon-button" aria-label="Close practice mode" onClick={onCancel}>×</button></div>
    <p>{test.grade} · {test.subject}{test.topic ? ` · ${test.topic}` : ''} · Source: {test.sourceTitle || 'Caregiver-entered'}</p>
    {!attempt ? <>
      {test.questions.map((question, index) => <article className="study-practice-question" key={question.id}>
        <h3>{index + 1}. {question.prompt}</h3>
        {question.kind === 'multiple-choice' ? <fieldset><legend>Choose one answer</legend>{question.options.map((option) => <label key={option}><input type="radio" name={`study-${question.id}`} checked={answers[question.id] === option} onChange={() => setAnswers({ ...answers, [question.id]: option })} /> {option}</label>)}</fieldset>
          : question.kind === 'true-false' ? <fieldset><legend>Choose one answer</legend>{['True', 'False'].map((option) => <label key={option}><input type="radio" name={`study-${question.id}`} checked={answers[question.id] === option} onChange={() => setAnswers({ ...answers, [question.id]: option })} /> {option}</label>)}
            </fieldset> : <><label>Your answer<textarea rows={2} value={answers[question.id] ?? ''} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} /></label>
              {question.selfMark && <div className="self-mark-guide"><strong>Self-mark: not scored automatically.</strong><p>{question.rubric}</p><label><input type="checkbox" checked={Boolean(selfReviewed[question.id])} onChange={(event) => setSelfReviewed({ ...selfReviewed, [question.id]: event.target.checked })} /> I compared my answer with the guide</label></div>}</>}
      </article>)}
      <p className="field-hint">Only objective questions count toward the numeric score. Self-marked questions are labelled and kept out of that score.</p>
      <div className="form-actions"><button className="button button-primary" type="button" onClick={onFinish}>Check and save practice</button><button className="button button-outline" type="button" onClick={onCancel}>Cancel practice</button></div>
    </> : <div className="study-practice-result">
      <div className="study-score"><strong>{attempt.score} / {attempt.total}</strong><span>objectively marked answers</span><small>{attempt.selfMarked} self-marked question{attempt.selfMarked === 1 ? '' : 's'} excluded from score</small></div>
      {attempt.incorrect.length ? <><h3>Review answers</h3>{attempt.incorrect.map((review, index) => <article className="study-review-card" key={`${index}-${review.prompt}`}><strong>{review.selfMark ? 'Self-mark review' : 'Review this answer'}</strong><p>{review.prompt}</p><p><strong>Your answer:</strong> {review.learnerAnswer || 'No answer entered'}</p>{review.selfMark ? <p><strong>Rubric:</strong> {review.rubric}</p> : <p><strong>Answer key:</strong> {review.expectedAnswer}</p>}{review.explanation && <p><strong>Guidance:</strong> {review.explanation}</p>}</article>)}</>
        : <p>All objectively marked answers matched their answer keys.</p>}
      <button className="button button-outline" type="button" onClick={onCancel}>Close practice review</button>
    </div>}
    {history.length > 0 && <p className="field-hint">You have {history.length} earlier practice session{history.length === 1 ? '' : 's'} for this test on this device.</p>}
  </section>;
}
