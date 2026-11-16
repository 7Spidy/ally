-- Reply claims that outlive their request.
--
-- /api/chat/reply claims a user message by moving companions.last_replied_msg
-- up to its id, and gives the claim back only from its catch block. A request
-- the platform kills (past maxDuration) never reaches that block, so the claim
-- was held for good: every later ask got 202 "pending", and that message was
-- never answered.
--
-- reply_claimed_at is when the claim was taken. The route sets it with the
-- claim and clears it once the reply is written (or the claim is given back).
-- A claim still set past the route's time limit belongs to a dead request,
-- and the next ask takes it over. A claim with nothing written and no time set
-- is a reply that was written as silence (an ignored double text).
--
-- No grant changes: owners can already select their own companion rows (and
-- so this timestamp, which says nothing private); only the service role writes.

alter table public.companions
  add column if not exists reply_claimed_at timestamptz;
