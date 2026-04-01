export const CTF_RECON_GUIDE = `# CTF Challenge Recon & Threat Model

Produce a structured threat model BEFORE any exploitation. The goal is to identify the most likely vulnerability class and attack chain within 15 minutes, not to exhaustively enumerate everything.

## Minute 0-1: Orientation

1. Read the challenge description. Note hints in the title, flavor text, category, and point value.
2. What are you given? URL only? Source code? Dockerfile? Docker-compose?
3. What is the **flag format** and **win condition**?
   - Read a file on the server?
   - Steal a cookie/token from a bot?
   - Access a restricted endpoint?
   - Exfiltrate from an internal service?

The win condition determines which vulnerability classes matter. Define it before looking for bugs.

## Minute 1-5: Source Code Review

If source is provided, **read it before touching the running instance**. Source is ground truth. This is the single highest-leverage activity.

### Architecture (Dockerfile / docker-compose first)
- What services exist, how are they networked, what's internal-only?
- Where is the flag? (file, env var, database, internal API)
- What permissions/user does each service run as?
- What volumes are shared between services?

### Code Review (prioritize entry points)
- List all routes/endpoints
- Trace every user input to where it's used (its "sink")
- **What's custom vs standard library?** The bug is in the custom part. If someone hand-rolls a URL parser, sanitizer, or auth check — that's the bug.
- **What's weird?** Unnecessary complexity, unusual tech choices, or things that don't belong point to the vulnerability. Ask: "Why did the author include THIS?"
- Check pinned dependency versions against CVE databases — specific old versions are often intentional.

### Win Condition Trace
- Starting from the flag, trace backwards: what code path reads it, what conditions gate access, what do you need to satisfy those conditions?

## Minute 5-10: Vulnerability Hypothesis

### Match input sinks to vulnerability classes

| Where does user input go? | Test for |
|---|---|
| Rendered in HTML | XSS (reflected, stored, DOM) |
| SQL query | SQL injection |
| OS command | Command injection |
| File path | Path traversal, LFI, symlink attacks |
| HTTP request (server-side) | SSRF |
| Template engine | SSTI |
| XML parser | XXE |
| Serialized object | Insecure deserialization |
| File extraction (tar/zip) | Symlink traversal, path traversal, TOCTOU |
| Authentication check | Auth bypass, JWT weakness, type juggling |
| Docker build / container | Image supply chain, sandbox escape, mount abuse |

### Match tech stack to common bug patterns

| Stack | Common bugs |
|---|---|
| PHP | Type juggling, deserialization, LFI, \`preg_replace /e\`, \`assert\` |
| Python/Flask | SSTI (Jinja2), pickle deser, \`os.path.join\` quirks, SSRF |
| Node/Express | Prototype pollution, NoSQL injection, \`vm\`/\`vm2\` escape, SSRF |
| Java/Spring | Deserialization, SSRF, XXE, SpEL/JNDI injection |
| Go | \`path.Clean\` vs \`filepath.Clean\`, SSRF, template injection (rare) |
| Ruby/Rails | Deserialization, SSTI (ERB), mass assignment |

### Architectural signals

| Signal | Likely vuln class |
|---|---|
| Bot/headless browser visits a URL | XSS or client-side attack |
| Internal-only service | SSRF to reach it |
| File upload/extraction | Path traversal, symlink, TOCTOU |
| Custom parsing or sanitization | Bypass the custom logic |
| Multiple services sharing state | Race condition, TOCTOU |
| Docker socket mounted | Container escape |
| Specific old dependency version | CVE for that version |

### Form your hypothesis
Pick the **single most likely** vulnerability class. Don't spray. If your hypothesis is wrong, you'll know quickly and can pivot.

## Minute 10-15: Confirm Hypothesis

1. **Test the simplest possible payload** for your hypothesis. Don't build a full exploit yet.
2. **Read the exact filtering/sanitization** from source. Understand what's allowed, not just what's blocked.
3. **Confirm the primitive works** before chaining.
4. If it doesn't work, return to the hypothesis step and try the next most likely class.

## When the Primitive Works: Build the Chain

Most CTF solves require **chaining** multiple primitives. Once you confirm a primitive, ask:

**"What can I reach from here that I couldn't before?"**

Build an attack tree from the goal backwards:

\`\`\`
GET FLAG
├── What access is needed? (read file / steal cookie / reach endpoint / get RCE)
│   ├── What primitive gives that access?
│   │   ├── Do I have that primitive already?
│   │   └── What primitive gives me THAT primitive? (chain deeper)
\`\`\`

### Common chain patterns

- **SSRF → internal service → flag**: SSRF to reach an internal-only flag endpoint
- **XSS → bot cookie/action → flag**: XSS to make the bot fetch the flag for you
- **File write → config corruption → code execution**: Write to linker config/cron/profile, wait for periodic process to execute
- **Open redirect → state injection → XSS**: Redirect bot to attacker domain, set \`window.name\`, redirect back, \`location=name\` triggers \`javascript:\` URI
- **Race condition → file replacement → changed behavior**: TOCTOU between check and use of a file path
- **Content type manipulation → code execution in different origin**: Platform features (e.g., presigned URLs) change how content is served/rendered

## When You're Stuck (30+ minutes on one approach)

STOP implementation. Return to this checklist:

- [ ] Am I attacking the right component? (The flag might be in a different container/origin than where I have execution)
- [ ] Am I ignoring a primitive because "I can't fully control it"? (Write primitives with uncontrolled content can still corrupt config files. Downloads can become rendered documents via platform features.)
- [ ] Is there a periodic process I haven't considered? (Healthchecks, cron, log rotation may have different security properties than the main process)
- [ ] Did I check what's actually happening at runtime? (\`strace -f -e trace=openat,connect,execve <process>\` reveals real behavior faster than source reading)
- [ ] Am I trying to do something directly that requires an indirect chain? (e.g., reading a file from a sandbox vs getting RCE in the container that has the file)
- [ ] Did I check all processes, not just the main one? (\`ldd\` on healthcheck binaries, cron scripts, entrypoint helpers)
- [ ] Is there a subdomain/domain relationship I can exploit? (\`document.domain\` relaxation, shared cookies)
- [ ] Does the hosting platform have features that change content delivery? (S3 presigned URL content-type override, CDN header manipulation)

## Knowledge Base Research (do this once you have a hypothesis)

Once you identify the vulnerability class, **search these resources** for techniques and payloads. Don't guess — look it up.

### For ANY vulnerability class
- Search \`github.com/swisskyrepo/PayloadsAllTheThings\` for the specific vuln type (e.g., "XSS Injection", "Server Side Request Forgery", "Server Side Template Injection"). Raw markdown files are directly fetchable.
- Search \`book.hacktricks.xyz/pentesting-web/<vuln-type>\` for exploitation walkthroughs.
- Search \`ctftime.org/writeups/\` for prior CTF writeups matching the challenge pattern.

### For browser/XSS challenges
Search for these specific topics based on what you need:

| If you need... | Search for |
|---|---|
| XSS in constrained context | \`site:portswigger.net XSS cheat sheet\` + \`PayloadsAllTheThings XSS filter bypass\` |
| Cross-origin data smuggling | \`window.name XSS cross-origin\` + \`MDN window.name\` |
| SOP relaxation between subdomains | \`document.domain SOP relaxation\` + \`MDN document.domain\` |
| Content type bypass on downloads | \`defeating content-disposition\` + \`S3 presigned URL ResponseContentType\` |
| Open redirect tricks | \`PayloadsAllTheThings Open Redirect\` + \`protocol-relative URL redirect\` |
| CSP bypass | \`book.hacktricks.xyz CSP bypass\` + \`PayloadsAllTheThings CSP\` |
| Prototype pollution | \`book.hacktricks.xyz prototype pollution\` + known gadgets for the specific library |
| DOM clobbering | \`book.hacktricks.xyz DOM clobbering\` + \`portswigger DOM clobbering\` |
| Browser-specific quirks | \`MDN <api-name>\` for authoritative behavior + browser bug trackers for edge cases |

### For infrastructure/container challenges
| If you need... | Search for |
|---|---|
| Container escape | \`book.hacktricks.xyz docker breakout\` + \`PayloadsAllTheThings docker escape\` |
| Cloud platform abuse | \`hackingthe.cloud\` (purpose-built cloud exploitation KB) + \`cloud.hacktricks.xyz\` |
| S3 bucket exploitation | \`hackingthe.cloud aws s3\` + \`book.hacktricks.xyz bucket exploitation\` |
| Dynamic linker abuse | \`ld.so.preload privilege escalation\` + \`ld-musl library injection\` |
| Tar/archive exploits | \`symlink tar extraction vulnerability\` + the specific language's tar library CVEs |
| Supply chain / build abuse | search the specific build system (Docker, BuildKit, etc.) on GitHub for recent CVEs |

### For specific dependency versions
- Search \`<package> <version> CVE\` or \`<package> <version> vulnerability\`
- Check \`nvd.nist.gov\` for the specific CVE details
- Check the package's GitHub releases/changelog for security fixes after the pinned version

### Search strategy
1. Start with PayloadsAllTheThings — it's the fastest path to "does a known technique exist?"
2. If you need deeper understanding, go to HackTricks for the walkthrough.
3. If you need authoritative browser behavior, go to MDN.
4. If you need to know "has this exact pattern appeared in a CTF before?", search CTFtime writeups.
5. If you're dealing with cloud services, start with hackingthe.cloud.

## Reference: Attacker Infrastructure

If you need a public URL for callbacks, redirect servers, or serving files to remote targets, \`tunnelto\` is available at \`/home/goose/.tunnelto/bin/tunnelto\` with auth pre-configured. Usage: \`/home/goose/.tunnelto/bin/tunnelto -p <local-port> -s <subdomain>\` gives you \`https://<subdomain>.tunn.dev\`. Set this up early for bot challenges — you'll almost certainly need a redirect/callback server.

## Reference: Runtime Recon Commands

When source code analysis isn't enough, use these to observe actual behavior:

\`\`\`bash
# What files does a process actually touch?
strace -f -e trace=openat,readlink,stat <process>

# What network connections does it make?
strace -f -e trace=connect <process>

# Is a binary statically or dynamically linked?
file <binary>
ldd <binary>

# What capabilities does a container have?
capsh --print
cat /proc/1/status | grep Cap

# What's mounted where?
cat /proc/self/mountinfo
mount

# SUID binaries
find / -perm -4000 2>/dev/null
\`\`\`
`;

