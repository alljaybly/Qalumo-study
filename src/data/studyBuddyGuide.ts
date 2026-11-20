// Local, dependency-free study guidance. Everything here runs on the device with no AI service,
// so the guide still works when AI is off or offline. It reads the learner's own text and offers
// neutral prompts; it never writes the assignment or claims to know what a teacher expects.

export type AssignmentAction = 'explain' | 'hint' | 'quiz' | 'plan';

export type AssignmentAnalysis = {
  title: string;
  summary: string;
  instructionWords: string[];
  // Instruction words worth naming in a plain-language summary (weak verbs like "use" are dropped).
  focusWords: string[];
  taskSentences: string[];
  deliverables: string[];
  constraints: string[];
  steps: string[];
  quiz: string[];
  terms: string[];
  words: number;
};

const INSTRUCTION_WORDS = [
  'explain', 'describe', 'discuss', 'calculate', 'solve', 'define', 'list', 'compare', 'contrast',
  'analyse', 'analyze', 'evaluate', 'summarise', 'summarize', 'draw', 'label', 'write', 'read',
  'answer', 'complete', 'research', 'present', 'prove', 'show', 'name', 'state', 'identify', 'use',
  'create', 'design', 'interview', 'sketch', 'graph', 'match', 'choose', 'give', 'find', 'investigate',
  'plan', 'prepare', 'review', 'revise', 'memorise', 'memorize', 'practise', 'practice', 'copy',
  'correct', 'rewrite', 'translate', 'measure', 'estimate', 'order', 'sort', 'classify', 'test',
];

// Words that appear in almost every assignment and would make useless "difficult term" prompts.
// Verbs that rarely describe what the learner must produce, so they are poor summary words.
const WEAK_SUMMARY_WORDS = new Set(['use', 'show', 'read', 'find', 'give', 'choose', 'test', 'order', 'sort', 'copy', 'match', 'label', 'state', 'name', 'complete', 'answer']);

const COMMON_WORDS = new Set([
  'assignment', 'question', 'questions', 'following', 'paragraph', 'paragraphs', 'sentence', 'sentences',
  'because', 'something', 'anything', 'yourself', 'themselves', 'important', 'information', 'activity',
  'activities', 'worksheet', 'homework', 'teacher', 'school', 'please', 'remember', 'complete',
  'completed', 'answers', 'answer', 'writing', 'written', 'understand', 'understanding', 'different',
]);

const HINTS: Record<string, string> = {
  explain: 'Start a sentence with “This means …” and give one everyday example. If you can say it to a friend, you understand it.',
  describe: 'Close your eyes and picture it, then write what you see, hear, or notice — one detail at a time.',
  discuss: 'Write one idea for and one idea against. Then say which one you think is stronger and why.',
  calculate: 'Write down what you know, then what you must find. Choose the operation that connects them before you work it out.',
  solve: 'Write the information you were given, then the one thing you must find. Try the smallest first step.',
  define: 'Say what it is, then give one example. Then say what it is not — that often makes the meaning clearer.',
  list: 'Number your ideas quickly without judging them. You can cross out the weak ones afterwards.',
  compare: 'Make two columns: what is the same, and what is different. Write one point per row.',
  contrast: 'Make two columns and look only for differences, one point per row.',
  analyse: 'Break the whole thing into parts. Ask: what are the parts, and how do they work together?',
  evaluate: 'Say what is good, what is weak, and what your judgement is. Give a reason for your judgement.',
  summarise: 'Write the main idea in one sentence. Then add only the details that are needed to understand it.',
  write: 'Plan three points before you write. One point per paragraph is enough to start.',
  draw: 'Lightly plan the space first, then add the big shapes before the small details.',
  label: 'Write the labels clearly and draw a straight line to the exact part.',
  research: 'Write your question first. Then note the source of every fact so you can check it later.',
  answer: 'Read the question twice and underline the instruction word. Answer that word, not a different one.',
  complete: 'Fill in what you are sure of first, then go back to the parts that need thinking.',
  prove: 'Write what you are given, what you must show, and each step in between with a reason.',
  investigate: 'Write what you think will happen, then what actually happened, then why they differ.',
  plan: 'List the parts you must do, put them in order, and give each part a small time limit.',
  prepare: 'Write what you need, then do the shortest task first to build momentum.',
  revise: 'Cover your notes, write what you remember, then check and fill only the gaps.',
};

