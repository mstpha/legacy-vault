-- Run this in the Supabase SQL Editor AFTER running the new migration below
-- (the `role` column doesn't exist until that migration is applied).
--
-- Promotes an existing account to ADMIN, which unlocks the Roles & Permissions
-- page in the app. There's deliberately no in-app button for this — granting
-- admin is a DB-level act, not something any logged-in user should be able to
-- trigger on themselves or anyone else.

update users
set role = 'ADMIN'
where email = 'benmstphaadem@gmail.com';

-- Verify it took:
select id, email, role from users where email = 'benmstphaadem@gmail.com';
