import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// Architecture is enforced here, not by convention. Layers may import downward only.
const LAYERS = ['foundation', 'domain', 'sim', 'agents', 'presentation', 'apps']

/** Import paths a file in `layer` must not reach for. */
function forbiddenLayers(layer) {
  const above = LAYERS.slice(LAYERS.indexOf(layer) + 1)
  return above.flatMap((l) => [`@/${l}/**`, `@/${l}`, `**/${l}/**`])
}

const layerBoundaries = LAYERS.slice(0, -1).map((layer) => ({
  files: [`src/${layer}/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: forbiddenLayers(layer),
            message: `src/${layer} may not import from a higher layer. Dependencies point downward only.`,
          },
        ],
      },
    ],
  },
}))

// The simulation must stay pure: no ambient clock, no ambient randomness, no browser.
const purity = {
  files: ['src/foundation/**/*.ts', 'src/domain/**/*.ts', 'src/sim/**/*.ts', 'src/agents/**/*.ts'],
  ignores: ['**/*.test.ts'],
  rules: {
    'no-restricted-globals': [
      'error',
      ...['window', 'document', 'navigator', 'localStorage', 'performance', 'requestAnimationFrame'].map(
        (name) => ({ name, message: 'The simulation layers must not touch the browser.' }),
      ),
    ],
    'no-restricted-properties': [
      'error',
      {
        object: 'Math',
        property: 'random',
        message: 'Use a seeded generator from @/foundation/rng so runs stay reproducible.',
      },
      {
        object: 'Date',
        property: 'now',
        message: 'Time enters the simulation as a delta, never from an ambient clock.',
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: 'NewExpression[callee.name="Date"]',
        message: 'Time enters the simulation as a delta, never from an ambient clock.',
      },
    ],
  },
}

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      /*
       * A module-level `let` read by a function that runs during evaluation throws on a
       * dead zone the compiler cannot see: the reference is inside a function, so it is
       * not textually before the declaration as far as the types are concerned. It left
       * the game a blank screen once.
       */
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': [
        'error',
        { functions: false, classes: false, variables: true, typedefs: false, enums: false },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  ...layerBoundaries,
  purity,
)
