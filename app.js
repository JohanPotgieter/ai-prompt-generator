// Null-safe DOM helpers
const $ = (id) => document.getElementById(id);
const val = (id) => $(`${id}`)?.value ?? "";
const checked = (id) => !!$(`${id}`)?.checked;

let sessionPromptCounter = 0,
  lastRestoredPromptData = null,
  currentSearchPage = 1,
  totalPages = 1;
const promptsPerPage = 10;
let DB_AGENT_TEMPLATES = {};
let DB_ptcf_TEMPLATES = {};
let DB_DESIGN_TEMPLATES = {};

async function fetchTemplates(category) {
  const res = await fetch(
    `php/templates_list.php?category=${encodeURIComponent(category)}&include_payload=1`,
  );
  if (!res.ok) throw new Error(`Failed to load ${category} templates`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `Bad ${category} list`);
  const map = {};
  for (const t of data.templates) {
    try {
      if (t.payload && typeof t.payload === "string")
        t.payload = JSON.parse(t.payload);
    } catch (e) {
      console.warn("Bad payload JSON for template", t.key, e);
      t.payload = {};
    }
    map[t.key] = t;
  }
  return map;
}

// Hoisted/TDZ-safe autosave timer
var autosaveTimer = null;

function setAutosaveStatus(state, text) {
  const b = document.getElementById("autosaveStatus");
  if (!b) return;
  b.className = "badge badge--" + state;
  b.textContent = text;
}

// Mini local fallback presets
const ptcf_FALLBACK_PRESETS = {
  blog: {
    label: "Blog Post",
    payload: {
      task: "Write a blog post explaining {{topic}} to {{audience}}.",
      format:
        "Formatted in Markdown. Use headings, short paragraphs, and bullet lists where helpful.",
      context:
        "Tone: {{tone}}. Length: {{length}}. Include 3 real-world examples and a brief conclusion.",
      references: "",
      iterate:
        "Critique for clarity, remove redundancy, add a concise summary at the end.",
    },
  },
  product: {
    label: "Product Description",
    payload: {
      task: "Create a compelling product description for {{topic}}.",
      format: "Markdown with intro, bullet features, and benefits section.",
      context: "Audience: {{audience}}. Tone: {{tone}}. Length: {{length}}.",
      references: "Use brand style guide where applicable.",
      iterate: "Tighten copy; emphasise benefits; add a persuasive CTA.",
    },
  },
  email: {
    label: "Email Campaign",
    payload: {
      task: "Write an email campaign introducing {{topic}} to {{audience}}.",
      format: "Subject + preview + body (short paragraphs + bullets).",
      context: "Tone: {{tone}}. Keep it concise. One strong CTA.",
      references: "",
      iterate: "A/B test two subject lines and two CTAs.",
    },
  },
  bug: {
    label: "Bug Report",
    payload: {
      task: "Draft a clear bug report.",
      format:
        "Sections: Summary, Steps, Expected, Actual, Environment, Screenshots.",
      context: "Audience: engineering. Be precise; avoid ambiguity.",
      references: "",
      iterate: "Ensure steps are minimal yet reproducible.",
    },
  },
};

const AGENT_FALLBACK_TEMPLATES = {
  wordpress_programmer: {
    label: "WordPress Programmer",
    description: "Research + implement in WP/Woo contexts",
    payload: {
      defaults: {
        env: "PHP 8.2; WordPress 6.5+; WooCommerce 8.x\nLocal: Win11 (Local by Flywheel)\nProd: Flywheel (NGINX)\nPlugin: /wp-content/plugins/oi-mods/\nTZ: Australia/Brisbane (AEST; no DST)",
        scope:
          "- Add admin link\n- Reuse existing templates\n- Nonce + capability checks\n- Logging (actor/user/time, AEST)\n- Unit/integration tests",
        outofscope:
          "- New email templates\n- DB schema changes\n- Payment provider switching",
        constraints:
          "- Performance: TTFB < 200ms; DB < 100ms\n- Security: sanitize/escape; $wpdb->prepare\n- Compliance: no PII in logs\n- Time/Budget: MVP today",
      },
    },
  },
  research_general: {
    label: "Researcher (General)",
    description: "Source-cited research + summary",
    payload: {
      defaults: {
        env: "",
        scope:
          "- Triage sources\n- Summarise with quotes\n- Provide links + inline citations",
        outofscope:
          "- Long code implementations\n- Non-public/unverifiable claims",
        constraints:
          "- Cite every non-obvious claim\n- Prefer primary/vendor docs\n- Timebox: 2 hours",
      },
    },
  },
};

function parseAspect(s) {
  if (!s) return null;
  const m = String(s)
    .trim()
    .match(/^(\d+)\s*:\s*(\d+)$/);
  if (!m) return null;
  return [+m[1], +m[2]];
}

function pxToInches(px, dpi) {
  const p = parseFloat(px);
  const d = parseFloat(dpi) || 300;
  if (isNaN(p) || p <= 0) return null;
  return p / d;
}

function unitToInches(val, units, dpi) {
  const n = parseFloat(val);
  if (isNaN(n) || n <= 0) return null;
  if (units === "cm") return n / 2.54;
  if (units === "px") return n / (parseFloat(dpi) || 300);
  return n;
}

function computePodPixels() {
  const units = val("pod_units") || "in";
  const dpi = parseFloat(val("pod_dpi") || "300");

  const bleed = Math.max(0, parseFloat(val("pod_bleed") || "0")) / 100;
  const safe = Math.max(0, parseFloat(val("pod_safe") || "0")) / 100;
  const aspect = parseAspect(val("pod_aspect"));
  const bg = val("pod_bg") || "transparent";
  const product = val("pod_product") || "tshirt";

  const out = $("podSpecOut");

  const toInches = (v, u) => {
    const n = parseFloat(v);
    if (isNaN(n) || n <= 0) return null;
    if (u === "cm") return n / 2.54;
    if (u === "in") return n;
    return null;
  };

  let pxW, pxH;
  let wIn, hIn;
  let wBleedIn, hBleedIn;

  if (units === "px") {
    pxW = Math.round(parseFloat(val("pod_w") || "0"));
    pxH = Math.round(parseFloat(val("pod_h") || "0"));

    if ((!pxW || !pxH) && !aspect) {
      out.innerHTML =
        '<span class="pod-warn">Enter pixel width & height or select an aspect.</span>';
      return;
    }

    if (aspect && (!pxW || !pxH)) {
      const short = product === "poster" ? 10800 : 4500;
      const [aw, ah] = aspect;
      if (aw >= ah) {
        pxW = Math.round(short * (aw / ah));
        pxH = short;
      } else {
        pxH = Math.round(short * (ah / aw));
        pxW = short;
      }
    }

    if (!pxW || !pxH || !dpi) {
      out.innerHTML = '<span class="pod-bad">Missing pixels or DPI.</span>';
      return;
    }

    wBleedIn = pxW / dpi;
    hBleedIn = pxH / dpi;
    wIn = wBleedIn / (1 + bleed * 2);
    hIn = hBleedIn / (1 + bleed * 2);
  } else {
    let w = toInches(val("pod_w"), units);
    let h = toInches(val("pod_h"), units);

    if ((!w || !h) && !aspect) {
      out.innerHTML =
        '<span class="pod-warn">Enter width/height (or pick an aspect) and DPI.</span>';
      return;
    }

    if (aspect && (!w || !h)) {
      if (product === "poster") {
        w = 18;
        h = 24;
      } else if (product === "sticker") {
        w = 4;
        h = 4;
      } else if (product === "canvas") {
        w = 16;
        h = 20;
      } else if (product === "pillow") {
        w = 18;
        h = 18;
      } else {
        w = 12;
        h = 12;
      }
      const ratio = aspect[0] / aspect[1];
      h = +(w / ratio).toFixed(3);
    }

    if (!w || !h || !dpi) {
      out.innerHTML = '<span class="pod-bad">Missing size or DPI.</span>';
      return;
    }

    wIn = w;
    hIn = h;
    wBleedIn = wIn * (1 + bleed * 2);
    hBleedIn = hIn * (1 + bleed * 2);
    pxW = Math.round(wBleedIn * dpi);
    pxH = Math.round(hBleedIn * dpi);
  }

  const safeW = Math.round(pxW * (1 - safe * 2));
  const safeH = Math.round(pxH * (1 - safe * 2));

  const minShortEdge = 4500;
  const shortEdge = Math.min(pxW, pxH);
  const ok = shortEdge >= minShortEdge;
  const badge = ok
    ? '<span class="pod-ok">OK for most apparel/posters</span>'
    : '<span class="pod-warn">Low resolution for large prints</span>';

  const bgWarn =
    product === "sticker" && (val("pod_bg") || "transparent") !== "transparent"
      ? '<span class="pod-warn">Stickers usually need a transparent BG.</span>'
      : "";

  const arLabel = aspect ? aspect.join(":") : `${pxW}:${pxH}`;

  out.innerHTML = `
    <div><b>Pixels (incl. bleed):</b> ${pxW} × ${pxH} @ ${dpi} DPI ${badge}</div>
    <div><b>Trim size:</b> ${wIn.toFixed(3)}" × ${hIn.toFixed(3)}"  •  <b>Bleed:</b> ${Math.round(bleed * 100)}%  •  <b>Safe:</b> ${Math.round(safe * 100)}%</div>
    <div><b>Safe area (px):</b> ${safeW} × ${safeH}</div>
    <div><b>Aspect:</b> ${arLabel}  •  <b>BG:</b> ${val("pod_bg") || "transparent"}</div>
    <div>${bgWarn}</div>
  `;

  window.__POD_SPECS__ = {
    product,
    units,
    dpi,
    bleedPct: bleed * 100,
    safePct: safe * 100,
    bg: val("pod_bg") || "transparent",
    aspect: aspect ? aspect.join(":") : `${pxW}:${pxH}`,
    wIn,
    hIn,
    pixels: { width: pxW, height: pxH },
    safePixels: { width: safeW, height: safeH },
  };
}

function randomizeSeed() {
  const s = Math.floor(Math.random() * 2 ** 31);
  $("gen_seed").value = String(s);
  renderPreview?.();
}

function collectGenSettings() {
  return {
    model: val("gen_model"),
    ar: val("gen_ar"),
    seed: val("gen_seed"),
    steps: val("gen_steps"),
    sampler: val("gen_sampler"),
    cfg: val("gen_cfg"),
  };
}

