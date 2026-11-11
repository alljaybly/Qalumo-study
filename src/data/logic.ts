import { GRADES, LANGUAGES, VIDEO_REVIEW_STATUSES } from '../types';
import type { Assessment, BackupFile, HomeworkItem, PracticeQuestion, PracticeSet, Resource, SchoolReport, SchoolReportSubjectResult, StudyData, StudyLibraryPackage, StudyTest, StudyTestAttempt, StudyTestQuestion, VideoLibraryFile, VideoResource } from '../types';

export function percentage(earned: number, total: number): number {
  return Math.round((earned / total) * 100);
}

export function answerMatches(answer: string, expected: string): boolean {
  const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  const learner = normalize(answer);
  const correct = normalize(expected);
  const learnerNumber = Number(learner.replace(',', '.').replace(/%$/, ''));
  const correctNumber = Number(correct.replace(',', '.').replace(/%$/, ''));
  if (learner !== '' && correct !== '' && Number.isFinite(learnerNumber) && Number.isFinite(correctNumber)) {
    return learnerNumber === correctNumber;
  }
  return learner === correct;
}

export function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown, allowEmpty = true): value is string {
  return typeof value === 'string' && (allowEmpty || value.trim().length > 0);
}

function isGrade(value: unknown): value is typeof GRADES[number] {
  return typeof value === 'string' && (GRADES as readonly string[]).includes(value);
}

function isQuestion(value: unknown): value is PracticeQuestion {
  if (!isObject(value)) return false;
  const answer = value.answer;
  if (!isText(value.id, false)
    || !isText(value.prompt, false)
    || (value.kind !== 'choice' && value.kind !== 'short')
    || !Array.isArray(value.options)
    || !value.options.every((option) => isText(option, false))
    || !isText(answer, false)
    || !isText(value.explanation)) return false;
  if (value.kind === 'choice') {
    return value.options.length >= 2 && value.options.some((option) => answerMatches(option, answer));
  }
  return value.options.length === 0;
}

function isPracticeSet(value: unknown): value is PracticeSet {
  if (!isObject(value)) return false;
  return isText(value.id, false)
    && isText(value.title, false)
    && isText(value.subject, false)
    && isGrade(value.grade)
    && Array.isArray(value.questions)
    && value.questions.length > 0
    && value.questions.every(isQuestion);
}

function isHomeworkUnderstanding(value: unknown): boolean {
  return isObject(value)
    && isText(value.instructions)
    && isText(value.deliverables)
    && isText(value.constraints)
    && Array.isArray(value.steps)
    && value.steps.every((item) => isText(item, false))
    && Array.isArray(value.difficultTerms)
    && value.difficultTerms.every((item) => isText(item, false))
    && Array.isArray(value.comprehensionQuestions)
    && value.comprehensionQuestions.every((item) => isText(item, false))
    && Array.isArray(value.brainstormPrompts)
    && value.brainstormPrompts.every((item) => isText(item, false));
}

function isHomeworkItem(value: unknown): value is HomeworkItem {
  if (!isObject(value)) return false;
  return isText(value.id, false)
    && isText(value.title, false)
    && isGrade(value.grade)
    && isText(value.subject, false)
    && (value.dueDate === '' || isValidDate(value.dueDate))
    && isText(value.sourceFileName)
    && (value.sourceType === 'txt' || value.sourceType === 'pdf' || value.sourceType === 'docx' || value.sourceType === 'pasted')
    && isText(value.extractedText)
    && value.extractedText.length <= 500_000
    && isText(value.learnerNotes)
    && isText(value.createdAt, false)
    && typeof value.archived === 'boolean'
    && isHomeworkUnderstanding(value.understanding);
}

function isStudyTestQuestion(value: unknown): value is StudyTestQuestion {
  const answer = isObject(value) ? value.answer : undefined;
  if (!isObject(value)
    || !isText(value.id, false)
    || !isText(value.prompt, false)
    || !Array.isArray(value.options)
    || !value.options.every((option) => isText(option, false))
    || !isText(answer)
    || !isText(value.rubric)
    || !isText(value.explanation)
    || typeof value.selfMark !== 'boolean') return false;
  if (value.kind === 'multiple-choice') {
    return value.options.length >= 2 && !value.selfMark && isText(value.answer, false)
      && value.options.some((option) => answerMatches(option, answer));
  }
  if (value.kind === 'true-false') {
    return value.options.length === 0 && !value.selfMark
      && (value.answer === 'True' || value.answer === 'False');
  }
  if (value.kind === 'short-answer') {
    return value.options.length === 0
      && (value.selfMark ? isText(value.rubric, false) : isText(value.answer, false));
  }
  return false;
}

