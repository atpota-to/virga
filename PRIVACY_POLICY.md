# Privacy Policy

**Last updated:** November 15, 2026 (version 1)

This policy says what Virga does with information about you: what stays in your browser, what Virga’s server keeps, what is sent to other services, and what you can do about each. Virga is operated by **atpotato, LLC**, a Delaware limited liability company, which is the controller of the information described here. “We”, “us” and “our” mean atpotato, LLC.

The short version:

- Your archive (your posts, followers, blocks and the rest of what the reports are built from) is worked out and kept in your browser. It is not sent to our server.
- Our server is involved only for what has to happen while your browser is closed, or that a browser can’t do alone: long sessions, scheduled posts, post timers, and the optional post adviser and image descriptions. It also keeps the record that your account agreed to our terms.
- Virga has no advertising, no analytics or tracking scripts and no cookies. We don’t sell information about you.
- You sign in on your own account’s host. Virga never sees your password and doesn’t collect your email address.

Two terms are used throughout. A sign-in is held either as a **browser session**, which stays in your browser and talks to your account’s host directly, or as a **long session**, which our server holds so that things can happen while your browser is closed.

## The network is public

Virga works with accounts on the AT Protocol (atproto), the open network that Bluesky runs on. Posts, follows, likes, blocks, lists and profiles there are public records that anyone can read. Most of what Virga shows you, about you and about the people around your account, is read from that public data. This policy covers what Virga does with it. It doesn’t cover your account’s host, Bluesky or other apps, which have policies of their own.

## What stays in your browser

Virga keeps the following in the browser you use it in. None of it is sent to our server unless this policy says so below.

| What | Where | How to remove it |
| --- | --- | --- |
| Your archive: your posts, followers, follows, blocks, the lists you are on, who interacts with you (their DIDs, handles, names and pictures), and every record in your repository | IndexedDB, one database per account | Settings › Data and sync deletes it. So does Remove from this browser, if you tick the box to delete what the account keeps here |
| Pictures and video attached to drafts | IndexedDB, per account | Deleting the draft, or Remove from this browser with the box ticked. Settings › Data and sync leaves them |
| The accounts you have signed in with (DID, handle, name, picture, when each was last opened) and which one is open | localStorage | Remove from this browser |
| A long session’s token, which lets this browser act as your account through our server | localStorage | Signing out |
| A browser session’s tokens and keys | IndexedDB, kept by the sign-in library | Signing out |
| Your dashboards, posting settings (including the adviser’s goals, notes and style reading), an unsent post (for a day), a copy of your templates, this month’s adviser count, the tools’ Keep lists and the notes you put on your charts | localStorage, per account | Remove from this browser, with the box ticked |
| A note that the account agreed to our terms, and when | localStorage, per account | The same |
| Theme, accent, density, how numbers and dates are written and other display preferences, the commands you last used from the command palette, and a random identifier written into your Bluesky drafts so they can tell devices apart | localStorage, per browser | Clearing the site’s data in your browser |
| A sign-in in progress, and a compose link opened before signing in | sessionStorage | Closing the tab |

A script running on the page could read what is kept here. That is true of every web app that keeps a session in the browser, and it is the reason to use Virga on a device you trust.

## What Virga’s server keeps

Our server is a set of functions hosted by Vercel, with a database and file storage at Supabase. It holds the following, and only for accounts that use the feature in the first column.

| Feature | What is kept | For how long |
| --- | --- | --- |
| Long sessions | Your account’s DID, the tokens your host issued to Virga and the key they are bound to, encrypted before they are stored. A fingerprint (SHA-256) of each browser’s session token, with the DID and an expiry date. The token itself is not stored | The tokens: deleted when our server receives a sign-out from the last browser holding the session. If that sign-out never reaches the server, or you withdraw Virga’s permission at your host without signing out, they stay (no longer usable, in the second case) and are not removed automatically today; you can ask us to delete them. A browser’s fingerprint: deleted when that browser signs out; otherwise it stops working within 30 days of its last use, and the expired row is not removed automatically today |
| A sign-in in progress | A one-time key and where to return to | Until the sign-in finishes. One that is abandoned expires after an hour |
| Scheduled and queued posts | Your DID, the post as you wrote it (text, links and their cards, alt text, tags, languages, labels, who can reply or quote, any timer to start when it goes out), the time and your device’s time zone, whether it went out, the address of the post once it has, and the last error if it failed. For a scheduled reply, also the address of the post it answers, with that post’s author’s handle and name and up to 300 characters of its text, so the list can show what it replies to. For a post set to repeat, also how often and until when; each time it goes out has a row of its own. Pictures are kept in private storage | Pictures: deleted when the post is published or cancelled, and after 30 days for a post that failed. A repeating post’s pictures are kept while a time it could still go out is waiting, and deleted once none is. The row and its text: kept after the post goes out or is cancelled. There is no automatic deletion of these rows today; you can ask us to delete them |
| Post timers | Your DID, the post’s address and those of the other posts in its thread, up to 200 characters of its text, the timer’s rule, the counts last read for it, how it ended and the last error if it failed | Kept after the timer ends. No automatic deletion today; you can ask us to delete them |
| The post adviser and image descriptions | Your DID with a count of uses per month and per day. Not the post, the image or the model’s answer | Kept. You can ask us to delete them |
| Agreement to our terms | Your DID, the version and date of the documents, the time, and the IP address and browser (User-Agent) the agreement was made from. The record also says whether the DID came from a long session, which the server can verify, or was reported by a browser session, which it can’t. A browser session’s report is sent after you agree; if it never arrives, the only record is the note in your browser | Kept, with no set period: it is the record that the account agreed. The server can add these rows but can’t change or delete them; we delete them on a valid request |

