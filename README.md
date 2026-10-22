# ADAPT — Adaptive Daily Planning & Recovery

When life changes, ADAPT recalculates your day instead of making you rebuild it.

ADAPT is a hackathon demo of a simulated Alexa+ planning experience. A student has a presentation, an essay due tonight, a rehearsal, and a commute. When the day changes, ADAPT recalculates the schedule, explains the tradeoff in plain language, and waits for approval before saving anything.

This is a **simulated** Alexa+ experience. It is not connected to Alexa, Amazon devices, AWS, Amazon Bedrock, or any live calendar, traffic, or weather service.

## Problem

A fixed calendar does not help when one appointment moves. People then rebuild the day by hand: the commute, the class that now overlaps, the essay that still has a deadline, and the optional gym session that may no longer fit. The hard part is seeing the consequence and choosing a recovery, not drawing the original blocks.

## Solution

ADAPT keeps an accepted plan. A reported change becomes a normalized disruption. A deterministic scheduler builds one or more recoveries from the task rules, explains why each block moved, and shows the original time next to the proposed time. The accepted plan changes only after **Approve changes**. **Reject** throws the proposal away.

## Key features

- Sample day with durations, deadlines, priorities, travel buffer, and fixed, protected, and free-to-move tasks.
- Three demo disruptions: presentation moves to 11:00 AM, traffic adds 30 minutes, pick up Noah at the station.
- A few more plain sentences, including a 90-minute study block before 10:00 PM, and “move gym if necessary” while a recovery is open.
- A local planning tool that speaks MCP (Model Context Protocol) 2025-11-25 over Streamable HTTP. The web app calls it with initialize, tools/list, and tools/call. If it is off or unreachable, the same scheduler runs inside the page.
- Conflict detection when a protected time cannot stay.
- At least two feasible recoveries when the demo conflict has more than one reasonable choice.
- Plain-language reasons for the reported change and for the recommendation.
- Approve, reject, option selection, help, and reset.
- Accepted plan saved in browser `localStorage` and restored on refresh.
- Loading, success, error, empty, rejected, and conflict states.

## Architecture

```text
Sentences and sample buttons        src/lib/interpret.ts
                                    src/lib/parse-command.ts
        │  structured request, then a Disruption
        ▼
Local planning tool (MCP)           src/app/api/mcp/route.ts
                                    src/lib/mcp/protocol.ts
        │  tools/call propose_recovery
        ▼
Scheduler                           src/lib/planner.ts
        │  Proposal
        ▼
Screen and localStorage             src/components/
                                    src/lib/session.ts
                                    src/lib/storage.ts
```

If the planning tool does not answer, the screen calls `propose()` directly. The times come from the same function either way.

Sample calendar and sample traffic still enter through `src/lib/demo-data.ts` and `src/lib/providers.ts`. Those demo providers stay disconnected. The planner does not import them and does not read sentences.

| Input | Demo today | Future connection, not built |
|---|---|---|
| Calendar | `demoCalendar.load()` returns the sample tasks | A calendar provider would return the same `Task` shape |
| Traffic | `demoTraffic.sampleDelay()` returns +30 minutes for the sample commute | A traffic provider would return added minutes, then `disruptionFromTraffic()` |
| Requests | `interpretRequest()` in `src/lib/interpret.ts` matches known sentences and returns a disruption or a review command | A hosted assistant would return the same shapes. The MCP tool already carries the disruption into the scheduler |
| Planner | `propose()` in `src/lib/planner.ts` | Stays the piece that assigns times |
| UI | React components draw the proposal | Stays a view of planner output |

New sample events should use an existing disruption type: move a fixed task, extend travel, or add a task. `applyDisruption()` in the planner is the only place that turns that input into task properties. The scheduling pass itself reads duration, priority, deadline, earliest start, flexibility, and dependencies.

## Scheduling logic

Picture a person with a pencil.

1. Pin fixed appointments and protected blocks, including sleep.
2. Place travel so it ends its arrival buffer before the appointment it is heading to.
3. If a protected class now overlaps, do not quietly overwrite it. Report the conflict, or offer a recovery that moves the class, or offer one that shortens the overlap.
4. Place tight windows before long tasks.
5. Place urgent work before optional work, and keep a task at its old time when that time still fits.
6. If a task has a preferred window, one option keeps that window when required work still fits.
7. If a required task cannot fit, the plan is marked not feasible and **Approve changes** stays off.

The same inputs always produce the same times. No model is called. Reasons shown on screen come from those times: what overlapped, what deadline or buffer forced the move, and what the recommendation preserves.

`movable` in the data means free to reschedule. The screen says "Free to move."

## How to run locally

1. Open the `AMAZON` folder in VS Code.
2. Open a terminal: **Terminal → New Terminal**.
3. Install dependencies the first time:

```powershell
npm install
```

4. Start the app:

```powershell
npm run dev
```

