#!/usr/bin/env node
/**
 * generate-synthetic.mjs — Deterministic synthetic SKILL.md generator.
 *
 * Produces a corpus of SKILL.md manifests under data/skills-synthetic/.
 * Also generates a matching set of synthetic prompts (prompts.json +
 * expected-routes.json) so that each synthetic skill is targeted by at
 * least 2 unambiguous prompts.
 *
 * Uses a seeded Mulberry32 PRNG so the same `--count` always produces
 * identical output.
 *
 * Usage:
 *   node tests/scale/generate-synthetic.mjs [count] [--seed N] [--out DIR]
 *
 * Defaults: count=200, seed=42, out=data/skills-synthetic
 */
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const BASE = resolve('.');

// ── Mulberry32 PRNG ──────────────────────────────────────────────────────────
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Existing real skill names (loaded once) ──────────────────────────────────
async function loadExistingNames() {
  const names = new Set();
  try {
    const indexPath = resolve('data/skill-index.json');
    const idx = JSON.parse(await readFile(indexPath, 'utf-8'));
    for (const entry of idx) {
      names.add(entry.name);
    }
  } catch {
    // Index not available; check filesystem directly
    const skillsDir = resolve('data/skills');
    await walkSkillsDir(skillsDir, names);
  }
  return names;
}

async function walkSkillsDir(dir, names) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkSkillsDir(full, names);
      } else if (entry.name === 'SKILL.md') {
        try {
          const content = await readFile(full, 'utf-8');
          const match = content.match(/^---\s*\n.*?name:\s*(\S+)/m);
          if (match) names.add(match[1]);
        } catch {}
      }
    }
  } catch {}
}