function buildDesignObj() {
  if ($("methodSelector").value !== "design") return { text: "" };

  const fmt = (n, d = 2) =>
    n === null || n === undefined || n === "" || isNaN(+n)
      ? "—"
      : (+n).toFixed(d);

  const description = normalizeInput(val("design_description"));
  const environment = normalizeInput(val("design_environment"));
  const style = normalizeInput(val("design_style"));
  const illumination = normalizeInput(val("design_illumination"));
  const gradation = normalizeInput(val("design_gradation"));
  let nuances = normalizeInput(val("design_nuances"));
  const references = normalizeInput(val("design_references"));
  const artworkOnly = !!$("pod_artwork_only")?.checked;

  if (val("pod_w") || val("pod_h") || val("pod_aspect") || val("pod_dpi")) {
    try {
      computePodPixels();
    } catch (_) {}
  }

  const pod = window.__POD_SPECS__ || null;
  const gen =
    typeof collectGenSettings === "function"
      ? collectGenSettings()
      : {
          model: normalizeInput(val("gen_model")),
          ar: normalizeInput(val("gen_ar")),
          seed: normalizeInput(val("gen_seed")),
          steps: normalizeInput(val("gen_steps")),
          sampler: normalizeInput(val("gen_sampler")),
          cfg: normalizeInput(val("gen_cfg")),
        };

  if (artworkOnly) {
    const neg =
      "Negative: product mockups, t-shirt/garment photos, human models, fabric folds, hangers, mannequins, room scenes, 3D renders";
    nuances = nuances ? `${nuances}; ${neg}` : neg;
  }

  const lines = [];
  if (description) lines.push(`Description: ${description}`);
  if (environment) lines.push(`Environment: ${environment}`);
  if (style) lines.push(`Style: ${style}`);
  if (illumination) lines.push(`Illumination: ${illumination}`);
  if (gradation) lines.push(`Quality/Gradation: ${gradation}`);
  if (nuances) lines.push(`Nuances: ${nuances}`);
  if (references) lines.push(`References: ${references}`);

  if (pod) {
    const units = pod.units || "in";
    const dpiStr = pod.dpi != null && pod.dpi !== "" ? pod.dpi : "—";
    const bleedStr = pod.bleedPct != null ? `${fmt(pod.bleedPct, 0)}%` : "0%";
    const safeStr = pod.safePct != null ? `${fmt(pod.safePct, 0)}%` : "3%";
    const bgStr = pod.bg || "transparent";
    const product = pod.product || "tshirt";
    const arStr = pod.aspect || gen.ar || "Auto";

    const pxW = pod.pixels?.width ?? null;
    const pxH = pod.pixels?.height ?? null;

    let sizeStr;
    if (units === "px") {
      const pxWStr = pxW != null ? `${pxW}px` : "—";
      const pxHStr = pxH != null ? `${pxH}px` : "—";
      sizeStr = `${pxWStr}×${pxHStr}`;
    } else {
      const unitLabel = units === "cm" ? "cm" : "in";
      const wStr = pod.wIn != null ? `${fmt(pod.wIn)}${unitLabel}` : "—";
      const hStr = pod.hIn != null ? `${fmt(pod.hIn)}${unitLabel}` : "—";
      sizeStr = `${wStr}×${hStr}`;
    }

    const pxWStr = pxW != null ? `${pxW}px` : "—";
    const pxHStr = pxH != null ? `${pxH}px` : "—";

    lines.push(
      `POD Output Specs: product=${product}, size=${sizeStr} @ ${dpiStr} DPI, pixels=${pxWStr}×${pxHStr}, bleed=${bleedStr}, safe=${safeStr}, BG=${bgStr}, AR=${arStr}`,
    );

    if (artworkOnly) {
      lines.push(
        "Output: print-ready flat artwork only — no product mockups, no garment photos, no human models, no folds, no 3D renders; transparent background preferred.",
      );
    }
  }

  const settingsStr = [
    gen.model ? `Model: ${gen.model}` : "",
    gen.ar ? `AR: ${gen.ar}` : "",
    gen.seed && gen.seed.trim() !== "" ? `Seed: ${gen.seed}` : "Seed: (random)",
    gen.steps ? `Steps: ${gen.steps}` : "",
    gen.sampler ? `Sampler: ${gen.sampler}` : "",
    gen.cfg ? `CFG: ${gen.cfg}` : "",
  ]
    .filter(Boolean)
    .join(" • ");

  if (settingsStr) lines.push(`Settings: ${settingsStr}`);

  return {
    text: lines.join("\n"),
    description,
    environment,
    style,
    illumination,
    gradation,
    nuances,
    references,
    pod,
    gen,
    artworkOnly,
  };
}

function lintDesign(obj) {
  const issues = [];
  const t = [
    obj.description,
    obj.environment,
    obj.style,
    obj.illumination,
    obj.gradation,
    obj.nuances,
    obj.references,
  ]
    .filter(Boolean)
    .join(" ");

  if (!obj.description?.trim())
    issues.push("No description (subject & action).");
  if (!obj.environment?.trim())
    issues.push("No environment/setting specified.");
  if (!obj.style?.trim()) issues.push("No artistic style/aesthetic specified.");
  if (!obj.illumination?.trim())
    issues.push("No illumination/time-of-day specified.");
  if (/\b(nice|cool|good|thing|stuff)\b/i.test(t)) {
    issues.push("Ambiguous words detected (nice/cool/good/stuff). Be precise.");
  }

  const pod = obj.pod || window.__POD_SPECS__;
  if (pod) {
    const shortEdge = Math.min(pod.pixels.width, pod.pixels.height);
    if (shortEdge < 4500)
      issues.push(
        `POD: Short edge ${shortEdge}px is low for large prints at ${pod.dpi} DPI (aim ≥ 4500px).`,
      );
    if (
      pod.product === "sticker" &&
      String(pod.bg).toLowerCase() !== "transparent"
    ) {
      issues.push("POD: Stickers typically require a transparent background.");
    }
  } else {
    issues.push(
      "POD: No computed size — set size/DPI and click “Compute Pixels”.",
    );
  }

  const gen = obj.gen || collectGenSettings();
  if (!gen.model)
    issues.push("Settings: Specify model (e.g., SDXL / Playground v2).");
  if (!gen.ar)
    issues.push("Settings: Provide aspect ratio (AR) to match POD aspect.");
  if (!gen.steps) issues.push("Settings: Steps not set (e.g., 30–50).");
  if (!gen.cfg) issues.push("Settings: CFG not set (e.g., 6–9).");

  return issues;
}

function makeDesignVariants() {
  const base = buildDesignObj();
  if (!base.text?.trim()) {
    showAlert("Fill some DESIGN fields first.", "warning");
    return;
  }

  const presets = [
    { name: "Square 4500x4500", px: [4500, 4500], ar: "1:1" },
    { name: "Portrait 5400x7200", px: [5400, 7200], ar: "3:4" },
    { name: "Landscape 7200x5400", px: [7200, 5400], ar: "4:3" },
    { name: "Poster 7200x10800", px: [7200, 10800], ar: "2:3" },
  ];

  const colorways = ["pastel", "duotone", "high-contrast", "neon"];

  presets.forEach((p) => {
    colorways.forEach((cw) => {
      const variant = [
        base.text,
        `\nQuality/Gradation: ensure final image ${p.px[0]}x${p.px[1]}px @ 300 DPI`,
        `Settings: AR: ${p.ar}`,
        `Style tweak: ${cw}`,
      ].join("\n");

      addPromptToAccordion(
        `DESIGN Variant — ${p.name} — ${cw}`,
        variant,
        {
          method: "design",
          preset: p.name,
          colorway: cw,
          ar: p.ar,
          targetPixels: p.px,
        },
        `design-${p.name}-${cw}-${Date.now()}`,
        "#sessionPromptHistoryContainer",
      );
    });
  });

  showAlert("Batch variants generated under Session Prompts.", "success");
}

function insertAtCursor(id, text) {
  const ta = document.getElementById(id);
  if (!ta) return;
  const s = ta.selectionStart ?? ta.value.length;
  const e = ta.selectionEnd ?? ta.value.length;
  const needsNL =
    ta.value && s > 0 && text && !text.startsWith("\n") ? "\n" : "";
  ta.value = ta.value.slice(0, s) + needsNL + text + ta.value.slice(e);
  ta.focus();
  const pos = ta.value.length;
  ta.selectionStart = ta.selectionEnd = pos;
  if (typeof renderPreview === "function") renderPreview();
  if (typeof scheduleAutosave === "function") scheduleAutosave();
}

function insertChip(targetId, text) {
  insertAtCursor(targetId, text);
}

function applyptcfTemplate(key) {
  if (!key) return;
  const row = DB_ptcf_TEMPLATES?.[key];
  if (row?.payload) {
    const p = row.payload || {};
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = val ? String(val) : "";
    };

    set("ptcf_task", p.task);
    set("ptcf_format", p.format);
    set("ptcf_context", p.context);
    set("ptcf_references", p.references);
    set("ptcf_iterate", p.iterate);

    if (p.defaults && p.defaults.vars) {
      const v = p.defaults.vars;
      if (v.audience) document.getElementById("varAudience").value = v.audience;
      if (v.tone) document.getElementById("varTone").value = v.tone;
      if (v.length) document.getElementById("varLength").value = v.length;
    }

    if ($("methodSelector")?.value === "ptcf") {
      renderPreview();
      scheduleAutosave?.();
    }
    return;
  }

  const fb = ptcf_FALLBACK_PRESETS?.[key];
  if (fb?.payload) {
    const p = fb.payload;
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = val ? String(val) : "";
    };
    set("ptcf_task", p.task);
    set("ptcf_format", p.format);
    set("ptcf_context", p.context);
    set("ptcf_references", p.references);
    set("ptcf_iterate", p.iterate);
    renderPreview();
    scheduleAutosave?.();
    return;
  }

  console.warn("ptcf template not found for key:", key);
}

function constraintsWizard() {
  const perf = prompt(
    'Performance budget? (e.g., "TTFB < 200ms; DB queries < 100ms")',
    "TTFB < 200ms; DB queries < 100ms; cache reads",
  );
  const sec = prompt(
    'Security expectations? (e.g., "Nonce + capability checks; sanitize/escape")',
    "Nonce + capability checks; sanitize/escape; $wpdb->prepare",
  );
  const comp = prompt(
    'Compliance/privacy? (e.g., "No PII in logs; respect consent")',
    "No PII in logs; respect consent; redact user data in errors",
  );
  const time = prompt(
    'Time/Budget bounds? (e.g., "MVP in 6 hours; no paid APIs")',
    "MVP in 6 hours; no paid APIs",
  );
  const rel = prompt(
    'Reliability/observability? (e.g., "Log in AEST; error handling; retries/backoff")',
    "Log in AEST; error handling; retries/backoff",
  );

  const lines = [];
  if (perf) lines.push(`- Performance: ${perf}`);
  if (sec) lines.push(`- Security: ${sec}`);
  if (comp) lines.push(`- Compliance: ${comp}`);
  if (time) lines.push(`- Time/Budget: ${time}`);
  if (rel) lines.push(`- Reliability/Observability: ${rel}`);

  if (lines.length) {
    const block =
      (val("agent_constraints").trim() ? "\n" : "") + lines.join("\n");
    insertAtCursor("agent_constraints", block);
  }
}

window.constraintsWizard = constraintsWizard;
window.insertAtCursor = insertAtCursor;
window.insertChip = window.insertChip || insertChip;

async function initptcfTemplateSelectFromDB() {
  const sel = $("templatePreset");
  if (!sel) return 0;
  sel.disabled = true;
  sel.innerHTML = '<option value="">— Loading templates… —</option>';

  let count = 0;
  try {
    DB_ptcf_TEMPLATES = await fetchTemplates("ptcf");
    sel.innerHTML = "";
    const rows = Object.values(DB_ptcf_TEMPLATES)
      .filter((t) => t.is_active !== 0)
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          (a.label || "").localeCompare(b.label || ""),
      );

    if (rows.length) {
      rows.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t.key;
        opt.textContent = t.label || t.key;
        sel.appendChild(opt);
      });
      count = rows.length;
    } else {
      Object.entries(ptcf_FALLBACK_PRESETS).forEach(([key, obj]) => {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = obj.label;
        sel.appendChild(opt);
      });
      count = sel.options.length;
    }
    sel.onchange = () => applyptcfTemplate(sel.value);
  } catch (e) {
    showAlert(
      "No ptcf templates found in DB — using local fallbacks.",
      "warning",
    );
  } finally {
    sel.disabled = false;
  }
  return count;
}

async function initAgentTemplateSelectFromDB() {
  const sel = $("agentTemplate");
  const desc = $("agentTemplateDesc");
  if (!sel) return 0;
  sel.disabled = true;
  sel.innerHTML = '<option value="">— Loading templates… —</option>';

  let count = 0;
  try {
    DB_AGENT_TEMPLATES = await fetchTemplates("agent");
    sel.innerHTML = "";
    const rows = Object.values(DB_AGENT_TEMPLATES).sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        (a.label || "").localeCompare(b.label || ""),
    );

    rows.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.key;
      opt.textContent = t.label || t.key;
      sel.appendChild(opt);
    });
    count = rows.length;

    sel.addEventListener("change", () => {
      applyAgentTemplate();
      renderPreview();
    });
  } catch (e) {
    console.error("Agent templates load failed:", e);
  } finally {
    sel.disabled = false;
  }
  return count;
}

