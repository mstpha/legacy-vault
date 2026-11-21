const path = require("path");

const REPORT_TITLE = "backup backend unit tests (database-free)";
const FILE_DESCRIPTIONS = {
  "audit-chain.test.js": "audit log integrity (detecting tampering)",
  "schema-consistency.test.js": "database schema and notification consistency",
  "auth.e2e.test.js": "authentication, email verification, and MFA (database required)",
  "business-rules.e2e.test.js": "business rules and access control (database required)",
  "capsule-lifecycle.e2e.test.js": "capsule lifecycle (database required)",
  "health.e2e.test.js": "health endpoints (database required)",
  "auth.test.js": "authentication flow (database required)",
};

function supportsUnicode() {
  if (!process.stdout.isTTY || process.env.FORCE_ASCII === "1") return false;
  if (process.platform !== "win32") return true;
  return Boolean(process.env.WT_SESSION || process.env.TERM || process.env.TERM_PROGRAM);
}

function color(text, code) {
  if (!process.stdout.isTTY || process.env.NO_COLOR || process.env.FORCE_COLOR === "0") return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

function elapsed(ms) {
  return `${Math.max(0, Math.round(ms || 0))} ms`;
}

function shortValue(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 180) || "(not shown)";
}

function expectedAndReceived(messages) {
  const text = (messages || []).join("\n");
  const expected = /^\s*Expected:\s*(.*)$/m.exec(text);
  const received = /^\s*Received:\s*(.*)$/m.exec(text);
  return {
    expected: expected ? shortValue(expected[1]) : null,
    received: received ? shortValue(received[1]) : null,
  };
}

function failureLine(assertion, testFilePath) {
  if (assertion.location && assertion.location.line) return assertion.location.line;
  const escapedName = path.basename(testFilePath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedName}:(\\d+):\\d+`).exec((assertion.failureMessages || []).join("\n"));
  return match ? Number(match[1]) : null;
}

function assertionName(assertion) {
  const nested = (assertion.ancestorTitles || []).slice(1);
  return [...nested, assertion.title].filter(Boolean).join(" > ");
}

class SimpleReporter {
  onRunStart() {
    process.stdout.write(`Starting ${REPORT_TITLE}...\n`);
  }

  onRunComplete(_contexts, results) {
    const unicode = supportsUnicode();
    const marks = unicode
      ? { pass: "✔", fail: "✘", skipped: "–" }
      : { pass: "[PASS]", fail: "[FAIL]", skipped: "[SKIP]" };
    const suites = [];
    const tests = [];

    for (const suite of results.testResults || []) {
      const file = path.basename(suite.testFilePath || "");
      const description = FILE_DESCRIPTIONS[file] || file.replace(/\.test\.js$/, "").replace(/[-_]/g, " ");
      const assertions = suite.testResults || suite.assertionResults || [];
      const runtime = suite.perfStats?.runtime ?? assertions.reduce((sum, item) => sum + (item.duration || 0), 0);
      const failed = Boolean(suite.testExecError) || suite.numFailingTests > 0;
      const relativePath = path.relative(process.cwd(), suite.testFilePath || file);

      process.stdout.write(`\nTesting: ${description}\n`);
      for (const assertion of assertions) {
        const status = assertion.status;
        const duration = assertion.duration || 0;
        const name = assertionName(assertion);
        const isSlow = duration > 1000;
        let line;

        if (status === "passed") {
          line = color(`  ${marks.pass} ${name} (${elapsed(duration)})${isSlow ? " SLOW" : ""}`, "32");
        } else if (status === "failed") {
          line = color(`  ${marks.fail} ${name} (FAILED, ${elapsed(duration)})${isSlow ? " SLOW" : ""}`, "31");
          const detail = expectedAndReceived(assertion.failureMessages);
          if (detail.expected || detail.received) {
            line += `\n     Expected: ${detail.expected || "(see assertion)"}\n     Actual:   ${detail.received || "(see assertion)"}`;
          } else if (assertion.failureMessages?.length) {
            line += `\n     What happened: ${shortValue(assertion.failureMessages[0].split("\n")[0])}`;
          }
          const sourceLine = failureLine(assertion, suite.testFilePath);
          line += `\n     File: ${relativePath}${sourceLine ? `:${sourceLine}` : ""}`;
        } else {
          line = color(`  ${marks.skipped} ${name} (SKIPPED, ${elapsed(duration)})`, "33");
        }

        if (isSlow) line = color(line, "33");
        process.stdout.write(`${line}\n`);
        tests.push({ name: `${file}: ${name}`, duration, status });
      }

      const seconds = (runtime / 1000).toFixed(2);
      process.stdout.write(`Finished ${description} in ${seconds} seconds\n`);
      suites.push({ failed, count: assertions.length, description });
    }

    const passedTests = results.numPassedTests || 0;
    const failedTests = results.numFailedTests || 0;
    const skippedTests = results.numPendingTests || 0;
    const passedSuites = suites.filter((suite) => !suite.failed).length;
    const failedSuites = suites.length - passedSuites;
    const totalSeconds = ((Date.now() - (results.startTime || Date.now())) / 1000).toFixed(2);
    const slowest = tests
      .filter((test) => test.status !== "pending" && test.status !== "todo")
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 3);

    process.stdout.write("\n+--------------------------------------+\n");
    process.stdout.write("|               SUMMARY                |\n");
    process.stdout.write("+--------------------------------------+\n");
    process.stdout.write(`| Suites: ${passedSuites} passed, ${failedSuites} failed\n`);
    process.stdout.write(`| Tests:  ${passedTests} passed, ${failedTests} failed, ${skippedTests} skipped\n`);
    process.stdout.write(`| Total time: ${totalSeconds} seconds\n`);
    process.stdout.write("| Slowest tests:\n");
    if (slowest.length === 0) process.stdout.write("|   No completed tests\n");
    for (const test of slowest) {
      process.stdout.write(`|   ${elapsed(test.duration)} - ${test.name}\n`);
    }
    process.stdout.write("+--------------------------------------+\n");
    const final =
      failedTests === 0 && failedSuites === 0 && !results.wasInterrupted
        ? "ALL TESTS PASSED"
        : "SOME TESTS FAILED";
    process.stdout.write(`${final}\n`);
  }
}

module.exports = SimpleReporter;
