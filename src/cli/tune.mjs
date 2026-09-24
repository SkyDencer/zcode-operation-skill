/**
 * Adaptive weight tuning CLI.
 *
 * Subcommands:
 *   tune --analyze   Compute proposed weights from benchmark attribution data
 *   tune --apply     Write weights.json, benchmark before/after, auto-rollback
 *   tune --rollback  Restore previous weights from latest snapshot
 *   tune --status    Show current weights, last applied timestamp, sample size
 *   tune --auto      Run analyze + apply in one step with guardrails
 *   tune --report    Print tuning history summary
 */
import { resolve } from 'node:path';
import { computeWeights } from '../core/retriever/weights.mjs';
import { loadBaseline, checkSafety } from './tune-guard.mjs';
import {
  loadCurrentWeights, latestSnapshot, buildAttributions,
  cmdApply as applyCore, cmdRollback as rollbackCore, cmdReport as reportCore,
} from './tune-core.mjs';

// ── ANSI color helpers ─────────────────────────────────────────────────────────

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
function bold(msg) { return `${BOLD}${msg}${RESET}`; }
function dim(msg) { return `${DIM}${msg}${RESET}`; }
function green(msg) { return `${GREEN}${msg}${RESET}`; }
function red(msg) { return `${RED}${msg}${RESET}`; }
function yellow(msg) { return `${YELLOW}${msg}${RESET}`; }

// ── Subcommands ────────────────────────────────────────────────────────────────

/**
 * --analyze: compute proposed weights and print analysis.
 */
function cmdAnalyze(opts) {
  const threshold = opts.threshold ?? 20;

  const currentWeights = loadCurrentWeights();
  const { attributions, counts, dominantCounts } = buildAttributions(130);
  const weightUpdate = computeWeights(attributions, currentWeights, { minOutcomes: threshold });

  console.log('');
  console.log(bold('Tuning Analysis'));
  console.log('='.repeat(50));
  console.log(`Benchmark samples  : ${attributions.length}`);
  console.log(`  ${green('positive')}  : ${counts.positive}`);
  console.log(`  ${red('negative')}  : ${counts.negative}`);
  console.log(`  ${yellow('unknown')} : ${counts.unknown}`);
  console.log('');
  console.log(bold('Field Attribution'));
  console.log('-'.repeat(50));
  for (const [field, count] of Object.entries(dominantCounts)) {
    console.log(`  ${field.padEnd(12)}: ${count}`);
  }
  console.log('');
  console.log(bold('Proposed Weights'));
  console.log('-'.repeat(50));
  console.log(`  sampleSize   : ${weightUpdate.sampleSize}`);
  console.log(`  changed      : ${weightUpdate.changed ? 'yes' : 'no'}`);
  console.log(`  reason       : ${weightUpdate.reason}`);
  if (weightUpdate.changed) {
    for (const field of ['name', 'description', 'keywords']) {
      console.log(`  ${field.padEnd(12)}: ${currentWeights[field].toFixed(2)} → ${(weightUpdate.newWeights[field]).toFixed(2)}`);
    }
  }
  console.log('');
}

/**
 * --auto: analyze then apply.
 */
async function cmdAuto(opts) {
  const threshold = opts.threshold ?? 20;
  const dryRun = opts.dryRun ?? false;

  console.log('');
  console.log(bold('Auto Tuning'));
  console.log('='.repeat(50));
  console.log(`Threshold      : ${threshold} outcomes`);
  console.log(`Dry-run        : ${dryRun ? 'yes' : 'no'}`);
  console.log('');

  cmdAnalyze({ threshold });

  if (dryRun) {
    console.log(bold('Dry-run mode — simulating apply...'));
    const currentWeights = loadCurrentWeights();
    const { attributions } = buildAttributions(130);
    const weightUpdate = computeWeights(attributions, currentWeights, { minOutcomes: threshold });
    const proposed = weightUpdate.changed ? weightUpdate.newWeights : currentWeights;
    const baseline = loadBaseline();
    const guard = checkSafety(proposed, baseline);
    console.log(`Guardrail      : ${guard.action} — ${guard.reason}`);
    console.log('');
    console.log(dim('No changes were applied (dry-run).'));
  } else {
    await applyCore(opts);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

export function main(argv) {
  let subcommand = null;
  const opts = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--analyze') subcommand = 'analyze';
    else if (arg === '--apply') subcommand = 'apply';
    else if (arg === '--rollback') subcommand = 'rollback';
    else if (arg === '--status') subcommand = 'status';
    else if (arg === '--auto') subcommand = 'auto';
    else if (arg === '--report') subcommand = 'report';
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--threshold' && argv[i + 1]) {
      const v = parseInt(argv[++i], 10);
      opts.threshold = Number.isNaN(v) || v < 1 ? 20 : v;
    } else if (arg === '--json') opts.json = true;
  }

  if (!subcommand) {
    console.log('Usage: node bin/skill-router.mjs tune [--analyze|--apply|--rollback|--status|--auto|--report] [options]');
    console.log('');
    console.log('Subcommands:');
    console.log('  --analyze    Read benchmark data, compute proposed weights (does NOT apply)');
    console.log('  --apply      Write weights, run benchmark before/after, auto-rollback on regression');
    console.log('  --rollback   Restore previous weights from latest snapshot');
    console.log('  --status     Show current weights, last applied timestamp, sample size');
    console.log('  --auto       Run analyze + apply in one step with guardrails');
    console.log('  --report     Print tuning history summary');
    console.log('');
    console.log('Options:');
    console.log('  --dry-run    Preview changes without applying');
    console.log('  --threshold N  Minimum outcomes required (default 20)');
    console.log('  --json       Output results as JSON');
    process.exit(1);
  }

  (async () => {
    try {
      switch (subcommand) {
        case 'analyze': cmdAnalyze(opts); break;
        case 'apply': await applyCore(opts); break;
        case 'rollback': rollbackCore(); break;
        case 'status': {
          const weights = loadCurrentWeights();
          const snapshot = latestSnapshot();
          const baseline = loadBaseline();
          const { counts } = buildAttributions(130);
          console.log('');
          console.log(bold('Tuning Status'));
          console.log('='.repeat(50));
          console.log('Current Weights:');
          console.log(`  name         : ${weights.name}`);
          console.log(`  description  : ${weights.description}`);
          console.log(`  keywords     : ${weights.keywords}`);
          console.log('');
          if (snapshot) {
            console.log(`Last Applied   : ${snapshot}`);
          } else {
            console.log('Last Applied   : never');
          }
          if (baseline) {
            console.log(`Baseline Top-1 : ${(baseline.top1 * 100).toFixed(2)}%`);
            console.log(`Baseline At    : ${baseline.baselineAt}`);
          }
          console.log(`Attributions   : ${counts.positive + counts.negative} outcomes (pos: ${counts.positive}, neg: ${counts.negative})`);
          console.log('');
          break;
        }
        case 'auto': await cmdAuto(opts); break;
        case 'report': reportCore(); break;
        default:
          console.error(`Unknown tune subcommand: ${subcommand}`);
          process.exit(1);
      }
    } catch (err) {
      console.error(red(`Error: ${err.message}`));
      process.exit(1);
    }
  })();
}
