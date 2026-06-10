# World Cup 2026 Data Provider Alternatives

Research date: 2026-06-06

## Scope

This is a research-only report for the existing World Cup 2026 prediction
game. No provider was called, no credentials were added, and no code,
frontend, scoring rule, or Supabase schema change was made.

The project currently has:

- a server-side API-Football adapter in `server/update-scores.js`;
- 72 group-stage entries in `server/fixture-map.json`;
- a working manual Supabase score writer in `server/set-score.js`;
- a `public.scores` row shape of `match_id`, `home_score`, `away_score`,
  `status`, and `minute`.

## Executive conclusion

There is no truly free option that is both confirmed for World Cup 2026 and
dependable for live automatic scoring.

The best alternative to test first is **football-data.org**:

- FIFA World Cup is listed in its free competition set;
- the free tier includes fixtures and delayed scores at 10 calls/minute;
- live scores cost EUR 12/month at 20 calls/minute;
- responses have stable match IDs, kickoff times, status, minute, and score
  fields that fit this project well.

Its public coverage page does not explicitly prove that the currently
available `WC` season is 2026, so this must be confirmed with one authenticated
read-only request before implementation or payment.

**API-Football Pro at USD 19/month remains the cleanest technical choice.**
World Cup 2026 is already identified as league `1`, and the current updater is
written for API-Football. Upgrading avoids a provider adapter rewrite.

**TheSportsDB at USD 9/month is the cheapest provider found with publicly
visible 2026 fixtures and paid two-minute live scores.** It is crowdsourced,
however, so it carries materially more tournament-day completeness and
correction risk than API-Football, football-data.org, Sportmonks, Sportradar,
or Opta.

For a zero-cost operation, `server/set-score.js` remains the safest source of
truth. A sensible hybrid is to keep manual scoring, run periodic read-only
provider checks, and buy one month of live access only when confidence or
operator availability justifies it.

## Shortlist comparison

| Provider | Free usable? | World Cup 2026 supported? | Live scores? | Stable fixture IDs? | Published limit | Difficulty | Recommendation |
|---|---|---|---|---|---|---|---|
| API-Football / API-Sports | No for season 2026 on the current free plan | Confirmed in catalog; blocked by free season range | Yes on an eligible plan | Yes | Free 100/day; Pro 7,500/day | Low | Cleanest implementation; pay if USD 19/month is acceptable |
| football-data.org | Fixtures and delayed scores appear usable after 2026 confirmation | World Cup is free-tier coverage; exact 2026 season should be verified | EUR 12/month | Yes | Free 10/min; live tier 20/min | Medium | Best low-cost alternative to validate first |
| TheSportsDB | Limited fixtures; no free live feed | Confirmed: league `4429`, season `2026`, fixtures published | USD 9/month, approximately two-minute updates | Yes, event IDs | Free 30/min; paid 100/min | Medium | Cheapest confirmed option; use only with manual monitoring |
| Sportmonks | Free plan excludes World Cup | Explicitly confirmed, season ID `26618` | Yes on paid plan | Yes | Starter 2,000/entity/hour | Medium | Strong but more expensive than this project needs |
| Sportradar Soccer API | Trial only | Strongly indicated and World Cup-specific 2026 features are live | Yes | Yes | Trial: 1,000/30 days and 1 QPS; production custom | High | Excellent enterprise feed; poor small-project fit |
| Stats Perform / Opta | No public free production plan | Official FIFA betting-data partner for all 104 matches | Yes | Yes | Contract/quote | High | Highest authority, but enterprise and licensing-heavy |
| Live Score API / WorldCupAPI | Trial only | Dedicated 2026 product claims full coverage | Yes | Yes | Dedicated offer: 200,000/day | Medium | EUR 499/month is not a low-cost fit |
| ScoreBat | Free video preview only | Not established for score data | No score API; videos/widgets only | Not useful for scoring | Plan-based monthly credits | N/A | Do not use as the scoring source |
| OpenFootball datasets | Yes | 2026 dataset exists | No dependable live service | Dataset records, not provider IDs | No API quota; GitHub hosting limits apply | Medium for fixtures, high for live automation | Useful only as a fixture/reference dataset |
| FIFA public site / Football Data Platform | Website is public; platform is restricted | Official data exists | Not as a public developer API | Internal IDs may exist but are not licensed as a public feed | Not applicable | Not available | Do not scrape or use hidden endpoints |

