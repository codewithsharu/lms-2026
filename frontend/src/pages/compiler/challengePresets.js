export const SUPPORTED_LANGUAGES = [
  { id: 'python', label: 'Python', extension: 'py', monaco: 'python' },
  { id: 'java', label: 'Java', extension: 'java', monaco: 'java' },
  { id: 'c', label: 'C', extension: 'c', monaco: 'c' },
  { id: 'cpp', label: 'C++', extension: 'cpp', monaco: 'cpp' }
];

export const DEFAULT_CODE_BY_LANGUAGE = {
  python: 'import sys\n\n# write your solution here\nprint("")\n',
  java: 'import java.util.*;\n\nclass Main {\n  public static void main(String[] args) {\n    Scanner sc = new Scanner(System.in);\n    // write your solution here\n    System.out.println();\n  }\n}\n',
  c: '#include <stdio.h>\n\nint main() {\n  // write your solution here\n  return 0;\n}\n',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n  // write your solution here\n  return 0;\n}\n'
};

const fullLanguageSet = SUPPORTED_LANGUAGES.map((entry) => entry.id);

const toPayload = ({
  title,
  challengeMarkdown,
  tags,
  questionTitle,
  questionMarkdown,
  difficultyLevel,
  score,
  ignoreCase,
  validations,
  supportedLanguages = fullLanguageSet
}) => ({
  challenge: {
    title,
    markdown: challengeMarkdown,
    tags,
    visibility: 'unlisted',
    properties: {}
  },
  problems: [
    {
      title: questionTitle,
      markdown: questionMarkdown,
      properties: {
        problemType: 'code',
        score,
        difficultyLevel,
        options: {
          code: {
            supportedLanguages,
            validations,
            problemCategory: 'programmingLanguages',
            ignoreCase
          }
        }
      }
    }
  ]
});

export const CHALLENGE_PRESETS = [
  {
    id: 'demo-sum-two-numbers',
    name: 'Demo Payload',
    description: 'Single starter payload for quick challenge creation.',
    payload: toPayload({
      title: 'Sum Two Numbers',
      challengeMarkdown: 'Given two integers in one line, print their sum.',
      tags: ['math', 'warmup'],
      questionTitle: 'Sum Two Numbers',
      questionMarkdown: 'Input: a b. Output: a + b',
      difficultyLevel: 'easy',
      score: 1,
      ignoreCase: true,
      validations: [
        { id: 1, label: 'sample-1', input: '2 3', output: '5' },
        { id: 2, label: 'sample-2', input: '10 25', output: '35' },
        { id: 3, label: 'sample-3', input: '-10 4', output: '-6' }
      ]
    })
  }
];
