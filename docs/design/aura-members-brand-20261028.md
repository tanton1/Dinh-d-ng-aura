# Aura Club: complete member directory and CRM brand alignment

The supplied PT student page is the reference: vivid Aura pink–orange actions, a pale rose background, berry summary panels, white content and Be Vietnam Pro. Keep the previously requested compact controls, narrow edge insets and borderless sections.

Palette: ink #211720, muted #786870, rose #f62f82, orange #ff8751, blush #fff6f9, white #ffffff. Summary gradients use #171218 / #4f213c / #ba2a62 so small white labels remain legible. Titles 26–28px, content 13–14px, metadata 12px; controls 36px desktop / 40px mobile.

```
Aura Club (pink title)                 refresh
Overview / Members / Gifts / Requests
Members: total count + short eligibility note
All / Member / Silver / Gold / Diamond
Search across the complete directory
Name + tier        points       membership state
```

Use the berry panel only for the summary; let member and reward content stay quiet. Remove raw internal IDs from member rows. Preserve all balances, statuses, access scope and existing membership eligibility.

The API's maximum page size is 100, but that is not the member total. On opening Members, follow its bounded cursor pages until complete; show the server's total immediately, mark tier counts as pending while more pages load, and search/filter the complete set. Stop obsolete requests from appending after navigation or unmount. Retry failed continuation from its cursor. Cache only a completed directory within the existing 60-second tab cache.
