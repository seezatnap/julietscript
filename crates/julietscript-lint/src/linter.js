"use strict";

const SEVERITY = {
  ERROR: "error",
  WARNING: "warning"
};

const TOP_LEVEL_KEYWORDS = new Set([
  "juliet",
  "policy",
  "rubric",
  "cadence",
  "create",
  "extend",
  "halt"
]);

const JULIET_ALLOWED_KEYS = new Set(["engine"]);
const CREATE_ALLOWED_KEYS = new Map([
  ["preflight", "policy"],
  ["failureTriage", "policy"],
  ["cadence", "cadence"],
  ["rubric", "rubric"]
]);

function comparePositions(a, b) {
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  return a.character - b.character;
}

class Tokenizer {
  constructor(source) {
    this.source = source;
    this.index = 0;
    this.line = 0;
    this.character = 0;
    this.tokens = [];
    this.diagnostics = [];
  }

  tokenize() {
    while (!this.isAtEnd()) {
      this.skipTrivia();
      if (this.isAtEnd()) {
        break;
      }

      const ch = this.peek();

      if (this.isIdentifierStart(ch)) {
        this.tokenizeIdentifier();
        continue;
      }

      if (this.isDigit(ch)) {
        this.tokenizeNumber();
        continue;
      }

      if (ch === "\"") {
        if (this.peek(1) === "\"" && this.peek(2) === "\"") {
          this.tokenizeBlockString();
        } else {
          this.tokenizeString();
        }
        continue;
      }

      if ("{}[]()=;,. ".includes(ch)) {
        if (ch !== " ") {
          this.tokenizePunctuation(ch);
        }
        this.advance();
        continue;
      }

      const start = this.getPosition();
      this.advance();
      this.pushDiagnostic(start, this.getPosition(), `Unexpected character '${ch}'.`, SEVERITY.ERROR);
    }

    const eofPos = this.getPosition();
    this.tokens.push({
      kind: "eof",
      value: "",
      start: eofPos,
      end: eofPos
    });

    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  skipTrivia() {
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.advance();
        continue;
      }
      if (ch === "#") {
        while (!this.isAtEnd() && this.peek() !== "\n") {
          this.advance();
        }
        continue;
      }
      break;
    }
  }

  tokenizeIdentifier() {
    const start = this.getPosition();
    const startIndex = this.index;
    this.advance();
    while (!this.isAtEnd() && this.isIdentifierPart(this.peek())) {
      this.advance();
    }

    this.tokens.push({
      kind: "identifier",
      value: this.source.slice(startIndex, this.index),
      start,
      end: this.getPosition()
    });
  }

  tokenizeNumber() {
    const start = this.getPosition();
    const startIndex = this.index;
    this.advance();
    while (!this.isAtEnd() && this.isDigit(this.peek())) {
      this.advance();
    }

    this.tokens.push({
      kind: "number",
      value: this.source.slice(startIndex, this.index),
      start,
      end: this.getPosition()
    });
  }

  tokenizeBlockString() {
    const start = this.getPosition();
    this.advance();
    this.advance();
    this.advance();
    const contentStart = this.index;

    while (!this.isAtEnd()) {
      if (this.peek() === "\"" && this.peek(1) === "\"" && this.peek(2) === "\"") {
        const value = this.source.slice(contentStart, this.index);
        this.advance();
        this.advance();
        this.advance();
        this.tokens.push({
          kind: "blockString",
          value,
          start,
          end: this.getPosition()
        });
        return;
      }
      this.advance();
    }

    this.pushDiagnostic(start, this.getPosition(), "Unterminated block string.", SEVERITY.ERROR);
    this.tokens.push({
      kind: "blockString",
      value: this.source.slice(contentStart),
      start,
      end: this.getPosition()
    });
  }

  tokenizeString() {
    const start = this.getPosition();
    this.advance();
    const contentStart = this.index;

    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === "\"") {
        const value = this.source.slice(contentStart, this.index);
        this.advance();
        this.tokens.push({
          kind: "string",
          value,
          start,
          end: this.getPosition()
        });
        return;
      }
      if (ch === "\\") {
        this.advance();
        if (!this.isAtEnd()) {
          this.advance();
        }
        continue;
      }
      if (ch === "\n") {
        this.pushDiagnostic(start, this.getPosition(), "String literals cannot span multiple lines; use triple quotes.", SEVERITY.ERROR);
        break;
      }
      this.advance();
    }

    this.pushDiagnostic(start, this.getPosition(), "Unterminated string literal.", SEVERITY.ERROR);
    this.tokens.push({
      kind: "string",
      value: this.source.slice(contentStart, this.index),
      start,
      end: this.getPosition()
    });
  }

  tokenizePunctuation(ch) {
    const start = this.getPosition();
    this.tokens.push({
      kind: ch,
      value: ch,
      start,
      end: {
        line: start.line,
        character: start.character + 1
      }
    });
  }

  isAtEnd() {
    return this.index >= this.source.length;
  }

  peek(offset = 0) {
    return this.source[this.index + offset];
  }

  advance() {
    const ch = this.source[this.index];
    this.index += 1;
    if (ch === "\n") {
      this.line += 1;
      this.character = 0;
    } else {
      this.character += 1;
    }
  }

  getPosition() {
    return { line: this.line, character: this.character };
  }

  isIdentifierStart(ch) {
    return /[A-Za-z]/.test(ch);
  }

  isIdentifierPart(ch) {
    return /[A-Za-z0-9_]/.test(ch);
  }

  isDigit(ch) {
    return /[0-9]/.test(ch);
  }

  pushDiagnostic(start, end, message, severity) {
    this.diagnostics.push({
      severity,
      message,
      range: { start, end }
    });
  }
}

