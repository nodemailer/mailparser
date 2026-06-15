# Security Policy

mailparser is an email parsing library for Node.js. It is routinely pointed at
untrusted, adversarial, and malformed messages, so parser robustness is a
security concern: a crafted message should never be able to crash the host
process, exhaust memory or CPU, pollute prototypes, or leak data across parses.
We take security reports seriously and aim to respond quickly.

## Supported Versions

Security fixes are released only against the latest version. We do not backport
patches to older releases - upgrading to the current 3.x release line is the
supported way to receive security updates.

| Version | Supported          |
| ------- | ------------------ |
| 3.x     | :white_check_mark: |
| < 3.0   | :x:                |

If you are on an older version, please upgrade. See the release notes at
<https://github.com/nodemailer/mailparser/releases> before updating.

> [!NOTE]
> mailparser is in maintenance mode - it receives security updates and critical
> bug fixes only. For new projects, consider
> [PostalMime](https://github.com/postalsys/postal-mime), which works in both
> Node.js and browser environments.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
pull requests, or discussions.**

Report privately through one of the following channels:

1. **GitHub Security Advisories (preferred).** Open a private report at
   <https://github.com/nodemailer/mailparser/security/advisories/new>. This keeps
   the discussion private until a fix is published and lets us credit you.
2. **Email.** Send details to **andris@postalsys.com** (the contact listed in
   [`SECURITY.txt`](SECURITY.txt)). Encrypt sensitive details if possible - our
   PGP key fingerprint is `5D952A46E1D8C931F6364E01DC6C83F4D584D364`.

When reporting, please include as much of the following as you can:

- The affected version(s) and environment (mailparser version, Node.js version,
  OS).
- A clear description of the issue and its impact (e.g. denial of service via
  CPU or memory exhaustion, ReDoS, prototype pollution, unhandled exception that
  crashes the process, information disclosure between parses).
- A minimal proof of concept - ideally the raw `.eml` sample or a short script
  that reproduces the issue.
- Any suggested remediation, if you have one.

We are a small team, so there is no guaranteed response time - sometimes reports
are handled within hours, sometimes they take longer. Accepted issues are fixed
in a new release and coordinated through a GitHub Security Advisory, and
reporters who wish to be named are credited.

## CVEs

We track and disclose vulnerabilities through GitHub Security Advisories. We do
not request or manage CVE identifiers ourselves. If you need a CVE assigned for a
reported issue, please request one yourself - for example, through GitHub's own
CVE request flow on the published advisory, or another CNA.

## Scope

In scope: the mailparser library source in this repository - the streaming MIME
parser (`MailParser`), the convenience parser (`simpleParser`), header and
address decoding, charset/transfer-encoding handling, and attachment and HTML/
text extraction. Of particular interest are inputs that cause unbounded resource
consumption, catastrophic regular-expression backtracking, prototype pollution,
or process crashes.

Out of scope:

- Vulnerabilities in your own application code that consumes mailparser output.
  Parsed email content is attacker-controlled data; you must sanitize and escape
  it before rendering, storing, or executing it. In particular, the `html` field
  is not sanitized for safe display in a browser.
- Vulnerabilities in third-party dependencies that are already tracked and fixed
  upstream - report those to the respective project (we will still bump the
  dependency once a fix is available).
- Issues that require an already-compromised host or a malicious local
  environment.
- Resource consumption that is proportional to a legitimately large input (for
  example, parsing a genuine 100MB message uses memory) rather than amplified by
  a crafted small input.

Thank you for helping keep mailparser and its users safe.
