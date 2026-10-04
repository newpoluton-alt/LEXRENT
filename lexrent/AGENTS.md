<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- Law data is a static typed dataset in src/lib/laws.ts with per-law `applies(facts)` rules; resolution is pure and client-side so date/quiz changes re-evaluate instantly.
- Address autocomplete uses Photon (OSM), building footprints come from Overpass, map is Leaflet loaded via dynamic import (SSR-safe); no API keys needed.
- NYC addresses are enriched from NYC Open Data (Socrata) directly from the browser.
- UI strings live in src/lib/i18n.tsx (EN/ES); law text carries its own {en, es}.
