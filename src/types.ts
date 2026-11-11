export const GRADES = [
  'Grade R', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5',
  'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12',
] as const;

export const LANGUAGES = [
  'English', 'isiZulu', 'isiXhosa', 'Afrikaans', 'Sepedi', 'Setswana',
  'Sesotho', 'siSwati', 'Tshivenda', 'Xitsonga', 'isiNdebele',
] as const;

export type Grade = typeof GRADES[number];
export type AiMode = 'off' | 'online' | 'local';
export type AiSettings = {
  mode: AiMode;
  baseUrl: string;
  model: string;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  mode: 'off',
  baseUrl: 'http://localhost:1234/v1',
  model: '',
};

export type PracticeQuestion = {
  id: string;
  prompt: string;
  kind: 'choice' | 'short';
  options: string[];
  answer: string;
  explanation: string;
};

export type PracticeSet = {
  id: string;
  title: string;
  subject: string;
  grade: Grade;
  questions: PracticeQuestion[];
};

export type HomeworkSourceType = 'txt' | 'pdf' | 'docx' | 'pasted';

export type HomeworkUnderstanding = {
  instructions: string;
  deliverables: string;
  constraints: string;
  steps: string[];
  difficultTerms: string[];
  comprehensionQuestions: string[];
  brainstormPrompts: string[];
};

export type HomeworkItem = {
  id: string;
  title: string;
  grade: Grade;
  subject: string;
  dueDate: string;
  sourceFileName: string;
  sourceType: HomeworkSourceType;
  extractedText: string;
  learnerNotes: string;
  createdAt: string;
  archived: boolean;
  understanding: HomeworkUnderstanding;
};

export type StudyTestQuestion = {
  id: string;
  prompt: string;
  kind: 'multiple-choice' | 'true-false' | 'short-answer';
  options: string[];
  answer: string;
  rubric: string;
  explanation: string;
  selfMark: boolean;
};

export type StudyTest = {
  id: string;
  title: string;
  grade: Grade;
  subject: string;
  topic: string;
  type: 'practice-test' | 'question-set';
  sourceType: 'homework' | 'note' | 'caregiver';
  sourceId: string;
  sourceTitle: string;
  questions: StudyTestQuestion[];
};

export type StudyTestReview = {
  prompt: string;
  learnerAnswer: string;
  expectedAnswer: string;
  rubric: string;
  explanation: string;
  selfMark: boolean;
};

export type StudyTestAttempt = {
  id: string;
  testId: string;
  setTitle: string;
  subject: string;
  grade: Grade;
  date: string;
  score: number;
  total: number;
  selfMarked: number;
  incorrect: StudyTestReview[];
};

export type Profile = {
  nickname: string;
  grade: Grade | '';
  language: typeof LANGUAGES[number];
  subjects: string[];
};

export type Assessment = {
  id: string;
  subject: string;
  topic: string;
  date: string;
  earned: number;
  total: number;
  note: string;
};

export type SchoolReportSubjectResult =
  | { id: string; subject: string; topic: string; format: 'mark'; earned: number; total: number }
  | { id: string; subject: string; topic: string; format: 'percentage'; value: number }
  | { id: string; subject: string; topic: string; format: 'achievement'; achievement: string };

export type SchoolReport = {
  id: string;
  schoolYear: number;
  term: 1 | 2 | 3 | 4;
  periodLabel: string;
  grade: Grade;
  reportDate: string;
  notes: string;
  subjects: SchoolReportSubjectResult[];
};

export type Resource = {
  id: string;
  title: string;
  subject: string;
  grade: Grade;
  topic: string;
  source: string;
  text: string;
};

export const VIDEO_REVIEW_STATUSES = ['Needs review', 'Reviewed'] as const;
export type VideoReviewStatus = typeof VIDEO_REVIEW_STATUSES[number];

export type VideoResource = {
  id: string;
  title: string;
  url: string;
  source: string;
  grade: Grade;
  subject: string;
  topic: string;
  language: string;
  note: string;
  reviewStatus: VideoReviewStatus;
};

export type PracticeReview = {
  prompt: string;
  learnerAnswer: string;
  correctAnswer: string;
  explanation: string;
};

export type PracticeAttempt = {
  id: string;
  setTitle: string;
  subject: string;
  grade: Grade;
  date: string;
  score: number;
  total: number;
  incorrect: PracticeReview[];
};

export type StudyData = {
  profile: Profile;
  assessments: Assessment[];
  schoolReports: SchoolReport[];
  practiceSuggestionThreshold: number | null;
  dismissedReportSuggestions: string[];
  resources: Resource[];
  practiceSets: PracticeSet[];
  practiceHistory: PracticeAttempt[];
  homework: HomeworkItem[];
  studyTests: StudyTest[];
  studyTestHistory: StudyTestAttempt[];
};

export type BackupFile = {
  format: 'Qalumo backup' | 'StudyStep SA backup';
  version: 1;
  exportedAt: string;
  data: StudyData;
  videoResources?: VideoResource[];
};

export type VideoLibraryFile = {
  format: 'Qalumo video library';
  version: 1;
  exportedAt: string;
  videos: VideoResource[];
};

export type StudyLibraryPackage = {
  format: 'Qalumo study library';
  version: 1;
  exportedAt: string;
  homework: HomeworkItem[];
  notes: Resource[];
  tests: StudyTest[];
  practiceSets: PracticeSet[];
};