// ── Skill templates per domain ───────────────────────────────────────────────
const DOMAIN_TEMPLATES = {
  backend: [
    { type: 'api-design', desc_good: 'RESTful API design patterns, HATEOAS links, versioning strategies, and resource modeling for scalable server interfaces', kw_good: ['REST', 'API design', 'HATEOAS', 'resource modeling', 'versioning'], kw_med: ['api', 'rest'], kw_weak: ['api'] },
    { type: 'database-migrations', desc_good: 'Database migration strategies including schema versioning, rollback procedures, idempotent migrations, and data transformation during upgrades', kw_good: ['migration', 'schema versioning', 'rollback', 'idempotent', 'data migration'], kw_med: ['database'], kw_weak: ['db'] },
    { type: 'queue-workers', desc_good: 'Background job processing with worker pools, retry policies, dead-letter queues, and idempotency guards for reliable async execution', kw_good: ['queue', 'worker', 'retry policy', 'dead-letter', 'async processing'], kw_med: ['jobs', 'background'], kw_weak: ['workers'] },
    { type: 'caching-strategies', desc_good: 'Cache layer design with TTL policies, cache invalidation patterns, distributed caching with Redis, and cache stampede prevention', kw_good: ['caching', 'TTL', 'cache invalidation', 'Redis', 'stampede prevention'], kw_med: ['cache'], kw_weak: ['caching'] },
    { type: 'rate-limiting', desc_good: 'Rate limiting algorithms including token bucket, sliding window counters, per-user quotas, and graceful degradation under load spikes', kw_good: ['rate limiting', 'token bucket', 'sliding window', 'throttling', 'quota'], kw_med: ['rate', 'limit'], kw_weak: ['throttle'] },
    { type: 'auth-middleware', desc_good: 'Authentication middleware with JWT validation, OAuth 2.0 flow, session management, and role-based access control enforcement', kw_good: ['authentication', 'JWT', 'OAuth', 'session', 'RBAC'], kw_med: ['auth', 'middleware'], kw_weak: ['auth'] },
    { type: 'error-handling', desc_good: 'Structured error handling with problem details format, error taxonomy, correlation IDs, and graceful degradation patterns', kw_good: ['error handling', 'problem details', 'correlation ID', 'error taxonomy', 'fallback'], kw_med: ['errors'], kw_weak: ['error'] },
    { type: 'api-documentation', desc_good: 'API documentation using OpenAPI 3.0 spec, interactive Swagger UI, endpoint examples, and versioned documentation strategy', kw_good: ['OpenAPI', 'Swagger', 'API docs', 'specification', 'endpoints'], kw_med: ['documentation', 'api doc'], kw_weak: ['docs'] },
    { type: 'payment-integration', desc_good: 'Payment gateway integration with Stripe or PayPal, webhook handling, idempotency keys, and PCI-DSS compliance considerations', kw_good: ['payment', 'Stripe', 'webhook', 'idempotency', 'PCI-DSS'], kw_med: ['payments'], kw_weak: ['payment'] },
    { type: 'file-storage', desc_good: 'File upload and storage strategies using cloud providers, CDN integration, virus scanning, and multipart upload with resume support', kw_good: ['file storage', 'upload', 'CDN', 'multipart', 'cloud storage'], kw_med: ['files'], kw_weak: ['storage'] },
    { type: 'grpc-services', desc_good: 'gRPC service definitions with protobuf schemas, streaming RPCs, bidirectional communication, and service mesh integration', kw_good: ['gRPC', 'protobuf', 'streaming RPC', 'bidirectional', 'service mesh'], kw_med: ['grpc'], kw_weak: ['rpc'] },
    { type: 'webhooks', desc_good: 'Webhook delivery with signature verification, retry backoff, event ordering guarantees, and webhook management dashboard', kw_good: ['webhook', 'signature verification', 'retry backoff', 'event delivery'], kw_med: ['webhooks'], kw_weak: ['webhook'] },
    { type: 'graphql-schema', desc_good: 'GraphQL schema design with type resolution, DataLoader for N+1 prevention, federation for micro-frontends, and introspection patterns', kw_good: ['GraphQL', 'schema design', 'DataLoader', 'federation', 'resolvers'], kw_med: ['graphql'], kw_weak: ['graphql'] },
    { type: 'database-indexing', desc_good: 'Database indexing strategies for query optimization, composite indexes, covering indexes, and index maintenance under write-heavy workloads', kw_good: ['indexing', 'query optimization', 'composite index', 'covering index'], kw_med: ['index', 'database'], kw_weak: ['indexing'] },
    { type: 'connection-pooling', desc_good: 'Database connection pooling with configurable min/max sizes, idle timeout, connection leak detection, and pool health monitoring', kw_good: ['connection pool', 'idle timeout', 'leak detection', 'pool health'], kw_med: ['pool'], kw_weak: ['pool'] },
    { type: 'transaction-management', desc_good: 'ACID transaction management with distributed transactions via Two-Phase Commit, sagas pattern, and compensating transaction handling', kw_good: ['transaction', 'ACID', 'saga pattern', 'distributed transaction', 'compensating'], kw_med: ['transactions'], kw_weak: ['transaction'] },
    { type: 'api-gateway', desc_good: 'API gateway patterns including request routing, circuit breaking, load balancing, rate limiting aggregation, and response transformation', kw_good: ['API gateway', 'circuit breaker', 'load balancer', 'request routing'], kw_med: ['gateway'], kw_weak: ['gateway'] },
    { type: 'message-broker', desc_good: 'Message broker patterns with RabbitMQ or Kafka, topic/queue design, consumer groups, partition strategy, and exactly-once semantics', kw_good: ['message broker', 'RabbitMQ', 'Kafka', 'consumer groups', 'partitioning'], kw_med: ['messaging'], kw_weak: ['messaging'] },
  ],
  frontend: [
    { type: 'react-components', desc_good: 'React component architecture with functional components, prop drilling avoidance, composition patterns, and controlled vs uncontrolled inputs', kw_good: ['React component', 'props', 'composition', 'controlled input', 'uncontrolled'], kw_med: ['react', 'components'], kw_weak: ['react'] },
    { type: 'state-management', desc_good: 'Frontend state management with Redux Toolkit, Zustand, or Context API, selector memoization, and normalized state shapes', kw_good: ['Redux', 'Zustand', 'Context API', 'selector', 'normalized state'], kw_med: ['state management'], kw_weak: ['state'] },
    { type: 'responsive-layouts', desc_good: 'Responsive CSS layouts using CSS Grid, Flexbox, container queries, and fluid typography for multi-device viewport adaptation', kw_good: ['CSS Grid', 'Flexbox', 'container query', 'fluid typography', 'viewport'], kw_med: ['responsive'], kw_weak: ['responsive'] },
    { type: 'form-validation', desc_good: 'Form validation with React Hook Form or Zod schema, client-side and server-side validation, error display patterns, and form state management', kw_good: ['form validation', 'React Hook Form', 'Zod', 'schema validation', 'error display'], kw_med: ['forms'], kw_weak: ['forms'] },
    { type: 'performance-optimization', desc_good: 'Frontend performance optimization with code splitting, lazy loading, bundle analysis, memoization, and virtual scrolling for large lists', kw_good: ['performance', 'code splitting', 'lazy loading', 'memoization', 'virtual scroll'], kw_med: ['performance'], kw_weak: ['perf'] },
    { type: 'nextjs-app', desc_good: 'Next.js application structure with App Router, Server Components, data fetching strategies, middleware, and file-based routing conventions', kw_good: ['Next.js', 'App Router', 'Server Components', 'data fetching', 'middleware'], kw_med: ['nextjs'], kw_weak: ['next'] },
    { type: 'typescript-config', desc_good: 'TypeScript configuration for frontend projects with strict mode, path aliases, declaration merging, and incremental compilation settings', kw_good: ['TypeScript', 'strict mode', 'path aliases', 'incremental compilation'], kw_med: ['typescript'], kw_weak: ['typescript'] },
    { type: 'css-architecture', desc_good: 'CSS architecture using BEM naming, CSS Modules, Tailwind utility classes, or CSS-in-JS with theme tokens and design system integration', kw_good: ['CSS architecture', 'BEM', 'CSS Modules', 'Tailwind', 'design tokens'], kw_med: ['CSS'], kw_weak: ['css'] },
    { type: 'accessibility', desc_good: 'Web accessibility (a11y) with ARIA attributes, keyboard navigation, screen reader testing, focus management, and WCAG 2.1 AA compliance', kw_good: ['accessibility', 'ARIA', 'keyboard navigation', 'WCAG', 'screen reader'], kw_med: ['a11y'], kw_weak: ['a11y'] },
    { type: 'animation-patterns', desc_good: 'CSS and JS animation patterns with Framer Motion or GSAP, scroll-triggered animations, spring physics, and reduced-motion media query support', kw_good: ['animation', 'Framer Motion', 'GSAP', 'scroll animation', 'reduced motion'], kw_med: ['animation'], kw_weak: ['anim'] },
    { type: 'pwa-offline', desc_good: 'Progressive Web App patterns including service workers, offline-first caching strategy, push notifications, and installable manifest configuration', kw_good: ['PWA', 'service worker', 'offline', 'push notification', 'manifest'], kw_med: ['pwa'], kw_weak: ['pwa'] },
    { type: 'testing-components', desc_good: 'Frontend component testing with Vitest or Jest, React Testing Library queries, mocking network requests, and snapshot testing strategies', kw_good: ['component testing', 'Vitest', 'Testing Library', 'mock network', 'snapshot test'], kw_med: ['testing'], kw_weak: ['test'] },
    { type: 'api-client-hooks', desc_good: 'Custom React hooks for API client abstraction with useSWR or TanStack Query, caching, background refetch, optimistic updates, and error boundaries', kw_good: ['useSWR', 'TanStack Query', 'optimistic update', 'background refetch', 'cache'], kw_med: ['api hook'], kw_weak: ['hook'] },
    { type: 'design-system', desc_good: 'Design system implementation with component library, token-based theming, storybook documentation, visual regression testing, and versioning strategy', kw_good: ['design system', 'Storybook', 'tokens', 'theming', 'visual regression'], kw_med: ['design system'], kw_weak: ['design'] },
    { type: 'webpack-config', desc_good: 'Webpack configuration for module bundling with code splitting, tree shaking, source maps, asset optimization, and loader/plugin chain setup', kw_good: ['Webpack', 'code splitting', 'tree shaking', 'source map', 'loader'], kw_med: ['webpack'], kw_weak: ['webpack'] },
    { type: 'seo-optimization', desc_good: 'Search engine optimization for SPAs with SSR/SSG rendering, meta tag management, sitemap generation, structured data, and crawlable routes', kw_good: ['SEO', 'SSR', 'SSG', 'meta tags', 'structured data'], kw_med: ['SEO'], kw_weak: ['SEO'] },
    { type: 'drag-drop', desc_good: 'Drag and drop interactions with HTML5 DnD API or dnd-kit, sortable lists, Kanban boards, file uploads, and touch-device compatibility', kw_good: ['drag and drop', 'dnd-kit', 'sortable', 'Kanban', 'touch device'], kw_med: ['drag'], kw_weak: ['drag'] },
    { type: 'websocket-client', desc_good: 'WebSocket client implementation with reconnection logic, heartbeat keepalive, message framing, and graceful degradation to SSE for real-time updates', kw_good: ['WebSocket', 'reconnection', 'heartbeat', 'SSE', 'real-time'], kw_med: ['websocket'], kw_weak: ['websocket'] },
  ],
  design: [
    { type: 'color-system', desc_good: 'Design color system with semantic tokens, light/dark mode, accessibility contrast ratios, and CSS custom property theming strategy', kw_good: ['color system', 'semantic tokens', 'dark mode', 'contrast ratio', 'CSS custom property'], kw_med: ['colors'], kw_weak: ['colors'] },
    { type: 'typography-scale', desc_good: 'Typography scale design with modular rhythm, fluid type sizing, font pairing guidelines, line-height ratios, and readable body copy standards', kw_good: ['typography', 'modular scale', 'fluid type', 'font pairing', 'line height'], kw_med: ['typography'], kw_weak: ['type'] },
    { type: 'spacing-system', desc_good: 'Spacing system based on 4px/8px baseline grid, consistent margin/padding tokens, responsive spacing breakpoints, and whitespace hierarchy principles', kw_good: ['spacing', 'baseline grid', 'margin', 'padding tokens', 'whitespace'], kw_med: ['spacing'], kw_weak: ['spacing'] },
    { type: 'component-library', desc_good: 'Component library design with atomic design methodology, prop interface contracts, variant patterns, and documentation-driven development workflow', kw_good: ['component library', 'atomic design', 'prop interface', 'variants', 'documentation'], kw_med: ['components'], kw_weak: ['components'] },
    { type: 'iconography', desc_good: 'Iconography system with SVG sprite sheets, stroke width consistency, scale variants, named icon tokens, and monochrome/dual-tone style guide', kw_good: ['iconography', 'SVG sprite', 'stroke width', 'icon tokens', 'scale variant'], kw_med: ['icons'], kw_weak: ['icons'] },
    { type: 'motion-design', desc_good: 'Motion design principles with easing curves, duration tokens, animation intent classification, and performance-aware motion with will-change and transform', kw_good: ['motion design', 'easing curve', 'duration token', 'animation intent'], kw_med: ['motion'], kw_weak: ['motion'] },
    { type: 'layout-grid', desc_good: 'Layout grid systems with 12-column responsive grid, gutters, margins, breakpoint definitions, and container-based layout constraints', kw_good: ['grid', '12-column', 'breakpoints', 'gutters', 'responsive layout'], kw_med: ['grid'], kw_weak: ['grid'] },
    { type: 'design-tokens', desc_good: 'Design token architecture with named token hierarchy, platform mapping (iOS/Android/web), token export pipeline, and token validation rules', kw_good: ['design tokens', 'token hierarchy', 'platform mapping', 'token export'], kw_med: ['tokens'], kw_weak: ['tokens'] },
    { type: 'dark-mode', desc_good: 'Dark mode implementation with elevation tokens, surface color scaling, contrast preservation, and system preference detection via prefers-color-scheme', kw_good: ['dark mode', 'elevation token', 'surface color', 'contrast', 'prefers-color-scheme'], kw_med: ['dark mode'], kw_weak: ['dark'] },
    { type: 'illustration-style', desc_good: 'Illustration style guide with flat design principles, gradient usage, character consistency, texture patterns, and brand-aligned visual language', kw_good: ['illustration', 'flat design', 'gradient', 'character consistency'], kw_med: ['illustration'], kw_weak: ['illustration'] },
    { type: 'form-design', desc_good: 'Form UX design with input affordances, inline validation feedback, error state messaging, progressive disclosure patterns, and mobile-optimized touch targets', kw_good: ['form design', 'input affordance', 'inline validation', 'progressive disclosure'], kw_med: ['forms'], kw_weak: ['forms'] },
    { type: 'data-visualization', desc_good: 'Data visualization patterns with D3 or Chart.js, chart type selection guide, color encoding for categorical/sequential data, and axis labeling conventions', kw_good: ['data visualization', 'D3', 'Chart.js', 'color encoding', 'axis labeling'], kw_med: ['visualization'], kw_weak: ['viz'] },
    { type: 'card-patterns', desc_good: 'Card UI patterns with header/body/footer zones, image aspect ratios, content hierarchy, action button placement, and responsive card grid layouts', kw_good: ['card pattern', 'content hierarchy', 'image ratio', 'action button'], kw_med: ['cards'], kw_weak: ['cards'] },
    { type: 'button-system', desc_good: 'Button system with primary/secondary/tertiary variants, size tokens, icon-left/right placement, disabled states, and loading spinner integration', kw_good: ['button', 'variant', 'size token', 'loading state'], kw_med: ['buttons'], kw_weak: ['button'] },
    { type: 'navigation-patterns', desc_good: 'Navigation UX patterns including sidebar, top nav, breadcrumb, tab bar, and progressive disclosure for complex information architecture', kw_good: ['navigation', 'sidebar', 'breadcrumb', 'tab bar', 'information architecture'], kw_med: ['nav'], kw_weak: ['nav'] },
    { type: 'modal-patterns', desc_good: 'Modal and dialog patterns with focus trapping, escape key dismissal, scroll lock, backdrop click handling, and nested modal restrictions', kw_good: ['modal', 'dialog', 'focus trap', 'escape key', 'scroll lock'], kw_med: ['modal'], kw_weak: ['modal'] },
    { type: 'tooltip-patterns', desc_good: 'Tooltip and popover patterns with trigger conditions, positioning strategy, content limits, animation delay, and keyboard accessible descriptions', kw_good: ['tooltip', 'popover', 'positioning', 'trigger condition', 'keyboard accessible'], kw_med: ['tooltip'], kw_weak: ['tooltip'] },
    { type: 'table-design', desc_good: 'Data table design with column ordering, sort indicators, row hover states, pagination vs infinite scroll, and responsive table collapsing patterns', kw_good: ['data table', 'sort indicator', 'pagination', 'infinite scroll', 'responsive table'], kw_med: ['table'], kw_weak: ['table'] },
  ],
  testing: [
    { type: 'unit-testing', desc_good: 'Unit testing fundamentals with isolated test cases, mocking dependencies, assertion libraries, and test naming conventions following AAA pattern', kw_good: ['unit testing', 'mocking', 'assertion', 'AAA pattern', 'isolated test'], kw_med: ['unit test'], kw_weak: ['unit'] },
    { type: 'integration-testing', desc_good: 'Integration testing with in-memory databases, test containers, API contract testing, and database transaction rollback strategy for test isolation', kw_good: ['integration test', 'test containers', 'API contract', 'DB rollback', 'test isolation'], kw_med: ['integration'], kw_weak: ['integration'] },
    { type: 'e2e-testing', desc_good: 'End-to-end testing with Playwright or Cypress, page object model, cross-browser testing, visual regression, and CI pipeline integration patterns', kw_good: ['E2E', 'Playwright', 'Cypress', 'page object', 'cross-browser'], kw_med: ['e2e'], kw_weak: ['e2e'] },
    { type: 'mutation-testing', desc_good: 'Mutation testing with Stryker or similar tools, mutant kill ratio analysis, weak test detection, and coverage quality improvement strategy', kw_good: ['mutation testing', 'Stryker', 'mutant kill ratio', 'test quality'], kw_med: ['mutation'], kw_weak: ['mutation'] },
    { type: 'property-testing', desc_good: 'Property-based testing with fast-check or Hypothesis, invariant definition, edge case generation, and shrinking counterexamples for robust test coverage', kw_good: ['property testing', 'fast-check', 'invariant', 'edge case', 'shrinking'], kw_med: ['property'], kw_weak: ['property'] },
    { type: 'test-coverage', desc_good: 'Test coverage analysis with line/branch/function coverage metrics, coverage reports, uncovered path identification, and coverage thresholds in CI', kw_good: ['test coverage', 'branch coverage', 'coverage report', 'coverage threshold'], kw_med: ['coverage'], kw_weak: ['coverage'] },
    { type: 'test-doubles', desc_good: 'Test doubles including stubs, mocks, spies, and fakes — when to use each type, creation patterns, and verification of interaction expectations', kw_good: ['test double', 'stub', 'mock', 'spy', 'fake'], kw_med: ['doubles'], kw_weak: ['double'] },
    { type: 'flaky-test-detection', desc_good: 'Flaky test detection with retry analysis, deterministic ordering, environment isolation, timeout debugging, and flaky test quarantine patterns', kw_good: ['flaky test', 'retry analysis', 'environment isolation', 'quarantine'], kw_med: ['flaky'], kw_weak: ['flaky'] },
    { type: 'snapshot-testing', desc_good: 'Snapshot testing for UI components, JSON API responses, and serialized state — diff management, regeneration strategy, and false-positive avoidance', kw_good: ['snapshot test', 'UI diff', 'regeneration', 'false positive'], kw_med: ['snapshot'], kw_weak: ['snapshot'] },
    { type: 'performance-testing', desc_good: 'Performance testing with benchmark suites, load testing with k6 or Artillery, p95 latency targets, memory leak detection, and regression alerts', kw_good: ['performance test', 'load test', 'k6', 'p95 latency', 'memory leak'], kw_med: ['performance'], kw_weak: ['perf'] },
    { type: 'contract-testing', desc_good: 'Consumer-driven contract testing with Pact or Spring Cloud Contract, provider verification, versioned contracts, and CI gate integration', kw_good: ['contract test', 'Pact', 'provider verification', 'versioned contract'], kw_med: ['contract'], kw_weak: ['contract'] },
    { type: 'test-organization', desc_good: 'Test suite organization with test hierarchies, describe/it nesting conventions, shared fixtures, test tagging strategies, and selective test running', kw_good: ['test organization', 'test hierarchy', 'shared fixtures', 'test tags'], kw_med: ['tests'], kw_weak: ['tests'] },
    { type: 'data-fixtures', desc_good: 'Data fixture management with factory patterns, seed data persistence, test data isolation, and synthetic data generation for edge cases', kw_good: ['fixtures', 'factory pattern', 'seed data', 'test isolation', 'synthetic data'], kw_med: ['fixtures'], kw_weak: ['fixtures'] },
    { type: 'security-testing', desc_good: 'Security testing with OWASP ZAP, dependency vulnerability scanning, DAST/SAST pipeline integration, and penetration test automation patterns', kw_good: ['security testing', 'OWASP ZAP', 'DAST', 'SAST', 'vulnerability scan'], kw_med: ['security'], kw_weak: ['security'] },
    { type: 'api-testing', desc_good: 'API testing with request/response validation, status code assertions, schema validation with JSON Schema, and API contract drift detection', kw_good: ['API test', 'JSON Schema', 'status code', 'contract drift'], kw_med: ['api test'], kw_weak: ['api'] },
    { type: 'test-cleanup', desc_good: 'Test cleanup strategies with before/after hooks, database truncation, file system temp cleanup, external service mock teardown, and resource leak prevention', kw_good: ['test cleanup', 'teardown', 'DB truncation', 'resource leak'], kw_med: ['cleanup'], kw_weak: ['cleanup'] },
    { type: 'parallel-testing', desc_good: 'Parallel test execution with shard distribution, isolated state per shard, race condition detection, and CI parallel runner configuration', kw_good: ['parallel test', 'shard', 'race condition', 'CI runner'], kw_med: ['parallel'], kw_weak: ['parallel'] },
    { type: 'behavioral-testing', desc_good: 'Behavior-driven development with Gherkin syntax, feature file organization, step definition reuse, and shared scenario library patterns', kw_good: ['BDD', 'Gherkin', 'feature file', 'step definition'], kw_med: ['BDD'], kw_weak: ['bdd'] },
    { type: 'test-reporting', desc_good: 'Test reporting with JUnit XML output, HTML dashboard generation, coverage integration, flaky test trend charts, and Slack/Teams notification setup', kw_good: ['test report', 'JUnit XML', 'HTML dashboard', 'coverage report'], kw_med: ['reporting'], kw_weak: ['report'] },
  ],
  meta: [
    { type: 'git-workflow', desc_good: 'Git workflow patterns including feature branch strategy, merge vs rebase decisions, semantic commit messages, and conventional commits specification', kw_good: ['Git workflow', 'feature branch', 'semantic commit', 'conventional commits', 'rebase'], kw_med: ['git'], kw_weak: ['git'] },
    { type: 'code-review', desc_good: 'Code review process with checklist-driven reviews, constructive feedback patterns, automated check pre-screening, and review turnaround time expectations', kw_good: ['code review', 'checklist', 'constructive feedback', 'automated checks'], kw_med: ['review'], kw_weak: ['review'] },
    { type: 'documentation', desc_good: 'Technical documentation strategy including README conventions, API docs with JSDoc, architecture decision records, and narrative documentation for onboarding', kw_good: ['documentation', 'README', 'JSDoc', 'ADR', 'onboarding doc'], kw_med: ['docs'], kw_weak: ['docs'] },
    { type: 'refactoring', desc_good: 'Refactoring methodology with extract function, replace temp with query, decompose conditional, and safe refactoring with test coverage as guardrail', kw_good: ['refactoring', 'extract function', 'decompose conditional', 'test guardrail'], kw_med: ['refactor'], kw_weak: ['refactor'] },
    { type: 'architecture-decision', desc_good: 'Architecture Decision Record (ADR) writing with context, decision, consequences, status tracking, and ADR index maintenance for project history', kw_good: ['ADR', 'architecture decision', 'consequences', 'decision record'], kw_med: ['architecture'], kw_weak: ['arch'] },
    { type: 'dependency-management', desc_good: 'Dependency management with semantic versioning strategy, lockfile discipline, vulnerability auditing, and depdency update automation with renovate', kw_good: ['dependency', 'semantic versioning', 'lockfile', 'vulnerability audit', 'renovate'], kw_med: ['dependencies'], kw_weak: ['deps'] },
    { type: 'project-structure', desc_good: 'Project structure patterns with barrel exports, domain-driven folder organization, shared library extraction, and package boundary definitions', kw_good: ['project structure', 'barrel export', 'DDD folder', 'package boundary'], kw_med: ['structure'], kw_weak: ['structure'] },
    { type: 'env-config', desc_good: 'Environment configuration with .env schema validation, secret management, environment-specific defaults, and config validation at startup', kw_good: ['env config', '.env', 'secret management', 'config validation'], kw_med: ['environment'], kw_weak: ['env'] },
    { type: 'changelog-management', desc_good: 'Changelog management with Keep a Changelog format, semantic version bumping, release notes generation, and automated changelog from commits', kw_good: ['changelog', 'Keep a Changelog', 'semantic version', 'release notes'], kw_med: ['changelog'], kw_weak: ['changelog'] },
    { type: 'linting-config', desc_good: 'Linting configuration with ESLint ruleset selection, parser configuration, autofix strategy, and CI lint gate with failing status on violations', kw_good: ['ESLint', 'ruleset', 'parser', 'autofix', 'CI gate'], kw_med: ['linting'], kw_weak: ['lint'] },
    { type: 'seeding-strategy', desc_good: 'Database seeding strategy with realistic sample data, enum value generation, relationship population, and seed idempotency for deterministic test data', kw_good: ['seeding', 'sample data', 'enum generation', 'seed idempotency'], kw_med: ['seed'], kw_weak: ['seed'] },
    { type: 'debugging-techniques', desc_good: 'Debugging techniques including strategic logging, breakpoint patterns, memory profiler usage, heap snapshot analysis, and root cause isolation methodology', kw_good: ['debugging', 'logging', 'breakpoint', 'heap snapshot', 'root cause'], kw_med: ['debug'], kw_weak: ['debug'] },
    { type: 'architecture-patterns', desc_good: 'Software architecture patterns including MVC, layered architecture, hexagonal architecture, event sourcing, CQRS, and micro-frontend decomposition strategy', kw_good: ['architecture pattern', 'MVC', 'hexagonal', 'event sourcing', 'CQRS'], kw_med: ['architecture'], kw_weak: ['arch'] },
    { type: 'tech-debt-tracking', desc_good: 'Technical debt tracking with tagged TODO/FIXME conventions, debt backlog prioritization, remediation sprint planning, and debt ratio monitoring', kw_good: ['tech debt', 'TODO tag', 'debt backlog', 'remediation sprint'], kw_med: ['tech debt'], kw_weak: ['debt'] },
    { type: 'api-versioning', desc_good: 'API versioning strategies with URL path versioning, header-based versioning, deprecation warnings, and backward compatibility guarantee policy', kw_good: ['API versioning', 'deprecation', 'backward compatibility', 'header versioning'], kw_med: ['versioning'], kw_weak: ['version'] },
    { type: 'project-onboarding', desc_good: 'Project onboarding with CONTRIBUTING.md, local dev environment setup, seed script execution, and first-contribution good-first-issue triage', kw_good: ['onboarding', 'CONTRIBUTING', 'dev setup', 'seed script', 'good first issue'], kw_med: ['onboarding'], kw_weak: ['onboard'] },
    { type: 'release-management', desc_good: 'Release management with semantic versioning, changelog generation, release branch strategy, hotfix workflow, and production deployment checklist', kw_good: ['release management', 'semantic version', 'hotfix', 'deployment checklist'], kw_med: ['release'], kw_weak: ['release'] },
    { type: 'monorepo-structure', desc_good: 'Monorepo structure with workspace configuration, package inter-dependencies, shared build tooling, version bumping strategy, and selective publishing', kw_good: ['monorepo', 'workspace', 'inter-dependency', 'shared tooling'], kw_med: ['monorepo'], kw_weak: ['monorepo'] },
    { type: 'design-patterns', desc_good: 'GoF design patterns implementation with Singleton, Factory, Observer, Strategy, and Dependency Injection patterns in modern JavaScript/TypeScript', kw_good: ['design pattern', 'Singleton', 'Factory', 'Observer', 'Strategy', 'DI'], kw_med: ['design pattern'], kw_weak: ['pattern'] },
  ],
  devops: [
    { type: 'docker-containers', desc_good: 'Docker container best practices with multi-stage builds, minimal base images, non-root user execution, health checks, and container orchestration basics', kw_good: ['Docker', 'multi-stage build', 'health check', 'non-root', 'container'], kw_med: ['docker'], kw_weak: ['docker'] },
    { type: 'ci-pipeline', desc_good: 'CI/CD pipeline design with GitHub Actions workflows, staged builds, artifact caching, parallel jobs, and deployment approval gates', kw_good: ['CI/CD', 'GitHub Actions', 'staged build', 'artifact cache', 'approval gate'], kw_med: ['CI'], kw_weak: ['CI'] },
    { type: 'kubernetes-deploy', desc_good: 'Kubernetes deployment with Deployment manifests, Horizontal Pod Autoscaler, ConfigMap/Secret management, and ingress controller configuration', kw_good: ['Kubernetes', 'Deployment', 'HPA', 'ConfigMap', 'ingress'], kw_med: ['k8s'], kw_weak: ['k8s'] },
    { type: 'infrastructure-as-code', desc_good: 'Infrastructure as Code with Terraform state management, module composition, plan/apply workflow, and remote backend locking strategy', kw_good: ['Terraform', 'state management', 'module', 'plan apply', 'remote backend'], kw_med: ['IaC'], kw_weak: ['iac'] },
    { type: 'monitoring-alerting', desc_good: 'Monitoring and alerting with Prometheus metrics, Grafana dashboards, alert rule thresholds, PagerDuty integration, and SLO/SLI definition', kw_good: ['monitoring', 'Prometheus', 'Grafana', 'alert rule', 'SLO', 'SLI'], kw_med: ['monitoring'], kw_weak: ['monitor'] },
    { type: 'log-aggregation', desc_good: 'Log aggregation with structured JSON logging, log shipper configuration, log retention policy, and centralized log search with Kibana or Loki', kw_good: ['logging', 'structured JSON', 'log shipper', 'retention', 'Kibana'], kw_med: ['logging'], kw_weak: ['logs'] },
    { type: 'backup-restore', desc_good: 'Backup and restore strategy with automated snapshots, point-in-time recovery, cross-region replication, backup integrity verification, and RPO/RTO targets', kw_good: ['backup', 'snapshot', 'point-in-time', 'RPO', 'RTO'], kw_med: ['backup'], kw_weak: ['backup'] },
    { type: 'ssl-certificates', desc_good: 'SSL/TLS certificate management with Let\'s Encrypt automation, certificate rotation, SNI configuration, and HTTPS enforcement via redirect rules', kw_good: ['SSL', 'TLS', "Let's Encrypt", 'certificate rotation', 'SNI'], kw_med: ['SSL'], kw_weak: ['ssl'] },
    { type: 'load-balancing', desc_good: 'Load balancing with round-robin, least-connections, sticky sessions, health-based routing, and active-passive failover configuration', kw_good: ['load balancer', 'round-robin', 'sticky session', 'failover', 'health check'], kw_med: ['load balancer'], kw_weak: ['LB'] },
    { type: 'container-registry', desc_good: 'Container registry management with image tagging strategy, vulnerability scanning in pipeline, image garbage collection, and private registry auth', kw_good: ['container registry', 'image tag', 'vulnerability scan', 'garbage collection'], kw_med: ['registry'], kw_weak: ['registry'] },
    { type: 'auto-scaling', desc_good: 'Auto-scaling strategy with CPU/memory thresholds, cooldown periods, predictive scaling, and horizontal pod autoscaler configuration for Kubernetes', kw_good: ['auto-scaling', 'cooldown', 'predictive scaling', 'HPA', 'threshold'], kw_med: ['scaling'], kw_weak: ['scale'] },
    { type: 'secrets-management', desc_good: 'Secrets management with HashiCorp Vault, AWS Secrets Manager, encrypted environment variables, secret rotation policy, and access audit logging', kw_good: ['secrets', 'Vault', 'secret rotation', 'audit log', 'encryption'], kw_med: ['secrets'], kw_weak: ['secrets'] },
    { type: 'database-backup', desc_good: 'Database backup automation with logical dumps, physical backups, replication lag monitoring, PITR capability, and backup restoration drill schedule', kw_good: ['DB backup', 'logical dump', 'PITR', 'replication lag', 'drill'], kw_med: ['DB backup'], kw_weak: ['backup'] },
    { type: 'cdn-configuration', desc_good: 'CDN configuration with cache rules, origin shielding, geo-routing, SSL termination at edge, and dynamic content cache bypass strategy', kw_good: ['CDN', 'cache rule', 'origin shield', 'geo-routing', 'edge SSL'], kw_med: ['CDN'], kw_weak: ['CDN'] },
    { type: 'incident-response', desc_good: 'Incident response procedure with severity classification, on-call rotation, runbook documentation, postmortem template, and blameless retrospective process', kw_good: ['incident', 'severity', 'on-call', 'runbook', 'postmortem'], kw_med: ['incident'], kw_weak: ['incident'] },
    { type: 'network-security', desc_good: 'Network security with VPC design, security group rules, NAT gateway configuration, DNS filtering, and network-level DDoS mitigation strategy', kw_good: ['network security', 'VPC', 'security group', 'NAT', 'DDoS'], kw_med: ['network'], kw_weak: ['network'] },
    { type: 'deploy-strategy', desc_good: 'Deployment strategy with blue-green, canary release, feature flag gating, rolling update configuration, and rollback automation on health check failure', kw_good: ['deployment', 'blue-green', 'canary', 'feature flag', 'rolling update'], kw_med: ['deploy'], kw_weak: ['deploy'] },
    { type: 'performance-tuning', desc_good: 'Performance tuning with query optimization, connection pool sizing, cache hit ratio analysis, buffer pool configuration, and connection timeout tuning', kw_good: ['performance tuning', 'query optimization', 'buffer pool', 'cache hit ratio'], kw_med: ['performance'], kw_weak: ['perf'] },
    { type: 'observability', desc_good: 'Observability stack with OpenTelemetry instrumentation, distributed tracing, metric collection pipelines, log correlation, and trace-to-log navigation', kw_good: ['observability', 'OpenTelemetry', 'distributed tracing', 'metric pipeline'], kw_med: ['observability'], kw_weak: ['obs'] },
  ],
  security: [
    { type: 'OWASP-top10', desc_good: 'OWASP Top 10 vulnerability mitigation including SQL injection prevention, XSS sanitization, CSRF tokens, insecure deserialization, and SSRF protection', kw_good: ['OWASP', 'SQL injection', 'XSS', 'CSRF', 'SSRF', 'deserialization'], kw_med: ['OWASP'], kw_weak: ['security'] },
    { type: 'password-hashing', desc_good: 'Password hashing with bcrypt or Argon2id, salt generation, work factor tuning, timing-safe comparison, and brute-force resistance benchmarking', kw_good: ['password hash', 'bcrypt', 'Argon2', 'salt', 'timing-safe'], kw_med: ['password'], kw_weak: ['password'] },
    { type: 'JWT-security', desc_good: 'JWT security best practices with algorithm validation, expiration claims, issuer verification, key rotation, and token storage in HTTP-only cookies', kw_good: ['JWT', 'algorithm validation', 'expiration', 'issuer', 'HTTP-only cookie'], kw_med: ['JWT'], kw_weak: ['JWT'] },
    { type: 'CORS-policy', desc_good: 'CORS policy configuration with allowed origins whitelist, preflight caching, credential handling, and same-origin policy bypass risks assessment', kw_good: ['CORS', 'preflight', 'allowed origin', 'credentials', 'same-origin'], kw_med: ['CORS'], kw_weak: ['CORS'] },
    { type: 'input-sanitization', desc_good: 'Input sanitization with HTML entity encoding, parameterized queries, output encoding context selection, and library-based sanitizer configuration', kw_good: ['sanitization', 'HTML entity', 'parameterized query', 'output encoding'], kw_med: ['sanitize'], kw_weak: ['sanitize'] },
    { type: 'vault-secrets', desc_good: 'HashiCorp Vault integration with dynamic secrets, secret leasing, approle configuration, audit logging, and transit encryption engine usage', kw_good: ['Vault', 'dynamic secret', 'secret lease', 'auth role', 'transit encryption'], kw_med: ['Vault'], kw_weak: ['vault'] },
    { type: 'encryption-at-rest', desc_good: 'Encryption at rest with AES-256 database column encryption, envelope encryption with KMS, key rotation policy, and transparent data encryption configuration', kw_good: ['encryption at rest', 'AES-256', 'envelope encryption', 'KMS', 'key rotation'], kw_med: ['encryption'], kw_weak: ['encrypt'] },
    { type: 'mfa-implementation', desc_good: 'Multi-factor authentication with TOTP, WebAuthn/FIDO2, SMS fallback, MFA bypass risk assessment, and progressive authentication step-up flows', kw_good: ['MFA', 'TOTP', 'WebAuthn', 'FIDO2', 'step-up auth'], kw_med: ['MFA'], kw_weak: ['MFA'] },
    { type: 'penetration-testing', desc_good: 'Penetration testing methodology with OWASP ZAP automation, manual exploit validation, scope definition, vulnerability reporting, and remediation tracking', kw_good: ['penetration test', 'OWASP ZAP', 'exploit', 'vulnerability report'], kw_med: ['pentest'], kw_weak: ['pentest'] },
    { type: 'dependency-audit', desc_good: 'Dependency vulnerability auditing with npm audit, Snyk or Dependabot integration, CVE matching, license compliance checking, and automatic PR generation for fixes', kw_good: ['dependency audit', 'npm audit', 'Snyk', 'CVE', 'license compliance'], kw_med: ['audit'], kw_weak: ['audit'] },
    { type: 'API-security', desc_good: 'API security with request rate limiting, payload size limits, input validation middleware, OAuth 2.0 scope enforcement, and API key rotation policy', kw_good: ['API security', 'rate limit', 'payload limit', 'OAuth scope', 'API key'], kw_med: ['API security'], kw_weak: ['api security'] },
    { type: 'session-management', desc_good: 'Session management with secure cookie flags, session fixation prevention, absolute timeout, idle timeout, and distributed session store consistency', kw_good: ['session management', 'secure cookie', 'session fixation', 'timeout'], kw_med: ['session'], kw_weak: ['session'] },
    { type: 'zero-trust', desc_good: 'Zero trust architecture with identity-centric access control, micro-segmentation, continuous verification, least-privilege enforcement, and implicit deny defaults', kw_good: ['zero trust', 'micro-segmentation', 'continuous verification', 'least privilege'], kw_med: ['zero trust'], kw_weak: ['trust'] },
    { type: 'data-privacy', desc_good: 'Data privacy compliance with GDPR consent management, data minimization, right to erasure implementation, DPA impact assessment, and retention period enforcement', kw_good: ['GDPR', 'consent', 'right to erasure', 'data minimization', 'DPIA'], kw_med: ['privacy'], kw_weak: ['privacy'] },
    { type: 'hash-algorithms', desc_good: 'Cryptographic hash algorithm selection with SHA-256 for integrity, bcrypt/Argon2 for passwords, HMAC for message authentication, and algorithm deprecation timeline', kw_good: ['hash', 'SHA-256', 'HMAC', 'bcrypt', 'argon2'], kw_med: ['hash'], kw_weak: ['hash'] },
    { type: 'ransomware-defense', desc_good: 'Ransomware defense with immutable backups, endpoint detection rules, lateral movement prevention, network segmentation, and incident response runbook', kw_good: ['ransomware', 'immutable backup', 'endpoint detection', 'lateral movement'], kw_med: ['ransomware'], kw_weak: ['ransom'] },
    { type: 'secure-coding', desc_good: 'Secure coding standards with input validation, output encoding, error handling without info leakage, principle of least privilege, and secure default configuration', kw_good: ['secure coding', 'input validation', 'least privilege', 'secure default'], kw_med: ['secure coding'], kw_weak: ['secure'] },
    { type: 'network-firewall', desc_good: 'Network firewall configuration with stateful inspection, ingress/egress filtering, ICMP policy, port whitelisting, and fail-open vs fail-closed policy', kw_good: ['firewall', 'stateful inspection', 'ingress/egress', 'port whitelist'], kw_med: ['firewall'], kw_weak: ['firewall'] },
  ],
  mobile: [
    { type: 'react-native-setup', desc_good: 'React Native project setup with Expo or bare workflow, native module linking, environment configuration, and platform-specific code organization', kw_good: ['React Native', 'Expo', 'native module', 'platform-specific'], kw_med: ['react native'], kw_weak: ['rn'] },
    { type: 'flutter-widgets', desc_good: 'Flutter widget composition with Stateful/Stateless widget selection, layout constraints, build method optimization, and widget lifecycle management', kw_good: ['Flutter', 'widget', 'StatefulWidget', 'build method', 'lifecycle'], kw_med: ['flutter'], kw_weak: ['flutter'] },
    { type: 'mobile-navigation', desc_good: 'Mobile app navigation with drawer, tab, stack, and bottom navigation patterns, deep linking, navigation state persistence, and animated transitions', kw_good: ['mobile navigation', 'deep link', 'stack nav', 'bottom nav', 'drawer'], kw_med: ['navigation'], kw_weak: ['nav'] },
    { type: 'push-notifications', desc_good: 'Push notification implementation with FCM/APNs registration, notification payload handling, permission request UX, and background fetch strategy', kw_good: ['push notification', 'FCM', 'APNs', 'permission UX', 'background fetch'], kw_med: ['push'], kw_weak: ['push'] },
    { type: 'offline-storage', desc_good: 'Offline data storage with SQLite or WatermelonDB, sync conflict resolution, local-first architecture, and background sync queue management', kw_good: ['offline storage', 'SQLite', 'sync conflict', 'local-first', 'background sync'], kw_med: ['offline'], kw_weak: ['offline'] },
    { type: 'mobile-auth', desc_good: 'Mobile authentication with biometric login (Face ID/Touch ID), OAuth 2.0 device flow, token refresh strategy, and secure keychain storage', kw_good: ['mobile auth', 'biometric', 'Face ID', 'keychain', 'token refresh'], kw_med: ['mobile auth'], kw_weak: ['auth'] },
    { type: 'camera-integration', desc_good: 'Camera integration with device camera access, photo crop and compression, gallery picker, permission handling, and image metadata preservation', kw_good: ['camera', 'photo compression', 'gallery picker', 'permission'], kw_med: ['camera'], kw_weak: ['camera'] },
    { type: 'geolocation', desc_good: 'Geolocation services with GPS tracking, reverse geocoding, location permission UX, background location updates, and geofencing trigger management', kw_good: ['geolocation', 'GPS', 'reverse geocode', 'geofencing', 'location permission'], kw_med: ['geolocation'], kw_weak: ['geo'] },
    { type: 'in-app-purchase', desc_good: 'In-app purchase implementation with product catalog sync, receipt validation, subscription management, restore purchase flow, and StoreKit/Firebase integration', kw_good: ['IAP', 'receipt validation', 'subscription', 'StoreKit', 'restore purchase'], kw_med: ['IAP'], kw_weak: ['iap'] },
    { type: 'biometric-auth', desc_good: 'Biometric authentication with fingerprint and face recognition API usage, fallback to PIN, secure enclave key storage, and cross-platform consistency', kw_good: ['biometric', 'fingerprint', 'face recognition', 'secure enclave'], kw_med: ['biometric'], kw_weak: ['bio'] },
    { type: 'deep-linking', desc_good: 'Deep linking with Universal Links (iOS) and App Links (Android), URL scheme handling, dynamic link routing, and fallback web page strategy', kw_good: ['deep linking', 'Universal Link', 'App Link', 'URL scheme'], kw_med: ['deep link'], kw_weak: ['deep'] },
    { type: 'app-icon-badge', desc_good: 'App icon badge management with notification count badge update, silent badge reset, cross-platform badge API consistency, and visual feedback patterns', kw_good: ['badge', 'notification count', 'silent badge', 'badge API'], kw_med: ['badge'], kw_weak: ['badge'] },
    { type: 'mobile-perf', desc_good: 'Mobile performance optimization with memory profiling, CPU throttling detection, image caching strategy, list virtualization, and startup time reduction', kw_good: ['mobile performance', 'memory profile', 'CPU throttle', 'image cache'], kw_med: ['mobile perf'], kw_weak: ['perf'] },
    { type: 'OTA-updates', desc_good: 'Over-the-air update strategy with CodePush or Expo Updates, version rollout management, rollback on crash detection, and update validation signature', kw_good: ['OTA update', 'CodePush', 'Expo Updates', 'rollout', 'crash detection'], kw_med: ['OTA'], kw_weak: ['OTA'] },
    { type: 'mobile-testing', desc_good: 'Mobile app testing with device farm integration, UI automation with Maestro or Detox, crash report analysis, and cross-device compatibility matrix', kw_good: ['mobile testing', 'Maestro', 'Detox', 'device farm', 'crash report'], kw_med: ['mobile test'], kw_weak: ['test'] },
    { type: 'native-module', desc_good: 'Native module development with Platform Channel abstraction, Android JNI/ObjC bridging, iOS React Native bridge, and shared cross-platform API contract', kw_good: ['native module', 'JNI', 'bridge', 'Platform Channel'], kw_med: ['native'], kw_weak: ['native'] },
    { type: 'haptic-feedback', desc_good: 'Haptic feedback patterns with iOS Core Haptics, Android Vibration API, cross-platform haptic API abstraction, and touch-response timing optimization', kw_good: ['haptic', 'Core Haptics', 'vibration API', 'touch response'], kw_med: ['haptic'], kw_weak: ['haptic'] },
    { type: 'background-task', desc_good: 'Background task execution with foreground service (Android), background fetch (iOS), work manager patterns, and battery-efficient scheduling', kw_good: ['background task', 'foreground service', 'background fetch', 'battery'], kw_med: ['background'], kw_weak: ['bg'] },
    { type: 'app-store-deploy', desc_good: 'App Store and Play Store deployment with build signing, entitlement configuration, privacy nutrition label, binary upload, and review rejection handling', kw_good: ['app store', 'Play Store', 'build signing', 'privacy label', 'review'], kw_med: ['app store'], kw_weak: ['store'] },
  ],
};

