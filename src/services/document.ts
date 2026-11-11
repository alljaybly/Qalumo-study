import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { HomeworkSourceType } from '../types';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 500_000;

export async function extractHomeworkText(
  file: File,
  onProgress: (message: string) => void,
): Promise<{ sourceType: HomeworkSourceType; text: string }> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('This file is larger than 20 MB. Choose a smaller file or paste the relevant text instead.');
  }
  const extension = file.name.split('.').pop()?.toLocaleLowerCase();
  if (extension !== 'txt' && extension !== 'pdf' && extension !== 'docx') {
    throw new Error('Choose a TXT, text-based PDF, or DOCX file. Other document formats are not supported.');
  }

  onProgress('Reading this file locally in your browser…');
  try {
    let text: string;
    if (extension === 'txt') {
      text = await file.text();
    } else if (extension === 'docx') {
      const { default: mammoth } = await import('mammoth');
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      text = result.value;
    } else {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
      loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
        if (total > 0) onProgress(`Reading PDF locally (${Math.min(100, Math.round((loaded / total) * 100))}%)…`);
      };
      const document = await loadingTask.promise;
      try {
        const pages: string[] = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          onProgress(`Extracting PDF text from page ${pageNumber} of ${document.numPages}…`);
          const page = await document.getPage(pageNumber);
          const content = await page.getTextContent();
          const pageText = content.items.map((item) => {
            if (!('str' in item)) return '';
            return `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}`;
          }).join('');
          pages.push(pageText);
          if (pages.reduce((total, entry) => total + entry.length, 0) > MAX_EXTRACTED_CHARACTERS) break;
        }
        text = pages.join('\n');
      } finally {
        await document.destroy();
      }
    }

    return { sourceType: extension, text: text.slice(0, MAX_EXTRACTED_CHARACTERS).trim() };
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('This file is larger')) throw cause;
    throw new Error('Qalumo could not extract text from this file. It may be damaged, password-protected, image-only, or an unsupported document. You can paste or type the text instead.');
  }
}

export const MAX_HOMEWORK_FILE_BYTES = MAX_FILE_BYTES;
