// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // stdout is the MCP stdio transport: any console.log corrupts the protocol stream
      'no-console': ['error', { allow: ['error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // `.catch(() => log.warn(...))` is idiomatic here; braces would only add noise
      '@typescript-eslint/no-confusing-void-expression': 'off',
      // type aliases are required where a body must satisfy the SDK's indexed Record types
      '@typescript-eslint/consistent-type-definitions': 'off',
      // `a || b` on strings is the intended "empty string falls through" in DOM text extraction
      '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true } }],
    },
  },
  { files: ['eslint.config.js', 'vitest.config.ts'], extends: [tseslint.configs.disableTypeChecked] },
);