// ── Additional descriptive sentence fragments for body content ───────────────
const INSTRUCTIONS = [
  'Start by understanding the requirements and constraints of the task.',
  'Consider edge cases and error handling throughout the implementation.',
  'Follow established project conventions and coding standards consistently.',
  'Document your decisions and rationale in relevant ADRs or comments.',
  'Write tests that cover both happy path and failure scenarios.',
  'Review existing codebase patterns before introducing new abstractions.',
  'Validate inputs early and provide meaningful error messages on failure.',
  'Profile before optimizing — identify actual bottlenecks with data.',
  'Keep implementations simple and readable over clever or concise.',
  'Communicate trade-offs explicitly when making architectural decisions.',
  'Use the framework\'s built-in mechanisms before reaching for custom solutions.',
  'Ensure all public APIs have clear documentation and type signatures.',
  'Handle cleanup and resource release explicitly in all code paths.',
  'Separate concerns between data layer, business logic, and presentation.',
  'Write idempotent operations wherever possible to simplify recovery.',
];

// ── Prompt templates per domain ─────────────────────────────────────────────
// Each template returns an array of {form, text} objects where form is one of:
//   "question"  — interrogative: "How do I …?"
//   "imperative" — directive: "Implement … using …"
//   "nounphrase" — fragment: "… best practices for …"
// Each skill gets exactly 2 prompts drawn from a rotating pool of forms.
const PROMPT_TEMPLATES = {
  backend: (name, keywords, desc) => [
    { form: 'question',  text: `How do I implement ${keywords[0] || name.replace(/-/g, ' ')} following best practices?` },
    { form: 'imperative', text: `Implement ${keywords[0] || name.replace(/-/g, ' ')} using the ${name} skill.` },
    { form: 'nounphrase', text: `${keywords[0] || name.replace(/-/g, ' ')} best practices and the ${name} skill` },
    { form: 'question',  text: `Which skill should I use for ${keywords[0] || 'backend'} tasks involving ${name}?` },
    { form: 'imperative', text: `Apply the ${name} skill to my ${keywords[0] || 'backend'} project.` },
  ],
  frontend: (name, keywords, desc) => [
    { form: 'question',  text: `How do I use the ${name} skill for my React frontend project?` },
    { form: 'imperative', text: `Use ${keywords[0] || name.replace(/-/g, ' ')} patterns in my frontend.` },
    { form: 'nounphrase', text: `${keywords[0] || name.replace(/-/g, ' ')} for React component architecture` },
    { form: 'question',  text: `Can you explain the ${name} approach for frontend implementation?` },
    { form: 'imperative', text: `Follow ${name} guidelines when building the UI.` },
  ],
  design: (name, keywords, desc) => [
    { form: 'question',  text: `How do I implement ${keywords[0] || name.replace(/-/g, ' ')} following design best practices?` },
    { form: 'imperative', text: `Design the ${name} system using the ${keywords[0] || 'design'} skill.` },
    { form: 'nounphrase', text: `${keywords[0] || name.replace(/-/g, ' ')} guidelines for UI design` },
    { form: 'question',  text: `Which skill covers ${keywords[0] || 'design'} patterns like ${name}?` },
    { form: 'imperative', text: `Apply the ${name} skill to my design system.` },
  ],
  testing: (name, keywords, desc) => [
    { form: 'question',  text: `How do I set up ${keywords[0] || name.replace(/-/g, ' ')} in my test suite?` },
    { form: 'imperative', text: `Use the ${name} skill for testing patterns in my project.` },
    { form: 'nounphrase', text: `${keywords[0] || name.replace(/-/g, ' ')} testing with the ${name} skill` },
    { form: 'question',  text: `Which skill should I follow for ${name} testing?` },
    { form: 'imperative', text: `Configure ${name} according to best practices.` },
  ],
  meta: (name, keywords, desc) => [
    { form: 'question',  text: `How do I apply the ${name} skill for my project workflow?` },
    { form: 'imperative', text: `Use ${keywords[0] || name.replace(/-/g, ' ')} patterns in my project.` },
    { form: 'nounphrase', text: `${keywords[0] || name.replace(/-/g, ' ')} workflow and the ${name} skill` },
    { form: 'question',  text: `Which skill applies to ${keywords[0] || 'meta'} tasks like ${name}?` },
    { form: 'imperative', text: `Follow the ${name} skill for project management.` },
  ],
  devops: (name, keywords, desc) => [
    { form: 'question',  text: `How do I implement ${keywords[0] || name.replace(/-/g, ' ')} in my deployment pipeline?` },
    { form: 'imperative', text: `Configure ${name} using DevOps best practices.` },
    { form: 'nounphrase', text: `${keywords[0] || name.replace(/-/g, ' ')} CI/CD pipeline with the ${name} skill` },
    { form: 'question',  text: `Which skill covers ${keywords[0] || 'devops'} tasks like ${name}?` },
    { form: 'imperative', text: `Apply the ${name} skill to my infrastructure.` },
  ],
  security: (name, keywords, desc) => [
    { form: 'question',  text: `How do I implement ${keywords[0] || name.replace(/-/g, ' ')} security measures?` },
    { form: 'imperative', text: `Use the ${name} skill for application security.` },
    { form: 'nounphrase', text: `${keywords[0] || name.replace(/-/g, ' ')} security patterns and the ${name} skill` },
    { form: 'question',  text: `Which skill should I follow for ${name} in my app?` },
    { form: 'imperative', text: `Apply ${name} guidelines to secure my project.` },
  ],
  mobile: (name, keywords, desc) => [
    { form: 'question',  text: `How do I implement ${keywords[0] || name.replace(/-/g, ' ')} in my mobile app?` },
    { form: 'imperative', text: `Use the ${name} skill for mobile development.` },
    { form: 'nounphrase', text: `${keywords[0] || name.replace(/-/g, ' ')} patterns for mobile apps` },
    { form: 'question',  text: `Which skill covers ${keywords[0] || 'mobile'} tasks like ${name}?` },
    { form: 'imperative', text: `Apply ${name} best practices to my mobile project.` },
  ],
};

