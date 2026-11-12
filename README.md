# Downtrack Media website

Next.js 14 site reading NHRA results and stats from Supabase (schema `dt`).

## Netlify environment variables
| Key | Value |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | https://ospxazawargoacxeqild.supabase.co |
| NEXT_PUBLIC_SUPABASE_KEY | the project's publishable key |
| NEXT_PUBLIC_SUPABASE_SCHEMA | dt |
| NODE_VERSION | 20 |

Build command `npm run build`, publish directory `.next` (set in `netlify.toml`).

## Pages
- `/` home, latest results, classes
- `/classes`, `/classes/[slug]?w=season|last3|3yr|all|today` class stats and leaders
- `/drivers?q=`, `/drivers/[id]?w=` racer search and racer stats vs. class
- `/events?season=`, `/events/[id]`, `/races/[id]` results, every round

Stats come from `dt.stat_category` and `dt.stat_driver`, refreshed nightly in Supabase.
Pages cache for one hour.
