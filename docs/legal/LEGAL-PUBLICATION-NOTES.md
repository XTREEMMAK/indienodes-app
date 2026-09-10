# Legal Publication Notes

Internal follow-up notes for the effective Terms of Use, Privacy Notice, and Creator Submission Agreement. These notes are not rendered on the public legal page.

## Publication checklist

- [x] Confirmed Jamaal Ephriam, operating IndieNodes, as the contracting party.
- [x] Set venue to Broward County and the U.S. District Court for the Southern District of Florida.
- [ ] Add a mailing address later if required or desired; email is the current published contact.
- [ ] Have qualified counsel review the creator age rule, warranty/liability language,
      governing law, international reach, and the interaction with `EULA.md`.
- [x] Updated the creator agreement and all current references in it to IndieNodes.
- [x] Reconciled `EULA.md` with five media types and the current `/update` change/removal flow.
- [ ] Implement automatic cleanup for expired pre-verification rows and a defined
      retention period for keyed source-URL rate-limit rows.
- [ ] Define production web/proxy access-log fields, providers, locations, and retention.
- [ ] Define notification and mailbox retention.
- [x] Updated the contact page so it no longer promises immediate deletion that the end-to-end delivery path cannot guarantee.
- [ ] Either add server-side Turnstile validation to Contact or stop loading Turnstile on
      that page.
- [ ] Inventory production processors/subprocessors (hosting, DNS/CDN, n8n host, Gotify,
      SMTP/mail, GitHub, Cloudflare, and any backup system) and sign any required data
      processing terms.
- [x] Decided that verification tokens are temporary private workflow state and must not be published in new Nodes.
- [ ] Remove legacy token fields from existing entries in the separate canonical `indienodes-ring` repository, then remove the compatibility property from this mirror schema.
- [ ] Decide and document whether bulk reuse of `ring.json`, including AI/ML ingestion,
      needs a separate data license or policy; do not imply that public access answers
      creator-content licensing.
- [x] Deferred DMCA designated-agent registration; the current document describes only an informal report process and can be amended later.
- [x] Set September 2, 2026 effective dates and versioned the public document as 1.0.
- [x] Public document 1.1 and EULA 1.3 (September 2, 2026): the EULA authorizes the
      eligibility rules `/join` was already stating, and the privacy notice describes the
      one-time app rating, which is the first thing the app sends off-device on its own.
- [x] Public document 1.2 (September 2, 2026): app ratings may now be stored as anonymous
      rows (rating, date, app version) so an average can be read over time. Same day as 1.1
      because the storage question was settled immediately after; the 1.1 wording said
      ratings were not kept in a database, which would have been false the moment the table
      existed.
- [x] Public document 1.3 (September 9, 2026): the Service row named `indienodes.us`, which
      no longer matches where the app is deployed -- the app moved to `app.indienodes.us`,
      with the bare domain reserved for a separate homepage repo (see `decisions.md`'s "The
      root route stays the app" entry). Effective date moved to the same day for the same
      reason 1.1/1.2 did: a notice describing the deployed service as it was last week is
      worse than one that changes to stay accurate.
- [x] Added the combined Terms of Use and Privacy Notice link beside EULA acceptance in the creator submission flow.
- [ ] Consider adding a persistent legal link in site navigation or footer beyond the required acceptance context.
- [ ] Re-review before any native/app-store release, analytics integration, account
      system, payment feature, ad system, or first-party media hosting.

# Research basis

These sources supported the working draft and remain here for later legal review.

- The FTC advises businesses to describe privacy practices clearly, honor the promises
  they make, collect only what they need, protect it, and dispose of it appropriately:
  <https://www.ftc.gov/business-guidance/privacy-security>.
- The FTC's COPPA summary explains that special requirements apply to child-directed
  services and general-audience services with actual knowledge that they collect personal
  information from a child under 13:
  <https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa>.
- Cloudflare's Turnstile Privacy Addendum identifies the signals Turnstile processes and
  its bot-detection purposes:
  <https://www.cloudflare.com/turnstile-privacy-policy/>.
- Cloudflare's current Turnstile documentation requires a browser widget plus server-side
  token validation:
  <https://developers.cloudflare.com/turnstile/get-started/>.
- YouTube describes privacy-enhanced embeds, non-personalized ads, and the limits of that
  mode:
  <https://support.google.com/youtube/answer/171780>.
- App-specific statements were checked against `README.md`, `.env.example`,
  `schema/ring.schema.json`, `src/lib/storageKeys.js`, `src/lib/localData.js`, the join,
  update, contact, Turnstile, video, and widget code, and the n8n workflow generator and
  runbook as they existed on September 1, 2026.
