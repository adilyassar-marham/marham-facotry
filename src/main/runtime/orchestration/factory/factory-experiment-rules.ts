import type { FactoryReviewFinding } from '../../../../shared/factory-run-types'

const TABS_EXPERIMENTS = /^src\/app\/\(tabs\)\/experiments(\/|$)/
const EXPERIMENT_COPY = /^src\/app\/experiments\//
const LOADING = /^src\/app\/loading\.(jsx|tsx|js|ts)$/
const REMOTE_CONFIG = /^src\/services\/remote-config\.(jsx|tsx|js|ts)$/
const APP_SCREEN = /^src\/app\//

/**
 * How Marham ships an experiment. Attached to every factory task, review, and fix.
 * One pattern. The original screen stays as it is.
 */
export const FACTORY_EXPERIMENT_RULES = `# Experiment rules

These rules apply to every experiment. Follow this structure. Do not invent a second pattern.

## Hard rules

- Do not change the original file. The production screen stays as it is.
- Copy that screen into \`src/app/experiments/\`. All experiment UI and logic goes in the copy only.
- The experiments folder is \`src/app/experiments/\`. Never \`src/app/(tabs)/experiments/\`.
- One experiment = one copy (same filename as the original, or a clear name if several variants share a screen).
- Turn the experiment on and off with a Firebase Remote Config flag. Default is the original behavior (flag off = original route).
- Decide the route on the loading screen (\`src/app/loading.jsx\`) after preload. Flag on goes to \`/experiments/<screen>\`. Flag off goes to the original route.
- Do not put experiment branches (\`if (flag)\`) inside original screens.
- Do not ship an experiment by editing Home, Search, or any other live file.
- Do not set the Remote Config default to the variant for all users. Use an A/B test or a test-device condition.
- Do not Start an A/B for all users until the copy and the loading route exist in the native build you want to measure.

## Layout

- \`src/app/<original-route>/<screen>.jsx\` is the original. Never edit it for an experiment.
- \`src/app/experiments/<screen>.jsx\` is the copy. This is the only screen file you change.
- \`src/app/loading.jsx\` checks the flag and chooses the route.
- \`src/services/remote-config.js\` holds the flag key, the default, and \`getExperiment()\`.

Example: \`src/app/(tabs)/search.jsx\` stays. The copy is \`src/app/experiments/search.jsx\`. Flag off opens \`/search\`. Flag on opens \`/experiments/search\`.

## How to add an experiment

1. Copy the original screen into \`src/app/experiments/\`. Fix relative imports (\`../../services\`, \`../../store\`, and so on). Leave the original file untouched.
2. Change the copy only. Keep the same analytics event names as the original so Firebase can compare arms. Add the flag value on those events (extend \`experimentParams()\` or add a helper for the new key).
3. Register the flag in \`src/services/remote-config.js\`. Key is snake_case, the same string as in Firebase. Default is control (the original). Add the key to defaults and to the fetch and apply path. In Firebase Remote Config, create the same parameter, set default to control, and Publish.
4. Route from \`src/app/loading.jsx\` after data preload, next to the existing experiment check:

\`\`\`js
router.replace(
  getExperiment(YOUR_FLAG_KEY) === YOUR_VARIANT_VALUE
    ? "/experiments/<screen>"
    : "/<original-route>",
);
\`\`\`

If several experiments can run, pick one destination (priority order). Do not send the user to two screens. If another entry still jumps to the original (for example \`/name\` to Home), add the same flag check there only if that entry must see the experiment. Do not patch the original screen to redirect.

5. A/B Testing on that Remote Config key. Control is the default. Variant is the value that opens \`/experiments/...\`. Goal is an existing \`mo_*\` event. Device-only: keep the experiment draft and add \`appInstanceId\` as a test device. Live: Start only on the audience and build that contains this code. Keep exposure small at first.

## Checklist

- Original file has no experiment code.
- Copy exists under \`src/app/experiments/\`.
- Flag default is control.
- Loading routes to the copy only when the flag is on.
- Analytics events still fire, and the variant is in the event params.
- Firebase parameter is published. The A/B is not started for everyone unless that was intended.

## Constraints

Flags are read through \`@react-native-firebase/remote-config\`. A new native module or first-time Remote Config wiring needs a native rebuild. After that, Publish in Firebase is enough to change who hits which route. Screens under \`src/app/experiments/\` sit outside the tab navigator (no bottom tab bar unless you add it). The Home and Search tabs still open the original route. The flag only chooses the first screen after loading. Keep \`FIREBASE_DEBUG\` false on shipped builds.
`

export function findExperimentViolations(changedFiles: readonly string[]): FactoryReviewFinding[] {
  const shipping = changedFiles.some(
    (file) => EXPERIMENT_COPY.test(file) || TABS_EXPERIMENTS.test(file)
  )
  const findings: FactoryReviewFinding[] = []
  for (const file of changedFiles) {
    if (TABS_EXPERIMENTS.test(file)) {
      findings.push({
        rule: 'Factory: experiments live in src/app/experiments',
        file,
        problem: `${file} is under src/app/(tabs)/experiments/.`,
        fix: 'Move the copy to src/app/experiments/<screen>.jsx. Leave the tab route alone.'
      })
      continue
    }
    if (
      !shipping ||
      EXPERIMENT_COPY.test(file) ||
      LOADING.test(file) ||
      REMOTE_CONFIG.test(file) ||
      !APP_SCREEN.test(file)
    ) {
      continue
    }
    findings.push({
      rule: 'Factory: an experiment does not edit the original screen',
      file,
      problem: `${file} is a production screen, and this branch also changes an experiment copy.`,
      fix: 'Revert the original. Change only the copy under src/app/experiments/, plus src/app/loading.jsx and src/services/remote-config.js for the flag.'
    })
  }
  return findings
}