// ========= Generic Bootstrap modal builder =========
(function () {
  const modalEl = document.getElementById("wizardModal");
  if (!modalEl) return;
  const formEl = document.getElementById("wizardForm");
  const titleEl = document.getElementById("wizardModalTitle");
  const bodyEl = document.getElementById("wizardModalBody");
  const bsModal = new bootstrap.Modal(modalEl);
  let submitHandler = null;

  function fieldHtml(f) {
    const id = `wiz_${f.id}`;
    const help = f.help ? `<div class="form-text">${f.help}</div>` : "";
    if (f.type === "textarea") {
      return `
      <div class="mb-3">
        <label class="form-label" for="${id}">${f.label}</label>
        <textarea class="form-control" id="${id}" placeholder="${f.placeholder || ""}" rows="${f.rows || 3}">${f.value || ""}</textarea>
        ${help}
      </div>`;
    }
    if (f.type === "select") {
      const opts = (f.options || [])
        .map((o) => `<option value="${o.value}">${o.label}</option>`)
        .join("");
      return `
      <div class="mb-3">
        <label class="form-label" for="${id}">${f.label}</label>
        <select class="form-select" id="${id}">${opts}</select>
        ${help}
      </div>`;
    }
    if (f.type === "checkbox") {
      return `
      <div class="form-check mb-2">
        <input class="form-check-input" type="checkbox" id="${id}" ${f.checked ? "checked" : ""}>
        <label class="form-check-label" for="${id}">${f.label}</label>
      </div>`;
    }
    return `
    <div class="mb-3">
      <label class="form-label" for="${id}">${f.label}</label>
      <input class="form-control" type="text" id="${id}" placeholder="${f.placeholder || ""}" value="${f.value || ""}">
      ${help}
    </div>`;
  }

  function collect(fields) {
    const out = {};
    for (const f of fields) {
      const id = `wiz_${f.id}`;
      const el = document.getElementById(id);
      if (!el) continue;
      if (f.type === "checkbox") out[f.id] = !!el.checked;
      else out[f.id] = el.value.trim();
    }
    return out;
  }

  window.openWizardModal = function openWizardModal({
    title,
    fields,
    onSubmit,
  }) {
    bodyEl.innerHTML = fields.map(fieldHtml).join("");
    titleEl.textContent = title || "Wizard";
    submitHandler = () => onSubmit(collect(fields));
    bsModal.show();
  };

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      submitHandler && submitHandler();
      bsModal.hide();
    } catch (err) {
      console.error(err);
    }
  });
})();

// ========= Agent wizards =========
function objectiveWizard() {
  openWizardModal({
    title: "Objective",
    fields: [
      {
        id: "verb",
        label: "Action",
        type: "select",
        options: [
          { value: "Implement", label: "Implement" },
          { value: "Fix", label: "Fix" },
          { value: "Research", label: "Research" },
          { value: "Migrate", label: "Migrate" },
        ],
      },
      {
        id: "thing",
        label: "Feature/Thing",
        placeholder: "e.g., admin action to resend renewal email",
      },
      {
        id: "where",
        label: "Where/Context",
        placeholder: "e.g., Woo Memberships > User profile",
      },
      {
        id: "why",
        label: "Why (optional)",
        placeholder: "e.g., reduce support load and missed renewals",
      },
    ],
    onSubmit: ({ verb, thing, where, why }) => {
      const line = [
        verb || "Implement",
        thing || "feature",
        where ? `in ${where}` : "",
        why ? `to ${why}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      if (line)
        insertAtCursor(
          "agent_objective",
          (val("agent_objective").trim() ? "\n" : "") + line,
        );
    },
  });
}
window.objectiveWizard = objectiveWizard;

function successWizard() {
  openWizardModal({
    title: "Success Criteria",
    fields: [
      {
        id: "ui",
        label: "UI/State",
        placeholder: "link shown under Next Bill On",
      },
      {
        id: "email",
        label: "Side effect",
        placeholder: "correct template sent + logged",
      },
      {
        id: "sec",
        label: "Security",
        placeholder: "nonce + capability checks",
      },
      { id: "perf", label: "Performance", placeholder: "page impact < 50ms" },
      { id: "tests", label: "Tests", placeholder: "unit/integration updated" },
    ],
    onSubmit: (d) => {
      const lines = [];
      if (d.ui) lines.push(`- ${d.ui}`);
      if (d.email) lines.push(`- ${d.email}`);
      if (d.sec) lines.push(`- ${d.sec}`);
      if (d.perf) lines.push(`- ${d.perf}`);
      if (d.tests) lines.push(`- ${d.tests}`);
      if (lines.length)
        insertAtCursor(
          "agent_success",
          (val("agent_success").trim() ? "\n" : "") + lines.join("\n"),
        );
    },
  });
}
window.successWizard = successWizard;

function scopeWizard() {
  openWizardModal({
    title: "Scope (In-Scope)",
    fields: [
      {
        id: "action",
        label: "Action",
        placeholder: "add admin link + handler",
      },
      {
        id: "reuse",
        label: "Reuse assets",
        placeholder: "reuse existing renewal template",
      },
      {
        id: "logging",
        label: "Observability",
        placeholder: "log actor, user, time (AEST)",
      },
      {
        id: "security",
        label: "Security",
        placeholder: "nonce + capability checks; sanitize/escape",
      },
      {
        id: "testing",
        label: "Testing",
        placeholder: "unit/integration where practical",
      },
    ],
    onSubmit: (d) => {
      const lines = [];
      ["action", "reuse", "logging", "security", "testing"].forEach(
        (k) => d[k] && lines.push(`- ${d[k]}`),
      );
      if (lines.length)
        insertAtCursor(
          "agent_scope",
          (val("agent_scope").trim() ? "\n" : "") + lines.join("\n"),
        );
    },
  });
}
window.scopeWizard = scopeWizard;

function outOfScopeWizard() {
  openWizardModal({
    title: "Out of Scope",
    fields: [
      {
        id: "email",
        label: "Emails/templates",
        placeholder: "creating new email templates",
      },
      { id: "db", label: "DB/schema", placeholder: "DB schema changes" },
      {
        id: "payments",
        label: "Payments",
        placeholder: "subscription proration logic",
      },
      {
        id: "provider",
        label: "Providers",
        placeholder: "switching payment provider",
      },
    ],
    onSubmit: (d) => {
      const lines = [];
      ["email", "db", "payments", "provider"].forEach(
        (k) => d[k] && lines.push(`- ${d[k]}`),
      );
      if (lines.length)
        insertAtCursor(
          "agent_outofscope",
          (val("agent_outofscope").trim() ? "\n" : "") + lines.join("\n"),
        );
    },
  });
}
window.outOfScopeWizard = outOfScopeWizard;

function envWizard() {
  openWizardModal({
    title: "Environment Details",
    fields: [
      { id: "php", label: "PHP", placeholder: "8.2" },
      { id: "wp", label: "WordPress", placeholder: "6.5+" },
      { id: "woo", label: "Woo/plugins", placeholder: "WooCommerce 8.x" },
      {
        id: "local",
        label: "Local/dev",
        placeholder: "Win11 (Local by Flywheel)",
      },
      { id: "prod", label: "Prod", placeholder: "Flywheel (NGINX)" },
      {
        id: "path",
        label: "Plugin path",
        placeholder: "/wp-content/plugins/oi-mods/",
      },
      {
        id: "tz",
        label: "Timezone",
        placeholder: "Australia/Brisbane (AEST; no DST)",
      },
    ],
    onSubmit: (d) => {
      const lines = [];
      if (d.php) lines.push(`PHP ${d.php}`);
      if (d.wp) lines.push(`WordPress ${d.wp}`);
      if (d.woo) lines.push(d.woo);
      if (d.local) lines.push(`Local: ${d.local}`);
      if (d.prod) lines.push(`Prod: ${d.prod}`);
      if (d.path) lines.push(`Plugin: ${d.path}`);
      if (d.tz) lines.push(`TZ: ${d.tz}`);
      if (lines.length)
        insertAtCursor(
          "agent_env",
          (val("agent_env").trim() ? "\n" : "") + lines.join("\n"),
        );
    },
  });
}
window.envWizard = envWizard;

function vendorWizard() {
  openWizardModal({
    title: "Vendor Docs",
    fields: [
      {
        id: "wp",
        type: "checkbox",
        label: "WordPress Developer Docs (core)",
        checked: true,
      },
      {
        id: "wc",
        type: "checkbox",
        label: "WooCommerce Memberships Docs",
        checked: true,
      },
      { id: "ff", type: "checkbox", label: "Formidable Forms Developer Docs" },
      {
        id: "stripe",
        type: "checkbox",
        label: "Stripe API Docs (Billing/Invoices)",
      },
      { id: "host", type: "checkbox", label: "Flywheel Platform Docs" },
      {
        id: "extra",
        type: "textarea",
        label: "Other (one per line)",
        rows: 4,
        placeholder: "e.g., Mailgun API Docs\nWP-CLI Commands",
      },
    ],
    onSubmit: (d) => {
      const lines = [];
      if (d.wp) lines.push("- WordPress Developer Docs");
      if (d.wc) lines.push("- WooCommerce Memberships Docs");
      if (d.ff) lines.push("- Formidable Forms Developer Docs");
      if (d.stripe) lines.push("- Stripe API Docs (Billing/Invoices)");
      if (d.host) lines.push("- Flywheel Platform Docs");
      if (d.extra)
        d.extra
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((s) => lines.push(`- ${s}`));
      if (lines.length)
        insertAtCursor(
          "agent_extra_sources",
          (val("agent_extra_sources").trim() ? "\n" : "") + lines.join("\n"),
        );
    },
  });
}
window.vendorWizard = vendorWizard;

function applyAgentTemplate() {
  const sel = document.getElementById("agentTemplate");
  const desc = document.getElementById("agentTemplateDesc");
  if (!sel) return;

  const t = DB_AGENT_TEMPLATES[sel.value];
  if (!t) {
    if (desc) desc.textContent = "";
    return;
  }

  if (desc) desc.textContent = t.description || "";

  const d = (t.payload && t.payload.defaults) || {};

  const setIfEmpty = (id, val) => {
    if (!val) return;
    const el = document.getElementById(id);
    if (el && !el.value.trim())
      el.value = Array.isArray(val) ? val.join("\n") : String(val);
  };

  setIfEmpty("agent_env", d.env);
  setIfEmpty("agent_scope", d.scope);
  setIfEmpty("agent_outofscope", d.outofscope);
  setIfEmpty("agent_constraints", d.constraints);
}

function showAlert(message, type = "success") {
  const b = document.getElementById("alert-banner");
  const m = document.getElementById("alert-message");
  b.className = "alert";
  b.classList.add(type);
  m.innerHTML = message;
  b.style.display = "block";
  b.scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => {
    b.style.display = "none";
  }, 5000);
}

function normalizeInput(text) {
  return (text || "").trim().replace(/\n{2,}/g, "\n");
}

function buildAgentObj() {
  if (document.getElementById("methodSelector").value !== "agent")
    return { text: "" };

  const tplKey =
    document.getElementById("agentTemplate")?.value || "wordpress_programmer";
  const tplRow = DB_AGENT_TEMPLATES[tplKey];
  const p = tplRow?.payload || {};

  const normalize = normalizeInput;
  const objective = normalize(document.getElementById("agent_objective").value);
  const success = normalize(document.getElementById("agent_success").value);
  const scope = normalize(document.getElementById("agent_scope").value);
  const outofscope = normalize(
    document.getElementById("agent_outofscope").value,
  );
  const constraints = normalize(
    document.getElementById("agent_constraints").value,
  );
  const env = normalize(document.getElementById("agent_env").value);
  const extraVendors = normalize(
    document.getElementById("agent_extra_sources").value,
  );

  const bullet = (arr, prefix = "-") =>
    Array.isArray(arr) && arr.length
      ? arr.map((x) => `${prefix} ${x}`).join("\n")
      : "";
  const numbered = (arr) =>
    Array.isArray(arr) && arr.length
      ? arr.map((x, i) => `${i + 1}) ${x}`).join("\n")
      : "";
  const section = (title, body) => (body ? `${title}\n${body}` : "");

  const roleGoal = p.roleGoal ? `ROLE & GOAL\n${p.roleGoal}` : "";
  const contextBlock = section("CONTEXT", bullet(p.context));
  const sourcesBlock = section(
    "SOURCE PRIORITY",
    numbered(
      extraVendors ? [...(p.sources || []), extraVendors] : p.sources || [],
    ),
  );
  const workflowBlock = section("WORKFLOW", numbered(p.workflow));

  const fmt = bullet(p.output?.format);
  const qual = bullet(p.output?.quality);
  const conf = bullet(p.output?.confirm);

  const outputBlock = [
    section("OUTPUT FORMAT", fmt),
    section("QUALITY BARS", qual),
    section("CONFIRMATION BREAKPOINTS", conf),
  ]
    .filter(Boolean)
    .join("\n\n");

  const taskBlock = `TASK
    - Objective: ${objective || "{{what to achieve}}"}
    - Success criteria: ${success || "{{measurable outcomes}}"}
    - Scope / Out of scope:
    ${scope || "{{in-scope list}}"}${outofscope ? `\n  (Out of scope)\n  ${outofscope}` : ""}
    - Constraints: ${constraints || "{{perf, security, compliance, time, budget}}"}
    - Environment details: ${env || "{{versions, tools, paths}}"}`;

  const toolsBlock = p.toolsActions
    ? section("TOOLS & ACTIONS", bullet(p.toolsActions))
    : `TOOLS & ACTIONS
    - You may browse the web, read/place files, and create artifacts. For high-impact changes (security, data loss risk), PAUSE and request confirmation before acting.
    - Prefer these source types, in order: vendor/official docs; standards bodies; original blog posts/release notes; well-established community docs. Provide inline citations and a short **Sources** section.`;

  const text = [
    roleGoal,
    contextBlock,
    taskBlock,
    toolsBlock,
    sourcesBlock,
    workflowBlock,
    outputBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    text,
    template_key: tplKey,
    objective,
    success,
    scope,
    outofscope,
    constraints,
    env,
    extraVendors,
  };
}

function isPlaceholder(s) {
  const x = (s || "").trim();
  return !x || /\{\{[^}]+\}\}/.test(x) || /^(tbd|n\/?a|\?+)$/i.test(x);
}

function lintAgent(obj) {
  const issues = [];
  const hasBullets = (s) => /(^|\n)\s*-\s+/m.test(s || "");

  if (!obj.objective?.trim()) issues.push("No objective.");
  if (!obj.success?.trim()) issues.push("No success criteria.");
  else {
    if (
      !/[<>=]|%|\b(ms|s|minutes?|hours?)\b|\b(pass|fail|green)\b/i.test(
        obj.success,
      )
    ) {
      issues.push(
        'Success: add measurable checks (e.g., “impact < 50ms”, "%”, pass/fail).',
      );
    }
    if (!hasBullets(obj.success))
      issues.push("Success: use bullet points for scanability.");
  }

  if (!obj.scope?.trim() && !obj.outofscope?.trim())
    issues.push("No scope / out-of-scope.");
  if (obj.scope && !hasBullets(obj.scope))
    issues.push("Scope: prefer bullet list.");
  if (obj.outofscope && !hasBullets(obj.outofscope))
    issues.push("Out of scope: prefer bullet list.");

  if (!obj.env?.trim()) issues.push("No environment details.");

  const rawC = (obj.constraints || "").trim();
  if (isPlaceholder(rawC)) {
    issues.push(
      "No constraints provided (perf, security, compliance, time/budget).",
    );
  }
  if (/\b(nice|cool|good|things|stuff)\b/i.test(obj.text)) {
    issues.push("Ambiguous wording detected — be precise.");
  }
  return issues;
}

function clearFormFields() {
  document.querySelectorAll("textarea").forEach((t) => (t.value = ""));
  document.getElementById("ptcf_add_tags").checked = false;
  lastRestoredPromptData = null;
  renderPreview();
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || typeof a != "object" || b == null || typeof b != "object")
    return false;
  const ka = Object.keys(a),
    kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!kb.includes(k) || !deepEqual(a[k], b[k])) return false;
  }
  return true;
}

async function generatePromptAndSave(method) {
  let combinedPrompt = "";
  let promptData = { method };

  if (method === "ptcf") {
    const obj = buildPromptObj();
    if (!obj.text?.trim()) {
      showAlert("Fill some ptcf fields first.", "warning");
      return;
    }
    combinedPrompt = obj.text;
    Object.assign(promptData, {
      task: obj.task,
      format: obj.format,
      context: obj.context,
      references: obj.references,
      iterate: obj.iterate,
      addTags: !!obj.addTags,
    });
  } else if (method === "design") {
    const obj = buildDesignObj();
    if (!obj.text?.trim()) {
      showAlert("Fill some DESIGN fields first.", "warning");
      return;
    }
    combinedPrompt = obj.text;
    Object.assign(promptData, {
      description: obj.description,
      environment: obj.environment,
      style: obj.style,
      illumination: obj.illumination,
      gradation: obj.gradation,
      nuances: obj.nuances,
      references: obj.references,
      pod: obj.pod || null,
      gen: obj.gen || {
        model: "",
        ar: "",
        seed: "",
        steps: "",
        sampler: "",
        cfg: "",
      },
    });
  } else if (method === "agent") {
    const obj = buildAgentObj();
    if (!obj.objective?.trim()) {
      showAlert("Please add an Objective for Agent Mode.", "warning");
      return;
    }
    combinedPrompt = obj.text;
    Object.assign(promptData, obj);
  } else if (method === "gem") {
    const obj = buildGemObj();
    if (!obj.text?.trim()) {
      showAlert("Fill some Gem fields first.", "warning");
      return;
    }
    combinedPrompt = obj.text;
    Object.assign(promptData, obj);
  } else if (method === "code") {
    const obj = buildCodeObj();
    if (!obj.text?.trim()) {
      showAlert("Fill some Code fields first.", "warning");
      return;
    }
    combinedPrompt = obj.text;
    Object.assign(promptData, obj);
  } else if (method === "notebook") {
    const obj = buildNotebookObj();
    if (!obj.text?.trim()) {
      showAlert("Fill some Notebook fields first.", "warning");
      return;
    }
    combinedPrompt = obj.text;
    Object.assign(promptData, obj);
  } else if (method === "fewshot") {
    const obj = buildFewShotObj();
    if (!obj.text?.trim()) {
      showAlert("Fill some Few-Shot fields first.", "warning");
      return;
    }
    combinedPrompt = obj.text;
    Object.assign(promptData, obj);
  } else if (method === "deep") {
    const obj = buildDeepObj();
    if (!obj.text?.trim()) {
      showAlert("Fill some Deep Research fields first.", "warning");
      return;
    }
    combinedPrompt = obj.text;
    Object.assign(promptData, obj);
  }
  if (!combinedPrompt) return;

  let saveToDB = true,
    sessionPromptTitle = "",
    isNew = true;
  if (lastRestoredPromptData && deepEqual(promptData, lastRestoredPromptData)) {
    showAlert("No changes detected. Prompt not saved as a new copy.", "info");
    saveToDB = false;
    isNew = false;
    sessionPromptTitle = `Loaded Prompt (No Changes) ${++sessionPromptCounter}`;
  }

  if (saveToDB) {
    const date = new Date();

    // Strict dd/mm/yyyy formatting
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const y = date.getFullYear();
    const formattedDate = `${d}/${m}/${y}`;
    const formattedTime = date.toLocaleTimeString("en-AU");

    const dbSaveTitle = `${method.toUpperCase()} Prompt - ${formattedDate} ${formattedTime}`;
    const payload = {
      type: method,
      title: dbSaveTitle,
      generated_prompt: combinedPrompt,
      prompt_data: promptData,
    };
    const saved = await savePromptToDB(payload);

    if (saved && saved.id) {
      sessionPromptTitle = `${method.toUpperCase()} Session Prompt ${++sessionPromptCounter} - ${formattedTime}`;
      addPromptToAccordion(
        sessionPromptTitle,
        combinedPrompt,
        promptData,
        saved.id,
        "#sessionPromptHistoryContainer",
      );
      document
        .querySelector("#sessionPromptHistoryContainer .no-prompts-message")
        ?.remove();
    }
  }

  if (sessionPromptTitle && !isNew) {
    addPromptToAccordion(
      sessionPromptTitle,
      combinedPrompt,
      promptData,
      "session-" + sessionPromptCounter,
      "#sessionPromptHistoryContainer",
    );
    document
      .querySelector("#sessionPromptHistoryContainer .no-prompts-message")
      ?.remove();
  }

  renderPreview();
}

async function savePromptToDB(payload) {
  const res = await fetch("php/save_prompt.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text();

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ${res.statusText} — ${bodyText || "(empty response)"}`,
    );
  }
  if (!bodyText || !bodyText.trim()) {
    throw new Error("Server returned an empty response body.");
  }

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new Error(`Invalid JSON from server: ${bodyText.slice(0, 400)}`);
  }

  if (data.ok === false)
    throw new Error(data.error || "Server returned ok:false");

  const record = data.prompt || data;
  return { ok: data.ok !== false, id: record.id, prompt: record };
}