function getDomainKey(domain) {
  return domain in PROMPT_TEMPLATES ? domain : 'meta';
}

// ── Utility helpers ──────────────────────────────────────────────────────────
function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffleArr(rng, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generate synthetic prompts that unambiguously target the given skills.
 * Each skill gets 2 prompts drawn from a rotating pool of forms (question,
 * imperative, noun phrase) so that prompt shapes vary across the corpus.
 */
function generatePrompts(skills, rng) {
  const prompts = [];
  let id = 1;

  // Pre-compute per-skill prompt pools so we can rotate forms deterministically
  const skillPromptPools = skills.map((skill) => {
    const domainKey = getDomainKey(skill.domains[0]);
    const templates = PROMPT_TEMPLATES[domainKey] || PROMPT_TEMPLATES.meta;
    return templates(skill.name, skill.keywords, skill.description);
  });

  // Assign 2 prompts per skill, rotating form index to spread question/imperative/nounphrase
  for (let si = 0; si < skills.length; si++) {
    const pool = skillPromptPools[si];
    const count = Math.min(2, pool.length);
    for (let fi = 0; fi < count; fi++) {
      const template = pool[(si + fi) % pool.length]; // rotate to vary forms
      prompts.push({ id: id++, prompt: template.text, form: template.form });
    }
  }

  // Shuffle prompts so they're not ordered by skill
  for (let i = prompts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [prompts[i], prompts[j]] = [prompts[j], prompts[i]];
  }

  // Build expected routes: map each prompt back to its target skill name
  const expected = new Array(prompts.length);
  const skillToPromptIds = new Map(); // skill name → [prompt ids]
  let pid = 1;
  for (let si = 0; si < skills.length; si++) {
    const pool = skillPromptPools[si];
    const count = Math.min(2, pool.length);
    const assignedIds = [];
    for (let fi = 0; fi < count; fi++) {
      assignedIds.push(pid++);
    }
    skillToPromptIds.set(skills[si].name, assignedIds);
  }

  // Rebuild expected array in prompt id order (prompts are shuffled by id)
  for (const p of prompts) {
    const targetSkill = [...skillToPromptIds.entries()].find(([, ids]) => ids.includes(p.id));
    expected[p.id - 1] = { id: p.id, expected: targetSkill ? targetSkill[0] : 'unknown' };
  }

  return { prompts, expected };
}

/**
 * Load skills from a directory (mirrors the benchmark loader).
 */
async function loadSkillsFromDir(dir) {
  const skills = [];
  async function walk(d) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name === 'SKILL.md') {
        try {
          const content = await readFile(full, 'utf-8');
          const fmMatch = content.match(/^---\s*\n([\s\S]+?)\n---\s*\n?/);
          if (fmMatch) {
            const body = fmMatch[1].replace(/\r/g, '');
            const result = {};
            let currentKey = null;
            let currentList = [];
            for (const line of body.split('\n')) {
              const listMatch = line.match(/^\s*-\s+(.+)$/);
              if (listMatch && currentKey) {
                currentList.push(listMatch[1].trim());
                continue;
              }
              if (currentKey && currentList.length > 0) {
                result[currentKey] = currentList;
                currentList = [];
              }
              const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
              if (kvMatch) {
                const key = kvMatch[1];
                const value = kvMatch[2].trim();
                if (value === '') {
                  currentKey = key;
                  currentList = [];
                } else {
                  result[key] = value;
                  currentKey = null;
                }
              }
            }
            if (currentKey && currentList.length > 0) result[currentKey] = currentList;
            skills.push({
              name: result.name || 'unknown',
              description: result.description || '',
              keywords: Array.isArray(result.keywords) ? result.keywords : [],
              domains: Array.isArray(result.domains) ? result.domains : [],
              path: full,
              version: result.version || '0.1.0',
            });
          }
        } catch {}
      }
    }
  }
  await walk(dir);
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