class Parser {
  constructor(tokens, initialDiagnostics) {
    this.tokens = tokens;
    this.currentIndex = 0;
    this.diagnostics = [...initialDiagnostics];
    this.context = {
      julietDeclared: false,
      policies: new Map(),
      rubrics: new Map(),
      cadences: new Map(),
      artifacts: new Map()
    };
  }

  parse() {
    while (!this.isAtEnd()) {
      if (this.matchKeyword("juliet")) {
        this.parseJuliet();
      } else if (this.matchKeyword("policy")) {
        this.parsePolicy();
      } else if (this.matchKeyword("rubric")) {
        this.parseRubric();
      } else if (this.matchKeyword("cadence")) {
        this.parseCadence();
      } else if (this.matchKeyword("create")) {
        this.parseCreate();
      } else if (this.matchKeyword("extend")) {
        this.parseExtend();
      } else if (this.matchKeyword("halt")) {
        this.parseHalt();
      } else if (this.check("eof")) {
        break;
      } else {
        this.reportCurrent("Expected a top-level statement: juliet, policy, rubric, cadence, create, extend, or halt.", SEVERITY.ERROR);
        this.synchronizeTopLevel();
      }
    }

    return this.diagnostics.sort((a, b) => {
      return comparePositions(a.range.start, b.range.start);
    });
  }

  parseJuliet() {
    if (this.context.julietDeclared) {
      this.reportPrevious("Duplicate juliet block. Only one top-level juliet block is expected.", SEVERITY.WARNING);
    }
    this.context.julietDeclared = true;

    this.expect("{", "Expected '{' after 'juliet'.");
    while (!this.check("}") && !this.isAtEnd()) {
      const key = this.expectIdentifier("Expected a key name in juliet block.");
      if (!key) {
        this.synchronizeInBlock();
        continue;
      }

      if (!JULIET_ALLOWED_KEYS.has(key.value)) {
        this.reportToken(key, `Unknown juliet key '${key.value}'. Supported keys: engine.`, SEVERITY.WARNING);
      }

      this.expect("=", "Expected '=' after juliet key.");
      if (key.value === "engine") {
        this.expectEngineValue();
      } else {
        this.expectValue("Expected a value after '='.");
      }
      this.expect(";", "Expected ';' after juliet assignment.");
    }
    this.expect("}", "Expected '}' to close juliet block.");
  }

  parsePolicy() {
    const name = this.expectIdentifier("Expected policy name.");
    if (!name) {
      this.synchronizeTopLevel();
      return;
    }
    this.registerDefinition(this.context.policies, name, "policy");

    this.expect("=", "Expected '=' after policy name.");
    this.expectStringLiteral("Expected a string or triple-quoted block string for policy body.");
    this.expect(";", "Expected ';' after policy declaration.");
  }