async function deletePrompt(id) {
  if (!confirm("Delete this prompt from the database?")) return;
  try {
    const res = await fetch("php/delete_prompt.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const txt = await res.text();
    const json = (() => {
      try {
        return JSON.parse(txt);
      } catch {
        return null;
      }
    })();
    if (!res.ok)
      throw new Error((json && json.error) || txt || "Failed to delete");
    showAlert((json && json.message) || "Deleted", "success");
    searchPrompts(currentSearchPage);
  } catch (err) {
    console.error(err);
    showAlert(`Error deleting prompt: ${err.message}`, "error");
  }
}

async function searchPrompts(page = 1, isSearchButtonClicked = false) {
  const searchType = document.getElementById("searchPromptType").value;
  const searchKeyword = document.getElementById("searchKeyword").value;
  const sortBy = document.getElementById("searchSortBy").value || "created_at";
  const sortDir = document.getElementById("searchSortDir").value || "desc";
  const mode = document.getElementById("searchMode").value || "auto";
  const includeDeleted = document.getElementById("includeDeleted").checked
    ? 1
    : 0;

  currentSearchPage = page;

  if (
    isSearchButtonClicked &&
    searchKeyword.trim() === "" &&
    searchType === "All"
  ) {
    showAlert(
      "Please enter a search keyword or select a specific prompt type.",
      "warning",
    );
    document.getElementById("searchResultsContainer").innerHTML =
      '<p class="no-prompts-message">Search results will appear here. Use "List All Prompts" to see all saved entries.</p>';
    document.getElementById("clearAllDbPrompts").style.display = "none";
    updatePaginationControls(0, 0);
    return;
  }

  const searchResultsContainer = document.getElementById(
    "searchResultsContainer",
  );
  searchResultsContainer.innerHTML =
    '<p class="no-prompts-message">Searching...</p>';
  document.getElementById("clearAllDbPrompts").style.display = "none";

  const queryParams = new URLSearchParams({
    page: currentSearchPage,
    limit: promptsPerPage,
    sort_by: sortBy,
    sort_dir: sortDir,
    search_mode: mode,
  });

  if (searchType !== "All") queryParams.append("type", searchType);
  if (searchKeyword.trim() !== "")
    queryParams.append("keyword", searchKeyword.trim());
  if (includeDeleted) queryParams.append("include_deleted", "1");

  try {
    const response = await fetch(
      `php/search_prompts.php?${queryParams.toString()}`,
    );
    if (!response.ok) throw new Error("Failed to fetch search results");

    const result = await response.json();
    searchResultsContainer.innerHTML = "";

    if (!result.prompts || result.prompts.length === 0) {
      searchResultsContainer.innerHTML =
        '<p class="no-prompts-message">No matching prompts found.</p>';
      document.getElementById("clearAllDbPrompts").style.display = "none";
    } else {
      result.prompts.forEach((prompt) => {
        addPromptToAccordion(
          prompt.title,
          prompt.generated_prompt,
          prompt.prompt_data,
          prompt.id,
          "#searchResultsContainer",
        );
      });
      document.getElementById("clearAllDbPrompts").style.display = "block";
    }

    totalPages = result.total_pages || 1;
    currentSearchPage = result.current_page || 1;
    updatePaginationControls();
  } catch (error) {
    console.error("Error searching prompts:", error);
    searchResultsContainer.innerHTML =
      '<p class="no-prompts-message" style="color:red;">Error searching prompts. Please check the server connection and PHP scripts.</p>';
    showAlert(`Error searching prompts: ${error.message}`, "error");
    updatePaginationControls(0, 0);
  }
}

function restorePrompt(data) {
  clearFormFields();
  lastRestoredPromptData = data;
  const method = data.method || "ptcf";

  // 1. Switch the hidden dropdown
  const methodSel = document.getElementById("methodSelector");
  if (methodSel) methodSel.value = method;

  // 2. Update the UI tabs visually to match
  document.querySelectorAll(".tab").forEach((tab) => {
    if (tab.dataset.method === method) {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });

  // 3. Unhide the correct section
  if (typeof showMethodFields === "function") showMethodFields();
  if (typeof toggleTemplateVisibility === "function")
    toggleTemplateVisibility();

  // 4. Restore the specific fields based on the method
  if (method === "ptcf") {
    document.getElementById("ptcf_task").value = data.task || "";
    document.getElementById("ptcf_format").value = data.format || "";
    document.getElementById("ptcf_context").value = data.context || "";
    document.getElementById("ptcf_references").value = data.references || "";
    document.getElementById("ptcf_iterate").value = data.iterate || "";
    const tagsToggle = document.getElementById("ptcf_add_tags");
    if (tagsToggle) tagsToggle.checked = !!data.addTags;

    document.getElementById("varAudience").value = data.vars?.audience || "";
    document.getElementById("varTone").value = data.vars?.tone || "";
    document.getElementById("varLength").value = data.vars?.length || "";
    const modeSel = document.getElementById("modeSelector");
    if (modeSel) modeSel.value = data.mode || "";
  } else if (method === "design") {
    document.getElementById("design_description").value =
      data.description || "";
    document.getElementById("design_environment").value =
      data.environment || "";
    document.getElementById("design_style").value = data.style || "";
    document.getElementById("design_illumination").value =
      data.illumination || "";
    document.getElementById("design_gradation").value = data.gradation || "";
    document.getElementById("design_nuances").value = data.nuances || "";
    document.getElementById("design_references").value = data.references || "";
    if (data.pod) {
      document.getElementById("pod_product").value =
        data.pod.product || "tshirt";
      document.getElementById("pod_units").value = data.pod.units || "in";
      document.getElementById("pod_dpi").value = data.pod.dpi ?? 300;
      document.getElementById("pod_bleed").value = data.pod.bleedPct ?? 0;
      document.getElementById("pod_safe").value = data.pod.safePct ?? 3;
      document.getElementById("pod_aspect").value = data.pod.aspect || "";
      document.getElementById("pod_bg").value = data.pod.bg || "transparent";
      if ((data.pod.units || "in") === "px") {
        document.getElementById("pod_w").value = data.pod.pixels?.width ?? "";
        document.getElementById("pod_h").value = data.pod.pixels?.height ?? "";
      } else {
        document.getElementById("pod_w").value = data.pod.wIn ?? "";
        document.getElementById("pod_h").value = data.pod.hIn ?? "";
      }
      try {
        computePodPixels();
      } catch (_) {}
    }
    if (data.gen) {
      document.getElementById("gen_model").value = data.gen.model || "";
      document.getElementById("gen_ar").value = data.gen.ar || "";
      document.getElementById("gen_seed").value = data.gen.seed || "";
      document.getElementById("gen_steps").value = data.gen.steps || "30";
      document.getElementById("gen_sampler").value = data.gen.sampler || "";
      document.getElementById("gen_cfg").value = data.gen.cfg || "7.5";
    }
  } else if (method === "agent") {
    document.getElementById("agent_objective").value = data.objective || "";
    document.getElementById("agent_success").value = data.success || "";
    document.getElementById("agent_scope").value = data.scope || "";
    document.getElementById("agent_outofscope").value = data.outofscope || "";
    document.getElementById("agent_constraints").value = data.constraints || "";
    document.getElementById("agent_env").value = data.env || "";
    document.getElementById("agent_extra_sources").value =
      data.extraVendors || "";
  } else if (method === "gem") {
    document.getElementById("gem_role").value = data.role || "";
    document.getElementById("gem_task").value = data.task || "";
    document.getElementById("gem_context").value = data.context || "";
    document.getElementById("gem_rules").value = data.rules || "";
    document.getElementById("gem_format").value = data.format || "";
    document.getElementById("gem_greeting").value = data.greeting || "";
    const headerToggle = document.getElementById("gem_add_headers");
    if (headerToggle) headerToggle.checked = data.addHeaders !== false;
  } else if (method === "code") {
    document.getElementById("code_framework").value = data.framework || "";
    document.getElementById("code_persona").value = data.persona || ""; // <-- NEW
    document.getElementById("code_operation").value = data.operation || "";
    document.getElementById("code_style").value = data.style || ""; // <-- NEW
    document.getElementById("code_logging").value = data.logging || ""; // <-- NEW
    document.getElementById("code_requirements").value =
      data.requirements || "";
    document.getElementById("code_input").value = data.codeInput || "";
    const strictToggle = document.getElementById("code_strict");
    if (strictToggle) strictToggle.checked = data.strict !== false;
  } else if (method === "notebook") {
    document.getElementById("notebook_focus").value = data.focus || "";
    document.getElementById("notebook_connection").value =
      data.connection || "";
    document.getElementById("notebook_audio").value = data.audio || "";
    document.getElementById("notebook_format").value = data.format || "";
  } else if (method === "fewshot") {
    document.getElementById("fewshot_system").value = data.system || "";
    document.getElementById("fewshot_schema").value = data.schema || "";
    const container = document.getElementById("fewshot_examples_container");
    if (container) container.innerHTML = "";

    if (data.examples && data.examples.length) {
      data.examples.forEach((ex) => {
        if (typeof addFewShotExample === "function")
          addFewShotExample(ex.input, ex.output);
      });
    } else {
      if (typeof addFewShotExample === "function") addFewShotExample();
    }
  } else if (method === "deep") {
    document.getElementById("deep_hypothesis").value = data.hypothesis || "";
    document.getElementById("deep_subtopics").value = data.subtopics || "";
    document.getElementById("deep_trusted").value = data.trusted || "";
    document.getElementById("deep_excluded").value = data.excluded || "";
    document.getElementById("deep_contradictions").value =
      data.contradictions || "";
  }

  // 5. Re-trigger auto-expand so the textareas resize to fit the loaded data
  if (typeof initializeAutoExpand === "function") initializeAutoExpand();

  // 6. Update the preview and scroll to top
  renderPreview();
  showAlert("Prompt loaded for editing.", "success");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showMethodFields() {
  const method = document.getElementById("methodSelector")?.value || "ptcf";
  const map = {
    ptcf: "ptcfMethod",
    design: "designMethod",
    agent: "agentMethod",
    gem: "gemMethod",
    code: "codeMethod",
    notebook: "notebookMethod",
    fewshot: "fewshotMethod",
    deep: "deepMethod",
  };
  [
    "ptcfMethod",
    "designMethod",
    "agentMethod",
    "gemMethod",
    "codeMethod",
    "notebookMethod",
    "fewshotMethod",
    "deepMethod",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("active", id === map[method]);
  });
  if (typeof renderPreview === "function") renderPreview();
}

function addPromptToAccordion(title, text, data, id, containerSel) {
  const container = document.querySelector(containerSel);
  const item = document.createElement("div");
  item.classList.add("accordion-item");
  item.dataset.prompt = JSON.stringify(data);
  item.dataset.uniqueId = id;
  const btn = document.createElement("button");
  btn.classList.add("accordion-button");
  btn.textContent = title;
  btn.onclick = function () {
    this.classList.toggle("active");
    const panel = this.nextElementSibling;
    if (panel.classList.contains("active")) {
      panel.classList.remove("active");
      panel.style.maxHeight = null;
    } else {
      panel.classList.add("active");
      panel.style.maxHeight = panel.scrollHeight + 80 + "px";
    }
  };
  const panel = document.createElement("div");
  panel.classList.add("accordion-panel");
  const pre = document.createElement("pre");
  pre.textContent = text;
  const bg = document.createElement("div");
  bg.classList.add("button-group");
  const copyBtn = document.createElement("button");
  copyBtn.classList.add("copy-button");
  copyBtn.textContent = "Copy";
  copyBtn.onclick = (e) => {
    e.stopPropagation();
    copyToClipboard(text, copyBtn);
  };
  const restoreBtn = document.createElement("button");
  restoreBtn.classList.add("load-button");
  restoreBtn.textContent = "Load for Editing";
  restoreBtn.onclick = (e) => {
    e.stopPropagation();
    restorePrompt(data);
  };
  bg.appendChild(copyBtn);
  bg.appendChild(restoreBtn);
  if (containerSel === "#searchResultsContainer") {
    const del = document.createElement("button");
    del.classList.add("delete-button");
    del.textContent = "Delete";
    del.onclick = (e) => {
      e.stopPropagation();
      deletePrompt(id);
    };
    bg.appendChild(del);
  }
  panel.appendChild(pre);
  panel.appendChild(bg);
  item.appendChild(btn);
  item.appendChild(panel);
  container.prepend(item);
  if (containerSel === "#sessionPromptHistoryContainer") {
    btn.click();
    item.scrollIntoView({ behavior: "smooth", block: "end" });
  }
}

function copyToClipboard(text, btn) {
  if (!text) {
    showAlert("No prompt to copy.", "warning");
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "absolute";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  const original = btn?.textContent || "Copy";
  try {
    ta.select();
    document.execCommand("copy");
    if (btn) {
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = original), 2000);
    }
    showAlert("Prompt copied to clipboard!", "success");
  } catch (err) {
    console.error(err);
    showAlert("Failed to copy.", "error");
  } finally {
    document.body.removeChild(ta);
  }
}

function listAllPrompts() {
  document.getElementById("searchPromptType").value = "All";
  document.getElementById("searchKeyword").value = "";
  document.getElementById("searchSortBy").value = "created_at";
  document.getElementById("searchSortDir").value = "desc";
  document.getElementById("searchMode").value = "auto";
  document.getElementById("includeDeleted").checked = false;
  searchPrompts(1, false);
}

function changePage(d) {
  const p = currentSearchPage + d;
  if (p >= 1 && p <= totalPages) {
    searchPrompts(p, false); // <--- Changed to false!
  }
}

function updatePaginationControls(cur = currentSearchPage, tot = totalPages) {
  document.getElementById("currentPageSpan").textContent =
    `Page ${cur} of ${tot}`;
  document.getElementById("prevPageBtn").disabled = cur === 1;
  document.getElementById("nextPageBtn").disabled = cur === tot || tot === 0;
}

document.addEventListener("DOMContentLoaded", () => {
  // 1. Safely attach the Clear Database button event
  const clearDbBtn = document.getElementById("clearAllDbPrompts");
  if (clearDbBtn) {
    clearDbBtn.onclick = async function () {
      if (!confirm("Clear ALL saved prompts from the database?")) return;
      try {
        const res = await fetch("php/clear_all_prompts.php", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          const eText = await res.text();
          throw new Error(eText || "Failed to clear");
        }
        const result = await res.json();
        showAlert(result.message, "success");
        listAllPrompts();
      } catch (err) {
        console.error(err);
        showAlert(`Error: ${err.message}`, "error");
      }
    };
  }

  // 2. Attach the autosave and live preview listeners to ALL inputs safely
  [
    "ptcf_persona",
    "ptcf_task",
    "ptcf_context",
    "ptcf_workspace_docs",
    "ptcf_format",
    "ptcf_constraints",
    "ptcf_ask_feedback",
    "ptcf_add_tags",
    "design_description",
    "design_environment",
    "design_style",
    "design_illumination",
    "design_gradation",
    "design_nuances",
    "design_references",
    "agentTemplate",
    "agent_objective",
    "agent_success",
    "agent_scope",
    "agent_outofscope",
    "agent_constraints",
    "agent_env",
    "agent_extra_sources",
    "varAudience",
    "varTone",
    "varLength",
    "modeSelector",
    "methodSelector",
    "gem_role",
    "gem_task",
    "gem_context",
    "gem_rules",
    "gem_format",
    "gem_greeting",
    "gem_add_headers",
    "code_framework",
    "code_persona", // <-- ADDED
    "code_operation",
    "code_style", // <-- ADDED
    "code_logging", // <-- ADDED
    "code_requirements",
    "code_input",
    "code_strict",
    "notebook_focus",
    "notebook_connection",
    "notebook_audio",
    "notebook_format",
    "fewshot_system",
    "fewshot_schema",
    "deep_hypothesis",
    "deep_subtopics",
    "deep_trusted",
    "deep_excluded",
    "deep_contradictions",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const ev =
      id === "ptcf_add_tags" ||
      id === "methodSelector" ||
      id === "modeSelector" ||
      id === "gem_add_headers" ||
      id === "code_strict" ||
      id === "ptcf_ask_feedback"
        ? "change"
        : "input";
    el.addEventListener(ev, () => {
      if (typeof renderPreview === "function") renderPreview();
      if (typeof scheduleAutosave === "function") scheduleAutosave();
    });
  });
});

