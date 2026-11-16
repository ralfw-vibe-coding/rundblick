import { defineConfig } from 'vitest/config';

// Testabdeckung: Body, Domain und Provider je mindestens 90 % (Anweisungen, Zweige, Funktionen, Zeilen).
// Ausgenommen: reine Interface-Dateien (nur Typen), Testdaten. Client und Composition Root werden
// per Sichtprüfung in der laufenden App getestet (RB_SCREENSHOT/RB_JS), nicht per Unit-Test.
const SCHWELLE = { statements: 90, branches: 90, functions: 90, lines: 90 };

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/body/**', 'src/domain/**', 'src/providers/**'],
      exclude: ['**/*.test.ts', '**/interface.ts', '**/testdaten/**'],
      reporter: ['text', 'html'],
      thresholds: {
        'src/body/**': SCHWELLE,
        'src/domain/**': SCHWELLE,
        'src/providers/**': SCHWELLE,
      },
    },
  },
});