  parseRubric() {
    const name = this.expectIdentifier("Expected rubric name.");
    if (!name) {
      this.synchronizeTopLevel();
      return;
    }
    this.registerDefinition(this.context.rubrics, name, "rubric");

    this.expect("{", "Expected '{' after rubric name.");
    const criteria = new Set();
    const tiebreakers = [];

    while (!this.check("}") && !this.isAtEnd()) {
      if (this.matchKeyword("criterion")) {
        const criterionLabel = this.expectStringLiteral("Expected criterion name string.");
        if (criterionLabel) {
          criteria.add(criterionLabel.value);
        }

        this.expectKeyword("points", "Expected 'points' after criterion label.");
        const points = this.expect("number", "Expected integer points value.");
        if (points && Number.parseInt(points.value, 10) <= 0) {
          this.reportToken(points, "Criterion points should be a positive integer.", SEVERITY.WARNING);
        }
        if (this.matchKeyword("means")) {
          const criterionMeaning = this.expectStringLiteral("Expected criterion meaning string after 'means'.");
          if (criterionMeaning && criterionMeaning.value.trim().length === 0) {
            this.reportToken(criterionMeaning, "Criterion meaning should not be empty.", SEVERITY.WARNING);
          }
        }
        this.expect(";", "Expected ';' after criterion definition.");
        continue;
      }

      if (this.matchKeyword("tiebreakers")) {
        this.expect("[", "Expected '[' after tiebreakers.");
        if (!this.check("]")) {
          while (true) {
            const criterionName = this.expectStringLiteral("Expected criterion name in tiebreakers list.");
            if (criterionName) {
              tiebreakers.push(criterionName);
            }
            if (!this.match(",")) {
              break;
            }
          }
        }
        this.expect("]", "Expected ']' after tiebreakers list.");
        this.expect(";", "Expected ';' after tiebreakers statement.");
        continue;
      }

      this.reportCurrent("Expected 'criterion' or 'tiebreakers' inside rubric block.", SEVERITY.ERROR);
      this.synchronizeInBlock();
    }

    this.expect("}", "Expected '}' to close rubric block.");

    for (const tiebreaker of tiebreakers) {
      if (!criteria.has(tiebreaker.value)) {
        this.reportToken(
          tiebreaker,
          `Tiebreaker '${tiebreaker.value}' does not match any declared rubric criterion.`,
          SEVERITY.WARNING
        );
      }
    }
  }

  parseCadence() {
    const name = this.expectIdentifier("Expected cadence name.");
    if (!name) {
      this.synchronizeTopLevel();
      return;
    }
    this.registerDefinition(this.context.cadences, name, "cadence");

    this.expect("{", "Expected '{' after cadence name.");
    let hasVariants = false;
    let hasSprints = false;

    while (!this.check("}") && !this.isAtEnd()) {
      if (this.matchKeyword("compare")) {
        this.expectKeyword("using", "Expected 'using' after 'compare'.");
        const rubricName = this.expectIdentifier("Expected rubric name after 'compare using'.");
        if (rubricName && !this.context.rubrics.has(rubricName.value)) {
          this.reportToken(rubricName, `Unknown rubric '${rubricName.value}' in cadence compare action.`, SEVERITY.ERROR);
        }
        this.expect(";", "Expected ';' after compare statement.");
        continue;
      }

      if (this.matchKeyword("keep")) {
        this.expectKeyword("best", "Expected 'best' after 'keep'.");
        const keepCount = this.expect("number", "Expected integer keep limit after 'keep best'.");
        if (keepCount && Number.parseInt(keepCount.value, 10) <= 0) {
          this.reportToken(keepCount, "'keep best' value should be greater than 0.", SEVERITY.ERROR);
        }
        this.expect(";", "Expected ';' after keep statement.");
        continue;
      }

      if (this.check("identifier") && this.checkNext("=")) {
        const key = this.advance();
        this.advance(); // '='
        if (key.value === "engine") {
          this.expectEngineValue();
        } else if (key.value === "variants" || key.value === "sprints") {
          const value = this.expect("number", `Expected an integer for cadence key '${key.value}'.`);
          if (value && Number.parseInt(value.value, 10) <= 0) {
            this.reportToken(value, `Cadence '${key.value}' should be greater than 0.`, SEVERITY.ERROR);
          }
          if (key.value === "variants") {
            hasVariants = true;
          }
          if (key.value === "sprints") {
            hasSprints = true;
          }
        } else {
          this.reportToken(
            key,
            `Unknown cadence key '${key.value}'. Supported keys: engine, variants, sprints.`,
            SEVERITY.WARNING
          );
          this.expectValue("Expected a value after cadence assignment.");
        }
        this.expect(";", "Expected ';' after cadence assignment.");
        continue;
      }

      this.reportCurrent("Expected cadence assignment or action (compare/keep).", SEVERITY.ERROR);
      this.synchronizeInBlock();
    }

    this.expect("}", "Expected '}' to close cadence block.");

    if (!hasVariants) {
      this.reportToken(name, "Cadence is missing required key 'variants'.", SEVERITY.WARNING);
    }
    if (!hasSprints) {
      this.reportToken(name, "Cadence is missing required key 'sprints'.", SEVERITY.WARNING);
    }
  }

