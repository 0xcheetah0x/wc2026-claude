-- World Cup 2026 Prediction Game
-- Match seed data for public.matches.
--
-- Source: current app MATCHES list in index.html.
-- This file intentionally seeds no users, predictions, scores, credentials,
-- API keys, emails, or passwords.

begin;

insert into public.matches (
  id,
  group_code,
  stage,
  home_team,
  away_team,
  home_seeded,
  away_seeded,
  kickoff_at,
  city
) values
  (1, 'A', 'group', 'Meksika', 'Güney Afrika', true, false, '2026-06-11T19:00:00Z'::timestamptz, 'Meksika City'),
  (2, 'A', 'group', 'Güney Kore', 'Çekya', false, false, '2026-06-12T02:00:00Z'::timestamptz, 'Guadalajara'),
  (3, 'B', 'group', 'Kanada', 'Bosna Hersek', true, false, '2026-06-12T19:00:00Z'::timestamptz, 'Toronto'),
  (4, 'D', 'group', 'ABD', 'Paraguay', true, false, '2026-06-13T01:00:00Z'::timestamptz, 'Los Angeles'),
  (5, 'D', 'group', 'Avustralya', 'Türkiye', false, false, '2026-06-13T04:00:00Z'::timestamptz, 'Vancouver'),
  (6, 'B', 'group', 'Katar', 'İsviçre', false, false, '2026-06-13T19:00:00Z'::timestamptz, 'San Francisco'),
  (7, 'C', 'group', 'Brezilya', 'Fas', true, false, '2026-06-13T22:00:00Z'::timestamptz, 'New Jersey'),
  (8, 'C', 'group', 'Haiti', 'İskoçya', false, false, '2026-06-14T01:00:00Z'::timestamptz, 'Boston'),
  (9, 'E', 'group', 'Almanya', 'Curaçao', true, false, '2026-06-14T17:00:00Z'::timestamptz, 'Houston'),
  (10, 'F', 'group', 'Hollanda', 'Japonya', true, false, '2026-06-14T20:00:00Z'::timestamptz, 'Dallas'),
  (11, 'E', 'group', 'Fildişi Sah.', 'Ekvador', false, false, '2026-06-14T23:00:00Z'::timestamptz, 'Philadelphia'),
  (12, 'F', 'group', 'İsveç', 'Tunus', false, false, '2026-06-15T02:00:00Z'::timestamptz, 'Monterrey'),
  (13, 'H', 'group', 'İspanya', 'Yeşil Burun A.', true, false, '2026-06-15T16:00:00Z'::timestamptz, 'Atlanta'),
  (14, 'G', 'group', 'Belçika', 'Mısır', true, false, '2026-06-15T19:00:00Z'::timestamptz, 'Seattle'),
  (15, 'H', 'group', 'Suudi Arabistan', 'Uruguay', false, false, '2026-06-15T22:00:00Z'::timestamptz, 'Miami'),
  (16, 'G', 'group', 'İran', 'Yeni Zelanda', false, false, '2026-06-16T01:00:00Z'::timestamptz, 'Los Angeles'),
  (17, 'I', 'group', 'Fransa', 'Senegal', true, false, '2026-06-16T19:00:00Z'::timestamptz, 'New Jersey'),
  (18, 'I', 'group', 'Irak', 'Norveç', false, false, '2026-06-16T22:00:00Z'::timestamptz, 'Boston'),
  (19, 'J', 'group', 'Arjantin', 'Cezayir', true, false, '2026-06-17T01:00:00Z'::timestamptz, 'Kansas City'),
  (20, 'J', 'group', 'Avusturya', 'Ürdün', false, false, '2026-06-16T07:00:00Z'::timestamptz, 'San Francisco'),
  (21, 'K', 'group', 'Portekiz', 'Kongo', true, false, '2026-06-17T17:00:00Z'::timestamptz, 'Houston'),
  (22, 'L', 'group', 'İngiltere', 'Hırvatistan', true, false, '2026-06-17T20:00:00Z'::timestamptz, 'Dallas'),
  (23, 'L', 'group', 'Gana', 'Panama', false, false, '2026-06-17T23:00:00Z'::timestamptz, 'Toronto'),
  (24, 'K', 'group', 'Özbekistan', 'Kolombiya', false, false, '2026-06-18T02:00:00Z'::timestamptz, 'Meksika City'),
  (25, 'A', 'group', 'Çekya', 'Güney Afrika', false, false, '2026-06-18T16:00:00Z'::timestamptz, 'Atlanta'),
  (26, 'B', 'group', 'İsviçre', 'Bosna Hersek', false, false, '2026-06-18T19:00:00Z'::timestamptz, 'Los Angeles'),
  (27, 'B', 'group', 'Kanada', 'Katar', true, false, '2026-06-18T22:00:00Z'::timestamptz, 'Vancouver'),
  (28, 'A', 'group', 'Meksika', 'Güney Kore', true, false, '2026-06-19T01:00:00Z'::timestamptz, 'Guadalajara'),
  (29, 'D', 'group', 'Türkiye', 'Paraguay', false, false, '2026-06-19T04:00:00Z'::timestamptz, 'San Francisco'),
  (30, 'D', 'group', 'ABD', 'Avustralya', true, false, '2026-06-19T19:00:00Z'::timestamptz, 'Seattle'),
  (31, 'C', 'group', 'İskoçya', 'Fas', false, false, '2026-06-19T22:00:00Z'::timestamptz, 'Boston'),
  (32, 'C', 'group', 'Brezilya', 'Haiti', true, false, '2026-06-20T01:00:00Z'::timestamptz, 'Philadelphia'),
  (33, 'F', 'group', 'Tunus', 'Japonya', false, false, '2026-06-20T04:00:00Z'::timestamptz, 'Monterrey'),
  (34, 'F', 'group', 'Hollanda', 'İsveç', true, false, '2026-06-20T17:00:00Z'::timestamptz, 'Houston'),
  (35, 'E', 'group', 'Almanya', 'Fildişi Sah.', true, false, '2026-06-20T20:00:00Z'::timestamptz, 'Toronto'),
  (36, 'E', 'group', 'Ekvador', 'Curaçao', false, false, '2026-06-21T00:00:00Z'::timestamptz, 'Kansas City'),
  (37, 'H', 'group', 'İspanya', 'Suudi Arabistan', true, false, '2026-06-21T16:00:00Z'::timestamptz, 'Atlanta'),
  (38, 'G', 'group', 'Belçika', 'İran', true, false, '2026-06-21T19:00:00Z'::timestamptz, 'Los Angeles'),
  (39, 'H', 'group', 'Uruguay', 'Yeşil Burun A.', false, false, '2026-06-21T22:00:00Z'::timestamptz, 'Miami'),
  (40, 'G', 'group', 'Yeni Zelanda', 'Mısır', false, false, '2026-06-22T01:00:00Z'::timestamptz, 'Vancouver'),
  (41, 'J', 'group', 'Arjantin', 'Avusturya', true, false, '2026-06-22T17:00:00Z'::timestamptz, 'Dallas'),
  (42, 'I', 'group', 'Fransa', 'Irak', true, false, '2026-06-22T21:00:00Z'::timestamptz, 'Philadelphia'),
  (43, 'I', 'group', 'Norveç', 'Senegal', false, false, '2026-06-23T00:00:00Z'::timestamptz, 'New Jersey'),
  (44, 'J', 'group', 'Ürdün', 'Cezayir', false, false, '2026-06-23T03:00:00Z'::timestamptz, 'San Francisco'),
  (45, 'K', 'group', 'Portekiz', 'Özbekistan', true, false, '2026-06-23T17:00:00Z'::timestamptz, 'Houston'),
  (46, 'L', 'group', 'İngiltere', 'Gana', true, false, '2026-06-23T20:00:00Z'::timestamptz, 'Boston'),
  (47, 'L', 'group', 'Panama', 'Hırvatistan', false, false, '2026-06-23T23:00:00Z'::timestamptz, 'Toronto'),
  (48, 'K', 'group', 'Kolombiya', 'Kongo', false, false, '2026-06-24T02:00:00Z'::timestamptz, 'Guadalajara'),
  (49, 'B', 'group', 'İsviçre', 'Kanada', false, true, '2026-06-24T19:00:00Z'::timestamptz, 'Vancouver'),
  (50, 'B', 'group', 'Bosna Hersek', 'Katar', false, false, '2026-06-24T19:00:00Z'::timestamptz, 'Seattle'),
  (51, 'C', 'group', 'İskoçya', 'Brezilya', false, true, '2026-06-24T22:00:00Z'::timestamptz, 'Miami'),
  (52, 'C', 'group', 'Fas', 'Haiti', false, false, '2026-06-24T22:00:00Z'::timestamptz, 'Atlanta'),
  (53, 'A', 'group', 'Çekya', 'Meksika', false, true, '2026-06-25T01:00:00Z'::timestamptz, 'Meksika City'),
  (54, 'A', 'group', 'Güney Afrika', 'Güney Kore', false, false, '2026-06-25T01:00:00Z'::timestamptz, 'Monterrey'),
  (55, 'E', 'group', 'Curaçao', 'Fildişi Sah.', false, false, '2026-06-25T20:00:00Z'::timestamptz, 'Philadelphia'),
  (56, 'E', 'group', 'Ekvador', 'Almanya', false, true, '2026-06-25T20:00:00Z'::timestamptz, 'New Jersey'),
  (57, 'F', 'group', 'Japonya', 'İsveç', false, false, '2026-06-25T23:00:00Z'::timestamptz, 'Dallas'),
  (58, 'F', 'group', 'Tunus', 'Hollanda', false, true, '2026-06-25T23:00:00Z'::timestamptz, 'Kansas City'),
  (59, 'D', 'group', 'Türkiye', 'ABD', false, true, '2026-06-26T02:00:00Z'::timestamptz, 'Los Angeles'),
  (60, 'D', 'group', 'Paraguay', 'Avustralya', false, false, '2026-06-26T02:00:00Z'::timestamptz, 'San Francisco'),
  (61, 'I', 'group', 'Norveç', 'Fransa', false, true, '2026-06-26T19:00:00Z'::timestamptz, 'Boston'),
  (62, 'I', 'group', 'Senegal', 'Irak', false, false, '2026-06-26T19:00:00Z'::timestamptz, 'Toronto'),
  (63, 'H', 'group', 'Yeşil Burun A.', 'Suudi Arabistan', false, false, '2026-06-27T00:00:00Z'::timestamptz, 'Houston'),
  (64, 'H', 'group', 'Uruguay', 'İspanya', false, true, '2026-06-27T00:00:00Z'::timestamptz, 'Guadalajara'),
  (65, 'G', 'group', 'Mısır', 'İran', false, false, '2026-06-27T03:00:00Z'::timestamptz, 'Seattle'),
  (66, 'G', 'group', 'Yeni Zelanda', 'Belçika', false, true, '2026-06-27T03:00:00Z'::timestamptz, 'Vancouver'),
  (67, 'L', 'group', 'Panama', 'İngiltere', false, true, '2026-06-27T21:00:00Z'::timestamptz, 'New Jersey'),
  (68, 'L', 'group', 'Hırvatistan', 'Gana', false, false, '2026-06-27T21:00:00Z'::timestamptz, 'Philadelphia'),
  (69, 'K', 'group', 'Kolombiya', 'Portekiz', false, true, '2026-06-27T23:30:00Z'::timestamptz, 'Miami'),
  (70, 'K', 'group', 'Kongo', 'Özbekistan', false, false, '2026-06-27T23:30:00Z'::timestamptz, 'Atlanta'),
  (71, 'J', 'group', 'Cezayir', 'Avusturya', false, false, '2026-06-28T02:00:00Z'::timestamptz, 'Kansas City'),
  (72, 'J', 'group', 'Ürdün', 'Arjantin', false, true, '2026-06-28T02:00:00Z'::timestamptz, 'Dallas')
on conflict (id) do update set
  group_code = excluded.group_code,
  stage = excluded.stage,
  home_team = excluded.home_team,
  away_team = excluded.away_team,
  home_seeded = excluded.home_seeded,
  away_seeded = excluded.away_seeded,
  kickoff_at = excluded.kickoff_at,
  city = excluded.city,
  updated_at = now();

-- Champion lock check:
-- first kickoff is 2026-06-11T19:00:00Z (2026-06-11 22:00 TRT).
-- champion lock is first kickoff minus 60 minutes:
-- 2026-06-11T18:00:00Z (2026-06-11 21:00 TRT).
-- The migration can calculate this automatically from matches, but this
-- explicit default makes the tournament lock easy to inspect/review.
insert into public.app_settings (key, value)
values (
  'tournament',
  jsonb_build_object('champion_lock_at', '2026-06-11T18:00:00Z')
)
on conflict (key) do update set
  value = public.app_settings.value || excluded.value,
  updated_at = now();

commit;

-- Optional manual check after applying:
-- select count(*) from public.matches where stage = 'group';
