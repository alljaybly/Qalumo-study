import type { AiSettings, StudyData, VideoResource } from '../types';
import { DEFAULT_AI_SETTINGS } from '../types';

const DATABASE_NAME = 'studystep-sa';
const DATABASE_VERSION = 1;
const STORE_NAME = 'local-data';
const DATA_KEY = 'study-data';
const AI_SETTINGS_KEY = 'ai-settings';
const VIDEO_LIBRARY_KEY = 'video-library';

export function emptyStudyData(): StudyData {
  return {
    profile: { nickname: '', grade: '', language: 'English', subjects: [] },
    assessments: [],
    schoolReports: [],
    practiceSuggestionThreshold: null,
    dismissedReportSuggestions: [],
    resources: [],
    practiceSets: [],
    practiceHistory: [],
    homework: [],
    studyTests: [],
    studyTestHistory: [],
  };
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(new Error('This browser does not support local IndexedDB storage.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local storage.'));
    request.onblocked = () => reject(new Error('Local storage is blocked by another open Qalumo tab. Close other tabs and try again.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onerror = () => reject(request.error ?? new Error('Could not access local study data.'));
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('Saving local study data was interrupted.'));
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not access local study data.'));
  });
}

export async function loadStudyData(): Promise<StudyData> {
  const saved = await withStore('readonly', (store) => store.get(DATA_KEY)) as Partial<StudyData> | undefined;
  if (!saved) return emptyStudyData();
  const empty = emptyStudyData();
  return {
    profile: saved.profile ?? empty.profile,
    assessments: saved.assessments ?? empty.assessments,
    schoolReports: saved.schoolReports ?? empty.schoolReports,
    practiceSuggestionThreshold: saved.practiceSuggestionThreshold ?? empty.practiceSuggestionThreshold,
    dismissedReportSuggestions: saved.dismissedReportSuggestions ?? empty.dismissedReportSuggestions,
    resources: saved.resources ?? empty.resources,
    practiceSets: saved.practiceSets ?? empty.practiceSets,
    practiceHistory: saved.practiceHistory ?? empty.practiceHistory,
    homework: saved.homework ?? empty.homework,
    studyTests: saved.studyTests ?? empty.studyTests,
    studyTestHistory: saved.studyTestHistory ?? empty.studyTestHistory,
  };
}

export async function saveStudyData(data: StudyData): Promise<void> {
  await withStore('readwrite', (store) => store.put(data, DATA_KEY));
}

export async function loadVideoLibrary(): Promise<unknown> {
  const library = await withStore('readonly', (store) => store.get(VIDEO_LIBRARY_KEY));
  if (library !== undefined) return library;
  const legacyData = await withStore('readonly', (store) => store.get(DATA_KEY)) as (StudyData & { videoResources?: unknown }) | undefined;
  const legacyVideos = legacyData?.videoResources;
  if (Array.isArray(legacyVideos)) {
    await withStore('readwrite', (store) => store.put(legacyVideos, VIDEO_LIBRARY_KEY));
    return legacyVideos;
  }
  return [];
}

export async function saveVideoLibrary(videos: VideoResource[]): Promise<void> {
  await withStore('readwrite', (store) => store.put(videos, VIDEO_LIBRARY_KEY));
}

export async function saveFullBackup(data: StudyData, videos: VideoResource[]): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(data, DATA_KEY);
    store.put(videos, VIDEO_LIBRARY_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Restoring the backup was interrupted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('The full backup could not be saved.'));
  }).finally(() => database.close());
}

export async function loadAiSettings(): Promise<AiSettings> {
  const saved = await withStore('readonly', (store) => store.get(AI_SETTINGS_KEY)) as AiSettings | undefined;
  return saved ?? DEFAULT_AI_SETTINGS;
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  await withStore('readwrite', (store) => store.put(settings, AI_SETTINGS_KEY));
}

export async function deleteAllLocalData(): Promise<void> {
  await withStore('readwrite', (store) => store.clear());
}
