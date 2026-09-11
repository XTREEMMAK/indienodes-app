# IndieNodes Creator Submission Agreement (EULA)

|                   |                                      |
| ----------------- | ------------------------------------ |
| **Version**       | 1.3                                  |
| **Last updated**  | September 2, 2026                    |
| **Licensor**      | Jamaal Ephriam, operating IndieNodes |
| **Governing law** | Florida; venue in Broward County     |
| **Contact**       | contact@keyjayonline.com             |

## Preamble

This Agreement is the consent a Creator gives when submitting a Node to IndieNodes. It governs the submitted Node, creator representations, and the limited license needed to operate the live webring. It is not the general agreement for visitors who only browse.

By checking the EULA box and submitting, you accept this Agreement and the [IndieNodes Terms of Use and Privacy Notice](/terms). The Terms govern general use of the deployed Service, and the Privacy Notice explains how submission, contact, browser-local, and public Node information is handled. If this Agreement conflicts with the Terms about a Creator's Contribution, this Agreement controls for that Contribution.

This Agreement covers IndieNodes' web submission and client surfaces, including the embeddable widget, static reader, ambient field view, browser-based site generator, and the join and maintenance flows. Any native app-store distribution may be subject to additional store-specific terms.

**Relationship to the open-source license.** IndieNodes' client software is separately licensed under **GPL-3.0-or-later** (see `LICENSE` in the project repository). That license governs the source code and grants rights to anyone who obtains it independently. This Agreement does not restrict, narrow, or replace those rights. It governs your use of IndieNodes as deployed by the Licensor and the terms under which you submit a Node to the live ring. If you fork the source and run your own instance, this Agreement does not govern that separate instance; the GPL does.

## Table of Contents

1. Definitions
2. What IndieNodes Is
3. License Grant and Restrictions
4. Personal Data: Local Storage and Submission-Review Data
5. Node Submission and Content Types
6. Ownership Verification
7. Contribution License and Compensation Waiver
8. Moderation Standard
9. Media Hosting and Bandwidth
10. Money and Visibility
11. Performing Rights Organization (PRO) Disclosure
12. Personalization and Local-Only Data
13. Disclaimer of Warranty
14. Limitation of Liability
15. Termination
16. Intellectual Property Claims
17. Applicable Law
18. Contact Information
19. Miscellaneous

## 1. Definitions

- **“Agreement”** means this Creator Submission Agreement (EULA).
- **“IndieNodes” / “the Service”** means the client and submission surfaces the Licensor operates, including the widget, reader, field and ambient views, browser-based site generator, `/join`, and `/update`.
- **“ring.json”** means the public data file listing published Nodes.
- **“Node”** means an entry representing one creator, collective, or studio, including its public metadata, tags, and linked media.
- **“Creator” / “you”** means the individual or organization submitting or maintaining a Node.
- **“Contribution”** means the public metadata, descriptive text, tags, excerpts, artwork information, and linked media you submit for a Node.
- **“Licensor”** means Jamaal Ephriam, operating IndieNodes.

## 2. What IndieNodes Is

IndieNodes is a lightweight, decentralized discovery webring built around a public static data file (`ring.json`). It is not a creator account, publishing, or media-hosting platform. There is no visitor account system and no algorithmic recommendation engine deciding what surfaces. A Node represents a creator's own space through curated examples in one of five declared media types: audio, art, comic, text, or game. Members' work circulates through IndieNodes interfaces and optional webring links placed on creator-controlled sites.

## 3. License Grant and Restrictions

3.1 The Licensor grants you a non-transferable, non-exclusive, non-sublicensable license to access and use IndieNodes' client surfaces as permitted by this Agreement.

3.2 You may not resell, rent, lease, sublicense, or otherwise redistribute IndieNodes' client software as your own product, separately from your rights under the GPL-3.0-or-later license described in the Preamble. This restriction does not apply to `ring.json` itself, which is intended to be publicly readable, or to sites exported by the client-side site generator, which belong to the creator who exported them.

3.3 The Licensor reserves the right to modify this Agreement. Material changes will be reflected in a version-tracked update, and this document's "Last updated" date and version number will change accordingly.

## 4. Personal Data: Local Storage and Submission-Review Data

4.1 **Browsing and personalization.** No account is required to browse. Likes, Not for Me choices, journal history, filters, layouts, playback preferences, themes, skins, and similar personalization remain in the visitor's browser unless the visitor deliberately exports them. The Terms of Use and Privacy Notice describe these features and outside media requests in more detail.

4.2 **Submission review.** A submission is not anonymous. The workflow collects an email address, consent and rights fields, the proposed Contribution, verification details, and operational anti-abuse information. The private fields are used for verification, review, security, and submission-specific communication, not for marketing, and are not intentionally published in `ring.json`.

