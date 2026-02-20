# JulietScript

JulietScript is the script language used in conjunction with [seezatnap/juliet](https://github.com/seezatnap/juliet), a CLI for orchestrating coding workflows. This repository is a supporting JulietScript library/tooling repo: it documents the language, provides syntax/lint support, and includes editor integration.

## Reference Syntax (Annotated)

```julietscript
# 1) Global project settings for the run context.
juliet {
  engine = codex;
  project = "Q2 launch memo";
}

# 2) Reusable policies are named prompt bodies.
policy Preflight = """
Check for factual errors, unsupported claims, and missing constraints.
Return short, explicit fixes.
""";

policy Triage = "Prioritize correctness issues first, then clarity.";

# 3) Rubrics define scoring criteria and optional tiebreakers.
rubric MemoRubric {
  criterion "Accuracy" points 5;
  criterion "Clarity" points 3;
  criterion "Actionability" points 2;
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

# 5) Create produces an artifact from a prompt and named attachments.
create LaunchMemo from juliet "Write a one-page launch memo for the Q2 release."
with {
  preflight = Preflight;  # policy
  triage = Triage;        # policy
  cadence = MemoLoop;     # cadence
  rubric = MemoRubric;    # rubric
};

# 6) Extend currently targets '<Artifact>.rubric' with extra guidance.
extend LaunchMemo.rubric with "Add a criterion for risk disclosure quality.";

# 7) Halt can stop execution, optionally with a message.
halt "Stop after the first accepted memo.";
```

`keep best <int>;` sets the survivor cap per sprint.

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
- Cadence action validation (`compare using`, `keep best <int>`)
- Extend target validation (`<Artifact>.rubric`)
- Common syntax errors (missing `;`, missing braces, bad strings)

## Verify

```bash
npm run test:linter
```
