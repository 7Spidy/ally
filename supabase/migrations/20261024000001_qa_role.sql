-- B3: a QA role. Its own migration because a new enum value cannot be used
-- in the transaction that adds it; 20261024000002 references 'qa'.
alter type public.user_role add value if not exists 'qa';