const DEFAULT_HINT = 'Find the action word in the instructions — the verb that tells you what to do. Underline it, then write one sentence about what it asks for.';

const AI_PROMPTS: Record<AssignmentAction, string> = {
  explain: 'Explain what this assignment asks a learner to do, in short, age-appropriate words. Do not write the assignment or give finished answers.',
  hint: 'Give one short hint that helps the learner make their own start. Do not give the answer or write any part of the assignment for them.',
  quiz: 'Ask up to three short questions that check whether the learner understands the task. Do not give the answers.',
  plan: 'Suggest a short, ordered plan of small steps the learner can follow. Do not do the work for them.',
};

export const AI_ACTION_LABELS: Record<AssignmentAction, string> = {
  explain: 'Ask AI to explain',
  hint: 'Ask AI for another hint',
  quiz: 'Ask AI for a quiz',
  plan: 'Ask AI to help plan',
};

export function aiPromptFor(action: AssignmentAction): string {
  return AI_PROMPTS[action];
}

function title(source: string): string {
  const line = source
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 2);
  if (!line) return '';
  const cleaned = line.replace(/^(?:question|q)\s*\d+\s*[).:\-]\s*/i, '').trim() || line;
  return cleaned.length > 80 ? `${cleaned.slice(0, 77).trimEnd()}…` : cleaned;
}

// Split without regex lookbehind, which some older phone browsers do not support.
function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/([.!?])\s+/)
    .reduce<string[]>((parts, piece, index, all) => {
      if (index % 2 === 0) {
        const punctuation = all[index + 1] ?? '';
        const joined = `${piece}${punctuation}`.trim();
        if (joined.length > 3) parts.push(joined);
      }
      return parts;
    }, []);
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) return trimmed;
  const slice = trimmed.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > max / 2 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

// Long regex captures often run on into a second instruction, so keep the first clear phrase.
function cleanPhrase(value: string): string {
  const first = value.split(/\s+(?:and|then|but|or)\s+/i)[0].trim();
  return truncate(first, 60);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findDeliverables(text: string): string[] {
  const patterns = [
    /\b(?:write|prepare|create|make|draw|design)\s+(?:a|an|the)?\s*([^.;\n]{3,70})/gi,
    /\b(?:hand in|submit|upload|bring)\s+([^.;\n]{3,70})/gi,
    /\banswer\s+(?:the\s+)?(?:following\s+)?([^.;\n]{3,70})/gi,
    /\bcomplete\s+([^.;\n]{3,70})/gi,
  ];
  const found: string[] = [];
  patterns.forEach((pattern) => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null && found.length < 6) {
      found.push(cleanPhrase(match[1]));
    }
  });
  return unique(found).slice(0, 3);
}

function findConstraints(text: string): string[] {
  const found: string[] = [];
  const limit = /\b(\d+)\s*(words?|pages?|paragraphs?|sentences?|marks?|minutes?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = limit.exec(text)) !== null && found.length < 6) {
    found.push(`${match[1]} ${match[2].toLocaleLowerCase()}`);
  }
  const phrases = /\b(?:at least|no more than|not more than|less than|minimum of|maximum of)\s+[^.;\n]{2,50}/gi;
  while ((match = phrases.exec(text)) !== null && found.length < 6) {
    found.push(cleanPhrase(match[0]));
  }
  const rules = /\b(in your own words|show all (?:your )?working|show your working|use a (?:calculator|dictionary)|neatly|in pencil|include (?:a )?(?:reference|sources)|cite your sources|work in pairs|work alone)\b/gi;
  while ((match = rules.exec(text)) !== null && found.length < 6) {
    found.push(match[0]);
  }
  return unique(found).slice(0, 4);
}