  parseCreate() {
    const artifact = this.expectIdentifier("Expected artifact name after 'create'.");
    if (!artifact) {
      this.synchronizeTopLevel();
      return;
    }

    this.expectKeyword("from", "Expected 'from' after artifact name.");
    if (this.matchKeyword("juliet")) {
      this.expectStringLiteral("Expected prompt string after 'from juliet'.");
    } else if (this.matchKeyword("julietArtifactSourceFiles")) {
      this.parseCreateSourceFilesList();
    } else {
      this.reportCurrent("Expected 'juliet' or 'julietArtifactSourceFiles' after 'from'.", SEVERITY.ERROR);
    }

    if (this.matchKeyword("using")) {
      this.parseCreateUsingList();
    }

    if (this.matchKeyword("with")) {
      this.parseCreateAttachments();
    }

    this.expect(";", "Expected ';' after create statement.");
    this.registerDefinition(this.context.artifacts, artifact, "artifact");
  }

  parseCreateSourceFilesList() {
    const listStart = this.expect("[", "Expected '[' after 'julietArtifactSourceFiles'.");
    const seenPaths = new Set();
    let pathCount = 0;

    if (!this.check("]")) {
      while (true) {
        const sourcePath = this.expect("string", "Expected quoted file path in source files list.");
        if (sourcePath) {
          pathCount += 1;
          if (seenPaths.has(sourcePath.value)) {
            this.reportToken(sourcePath, `Duplicate source file path '${sourcePath.value}' in julietArtifactSourceFiles list.`, SEVERITY.WARNING);
          }
          seenPaths.add(sourcePath.value);
        }
        if (!this.match(",")) {
          break;
        }
      }
    }

    this.expect("]", "Expected ']' after source files list.");

    if (pathCount === 0) {
      this.reportToken(
        listStart || this.previous(),
        "Expected at least one file path in julietArtifactSourceFiles list.",
        SEVERITY.ERROR
      );
    }
  }

  parseCreateUsingList() {
    this.expect("[", "Expected '[' after 'using'.");
    if (!this.check("]")) {
      while (true) {
        const dependency = this.expectIdentifier("Expected artifact name in 'using' list.");
        if (dependency && !this.context.artifacts.has(dependency.value)) {
          this.reportToken(dependency, `Unknown artifact '${dependency.value}' in using list.`, SEVERITY.ERROR);
        }
        if (!this.match(",")) {
          break;
        }
      }
    }
    this.expect("]", "Expected ']' after using list.");
  }

  parseCreateAttachments() {
    this.expect("{", "Expected '{' to begin create attachments block.");
    const seenKeys = new Set();

    while (!this.check("}") && !this.isAtEnd()) {
      const key = this.expectIdentifier("Expected attachment key in create with-block.");
      if (!key) {
        this.synchronizeInBlock();
        continue;
      }
      if (seenKeys.has(key.value)) {
        this.reportToken(key, `Duplicate create attachment '${key.value}'.`, SEVERITY.WARNING);
      }
      seenKeys.add(key.value);

      this.expect("=", "Expected '=' after create attachment key.");
      const value = this.expectIdentifier("Expected reference name after '='.");
      this.expect(";", "Expected ';' after create attachment.");

      if (!CREATE_ALLOWED_KEYS.has(key.value)) {
        this.reportToken(
          key,
          `Unknown create attachment key '${key.value}'. Supported keys: preflight, failureTriage, cadence, rubric.`,
          SEVERITY.WARNING
        );
        continue;
      }

      if (!value) {
        continue;
      }

      const type = CREATE_ALLOWED_KEYS.get(key.value);
      const exists = this.definitionExists(type, value.value);
      if (!exists) {
        this.reportToken(value, `Unknown ${type} '${value.value}' referenced by '${key.value}'.`, SEVERITY.ERROR);
      }
    }

    this.expect("}", "Expected '}' to close create attachments block.");
  }

