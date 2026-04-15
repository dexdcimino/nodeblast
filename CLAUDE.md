# NodeBlast

Creator portfolio platform at nodeblast.dev. Shares Firebase project (dexnote-d7047) and user accounts with DexNote.

## Tech Stack
- Vanilla JavaScript ES modules
- Firebase Auth (Google + GitHub)
- Firestore for data
- Firebase Storage for images
- Deployed on Vercel

## Architecture
- Single-page app, all JS in /js/, all CSS in /css/
- firebase-config.js auto-switches between dev (127.0.0.1) and prod by hostname
- Auth uses popup flow, authDomain stays as dexnote-d7047.firebaseapp.com (do NOT change this)

## Brand
- Name: NodeBlast (variable: keep easy to change)
- Tagline: "create. share. detonate."
- Primary color: #5AAA72
- Font: Outfit

## Key Rules
- Same user account system as DexNote — same users/ collection in Firestore
- New Firestore collections for NodeBlast: catalysts/, votes/
- Firebase Storage path for thumbnails: /catalysts/{userId}/{catalystId}/thumb

## Git Workflow
- **Always work directly on `main`. Never create feature branches.** Solo-dev project — standard branch/PR flow is overhead without payoff. Commit and push to `main` immediately after each task.

## Firestore Rules
- `catalyst_backups` subcollection under `users/{userId}` requires read/write rules (same pattern as `account_backups`, `deleted_sessions`, etc.). Always keep `catalyst_backups` rules in sync when updating `firestore.rules` — omitting it causes `saveCatalystBackup` to silently fail against the deny-all catch-all.
- Required composite indexes for `catalysts` collection (keep `firestore.indexes.json` in sync):
  - `ownerId ASC, createdAt DESC`
  - `isPublic ASC, createdAt DESC`
  - `isPublic ASC, fireCount DESC`
  - `category ASC, isPublic ASC, createdAt DESC`
  - `category ASC, isPublic ASC, fireCount DESC`
- NodeBlast and DexNote share Firebase project `dexnote-d7047` but maintain **separate** `firestore.rules` files. DexNote's rules are the source of truth for shared paths (`users/`, `worlds/`, etc.). Do NOT deploy `firestore:rules` from this repo — it would overwrite DexNote's rules. Deploy rules from DexNote; deploy `firestore:indexes` from whichever repo owns the collection (NodeBlast owns `catalysts/`, `votes/`).
