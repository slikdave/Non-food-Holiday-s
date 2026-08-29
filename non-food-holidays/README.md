# Non-food Holidays + Holiday Requests

Two standalone web apps that share one live Firestore database:

- `master-app/`      → **Non-food Holidays** (admin console, dark green)
- `companion-app/`   → **Holiday Requests** (colleague app, light green)

They are separate apps with separate URLs, but both read/write the same
Firebase project, so an approval in one shows up in the other within
about a second (real-time, not polling).

## 1. Create the Firebase project (one-time, ~5 minutes)

1. Go to https://console.firebase.google.com → **Add project** → give it
   a name (e.g. `non-food-holidays`) → finish the wizard (Analytics optional).
2. In the project, go to **Build → Firestore Database → Create database**.
   Choose **Start in production mode** and pick a region near you.
3. Go to **Project settings → General → Your apps → </> (Web app)**.
   Register an app (nickname doesn't matter) and copy the `firebaseConfig`
   values it shows you — you'll need all six for the next step.
4. Go to **Firestore Database → Rules** and paste in the contents of
   `firestore.rules` from this repo, then **Publish**.

You only need to do this once — both apps point at the same project.

## 2. Configure each app

In **both** `master-app/` and `companion-app/`:

```
cp .env.example .env
```

Then fill in `.env` with the six values from step 1.3 (same values in both
apps' `.env` files, since they share the one Firebase project):

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## 3. Run locally to check it works

```
cd master-app && npm install && npm run dev
```
```
cd companion-app && npm install && npm run dev
```

Open both dev URLs side by side — add a name in the master app's
Colleagues tab, confirm it shows up on the companion app's Home Screen
dropdown, submit a request, approve it, watch it appear on both calendars.

## 4. Deploy so colleagues can actually reach it

Easiest option: **Vercel** (free tier is plenty for this).

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New Project** → import the repo.
3. Vercel will ask for the project root — set it to `master-app` for one
   deployment, and create a **second** Vercel project pointing at
   `companion-app` for the other. You'll end up with two separate URLs,
   e.g.:
   - `https://nonfood-holidays.vercel.app` (admin)
   - `https://holiday-requests.vercel.app` (colleagues)
4. In each Vercel project's **Settings → Environment Variables**, add the
   same six `VITE_FIREBASE_...` values from your `.env`.
5. Deploy. That's it — both URLs are now live and talking to the same
   Firestore database.

(Netlify works the same way if you'd rather use that — same env vars,
same per-folder deploy.)

## 5. Provision the master account

The Master App uses Firebase Authentication with Email/Password. The
Companion App signs colleagues in anonymously so its existing name-selection
flow remains unchanged. Firestore, rather than the frontend, decides whether
an authenticated user is a master.

1. In Firebase Console, open **Authentication → Sign-in method**, enable
   **Email/Password** and **Anonymous**, then save. Email/Password is for the
   Master App; Anonymous keeps the Companion App's existing colleague flow
   unchanged while giving it authenticated read access.
2. Open **Authentication → Users → Add user**. Create the master account's
   email address and password. Keep the password in your password manager;
   never put it in this repository, Codespaces, or frontend configuration.
3. In the Users list, copy that account's **User UID**.
4. Open **Firestore Database → Data**, create a top-level collection named
   `admins`, and create a document whose document ID is exactly the copied
   UID.
5. Add this field to that document:

   ```text
   role: "master"
   ```

   The accepted role values are `master` and `admin`. Do not create this
   document from the app; the deployed rules intentionally deny client
   writes to `admins`.
6. Paste the repository's `firestore.rules` into **Firestore Database →
   Rules** and click **Publish**. This is required because Rules are deployed
   separately from the web apps.

Open the Master App, sign in with the account created in step 2, and confirm
that the admin console appears. Only that authenticated UID can create,
update, or delete documents in `blackouts`. Authenticated colleagues can read
blackouts, but cannot write them.

## 6. Get it onto devices

Once deployed, each URL is installable as an app:

- **iPhone (Safari):** open the URL → Share → **Add to Home Screen**
- **Android (Chrome):** open the URL → ⋮ menu → **Add to Home Screen** /
  **Install app**

Send colleagues the companion URL, and keep the master URL for the admin
device(s) only.

## Notes

- Data model: a `meta/roster` document holds the GM and George name lists,
  and a `requests` collection holds one document per request
  (`name`, `list`, `dates[]`, `status`, `manual`, `createdAt`, `updatedAt`).
- The companion app's "remembered name" and "dismissed notifications" are
  stored in that browser's `localStorage`, so they're genuinely per-device
  — reinstalling or clearing site data resets them.
- The Firestore rules above are open (no login) so both apps work without
  building an auth system. That's fine for an internal tool on an
  unlisted URL, but anyone with the link and Firestore project ID could
  technically write to it. If that's a concern, the next step is adding
  Firebase Authentication (e.g. a simple shared passcode or email login)
  and restricting the rules to signed-in users — happy to help with that
  if you get there.
