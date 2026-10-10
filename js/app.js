/* =====================================================
   AI CAREER RECOMMENDATION  —  application logic
   API_KEY / API_URL / MODELS come from js/config.js,
   which loads them from the ".env" file at the project
   root. We wait for the ENV_READY promise before using
   them so the key is available by the time we call the API.
   ===================================================== */

(function () {
  "use strict";

  /* ---------- tiny helpers ---------- */
  function $(id) { return document.getElementById(id); }

  function escapeHTML(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var toastTimer = null;
  function showToast(message) {
    var toast = $("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 2200);
  }

  /* =====================================================
     USER INFO  (save / load via localStorage)
     ===================================================== */

  function saveUser() {
    var name = $("name").value.trim();
    var age = $("age").value.trim();
    var education = $("education").value.trim();
    var error = $("userError");

    function fail(msg) {
      if (error) { error.textContent = msg; error.style.display = "block"; }
    }

    if (!name || !age || !education) { fail("❌ Please fill all details."); return; }

    var ageNum = Number(age);
    if (isNaN(ageNum) || ageNum < 10 || ageNum > 100) {
      fail("❌ Please enter a valid age between 10 and 100.");
      return;
    }

    if (error) { error.textContent = ""; error.style.display = "none"; }

    try {
      localStorage.setItem("careerName", name);
      localStorage.setItem("careerAge", age);
      localStorage.setItem("careerEducation", education);
    } catch (e) { console.warn("localStorage unavailable:", e); }

    window.location.href = "recommendation.html";
  }

  function loadUser() {
    var name = "", age = "", education = "";
    try {
      name = localStorage.getItem("careerName") || "";
      age = localStorage.getItem("careerAge") || "";
      education = localStorage.getItem("careerEducation") || "";
    } catch (e) { console.warn("localStorage unavailable:", e); }

    if ($("displayName")) $("displayName").textContent = name || "-";
    if ($("displayAge")) $("displayAge").textContent = age || "-";
    if ($("displayEducation")) $("displayEducation").textContent = education || "-";
    if ($("educationInput")) $("educationInput").value = education;
  }

  // Prefill the user form so returning users don't retype their details.
  function prefillUserForm() {
    try {
      var name = localStorage.getItem("careerName") || "";
      var age = localStorage.getItem("careerAge") || "";
      var education = localStorage.getItem("careerEducation") || "";
      if (name && $("name")) $("name").value = name;
      if (age && $("age")) $("age").value = age;
      if (education && $("education")) $("education").value = education;
    } catch (e) { console.warn("localStorage unavailable:", e); }
  }

  /* =====================================================
     BUILD PROMPT
     ===================================================== */

  function buildPrompt(skill, education) {
    return [
      "Create career recommendations for an Indian student.",
      "",
      "Skills: " + skill,
      "Education: " + (education || "Not specified"),
      "",
      "Return ONLY valid minified JSON (no markdown, no comments) with exactly this shape:",
      "{",
      '  "government_jobs": [{"job_title":"","fresher_salary":"","experienced_salary":"","description":""}],',
      '  "private_jobs": [{"job_title":"","fresher_salary":"","experienced_salary":"","description":""}],',
      '  "related_interests": [""],',
      '  "career_paths": [""],',
      '  "required_skills": [""],',
      '  "useful_certificates": [""],',
      '  "learning_roadmap": [""]',
      "}",
      "",
      "Rules:",
      "- Exactly 5 government jobs.",
      "- Exactly 5 private jobs.",
      "- Exactly 5 related interests.",
      "- Exactly 5 career paths.",
      "- Exactly 5 required skills.",
      "- Exactly 5 useful certificates.",
      "- Exactly 6 learning roadmap steps.",
      "- Use realistic Indian annual salaries with the ₹ symbol.",
      "- Keep each description under 25 words.",
      "- Tailor everything to the student's skills and education.",
      "- Output must be ONLY the JSON object."
    ].join("\n");
  }

  /* =====================================================
     ROBUST JSON EXTRACTION (handles fences, prose, truncation)
     ===================================================== */

  function extractJSON(raw) {
    if (!raw) return null;

    var text = String(raw).replace(/```json/gi, "").replace(/```/g, "").trim();

    var start = text.indexOf("{");
    if (start === -1) return null;

    var end = text.lastIndexOf("}");
    if (end > start) {
      text = text.slice(start, end + 1);
    } else {
      text = text.slice(start);
    }

    try { return JSON.parse(text); } catch (e) {}

    var repaired = repairTruncatedJSON(text);
    if (repaired) { try { return JSON.parse(repaired); } catch (e) {} }

    return null;
  }

  function repairTruncatedJSON(text) {
    var stack = [], inString = false, escaped = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inString) {
        if (escaped) { escaped = false; }
        else if (c === "\\") { escaped = true; }
        else if (c === '"') { inString = false; }
        continue;
      }
      if (c === '"') { inString = true; }
      else if (c === "{" || c === "[") { stack.push(c === "{" ? "}" : "]"); }
      else if (c === "}" || c === "]") { stack.pop(); }
    }

    var closer = (inString ? '"' : "") + stack.slice().reverse().join("");

    var candidates = [];
    candidates.push(text.replace(/,\s*$/, "") + closer);
    candidates.push(text + closer);
    var noDanglingKey = text.replace(/,\s*"[^"]*"\s*:\s*$/, "").replace(/"[^"]*"\s*:\s*$/, "");
    if (noDanglingKey !== text) candidates.push(noDanglingKey.replace(/,\s*$/, "") + closer);
    var noPartialStr = text.replace(/,\s*"[^"]*$/, "").replace(/\[\s*"[^"]*$/, "[");
    if (noPartialStr !== text) candidates.push(noPartialStr.replace(/,\s*$/, "") + closer);

    for (var k = 0; k < candidates.length; k++) {
      try { JSON.parse(candidates[k]); return candidates[k]; } catch (e) {}
    }

    for (var cut = 0; cut <= 200 && cut < text.length; cut++) {
      var t = text.slice(0, text.length - cut);
      var st = [], is = false, es = false;
      for (var j = 0; j < t.length; j++) {
        var ch = t[j];
        if (is) { if (es) { es = false; } else if (ch === "\\") { es = true; } else if (ch === '"') { is = false; } continue; }
        if (ch === '"') { is = true; }
        else if (ch === "{" || ch === "[") { st.push(ch === "{" ? "}" : "]"); }
        else if (ch === "}" || ch === "]") { st.pop(); }
      }
      var cl = (is ? '"' : "") + st.slice().reverse().join("");
      var cand = t.replace(/,\s*$/, "").replace(/,\s*"[^"]*"\s*:\s*$/, "").replace(/,\s*$/, "") + cl;
      try { JSON.parse(cand); return cand; } catch (e) {}
    }

    return null;
  }

  /* =====================================================
     CALL OPENROUTER (single model attempt)
     ===================================================== */

  function callModel(model, skill, education) {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 60000);

    return fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + API_KEY,
        "HTTP-Referer": window.location.href,
        "X-Title": "AI Career Recommendation System"
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: "You are an expert career advisor. You reply with ONLY a single valid minified JSON object and nothing else. Do not include any reasoning, explanations, or markdown." },
          { role: "user", content: buildPrompt(skill, education) }
        ],
        temperature: 0.4,
        max_tokens: 8000
      })
    }).then(function (response) {
      return response.text().then(function (text) {
        clearTimeout(timeout);

        if (!response.ok) {
          var msg = text;
          try {
            var errData = JSON.parse(text);
            if (errData && errData.error && errData.error.message) msg = errData.error.message;
          } catch (e) {}
          throw new Error("API Error " + response.status + ": " + msg);
        }

        var data;
        try { data = JSON.parse(text); } catch (e) { throw new Error("Invalid response from OpenRouter."); }

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
          throw new Error("AI did not return a result.");
        }

        var message = data.choices[0].message;
        var finishReason = data.choices[0].finish_reason;
        var content = message.content;

        // Some providers return content as an array of parts.
        if (Array.isArray(content)) {
          content = content.map(function (part) {
            if (typeof part === "string") return part;
            if (part && part.text) return part.text;
            return "";
          }).join("");
        }

        // Reasoning models (e.g. nemotron, dots) leave "content" empty and put
        // their chain-of-thought in "reasoning". That text is prose, NOT JSON,
        // so we only fall back to it when it actually contains a JSON object.
        if ((!content || typeof content !== "string" || !content.trim()) &&
            message.reasoning && message.reasoning.indexOf("{") !== -1) {
          content = message.reasoning;
        }

        if (!content || typeof content !== "string" || !content.trim()) {
          // finish_reason "length" means the model ran out of tokens while
          // "thinking" and produced no usable answer — fail so we try next model.
          throw new Error(finishReason === "length"
            ? "AI ran out of tokens while thinking."
            : "AI returned an empty response.");
        }

        var result = extractJSON(content);
        if (!result) {
          // Usually a truncated answer from a too-small model. Signal failure so
          // the fallback chain moves on to the next model instead of showing nothing.
          throw new Error(finishReason === "length"
            ? "AI response was cut off (token limit)."
            : "Could not read the AI response as JSON.");
        }
        return result;
      });
    }).catch(function (err) {
      clearTimeout(timeout);
      throw err;
    });
  }

  /* =====================================================
     FETCH LIVE FREE MODELS FROM OPENROUTER
     Free endpoints change constantly, so we ask OpenRouter
     which :free models exist right now and try those first.
     ===================================================== */

  function fetchFreeModels() {
    return fetch("https://openrouter.ai/api/v1/models")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !Array.isArray(data.data)) return [];
        return data.data
          .filter(function (m) { return m.id && m.id.indexOf(":free") !== -1; })
          .map(function (m) { return m.id; });
      })
      .catch(function () { return []; });
  }

  /* =====================================================
     GET RECOMMENDATION (dynamic free-model discovery + fallback)
     ===================================================== */

  function getRecommendation() {
    // The API_KEY comes from the .env file, which config.js loads
    // asynchronously. Wait for it to finish before checking the key.
    if (typeof ENV_READY !== "undefined" && ENV_READY && typeof ENV_READY.then === "function") {
      ENV_READY.then(runRecommendation).catch(runRecommendation);
    } else {
      runRecommendation();
    }
  }

  function runRecommendation() {
    var skill = $("skillInput").value.trim();
    var education = $("educationInput").value.trim();
    var output = $("output");

    if (!API_KEY) {
      output.innerHTML = '<div class="error"><b>❌ OpenRouter API key is missing.</b><br><br>' +
        'Open the <b>.env</b> file (next to index.html), add your key after ' +
        '<b>OPENROUTER_API_KEY=</b> from openrouter.ai/keys, save it, then refresh.</div>';
      return;
    }
    if (!skill) {
      output.innerHTML = '<div class="error"><b>❌ Please enter your skills</b> to get a recommendation.</div>';
      $("skillInput").focus();
      return;
    }

    output.innerHTML =
      '<div class="loading">' +
        '<div class="spinner"></div>' +
        '<div class="ai-status" id="aiStatus">🔎 Finding an available AI model…</div>' +
        '<div class="muted" style="font-size:14px">This can take up to a minute.</div>' +
      '</div>';

    $("submitBtn").disabled = true;
    if ($("reloadBtn")) $("reloadBtn").style.display = "none";
    $("copyBtn").style.display = "none";

    // Build the list of models to try: live free models first, then the
    // hardcoded ones from config.js as a backup. De-duplicated.
    fetchFreeModels().then(function (liveModels) {
      // Try the verified config models first (fast + known to return JSON),
      // then any other currently-live :free models as a backup.
      var combined = MODELS.concat(liveModels);
      var seen = {};
      var queue = [];
      combined.forEach(function (m) {
        if (!seen[m]) { seen[m] = true; queue.push(m); }
      });

      var lastError = null;
      var index = 0;

      function tryNext() {
        if (index >= queue.length) {
          var message = lastError ? lastError.message : "No free model is available right now.";
          if (lastError && lastError.name === "AbortError") message = "The request timed out. Please try again.";
          output.innerHTML = '<div class="error"><b>❌ ' + escapeHTML(message) + "</b><br><br>" +
            "All free models were busy or unavailable. Please wait a moment and press " +
            "<b>Get Recommendation</b> again.</div>";
          $("submitBtn").disabled = false;
          return;
        }
        var model = queue[index++];
        var statusEl = $("aiStatus");
        if (statusEl) statusEl.textContent = "🤖 Trying model: " + model + " …";
        callModel(model, skill, education)
          .then(function (result) { displayResults(result); $("submitBtn").disabled = false; })
          .catch(function (err) {
            console.warn("Model failed:", model, err && err.message);
            lastError = err;
            tryNext(); // skip unavailable/busy models and keep going
          });
      }

      tryNext();
    });
  }

  /* =====================================================
     DISPLAY RESULTS
     ===================================================== */

  function displayResults(data) {
    var output = $("output");
    var html = "";
    html += makeList("interests", "📌 Related Interests", data.related_interests);
    html += makeList("paths", "💼 Career Paths", data.career_paths);
    html += makeList("skills", "🛠 Required Skills", data.required_skills);
    html += makeList("certificates", "🎓 Useful Certificates", data.useful_certificates);
    html += makeList("roadmap", "🚀 Learning Roadmap", data.learning_roadmap);
    html += makeJobs("government", "🏛 Government Jobs", data.government_jobs);
    html += makeJobs("private", "🏢 Private Jobs", data.private_jobs);
    output.innerHTML = html;

    if ($("reloadBtn")) $("reloadBtn").style.display = "inline-block";
    $("copyBtn").style.display = "inline-block";

    var first = document.querySelector("#output .category-content");
    if (first) {
      first.style.display = "block";
      var header = first.previousElementSibling;
      if (header) header.classList.add("open");
    }
  }

  function makeList(id, title, items) {
    if (!Array.isArray(items)) items = [];
    var listHtml = "";
    if (items.length === 0) {
      listHtml = '<li class="muted">No items available.</li>';
    } else {
      items.forEach(function (item) { listHtml += "<li>" + escapeHTML(item) + "</li>"; });
    }
    return '<div class="category">' +
        '<div class="category-header" data-id="' + id + '"><span>' + escapeHTML(title) + '</span><span class="chev">▼</span></div>' +
        '<div class="category-content" id="' + id + '">' +
          '<button type="button" class="copy-section" data-copy="' + id + '">📋 Copy</button>' +
          "<ul>" + listHtml + "</ul>" +
        "</div></div>";
  }

  function makeJobs(id, title, jobs) {
    if (!Array.isArray(jobs)) jobs = [];
    var jobsHtml = "";
    if (jobs.length === 0) {
      jobsHtml = '<p class="muted">No jobs available.</p>';
    } else {
      jobs.forEach(function (job) {
        job = job || {};
        jobsHtml += '<div class="job-card">' +
            "<h3>" + escapeHTML(job.job_title || "Job") + "</h3>" +
            "<p><b>Fresher Salary:</b> " + escapeHTML(job.fresher_salary || "-") + "</p>" +
            "<p><b>Experienced Salary:</b> " + escapeHTML(job.experienced_salary || "-") + "</p>" +
            "<p>" + escapeHTML(job.description || "") + "</p>" +
          "</div>";
      });
    }
    return '<div class="category">' +
        '<div class="category-header" data-id="' + id + '"><span>' + escapeHTML(title) + '</span><span class="chev">▼</span></div>' +
        '<div class="category-content" id="' + id + '">' +
          '<button type="button" class="copy-section" data-copy="' + id + '">📋 Copy</button>' +
          jobsHtml +
        "</div></div>";
  }

  /* =====================================================
     TOGGLE + COPY (event delegation on #output)
     ===================================================== */

  function wireOutput() {
    var output = $("output");
    if (!output) return;
    output.addEventListener("click", function (event) {
      var copyBtn = event.target.closest(".copy-section");
      if (copyBtn) { event.stopPropagation(); copySection(copyBtn.getAttribute("data-copy")); return; }
      var header = event.target.closest(".category-header");
      if (header) {
        var id = header.getAttribute("data-id");
        var section = $(id);
        if (!section) return;
        var isOpen = section.style.display === "block";
        section.style.display = isOpen ? "none" : "block";
        header.classList.toggle("open", !isOpen);
      }
    });
  }

  /* =====================================================
     STRUCTURED COPY — builds clean, well-formatted text
     with proper headings. Excludes the "📋 Copy" buttons.
     ===================================================== */

  var sectionMeta = {
    interests:    { title: "Related Interests",    icon: "📌", kind: "list" },
    paths:        { title: "Career Paths",         icon: "💼", kind: "list" },
    skills:       { title: "Required Skills",      icon: "🛠", kind: "list" },
    certificates: { title: "Useful Certificates",  icon: "🎓", kind: "list" },
    roadmap:      { title: "Learning Roadmap",     icon: "🚀", kind: "list" },
    government:   { title: "Government Jobs",      icon: "🏛", kind: "jobs" },
    private:      { title: "Private Jobs",         icon: "🏢", kind: "jobs" }
  };

  function rule(char) { var s = ""; for (var i = 0; i < 46; i++) s += char; return s; }

  // Build the plain-text for one section directly from its DOM content,
  // skipping the copy button, so we get a clean, structured result.
  function buildSectionText(id) {
    var meta = sectionMeta[id];
    var section = $(id);
    if (!section) return "";

    var lines = [];
    lines.push("");
    lines.push(rule("="));
    lines.push(meta.icon + "  " + meta.title.toUpperCase());
    lines.push(rule("="));

    if (meta.kind === "jobs") {
      var cards = section.querySelectorAll(".job-card");
      if (cards.length === 0) {
        lines.push("No jobs available.");
      } else {
        Array.prototype.forEach.call(cards, function (card, i) {
          var title = card.querySelector("h3");
          var ps = card.querySelectorAll("p");
          lines.push("");
          lines.push((i + 1) + ". " + (title ? title.textContent.trim() : "Job"));
          lines.push(rule("-"));
          Array.prototype.forEach.call(ps, function (p) {
            var t = p.textContent.trim();
            if (t) lines.push("   " + t);
          });
        });
      }
    } else {
      var items = section.querySelectorAll("li");
      if (items.length === 0) {
        lines.push("No items available.");
      } else {
        Array.prototype.forEach.call(items, function (li, i) {
          lines.push((i + 1) + ". " + li.textContent.trim());
        });
      }
    }
    lines.push("");
    return lines.join("\n");
  }

  // Build the full report for "Copy All": header + user details + all sections.
  function buildFullText() {
    var lines = [];
    lines.push(rule("="));
    lines.push("   AI CAREER RECOMMENDATION REPORT");
    lines.push(rule("="));
    lines.push("");

    var name = "", age = "", education = "";
    try {
      name = localStorage.getItem("careerName") || "";
      age = localStorage.getItem("careerAge") || "";
      education = localStorage.getItem("careerEducation") || "";
    } catch (e) {}

    lines.push("Name: " + (name || "-"));
    lines.push("Age: " + (age || "-"));
    lines.push("Education: " + (education || "-"));
    var skill = $("skillInput") ? $("skillInput").value.trim() : "";
    if (skill) lines.push("Skills: " + skill);

    lines.push("");
    lines.push(rule("-"));
    lines.push("RECOMMENDATIONS");
    lines.push(rule("-"));

    var ids = ["interests", "paths", "skills", "certificates", "roadmap", "government", "private"];
    ids.forEach(function (id) {
      var section = $(id);
      if (section) lines.push(buildSectionText(id));
    });

    lines.push("");
    lines.push(rule("="));
    lines.push("Generated by AI Career Recommendation System");
    lines.push(rule("="));
    return lines.join("\n");
  }

  function copySection(id) {
    var text = buildSectionText(id);
    if (!text) { showToast("Nothing to copy."); return; }
    copyText(text.trim(), "Section copied ✅");
  }

  function copyText(text, successMessage) {
    if (!text) { showToast("Nothing to copy."); return; }
    function legacyCopy() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.focus(); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      showToast(ok ? (successMessage || "Copied ✅") : "Copy failed. Please copy manually.");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast(successMessage || "Copied ✅"); }).catch(legacyCopy);
    } else { legacyCopy(); }
  }

  /* =====================================================
     EVENT WIRING  (only binds elements that exist)
     ===================================================== */

  function on(id, evt, fn) {
    var el = $(id);
    if (el) el.addEventListener(evt, fn);
  }

  // --- User info page: submit the form (button is type="submit") ---
  var userForm = $("userForm");
  if (userForm) {
    userForm.addEventListener("submit", function (e) {
      e.preventDefault();
      saveUser();
    });
  }

  // --- Recommendation page ---
  on("submitBtn", "click", getRecommendation);
  on("copyBtn", "click", function () {
    copyText(buildFullText(), "All recommendations copied ✅");
  });
  ["skillInput", "educationInput"].forEach(function (id) {
    on(id, "keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); getRecommendation(); } });
  });

  // --- Init: wire output + show saved details on the recommendation page ---
  wireOutput();
  if ($("displayName")) loadUser();     // recommendation page: show saved details
  // NOTE: the user-info form intentionally starts EMPTY every time you open
  // the project, so you can enter fresh details. Saved data is only shown on
  // the recommendation page after you press Continue.

  console.log("AI Career Recommendation System loaded.");
})();