function withVariables(text) {
  const rep = {
    "{{audience}}": val("varAudience") || "",
    "{{tone}}": val("varTone") || "",
    "{{length}}": val("varLength") || "",
    "{{topic}}": "your topic",
  };
  return Object.keys(rep).reduce(
    (acc, k) => acc.split(k).join(rep[k]),
    text || "",
  );
}

function lintPrompt(obj) {
  const issues = [];
  const t = [obj.task, obj.format, obj.context, obj.references, obj.iterate]
    .filter(Boolean)
    .join(" ");
  const audienceVar = val("varAudience").trim();
  const lengthVar = val("varLength").trim();
  const toneVar = val("varTone").trim();

  const hasAudience = audienceVar.length > 0 || /Audience:\s*[^\s{}]/i.test(t);
  const hasLength =
    lengthVar.length > 0 ||
    /Length:\s*[^\s{}]/i.test(t) ||
    /\b~?\d+\s*(words?|chars?|tokens?)\b/i.test(t);
  const hasTone = toneVar.length > 0 || /Tone:\s*[^\s{}]/i.test(t);

  if (!obj.task?.trim()) issues.push("No task provided.");
  if (!hasAudience) issues.push("No audience specified.");
  if (!hasLength) issues.push("No length guidance.");
  if (!hasTone) issues.push("No tone specified.");

  if ((t.match(/\b(very|really|stuff|things)\b/gi) || []).length > 3)
    issues.push("Ambiguous words detected (very/really/stuff/things).");
  if ((t.match(/\band also\b/gi) || []).length > 0)
    issues.push('Redundant phrase: "and also".');
  return issues;
}