5. Open the local address Next.js prints, usually [http://localhost:3000](http://localhost:3000).

Press `Ctrl+C` in the terminal to stop the server. No API key is required.

The planning tool is part of this same app, at `POST /api/mcp`. To force the built-in scheduler instead, create `.env.local` with:

```text
NEXT_PUBLIC_ADAPT_MCP_URL=off
```

Restart `npm run dev` after changing that file. `.env.local` is gitignored. There is no secret to put in it. See `.env.example`.

## Demo walkthrough

The demo clock is Wednesday, October 22, 2026, at 4:00 PM. Sand is the accepted plan. Cyan is a proposal. The left column does not change until you approve.

1. Read the opening day. The essay is 4:00–6:00 PM. Rehearsal follows. The commute leaves at 8:00 AM so you arrive 15 minutes before the 9:00 AM presentation.
2. Choose **Presentation moves to 11:00 AM**. ADAPT says the original seminar overlaps the new presentation time. The recommended recovery moves the full 60-minute seminar to 12:00 PM. The other shortens the seminar to 45 minutes.
3. Press **Approve changes**. Refresh the page. The 11:00 AM presentation is still there. The commute now leaves at 10:00 AM so the 15-minute buffer still holds.
4. Choose **Traffic adds 30 minutes**. The commute becomes 75 minutes. Departure moves from 10:00 AM to 9:30 AM and still arrives 15 minutes early. This step is one clean shift because the gym is no longer in the way.
5. Approve it. If you try traffic on the original 9:00 AM plan instead, departure moves from 8:00 AM to 7:30 AM, and ADAPT offers two choices: move the optional gym session, or drop it.
6. Type `I need to pick up Noah at the station` and press Send. Two evening plans appear. One keeps dinner at its preferred time. The other eats later. The essay still finishes before 11:59 PM.
7. Approve one. Press **Reset sample day** and the original 9:00 AM day returns.

You can also type `Add a 90 minute study session before 10 PM`. While a recovery is open, `Move my gym session if necessary` selects the option that moves the gym, when one exists. The header says **Planning tool on** when the MCP tool answered, and **Demo scheduler** when it did not.

You can also type `approve`, `reject`, `option 2`, `help`, or `reset`.

## Testing

From the project folder:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

`npm test` checks the sample schedule, the presentation conflict, both seminar recoveries, traffic, Noah's two evenings, the study-session sentence, plain-language reasons, deadline violations, fixed and protected behavior, approval, rejection, reset, and the planning-tool boundary. Those tool tests use an in-memory message handler and a fake network. They do not call a live service.

## Current limitations

- The phrase list understands the three sample disruptions, a 90-minute study session before 10 PM, “move the gym if necessary” while a recovery is open, plus approve, reject, reset, help, and option numbers. Any other sentence shows an error and does not change the plan.
- Travel, the seminar, and Noah's train are sample facts. There is no live traffic, weather, calendar, or Alexa device connection.
- Tasks are not split into pieces. The essay stays one block.
- After the presentation is already approved, traffic has one recovery. Two gym choices appear only on the original 9:00 AM plan.
- The accepted demo plan is stored in this browser under `adapt.demo.v1`. **Reset sample day**, or clearing site data, removes it.
- There is no user account and no server database.

## Amazon technology used

The Alexa+ track asks for a self-hosted MCP server, protocol 2025-11-25 or later, over Streamable HTTP. Alexa’s own device console and add-on toolkit are limited to selected partners, so this project does not connect to an Alexa device.

What is genuinely running:

- `POST /api/mcp` is an MCP endpoint.
- The page is the client. It sends `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`.
- The only tool is `propose_recovery`. It checks the disruption, then calls `propose()` in `src/lib/planner.ts`.
- The handler is `src/lib/mcp/protocol.ts`. The HTTP route is `src/app/api/mcp/route.ts`. The browser client is `src/lib/mcp/client.ts`.

What is simulated:

- The calendar, the commute, and Noah’s pickup are sample data.
- The sentence list in `src/lib/interpret.ts` is not Amazon Bedrock and not an Alexa skill.
- The badge **Simulated Alexa+** means the conversation is a demo.

What is not connected: Alexa devices, the Alexa+ developer console, Amazon Bedrock, AWS APIs, live traffic, and live calendars. No API key is used.

### Environment

| Variable | Required | Meaning |
|---|---|---|
| `NEXT_PUBLIC_ADAPT_MCP_URL` | No | Unset: use this app’s `/api/mcp`. `off`: skip the tool and use the built-in scheduler. A URL: call that MCP endpoint instead. |

The variable is public because the browser is the MCP client. It is not a secret. Do not put keys in it.

The route rejects a foreign `Origin` header, so another website cannot call the tool in your browser session. Requests have a size cap. The tool accepts only the three disruption shapes the scheduler already understands.

## Future roadmap

- More disruption types only if they still become task-property changes inside `applyDisruption()`.
- A real calendar or traffic source behind `src/lib/providers.ts`, still feeding `propose()`.
- A hosted Alexa+ connection only if Amazon opens that console to this project. The MCP tool is the piece that connection would call.
- Account storage only if the demo needs to leave this browser.

## License

MIT. See [LICENSE](LICENSE).
