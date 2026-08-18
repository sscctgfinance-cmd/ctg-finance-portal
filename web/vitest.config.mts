import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Vitest rather than `deno test`: the parity test needs React, and React is Node tooling. Keeping it out
// of tests/ leaves the Deno suite at exactly its 138 cases with `--allow-read` and nothing else — the
// suite whose passing is the definition of "I broke nothing".
export default defineConfig({
  plugins: [react()],
  test: { environment: 'node', include: ['tests/**/*.test.tsx'] },
});
