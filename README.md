# JulietScript

JulietScript is the script language used in conjunction with [seezatnap/juliet](https://github.com/seezatnap/juliet), a CLI for orchestrating coding workflows. This repository is a supporting JulietScript library/tooling repo: it documents the language, provides syntax/lint support, and includes editor integration.

## Reference Syntax (Annotated)

```julietscript
# 1) Global runtime defaults for the run context.
juliet {
  engine = codex;
}

# 2) Reusable policies are named prompt bodies.
policy Preflight = """
Before sprinting:
- confirm scope, constraints, and acceptance criteria are explicit
- if behavior changes, verify tests exist or open a task to add them
- flag high-risk files (large modules, migrations, generated outputs)
Return a short pass/fail checklist with required follow-ups.
""";

policy FailureTriage = """
If a sprint fails:
- capture failing command, key error output, and likely root cause
- attempt one safe recovery (resume/retry with minimal scope change)
- if failure repeats, stop and open a human-review task with context
Prioritize correctness and unblock path over speed.
""";

# 3) Rubrics define scoring criteria and optional tiebreakers.
rubric MemoRubric {
  criterion "Accuracy" points 5 means "Facts are correct and verifiable.";
  criterion "Clarity" points 3 means "Writing is concise, logically organized, and easy to scan.";
  criterion "Actionability" points 2 means "Recommendations are specific and can be executed.";
  tiebreakers ["Accuracy", "Clarity"];
}

# 4) Cadence controls iteration behavior.
cadence MemoLoop {
  engine = codex;
  variants = 4;
  sprints = 2;
  compare using MemoRubric;
  keep best 2;
}

# 5) Create produces an artifact from a prompt and optional named attachments.
create LaunchMemo from juliet "Write a one-page launch memo for the Q2 release."
with {
  preflight = Preflight;            # policy: proactive checks before sprinting
  failureTriage = FailureTriage;    # policy: reactive recovery when sprinting fails
  cadence = MemoLoop;               # cadence
  rubric = MemoRubric;              # rubric
};

# 5a) Create can also be seeded from one or more source files.
create Phase1WebGLFoundation from julietArtifactSourceFiles [
  "../path-to-file/example.md",
  "../path-to-file/notes.md"
];

# 6) Extend currently targets '<Artifact>.rubric' with extra guidance.
extend LaunchMemo.rubric with "Add a criterion for risk disclosure quality.";

# 7) Halt can stop execution, optionally with a message.
halt "Stop after the first accepted memo.";
```

`keep best <int>;` sets the survivor cap per sprint.
`project` is intentionally runtime-scoped and should be supplied per execution, not in `juliet { ... }`.
`criterion "<name>" points <int> means "<definition>";` adds an optional criterion definition.
`preflight` is preventive (before work starts); `failureTriage` is corrective (after failures).

- Round 1: `variants = 4` creates 4 branches, then `keep best 2` keeps 2.
- Round 2: 2 survivors each branch into 4 variants (`2 x 4 = 8`), then keep 2.
- Round 3: again `2 x 4 = 8`, then keep 2.

## Repository Scope

This repository is a supporting library/tooling home for JulietScript scripts used by [seezatnap/juliet](https://github.com/seezatnap/juliet).
The VS Code extension is only one part of this repo, not the whole project.

Current implementation in this repo includes:

- Syntax grammar for `.julietscript`, `.jls`, `.juliet`
- Parser-backed lint diagnostics
- VS Code diagnostics integration
- Rust workspace CLI wrapper (`julietscript-lint`)

## VS Code Extension

### Requirements

- VS Code `1.90.0` or newer
- Node.js `18+` (for running tests/packaging)

### Installation

#### Option 1: Run as an extension in development

1. Open this folder in VS Code.
2. Open `Run and Debug` and choose `Run JulietScript Extension`, then press `F5`.
3. If prompted to select a debug environment, choose `VS Code Extension Development`.
4. In the new Extension Development Host window, open a `.julietscript`, `.jls`, or `.juliet` file.

#### Option 2: Package and install as a normal extension

1. Install the VS Code extension packager:
   ```bash
   npm install -g @vscode/vsce
   ```
2. From this project root, build a `.vsix` package:
   ```bash
   vsce package
   ```
3. Install the generated file:
   ```bash
   code --install-extension julietscript-vscode-0.0.1.vsix
   ```

## What It Adds

- Language id: `julietscript`
- File extensions: `.julietscript`, `.jls`, `.juliet`
- Line comments with `#`
- TextMate grammar: `syntaxes/julietscript.tmLanguage.json`
- Linter engine: `src/linter.js`
- VS Code diagnostics wiring: `src/extension.js`

## Linter Checks

- Statement parsing for `juliet`, `policy`, `rubric`, `cadence`, `create`, `extend`, `halt`
- Invalid/unknown keys in `juliet { ... }` and `create ... with { ... }`
- Unresolved references (policy/rubric/cadence/artifact)
- `create ... from julietArtifactSourceFiles ["..."]` source-file list validation
- Cadence action validation (`compare using`, `keep best <int>`)
- Extend target validation (`<Artifact>.rubric`)
- Common syntax errors (missing `;`, missing braces, bad strings)

## Verify

```bash
npm run test:linter
```

## Rust CLI Linter

This repository also includes a Cargo workspace with a Rust binary named `julietscript-lint`.

The CLI accepts one or more `--glob` flags to select JulietScript files, then runs lint checks against the specification implemented in `src/linter.js`.
It embeds the linter implementation at build time, so it can run from any working directory.

```bash
cargo run -p julietscript-lint -- --glob "**/*.julietscript"
```

To print a deeply annotated end-to-end example script (including artifact chaining):

```bash
cargo run -p julietscript-lint -- example
```

Multiple globs are supported:

```bash
cargo run -p julietscript-lint -- \
  --glob "**/*.julietscript" \
  --glob "**/*.jls" \
  --glob "**/*.juliet"
```