function isStudyTest(value: unknown): value is StudyTest {
  if (!isObject(value)) return false;
  return isText(value.id, false)
    && isText(value.title, false)
    && isGrade(value.grade)
    && isText(value.subject, false)
    && isText(value.topic)
    && (value.type === 'practice-test' || value.type === 'question-set')
    && (value.sourceType === 'homework' || value.sourceType === 'note' || value.sourceType === 'caregiver')
    && isText(value.sourceId)
    && isText(value.sourceTitle)
    && Array.isArray(value.questions)
    && value.questions.length > 0
    && value.questions.every(isStudyTestQuestion);
}

function isStudyTestAttempt(value: unknown): value is StudyTestAttempt {
  return isObject(value)
    && isText(value.id, false)
    && isText(value.testId, false)
    && isText(value.setTitle, false)
    && isText(value.subject, false)
    && isGrade(value.grade)
    && isValidDate(value.date)
    && Number.isInteger(value.score)
    && Number(value.score) >= 0
    && Number.isInteger(value.total)
    && Number(value.total) >= Number(value.score)
    && Number.isInteger(value.selfMarked)
    && Number(value.selfMarked) >= 0
    && Array.isArray(value.incorrect)
    && value.incorrect.every((item) => isObject(item)
      && isText(item.prompt, false)
      && isText(item.learnerAnswer)
      && isText(item.expectedAnswer)
      && isText(item.rubric)
      && isText(item.explanation)
      && typeof item.selfMark === 'boolean');
}

function isAssessment(value: unknown): value is Assessment {
  if (!isObject(value)) return false;
  return isText(value.id, false)
    && isText(value.subject, false)
    && isText(value.topic)
    && isValidDate(value.date)
    && Number.isFinite(value.earned)
    && Number.isFinite(value.total)
    && Number(value.total) > 0
    && Number(value.earned) >= 0
    && Number(value.earned) <= Number(value.total)
    && isText(value.note);
}

function isReportSubjectResult(value: unknown): value is SchoolReportSubjectResult {
  if (!isObject(value) || !isText(value.id, false) || !isText(value.subject, false) || !isText(value.topic)) return false;
  if (value.format === 'mark') {
    return typeof value.earned === 'number'
      && Number.isFinite(value.earned)
      && typeof value.total === 'number'
      && Number.isFinite(value.total)
      && value.total > 0
      && value.earned >= 0
      && value.earned <= value.total;
  }
  if (value.format === 'percentage') {
    return typeof value.value === 'number' && Number.isFinite(value.value) && value.value >= 0 && value.value <= 100;
  }
  return value.format === 'achievement' && isText(value.achievement, false);
}

function isSchoolReport(value: unknown): value is SchoolReport {
  return isObject(value)
    && isText(value.id, false)
    && Number.isInteger(value.schoolYear)
    && Number(value.schoolYear) >= 1900
    && Number(value.schoolYear) <= 9999
    && Number.isInteger(value.term)
    && Number(value.term) >= 1
    && Number(value.term) <= 4
    && isText(value.periodLabel)
    && isGrade(value.grade)
    && (value.reportDate === '' || isValidDate(value.reportDate))
    && isText(value.notes)
    && Array.isArray(value.subjects)
    && value.subjects.length > 0
    && value.subjects.every(isReportSubjectResult);
}

function isResource(value: unknown): value is Resource {
  if (!isObject(value)) return false;
  return isText(value.id, false)
    && isText(value.title, false)
    && isText(value.subject, false)
    && isGrade(value.grade)
    && isText(value.topic)
    && isText(value.source)
    && isText(value.text, false);
}

export function isVideoResource(value: unknown): value is VideoResource {
  if (!isObject(value)
    || !isText(value.id, false)
    || !isText(value.title, false)
    || !isValidHttpUrl(value.url)
    || !isText(value.source, false)
    || !isGrade(value.grade)
    || !isText(value.subject, false)
    || !isText(value.topic, false)
    || !isText(value.language, false)
    || !isText(value.note, false)
    || typeof value.reviewStatus !== 'string'
    || !(VIDEO_REVIEW_STATUSES as readonly string[]).includes(value.reviewStatus)) return false;
  return true;
}

