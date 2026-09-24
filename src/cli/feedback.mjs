/**
 * feedback — Show routing feedback summary from decision logs.
 *
 * Usage: node bin/skill-router.mjs feedback [--since YYYY-MM-DD] [--limit N] [--json] [--export <path>] [--outcomes]
 */
import { resolve } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import { readDecisions, summarize } from '../telemetry/feedback.mjs';
import { correlateFromLogs } from '../telemetry/outcomes.mjs';
import { attributeOutcome } from '../core/retriever/attribution.mjs';
import { computeWeights } from '../core/retriever/weights.mjs';
import { getDefaults } from '../config/defaults.mjs';

// ── ANSI color helpers ────────────────────────────────────────────────────────

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function bold(msg) {
  return `${BOLD}${msg}${RESET}`;
}
function dim(msg) {
  return `${DIM}${msg}${RESET}`;
}
function green(msg) {
  return `${GREEN}${msg}${RESET}`;
}
function red(msg) {
  return `${RED}${msg}${RESET}`;
}
function yellow(msg) {
  return `${YELLOW}${msg}${RESET}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function main(argv) {
  let since = null;
  let limit = 300;
  let json = false;
  let exportPath = null;
  let outcomes = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--since' && argv[i + 1]) {
      since = argv[++i];
    } else if (argv[i] === '--limit' && argv[i + 1]) {
      limit = parseInt(argv[++i], 10);
    } else if (argv[i] === '--json') {
      json = true;
    } else if (argv[i] === '--export' && argv[i + 1]) {
      exportPath = resolve(argv[++i]);
    } else if (argv[i] === '--outcomes') {
      outcomes = true;
    }
  }

  if (Number.isNaN(limit) || limit < 1) limit = 300;

  const decisions = await readDecisions({ since, limit });
  const summary = summarize(decisions);

  if (outcomes) {
    await printOutcomes(decisions, json);
    return;
  }

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printHuman(summary, decisions);
  }

  if (exportPath) {
    writeCSV(exportPath, decisions);
    if (!json) {
      console.log(`\nExported ${decisions.length} decisions to ${exportPath}`);
    }
  }
}

/**
 * Print outcome correlation summary with field attribution and weight recommendations.
 *
 * @param {Array} decisions
 * @param {boolean} json
 */
async function printOutcomes(decisions, json) {
  // correlateFromLogs(decisions, opts) reads signals from opts.logDir. Passing
  // the log dir explicitly (same default the library uses) keeps the CLI and the
  // library in step: without it, readdir(undefined) fails, no signals are read,
  // and every decision is misclassified as "positive".
  const outcomes = await correlateFromLogs(decisions, { logDir: resolve('logs') });

  const positive = outcomes.filter((o) => o.outcome === 'positive').length;
  const negative = outcomes.filter((o) => o.outcome === 'negative').length;
  const unknown = outcomes.filter((o) => o.outcome === 'unknown').length;

  // Build attributions from outcomes (requires prompt text from decisions)
  let attributions = null;
  let weightUpdate = null;
  try {
    const index = JSON.parse(readFileSync('data/skill-index.json', 'utf-8'));
    const leafIndex = index.filter((s) => !s.name.startsWith('router-'));
    attributions = outcomes
      .map((o) => {
        const decision = decisions.find((d) => d.promptHash === o.decisionHash);
        if (!decision || !decision.prompt) return null;
        return attributeOutcome(decision, o.outcome, leafIndex);
      })
      .filter((a) => a !== null);

    const defaults = getDefaults();
    weightUpdate = computeWeights(attributions, {
      name: defaults.bm25.nameWeight,
      description: defaults.bm25.descriptionWeight,
      keywords: defaults.bm25.keywordWeight,
    });
  } catch {
    // Index missing or parse error — attribution is optional
  }

  if (json) {
    const negativeDetails = outcomes
      .filter((o) => o.outcome === 'negative')
      .slice(0, 5)
      .map((o) => ({
        decisionHash: o.decisionHash,
        reason: o.reason,
        mode: o.decision.mode,
        tier: o.decision.tier,
        selectedSkills: o.decision.selectedSkills,
        confidence: o.decision.confidence,
        latencyMs: o.latencyMs,
      }));
    const result = { positive, negative, unknown, total: outcomes.length, negatives: negativeDetails };
    if (attributions && attributions.length > 0) {
      result.attributions = {
        sampleSize: attributions.length,
        dominantFieldCounts: { name: 0, description: 0, keywords: 0 },
        weightUpdate: weightUpdate ?? null,
      };
      for (const a of attributions) {
        if (a.dominantField) {
          result.attributions.dominantFieldCounts[a.dominantField]++;
        }
      }
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('');
  console.log(bold('Outcome Correlation'));
  console.log('='.repeat(40));
  console.log('');
  console.log(`Total decisions analysed: ${outcomes.length}`);
  console.log(`  ${green('positive')}  : ${positive}`);
  console.log(`  ${red('negative')}  : ${negative}`);
  console.log(`  ${yellow('unknown')} : ${unknown}`);
  console.log('');

  if (attributions && attributions.length > 0) {
    const counts = attributions.reduce(
      (acc, a) => {
        if (a.dominantField) acc[a.dominantField]++;
        return acc;
      },
      { name: 0, description: 0, keywords: 0 }
    );
    console.log(bold('Field Attribution (' + attributions.length + ' outcomes):'));
    console.log(`  name         : ${counts.name}`);
    console.log(`  description  : ${counts.description}`);
    console.log(`  keywords     : ${counts.keywords}`);
    console.log('');

    if (weightUpdate && weightUpdate.changed) {
      console.log(bold('Recommended Weight Adjustment:'));
      console.log(`  name         : ${(weightUpdate.newWeights.name).toFixed(2)} (was ${getDefaults().bm25.nameWeight})`);
      console.log(`  description  : ${(weightUpdate.newWeights.description).toFixed(2)} (was ${getDefaults().bm25.descriptionWeight})`);
      console.log(`  keywords     : ${(weightUpdate.newWeights.keywords).toFixed(2)} (was ${getDefaults().bm25.keywordWeight})`);
      console.log(`  reason       : ${weightUpdate.reason}`);
      console.log('');
    } else if (weightUpdate) {
      console.log(`Weight adjustment: ${weightUpdate.reason} (sample size: ${weightUpdate.sampleSize})`);
      console.log('');
    }
  }

  if (negative > 0) {
    console.log(bold('Top missed decisions (negative outcomes):'));
    const negatives = outcomes.filter((o) => o.outcome === 'negative').slice(0, 5);
    for (let i = 0; i < negatives.length; i++) {
      const o = negatives[i];
      console.log(`  ${i + 1}. ${o.reason}`);
      console.log(`     hash: ${o.decisionHash.slice(0, 20)}...`);
      console.log(`     mode: ${o.decision.mode}, tier: ${o.decision.tier}`);
      console.log(`     skills: ${o.decision.selectedSkills.join(', ') || '(none)'}`);
      console.log('');
    }
  }
}

/**
 * Print human-readable summary.
 */
function printHuman(summary, decisions) {
  // Determine date range
  let sinceDate = null;
  let untilDate = null;
  if (decisions.length > 0) {
    sinceDate = decisions[0].ts.slice(0, 10);
    untilDate = decisions[decisions.length - 1].ts.slice(0, 10);
  }

  console.log('');
  console.log(bold('Routing Feedback Summary'));
  console.log('='.repeat(40));
  console.log('');

  const period = sinceDate && untilDate && sinceDate !== untilDate
    ? `${sinceDate} to ${untilDate}`
    : sinceDate ?? 'no data';
  console.log(`Period: ${period}`);
  console.log(`Total decisions: ${summary.totalCount}`);
  console.log('');

  // By mode
  console.log('By mode:');
  const totalMode = summary.byMode.explicit + summary.byMode.implicit;
  if (totalMode > 0) {
    const expPct = ((summary.byMode.explicit / totalMode) * 100).toFixed(1);
    const impPct = ((summary.byMode.implicit / totalMode) * 100).toFixed(1);
    console.log(`  explicit  : ${summary.byMode.explicit} (${expPct}%)`);
    console.log(`  implicit  : ${summary.byMode.implicit} (${impPct}%)`);
  } else {
    console.log('  (none)');
  }
  console.log('');

  // By tier
  console.log('By tier:');
  const totalTier = Object.values(summary.byTier).reduce((s, v) => s + v, 0);
  if (totalTier > 0) {
    for (const tier of ['bm25', 'slm', 'hybrid', 'none']) {
      const count = summary.byTier[tier] ?? 0;
      const pct = ((count / totalTier) * 100).toFixed(1);
      console.log(`  ${tier.padEnd(8)}: ${count} (${pct}%)`);
    }
  } else {
    console.log('  (none)');
  }
  console.log('');

  // By router (top 6)
  console.log('By router (top 6):');
  const routerEntries = Object.entries(summary.byRouter).sort((a, b) => b[1] - a[1]);
  const shown = routerEntries.slice(0, 6);
  for (const [router, count] of shown) {
    console.log(`  ${router.padEnd(16)}: ${count}`);
  }
  if (routerEntries.length > 6) {
    const rest = routerEntries.slice(6).reduce((s, [, c]) => s + c, 0);
    console.log(`  ${'(other)'.padEnd(16)}: ${rest}`);
  }
  console.log('');

  // Top selected skills
  console.log('Top selected skills:');
  if (summary.topSkills.length > 0) {
    for (let i = 0; i < Math.min(summary.topSkills.length, 10); i++) {
      const { name, count } = summary.topSkills[i];
      console.log(`  ${String(i + 1).padStart(2)}. ${name.padEnd(32)} (${count})`);
    }
  } else {
    console.log('  (none)');
  }
  console.log('');

  // Latency
  console.log('Latency:');
  console.log(`  p50 : ${summary.p50Latency}ms`);
  console.log(`  p95 : ${summary.p95Latency}ms`);
  console.log(`  max : ${summary.maxLatency}ms`);
  console.log('');

  // Fallback rate
  console.log(`Fallback rate: ${summary.fallbackRate}%`);
  console.log('');
}

/**
 * Write decisions to CSV.
 */
function writeCSV(path, decisions) {
  const header = 'ts,mode,router,tier,confidence,promptHash,sessionId,selectedSkills';
  const rows = [header];
  for (const d of decisions) {
    const row = [
      d.ts,
      d.mode,
      d.router ?? '',
      d.tier,
      d.confidence,
      d.promptHash,
      d.sessionId ?? '',
      (d.selectedSkills || []).join('|'),
    ];
    rows.push(row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  writeFileSync(path, rows.join('\n') + '\n', 'utf-8');
}