export const CTF_RECON_SECTIONS: Record<string, string> = {
  "orientation": "## Minute 0-1",
  "source-review": "## Minute 1-5",
  "hypothesis": "## Minute 5-10",
  "confirm": "## Minute 10-15",
  "chain": "## When the Primitive Works",
  "stuck": "## When You're Stuck",
  "knowledge-base": "## Knowledge Base Research",
  "infrastructure": "## Reference:",
};

export function extractGuideSection(phase: string): string {
  if (phase === "all") return CTF_RECON_GUIDE;
  const heading = CTF_RECON_SECTIONS[phase];
  if (!heading) return CTF_RECON_GUIDE;
  const lines = CTF_RECON_GUIDE.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start === -1) return CTF_RECON_GUIDE;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

export const CTF_DOMAIN_PRESETS: Record<string, string[]> = {
  "payloads": ["github.com", "book.hacktricks.xyz", "portswigger.net"],
  "writeups": ["ctftime.org", "medium.com", "github.com"],
  "cve": ["nvd.nist.gov", "exploit-db.com", "github.com"],
  "cloud": ["hackingthe.cloud", "cloud.hacktricks.xyz", "github.com"],
  "browser": [
    "developer.mozilla.org",
    "portswigger.net",
    "book.hacktricks.xyz",
  ],
};

export const CTF_DEFAULT_DOMAINS = [
  "github.com",
  "book.hacktricks.xyz",
  "ctftime.org",
  "nvd.nist.gov",
  "portswigger.net",
];