Our server also writes operational logs, which Vercel keeps for the period its service sets. Virga’s own log lines can include a DID, a handle from a sign-in that failed, the name of a call and an error message. Virga doesn’t write post text, tokens or IP addresses to them, though an error returned by another service is logged in that service’s own words. Vercel and Supabase, as hosts, see the IP address and browser of each request to them and keep their own logs.

The IP address of a request is also used in memory, for about two minutes, to limit how many sign-ins and agreements can be started from one address. The addresses kept with agreements that browser sessions report are counted, to cap how many such reports one address can make in a day.

## What passes through the server without being kept

With a long session, your browser’s calls to your account’s host go through our server, because it holds the tokens: reading your followers, notifications, drafts, saved posts and preferences, searching posts, and writing posts, follows and uploads. The server passes each call on and returns the answer. It doesn’t store the contents. A browser session makes the same calls directly, and our server isn’t involved.

## What is sent to other services

Virga’s code makes requests to the services below. Each sees your IP address, as any website does, and handles what it receives under its own policy.

| Service | What it receives | When |
| --- | --- | --- |
| Your account’s host (PDS) and its sign-in server | The sign-in itself, reads of your repository and your writes (posts, follows, uploads) | Signing in, syncing, posting |
| Bluesky’s public API (`public.api.bsky.app`) and AppView | Requests naming your DID or handle, and the DIDs of accounts in your archive: profiles, feeds, posts, lists. What you type in the sign-in field, once it is two characters long, to suggest accounts and to find yours. Post searches and mentions you look up | Signing in, syncing, composing, timer checks by our server |
| `bsky.social` | The handle you typed, to find its account | Starting a browser session |
| Google Public DNS (`dns.google`), then the handle’s own domain | The handle you typed, as a lookup made by our server | Starting a long session |
| The PLC directory (`plc.directory`), or a `did:web` account’s own domain | A DID, to find its host | Identity lookups, and by our server before a scheduled reply goes out |
| The host (PDS) of the account whose post a scheduled reply answers | The address of that post, asked by our server without signing in, to check that it is still there | Just before a scheduled reply goes out |
| Constellation (`constellation.microcosm.blue`) | Your DID, the addresses of your records and the DIDs of accounts in your archive, to find who blocks you and which lists you are on | The blocks and lists reports |
| Bluesky’s link card service (`cardyb.bsky.app`), and the site a card’s picture is on | The address of a link you add to a post. The card’s picture is then fetched from the address the service gives: by your browser while you write, or by our server when a scheduled post with a card goes out | Composing, and publishing a scheduled post |
| Bluesky’s video service (`video.bsky.app`) | A video you post, with a short-lived pass from your host | Posting a video |
| Bluesky’s image CDN (`cdn.bsky.app`) | Requests for the pictures shown on screen | Viewing |
| Vercel | Every request to the site and to our server | Always |
| Supabase | Everything listed under “What Virga’s server keeps” | Long sessions and the features that need one, and agreeing to our terms on either kind of session |
| Vercel’s AI Gateway and the model provider it routes to | See the next section | Only when you use the adviser or ask for an image description |

When you publish a post through Virga, it goes to your host and becomes public on the network, as you asked.

## The post adviser and image descriptions

These two features are optional and use an AI model. The adviser is off until you turn it on for an account in Settings › Posting; once on, it reads each post before it goes out, unless you change that. An image description is requested one picture at a time, when you press the button for it. Both need a long session.

When one runs, your browser sends our server what the model needs, and our server passes it to a model through Vercel’s AI Gateway:

- **The adviser:** the post, the goals and notes you set, your style reading if you made one, and, for a reply or a quote when that setting is on, the public posts being replied to with their authors’ names or handles.
- **A style reading:** up to 500 of your own public posts.
- **An image description:** the image, the post’s text, and any description you asked to have revised.

