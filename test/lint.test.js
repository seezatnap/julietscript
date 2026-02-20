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
  project = "division-challenge";
}

policy failureTriage = """
Recover workers and summarize repeated failures.
""";

policy sprintPreFlight = """
Open tasks for gaps before sprinting.
""";

rubric qualityCheck {
  criterion "Meets all specs" points 4;
  criterion "Tests green + good coverage" points 2;
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
  triage = failureTriage;
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
    name: "reports invalid project name format",
    source: `
juliet {
  engine = codex;
  project = "Q2 launch memo";
}
`,
    validate: (diagnostics) => {
      const errorMessages = messages(diagnostics).join("\n");
      assert.match(errorMessages, /Project value must use only letters, numbers, '-' or '_' \(no spaces\)/);
    }
  },
  {
    name: "reports unsupported juliet language config key",
    source: `
juliet {
  engine = codex;
  project = "x";
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
policy triage = """x""";
create A from juliet """prompt""" with {
  triage = triage;
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
    name: "reports invalid extend target",
    source: `
policy triage = """x""";
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
  triage = triage;
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
