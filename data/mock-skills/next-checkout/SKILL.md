---
name: next-checkout
description: Next.js checkout flow implementation covering Server Components, payment gateway integration with Stripe, form validation with React Hook Form, and order state management
keywords:
  - Next.js
  - checkout flow
  - Stripe integration
  - Server Components
  - payment gateway
  - React Hook Form
  - order management
  - API routes
  - TypeScript
  - e-commerce
domains:
  - frontend
  - e-commerce
---

# Next.js Checkout Flow Implementation

## When to use
Reference this skill when building a production checkout experience in Next.js, integrating payment processors, or structuring order-related API routes.

## Instructions
1. Use Next.js App Router Server Components for initial checkout page renders to keep sensitive logic server-side and out of the client bundle.
2. Integrate Stripe Checkout or Elements via Stripe's client SDK after creating a server-side Session with Next.js API routes.
3. Validate all form inputs on the server with Zod or Yup through React Hook Form's resolver to prevent tampered payloads.
4. Store order state in a database (PostgreSQL or MongoDB) and reference it from a stable order ID returned by your payment provider.
5. Implement webhook handlers on /api/webhooks/stripe to reliably confirm payment intent and update order status server-side.
6. Use getServerSideProps or Server Actions for CSRF-safe form submissions that touch protected resources.
7. Show clear error states for declined cards, network timeouts, and duplicate order attempts with user-friendly retry flows.
8. Add rate limiting on checkout endpoints to prevent fraudulent bulk order attempts during peak traffic.
