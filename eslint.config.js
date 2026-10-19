'use strict';

// Shared lint baseline for the Postal Systems / Nodemailer packages: eslint:recommended
// plus the rules of the retired eslint-config-nodemailer, with formatting left to Prettier.
// Keep this file identical across repos except for the "Repo-specific" block at the end.

const js = require('@eslint/js');
const prettier = require('eslint-config-prettier');
const globals = require('globals');

module.exports = [
    {
        ignores: ['node_modules/**', 'coverage/**', 'dist/**']
    },
    js.configs.recommended,
    {
        files: ['**/*.js', '**/*.cjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...globals.node }
        },
        rules: {
            'no-await-in-loop': 'error',
            'no-div-regex': 'error',
            strict: ['error', 'global'],
            eqeqeq: 'error',
            'dot-notation': 'error',
            curly: 'error',
            'no-unused-expressions': ['error', { allowShortCircuit: true }],
            'no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
            'handle-callback-err': 'error',
            'no-new': 'error',
            'new-cap': 'error',
            'no-eval': 'error',
            'no-invalid-this': 'error',
            radix: ['error', 'always'],
            'no-use-before-define': ['error', 'nofunc'],
            'callback-return': ['error', ['callback', 'cb', 'done']],
            'no-redeclare': 'error',
            'block-scoped-var': 'error',
            'no-sequences': 'error',
            'no-throw-literal': 'error',
            'no-useless-call': 'error',
            'no-useless-concat': 'error',
            'no-void': 'error',
            yoda: 'error',
            'no-var': 'error',
            'no-bitwise': 'error',
            'no-lonely-if': 'error',
            'arrow-body-style': ['error', 'as-needed'],
            'prefer-arrow-callback': 'error',
            'object-shorthand': 'error',
            'prefer-spread': 'error',
            'no-prototype-builtins': 'off'
        }
    },
    {
        files: ['test/**'],
        languageOptions: {
            globals: { ...globals.node, ...globals.mocha }
        }
    },
    // Repo-specific: overrides go here, each with a one-line reason
    prettier
];
