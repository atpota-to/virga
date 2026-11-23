// Builds a port or audit prompt exactly as port-wave.workflow.js does, for
// running the steps as separate agents when the Workflow tool isn't available. Usage: node mkprompt.mjs <args.json> <A|B> <stepIndex> <port|audit> <out> [earlier.json] [port-result.json]
import fs from 'node:fs';
const [argsFile, chainKey, stepIndex, kind, out, earlierFile, portFile] =
  process.argv.slice(2);
const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
let src = fs.readFileSync(
  new URL('./port-wave.workflow.js', import.meta.url),
  'utf8',
);
src = src.slice(
  src.indexOf('const SWIFT'),
  src.indexOf('async function runChain'),
);
const make = new Function(
  'args',
  src + '\nreturn { COMMON, portPrompt, auditPrompt };',
);
const { portPrompt, auditPrompt } = make(args);
const chain =
  chainKey === 'A'
    ? {
        name: 'Chain A',
        wt: args.wtA,
        branch: args.branchA,
        steps: args.chainA,
      }
    : {
        name: 'Chain B',
        wt: args.wtB,
        branch: args.branchB,
        steps: args.chainB,
      };
const step = chain.steps[Number(stepIndex)];
const earlier = earlierFile
  ? JSON.parse(fs.readFileSync(earlierFile, 'utf8'))
  : [];
let port = portFile ? JSON.parse(fs.readFileSync(portFile, 'utf8')) : null;
if (kind === 'audit' && !port) {
  port = {
    domain: step.domain,
    note:
      step.portNote ||
      "Ported earlier; the porter's full summary is in " +
        step.portSummaryPath +
        ' (read it).',
  };
}
const text =
  kind === 'port'
    ? portPrompt(chain, step, earlier)
    : auditPrompt(chain, step, port);
const tail = `\n\n## Returning your result\nThere is no structured-output tool here. End with your result as a single JSON object in a \`\`\`json fenced block, with the fields ${kind === 'port' ? 'domain, committed, commits, files [{web, status, swift, note}], fixtures, parityCases, swiftTests, apiForDownstream, gaps, webBugsNoticed' : 'domain, committed, findings [{severity, web, issue, fixed}], casesAdded, swiftTests, remainingGaps, apiForDownstream'}.`;
fs.writeFileSync(out, text + tail);
console.log(out, (text + tail).length);
