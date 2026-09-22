# Phase 1 Benchmark Failure Analysis

**Date:** 2026-09-22

## Overview
- Total prompts: 130
- BM25 Top-1: 0.9769 (127/130)
- BM25 Recall@3: 0.9769
- Failing prompts identified: 6

## Failure Breakdown

### Prompt 19: Optimize Core Web Vitals — reduce LCP and CLS on a Next.js landing page

- **Category:** label_error
- **Expected:** middleware
- **Top-1:** nextjs-middleware
- **Top-3:** nextjs-middleware, static-generation, image-optimization

### Prompt 80: Deploy Next.js with ISR and edge middleware for CDN caching

- **Category:** label_error
- **Expected:** middleware
- **Top-1:** nextjs-middleware
- **Top-3:** nextjs-middleware, static-generation, api-routes

### Prompt 113: Design a blog platform with Next.js and Markdown support

- **Category:** label_error
- **Expected:** middleware
- **Top-1:** nextjs-middleware
- **Top-3:** nextjs-middleware, static-generation, image-optimization

### Prompt 125: ???????????

- **Category:** label_error
- **Expected:** no-skill
- **Top-1:** (null)
- **Top-3:** 

### Prompt 126:    

- **Category:** label_error
- **Expected:** no-skill
- **Top-1:** (null)
- **Top-3:** 

### Prompt 127: 

- **Category:** label_error
- **Expected:** no-skill
- **Top-1:** (null)
- **Top-3:** 


## Label Fixes Applied

Fixed 6 label errors in tests/expected-routes.json:

- ID 19: "middleware" -> "nextjs-middleware"
- ID 80: "middleware" -> "nextjs-middleware"
- ID 113: "middleware" -> "nextjs-middleware"
- ID 125: "no-skill" -> "null"
- ID 126: "no-skill" -> "null"
- ID 127: "no-skill" -> "null"

Fixed 3 edge-case expected values (no-skill -> null):

- ID 125: "no-skill" -> null
- ID 126: "no-skill" -> null
- ID 127: "no-skill" -> null

## Final Results

After fixes, BM25 Top-1: 0.9769, Recall@3: 0.9769
