// Must stay identical to prompts/intake.md. The markdown is the reviewable copy;
// this string is what the packaged app bundles, because the main process cannot read src/.
export const INTAKE_PROMPT = `# Intake

Do not create a run, baseline, plan, or write product code until this brief is approved.

1. Look through the project read-only. Do not ask about anything the code already answers.
2. Restate the idea in plain words:
   \`ORCA factory say --request <request-id> --text "..."\`.
3. Ask only what you cannot look up. At most 3 questions in one turn, and at most 4 turns. Then stop and state your assumptions. Each question needs 2 to 4 choices, one recommended (1 is the first choice), and a one-line why:
   \`ORCA factory ask --request <request-id> --question "..." --choice "A" --choice "B" --recommended 1 --why "..."\`.
   No code, file names, or library names in the question or the choices.
   If the reply says waiting, repeat with \`--question-id <id>\`.
4. Write one brief and submit it:
   \`ORCA factory brief --request <request-id> --file brief.json\`
   The file is JSON: \`{ "person": "...", "agent": "...", "kind": "app_only", "acceptance": ["..."] }\`.
   kind is one of app_only, needs_backend, app_and_backend, needs_native, not_feasible.
   person is what the requester will read: what you will build, the steps, what is not included.
   agent is the build brief: screens and files you found, the acceptance checklist, patterns to reuse, constraints, edge cases, and what is out of scope.
5. Wait: \`ORCA factory await-brief --request <request-id>\`.
   APPROVED: the reply is the build brief. Build that text, not the person's original words.
   CHANGES: revise the brief, submit it again, then wait again.
`