## Provider evaluations

### 1. API-Football / API-Sports

- **2026 coverage:** The provider catalog contains World Cup league `1` and
  season `2026`, but this project's free-plan request returned: "Free plans do
  not have access to this season, try from 2022 to 2024."
- **Free plan:** USD 0, 100 requests/day, all endpoints, but restricted
  seasons. It is therefore not usable for this tournament with the current
  account.
- **Paid plan:** Pro is currently advertised at USD 19/month and 7,500
  requests/day. Fixtures, livescores, events, and statistics are included.
- **Live/history/fixtures:** Included. The provider advertises live updates
  approximately every 15 seconds, although availability and frequency are not
  guaranteed for every competition.
- **Usage:** An API key is required. The terms warn that third-party rights can
  apply and that fantasy-sports or mass-distribution use may require additional
  rights. A small private, non-betting project is lower risk, but the API
  subscription itself does not grant FIFA trademark, image, or commercial
  rights.
- **Scraping:** Not needed. Use only documented API endpoints.
- **Integration:** Low difficulty. The existing code already understands its
  fixture, team, goal, status, and elapsed-minute fields.
- **Reliability risk:** Low to medium. It is established and has broad
  coverage, but has no SLA for this plan and the free tier can change.
- **Project fit:** Very good if one paid month is acceptable; best option for
  avoiding new code risk.

### 2. football-data.org

- **2026 coverage:** The official coverage page lists FIFA World Cup among the
  free-tier competitions. The API uses competition code `WC` and competition
  ID `2000`. Public documentation demonstrates World Cup fixtures and match
  IDs, but the public pages reviewed did not explicitly identify the active
  season as 2026. Treat coverage as likely, not yet confirmed for this account.
- **Free plan:** EUR 0, 12 competitions, fixtures, delayed schedules and
  delayed scores, 10 calls/minute.
- **Paid live plan:** EUR 12/month, the same 12 competitions, fixtures,
  schedules, league tables, live scores, and 20 calls/minute.
- **Live/history/fixtures:** Fixtures and match history are included. Free
  scores are delayed; the paid live tier removes that limitation. Match objects
  expose stable IDs, UTC kickoff, status, minute, and score fields.
- **Usage:** `X-Auth-Token` is required. Attribution is mandatory:
  "Football data provided by the Football-Data.org API." The terms bind one key
  to one application. Older provider guidance says free use is non-commercial;
  commercial/public usage should be confirmed with the provider.
- **Scraping:** Not needed. Use the documented API only.
- **Integration:** Medium. A new response adapter and status mapping are
  needed, but its model is simpler than Sportmonks or Sportradar.
- **Reliability risk:** Medium-low for a small project. It is long-running and
  focused, but the free tier is delayed and there is no guaranteed accuracy or
  availability.
- **Project fit:** Best alternative candidate. Confirm `WC` season 2026 and a
  sample fixture before relying on it.

### 3. TheSportsDB

- **2026 coverage:** Confirmed publicly. FIFA World Cup is league `4429`; its
  current season is `2026`, and 2026 fixtures are visible.
- **Free plan:** Public key `123`, 30 requests/minute. Free scheduling methods
  are heavily truncated: for example, a season schedule returns at most 15
  events and a day schedule at most 3 events. Free live scores are not included.
- **Paid plan:** Single Developer is USD 9/month, 100 requests/minute, V2 API,
  fuller schedules, and soccer livescores updated about every two minutes.