Your account’s DID goes with each request, so the gateway can count use per account. Our server doesn’t store what was sent or what came back; it keeps the counts described above. Whether a model provider retains what it receives or uses it to improve its models, and for how long, is governed by the settings of our gateway account and that provider’s terms, not chosen per request. By default the models are from Google and Anthropic; which ones are used may change. Settings › Posting shows what is sent and to whom for your account.

If you don’t want a post or an image sent to a model, leave the adviser off and write your own descriptions.

## Why we use this information

- **To provide Virga.** Holding a long session, publishing a scheduled post, running a timer and counting an allowance are the features themselves. Where the law asks for a legal basis, this is the performance of our agreement with you.
- **To keep Virga working and safe.** Rate limits, logs and the checks that stop one account or address from overloading the server. Our legal basis is our legitimate interest in running a reliable service.
- **To keep a record that you agreed to our terms.** Our legal basis is our legitimate interest in being able to show that agreement, and where it applies, the establishment or defence of legal claims.
- **To meet legal obligations,** when a law requires us to keep or disclose something.

We don’t use your information for advertising, we don’t build profiles of you for anyone else, and we don’t train AI models on it ourselves. What a model provider may do with a post or an image sent to it is covered under [The post adviser and image descriptions](#the-post-adviser-and-image-descriptions).

## When we share information

- **With the service providers named above,** which process information for us to run Virga: Vercel, Supabase and, for the AI features, the gateway and its model providers.
- **With the network, at your instruction.** Posting, following and the other things you ask Virga to do are sent to your host.
- **When the law requires it,** or to protect someone’s safety or our legal rights. We will tell you if we are allowed to.
- **If the business changes hands.** In a merger or sale, information we hold would pass to the new operator, under this policy.

We don’t sell personal information, and we don’t share it for targeted advertising.

## Security

Sign-in tokens are encrypted before they are stored. Session tokens are stored only as fingerprints. Every table is closed to everything but our server’s own key, and the agreement record can’t be altered by that key. Requests travel over HTTPS. No system is perfectly secure, and we can’t promise that ours is. If a breach affects your information, we will tell you and the authorities as the law requires.

## Your choices and rights

In Virga itself you can:

- **Sign out,** which ends the session in that browser. For a long session, our server gives up Virga’s permission and deletes its tokens once it has received the sign-out from the last browser holding the session.
- **Remove an account from a browser,** and delete what it keeps there.
- **Delete your archive** in Settings › Data and sync, or export it.
- **Cancel a scheduled post or a timer.**
- **Turn the adviser off.**
- **Withdraw Virga’s permission** at your account’s host, which stops Virga’s sessions for that account from working.

For what our server holds, write to us at the address under [Contact](#contact). You can ask for a copy of the information we hold about your account, for a correction, or for its deletion, including scheduled posts, timers, usage counts and the agreement record. To make sure a request comes from the account’s owner, we will ask you to show that you control the account, for example by making a post from it that we agree on with you. We answer within the time the law requires.

Depending on where you live, you may also have the right to object to or restrict some uses, to receive your information in a portable form, to withdraw consent where we rely on it, and to complain to your data protection authority. We don’t discriminate against anyone for using these rights.

**California and other US states.** We don’t sell or share personal information as those laws define the terms, and we don’t use sensitive information for anything beyond providing Virga. You may ask what we hold, ask for its deletion or correction, and appeal a refusal by replying to our answer.

**Europe and the UK.** atpotato, LLC is in the United States and has not appointed a representative in the EU or the UK. You can use your rights by writing to us directly.

## Other people’s information

Your archive holds public information about other accounts. It stays in your browser. If you are one of those people and want to know what a copy of Virga in someone’s browser holds about you, the answer is: whatever is public about your account on the network, in the browsers of the people whose accounts you interact with. Our server holds another person’s information only inside the content of a Virga user’s own scheduled post or timer, such as a post being quoted, and, for a scheduled reply, as the handle, name and up to 300 characters of the post being answered.

## Children

Virga is not for children under 13, or under the age at which they can consent to an online service where they live. We don’t knowingly collect information from them. If you believe a child has used Virga, write to us and we will delete what our server holds.

## Where information is processed

We and our providers operate in the United States and other countries, so your information is processed outside the country you live in. Where the law requires a safeguard for that transfer, we rely on the standard contractual clauses and the other mechanisms our providers offer.

## Changes to this policy

When this policy changes in a way that matters, the version at the top goes up and Virga asks each account to agree again before it carries on. For smaller changes we update the date.

## Contact

atpotato, LLC, 8595 Pelham Road, Suite 400 #747, Greenville, SC 29615, USA

Email: [privacy@anisota.net](mailto:privacy@anisota.net)

The [Terms of Service](TERMS_OF_SERVICE.md) are the agreement this policy belongs to.
