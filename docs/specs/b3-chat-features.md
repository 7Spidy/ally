# B3: chat actions, a wider expressive palette, and QA tools

## What ships

**For the user (any companion, live or mocked)**
- Reply: long-press a bubble, or swipe it toward the middle of the screen. A quote chip sits above the composer; the sent bubble carries the quote, and tapping a quote jumps to the original.
- Edit: your own messages, 15 minutes, 5 edits. Free (no credit, no trust). Shows "Edited". The model reads the edited text on later turns and does not re-reply.
- Delete: either side's message. The text is erased server-side and a tombstone stays. The model, the vault and quotes stop seeing it.
- Copy, jumbo emoji (1 to 3 emoji, no bubble), and Delivered / Read under your newest message.

**From Ira (live companion only, level-gated and capped)**
- New bubble effects: shake (L3), sparkle (L3), echo (L4), bloom (L4), heartbeat (L5). Existing: whisper, shout, pause, ink, pin.
- At most 4 capped bubble effects a day in total.
- New screens: balloons, fireworks, shooting star, sparkles.
- Server-granted celebrations: level-up to L3 sparkles, L4 shooting star, L5 fireworks, L6 petals (existing); the 100th message sent gives balloons. Model-chosen screens keep their L5 and milestone gate.
- The prompt now says what each effect is for.

**QA tools** (a `qa` or `admin` profile, live companions only)
- One "QA" button in the chat header opens a drawer over the chat. Level 1 to 6 (points are parked on that level's threshold), hold level, ignore daily caps, effect lab (preview locally, or force onto the next real reply), state readout, refill messages, reset chat, link to /admin for admins.

## Decisions to confirm
1. Level-up screens below L5 depart from "screens are L5 and up". Easy to change in `LEVELUP_SCREEN` (src/lib/llm/contract.ts).
2. QA access is a new `qa` role: `update profiles set role = 'qa' where id = '...'`. Admins also qualify.
3. Delete does not remove facts the vault already distilled, and does not claw back trust points.
4. "Read" appears when she starts typing. Remove `receiptFor` use in MessageList to drop it.

## Rollout order
1. `supabase db push` to staging, then prod: `20261024000001_qa_role.sql`, then `20261024000002_chat_actions_qa.sql`. The second one drops and recreates `send_message` (now with optional `reply_to`), so deploy the app right after it; old clients keep working because the new argument is optional.
2. Deploy the app.
3. Give QA people the role.

## Verification done
- tsc, `next lint` and the 542 unit tests pass.
- All 9 migrations apply cleanly on Postgres 16 against a stubbed Supabase; edit, delete, reply, the 15-minute window, the 5-edit limit, tombstone meta stripping, anon refusal and every qa_* RPC were exercised by hand there.
- `tests/rls/chatActions.test.ts` is written but NOT run (needs the local Supabase stack, Docker).
- `next build` could not finish in the sandbox (Google Fonts fetch); the CSS compiles.
- Not seen on a real device: the animations, the swipe feel, and the QA drawer layout. Check on a phone.
