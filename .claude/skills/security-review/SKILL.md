---
name: security-review
description: Use before proposing or writing changes to auth/the gate, form or webhook handling, user-supplied input, CSP/CORS, file uploads, external API calls, or credentials — walks the change against the OWASP Top 10.
---

# Security review

Before proposing or writing a change that touches any of the following, check it against
the relevant OWASP Top 10 (2021) categories — most changes here only ever implicate 2-3 of
them, so use judgment rather than mechanically restating all ten:

- Auth or the pre-launch gate
- Form or webhook submission handling (n8n endpoints, submission/contact/rating flows)
- Anything touching user-supplied input
- CSP/CORS configuration (`Caddyfile`, `widgetCors`)
- File or image uploads
- External API or webhook calls
- Session or credential handling

Given this app's shape (SvelteKit static build + n8n webhooks + Caddy, no SQL backend),
the categories actually worth checking against are almost always: **A01 Broken Access
Control**, **A03 Injection** (including XSS), **A05 Security Misconfiguration**, and
**A10 SSRF**. The others (crypto failures, vulnerable components, auth failures, integrity
failures, logging failures) are worth a glance but rarely the live risk here.

A secret scan (TruffleHog or similar) is worth running manually before a commit that
touches credentials or config — not something to assume is installed or run automatically.