function findTerms(text: string): string[] {
  const tokens = text.match(/[A-Za-z][A-Za-z-]{7,}/g) ?? [];
  const counts = new Map<string, number>();
  tokens.forEach((token) => {
    const key = token.toLocaleLowerCase();
    if (COMMON_WORDS.has(key)) return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()]
    .filter(([, count]) => count <= 3)
    .map(([word]) => word)
    .slice(0, 2);
}

function buildSteps(analysis: Omit<AssignmentAnalysis, 'steps'>): string[] {
  const steps: string[] = ['Read the whole task once without writing anything. Then say out loud what you think it asks for.'];
  if (analysis.instructionWords.length) {
    steps.push(`Underline the instruction words: ${analysis.instructionWords.slice(0, 4).join(', ')}. Each one tells you what kind of thinking to do.`);
  }
  if (analysis.deliverables.length) {
    steps.push(`Write down what you must hand in or show: ${analysis.deliverables.join('; ')}.`);
  }
  if (analysis.constraints.length) {
    steps.push(`Check the rules before you start: ${analysis.constraints.join('; ')}.`);
  }
  if (analysis.taskSentences.length) {
    steps.push(`Start with one small part: “${truncate(analysis.taskSentences[0], 140)}” Write one sentence or one example — not the whole answer.`);
  }
  steps.push('Work in short blocks. After each block, stop and check what you wrote against the instructions.');
  steps.push('Read your work back, or explain it to someone. If a part is hard to explain, that is the part to look at again.');
  return steps;
}

export function analyseAssignment(raw: string): AssignmentAnalysis {
  const text = raw.trim();
  const sentences = sentencesOf(text);
  const instructionWords = INSTRUCTION_WORDS.filter((word) => new RegExp(`\\b${word}s?\\b`, 'i').test(text));
  const taskSentences = sentences
    .filter((sentence) => INSTRUCTION_WORDS.some((word) => new RegExp(`\\b${word}s?\\b`, 'i').test(sentence)))
    .slice(0, 3)
    .map((sentence) => truncate(sentence, 180));

  const focusWords = instructionWords.filter((word) => !WEAK_SUMMARY_WORDS.has(word)).slice(0, 2);
  const base = {
    title: title(text) || 'My assignment',
    summary: '',
    instructionWords,
    focusWords,
    taskSentences,
    deliverables: findDeliverables(text),
    constraints: findConstraints(text),
    quiz: [] as string[],
    terms: findTerms(text),
    words: text ? text.split(/\s+/).filter(Boolean).length : 0,
  };

  const summaryAction = focusWords.length ? focusWords.join(' and ') : 'work through the instructions';
  const summary = taskSentences.length
    ? `This task asks you to ${summaryAction}. The clearest instruction is: “${truncate(taskSentences[0], 200)}”`
    : 'Qalumo could not find a clear instruction word (for example explain, describe, calculate, or list). Read the task again and underline the verb that tells you what to do, then add it here.';

  const analysis: AssignmentAnalysis = { ...base, summary, steps: [] };
  const quiz: string[] = [
    'In your own words, what is this task asking you to do?',
  ];
  if (analysis.deliverables.length) quiz.push('What exactly must you hand in or show?');
  if (analysis.constraints.length) quiz.push('Which rule or limit must you remember while working?');
  if (focusWords[0]) {
    const quizVerb = focusWords[0] === 'write' ? 'explain' : focusWords[0];
    quiz.push(`How would you ${quizVerb} the main idea to a friend in two sentences?`);
  }
  if (analysis.terms[0]) quiz.push(`What does “${analysis.terms[0]}” mean? Say it in your own words, then check your class notes.`);
  analysis.quiz = quiz.slice(0, 4);
  analysis.steps = buildSteps(analysis);
  return analysis;
}

export function localHint(analysis: AssignmentAnalysis): string {
  const hint = analysis.instructionWords.map((word) => HINTS[word]).find(Boolean);
  return hint ?? DEFAULT_HINT;
}

export function deriveTitle(raw: string): string {
  return title(raw);
}