  parseExtend() {
    const artifact = this.expectIdentifier("Expected artifact name after 'extend'.");
    if (!artifact) {
      this.synchronizeTopLevel();
      return;
    }
    if (!this.context.artifacts.has(artifact.value)) {
      this.reportToken(artifact, `Unknown artifact '${artifact.value}' in extend statement.`, SEVERITY.ERROR);
    }

    this.expect(".", "Expected '.' after artifact name in extend target.");
    const target = this.expectIdentifier("Expected extend target after '.'.");
    if (target && target.value !== "rubric") {
      this.reportToken(target, "Only '<Artifact>.rubric' is currently supported by extend.", SEVERITY.ERROR);
    }

    this.expectKeyword("with", "Expected 'with' after extend target.");
    this.expectStringLiteral("Expected string or block string after 'with'.");
    this.expect(";", "Expected ';' after extend statement.");
  }

  parseHalt() {
    if (!this.check(";")) {
      this.expectStringLiteral("Expected optional halt message string before ';'.");
    }
    this.expect(";", "Expected ';' after halt statement.");
  }

  registerDefinition(map, token, label) {
    if (map.has(token.value)) {
      this.reportToken(token, `Duplicate ${label} '${token.value}'.`, SEVERITY.WARNING);
    }
    map.set(token.value, token);
  }

  definitionExists(type, name) {
    if (type === "policy") {
      return this.context.policies.has(name);
    }
    if (type === "rubric") {
      return this.context.rubrics.has(name);
    }
    if (type === "cadence") {
      return this.context.cadences.has(name);
    }
    if (type === "artifact") {
      return this.context.artifacts.has(name);
    }
    return false;
  }

  expectEngineValue() {
    if (this.check("identifier") || this.check("string")) {
      this.advance();
      return;
    }
    this.reportCurrent("Expected engine value as an identifier or quoted string.", SEVERITY.ERROR);
  }

  expectValue(message) {
    if (this.check("identifier") || this.check("string") || this.check("blockString") || this.check("number")) {
      return this.advance();
    }
    this.reportCurrent(message, SEVERITY.ERROR);
    return null;
  }

  expectStringLiteral(message) {
    if (this.check("string") || this.check("blockString")) {
      return this.advance();
    }
    this.reportCurrent(message, SEVERITY.ERROR);
    return null;
  }

  expectIdentifier(message) {
    if (this.check("identifier")) {
      return this.advance();
    }
    this.reportCurrent(message, SEVERITY.ERROR);
    return null;
  }

  expectKeyword(keyword, message) {
    if (this.matchKeyword(keyword)) {
      return this.previous();
    }
    this.reportCurrent(message, SEVERITY.ERROR);
    return null;
  }

  expect(kind, message) {
    if (this.check(kind)) {
      return this.advance();
    }
    this.reportCurrent(message, SEVERITY.ERROR);
    return null;
  }

  synchronizeTopLevel() {
    while (!this.isAtEnd()) {
      if (this.check(";")) {
        this.advance();
        return;
      }
      if (this.check("identifier") && TOP_LEVEL_KEYWORDS.has(this.current().value)) {
        return;
      }
      this.advance();
    }
  }

  synchronizeInBlock() {
    while (!this.isAtEnd() && !this.check(";") && !this.check("}")) {
      this.advance();
    }
    if (this.check(";")) {
      this.advance();
    }
  }

  reportCurrent(message, severity) {
    this.reportToken(this.current(), message, severity);
  }

  reportPrevious(message, severity) {
    this.reportToken(this.previous(), message, severity);
  }

  reportToken(token, message, severity) {
    this.diagnostics.push({
      severity,
      message,
      range: {
        start: token.start,
        end: token.end
      }
    });
  }

  check(kind) {
    return this.current().kind === kind;
  }

  checkNext(kind) {
    return this.peek().kind === kind;
  }

  match(kind) {
    if (this.check(kind)) {
      this.advance();
      return true;
    }
    return false;
  }

  checkKeyword(keyword) {
    return this.check("identifier") && this.current().value === keyword;
  }

  matchKeyword(keyword) {
    if (this.checkKeyword(keyword)) {
      this.advance();
      return true;
    }
    return false;
  }

  advance() {
    if (!this.isAtEnd()) {
      this.currentIndex += 1;
    }
    return this.previous();
  }

  isAtEnd() {
    return this.current().kind === "eof";
  }

  current() {
    return this.tokens[this.currentIndex];
  }

  previous() {
    return this.tokens[this.currentIndex - 1];
  }

  peek() {
    return this.tokens[Math.min(this.currentIndex + 1, this.tokens.length - 1)];
  }
}

function lintJulietScript(source) {
  const tokenizer = new Tokenizer(source);
  const tokenized = tokenizer.tokenize();
  const parser = new Parser(tokenized.tokens, tokenized.diagnostics);
  return parser.parse();
}

module.exports = {
  lintJulietScript,
  SEVERITY
};