- **Live/history/fixtures:** Paid live scores and historical/scheduled events
  are available. Events have stable `idEvent` identifiers.
- **Usage:** The free API is allowed for development projects. Paid use is
  required for published app-store apps. Paid projects should credit
  TheSportsDB as the data source. Official API content may be used; the terms
  explicitly say not to scrape the website.
- **Scraping:** Website scraping is prohibited. Official API endpoints are the
  allowed route.
- **Integration:** Medium. The V2 livescore and schedule shape requires a new
  adapter. Two-minute updates are sufficient for leaderboard scoring but not a
  polished second-by-second live display.
- **Reliability risk:** Medium-high. The database is crowdsourced, and the
  provider itself emphasizes community data. Mapping errors, late corrections,
  or incomplete tournament records are more plausible.
- **Project fit:** Good budget experiment and backup signal, but manual
  verification should remain active throughout the tournament.

### 4. Sportmonks

- **2026 coverage:** Explicitly confirmed. World Cup 2026 season ID is
  `26618`; the provider publishes group and knockout stage IDs and documents
  fixture/livescore queries.
- **Free plan:** Free forever, but only Danish Superliga and Scottish
  Premiership. It cannot be used for World Cup 2026 production.
- **Paid plan:** Starter begins at EUR 29/month, allows any five leagues,
  includes live data and fixtures, and allows 2,000 calls per entity per hour.
  A 14-day trial is offered and converts to paid unless cancelled.
- **Live/history/fixtures:** Full professional fixture, score, event, state,
  and statistics data are included for selected leagues. Historical depth can
  depend on plan.
- **Usage:** API token required. Sportmonks markets the product for livescore,
  fantasy, media, and betting applications. Logos/photos require separate
  rights. Normal API use is appropriate; redistribution details should be
  checked for a commercial launch.
- **Scraping:** Not needed and not recommended.
- **Integration:** Medium. Good documentation and stable IDs, but its nested
  `participants`, `scores`, `state`, and includes system needs a dedicated
  normalizer.
- **Reliability risk:** Low to medium. Strong explicit coverage and generous
  rate limits; still subject to plan and provider availability.
- **Project fit:** Technically strong, but API-Football is cheaper and already
  integrated.

### 5. Sportradar Soccer API

- **2026 coverage:** Very likely/strongly indicated. Soccer v4 covers FIFA
  World Cup, and May 2026 product changes specifically added live World Cup
  third-place rankings. It provides schedules, summaries, timelines, and
  stable sport-event IDs.
- **Free plan:** No permanent free production plan. A 30-day trial provides
  real-world data at the same data freshness but defaults to 1,000 requests per
  rolling 30 days and 1 query/second.
- **Paid plan:** Production pricing is quote/contract based.
- **Live/history/fixtures:** Real-time scores and timelines, fixtures, and
  historical data are available. A live delta endpoint can update every ten
  seconds.
- **Usage:** API key and licensed production access are required. This is a B2B
  product designed for media, fan apps, and betting products.
- **Scraping:** Not needed. Use only licensed API access.
- **Integration:** High. The API is capable but has a larger feed model,
  access-level URLs, coverage tiers, quotas, and contractual setup.
- **Reliability risk:** Low technically; high cost/procurement risk for this
  project.
- **Project fit:** Poor. It is disproportionate to a private prediction game.

### 6. Stats Perform / Opta

- **2026 coverage:** Confirmed at the highest official level for betting use.
  FIFA selected Stats Perform as its official worldwide betting-data and
  betting-streaming distributor for all 104 World Cup 2026 matches. Opta
  supplies official player statistics, insights, live scores, and trackers to
  licensed sportsbooks.
- **Free plan/limits:** No public free production plan or simple self-service
  rate card was found. Access is sales-led and contractual.
- **Live/history/fixtures:** Yes, with extensive live and historical feeds and
  stable IDs.
