import type { PracticeSet } from '../types';

export const samplePracticeSets: PracticeSet[] = [
  {
    id: 'sample-fractions',
    title: 'Sample: Fractions and percentages',
    subject: 'Mathematics',
    grade: 'Grade 8',
    questions: [
      {
        id: 'sample-fractions-1',
        prompt: 'What is 25% of 80?',
        kind: 'choice',
        options: ['10', '20', '25', '40'],
        answer: '20',
        explanation: '25% is one quarter. One quarter of 80 is 20.',
      },
      {
        id: 'sample-fractions-2',
        prompt: 'Write 3/4 as a percentage.',
        kind: 'short',
        options: [],
        answer: '75%',
        explanation: '3 divided by 4 is 0.75, which is 75%.',
      },
      {
        id: 'sample-fractions-3',
        prompt: 'A learner reads 12 pages each day for 5 days. How many pages is that?',
        kind: 'short',
        options: [],
        answer: '60',
        explanation: '12 pages × 5 days = 60 pages.',
      },
    ],
  },
];
