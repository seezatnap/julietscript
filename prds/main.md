# JulietScript Documentation

JulietScript is a small, declarative scripting language for orchestrating repeatable “operator ↔ Juliet” workflows. It is designed to automate the *shape* of your interactions (preflight → sprint cadence → failure triage → compare variants → keep best → stop for review), while letting the *content* remain plain-English instructions and prompts.

This documentation focuses on the surface syntax and the mental model. The mechanics of how the runtime talks to `juliet` (CLI flags, session IDs, streaming, etc.) are intentionally left unspecified for now.

---

## Mental model

### What JulietScript controls

JulietScript coordinates a pipeline of work that typically looks like:

1. **Set defaults** (engine, language; project is runtime-scoped)
2. **Define reusable policies** (failureTriage, preflight)
3. **Define reusable evaluation** (rubrics)
4. **Define a sprint plan** (cadence, variants, sprints, comparison)
5. **Create artifacts** by sending prompts to Juliet, attaching the above

### Core concepts

* **Artifact**
  A named output produced by Juliet. Think: “a branch + its current state,” or “a deliverable you’ll later merge or build upon.”

* **Policy**
  A reusable playbook in plain English. Examples: failure triage rules, preflight checks, “how to resume work.”

* **Rubric**
  A reusable scoring model used to compare variants/branches.

* **Cadence**
  A sprint plan: how many sprints to run, how many variants to spawn, how to compare and select a winner.

* **Defaults**
  Global settings for the script (e.g., default engine).

---

## Language basics

### File structure

A JulietScript file is a sequence of statements executed **top-to-bottom**.

Recommended structure:

1. `juliet { ... }` defaults
2. `policy ...`
3. `rubric ...`
4. `cadence ...`
5. `create ...`
6. optional `extend ...`, `halt ...`, more `create ...`

### Identifiers

Names like `MyNewArtifact`, `failureTriage`, `threeVariantsShootout` are identifiers.

Use:

* letters, numbers, underscores
* start with a letter
* case-sensitive

### Comments

Single-line comments start with `#`.

```julietscript
# This is a comment
create Foo from juliet """..."""; # trailing comment
```

### Strings and blocks

JulietScript prioritizes “prompt-friendly” blocks.

* **Block string (recommended):** triple quotes
  Good for prompts, policies, long instructions.

```julietscript
policy triage = """
If a worker fails, heal and resume.
""";
```

* **Inline string:** double quotes
  Good for short values.

```julietscript
juliet { engine = codex; }
```

---

## The five primitives

The language is intentionally small. Everything is built from these five primitives (with “artifact lifecycle” grouped together).

1. `juliet { ... }` — global defaults
2. `policy Name = """...""";` — reusable playbook text
3. `rubric Name { ... }` — structured scoring rules
4. `cadence Name { ... }` — sprint plan + selection strategy
5. Artifact lifecycle statements — `create`, `extend`, `halt`

Each primitive is documented below.

---

## 1) `juliet { ... }` — Global defaults

Defines script-wide defaults used by subsequent statements.

```julietscript
juliet {
  engine   = codex;                 # default engine (e.g. codex, claude)
  language = "en";                  # constrain responses
}
```

### Supported keys (initial set)

* `engine` — default execution engine
* `language` — response language constraint (e.g., `"en"`)
* `project` — provided by the runtime per execution, not by this block

> The runtime may support additional keys later. Unknown keys should be ignored or warned on (implementation choice).

---

## 2) `policy` — Reusable workflow playbooks

A **policy** is a named block of plain-English instructions that can be attached to artifact creation.

```julietscript
policy failureTriage = """
If any workers failed:
- heal them
- attempt to resume them
- if repeated failures occur, summarize the cause and open a task for human review
""";
```

### Policy guidelines

* Write policies as if you were instructing a reliable operator.
* Prefer bullet lists and explicit “if/then” structure.
* Keep them stable over time; reuse them widely.

### Typical policies

* `failureTriage` — how to recover from failed workers
* `sprintPreFlight` — what checks/tasks to open before sprinting
* `releaseGuardrails` — what must be true before merging/shipping

---

## 3) `rubric` — Structured quality scoring