function isValidHttpUrl(value: unknown): value is string {
  if (!isText(value, false)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function normalizeVideoUrl(value: string): string {
  const url = new URL(value.trim());
  url.hash = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  url.searchParams.sort();
  return url.toString();
}

export function planVideoLibraryImport(
  incoming: VideoResource[],
  existing: VideoResource[],
): { additions: VideoResource[]; skipped: number } {
  const knownUrls = new Set(existing.map((video) => normalizeVideoUrl(video.url)));
  const knownIds = new Set(existing.map((video) => video.id));
  const additions: VideoResource[] = [];
  let skipped = 0;
  for (const video of incoming) {
    const url = normalizeVideoUrl(video.url);
    if (knownUrls.has(url)) {
      skipped += 1;
    } else {
      knownUrls.add(url);
      const addition = knownIds.has(video.id) ? { ...video, id: createId() } : video;
      knownIds.add(addition.id);
      additions.push(addition);
    }
  }
  return { additions, skipped };
}

export function validateVideoLibrary(input: unknown): {
  file?: VideoLibraryFile;
  invalidCount: number;
  error?: string;
} {
  if (!isObject(input) || input.format !== 'Qalumo video library' || input.version !== 1 || !Array.isArray(input.videos)) {
    return { invalidCount: 0, error: 'This is not a supported Qalumo video library file (version 1).' };
  }
  const videos: VideoResource[] = [];
  let invalidCount = 0;
  input.videos.forEach((video) => {
    if (isVideoResource(video)) videos.push(video);
    else invalidCount += 1;
  });
  if (!isText(input.exportedAt, false)) {
    return { invalidCount: 0, error: 'This video library file is missing its export date.' };
  }
  return {
    file: { format: 'Qalumo video library', version: 1, exportedAt: input.exportedAt, videos },
    invalidCount,
  };
}

function isValidDate(value: unknown): value is string {
  if (!isText(value, false) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function validateBackup(input: unknown): { backup?: BackupFile; error?: string } {
  if (!isObject(input) || (input.format !== 'Qalumo backup' && input.format !== 'StudyStep SA backup') || input.version !== 1 || !isObject(input.data)) {
    return { error: 'This file is not a supported Qalumo backup (version 1).' };
  }
  const data = input.data;
  const profile = data.profile;
  if (!isObject(profile)
    || !isText(profile.nickname)
    || !(profile.grade === '' || isGrade(profile.grade))
    || typeof profile.language !== 'string'
    || !(LANGUAGES as readonly string[]).includes(profile.language)
    || !Array.isArray(profile.subjects)
    || !profile.subjects.every((subject) => isText(subject, false))) {
    return { error: 'The learner profile in this backup is incomplete or invalid.' };
  }
  if (!Array.isArray(data.assessments) || !data.assessments.every(isAssessment)) {
    return { error: 'One or more assessment records in this backup are invalid.' };
  }
  const schoolReports = data.schoolReports ?? [];
  if (!Array.isArray(schoolReports) || !schoolReports.every(isSchoolReport)) {
    return { error: 'One or more school report records in this backup are invalid.' };
  }
  const practiceSuggestionThreshold = data.practiceSuggestionThreshold ?? null;
  if (practiceSuggestionThreshold !== null
    && (typeof practiceSuggestionThreshold !== 'number' || !Number.isFinite(practiceSuggestionThreshold) || practiceSuggestionThreshold < 0 || practiceSuggestionThreshold > 100)) {
    return { error: 'The school-report practice suggestion threshold in this backup is invalid.' };
  }
  const dismissedReportSuggestions = data.dismissedReportSuggestions ?? [];
  if (!Array.isArray(dismissedReportSuggestions) || !dismissedReportSuggestions.every((id) => isText(id, false))) {
    return { error: 'The dismissed school-report suggestion records in this backup are invalid.' };
  }
  if (!Array.isArray(data.resources) || !data.resources.every(isResource)) {
    return { error: 'One or more saved resources in this backup are invalid.' };
  }
  const nestedVideos = data.videoResources;
  const topLevelVideos = input.videoResources;
  if (nestedVideos !== undefined && topLevelVideos !== undefined) {
    return { error: 'This backup contains video records in two places and cannot be safely restored.' };
  }
  const videoResources = topLevelVideos ?? nestedVideos ?? [];
  if (!Array.isArray(videoResources) || !videoResources.every(isVideoResource)) {
    return { error: 'One or more saved video resources in this backup are invalid. Video URLs must use HTTP or HTTPS.' };
  }
  if (!Array.isArray(data.practiceSets) || !data.practiceSets.every(isPracticeSet)) {
    return { error: 'One or more practice sets in this backup are invalid.' };
  }
  if (!Array.isArray(data.practiceHistory)) {
    return { error: 'The practice history in this backup is invalid.' };
  }
  const homework = data.homework ?? [];
  if (!Array.isArray(homework) || !homework.every(isHomeworkItem)) {
    return { error: 'One or more homework records in this backup are invalid.' };
  }
  const studyTests = data.studyTests ?? [];
  if (!Array.isArray(studyTests) || !studyTests.every(isStudyTest)) {
    return { error: 'One or more study-library tests in this backup are invalid.' };
  }
  const studyTestHistory = data.studyTestHistory ?? [];
  if (!Array.isArray(studyTestHistory) || !studyTestHistory.every(isStudyTestAttempt)) {
    return { error: 'One or more study-library practice records in this backup are invalid.' };
  }
  for (const attempt of data.practiceHistory) {
    if (!isObject(attempt)
      || !isText(attempt.id, false)
      || !isText(attempt.setTitle, false)
      || !isText(attempt.subject, false)
      || !isGrade(attempt.grade)
      || !isValidDate(attempt.date)
      || !Number.isInteger(attempt.score)
      || !Number.isInteger(attempt.total)
      || Number(attempt.total) < 1
      || Number(attempt.score) < 0
      || Number(attempt.score) > Number(attempt.total)
      || !Array.isArray(attempt.incorrect)
      || !attempt.incorrect.every((item) => isObject(item)
        && isText(item.prompt, false)
        && isText(item.learnerAnswer)
        && isText(item.correctAnswer, false)
        && isText(item.explanation))) {
      return { error: 'One or more practice history records in this backup are invalid.' };
    }
  }
  if (!isText(input.exportedAt, false)) {
    return { error: 'The backup is missing its export date.' };
  }
  const learnerData = {
    profile: data.profile,
    assessments: data.assessments,
    schoolReports,
    practiceSuggestionThreshold,
    dismissedReportSuggestions,
    resources: data.resources,
    practiceSets: data.practiceSets,
    practiceHistory: data.practiceHistory,
    homework,
    studyTests,
    studyTestHistory,
  };
  return {
    backup: {
      format: input.format,
      version: 1,
      exportedAt: input.exportedAt,
      data: learnerData as unknown as StudyData,
      videoResources,
    },
  };
}

export function validateStudyLibraryPackage(input: unknown): { file?: StudyLibraryPackage; error?: string } {
  const supportedFields = ['format', 'version', 'exportedAt', 'homework', 'notes', 'tests', 'practiceSets'];
  if (!isObject(input)
    || Object.keys(input).some((key) => !supportedFields.includes(key))
    || input.format !== 'Qalumo study library'
    || input.version !== 1) {
    return { error: 'This is not a supported Qalumo study library package (version 1), or it contains unrelated private fields.' };
  }
  if (!isText(input.exportedAt, false)
    || !Array.isArray(input.homework)
    || !input.homework.every(isStudyPackageHomework)
    || !Array.isArray(input.notes)
    || !input.notes.every(isStudyPackageNote)
    || !Array.isArray(input.tests)
    || !input.tests.every(isStudyPackageTest)
    || !Array.isArray(input.practiceSets)
    || !input.practiceSets.every(isStudyPackagePracticeSet)) {
    return { error: 'The study library package has missing or invalid homework, note, or test records. Nothing was imported.' };
  }
  return {
    file: {
      format: 'Qalumo study library',
      version: 1,
      exportedAt: input.exportedAt,
      homework: input.homework,
      notes: input.notes,
      tests: input.tests,
      practiceSets: input.practiceSets,
    },
  };
}

function hasOnlyKeys(value: Record<string, unknown>, fields: string[]): boolean {
  return Object.keys(value).every((key) => fields.includes(key));
}

function isStudyPackageHomework(value: unknown): value is HomeworkItem {
  return isObject(value)
    && hasOnlyKeys(value, ['id', 'title', 'grade', 'subject', 'dueDate', 'sourceFileName', 'sourceType', 'extractedText', 'learnerNotes', 'createdAt', 'archived', 'understanding'])
    && isObject(value.understanding)
    && hasOnlyKeys(value.understanding, ['instructions', 'deliverables', 'constraints', 'steps', 'difficultTerms', 'comprehensionQuestions', 'brainstormPrompts'])
    && isHomeworkItem(value);
}

function isStudyPackageNote(value: unknown): value is Resource {
  return isObject(value)
    && hasOnlyKeys(value, ['id', 'title', 'subject', 'grade', 'topic', 'source', 'text'])
    && isResource(value);
}

function isStudyPackageTest(value: unknown): value is StudyTest {
  return isObject(value)
    && hasOnlyKeys(value, ['id', 'title', 'grade', 'subject', 'topic', 'type', 'sourceType', 'sourceId', 'sourceTitle', 'questions'])
    && Array.isArray(value.questions)
    && value.questions.every((question) => isObject(question)
      && hasOnlyKeys(question, ['id', 'prompt', 'kind', 'options', 'answer', 'rubric', 'explanation', 'selfMark']))
    && isStudyTest(value);
}

function isStudyPackagePracticeSet(value: unknown): value is PracticeSet {
  return isObject(value)
    && hasOnlyKeys(value, ['id', 'title', 'subject', 'grade', 'questions'])
    && Array.isArray(value.questions)
    && value.questions.every((question) => isObject(question)
      && hasOnlyKeys(question, ['id', 'prompt', 'kind', 'options', 'answer', 'explanation']))
    && isPracticeSet(value);
}

function normalizedText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function resourceDuplicateKey(resource: Resource): string {
  return JSON.stringify([resource.grade, normalizedText(resource.subject), normalizedText(resource.topic), normalizedText(resource.title), normalizedText(resource.text)]);
}

function homeworkDuplicateKey(item: HomeworkItem): string {
  return JSON.stringify([item.grade, normalizedText(item.subject), normalizedText(item.title), normalizedText(item.extractedText), normalizedText(item.learnerNotes)]);
}

function testDuplicateKey(test: StudyTest): string {
  return JSON.stringify([test.grade, normalizedText(test.subject), normalizedText(test.topic), normalizedText(test.title), test.questions.map((question) => [
    normalizedText(question.prompt), question.kind, question.options.map(normalizedText), normalizedText(question.answer),
    normalizedText(question.rubric), question.selfMark,
  ])]);
}

function practiceSetDuplicateKey(set: PracticeSet): string {
  return JSON.stringify([set.grade, normalizedText(set.subject), normalizedText(set.title), set.questions.map((question) => [
    normalizedText(question.prompt), question.kind, question.options.map(normalizedText), normalizedText(question.answer),
  ])]);
}

export function planStudyLibraryImport(
  file: StudyLibraryPackage,
  current: StudyData,
  duplicatePolicy: 'skip' | 'keep-both',
): {
  homework: HomeworkItem[];
  notes: Resource[];
  tests: StudyTest[];
  practiceSets: PracticeSet[];
  skippedDuplicates: number;
} {
  let skippedDuplicates = 0;
  const idMap = new Map<string, string>();
  const selectRecords = <T extends { id: string }>(
    imported: T[],
    existing: T[],
    keyFor: (record: T) => string,
  ): T[] => {
    const existingByKey = new Map(existing.map((record) => [keyFor(record), record.id]));
    const importedByKey = new Map<string, string>();
    const known = new Set(existingByKey.keys());
    const selected: T[] = [];
    for (const record of imported) {
      const key = keyFor(record);
      if (known.has(key) && duplicatePolicy === 'skip') {
        idMap.set(record.id, existingByKey.get(key) ?? importedByKey.get(key) ?? '');
        skippedDuplicates += 1;
        continue;
      }
      known.add(key);
      const id = createId();
      idMap.set(record.id, id);
      importedByKey.set(key, id);
      selected.push({ ...record, id });
    }
    return selected;
  };

  const homework = selectRecords(file.homework, current.homework, homeworkDuplicateKey);
  const notes = selectRecords(file.notes, current.resources, resourceDuplicateKey);
  const tests = selectRecords(file.tests, current.studyTests, testDuplicateKey).map((test) => ({
    ...test,
    sourceId: idMap.get(test.sourceId) ?? '',
  }));
  const practiceSets = selectRecords(file.practiceSets, current.practiceSets, practiceSetDuplicateKey);
  return { homework, notes, tests, practiceSets, skippedDuplicates };
}