- **Usage:** API/feed credentials and a commercial license are required. The
  announced FIFA agreement is specifically about betting distribution; it does
  not create a free public API.
- **Scraping:** Not relevant. Use only a licensed Opta feed.
- **Integration:** High, including sales, licensing, feed onboarding, and a new
  adapter.
- **Reliability risk:** Very low data-authority risk; very high budget and
  procurement mismatch.
- **Project fit:** Not realistic unless the project becomes commercial and
  funded.

### 7. Live Score API / WorldCupAPI

- **2026 coverage:** The dedicated product explicitly claims fixtures, live
  scores, history, events, statistics, lineups, and standings for World Cup
  2026.
- **Free plan:** No permanent free production tier. A short trial is offered.
- **Paid plan/limits:** The current dedicated World Cup page advertises EUR
  499/month and 200,000 requests/day. The related general Live Score API site
  also advertises a 14-day trial and subscription plans. Pricing presentation
  across related pages has changed, so the exact contract should be confirmed
  before considering it.
- **Live/history/fixtures:** Yes, including stable match IDs.
- **Usage:** API key required; subscription terms apply. Commercial scope
  should be confirmed in the order/contract.
- **Scraping:** Not needed.
- **Integration:** Medium. Conventional JSON endpoints, but still a new
  provider adapter.
- **Reliability risk:** Medium because it is less established than the leading
  vendors and its pricing/site presentation is less consistent.
- **Project fit:** Poor at the published dedicated-tournament price.

### 8. ScoreBat

- **Coverage/product:** ScoreBat's documented API is an official video API for
  embeds, highlights, and selected live streams. Its match-view widgets may
  display scores, but the API is not documented as a fixture/live-score data
  feed suitable for Supabase ingestion.
- **Free plan:** Limited video free feed with branding/ads; token required.
- **Live scores/history:** Not available as the required structured score API.
- **Usage:** Official embed codes are legally safer than copying videos, but
  this does not solve automatic score updates.
- **Scraping:** Do not scrape the widgets or match-view pages to extract
  scores.
- **Integration/reliability:** Not applicable for scoring.
- **Project fit:** Reject as a score provider.

### 9. OpenFootball and other open datasets

- **2026 coverage:** `openfootball/worldcup` includes a Canada/USA/Mexico 2026
  dataset and is licensed CC0/public domain.
- **Free plan/key:** Free; no API key. Files can be downloaded or consumed from
  the public repository according to its license.
- **Live/history/fixtures:** Strong historical and fixture/reference value, but
  it is a community-maintained repository, not a contractual live-score feed.
  Update timing is not guaranteed.
- **Usage:** CC0 permits personal and commercial reuse. Direct repository/file
  access is legitimate and is not website scraping.
- **Scraping:** Not needed. Do not repeatedly poll GitHub at live-score
  frequency.
- **Integration:** Medium for fixture import or validation; unsuitable for
  automatic live scoring.
- **Reliability risk:** High for live operation. Community issues already
  report World Cup 2026 team-name mismatches.
- **Project fit:** Useful as a secondary fixture sanity check, never as the only
  live source.

### 10. FIFA public and restricted official sources

- FIFA publishes the official schedule, fixtures, results, groups, and
  standings on its public site.
- FIFA also has a Football Data Platform fed by the FIFA Data Hub, but access
  is limited to participating teams, officials, FIFA staff, media partners,
  and accredited World Cup 2026 media representatives.
- No self-service public developer API or free licensed live-score feed was
  found for this project.
- FIFA's terms claim rights over FIFA feeds/API content and restrict automated
  programs; other FIFA platform terms expressly prohibit scraping.
- **Project fit:** The public site is useful for human verification only. It
  must not be scraped, automated, or reverse-engineered.

## Unsafe approaches to reject

Do not use any of these as the automatic scoring source:

