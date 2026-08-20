import { describe, expect, it } from "vitest";
import {
  detectEcosystemFromManifest,
  detectEcosystemFromSource,
  getSpecializedEcosystemRules,
} from "../src/indexer/ecosystem";

describe("ecosystem and framework detector", () => {
  it("detects Angular, RxJS, and NgRx from package.json", () => {
    const manifest = JSON.stringify({
      dependencies: {
        "@angular/core": "^19.0.0",
        "@angular/common": "^19.0.0",
        rxjs: "^7.8.0",
        "@ngrx/signals": "^19.0.0",
      },
    });

    const result = detectEcosystemFromManifest("apps/portal/package.json", manifest);
    expect(result.frameworks).toContain("angular");
    expect(result.libraries).toContain("rxjs");
    expect(result.libraries).toContain("ngrx");
  });

  it("detects Next.js, React, Tailwind, and Zod from package.json", () => {
    const manifest = JSON.stringify({
      dependencies: {
        next: "15.0.0",
        react: "19.0.0",
        "react-dom": "19.0.0",
        zod: "3.24.0",
        tailwindcss: "^4.0.0",
      },
    });

    const result = detectEcosystemFromManifest("apps/web/package.json", manifest);
    expect(result.frameworks).toContain("nextjs");
    expect(result.libraries).toContain("zod");
    expect(result.libraries).toContain("tailwind");
  });

  it("detects RxJS from source code containing reactive operators and observables", () => {
    const source = `
      import { Observable, Subject } from 'rxjs';
      import { switchMap, map, takeUntilDestroyed } from 'rxjs/operators';
      
      export class SearchService {
        private term$ = new Subject<string>();
      }
    `;

    const result = detectEcosystemFromSource("src/search.ts", source);
    expect(result.libraries).toContain("rxjs");
  });

  it("produces specialized heuristics for RxJS memory leaks and nested subscribes", () => {
    const rules = getSpecializedEcosystemRules(["angular"], ["rxjs"]);
    expect(rules.some((r) => r.includes("Subscription Leaks") || r.includes("takeUntilDestroyed"))).toBe(true);
    expect(rules.some((r) => r.includes("Nested Subscriptions"))).toBe(true);
    expect(rules.some((r) => r.includes("Standalone Components"))).toBe(true);
  });
});
