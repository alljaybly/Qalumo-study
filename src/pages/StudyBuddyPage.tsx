import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { askAi, validateAiSettings } from '../services/ai';
import { extractHomeworkText, MAX_HOMEWORK_FILE_BYTES } from '../services/document';
import { AI_ACTION_LABELS, aiPromptFor, analyseAssignment, localHint } from '../data/studyBuddyGuide';
import type { AssignmentAction, AssignmentAnalysis } from '../data/studyBuddyGuide';
import type { AiSettings } from '../types';

type Props = {
  initialText: string;
  startWithLink: boolean;
  aiSettings: AiSettings;
  apiKey: string;
  onSaveHomework: (text: string, analysis: AssignmentAnalysis) => Promise<boolean>;
  onOpenHomework: () => void;
  onOpenSettings: () => void;
};

const actionButtons: { action: AssignmentAction; label: string }[] = [
  { action: 'explain', label: 'Explain it' },
  { action: 'hint', label: 'Give me a hint' },
  { action: 'quiz', label: 'Quiz me' },
  { action: 'plan', label: 'Help me plan' },
];

export default function StudyBuddyPage({ initialText, startWithLink, aiSettings, apiKey, onSaveHomework, onOpenHomework, onOpenSettings }: Props) {
  const [text, setText] = useState(initialText);
  const [analysis, setAnalysis] = useState<AssignmentAnalysis | null>(() => (initialText.trim() ? analyseAssignment(initialText) : null));
  const [linkOpen, setLinkOpen] = useState(startWithLink);
  const [panel, setPanel] = useState<AssignmentAction | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<string[]>([]);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileProgress, setFileProgress] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReply, setAiReply] = useState('');
  const [aiError, setAiError] = useState('');
  const [saved, setSaved] = useState(false);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (startWithLink) textRef.current?.focus();
  }, [startWithLink]);

  useEffect(() => {
    if (panel) panelRef.current?.scrollIntoView({ block: 'nearest' });
  }, [panel]);

  function begin() {
    const value = text.trim();
    if (!value) {
      setError('Paste or type what you are working on first, then choose Start.');
      return;
    }
    setAnalysis(analyseAssignment(value));
    setPanel(null);
    setStepIndex(0);
    setQuizAnswers([]);
    setAiReply('');
    setAiError('');
    setSaved(false);
    setNotice('');
    setError('');
  }

  function startOver() {
    setText('');
    setAnalysis(null);
    setPanel(null);
    setStepIndex(0);
    setQuizAnswers([]);
    setAiReply('');
    setAiError('');
    setSaved(false);
    setNotice('');
    setError('');
    setLinkOpen(false);
    textRef.current?.focus();
  }

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setNotice('');
    setFileBusy(true);
    try {
      const result = await extractHomeworkText(file, setFileProgress);
      if (!result.text) {
        setNotice(`No selectable text was found in ${file.name}. This may be a scanned PDF or a picture. Paste or type the assignment instead.`);
        return;
      }
      setText(result.text);
      setAnalysis(analyseAssignment(result.text));
      setStepIndex(0);
      setPanel(null);
      setQuizAnswers([]);
      setNotice(`Read ${result.text.length.toLocaleString()} characters from ${file.name} on this device. Check that the text looks right, then work through the steps.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be read. You can paste or type the text instead.');
    } finally {
      setFileBusy(false);
      setFileProgress('');
    }
  }

  function updateText() {
    const value = text.trim();
    if (!value) {
      setError('Add some text first.');
      return;
    }
    setAnalysis(analyseAssignment(value));
    setStepIndex(0);
    setPanel(null);
    setQuizAnswers([]);
    setAiReply('');
    setNotice('Using the updated assignment text.');
    setError('');
  }

  async function askAiFor(action: AssignmentAction) {
    if (!analysis) return;
    setAiError('');
    setAiReply('');
    const configError = validateAiSettings(aiSettings);
    if (configError) {
      setAiError(aiSettings.mode === 'off'
        ? 'AI is off. The local buttons above still work, or you can turn AI on in Settings.'
        : configError);
      return;
    }
    if (aiSettings.mode === 'online' && !apiKey.trim()) {
      setAiError('Enter your API key for this session in Settings before using AI. It is not saved or exported.');
      return;
    }
    const disclosure = aiSettings.mode === 'online'
      ? 'This sends only this assignment text and your chosen action to your configured online provider. The provider may charge fees and has its own data-handling terms. Qalumo cannot guarantee provider privacy. Continue?'
      : `This sends only this assignment text and your chosen action to the local service at ${aiSettings.baseUrl}. Continue?`;
    if (!window.confirm(disclosure)) return;
    setAiBusy(true);
    try {
      const reply = await askAi(
        aiSettings,
        apiKey,
        `Assignment title: ${analysis.title}\n\n${text}`,
        aiPromptFor(action),
        400,
      );
      setAiReply(reply);
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : 'The AI request could not be completed. Check the service settings and connection.');
    } finally {
      setAiBusy(false);
    }
  }

  async function saveAsHomework() {
    if (!analysis) return;
    setError('');
    const savedOk = await onSaveHomework(text, analysis);
    if (savedOk) {
      setSaved(true);
      setNotice('Saved in your homework on this device. You can add a subject, due date, or notes there.');
    }
  }

  const aiEnabled = aiSettings.mode !== 'off';

  if (!analysis) {
    return <>
      <header className="page-intro">
        <div><p className="eyebrow">Study buddy</p><h1>What are you working on?</h1><p className="intro-copy">Type or paste a question, a topic, or your homework instructions. You do not need an account or an API key to start.</p></div>
      </header>

      <section className="content-card buddy-start">
        <label className="buddy-start-label" htmlFor="buddy-start-text">Paste it here</label>
        <textarea
          id="buddy-start-text"
          ref={textRef}
          className="buddy-start-input"
          rows={6}
          maxLength={50000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="For example: “Explain why plants need sunlight” or “Questions 1–5 on page 42” or paste the whole assignment."
        />
        <div className="buddy-start-actions">
          <button className="button button-primary" type="button" onClick={begin} disabled={!text.trim()}>Start <span aria-hidden="true">→</span></button>
          <button className="button button-outline" type="button" aria-expanded={linkOpen} onClick={() => setLinkOpen((open) => !open)}>My assignment is in a link</button>
          <label className={`button button-outline buddy-file-button ${fileBusy ? 'is-busy' : ''}`}>
            {fileBusy ? 'Reading file…' : 'Add a file'}
            <input type="file" accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => void loadFile(event)} disabled={fileBusy} />
          </label>
        </div>
        <p className="field-hint">Files: TXT, text-based PDF, and DOCX, up to {Math.round(MAX_HOMEWORK_FILE_BYTES / (1024 * 1024))} MB. Extracted in this browser; nothing is uploaded. Scanned image-only PDFs may need the text pasted instead.</p>
        {fileProgress && <p className="progress-message" role="status">{fileProgress}</p>}
        {notice && <p className="field-hint" role="status">{notice}</p>}
        {error && <p className="field-error" role="alert">{error}</p>}

        {linkOpen && <div className="buddy-link-help">
          <h2>If your assignment is on a website</h2>
          <p>Qalumo cannot open a website for you. It has no way to log in, and many school links only open for your school account. You open the link; Qalumo helps with the text you bring back.</p>
          <ol>
            <li>Open the link in another tab and sign in to whatever your school uses.</li>
            <li>Find the instructions. If you can select the text, copy it. If the page only shows a picture or a video, ask your teacher for the text or write a short summary in your own words.</li>
            <li>Come back here and paste it in the box above. You can also save the page as a TXT, PDF, or DOCX file and use <strong>Add a file</strong>.</li>
          </ol>
          <p className="field-hint">If the link asks for a school login, is restricted, or will not open, that is a limit Qalumo cannot bypass. Ask a caregiver or teacher for the instructions instead.</p>
          <button className="button button-light" type="button" onClick={() => { setLinkOpen(false); textRef.current?.focus(); }}>I have the text — paste it</button>
        </div>}
      </section>

      <section className="content-card buddy-explainer">
        <h2>How this works</h2>
        <ul>
          <li><strong>Explain it</strong> — says what the task is asking, in plain words.</li>
          <li><strong>Give me a hint</strong> — one nudge so you can make your own start.</li>
          <li><strong>Quiz me</strong> — a few questions to check you understand the task.</li>
          <li><strong>Help me plan</strong> — small steps you can actually finish.</li>
        </ul>
        <p>These prompts are made on this device from your own text. They are not finished answers and they are not marked. Optional AI suggestions need your own service and may fail or be wrong — check them against your class work.</p>
      </section>
    </>;
  }

  return <>
    <header className="page-intro">
      <div><p className="eyebrow">Study buddy</p><h1>{analysis.title}</h1><p className="intro-copy">{analysis.words.toLocaleString()} words · worked through on this device</p></div>
      <button className="button button-outline" type="button" onClick={startOver}>Start over</button>
    </header>

    <section className="content-card buddy-summary" aria-labelledby="buddy-summary-title">
      <div className="section-heading compact"><div><p className="eyebrow">What this asks</p><h2 id="buddy-summary-title">The task in plain words</h2></div><span className="tag tag-green">{analysis.focusWords.length ? analysis.focusWords.join(' · ') : 'Read carefully'}</span></div>
      <p>{analysis.summary}</p>
      {(analysis.deliverables.length > 0 || analysis.constraints.length > 0) && <div className="buddy-facts">
        {analysis.deliverables.length > 0 && <div><h3>What to hand in</h3><ul>{analysis.deliverables.map((entry) => <li key={entry}>{entry}</li>)}</ul></div>}
        {analysis.constraints.length > 0 && <div><h3>Rules to remember</h3><ul>{analysis.constraints.map((entry) => <li key={entry}>{entry}</li>)}</ul></div>}
      </div>}
      <details className="buddy-text-details">
        <summary>Show or edit the assignment text</summary>
        <textarea rows={8} maxLength={50000} value={text} aria-label="Assignment text" onChange={(event) => setText(event.target.value)} />
        <div className="buddy-start-actions">
          <button className="button button-outline" type="button" onClick={updateText}>Use this text</button>
          <label className="button button-light buddy-file-button">
            {fileBusy ? 'Reading file…' : 'Replace with a file'}
            <input type="file" accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => void loadFile(event)} disabled={fileBusy} />
          </label>
        </div>
        {fileProgress && <p className="progress-message" role="status">{fileProgress}</p>}
      </details>
      {notice && <p className="field-hint" role="status">{notice}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>

    <section className="content-card buddy-steps" aria-labelledby="buddy-steps-title">
      <div className="section-heading compact"><div><p className="eyebrow">Your plan</p><h2 id="buddy-steps-title">One step at a time</h2></div><span className="tag">Step {Math.min(stepIndex + 1, analysis.steps.length)} of {analysis.steps.length}</span></div>
      <ol className="buddy-step-list">
        {analysis.steps.map((step, index) => <li key={`${index}-${step}`} className={index === stepIndex ? 'is-current' : index < stepIndex ? 'is-done' : ''}>
          <span className="buddy-step-number" aria-hidden="true">{index < stepIndex ? '✓' : index + 1}</span>
          <span>{step}</span>
          {index === stepIndex && <span className="sr-only"> — current step</span>}
        </li>)}
      </ol>
      <div className="buddy-step-actions">
        <button className="button button-light" type="button" onClick={() => setStepIndex((index) => Math.max(0, index - 1))} disabled={stepIndex === 0}>Back</button>
        {stepIndex < analysis.steps.length - 1
          ? <button className="button button-primary" type="button" onClick={() => setStepIndex((index) => Math.min(analysis.steps.length - 1, index + 1))}>Next step <span aria-hidden="true">→</span></button>
          : <span className="buddy-step-done">Last step. Check your work before you hand it in.</span>}
      </div>
    </section>

    <section className="content-card buddy-tools" aria-labelledby="buddy-tools-title">
      <div className="section-heading compact"><div><p className="eyebrow">Stuck?</p><h2 id="buddy-tools-title">Pick what helps right now</h2></div></div>
      <div className="buddy-tool-buttons">
        {actionButtons.map(({ action, label }) => <button
          key={action}
          className={`button ${panel === action ? 'button-primary' : 'button-outline'}`}
          type="button"
          aria-pressed={panel === action}
          onClick={() => setPanel((current) => current === action ? null : action)}
        >{label}</button>)}
      </div>

      {panel && <div className="buddy-panel" ref={panelRef} role="region" aria-live="polite">
        {panel === 'explain' && <>
          <h3>What it is asking</h3>
          <p>{analysis.summary}</p>
          {analysis.deliverables.length > 0 && <p><strong>Hand in or show:</strong> {analysis.deliverables.join('; ')}.</p>}
          {analysis.constraints.length > 0 && <p><strong>Keep to these rules:</strong> {analysis.constraints.join('; ')}.</p>}
          <p className="field-hint">This is a reading of your text, not your teacher’s marking guide. Follow the instructions you were given.</p>
        </>}
        {panel === 'hint' && <>
          <h3>One hint</h3>
          <p>{localHint(analysis)}</p>
          <p className="field-hint">Try a sentence of your own before asking anyone or anything for more.</p>
        </>}
        {panel === 'quiz' && <>
          <h3>Check your understanding</h3>
          <p>Answer out loud or in the boxes. Nothing is marked or saved.</p>
          <ol className="buddy-quiz">
            {analysis.quiz.map((question, index) => <li key={question}>
              <label>{question}
                <textarea rows={2} maxLength={500} value={quizAnswers[index] ?? ''} onChange={(event) => setQuizAnswers((current) => {
                  const next = [...current];
                  next[index] = event.target.value;
                  return next;
                })} placeholder="Your answer in your own words" />
              </label>
            </li>)}
          </ol>
          <p className="field-hint">If you cannot answer one, that is the part to reread first.</p>
        </>}
        {panel === 'plan' && <>
          <h3>Small steps</h3>
          <ol className="buddy-quiz">
            {analysis.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <p className="field-hint">Do one step, then stop. Short work you finish beats a long plan you never start.</p>
        </>}
      </div>}

      <div className="buddy-ai">
        <div className="ai-disclosure local-disclosure">
          <strong>Optional AI help</strong>
          <p>{aiEnabled ? 'AI is on for this session. It can suggest wording, but it can be wrong and it does not know your teacher’s instructions. Only this assignment text and your chosen action are sent.' : 'AI is off, so everything above is made on this device. You can turn it on in Settings, but you never need it to use Qalumo.'}</p>
        </div>
        {aiEnabled
          ? <div className="buddy-tool-buttons">
            {actionButtons.map(({ action }) => <button key={action} className="button button-light" type="button" disabled={aiBusy} onClick={() => void askAiFor(action)}>{AI_ACTION_LABELS[action]}</button>)}
          </div>
          : <button className="text-button" type="button" onClick={onOpenSettings}>Open AI settings</button>}
        {aiBusy && <p className="progress-message" role="status">Waiting for the configured AI service…</p>}
        {aiError && <p className="field-error" role="alert">{aiError}</p>}
        {aiReply && <div className="ai-answer"><strong>AI suggestion — check it against your class instructions.</strong><p>{aiReply}</p></div>}
      </div>
    </section>

    <section className="content-card buddy-save">
      <div className="section-heading compact"><div><p className="eyebrow">Keep it</p><h2>Save this assignment</h2></div></div>
      <p>Save the text so you can come back to it, add a subject or due date later, or archive it when it is finished. It stays on this device.</p>
      <div className="buddy-start-actions">
        <button className="button button-primary" type="button" onClick={() => void saveAsHomework()}>{saved ? 'Save again' : 'Save to my homework'}</button>
        {saved && <button className="button button-outline" type="button" onClick={onOpenHomework}>Open homework</button>}
      </div>
    </section>
  </>;
}