- scraping FIFA pages;
- scraping Google result cards or knowledge panels;
- scraping LiveScore, Flashscore, SofaScore, ESPN, or similar score websites;
- calling undocumented browser/mobile-app endpoints discovered in developer
  tools;
- browser automation that reads rendered score text;
- copying data through an unlicensed proxy or unofficial wrapper.

These approaches are risky because:

- page HTML, CSS selectors, and hidden endpoints can change without notice;
- automated access may violate site terms or data rights;
- bot protection, CORS, IP blocking, cookies, and rate limits can stop the job;
- a browser session can expire or trigger a challenge during the tournament;
- score corrections, extra time, penalties, postponements, and abandoned
  matches are hard to normalize safely;
- failure is often silent, which is unacceptable for automatic leaderboard
  scoring.

An official documented API or a manual trusted operator is safer than an
unofficial source that appears free.

## Integration notes for this project

### Common data mapping

Any selected provider should be normalized server-side into the current
`public.scores` payload:

| Provider field concept | Current target |
|---|---|
| Stable match/event/fixture ID | Mapping input only; not required in `scores` |
| Home score | `home_score` |
| Away score | `away_score` |
| Match state | `status` (`scheduled`, `live`, or `finished`) |
| Elapsed minute | `minute` |
| Mapped internal match ID | `match_id` |

No Supabase schema change is required. Provider-specific data should be
converted before the existing upsert to `public.scores?on_conflict=match_id`.

Extra time and penalty shootouts need a provider-specific review before a
future adapter is enabled. The current scoring row stores one home/away score
pair, so the adapter must preserve the project's existing interpretation of
the score without changing scoring rules.

### Reusing `fixture-map.json`

Most of the file is reusable:

- internal match ID;
- UTC kickoff;
- Turkish display names;
- English/provider aliases;
- date-and-team safety matching.

The current `apiFixtureId` name is provider-specific. A future implementation
could either use it for the single active provider or add a clearly named
provider ID field in this server-side JSON. That would be a code/config change,
not a Supabase schema change.

The map currently covers 72 group matches. World Cup 2026 has 104 total
matches, so knockout mappings will need to be added only after the project's
internal knockout matches and provider fixtures exist.

### Candidate environment variables

All credentials must remain in GitHub Actions secrets or a trusted local/server
environment, never GitHub Pages frontend code.

| Provider | Suggested future server-only variables |
|---|---|
| API-Football | Existing `API_FOOTBALL_KEY`, `API_FOOTBALL_LEAGUE_ID=1`, `API_FOOTBALL_SEASON=2026` |
| football-data.org | `FOOTBALL_DATA_TOKEN`, `FOOTBALL_DATA_COMPETITION=WC`, `FOOTBALL_DATA_SEASON=2026` |
| TheSportsDB | `THESPORTSDB_API_KEY`, `THESPORTSDB_LEAGUE_ID=4429`, `THESPORTSDB_SEASON=2026` |
| Sportmonks | `SPORTMONKS_API_TOKEN`, `SPORTMONKS_SEASON_ID=26618` |
| Sportradar | `SPORTRADAR_API_KEY`, `SPORTRADAR_ACCESS_LEVEL`, confirmed World Cup season ID |

The existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` remain sufficient
for score writes.

### Scheduling

- **GitHub Actions:** Suitable for a server-side periodic updater with secrets.
  Scheduled workflows can be delayed, so this is better for periodic/final
  score synchronization than second-by-second presentation.
- **Local scheduler or small server/worker:** Better for one- or two-minute
  polling during matches and for immediate operational visibility.
- **GitHub Pages:** Not suitable for direct provider calls because API keys
  would be exposed and browser CORS may block requests.

A conservative job should poll only match dates/current live fixtures, cache
responses, honor provider limits, skip ambiguous mappings, and leave existing
Supabase scores unchanged on provider failure.

## Recommended decision path

1. Keep `server/set-score.js` ready as the authoritative fallback.
2. Register for football-data.org and perform one read-only check for
   competition `WC`, season `2026`, plus the June 11 opener.
3. If football-data.org returns all expected fixtures with stable IDs, choose:
   - free delayed scores if delay is operationally acceptable; or
   - EUR 12/month live scores for the lowest-cost reputable live option.
4. If 2026 access or freshness is unsatisfactory, use API-Football Pro. It
   costs slightly more but has the lowest implementation and mapping risk.
5. Treat TheSportsDB USD 9/month as a monitored budget backup, not an
   unquestioned source of truth.
6. Recheck provider fixture completeness and IDs periodically before June 11,
   2026, without scraping or repeated quota-heavy calls.

### Practical hybrid

- **Before and during early group stage:** manual scores plus occasional
  provider read-only checks.
- **If manual operation becomes burdensome:** activate football-data.org live
  or API-Football Pro and run dry-run mapping validation before writes.
- **Knockout stage:** one paid month can cover the complete knockout period;
  keep manual entry available for corrections and provider outages.
- **At all times:** never let an unmapped, ambiguous, or failed response
  overwrite a known score.

## Sources

Primary provider and official documentation reviewed:

- [API-Football pricing](https://www.api-football.com/pricing)
- [API-Football coverage](https://www.api-football.com/coverage)
- [API-Football terms](https://www.api-football.com/terms)
- [football-data.org pricing](https://www.football-data.org/pricing)
- [football-data.org coverage](https://www.football-data.org/coverage)
- [football-data.org API quickstart](https://www.football-data.org/documentation/quickstart)
- [football-data.org API policies](https://docs.football-data.org/general/v4/policies.html)
- [football-data.org terms and attribution](https://www.football-data.org/about)
- [Sportmonks World Cup 2026 guide](https://www.sportmonks.com/blogs/world-cup-2026-api-guide-coverage-endpoints-data-types/)
- [Sportmonks plans](https://www.sportmonks.com/football-api/)
- [Sportmonks free plan](https://www.sportmonks.com/football-api/free-plan/)
- [Sportmonks rate limits](https://docs.sportmonks.com/v3/api/rate-limit)
- [Sportmonks terms](https://www.sportmonks.com/terms-of-service/)
- [Sportradar Sports Data API](https://docs.sportradar.com/sports-data-api)
- [Sportradar trial limits](https://developer.sportradar.com/football/docs/football-ig-account-maintenance)
- [Sportradar Soccer API basics](https://developer.sportradar.com/soccer/docs/soccer-ig-api-basics)
- [Sportradar Soccer coverage](https://developer.sportradar.com/soccer/docs/soccer-ig-data-availability-coverage)
- [TheSportsDB pricing](https://www.thesportsdb.com/docs_pricing)
- [TheSportsDB API documentation](https://www.thesportsdb.com/documentation)
- [TheSportsDB World Cup 2026 season](https://www.thesportsdb.com/season/4429-fifa-world-cup/2026)
- [TheSportsDB terms](https://www.thesportsdb.com/docs_terms_of_use.php)
- [ScoreBat Video API](https://www.scorebat.com/video-api/docs/)
- [OpenFootball World Cup dataset](https://github.com/openfootball/worldcup)
- [WorldCupAPI pricing](https://worldcupapi.com/pricing)
- [WorldCupAPI documentation](https://worldcupapi.com/documentation)
- [FIFA World Cup 2026 official schedule page](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums)
- [FIFA Football Data Platform](https://inside.fifa.com/innovation/innovating-the-game/football-data-platform)
- [FIFA terms of service](https://legal.fifa.com/terms-of-service)
- [FIFA announcement of Stats Perform official data rights](https://tickets.fifa.com/tournament-organisation/commercial/media-releases/stats-perform-official-worldwide-betting-data-streaming-rights-distributor-world-cup)
- [Stats Perform / Opta data](https://www.statsperform.com/opta/)