function estimateTokens(s) {
  const chars = (s || "").length;
  const words = (s || "").trim().split(/\s+/).filter(Boolean).length;
  const a = Math.ceil(chars / 4),
    b = Math.ceil(words / 0.75);
  return Math.round((a + b) / 2);
}

function stripContextLabels(ctx) {
  ctx = ctx || "";
  const lines = ctx
    .split(/\r?\n/)
    .filter((line) => !/^\s*(Audience|Tone|Length)\s*:/i.test(line));
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ensureVarsInContext(ctx) {
  const a = val("varAudience").trim();
  const t = val("varTone").trim();
  const l = val("varLength").trim();
  ctx = stripContextLabels(ctx);
  const add = [];
  if (a) add.push(`Audience: ${a}`);
  if (t) add.push(`Tone: ${t}`);
  if (l) add.push(`Length: ${l}`);
  if (add.length) ctx = (ctx ? ctx + "\n" : "") + add.join("\n");
  return ctx;
}

function buildPromptObj() {
  const methodSel = document.getElementById("methodSelector");
  if (!methodSel || methodSel.value !== "ptcf") return { text: "" };

  const addTags = !!document.getElementById("ptcf_add_tags")?.checked;
  const askFeedback = !!document.getElementById("ptcf_ask_feedback")?.checked;
  const get = (id) => (document.getElementById(id)?.value || "").trim();
  const W = (s) => withVariables(s);

  let persona = W(get("ptcf_persona"));
  let task = W(get("ptcf_task"));
  let context = W(get("ptcf_context"));
  let format = W(get("ptcf_format"));
  let constraints = W(get("ptcf_constraints"));
  let docsRaw = get("ptcf_workspace_docs");

  context = ensureVarsInContext(context);
  let docsFormatted = "";
  if (docsRaw) {
    docsFormatted = docsRaw
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => `@[${d}]`)
      .join(" ");
  }

  let finalContext = context;
  if (docsFormatted) finalContext += `\nReferenced Documents: ${docsFormatted}`;
  if (askFeedback)
    format +=
      (format ? "\n\n" : "") +
      "What questions do you have for me that would help you provide the best output?";

  if (addTags) {
    const blocks = [];
    if (persona) blocks.push(`<persona>${persona}</persona>`);
    if (task) blocks.push(`<task>${task}</task>`);
    if (finalContext) blocks.push(`<context>${finalContext}</context>`);
    if (format) blocks.push(`<format>${format}</format>`);
    if (constraints) blocks.push(`<constraints>${constraints}</constraints>`);
    return {
      addTags: true,
      text: blocks.join("\n"),
      persona,
      task,
      context: finalContext,
      format,
      constraints,
    };
  } else {
    const parts = [];
    if (persona) parts.push(`Persona: ${persona}`);
    if (task) parts.push(`Task: ${task}`);
    if (finalContext) parts.push(`Context: ${finalContext}`);
    if (format) parts.push(`Format: ${format}`);
    if (constraints) parts.push(`Constraints: ${constraints}`);
    return {
      addTags: false,
      text: parts.join("\n\n"),
      persona,
      task,
      context: finalContext,
      format,
      constraints,
    };
  }
}