4.3 An approved Node carries only its approved public fields. The verification token is an operational proof value used during the ownership-verification process. It is not part of a newly published Node and is cleared from the private workflow record when the verified request enters review. The Privacy Notice governs retention for incomplete, rejected, failed, and approved requests.

## 5. Node Submission and Content Types

5.1 Submissions are limited to five declared media types: audio, art, comic, text, and game. A Node represents a creator's space rather than one release. Depending on type, it may include up to three audio tracks, artworks, comic pages, or text samples, or a game's cover, muted preview, and optional YouTube trailer. A supported Node may link out without offering every preview feature inside IndieNodes. A Node with no directly playable media (an audio entry that is a link-out only, for instance) is a supported shape, not a rejected one.

5.2 If you do not have a site, IndieNodes' browser-based generator can build a downloadable site from files you select. The generator processes those files locally in the browser. IndieNodes does not host the exported site or media; you choose and are responsible for the host.

5.3 A Creator may link up to two Nodes across different media types under a shared, backend-assigned `creator_id`. This cap is a moderation-checklist rule.

5.4 By submitting a Node, you represent that:

- You are at least 18 or the age of legal majority where you live, have authority to bind the submitting organization, or have a parent or legal guardian submit on your behalf.
- You created the submitted work or hold every right and permission needed to submit and display it as described here.
- The Contribution does not infringe copyright, trademark, privacy, publicity, contractual, or other third-party rights.
- The declared media type and explicit-content label are accurate.
- The Node represents your own creative practice, or that of a collective or studio you are authorized to represent, and is not submitted on another creator's behalf without their authorization.
- The submitted work is your own authorship. Tools used within your process, including AI-assisted tools, are permitted; work produced purely by generative systems, where generation stands in for authorship, is not.
- The destination site does not host material that attacks or degrades people on the basis of race, ethnicity, national origin, religion, sex, gender identity, sexual orientation, or disability.
- The Contribution and destination site comply with applicable law.

5.5 **Updating or removing a Node.** Use the `/update` flow to request a change or voluntary removal. The workflow identifies the Node and re-verifies control of its current source page. A person reviews every request before a public change is merged. If that flow is unavailable, contact the Licensor at the address in §18.

## 6. Ownership Verification

6.1 A self-controlled public space is the path to ownership verification. Whether the space already existed or was built with the site generator:

1. The system issues a temporary verification token bound to the request and source URL when available.
2. You place the token at the source URL, as the instructed meta tag or automatically inside a generated-site export.
3. The workflow checks the stored source URL for the matching token and reports whether control was verified.

6.2 A token expires 24 hours after issue. Keep it in place until the form reports that the completed request was received, because the workflow may re-check the proof before accepting the request. After that, the token is no longer needed and may be removed from the site. It is not published in newly approved Node data.

6.3 Updates and removals use a fresh, temporary token and the source URL already assigned to the Node. Verification is a practical control check, not a guarantee against every possible ownership dispute.

## 7. Contribution License and Compensation Waiver

7.1 **This is the operative consent you give by checking the EULA box at submission.** It is the full compensation-and-rights language summarized by the shorter checkbox copy shown on `/join`:

> By submitting your work, you affirm that you hold full rights to what you are submitting, including that no third party, including any performing rights organization, publisher, co-writer, sample owner, or collaborator, holds a claim requiring separate compensation for its use on IndieNodes. IndieNodes does not collect revenue on the basis of any individual creator's work and operates on a donation only basis. You waive any claim to royalties or compensation from IndieNodes arising from the display, distribution, or streaming of your submitted work on this basis. This waiver applies to the relationship between you and IndieNodes and does not, and cannot, affect obligations IndieNodes may independently hold to third-party rights organizations.

7.2 This section restates and elaborates that clause; it does not narrow or contradict it. This Agreement is intentionally narrower than a typical platform EULA — IndieNodes does not claim broad or perpetual rights over your work. By submitting a Node, you grant the Licensor a royalty-free, non-exclusive license limited to:

- Displaying the submitted Contribution's metadata, `why` text, tags, and linked preview media within IndieNodes' client surfaces.
- Linking to your `source_url` and creator-controlled media.
- Including your submission's public metadata within `ring.json` for the purpose of operating the webring.

7.3 This license does not grant the Licensor the right to rehost your media, sell your work, create derivative works from it, or use it for purposes beyond operating IndieNodes' client surfaces. Media referenced in `ring.json` remains hosted on infrastructure you control; bandwidth cost for that media sits with you, not with IndieNodes (§9).

7.4 You retain full ownership of your Contribution and all associated intellectual property. Requesting removal of your Node under §5.5 revokes the license granted under this section going forward. It does not retroactively undo distribution that already occurred through the webring's normal operation before that point.

## 8. Moderation Standard

