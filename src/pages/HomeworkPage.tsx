import { useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { askAi, validateAiSettings } from '../services/ai';
import { extractHomeworkText, MAX_HOMEWORK_FILE_BYTES } from '../services/document';
import { createId } from '../data/logic';
import { GRADES } from '../types';
import type { AiSettings, Grade, HomeworkItem, HomeworkUnderstanding, StudyData } from '../types';

type Props = {
  data: StudyData;
  persist: (data: StudyData, confirmation?: string) => Promise<boolean>;
  aiSettings: AiSettings;
  apiKey: string;
};

type HomeworkDraft = Omit<HomeworkItem, 'id' | 'createdAt' | 'understanding'> & {
  understanding: HomeworkUnderstanding;
};

const emptyUnderstanding = (): HomeworkUnderstanding => ({
  instructions: '',
  deliverables: '',
  constraints: '',
  steps: [],
  difficultTerms: [],
  comprehensionQuestions: [],
  brainstormPrompts: [],
});

function emptyDraft(grade: Grade | ''): HomeworkDraft {
  return {
    title: '',
    grade: grade || 'Grade 8',
    subject: '',
    dueDate: '',
    sourceFileName: '',
    sourceType: 'pasted',
    extractedText: '',
    learnerNotes: '',
    archived: false,
    understanding: emptyUnderstanding(),
  };
}

const aiActions = [
  { title: 'Explain the task in plain language', prompt: 'Explain what this assignment asks a learner to do in age-appropriate plain language. Do not write the final assignment.' },
  { title: 'Identify instructions and deliverables', prompt: 'Identify the instructions, things the learner must hand in or produce, and important constraints. Separate these clearly. Do not invent requirements.' },
  { title: 'Suggest manageable steps', prompt: 'Suggest an ordered list of small, manageable steps for completing this assignment. Encourage the learner to do their own work.' },
  { title: 'Explain difficult wording', prompt: 'Identify potentially difficult words or phrases in this assignment and explain them simply. If none are clear, say so.' },
  { title: 'Make comprehension questions', prompt: 'Create a few simple questions that help the learner check whether they understand the assignment. Do not provide completed assignment answers.' },
  { title: 'Brainstorm and organize ideas', prompt: 'Offer neutral brainstorming prompts and a simple way to organize the learner’s own ideas. Do not write the assignment for them.' },
] as const;

export default function HomeworkPage({ data, persist, aiSettings, apiKey }: Props) {
  const [draft, setDraft] = useState<HomeworkDraft>(() => emptyDraft(data.profile.grade));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileProgress, setFileProgress] = useState('');
  const [formError, setFormError] = useState('');
  const [localMessage, setLocalMessage] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  const visibleHomework = useMemo(
    () => data.homework.filter((item) => showArchived || !item.archived),
    [data.homework, showArchived],
  );
  const selected = data.homework.find((item) => item.id === selectedId);

  function startNew() {
    setDraft(emptyDraft(data.profile.grade));
    setEditingId(null);
    setShowForm(true);
    setFormError('');
    setLocalMessage('');
  }

  function startEdit(item: HomeworkItem) {
    setDraft({
      title: item.title,
      grade: item.grade,
      subject: item.subject,
      dueDate: item.dueDate,
      sourceFileName: item.sourceFileName,
      sourceType: item.sourceType,
      extractedText: item.extractedText,
      learnerNotes: item.learnerNotes,
      archived: item.archived,
      understanding: { ...item.understanding },
    });
    setEditingId(item.id);
    setShowForm(true);
    setFormError('');
    setLocalMessage('');
  }

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFormError('');
    setLocalMessage('');
    setBusy(true);
    try {
      const result = await extractHomeworkText(file, setFileProgress);
      setDraft((current) => ({
        ...current,
        title: current.title || file.name.replace(/\.[^.]+$/, ''),
        sourceFileName: file.name,
        sourceType: result.sourceType,
        extractedText: result.text,
      }));
      setLocalMessage(result.text
        ? `Read ${result.text.length.toLocaleString()} characters from ${file.name} locally. Review and correct the text before saving.`
        : 'No selectable text was found. This may be a scanned/image-only PDF. Paste or type the assignment text below.');
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'The file could not be read. You can paste or type the text instead.');
    } finally {
      setBusy(false);
      setFileProgress('');
    }
  }

  async function saveHomework(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.title.trim() || !draft.subject.trim() || !GRADES.includes(draft.grade as Grade)) {
      setFormError('Add a title, subject, and valid grade before saving.');
      return;
    }
    if (draft.extractedText.length > 500_000) {
      setFormError('The assignment text is too long to save. Keep it under 500,000 characters or save a shorter excerpt.');
      return;
    }
    const existing = editingId ? data.homework.find((item) => item.id === editingId) : undefined;
    const item: HomeworkItem = {
      ...draft,
      id: editingId ?? createId(),
      title: draft.title.trim(),
      subject: draft.subject.trim(),
      dueDate: draft.dueDate,
      sourceFileName: draft.sourceFileName.trim(),
      extractedText: draft.extractedText.trim(),
      learnerNotes: draft.learnerNotes.trim(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      understanding: {
        ...draft.understanding,
        steps: draft.understanding.steps.map((value) => value.trim()).filter(Boolean),
        difficultTerms: draft.understanding.difficultTerms.map((value) => value.trim()).filter(Boolean),
        comprehensionQuestions: draft.understanding.comprehensionQuestions.map((value) => value.trim()).filter(Boolean),
        brainstormPrompts: draft.understanding.brainstormPrompts.map((value) => value.trim()).filter(Boolean),
      },
    };
    const next = {
      ...data,
      homework: existing
        ? data.homework.map((entry) => entry.id === item.id ? item : entry)
        : [item, ...data.homework],
    };
    if (await persist(next, existing ? 'Homework updated on this device.' : 'Homework saved on this device.')) {
      setSelectedId(item.id);
      setShowForm(false);
      setEditingId(null);
      setDraft(emptyDraft(data.profile.grade));
      setFormError('');
      setLocalMessage('');
    }
  }

  async function toggleArchive(item: HomeworkItem) {
    const nextItem = { ...item, archived: !item.archived };
    if (await persist({
      ...data,
      homework: data.homework.map((entry) => entry.id === item.id ? nextItem : entry),
    }, item.archived ? 'Homework restored to the active list.' : 'Homework archived.')) {
      setSelectedId(item.id);
    }
  }

  async function removeHomework(item: HomeworkItem) {
    if (!window.confirm(`Delete “${item.title}” and its saved notes, breakdown, questions, and steps? This cannot be undone.`)) return;
    if (await persist({ ...data, homework: data.homework.filter((entry) => entry.id !== item.id) }, 'Homework and its linked material deleted.')) {
      if (selectedId === item.id) setSelectedId('');
      if (editingId === item.id) setShowForm(false);
    }
  }

  async function saveLocalTemplate(item: HomeworkItem) {
    const hasExisting = Object.values(item.understanding).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value.trim()));
    if (hasExisting && !window.confirm('Replace the current editable breakdown with a basic starter template?')) return;
    const updated: HomeworkItem = {
      ...item,
      understanding: {
        instructions: '',
        deliverables: '',
        constraints: '',
        steps: [
          'Read the whole assignment once.',
          'Underline instruction words and write what each one asks you to do.',
          'List everything you need to hand in or show.',
          'Check due date, length, format, and other rules.',
          'Do the work in small parts, then check it against the instructions.',
        ],
        difficultTerms: [],
        comprehensionQuestions: [
          'What is the main task?',
          'What will I need to hand in?',
          'What rules or limits do I need to follow?',
        ],
        brainstormPrompts: [
          'What do I already know about this topic?',
          'What examples or sources from class could help?',
          'Which idea do I want to explore first?',
        ],
      },
    };
    if (await persist({
      ...data,
      homework: data.homework.map((entry) => entry.id === item.id ? updated : entry),
    }, 'Editable starter steps and questions saved. Add details from your class instructions.')) {
      setSelectedId(item.id);
    }
  }

  async function askForHelp(item: HomeworkItem, prompt: string) {
    setAiError('');
    setAiAnswer('');
    const configError = validateAiSettings(aiSettings);
    if (configError) {
      setAiError(aiSettings.mode === 'off' ? 'AI is off. Use the editable local template and add your own notes, steps, and questions.' : configError);
      return;
    }
    if (aiSettings.mode === 'online' && !apiKey.trim()) {
      setAiError('Enter your API key for this session in Settings before using AI. It is not saved or exported.');
      return;
    }
    if (!item.extractedText.trim()) {
      setAiError('Add or paste the assignment text before asking AI to explain it.');
      return;
    }
    const disclosure = aiSettings.mode === 'online'
      ? 'This sends only the selected homework title, subject, assignment text, and this question to your configured online provider. The provider may charge fees and has its own data-handling terms. Qalumo cannot guarantee provider privacy. AI is not yet tested end-to-end in this project. Continue?'
      : `This sends only the selected homework title, subject, assignment text, and this question to the local service at ${aiSettings.baseUrl}. Qalumo has not tested AI end-to-end in this project. Continue?`;
    if (!window.confirm(disclosure)) return;
    setAiBusy(true);
    try {
      setAiAnswer(await askAi(
        aiSettings,
        apiKey,
        `Assignment title: ${item.title}\nSubject: ${item.subject}\nGrade: ${item.grade}\n\n${item.extractedText}`,
        prompt,
      ));
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : 'The AI request could not be completed. Check the service settings and connection.');
    } finally {
      setAiBusy(false);
    }
  }

  function updateDraft<K extends keyof HomeworkDraft>(field: K, value: HomeworkDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateUnderstanding(field: keyof HomeworkUnderstanding, value: string) {
    const listField = field !== 'instructions' && field !== 'deliverables' && field !== 'constraints';
    setDraft((current) => ({
      ...current,
      understanding: {
        ...current.understanding,
        [field]: listField ? value.split('\n') : value,
      },
    }));
  }

  return <>
    <header className="page-intro">
      <div><p className="eyebrow">Study section</p><h1>Homework, one step at a time.</h1><p className="intro-copy">Save assignment text on this device, review it, and plan your own work. Files are read in this browser; Qalumo does not upload them.</p></div>
      <button className="button button-primary" type="button" onClick={startNew}>Add homework <span aria-hidden="true">+</span></button>
    </header>

    <section className="content-card homework-format-info">
      <strong>Supported files: TXT, text-based PDF, and DOCX.</strong>
      <p>PDFs that contain only scanned images may have no extractable text; OCR is not included. If no text appears, paste or type it below. Files up to {Math.round(MAX_HOMEWORK_FILE_BYTES / (1024 * 1024))} MB are processed locally. Review and correct extracted text before using it.</p>
    </section>

    {showForm && <form className="form-card homework-editor" onSubmit={saveHomework} noValidate>
      <div className="editor-heading"><div><p className="eyebrow">Saved privately on this device</p><h2>{editingId ? 'Edit homework' : 'Add homework'}</h2></div><button type="button" className="icon-button" aria-label="Close homework form" onClick={() => { setShowForm(false); setFormError(''); }}>×</button></div>
      <label>Choose a TXT, PDF, or DOCX file<input type="file" accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => void loadFile(event)} disabled={busy} /></label>
      <p className="field-hint">File text is extracted only in your browser. PDF images are not read. You can also paste text directly.</p>
      {fileProgress && <p className="progress-message" role="status">{fileProgress}</p>}
      <div className="form-row">
        <label>Homework title *<input maxLength={160} value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} required /></label>
        <label>Subject *<input maxLength={100} value={draft.subject} onChange={(event) => updateDraft('subject', event.target.value)} required /></label>
      </div>
      <div className="form-row">
        <label>Grade *<select value={draft.grade} onChange={(event) => updateDraft('grade', event.target.value as Grade)}>{GRADES.map((grade) => <option key={grade}>{grade}</option>)}</select></label>
        <label>Due date (optional)<input type="date" value={draft.dueDate} onChange={(event) => updateDraft('dueDate', event.target.value)} /></label>
      </div>
      {draft.sourceFileName && <div className="homework-source-file"><strong>Source file:</strong> {draft.sourceFileName} · {draft.sourceType.toUpperCase()}</div>}
      <label>Assignment text — review and correct before use<textarea rows={10} maxLength={500000} value={draft.extractedText} onChange={(event) => updateDraft('extractedText', event.target.value)} placeholder="Paste or type the homework instructions here." /></label>
      <label>Learner notes<textarea rows={3} maxLength={5000} value={draft.learnerNotes} onChange={(event) => updateDraft('learnerNotes', event.target.value)} placeholder="Your own reminders or questions (optional)" /></label>
      <details className="homework-breakdown-editor" open>
        <summary>Edit your manual breakdown and study prompts</summary>
        <p className="field-hint">These fields are saved with this homework. Add your own interpretation; generic starter prompts are not assignment answers.</p>
        <label>What do the instructions ask?<textarea rows={2} value={draft.understanding.instructions} onChange={(event) => updateUnderstanding('instructions', event.target.value)} /></label>
        <label>What do you need to hand in or produce?<textarea rows={2} value={draft.understanding.deliverables} onChange={(event) => updateUnderstanding('deliverables', event.target.value)} /></label>
        <label>Important rules or limits<textarea rows={2} value={draft.understanding.constraints} onChange={(event) => updateUnderstanding('constraints', event.target.value)} /></label>
        <label>Steps (one per line)<textarea rows={4} value={draft.understanding.steps.join('\n')} onChange={(event) => updateUnderstanding('steps', event.target.value)} /></label>
        <label>Difficult terms (one per line)<textarea rows={3} value={draft.understanding.difficultTerms.join('\n')} onChange={(event) => updateUnderstanding('difficultTerms', event.target.value)} /></label>
        <label>Comprehension questions (one per line)<textarea rows={3} value={draft.understanding.comprehensionQuestions.join('\n')} onChange={(event) => updateUnderstanding('comprehensionQuestions', event.target.value)} /></label>
        <label>Brainstorming prompts (one per line)<textarea rows={3} value={draft.understanding.brainstormPrompts.join('\n')} onChange={(event) => updateUnderstanding('brainstormPrompts', event.target.value)} /></label>
      </details>
      {localMessage && <p className="field-hint" role="status">{localMessage}</p>}
      {formError && <p className="field-error" role="alert">{formError}</p>}
      <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy}>{editingId ? 'Save changes' : 'Save homework'}</button><button className="button button-outline" type="button" onClick={() => { setShowForm(false); setFormError(''); }}>Cancel</button></div>
    </form>}

    <section className="homework-library-area" aria-labelledby="homework-list-title">
      <div className="section-heading"><div><p className="eyebrow">Personal assignments</p><h2 id="homework-list-title">Your homework</h2></div><label className="inline-checkbox"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label></div>
      {visibleHomework.length === 0
        ? <div className="empty-card"><span className="empty-icon">H</span><h2>{showArchived ? 'No homework saved yet' : 'No active homework'}</h2><p>Add an assignment file or paste its text. Your homework stays in this browser and is included only in full-app backups unless you explicitly select it for a study-library package.</p><button className="button button-outline" type="button" onClick={startNew}>Add homework</button></div>
        : <div className="homework-grid">{visibleHomework.map((item) => <article className={`homework-card ${item.archived ? 'is-archived' : ''}`} key={item.id}>
          <div className="homework-card-heading"><span className={item.archived ? 'tag' : 'tag tag-green'}>{item.archived ? 'Archived' : 'Active'}</span><span className="tag">{item.grade}</span></div>
          <h3>{item.title}</h3><p className="homework-card-meta">{item.subject}{item.dueDate ? ` · Due ${new Date(`${item.dueDate}T00:00:00`).toLocaleDateString()}` : ''}</p>
          <p className="homework-source-meta">{item.sourceFileName ? `${item.sourceFileName} · ${item.sourceType.toUpperCase()}` : 'Pasted or typed text'} · Added {new Date(item.createdAt).toLocaleDateString()}</p>
          <div className="homework-card-actions"><button className="text-button" type="button" onClick={() => { setSelectedId(item.id); setAiAnswer(''); setAiError(''); }}>View</button><button className="text-button" type="button" onClick={() => startEdit(item)}>Edit</button><button className="text-button" type="button" onClick={() => void toggleArchive(item)}>{item.archived ? 'Restore' : 'Archive'}</button><button className="text-button danger-text" type="button" onClick={() => void removeHomework(item)}>Delete</button></div>
        </article>)}</div>}
    </section>

    {selected && <section className="content-card homework-detail" aria-labelledby="homework-detail-title">
      <div className="section-heading"><div><p className="eyebrow">Assignment review</p><h2 id="homework-detail-title">{selected.title}</h2></div><button type="button" className="icon-button" aria-label="Close homework details" onClick={() => { setSelectedId(''); setAiAnswer(''); setAiError(''); }}>×</button></div>
      <p className="homework-card-meta">{selected.grade} · {selected.subject}{selected.dueDate ? ` · Due ${new Date(`${selected.dueDate}T00:00:00`).toLocaleDateString()}` : ''}</p>
      <p className="homework-source-meta">{selected.sourceFileName ? `${selected.sourceFileName} · ${selected.sourceType.toUpperCase()}` : 'Pasted or typed text'} · Added {new Date(selected.createdAt).toLocaleDateString()}</p>
      <div className="homework-text-review"><h3>Assignment text</h3>{selected.extractedText ? <pre>{selected.extractedText}</pre> : <p>No assignment text is saved yet. Edit this item to paste or type it.</p>}</div>
      {selected.learnerNotes && <div className="homework-notes"><h3>Your notes</h3><p>{selected.learnerNotes}</p></div>}
      <section className="understanding-panel">
        <div className="section-heading compact"><div><p className="eyebrow">Local planning tools</p><h3>Your breakdown</h3></div><button className="button button-outline" type="button" onClick={() => void saveLocalTemplate(selected)}>Add editable starter steps</button></div>
        <p>These are generic planning prompts, not an interpretation of the assignment. Edit them to match your teacher’s instructions.</p>
        <div className="understanding-grid">
          <div><h4>Instructions, deliverables, and constraints</h4>
            <p><strong>What the instructions ask:</strong> {selected.understanding.instructions || 'Add this in Edit.'}</p>
            <p><strong>What to hand in:</strong> {selected.understanding.deliverables || 'Add this in Edit.'}</p>
            <p><strong>Important rules:</strong> {selected.understanding.constraints || 'Add this in Edit.'}</p>
          </div>
          <div><h4>Steps</h4><ol>{selected.understanding.steps.length ? selected.understanding.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>) : <li>No steps yet. Add an editable starter or use Edit.</li>}</ol></div>
          <div><h4>Difficult terms</h4><ul>{selected.understanding.difficultTerms.length ? selected.understanding.difficultTerms.map((term, index) => <li key={`${index}-${term}`}>{term}</li>) : <li>Add words you want to look up.</li>}</ul></div>
          <div><h4>Comprehension questions</h4><ul>{selected.understanding.comprehensionQuestions.length ? selected.understanding.comprehensionQuestions.map((question, index) => <li key={`${index}-${question}`}>{question}</li>) : <li>Add questions to check your understanding.</li>}</ul></div>
          <div><h4>Brainstorming prompts</h4><ul>{selected.understanding.brainstormPrompts.length ? selected.understanding.brainstormPrompts.map((prompt, index) => <li key={`${index}-${prompt}`}>{prompt}</li>) : <li>Add prompts for organizing your own ideas.</li>}</ul></div>
        </div>
        <button className="button button-outline" type="button" onClick={() => startEdit(selected)}>Edit notes and breakdown</button>
      </section>
      <section className="homework-ai-panel">
        <div className="ai-disclosure"><strong>Optional AI suggestions · not tested end-to-end in this project</strong><p>AI actions need your configured online API or local compatible service and may fail. Online requests send the selected assignment content and your chosen prompt to the provider. Check every suggestion against your class instructions and trusted materials. Do your own work; suggestions are not guaranteed answers.</p></div>
        {aiSettings.mode === 'off' && <p className="field-hint">AI is off. The local notes, editable steps, questions, and brainstorming fields above still work.</p>}
        <div className="homework-ai-actions">{aiActions.map((action) => <button key={action.title} className="button button-outline" type="button" disabled={aiBusy || !selected.extractedText.trim()} onClick={() => void askForHelp(selected, action.prompt)}>{action.title}</button>)}</div>
        {aiBusy && <p className="progress-message" role="status">Waiting for the configured AI service…</p>}
        {aiError && <p className="field-error" role="alert">{aiError}</p>}
        {aiAnswer && <div className="ai-answer"><strong>AI suggestion — review it, then edit your own notes if useful.</strong><p>{aiAnswer}</p></div>}
      </section>
    </section>}

  </>;
}