function exportGem() {
  const get = (id) => (document.getElementById(id)?.value || "").trim();
  const persona = get("ptcf_persona");
  const context = get("ptcf_context");
  const format = get("ptcf_format");
  const constraints = get("ptcf_constraints");

  const parts = [
    persona ? `Role/Persona:\n${persona}` : "",
    context ? `Context/Background:\n${context}` : "",
    format ? `Default Format:\n${format}` : "",
    constraints ? `Constraints/Rules:\n${constraints}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!parts) {
    showAlert(
      "Fill out Persona, Context, Format, or Constraints first to build a Gem.",
      "warning",
    );
    return;
  }
  copyToClipboard(parts, null);
  showAlert("Gem System Instructions copied to clipboard!", "success");
}

function renderPreview() {
  const method = document.getElementById("methodSelector")?.value || "ptcf";
  let obj = { text: "" };
  let issues = [];

  try {
    if (method === "ptcf" || method === "tcrei") {
      if (typeof buildPromptObj === "function")
        obj = buildPromptObj() || { text: "" };
      if (typeof lintPrompt === "function") issues = lintPrompt(obj) || [];
    } else if (method === "design") {
      if (typeof buildDesignObj === "function")
        obj = buildDesignObj() || { text: "" };
      if (typeof lintDesign === "function") issues = lintDesign(obj) || [];
    } else if (method === "agent") {
      if (typeof buildAgentObj === "function")
        obj = buildAgentObj() || { text: "" };
      if (typeof lintAgent === "function") issues = lintAgent(obj) || [];
    } else if (method === "gem") {
      if (typeof buildGemObj === "function")
        obj = buildGemObj() || { text: "" };
    } else if (method === "code") {
      if (typeof buildCodeObj === "function")
        obj = buildCodeObj() || { text: "" };
    } else if (method === "notebook") {
      if (typeof buildNotebookObj === "function")
        obj = buildNotebookObj() || { text: "" };
    } else if (method === "fewshot") {
      if (typeof buildFewShotObj === "function")
        obj = buildFewShotObj() || { text: "" };
    } else if (method === "deep") {
      if (typeof buildDeepObj === "function")
        obj = buildDeepObj() || { text: "" };
    }
  } catch (err) {
    console.error("Error building prompt object for preview:", err);
  }

  const previewEl = document.getElementById("livePreview");
  if (previewEl) {
    if (obj && obj.text && obj.text.trim() !== "") {
      previewEl.innerText = obj.text;
      previewEl.style.color = "#c9d1d9";
    } else {
      previewEl.innerText = "Start typing to see a live preview...";
      previewEl.style.color = "#8b949e";
    }
  }
  if (typeof updateTokensAndLinting === "function") {
    updateTokensAndLinting(obj.text || "", issues);
  }
}

function makeABVariants() {
  const base = buildPromptObj();
  if (!base.text.trim()) {
    showAlert("Nothing to variant — fill some fields first.", "warning");
    return;
  }
  const A = base.text.replace(/Tone:[^\n]+/i, "Tone: friendly and concise");
  const B = base.text.replace(/Tone:[^\n]+/i, "Tone: persuasive and energetic");
  addPromptToAccordion(
    "Variant A",
    A,
    { method: "ptcf", variant: "A" },
    "ab-A-" + Date.now(),
    "#sessionPromptHistoryContainer",
  );
  addPromptToAccordion(
    "Variant B",
    B,
    { method: "ptcf", variant: "B" },
    "ab-B-" + Date.now(),
    "#sessionPromptHistoryContainer",
  );
  showAlert("Generated A/B variants in session history.", "success");
}

const RANDOM_SETS = {
  task: [
    "Write a blog post explaining {{topic}} to {{audience}}.",
    "Draft a social post series (5 posts) on {{topic}}.",
    "Summarise a long article into bullet points for {{audience}}.",
    "Create a how-to guide for {{topic}} with steps.",
  ],
};

function randomiseField(id, key) {
  const arr = RANDOM_SETS[key] || [];
  if (!arr.length) return;
  const choice = arr[Math.floor(Math.random() * arr.length)];
  document.getElementById(id).value = choice;
  renderPreview();
  scheduleAutosave();
}

const DRAFT_KEY = "prompt_draft_v1";
if (window.__autosaveTimer === undefined) window.__autosaveTimer = null;

function scheduleAutosave() {
  const b = $("autosaveStatus");
  if (b) b.textContent = "Autosave: typing…";
  if (window.__autosaveTimer) clearTimeout(window.__autosaveTimer);
  window.__autosaveTimer = setTimeout(saveDraft, 600);
}

function currentPromptData() {
  const method = $("methodSelector")?.value || "ptcf";
  if (method === "ptcf") {
    return {
      method,
      task: val("ptcf_task"),
      format: val("ptcf_format"),
      context: val("ptcf_context"),
      references: val("ptcf_references"),
      iterate: val("ptcf_iterate"),
      addTags: checked("ptcf_add_tags"),
      vars: {
        audience: val("varAudience"),
        tone: val("varTone"),
        length: val("varLength"),
      },
      mode: val("modeSelector"),
    };
  }
  if (method === "design") {
    const built = buildDesignObj();
    return {
      method,
      description: built.description,
      environment: built.environment,
      style: built.style,
      illumination: built.illumination,
      gradation: built.gradation,
      nuances: built.nuances,
      references: built.references,
      pod: built.pod || null,
      gen: built.gen || null,
      preview: built.text,
    };
  }
  if (method === "agent") {
    return {
      method,
      objective: val("agent_objective"),
      success: val("agent_success"),
      scope: val("agent_scope"),
      outofscope: val("agent_outofscope"),
      constraints: val("agent_constraints"),
      env: val("agent_env"),
      extraVendors: val("agent_extra_sources"),
    };
  }
  if (method === "gem") {
    return {
      method,
      role: val("gem_role"),
      task: val("gem_task"),
      context: val("gem_context"),
      rules: val("gem_rules"),
      format: val("gem_format"),
      greeting: val("gem_greeting"),
      addHeaders: checked("gem_add_headers"),
    };
  }
  if (method === "code") {
    return {
      method,
      framework: val("code_framework"),
      persona: val("code_persona"), // <-- NEW
      operation: val("code_operation"),
      style: val("code_style"), // <-- NEW
      logging: val("code_logging"), // <-- NEW
      requirements: val("code_requirements"),
      codeInput: val("code_input"),
      strict: checked("code_strict"),
    };
  }
  if (method === "fewshot") {
    const examples = [];
    document.querySelectorAll(".fewshot-pair").forEach((p) => {
      examples.push({
        input: p.querySelector(".fs-in").value,
        output: p.querySelector(".fs-out").value,
      });
    });
    return {
      method,
      system: val("fewshot_system"),
      schema: val("fewshot_schema"),
      examples: examples,
    };
  }
  if (method === "notebook") {
    return {
      method,
      focus: val("notebook_focus"),
      connection: val("notebook_connection"),
      audio: val("notebook_audio"),
      format: val("notebook_format"),
    };
  }
  if (method === "deep") {
    return {
      method,
      hypothesis: val("deep_hypothesis"),
      subtopics: val("deep_subtopics"),
      trusted: val("deep_trusted"),
      excluded: val("deep_excluded"),
      contradictions: val("deep_contradictions"),
    };
  }
  return { method };
}

function saveDraft() {
  const data = currentPromptData();
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    setAutosaveStatus("saved", "Autosave: saved");
    const b = $("autosaveStatus");
    if (b) b.textContent = "Autosave: saved";
  } catch (e) {
    console.warn("Autosave failed:", e);
  }
}

function restoreDraft() {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) {
    showAlert("No draft found.", "info");
    return;
  }
  const d = JSON.parse(raw);
  document.getElementById("methodSelector").value = d.method || "ptcf";
  document.querySelectorAll(".tab").forEach((tab) => {
    if (tab.dataset.method === (d.method || "ptcf")) {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });
  showMethodFields();

  if (d.method === "ptcf" || !d.method) {
    document.getElementById("ptcf_task").value = d.task || "";
    document.getElementById("ptcf_format").value = d.format || "";
    document.getElementById("ptcf_context").value = d.context || "";
    document.getElementById("ptcf_references").value = d.references || "";
    document.getElementById("ptcf_iterate").value = d.iterate || "";
    const tagsToggle = document.getElementById("ptcf_add_tags");
    if (tagsToggle) tagsToggle.checked = !!d.addTags;
    document.getElementById("varAudience").value = d.vars?.audience || "";
    document.getElementById("varTone").value = d.vars?.tone || "";
    document.getElementById("varLength").value = d.vars?.length || "";
    const modeSel = document.getElementById("modeSelector");
    if (modeSel) modeSel.value = d.mode || "";
  } else if (d.method === "design") {
    document.getElementById("design_description").value = d.description || "";
    document.getElementById("design_environment").value = d.environment || "";
    document.getElementById("design_style").value = d.style || "";
    document.getElementById("design_illumination").value = d.illumination || "";
    document.getElementById("design_gradation").value = d.gradation || "";
    document.getElementById("design_nuances").value = d.nuances || "";
    document.getElementById("design_references").value = d.references || "";
    if (d.pod) {
      pod_product.value = d.pod.product || "tshirt";
      pod_units.value = d.pod.units || "in";
      pod_dpi.value = d.pod.dpi ?? 300;
      pod_bleed.value = d.pod.bleedPct ?? 0;
      pod_safe.value = d.pod.safePct ?? 3;
      pod_aspect.value = d.pod.aspect || "";
      pod_bg.value = d.pod.bg || "transparent";
      if ((d.pod.units || "in") === "px") {
        pod_w.value = d.pod.pixels?.width ?? "";
        pod_h.value = d.pod.pixels?.height ?? "";
      } else {
        pod_w.value = d.pod.wIn ?? "";
        pod_h.value = d.pod.hIn ?? "";
      }
      try {
        computePodPixels();
      } catch (_) {}
    }
    if (d.gen) {
      document.getElementById("gen_model").value = d.gen.model || "";
      document.getElementById("gen_ar").value = d.gen.ar || "";
      document.getElementById("gen_seed").value = d.gen.seed || "";
      document.getElementById("gen_steps").value = d.gen.steps || "30";
      document.getElementById("gen_sampler").value = d.gen.sampler || "";
      document.getElementById("gen_cfg").value = d.gen.cfg || "7.5";
    }
  } else if (d.method === "agent") {
    document.getElementById("agent_objective").value = d.objective || "";
    document.getElementById("agent_success").value = d.success || "";
    document.getElementById("agent_scope").value = d.scope || "";
    document.getElementById("agent_outofscope").value = d.outofscope || "";
    document.getElementById("agent_constraints").value = d.constraints || "";
    document.getElementById("agent_env").value = d.env || "";
    document.getElementById("agent_extra_sources").value = d.extraVendors || "";
  } else if (d.method === "gem") {
    document.getElementById("gem_role").value = d.role || "";
    document.getElementById("gem_task").value = d.task || "";
    document.getElementById("gem_context").value = d.context || "";
    document.getElementById("gem_rules").value = d.rules || "";
    document.getElementById("gem_format").value = d.format || "";
    document.getElementById("gem_greeting").value = d.greeting || "";
    const headerToggle = document.getElementById("gem_add_headers");
    if (headerToggle) headerToggle.checked = d.addHeaders !== false;
  } else if (d.method === "code") {
    document.getElementById("code_framework").value = d.framework || "";
    document.getElementById("code_persona").value = d.persona || ""; // <-- NEW
    document.getElementById("code_operation").value = d.operation || "";
    document.getElementById("code_style").value = d.style || ""; // <-- NEW
    document.getElementById("code_logging").value = d.logging || ""; // <-- NEW
    document.getElementById("code_requirements").value = d.requirements || "";
    document.getElementById("code_input").value = d.codeInput || "";
    const strictToggle = document.getElementById("code_strict");
    if (strictToggle) strictToggle.checked = d.strict !== false;
  } else if (d.method === "notebook") {
    document.getElementById("notebook_focus").value = d.focus || "";
    document.getElementById("notebook_connection").value = d.connection || "";
    document.getElementById("notebook_audio").value = d.audio || "";
    document.getElementById("notebook_format").value = d.format || "";
  } else if (d.method === "fewshot") {
    document.getElementById("fewshot_system").value = d.system || "";
    document.getElementById("fewshot_schema").value = d.schema || "";
    const container = document.getElementById("fewshot_examples_container");
    if (container) container.innerHTML = ""; // Clear existing blocks

    if (d.examples && d.examples.length) {
      d.examples.forEach((ex) => {
        if (typeof addFewShotExample === "function")
          addFewShotExample(ex.input, ex.output);
      });
    } else {
      if (typeof addFewShotExample === "function") addFewShotExample(); // Add one blank pair
    }
  } else if (d.method === "deep") {
    document.getElementById("deep_hypothesis").value = d.hypothesis || "";
    document.getElementById("deep_subtopics").value = d.subtopics || "";
    document.getElementById("deep_trusted").value = d.trusted || "";
    document.getElementById("deep_excluded").value = d.excluded || "";
    document.getElementById("deep_contradictions").value =
      d.contradictions || "";
  }
  if (typeof initializeAutoExpand === "function") initializeAutoExpand();
  renderPreview();
  showAlert("Draft restored.", "success");
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
  setAutosaveStatus("clear", "Autosave: cleared");
  const b = document.getElementById("autosaveStatus");
  if (b) b.textContent = "Autosave: cleared";
}

[
  "ptcf_persona",
  "ptcf_task",
  "ptcf_context",
  "ptcf_workspace_docs",
  "ptcf_format",
  "ptcf_constraints",
  "ptcf_ask_feedback",
  "ptcf_add_tags",
  "design_description",
  "design_environment",
  "design_style",
  "design_illumination",
  "design_gradation",
  "design_nuances",
  "design_references",
  "agentTemplate",
  "agent_objective",
  "agent_success",
  "agent_scope",
  "agent_outofscope",
  "agent_constraints",
  "agent_env",
  "agent_extra_sources",
  "varAudience",
  "varTone",
  "varLength",
  "modeSelector",
  "methodSelector",
  "gem_role",
  "gem_task",
  "gem_context",
  "gem_rules",
  "gem_format",
  "gem_greeting",
  "gem_add_headers",
  "code_framework",
  "code_operation",
  "code_requirements",
  "code_input",
  "code_strict",
  "notebook_focus",
  "notebook_connection",
  "notebook_audio",
  "notebook_format",
  "fewshot_system",
  "fewshot_schema",
].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  const ev =
    id === "ptcf_add_tags" ||
    id === "methodSelector" ||
    id === "modeSelector" ||
    id === "gem_add_headers" ||
    id === "code_strict" ||
    id === "ptcf_ask_feedback"
      ? "change"
      : "input";
  el.addEventListener(ev, () => {
    renderPreview();
    scheduleAutosave();
  });
});

function copyPreview(clean = false) {
  const obj = buildActiveObj();
  const text = clean
    ? (obj.text || "").replace(/<\/?[^>]+(>|$)/g, "")
    : obj.text || "";
  copyToClipboard(text, { textContent: "Copied" });
}

function exportPrompt() {
  const data = currentPromptData();
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prompt-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importPrompt(e) {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = (ev) => {
    try {
      const d = JSON.parse(ev.target.result);
      if (d.method !== "ptcf") throw new Error("Not a ptcf prompt file.");
      document.getElementById("ptcf_task").value = d.task || "";
      document.getElementById("ptcf_format").value = d.format || "";
      document.getElementById("ptcf_context").value = d.context || "";
      document.getElementById("ptcf_references").value = d.references || "";
      document.getElementById("ptcf_iterate").value = d.iterate || "";
      document.getElementById("ptcf_add_tags").checked = !!d.addTags;
      document.getElementById("varAudience").value = d.vars?.audience || "";
      document.getElementById("varTone").value = d.vars?.tone || "";
      document.getElementById("varLength").value = d.vars?.length || "";
      document.getElementById("modeSelector").value = d.mode || "";
      renderPreview();
      scheduleAutosave();
      showAlert("Prompt imported.", "success");
    } catch (err) {
      showAlert("Import failed: " + err.message, "error");
    }
  };
  r.readAsText(f);
}

document.addEventListener("keydown", (e) => {
  const cmd = e.metaKey || e.ctrlKey;
  if (!cmd) return;
  if (e.key.toLowerCase() === "enter") {
    e.preventDefault();
    generatePromptAndSave("ptcf");
  }
  if (e.key.toLowerCase() === "k") {
    e.preventDefault();
    clearFormFields();
    renderPreview();
  }
  if (e.key === "/") {
    e.preventDefault();
    document.querySelectorAll(".tooltiptext").forEach((tt) => {
      tt.style.visibility =
        tt.style.visibility === "visible" ? "hidden" : "visible";
      tt.style.opacity = tt.style.opacity === "1" ? "0" : "1";
    });
  }
});

let __APP_INITIALIZED__ = false;

function markFirstRunOnce() {
  const key = "__gpc_first_run__";
  const firstRun = !localStorage.getItem(key);
  if (firstRun) localStorage.setItem(key, "1");
  return firstRun;
}

async function initAppOnce() {
  if (__APP_INITIALIZED__) return;
  __APP_INITIALIZED__ = true;

  setAutosaveStatus("idle", "Autosave: idle");

  await initAgentTemplateSelectFromDB();
  await initptcfTemplateSelectFromDB();

  showMethodFields();
  toggleTemplateVisibility();
  document.getElementById("searchResultsContainer").innerHTML =
    '<p class="no-prompts-message">Search results will appear here. Use "List All Prompts" to see all saved entries.</p>';
  document.getElementById("clearAllDbPrompts").style.display = "none";
  updatePaginationControls();

  const prefs = JSON.parse(localStorage.getItem("search_prefs") || "{}");
  if (prefs.type)
    document.getElementById("searchPromptType").value = prefs.type;
  if (prefs.kw) document.getElementById("searchKeyword").value = prefs.kw;
  if (prefs.by) document.getElementById("searchSortBy").value = prefs.by;
  if (prefs.dir) document.getElementById("searchSortDir").value = prefs.dir;
  if (prefs.mode) document.getElementById("searchMode").value = prefs.mode;
  if (prefs.del)
    document.getElementById("includeDeleted").checked = !!prefs.del;

  [
    "searchPromptType",
    "searchKeyword",
    "searchSortBy",
    "searchSortDir",
    "searchMode",
    "includeDeleted",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      localStorage.setItem(
        "search_prefs",
        JSON.stringify({
          type: document.getElementById("searchPromptType").value,
          kw: document.getElementById("searchKeyword").value,
          by: document.getElementById("searchSortBy").value,
          dir: document.getElementById("searchSortDir").value,
          mode: document.getElementById("searchMode").value,
          del: document.getElementById("includeDeleted").checked ? 1 : 0,
        }),
      );
    });
  });

  setTimeout(() => {
    renderPreview();
  }, 0);
}

document.addEventListener("DOMContentLoaded", initAppOnce);

if (
  document.readyState === "interactive" ||
  document.readyState === "complete"
) {
  initAppOnce();
}

function buildActiveObj() {
  const method = document.getElementById("methodSelector").value;
  if (method === "ptcf" || method === "tcrei") return buildPromptObj();
  if (method === "design") return buildDesignObj();
  if (method === "agent") return buildAgentObj();
  if (method === "code") {
    if (typeof buildCodeObj === "function") return buildCodeObj();
  }
  if (method === "gem") {
    if (typeof buildGemObj === "function") return buildGemObj();
  }
  if (method === "notebook") {
    if (typeof buildNotebookObj === "function") return buildNotebookObj();
  }
  if (method === "fewshot") {
    if (typeof buildFewShotObj === "function") return buildFewShotObj();
  }
  if (method === "deep") {
    if (typeof buildDeepObj === "function") return buildDeepObj();
  }
  return { text: "" };
}

function toggleTemplateVisibility() {
  const method = document.getElementById("methodSelector")?.value || "ptcf";
  const inline = document.querySelector(".inline-controls");
  if (inline) inline.style.display = method === "ptcf" ? "flex" : "none";

  const agentTplWrap = document.getElementById("agentTemplate")?.closest("div");
  if (agentTplWrap)
    agentTplWrap.style.display = method === "agent" ? "" : "none";
}

document.addEventListener("DOMContentLoaded", () => {
  const methodSel = document.getElementById("methodSelector");
  if (methodSel) {
    methodSel.addEventListener("change", () => {
      if (typeof showMethodFields === "function") showMethodFields();
      if (typeof toggleTemplateVisibility === "function")
        toggleTemplateVisibility();
    });
  }
});

function stripPlaceholders(text) {
  return (text || "")
    .replace(/^.*\{\{[^}]+\}\}.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

document.addEventListener("DOMContentLoaded", () => {
  const tts = [].slice.call(
    document.querySelectorAll('[data-bs-toggle="tooltip"]'),
  );
  tts.forEach((el) => {
    new bootstrap.Tooltip(el, {
      container: "body",
      html: true,
      boundary: "window",
    });
  });
});

function switchTab(methodName) {
  document.querySelectorAll(".tab").forEach((tab) => {
    if (tab.dataset.method === methodName) tab.classList.add("active");
    else tab.classList.remove("active");
  });
  const selector = document.getElementById("methodSelector");
  selector.value = methodName;
  const event = new Event("change");
  selector.dispatchEvent(event);
}

function initializeAutoExpand() {
  document.querySelectorAll("textarea").forEach((textarea) => {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + 2 + "px";
    textarea.addEventListener("input", function () {
      this.style.height = "auto";
      this.style.height = this.scrollHeight + 2 + "px";
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(initializeAutoExpand, 100);
});

function buildGemObj() {
  if (document.getElementById("methodSelector").value !== "gem")
    return { text: "" };
  const get = (id) => (document.getElementById(id)?.value || "").trim();
  const useHeaders = !!document.getElementById("gem_add_headers")?.checked;

  const role = get("gem_role");
  const task = get("gem_task");
  const context = get("gem_context");
  const rules = get("gem_rules");
  const format = get("gem_format");
  const greeting = get("gem_greeting");

  const parts = [];
  const addSection = (title, content) => {
    if (!content) return;
    parts.push(
      useHeaders ? `## ${title}\n${content}` : `${title}:\n${content}`,
    );
  };

  addSection("Role & Persona", role);
  addSection("Primary Goal", task);
  addSection("Context & Knowledge", context);
  addSection("Rules & Constraints", rules);
  addSection("Output Format", format);

  let text = parts.join("\n\n");
  if (greeting) text += `\n\n---\n**Suggested Gem Greeting:**\n${greeting}`;
  return { text, role, task, context, rules, format, greeting };
}