Submission review uses a checklist rather than an editorial quality score: a valid URL, working ownership proof, a declared media type matching the submitted content, a declared music-or-spoken classification matching the content for audio Nodes, necessary rights confirmations, and creative work already publicly reachable in a form a visitor can experience. That asks whether there is something to hear, read, view, or play—not whether it is popular, professionally produced, commercially released, or subjectively good. Publicly reachable means work the Creator has released or shared for others to experience; works in progress, ongoing serials, and unfinished releases qualify wherever released work is already there to experience, while concepts, pitches, placeholders, and announced or planned projects alone do not. The checklist also asks whether a Node is what it presents itself to be: a Node naming a creator it was not submitted by or for, or built from scraped, republished, or bulk-produced material assembled for volume rather than as that creator's own practice, fails it. Art is evaluated on the same existence-and-rights basis as audio, comics, writing, and games. Rough production, small scope, niche style or subject, an unpolished site, a small audience, and commercial failure are never grounds to decline. Submissions remain private until a maintainer approves them. The Licensor may decline, hide, or remove a Node that fails the checklist, violates §5.4, or presents a legal, security, or safety issue.

## 9. Media Hosting and Bandwidth

IndieNodes does not rehost creator media. Creator-supplied audio, artwork and comic images, text-sample audio, covers, game previews, and related links must point to outside infrastructure the Creator controls or is authorized to use. Optional YouTube trailers use YouTube's privacy-enhanced embed only after a visitor chooses to play one. The Creator is responsible for permissions, availability, and bandwidth at those destinations. A broken or unreachable link does not create a right to compensation or require a particular remedy.

## 10. Money and Visibility

IndieNodes carries no first-party advertising or analytics tracker and is funded, if at all, through voluntary donations. Donating never changes acceptance, placement, rotation, or visibility. Security checks may use Cloudflare Turnstile, and an optional YouTube trailer contacts YouTube only after the visitor activates it; those providers apply their own privacy practices as described in the Privacy Notice.

## 11. Performing Rights Organization (PRO) Disclosure

11.1 IndieNodes' own web clients (widget, reader, field view) operate under blanket web licenses of the kind offered by performing rights organizations, covering the act of streaming linked audio through IndieNodes' interface.

11.2 This blanket coverage applies to IndieNodes' own operation. It does not substitute for a Creator's individual PRO membership obligations, if any, with respect to the media they host and link from their own infrastructure.

11.3 As part of the submission checklist, Creators submitting audio Nodes are asked to disclose PRO membership status (not a member / a named PRO such as ASCAP, BMI, SESAC, or GMR / other / not sure). This is a disclosure step for the Licensor's own visibility into PRO exposure across the ring — it is not a gate on submission eligibility, and no submission is accepted or rejected on the basis of this answer.

11.4 IndieNodes' PRO and rights-organization licensing posture is addressed separately and is outside the scope of this Agreement.

## 12. Personalization and Local-Only Data

Likes, Not for Me choices, discovery journal events, filters, field arrangement, themes, skins, player settings, and the “Play my Liked” feature operate from data stored in the visitor's browser. A visitor may export supported local data or clear it. Suggested playback expansions are explicit choices and are not triggered as an undisclosed recommendation profile.

## 13. Disclaimer of Warranty

The Service, public ring data, generated output, and linked or embedded content are provided subject to the disclaimers in the Terms of Use. Nothing in this Agreement promises uninterrupted availability, acceptance, publication, a particular audience, or continued availability of creator-hosted media. Rights that cannot lawfully be disclaimed remain unaffected.

## 14. Limitation of Liability

The limitations of liability in the Terms of Use apply to this Agreement to the fullest extent permitted by law. You remain responsible for maintaining backups of your source files, generated site, and any browser-local data.

## 15. Termination

15.1 This Agreement remains in effect while your Node is pending or published. The Licensor may reject or remove a Contribution that violates this Agreement, the Terms of Use, the curation policy, or applicable law.

15.2 A verified removal request revokes the license in §7 prospectively once the removal is published. It does not require deletion of independently hosted sites you generated, undo past authorized display, or recall copies already cached, archived, forked, or recorded in public version-control history.

## 16. Intellectual Property Claims

If a third party claims that a submitted Node infringes their intellectual property rights, the submitting Creator is responsible for the investigation, defense, and resolution of that claim as it relates to their own Contribution, consistent with the representations made under §5.4.

## 17. Applicable Law

This Agreement is governed by Florida law, excluding conflict-of-law rules. Any claim must be brought in a state court located in Broward County, Florida, or the United States District Court for the Southern District of Florida, except where applicable law gives a consumer a different required forum.

## 18. Contact Information

For inquiries, complaints, claims, fallback Node-maintenance requests, or rights concerns:

Jamaal Ephriam<br>
IndieNodes<br>
contact@keyjayonline.com

## 19. Miscellaneous

19.1 If any term of this Agreement is found invalid, the remaining terms remain in effect, and the invalid term will be replaced with one that achieves its original purpose as closely as possible.

19.2 Amendments to this Agreement are valid only if made in writing and version-tracked, consistent with this document's own version header.
