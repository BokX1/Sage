# Security Audit Report

Date: 2026-02-06  
Scope: `/workspace/Sage` codebase (Discord bot + Prisma + CI config)

## Method
- Reviewed repository source and config files only (no assumptions about unshown infrastructure).
- Classified each checklist item as **Confirmed**, **Likely**, or **Not Applicable**.

## Findings by Checklist Item

1. **Missing API Rate Limiting** — **Not Applicable** (no public HTTP API). Bot message flow has channel and wakeword throttles (`isRateLimited`, `shouldAllowInvocation`).
2. **Exposed API Keys in Repos** — **Not Applicable** (no committed live secrets observed). Secrets are env-driven and `.env*` is gitignored.
3. **Unrestricted Bot Registration** — **Not Applicable** (no registration endpoint present).
4. **Privileged Secrets in Frontend Bundles** — **Not Applicable** (no frontend bundle).
5. **Outdated Dependencies** — **Likely** (could not verify advisories due `npm audit` 403; versions are pinned only by semver ranges in `package.json`).
6. **Missing Row Level Security (RLS)** — **Likely** (Prisma schema has no DB-level RLS policy definitions in repo).
7. **Hardcoded Default Credentials** — **Likely** (`POSTGRES_PASSWORD: password` in compose; sample DB URL also uses `password`).
8. **Verbose Error Information Leakage** — **Confirmed** (`llm_ping` returns raw `(e as Error).message` to users).
9. **Shared Environment Infrastructure** — **Not Applicable** (no deployment/account topology shown).
10. **Client-Side Input Validation Only** — **Not Applicable** (no browser client).
11. **Public .git Directory Exposure** — **Not Applicable** (no web server config in scope).
12. **Debug Mode Enabled in Production** — **Likely** (`NODE_ENV` accepts production/dev/test, but no enforcement that production deploy sets production values).
13. **Wildcard CORS Configuration** — **Not Applicable** (no HTTP API/CORS middleware).
14. **Missing CSRF Protection** — **Not Applicable** (no cookie-authenticated web forms).
15. **Leaked Secrets in Git History** — **Not Applicable** (cannot confirm from working tree alone).
16. **Insecure Session Storage** — **Not Applicable** (no browser session storage logic).
17. **Unrestricted File Uploads** — **Not Applicable** (no server upload endpoint).
18. **Unsanitized LLM Integration** — **Not Applicable** (user input is placed in `user` role, not concatenated into core system instruction directly).
19. **Unencrypted Sensitive Data at Rest** — **Likely** (`pollinationsApiKey` persisted as plaintext nullable string in DB models).
20. **Fragile Networking Logic (DoS)** — **Likely** (some broad catches exist, but no process-manager resilience/config shown).
21. **Client-Side Cryptographic Signing** — **Not Applicable** (no frontend signing flow).
22. **Homebrewed Cryptography** — **Not Applicable** (no custom crypto primitive found).
23. **Prototype Pollution in Server Actions** — **Not Applicable** (not a Next.js server-actions app).
24. **Sensitive Data Exposure in Logs** — **Likely** (logger redacts common keys, but many `logger.error({ error })` calls may still serialize sensitive external error text).
25. **Missing Multi-Factor Authentication (MFA)** — **Not Applicable** (no local account system).
26. **Path Traversal (LFI)** — **Not Applicable** (no file-serving path from user-controlled filesystem path).
27. **Missing Dependency Lockfiles** — **Not Applicable** (`package-lock.json` exists in repo).
28. **Overprivileged Container Execution** — **Likely** (compose uses official Postgres image; no Dockerfile/non-root hardening shown for app runtime).
29. **Missing Content Security Policy (CSP)** — **Not Applicable** (no browser app/server responses).
30. **Plaintext Password Storage** — **Not Applicable** (no password auth table/flow present).
31. **Insecure RPC Parameter Exposure** — **Not Applicable** (no RPC endpoint surface).
32. **AI Dependency Hallucination** — **Not Applicable** (cannot be validated post-hoc from code alone).
33. **Unbounded Payload Processing (DoS)** — **Not Applicable** for sockets (none). Attachment fetch path does enforce max bytes/chars.
34. **Insecure Infrastructure as Code (IaC)** — **Likely** (`5432:5432` exposed in compose, weak for non-local use).
35. **Insecure Object Deserialization** — **Not Applicable** (no pickle/ObjectInputStream usage).
36. **IDE Workspace Trust Execution** — **Not Applicable** (developer workstation setting, not code artifact).
37. **Missing HTTP Security Headers** — **Not Applicable** (no HTTP server shown).
38. **Memory Safety Violations (Buffer Overflow)** — **Not Applicable** (TypeScript codebase).
39. **Server-Side Request Forgery (SSRF)** — **Likely** (`fetchAttachmentText` fetches URL input without explicit host/IP allowlist; relies on caller trust).
40. **Unencrypted Traffic (HTTP)** — **Not Applicable** for app serving (no HTTP server). External URLs shown are HTTPS.
41. **AI-Induced Race Conditions** — **Not Applicable** (no payment/balance transaction logic).
42. **Missing Route-Level Authorization** — **Not Applicable** (no HTTP routes). Discord admin commands do include permission checks.
43. **Public Cloud Storage Buckets** — **Not Applicable** (no bucket policy/IaC present).
44. **Unsanitized DOM Injection (XSS)** — **Not Applicable** (no DOM-rendering frontend).
45. **Unprotected Attribute Injection** — **Not Applicable** (no generic JSON-to-model update endpoint).
46. **Broken Object Level Authorization (BOLA)** — **Likely** (`whoiswho` allows any guild member to request relationship data for arbitrary user IDs; no ownership check).
47. **Publicly Exposed Database Port** — **Likely** (compose publishes Postgres to host `5432:5432`).
48. **Unverified JWT Signatures** — **Not Applicable** (no JWT auth flow found).
49. **Weak Randomness in Security Contexts** — **Not Applicable** (`Math.random` only used for image seed, not security token).
50. **Missing Secrets Rotation Strategy** — **Likely** (no rotation mechanism/config documented in code).
51. **NoSQL Injection in AI-Generated Queries** — **Not Applicable** (Prisma/Postgres, no Mongo query operators).
52. **Timing-Based Information Disclosure** — **Not Applicable** (no username/password login function).
53. **Type Juggling and Coercion** — **Not Applicable** for security checks observed (critical checks use explicit boolean logic/ID includes).
54. **AI-Automated CAPTCHA Bypass** — **Not Applicable** (no web registration/login CAPTCHA flow).
55. **Dependency Confusion Attack** — **Likely** (no scoped private-registry config like `.npmrc` shown).
56. **Unicode Case Mapping Collisions** — **Not Applicable** (no account recovery/email uniqueness flow).
57. **Dynamic Code Execution (Eval)** — **Not Applicable** (`eval/new Function` not present).
58. **Weak JWT Secret Constants** — **Not Applicable** (no JWT signing secret usage).
59. **Middleware Security Bypass** — **Not Applicable** (no web middleware routing).
60. **Insecure Temporary File Creation** — **Likely** (`onboard.ts` writes temp file then renames; permissions set, but randomness/atomicity assumptions and shared path risks remain if repo path is attacker-controlled).
61. **Open Redirect Vulnerability** — **Not Applicable** (no user-controlled redirect endpoint).
62. **JWT Algorithm Confusion** — **Not Applicable** (no JWT verification path).

