/**
 * SLM client barrel export.
 *
 * Re-exports everything from the slm/ subdirectory so consumers can write:
 *   import { SlmClient, SlmError, SlmTimeoutError, SlmUnavailableError } from '@/core/slm';
 *   import { parseMultiSelection, parseSingleSelection } from '@/core/slm';
 *   import { buildMultiSelectorPrompt, buildSelectorPrompt } from '@/core/slm';
 */

export { SlmClient, default } from './client.mjs';
export { SlmError, SlmTimeoutError, SlmUnavailableError } from './errors.mjs';
export { parseMultiSelection, parseSingleSelection } from './parser.mjs';
export { buildMultiSelectorPrompt, buildSelectorPrompt, EmptyTaskError, EmptyCandidatesError } from './prompt-builder.mjs';
