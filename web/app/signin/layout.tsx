// Sign-in is its own top-level route tree (NOT under app/finance or app/hr — shell.test.tsx enforces
// that). It carries ONE legacy stylesheet: the login markup is byte-identical between the two apps
// (app.html:1057-1086 ≡ hros.html), so either works and Finance's is the natural pick — it is where a
// mixed-role login lands by default. Same scoping rule as the two app layouts (sync-legacy-css.mjs):
// exactly one legacy stylesheet reaches any page, so the 38 divergent selectors never meet.
import '../finance/legacy.css';

import type { ReactNode } from 'react';

export default function SignInLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
