import js from '@eslint/js';
import globals from 'globals';
import pluginImport from 'eslint-plugin-import';
import pluginNode from 'eslint-plugin-n';
import pluginPromise from 'eslint-plugin-promise';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  { ignores: ['node_modules/', 'dist/', '.voice-training/'] },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.node,
      },
    },
    name: 'TypeScript files',
    plugins: {
      '@typescript-eslint': tseslint,
      import: pluginImport,
      n: pluginNode,
      promise: pluginPromise,
    },
    rules: {
      ...js.recommends,
      ...tseslint.configs['recommended'].rules,
      
      // TypeScript-specific rules
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-member-accessibility': ['off', { accessibility: 'no-public' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      
      // Import rules - disabled for now (TypeScript paths need proper resolution)
      'import/no-unresolved': 'off',
      'import/extensions': 'off',
      'import/no-extraneous-dependencies': 'off',
      
      // Node.js rules
      'n/no-extraneous-import': 'off',
      'n/no-missing-require': 'off',
      'n/no-unsupported-features/node-builtins': 'off',
      
      // Promise rules
      'promise/always-return': 'error',
      'promise/catch-or-return': 'error',
      'promise/no-nesting': 'warn',
      'promise/no-return-in-finally': 'error',
      'promise/valid-params': 'error',
      
      // General best practices
      'eqeqeq': ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'prefer-const': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'no-var': 'error',
      'prefer-arrow-callback': 'error',
    },
  },
];