A **rubric** defines how to score and compare different variants/branches.

```julietscript
rubric qualityCheck {
  criterion "Meets all specs"                points 4;
  criterion "Maintainable / readable design" points 3;
  criterion "Tests green + good coverage"    points 2;

  # optional: tie-breaking order if total scores match
  tiebreakers ["Meets all specs", "Tests green + good coverage"];
}
```

### Rubric semantics

* A rubric is a list of weighted criteria.
* Total score is the sum of awarded points across criteria.
* Tie-breakers define which criteria matter most when scores tie.

> How “awarded points” are determined (LLM self-eval, heuristics, human rating, etc.) is runtime-defined.

---

## 4) `cadence` — Sprint plan + variants strategy

A **cadence** describes how Juliet should iterate: number of sprints, number of variants, and selection rules.

```julietscript
cadence threeVariantsShootout {
  engine   = codex;  # override global default for this cadence
  variants = 3;      # spawn 3 parallel variants/branches
  sprints  = 2;      # run two sprint cycles then stop

  compare using qualityCheck;  # evaluate variants via rubric
  keep best;                   # select the top-scoring variant
  discard rest;                # drop the other variants
}
```

### Cadence fields (initial set)

* `engine` — optional override
* `variants` — integer (e.g., 1, 3, 5)
* `sprints` — integer (“run N sprints then yield control”)

### Cadence actions

* `compare using <rubricName>;`
* `keep best;`
* `discard rest;`

> If you later want more selection strategies (keep top 2, keep if score ≥ threshold, etc.), add new cadence actions without changing the rest of the language.

---

## 5) Artifact lifecycle

Artifacts are created, optionally extended, and sometimes gated by a halt for human review.

### 5.1 `create` — Create an artifact from Juliet

```julietscript
create MyNewArtifact from juliet """
<prompt here>
""" with {
  preflight = sprintPreFlight;
  failureTriage = failureTriage;
  cadence   = threeVariantsShootout;
  rubric    = qualityCheck;
};

create Phase1WebGLFoundation from julietArtifactSourceFiles [
  "../path-to-file/example.md",
  "../path-to-file/notes.md"
];
```

#### `create` parts

* `MyNewArtifact` — the artifact name
* `from juliet """..."""` — the user prompt body
* `from julietArtifactSourceFiles ["...", "..."]` — source-file seeded artifact input (one or more paths)
* optional `with { ... }` — attachments (policies, cadence, rubric)
* semicolon `;` ends the statement

#### `with { ... }` supported keys (initial set)

* `preflight` — a `policy`
* `failureTriage` — a `policy`
* `cadence` — a `cadence`
* `rubric` — a `rubric`

> You can keep this strict (only these keys) to avoid “mystery configuration.” If you later add more keys, document them here.

---

### 5.2 `extend` — Add additional constraints or checks

The most common extension is adding extra evaluation requirements to a rubric for a specific artifact.

```julietscript
extend MyNewArtifact.rubric with """
Also add visual tests using Playwright and make sure they’re all present and running.
""";
```

#### `extend` target forms (initial set)

* `<ArtifactName>.rubric` — extend the artifact’s evaluation requirements

> You can later add targets like `<ArtifactName>.prompt` or `<ArtifactName>.failureTriage` if you find it valuable, but keep the initial surface area small.

---

### 5.3 `halt` — Stop for human review

Stops script execution at a known checkpoint.

```julietscript
halt "Human review checkpoint: inspect diffs/tests for MyNewArtifact and MyOtherArtifact.";
```

* Without a message: `halt;`
* With a message: `halt "…";`

> Think of `halt` as “do not proceed until a human looks.” Whether resuming is supported later is an implementation detail.

---

## Execution model (high level)

* Statements are processed in order.
* `policy`, `rubric`, `cadence` define reusable named objects.
* `create` triggers an interaction with Juliet that produces an artifact.
* If a cadence spawns variants:

  * the runtime runs them in parallel (conceptually)
  * evaluates them via the rubric
  * keeps the best and discards the rest if instructed

---

## Recommended style

