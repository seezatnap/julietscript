"use strict";

const assert = require("assert");
const { lintJulietScript, SEVERITY } = require("../src/linter");

function countBySeverity(diagnostics, severity) {
  return diagnostics.filter((entry) => entry.severity === severity).length;
}

function messages(diagnostics) {
  return diagnostics.map((entry) => entry.message);
}

const tests = [
  {
    name: "accepts valid script",
    source: `
juliet {
  engine = codex;
}

policy failureTriage = """
Recover workers and summarize repeated failures.
""";

policy sprintPreFlight = """
Open tasks for gaps before sprinting.
""";

rubric qualityCheck {
  criterion "Meets all specs" points 4 means "Implements the requested behavior without regressions.";
  criterion "Tests green + good coverage" points 2 means "All relevant tests pass and new logic is validated.";
  tiebreakers ["Meets all specs"];
}

cadence threeVariantsShootout {
  engine = codex;
  variants = 3;
  sprints = 2;
  compare using qualityCheck;
  keep best 2;
}

create MyNewArtifact from juliet """
<prompt here>
""" with {
  preflight = sprintPreFlight;
  failureTriage = failureTriage;
  cadence = threeVariantsShootout;
  rubric = qualityCheck;
};

extend MyNewArtifact.rubric with """
Add visual coverage checks.
""";

halt "Human review checkpoint.";
`,
    validate: (diagnostics) => {
      assert.strictEqual(countBySeverity(diagnostics, SEVERITY.ERROR), 0);
      assert.strictEqual(countBySeverity(diagnostics, SEVERITY.WARNING), 0);
    }
  },
  {
    name: "reports unsupported juliet project key",
    source: `
juliet {
  engine = codex;
  project = "division-challenge";
}
`,
    validate: (diagnostics) => {
      const warningMessages = messages(diagnostics).join("\n");
      assert.match(warningMessages, /Unknown juliet key 'project'/);
    }
  },
  {
    name: "reports unsupported juliet language config key",
    source: `
juliet {
  engine = codex;
  language = "en";
}
`,
    validate: (diagnostics) => {
      const warningMessages = messages(diagnostics).join("\n");
      assert.match(warningMessages, /Unknown juliet key 'language'/);
    }
  },
  {
    name: "reports unknown references",
    source: `
policy failureTriage = """x""";
create A from juliet """prompt""" with {
  failureTriage = failureTriage;
  cadence = missingCadence;
  rubric = missingRubric;
};
`,
    validate: (diagnostics) => {
      const errorMessages = messages(diagnostics).join("\n");
      assert.match(errorMessages, /Unknown cadence 'missingCadence'/);
      assert.match(errorMessages, /Unknown rubric 'missingRubric'/);
    }
  },
  {
    name: "accepts create seeded from source files",
    source: `
create Phase1WebGLFoundation from julietArtifactSourceFiles [
  "../path-to-file/example.md",
  "../path-to-file/notes.md"
];
`,
    validate: (diagnostics) => {
      assert.strictEqual(countBySeverity(diagnostics, SEVERITY.ERROR), 0);
      assert.strictEqual(countBySeverity(diagnostics, SEVERITY.WARNING), 0);
    }
  },
  {
    name: "reports empty julietArtifactSourceFiles list",
    source: `
create Phase1WebGLFoundation from julietArtifactSourceFiles [];
`,
    validate: (diagnostics) => {
      const errorMessages = messages(diagnostics).join("\n");
      assert.match(errorMessages, /Expected at least one file path in julietArtifactSourceFiles list/);
    }
  },
  {
    name: "reports invalid extend target",
    source: `
policy failureTriage = """x""";
rubric quality {
  criterion "Spec" points 1;
}
cadence c {
  variants = 1;
  sprints = 1;
  compare using quality;
  keep best 1;
}
create A from juliet """prompt""" with {
  failureTriage = failureTriage;
  cadence = c;
  rubric = quality;
};
extend A.prompt with """nope""";
`,
    validate: (diagnostics) => {
      const errorMessages = messages(diagnostics).join("\n");
      assert.match(errorMessages, /Only '<Artifact>\.rubric' is currently supported by extend/);
    }
  },
  {
    name: "reports keep best without integer limit",
    source: `
rubric quality {
  criterion "Spec" points 1;
}
cadence c {
  variants = 2;
  sprints = 1;
  compare using quality;
  keep best;
}
`,
    validate: (diagnostics) => {
      const errorMessages = messages(diagnostics).join("\n");
      assert.match(errorMessages, /Expected integer keep limit after 'keep best'/);
    }
  },
  {
    name: "reports missing criterion meaning string",
    source: `
rubric quality {
  criterion "Clarity" points 3 means;
}
`,
    validate: (diagnostics) => {
      const errorMessages = messages(diagnostics).join("\n");
      assert.match(errorMessages, /Expected criterion meaning string after 'means'/);
    }
  },
  {
    name: "reports syntax issues",
    source: `
policy triage = """x"""
halt
`,
    validate: (diagnostics) => {
      assert.ok(countBySeverity(diagnostics, SEVERITY.ERROR) >= 2);
    }
  }
];

for (const test of tests) {
  const diagnostics = lintJulietScript(test.source);
  try {
    test.validate(diagnostics);
  } catch (error) {
    console.error(`Test failed: ${test.name}`);
    console.error("Diagnostics:");
    for (const diagnostic of diagnostics) {
      console.error(`- [${diagnostic.severity}] ${diagnostic.message}`);
    }
    throw error;
  }
}

console.log(`Passed ${tests.length} linter tests.`);
