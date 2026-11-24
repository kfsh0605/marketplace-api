import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
    {
        ignores: ['dist/**', 'node_modules/**', 'infra/**', 'fixtures/**', '.tools/**', 'backups/**', 'coverage/**'],
    },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        rules: {
            'no-console': 'off',
            // any стоїть лише на межах (JSON з мережі, події брокера, сторонні типи); tsc тут не strict.
            '@typescript-eslint/no-explicit-any': 'off',
            // Параметр з префіксом _ і змінна в catch навмисно не використовуються.
            '@typescript-eslint/no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' }],
            // Порожній catch тут означає «помилку свідомо проковтнуто» (best-effort ack/reject).
            'no-empty': ['error', { allowEmptyCatch: true }],
            // Вимагає new Error(msg, { cause }), а цільовий ES2021 в tsconfig цього не знає.
            'preserve-caught-error': 'off',
        },
    },
    {
        // Тести підключають .cjs-бібліотеки скриптів через require.
        files: ['test/**/*.ts'],
        rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
);