* Keep policies small and reusable.
* Keep rubrics stable; prefer extending per-artifact rather than constantly redefining.
* Use cadences to encode “how we sprint,” not “what we’re building.”
* Put project-specific intent in the `create … """prompt"""`.

---

# Well-annotated example

Below is a complete script that matches the workflow you described. Comments explain intent and expected behavior at each step.

```julietscript
# ============================================================
# 1) Global defaults
#    These are used unless overridden by a cadence or create.
# ============================================================
juliet {
  engine   = codex;                 # Default engine for all work
  language = "en";                  # All responses must be English
}

# ============================================================
# 2) Policies: reusable operator playbooks
#    These are plain-English instructions that can be attached
#    to create runs.
# ============================================================

policy failureTriage = """
If any workers failed:
- heal them
- attempt to resume them
- if a worker fails repeatedly, summarize why and open a task for human review
""";

policy sprintPreFlight = """
Before sprinting:
- if any file is > 1000 LOC, open tasks to break it up
- if functionality added since the last pre-flight check is missing tests, open tasks to add those tests
""";

# ============================================================
# 3) Rubric: how we score branches/variants
#    Used to compare variants spawned by a cadence.
# ============================================================
rubric qualityCheck {
  criterion "Meets all specs"                points 4;
  criterion "Maintainable / readable design" points 3;
  criterion "Tests green + good coverage"    points 2;

  # If two variants tie on total points, prefer the one that
  # most strongly meets core specs and test quality.
  tiebreakers ["Meets all specs", "Tests green + good coverage"];
}

# ============================================================
# 4) Cadence: sprint plan + variant selection
#    This encodes your "run a few sprints with three variants,
#    then keep the best one" workflow.
# ============================================================
cadence threeVariantsShootout {
  engine   = codex;  # Explicitly codex for all variants in this cadence
  variants = 3;      # Create 3 competing branches/variants
  sprints  = 2;      # Run two sprint cycles, then yield control

  compare using qualityCheck;  # Score each variant using the rubric
  keep best;                   # Winner becomes the artifact’s selected branch
  discard rest;                # Losers are discarded to reduce clutter
}

# ============================================================
# 5) Create Artifact A
#    This is your first work product. It uses:
#      - preflight checks
#      - failure triage rules
#      - the 3-variant cadence
#      - the quality rubric for comparison
# ============================================================
create MyNewArtifact from juliet """
<prompt here>

(Write the real prompt exactly as you'd send it to Juliet.)
""" with {
  preflight = sprintPreFlight;
  failureTriage = failureTriage;
  cadence   = threeVariantsShootout;
  rubric    = qualityCheck;
};

# ============================================================
# 6) Extend Artifact A's evaluation constraints
#    This adds an additional requirement on top of qualityCheck,
#    but only for MyNewArtifact.
# ============================================================
extend MyNewArtifact.rubric with """
Also add visual tests using Playwright and make sure they’re all present and running.
""";

# ============================================================
# 7) Create Artifact B
#    Same orchestration scaffolding, different prompt.
# ============================================================
create MyOtherArtifact from juliet """
<another prompt here>
""" with {
  preflight = sprintPreFlight;
  failureTriage = failureTriage;
  cadence   = threeVariantsShootout;
  rubric    = qualityCheck;
};

# ============================================================
# 8) Human review gate
#    Stop here so you can inspect the outputs before combining.
# ============================================================
halt "Review MyNewArtifact and MyOtherArtifact (diffs, tests, design) before final synthesis.";

# ============================================================
# 9) Create the Final Artifact using both prior artifacts
#    This expresses: "take what we learned/built and synthesize."
# ============================================================
create MyFinalArtifact from juliet """
Combine the best parts of the two artifacts into a coherent final implementation.

- Prefer the stronger design choices from each.
- Ensure tests are green and coverage is strong.
- Maintain consistency with project conventions.
""" using [MyNewArtifact, MyOtherArtifact] with {
  failureTriage = failureTriage;
  cadence       = threeVariantsShootout;
  rubric        = qualityCheck;
};
```

---

If you want the docs to be even more “reference-like,” the next natural step is to add a tiny grammar/spec section (what tokens exist, what forms each statement can take) and a “common patterns” chapter (triage loops, review gates, synthesis patterns).