// ── CLI parsing ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  let count = 200;
  let seed = 42;
  let outDir = resolve('data/skills-synthetic');

  for (let i = 0; i < args.length; i++) {
    if (/^\d+$/.test(args[i])) {
      count = parseInt(args[i], 10);
    } else if (args[i] === '--seed' && i + 1 < args.length) {
      seed = parseInt(args[++i], 10);
    } else if (args[i] === '--out' && i + 1 < args.length) {
      outDir = resolve(args[++i]);
    }
  }
  return { count, seed, outDir };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { count, seed, outDir } = parseArgs(process.argv);
  const rng = mulberry32(seed);

  // Load existing skill names to avoid collisions
  const existingNames = await loadExistingNames();

  // Collect all (domain, template) pairs
  const domainNames = Object.keys(DOMAIN_TEMPLATES);
  const allPairs = [];
  for (const domain of domainNames) {
    const templates = DOMAIN_TEMPLATES[domain];
    for (let i = 0; i < templates.length; i++) {
      allPairs.push({ domain, template: templates[i] });
    }
  }

  // Shuffle pairs deterministically using the PRNG so order is random but reproducible
  for (let i = allPairs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [allPairs[i], allPairs[j]] = [allPairs[j], allPairs[i]];
  }

  // Generate skills, cycling through pairs until we have enough
  let generated = 0;
  let pairIndex = 0;
  let skippedDuplicates = 0;
  // Track all generated names across iterations to prevent reuse
  const usedNames = new Set([...existingNames]);

  while (generated < count) {
    const { domain, template } = allPairs[pairIndex % allPairs.length];

    // Quality tier based on RNG
    const roll = rng();
    let quality, description, keywords;
    if (roll < 0.70) {
      quality = 'good';
      description = template.desc_good;
      keywords = [...template.kw_good];
    } else if (roll < 0.90) {
      quality = 'mediocre';
      description = `Handle ${template.type.replace(/-/g, ' ')} tasks in the application.`;
      keywords = template.kw_med;
    } else {
      quality = 'weak';
      description = `Deals with ${template.type.replace(/-/g, ' ')}.`;
      keywords = template.kw_weak;
    }

    // Domains: primary domain + optional secondary
    const domains = [domain];
    if (rng() < 0.3) {
      const secondaries = ['meta', 'security', 'devops', 'testing'].filter((d) => d !== domain);
      domains.push(pick(rng, secondaries));
    }

    // Instructions
    const numInstructions = 3 + Math.floor(rng() * 3);
    const shuffledInstructions = shuffleArr(rng, INSTRUCTIONS).slice(0, numInstructions);

    const bodyLines = [
      '',
      '## When to use',
      '',
      `Use when working with ${template.type.replace(/-/g, ' ')} in your project.`,
      '',
      '## Instructions',
      '',
      ...shuffledInstructions.map((inst, i) => `${i + 1}. ${inst}`),
    ];

    const baseName = template.type;

    // Find a unique name
    let finalName = baseName;
    let attempt = 2;
    while (usedNames.has(finalName)) {
      finalName = `${baseName}-${attempt}`;
      attempt++;
      skippedDuplicates++;
    }
    usedNames.add(finalName);

    const frontmatter = [
      '---',
      `name: ${finalName}`,
      `description: ${description}`,
      'keywords:',
      ...keywords.map((kw) => `  - ${kw}`),
      'domains:',
      ...domains.map((d) => `  - ${d}`),
      '---',
    ].join('\n');

    const body = bodyLines.join('\n');
    const fullContent = frontmatter + '\n' + body;

    // Write SKILL.md to data/skills-synthetic/<domain>/<finalName>/SKILL.md
    const skillDir = resolve(outDir, domain, finalName);
    await mkdir(skillDir, { recursive: true });
    await writeFile(resolve(skillDir, 'SKILL.md'), fullContent, 'utf-8');

    generated++;
    pairIndex++;
  }

  console.log(`Generated ${generated} synthetic skills in ${outDir} (seed=${seed})`);
  if (skippedDuplicates > 0) {
    console.log(`  Skipped ${skippedDuplicates} duplicate names`);
  }
  console.log(`  Domains used: ${domainNames.length}`);

  // ── Load generated skills and create matching prompts ────────────────────
  const skills = await loadSkillsFromDir(outDir);
  const { prompts, expected } = generatePrompts(skills, rng);

  const promptsPath = resolve(outDir, 'prompts.json');
  const expectedPath = resolve(outDir, 'expected-routes.json');
  await writeFile(promptsPath, JSON.stringify(prompts, null, 2), 'utf-8');
  await writeFile(expectedPath, JSON.stringify(expected, null, 2), 'utf-8');

  // Also write a canonical copy into tests/scale/ for direct reference
  const scaleDir = resolve(BASE, 'tests/scale');
  await mkdir(scaleDir, { recursive: true });
  await writeFile(resolve(scaleDir, 'synthetic-prompts.json'), JSON.stringify(prompts, null, 2), 'utf-8');
  await writeFile(resolve(scaleDir, 'synthetic-expected.json'), JSON.stringify(expected, null, 2), 'utf-8');

  console.log(`  Generated ${prompts.length} synthetic prompts → ${promptsPath}`);
  console.log(`  Generated ${expected.length} expected routes → ${expectedPath}`);
  console.log(`  Prompts per skill: ~${Math.round(prompts.length / skills.length)}`);
}

main().catch((err) => {
  console.error('Generator failed:', err);
  process.exit(1);
});