function buildCodeObj() {
  if (document.getElementById("methodSelector").value !== "code")
    return { text: "" };
  const get = (id) => (document.getElementById(id)?.value || "").trim();

  const framework = get("code_framework");
  const persona = get("code_persona"); // <-- NEW
  const operation = get("code_operation");
  const style = get("code_style"); // <-- NEW
  const logging = get("code_logging"); // <-- NEW
  const requirements = get("code_requirements");
  const codeInput = get("code_input");
  const strict = !!document.getElementById("code_strict")?.checked;

  const parts = [];

  // Dynamically build the Persona/Context sentence
  let contextStr = "Context: You are an expert";
  if (framework) contextStr += ` ${framework}`;
  if (persona) contextStr += ` ${persona}`;
  else contextStr += " developer";
  parts.push(contextStr + ".");

  if (operation) parts.push(`Task: ${operation}`);
  if (requirements) parts.push(`Requirements:\n${requirements}`);

  // Inject the new Standards and Logging block
  if (style || logging) {
    let standardsStr = "Standards & Style:\n";
    if (style) standardsStr += `- ${style}\n`;
    if (logging) standardsStr += `- ${logging}\n`;
    parts.push(standardsStr.trim());
  }

  if (codeInput) parts.push(`Current Code:\n\`\`\`\n${codeInput}\n\`\`\``);

  if (strict) {
    parts.push(
      `CRITICAL INSTRUCTION: Output ONLY valid, runnable code. Do not include markdown code block backticks (unless required by the IDE). Do not include conversational filler, explanations, or greetings. Your output will be piped directly into a compiler.`,
    );
  }

  return {
    text: parts.join("\n\n"),
    framework,
    persona, // <-- NEW
    operation,
    style, // <-- NEW
    logging, // <-- NEW
    requirements,
    codeInput,
    strict,
  };
}

function buildNotebookObj() {
  if (document.getElementById("methodSelector").value !== "notebook")
    return { text: "" };
  const get = (id) => (document.getElementById(id)?.value || "").trim();

  const focus = get("notebook_focus");
  const connection = get("notebook_connection");
  const audio = get("notebook_audio");
  const format = get("notebook_format");

  const parts = [];
  if (focus) parts.push(`Source Focus:\n${focus}`);
  if (connection) parts.push(`Analysis Instructions:\n${connection}`);
  if (format) parts.push(`Output Format:\n${format}`);

  if (audio) {
    parts.push(`--- AUDIO OVERVIEW DIRECTOR ---`);
    parts.push(`Instructions for podcast hosts:\n${audio}`);
  }

  return { text: parts.join("\n\n"), focus, connection, audio, format };
}
// Adds dynamic Example pairs to the DOM
function addFewShotExample(inVal = "", outVal = "") {
  const container = document.getElementById("fewshot_examples_container");
  const idx = container.children.length + 1;
  const div = document.createElement("div");
  div.className = "fewshot-pair";
  div.style.border = "1px solid #30363d";
  div.style.padding = "15px";
  div.style.marginBottom = "15px";
  div.style.borderRadius = "6px";
  div.style.position = "relative";
  div.style.background = "#11151c";

  div.innerHTML = `
    <span style="position:absolute; top:10px; right:15px; cursor:pointer; color:#f85149; font-weight:bold; font-size:1.2em;" title="Remove Example" onclick="this.parentElement.remove(); renderPreview(); scheduleAutosave();">&times;</span>
    <label style="font-size:0.9em; color:#8b949e;">Example ${idx} Input:</label>
    <textarea class="fs-in" style="min-height:50px; margin-bottom:10px;" placeholder="e.g., The raw text the AI will receive...">${inVal}</textarea>
    <label style="font-size:0.9em; color:#8b949e;">Example ${idx} Expected Output:</label>
    <textarea class="fs-out" style="min-height:50px; margin-bottom:0;" placeholder="e.g., Exactly what the AI should respond with...">${outVal}</textarea>
  `;
  container.appendChild(div);

  // Attach auto-expand and autosave to the new dynamic textareas
  div.querySelectorAll("textarea").forEach((t) => {
    t.addEventListener("input", () => {
      renderPreview();
      scheduleAutosave();
    });
    t.style.height = "auto";
    t.style.height = t.scrollHeight + 2 + "px";
    t.addEventListener("input", function () {
      this.style.height = "auto";
      this.style.height = this.scrollHeight + 2 + "px";
    });
  });
  renderPreview();
  scheduleAutosave();
}
function buildDeepObj() {
  if (document.getElementById("methodSelector").value !== "deep")
    return { text: "" };
  const get = (id) => (document.getElementById(id)?.value || "").trim();

  const hypothesis = get("deep_hypothesis");
  const subtopics = get("deep_subtopics");
  const trusted = get("deep_trusted");
  const excluded = get("deep_excluded");
  const contradictions = get("deep_contradictions");

  const parts = [];
  if (hypothesis) parts.push(`CORE RESEARCH OBJECTIVE:\n${hypothesis}`);
  if (subtopics)
    parts.push(`REQUIRED SUB-TOPICS (Explore these thoroughly):\n${subtopics}`);

  if (trusted || excluded) {
    parts.push(`--- SOURCE BOUNDARIES ---`);
    if (trusted) parts.push(`Trusted Sources / Priorities:\n${trusted}`);
    if (excluded) parts.push(`Explicit Exclusions:\n${excluded}`);
  }

  if (contradictions)
    parts.push(
      `--- ANALYSIS PROTOCOL ---\nContradiction Handling:\n${contradictions}`,
    );

  // Standard Deep Research safety/stop condition
  parts.push(
    `--- EXECUTION RULES ---\nDo not stop researching until you have thoroughly explored all sub-topics using the approved source boundaries. Provide inline citations [Source Name](URL) for every factual claim.`,
  );

  return {
    text: parts.join("\n\n"),
    hypothesis,
    subtopics,
    trusted,
    excluded,
    contradictions,
  };
}
function buildFewShotObj() {
  if (document.getElementById("methodSelector").value !== "fewshot")
    return { text: "" };
  const get = (id) => (document.getElementById(id)?.value || "").trim();

  const system = get("fewshot_system");
  const schema = get("fewshot_schema");

  const parts = [];
  if (system) parts.push(`System Instruction:\n${system}`);

  const pairs = document.querySelectorAll(".fewshot-pair");
  const examplesList = [];

  pairs.forEach((p, index) => {
    const inTxt = p.querySelector(".fs-in").value.trim();
    const outTxt = p.querySelector(".fs-out").value.trim();
    if (inTxt || outTxt) {
      parts.push(
        `--- Example ${index + 1} ---\nINPUT:\n${inTxt}\n\nEXPECTED OUTPUT:\n${outTxt}`,
      );
      examplesList.push({ input: inTxt, output: outTxt });
    }
  });

  if (schema) parts.push(`Enforced Output Format:\n${schema}`);

  // Add the final execution block
  parts.push(
    `--- ACTUAL TASK ---\nINPUT:\n[PASTE YOUR NEW DATA HERE]\n\nEXPECTED OUTPUT:\n`,
  );

  return { text: parts.join("\n\n"), system, schema, examples: examplesList };
}
