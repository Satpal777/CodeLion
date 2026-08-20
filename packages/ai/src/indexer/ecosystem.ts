export interface ProjectEcosystem {
  frameworks: string[];
  libraries: string[];
  languageVersion?: string;
  specializedRules: string[];
}

export interface FileEcosystemContext {
  path: string;
  frameworks: string[];
  libraries: string[];
  rules: string[];
}

/**
 * Detects frameworks and key libraries from manifest files (package.json, pom.xml, etc.)
 */
export function detectEcosystemFromManifest(
  path: string,
  content: string,
): { frameworks: string[]; libraries: string[] } {
  const frameworks = new Set<string>();
  const libraries = new Set<string>();

  if (path.endsWith("package.json")) {
    try {
      const parsed = JSON.parse(content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const allDeps = {
        ...parsed.dependencies,
        ...parsed.devDependencies,
        ...parsed.peerDependencies,
      };

      // Frameworks
      if (allDeps["@angular/core"] || allDeps["@angular/common"]) frameworks.add("angular");
      if (allDeps["next"]) frameworks.add("nextjs");
      if (allDeps["react"] && !allDeps["next"]) frameworks.add("react");
      if (allDeps["vue"] || allDeps["nuxt"]) frameworks.add("vue");
      if (allDeps["svelte"] || allDeps["@sveltejs/kit"]) frameworks.add("svelte");
      if (allDeps["@nestjs/core"]) frameworks.add("nestjs");
      if (allDeps["express"]) frameworks.add("express");
      if (allDeps["fastify"]) frameworks.add("fastify");

      // Key Libraries & Reactive Ecosystems
      if (allDeps["rxjs"]) libraries.add("rxjs");
      if (allDeps["@ngrx/store"] || allDeps["@ngrx/signals"]) libraries.add("ngrx");
      if (allDeps["redux"] || allDeps["@reduxjs/toolkit"]) libraries.add("redux");
      if (allDeps["zustand"]) libraries.add("zustand");
      if (allDeps["@tanstack/react-query"] || allDeps["@tanstack/angular-query"]) libraries.add("tanstack-query");
      if (allDeps["drizzle-orm"]) libraries.add("drizzle");
      if (allDeps["@prisma/client"] || allDeps["prisma"]) libraries.add("prisma");
      if (allDeps["zod"]) libraries.add("zod");
      if (allDeps["tailwindcss"]) libraries.add("tailwind");
    } catch {
      // Manifest parse error fallback
    }
  }

  if (path.endsWith("requirements.txt") || path.endsWith("Pipfile") || path.endsWith("pyproject.toml")) {
    const lower = content.toLowerCase();
    if (lower.includes("django")) frameworks.add("django");
    if (lower.includes("fastapi")) frameworks.add("fastapi");
    if (lower.includes("flask")) frameworks.add("flask");
    if (lower.includes("pydantic")) libraries.add("pydantic");
    if (lower.includes("sqlalchemy")) libraries.add("sqlalchemy");
  }

  if (path.endsWith("pom.xml") || path.endsWith("build.gradle") || path.endsWith("build.gradle.kts")) {
    const lower = content.toLowerCase();
    if (lower.includes("spring-boot") || lower.includes("springframework")) frameworks.add("spring-boot");
    if (lower.includes("io.quarkus")) frameworks.add("quarkus");
    if (lower.includes("io.micronaut")) frameworks.add("micronaut");
    if (lower.includes("io.reactivex.rxjava") || lower.includes("reactor-core")) libraries.add("reactive-streams");
  }

  if (path.endsWith("go.mod")) {
    if (content.includes("github.com/gin-gonic/gin")) frameworks.add("gin");
    if (content.includes("github.com/gofiber/fiber")) frameworks.add("fiber");
    if (content.includes("github.com/labstack/echo")) frameworks.add("echo");
    if (content.includes("gorm.io/gorm")) libraries.add("gorm");
  }

  if (path.endsWith("Cargo.toml")) {
    if (content.includes("actix-web")) frameworks.add("actix");
    if (content.includes("axum")) frameworks.add("axum");
    if (content.includes("tokio")) libraries.add("tokio");
  }

  return {
    frameworks: Array.from(frameworks),
    libraries: Array.from(libraries),
  };
}

/**
 * Inspects a source file's code/imports to detect file-level frameworks and libraries.
 */
export function detectEcosystemFromSource(path: string, source: string): { frameworks: string[]; libraries: string[] } {
  const frameworks = new Set<string>();
  const libraries = new Set<string>();

  // RxJS Detection
  if (
    source.includes('from "rxjs') ||
    source.includes("from 'rxjs") ||
    source.includes("from 'rxjs/") ||
    source.includes('from "rxjs/') ||
    /\b(?:Observable|Subject|BehaviorSubject|ReplaySubject|switchMap|mergeMap|concatMap|exhaustMap|takeUntilDestroyed|combineLatest|forkJoin)\b/.test(source)
  ) {
    libraries.add("rxjs");
  }

  // Angular Detection
  if (
    source.includes("@angular/core") ||
    source.includes("@Component") ||
    source.includes("@Directive") ||
    source.includes("@Injectable") ||
    source.includes("ChangeDetectionStrategy") ||
    /\b(?:signal|computed|input|output|inject)\s*\(/.test(source)
  ) {
    frameworks.add("angular");
  }

  // Next.js & React Detection
  if (source.includes('"use client"') || source.includes("'use client'") || source.includes("next/navigation") || source.includes("next/server")) {
    frameworks.add("nextjs");
  } else if (source.includes("from 'react'") || source.includes('from "react"') || source.includes("useState") || source.includes("useEffect")) {
    frameworks.add("react");
  }

  // TanStack Query
  if (source.includes("@tanstack/react-query") || source.includes("@tanstack/angular-query") || source.includes("useQuery(") || source.includes("useMutation(")) {
    libraries.add("tanstack-query");
  }

  // Zod
  if (source.includes('from "zod"') || source.includes("from 'zod'") || source.includes("z.object(")) {
    libraries.add("zod");
  }

  return {
    frameworks: Array.from(frameworks),
    libraries: Array.from(libraries),
  };
}

/**
 * Returns specialized review heuristics based on detected frameworks and libraries.
 */
export function getSpecializedEcosystemRules(frameworks: string[], libraries: string[]): string[] {
  const rules: string[] = [];
  const activeKeys = new Set([...frameworks, ...libraries]);

  // RxJS Specialized Heuristics
  if (activeKeys.has("rxjs")) {
    rules.push(
      "RXJS RULE 1: Subscription Leaks - Ensure every `.subscribe()` in classes/components is unsubscribed (e.g. via `takeUntilDestroyed()`, `takeUntil()`, `Subscription.unsubscribe()`, or Angular `async` pipe).",
      "RXJS RULE 2: Nested Subscriptions - Never nest `.subscribe()` inside another `.subscribe()` handler. Use higher-order operators (`switchMap`, `mergeMap`, `concatMap`, `exhaustMap`).",
      "RXJS RULE 3: Operator Selection - Use `switchMap` when subsequent emissions should cancel prior in-flight requests (e.g. search, typeahead), `exhaustMap` for actions/buttons that ignore clicks while running, and `concatMap` for strictly ordered executions.",
      "RXJS RULE 4: Purity & Side Effects - Never mutate external state inside pure transformation operators like `map()` or `filter()`. Use `tap()` for side-effects.",
      "RXJS RULE 5: Subject Exposure - Never expose raw `Subject` or `BehaviorSubject` properties publicly; expose `subject.asObservable()` or read-only Signals instead.",
      "RXJS RULE 6: ShareReplay Leaks - When using `shareReplay(1)`, use `{ bufferSize: 1, refCount: true }` unless unbounded caching is explicitly required.",
      "RXJS RULE 7: forkJoin with Infinite Streams - Do not pass unending Observables (like `Subject` or continuous streams) to `forkJoin`, as it will never emit.",
    );
  }

  // Angular Specialized Heuristics
  if (activeKeys.has("angular")) {
    rules.push(
      "ANGULAR RULE 1: Standalone Components - Always use standalone components (default in Angular v20+; do NOT set `standalone: true` in decorators).",
      "ANGULAR RULE 2: Signals over Decorators - Prefer signal state (`signal()`, `computed()`, `input()`, `output()`) over legacy `@Input()`, `@Output()`, `@HostBinding()`, or `@HostListener()` decorators.",
      "ANGULAR RULE 3: OnPush Change Detection - Use `changeDetection: ChangeDetectionStrategy.OnPush` on all components.",
      "ANGULAR RULE 4: Modern Control Flow - Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`.",
      "ANGULAR RULE 5: Dependency Injection - Use `inject()` instead of constructor parameter injection.",
      "ANGULAR RULE 6: Accessibility & Images - Comply with WCAG AA accessibility minimums and use `NgOptimizedImage` for static images.",
    );
  }

  // React & Next.js Specialized Heuristics
  if (activeKeys.has("react") || activeKeys.has("nextjs")) {
    rules.push(
      "REACT RULE 1: Hook Dependencies - Ensure `useEffect`, `useCallback`, and `useMemo` dependency arrays contain all referenced reactive values.",
      "REACT RULE 2: State Immutability - Never mutate state objects directly; use pure updates or updater callbacks.",
      "REACT RULE 3: Stale Closures - Verify asynchronous callbacks and timers do not capture stale state.",
    );
    if (activeKeys.has("nextjs")) {
      rules.push(
        "NEXTJS RULE 1: Server/Client Boundary - Use `'use client'` at the top of files that use React hooks, browser APIs, or event handlers.",
        "NEXTJS RULE 2: Data Fetching & Caching - Validate server action parameters and handle hydration safety.",
      );
    }
  }

  // Zod / Schema Validation
  if (activeKeys.has("zod")) {
    rules.push(
      "ZOD RULE 1: Input Validation - Parse and validate all external network, webhook, and user inputs using strict schema parsers (`.parse()` or `.safeParse()`).",
    );
  }

  return rules;
}