## Confirmed / Likely Exploit Paths (required)

### Confirmed
- **#8 Verbose Error Information Leakage**: A user invoking `/llm_ping` receives raw error message text from caught exception, potentially exposing upstream API/internal failure details useful for reconnaissance.

### Likely
- **#5 Outdated Dependencies**: If vulnerable versions are resolved by semver ranges, known CVEs could be present until explicitly upgraded/locked.
- **#6 Missing RLS**: If application bugs expose broader queries, DB lacks demonstrated row-level policies to enforce tenant separation at database layer.
- **#7 Hardcoded Default Credentials**: If CI/dev compose is exposed beyond localhost, default DB password is brute-forceable.
- **#19 Unencrypted Sensitive Data at Rest**: DB compromise exposes stored Pollinations API keys in plaintext.
- **#24 Sensitive Data in Logs**: Exception objects may include request metadata or upstream payload fragments despite redaction patterns.
- **#28/#34/#47 Container/DB Exposure**: Publishing DB port and weak compose posture can expose Postgres to unauthorized network access if host firewall is permissive.
- **#39 SSRF**: If attacker can influence `url` input path to internal addresses, bot process can make internal requests.
- **#46 BOLA-style access**: Any guild user can query relationship data about other users via command argument selection.
- **#50 Missing secrets rotation**: Long-lived static keys increase blast radius after key compromise.
- **#55 Dependency confusion**: Without private scope/registry constraints, internal package naming conflicts can be abused in CI environments.
- **#60 Temp file creation**: Predictable temp-file workflow in shared filesystem scenarios can enable race/symlink abuse.
