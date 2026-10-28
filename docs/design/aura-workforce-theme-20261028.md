# Aura workforce pages — student CRM alignment

Reference: the supplied Học viên PT page and the deployed Aura Club refinement. These are operational pages for managers; the first screen should expose the current period, useful totals and the next action.

Current findings: Performance spends the first screen on a 72px heading, a slogan strip and duplicated explanatory copy. Quality has no visible page title, clips its four summary cards horizontally and uses 8–10px metadata. Team nests decorated cards inside a large gradient header and another framed section. Payroll hides its title and uses several competing summary colors. Loading the legacy Team stylesheet also recolors the application sidebar green/purple.

Use one shared, route-scoped token system: ink #211720, muted #786870, pink #cf246a, action pink #f62f82, orange #ff8751, blush #fff6f9. White content sits on a pale rose canvas. The berry summary runs #171218 / #4f213c / #ba2a62, matching the reference. Keep Be Vietnam Pro, titles 26–28px, headings 16–20px, body 13–14px and metadata at least 11–12px. Actions are 36px on desktop and 40px on mobile, with visible keyboard focus.

```
Page title                               primary action
Berry summary — compact numbers, concise labels
Tabs / current period
Search and filters
White list, score sheet or payroll cards
```

All content is left aligned. Desktop uses the full available workspace; mobile has 8px side insets and no page overflow. Quality shows all four metrics in a two-column mobile summary. Team keeps three operational tabs and compact staff cards. Performance keeps its three review workspaces, score provenance and gate controls, while moving access guidance below the work area. Payroll retains its staff summary carousel, the four workspaces and all warning/confirmation flows.

Review against the brief: no new decorative imagery, marketing ticker, large title hero, thick card outlines or unrelated accent colors. The dark summary is the single brand emphasis; all controls follow the supplied pink–orange direction. Preserve data loading boundaries, permissions, evaluation rules, payroll calculations and mutations. Verify responsive layouts, navigation/filter interactions and the existing editing/confirmation surfaces without changing live business records.
