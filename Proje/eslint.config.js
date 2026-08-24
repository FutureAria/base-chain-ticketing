import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { window:'readonly', document:'readonly', console:'readonly', localStorage:'readonly',
        sessionStorage:'readonly', fetch:'readonly', navigator:'readonly', location:'readonly',
        setTimeout:'readonly', clearTimeout:'readonly', setInterval:'readonly', clearInterval:'readonly',
        alert:'readonly', confirm:'readonly', URL:'readonly', URLSearchParams:'readonly',
        FormData:'readonly', Blob:'readonly', File:'readonly', FileReader:'readonly',
        HTMLElement:'readonly', HTMLInputElement:'readonly', HTMLDivElement:'readonly',
        Image:'readonly', requestAnimationFrame:'readonly', cancelAnimationFrame:'readonly',
        MediaStream:'readonly', crypto:'readonly', AbortController:'readonly', Event:'readonly',
        KeyboardEvent:'readonly', MouseEvent:'readonly', ResizeObserver:'readonly', IntersectionObserver:'readonly' },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern:'^_', varsIgnorePattern:'^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  { ignores: ['dist/**','node_modules/**','app/components/figma/**','app/components/ui/**'] },
];
