import tseslint from 'typescript-eslint'
import eslint from '@eslint/js'
import prettierRecommended from 'eslint-plugin-prettier/recommended'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierRecommended,
)
