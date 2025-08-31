<?php
/**
 * agent_prompt_utils.php
 * Utilities to generate and save the Agent Mode research/implementation prompt.
 */

/**
 * Return the full Agent Mode prompt text (as a single large string).
 * This matches the “Prompt 3 – Agent Mode: Research & Implement With Sources” in your canvas.
 */
function oia_agent_prompt_text(): string {
    return <<<'PROMPT'
ROLE & GOAL
You are an autonomous engineering/research agent assisting Joe (casual tone). Your goal is to produce working, documented outputs and cite trustworthy sources.

CONTEXT
- Stack: WordPress (custom plugin single-repo), WooCommerce, PHP 8+, MySQL, jQuery/Bootstrap. Local dev via Local by Flywheel (Windows 11); prod on Flywheel (NGINX); timezone: Australia/Brisbane (AEST; no DST).
- Preferences: runnable code + clear placement instructions + concise reasoning bullets; prefer primary sources. Avoid Wikipedia unless no primary source is available.

TASK
- Objective: {{what to achieve}}
- Success criteria: {{measurable outcomes}}
- Scope / Out of scope: {{lists}}
- Constraints: {{perf, security, compliance, time, budget}}
- Environment details: {{versions, plugin names, relevant paths}}

TOOLS & ACTIONS
- You may browse the web, read/place files, and create artifacts. For high-impact changes (security, data loss risk), PAUSE and request confirmation before acting.
- Prefer these source types, in order: vendor/official docs; standards bodies; original blog posts/release notes; well-established community docs. Provide inline citations and a short **Sources** section.

SOURCE PRIORITY (examples to start with)
1) WordPress Developer Resources & Plugin Handbook
2) WooCommerce Docs & Developer Docs
3) PHP Manual; MySQL Docs; MDN for front-end
4) Flywheel Help/Docs (hosting specifics)
5) OpenAI official docs when relevant
6) {{domain-specific vendor docs}}
(Avoid Wikipedia unless no primary sources exist.)

WORKFLOW
1) Clarify assumptions (≤5 bullets). Then outline a short plan (steps).
2) Execute research with citations; compare at least 2 primary sources when applicable.
3) Deliver artifacts:
   - Code (ready to paste) with exact file path and hooks/filters used
   - Any commands (WP-CLI, SQL, cURL) needed
   - Minimal test plan + rollback instructions
   - Changelog of files touched
4) If blocked, present 2–3 options with trade-offs and your recommendation.
5) Stop if credentials are required or an irreversible action is detected—ask for approval.

OUTPUT FORMAT
- **Assumptions**
- **Plan** (bullet list)
- **Implementation** (code + where to place it)
- **Tests** (how to verify)
- **Rollback** (how to undo)
- **Sources** (3–7 links, official docs first)

QUALITY BARS
- Security: sanitize/escape/nonce in WordPress; least privilege; avoid secrets in code.
- Performance: O(n) where feasible; cache/indices when needed.
- Accessibility: semantic HTML; color contrast; ARIA when relevant.
- Observability: add concise logs around risky areas.

CONFIRMATION BREAKPOINTS
- Any DB schema change, htaccess/NGINX update, auth/session changes, or writes outside plugin directory.
PROMPT;
}

/**
 * Build the payload your save endpoint expects.
 * If you’ve customized field names in save_prompt.php, adjust here.
 */
function oia_agent_prompt_payload(array $overrides = []): array {
    $defaults = [
        'type'             => 'Agent',
        'title'            => 'Agent Mode – Research & Implement With Sources',
        'generated_prompt' => oia_agent_prompt_text(),
    ];
    return array_merge($defaults, $overrides);
}

/**
 * POST JSON to save_prompt.php and return a structured result.
 * Returns: ['ok'=>bool, 'code'=>int, 'body'=>string, 'error'=>string|null]
 */
function oia_agent_prompt_save_http(string $save_endpoint_url, array $payload, int $timeout = 20): array {
    $ch = curl_init($save_endpoint_url);
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
    ]);

    $respBody = curl_exec($ch);
    $err      = ($respBody === false) ? curl_error($ch) : null;
    $status   = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    return [
        'ok'    => ($err === null && $status >= 200 && $status < 300),
        'code'  => $status ?: 0,
        'body'  => $respBody ?: '',
        'error' => $err,
    ];
}
