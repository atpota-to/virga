# Harness

The dashboard is behind a sign-in, so there is no way to open it locally, in a test or
from a screenshot tool without a real account. This runs the real app with one module
swapped out:

| real | harness |
| --- | --- |
| `src/session/useAtprotoSession.jsx` | `harness/fakeSession.jsx` |

The fake presents a made-up account, Mira Okafor (`mira.example.com`), as signed in. Its
agent answers the signed-in reads (followers, notifications, follow records) from
memory, and Follow and Following change that memory for the life of the page.
`harness/fakeNetwork.js` replaces `fetch`, so the public reads (the author feed,
profiles, the DID document, the repo download, Constellation) are answered from the same
fixtures. Nothing leaves the machine, and a request to a host it doesn't know is refused
with a warning in the console.

## Running it

```
npm run harness      # http://127.0.0.1:5174
```

It starts where a new person does: signed in, with no archive. Press Build your archive
and the sync runs against the fixtures, including a real repo CAR built in the browser.
The archive is then in IndexedDB like any other, so the next visit opens on the charts.
Clear the site's data to start over.

| address | what you get |
| --- | --- |
| `/` | signed in |
| `/?signedout` | the front page. Signing in as anyone lands in the dashboard; `nobody` fails, to show the error |
| `/oauth/callback` | a sign-in that came back declined |
| `?latency=0` | no simulated delay on requests (60ms each by default) |

## The fixtures

`harness/world.js` builds the account from a seeded random number generator, dated back
from now: about 1,000 posts over three years with a long tail of engagement, 4,810
followers on a curve with two bursts, 3,400 notifications from a cast of 64 people (some
with no name, some with no picture, some with a very long name), 5,600 likes and reposts,
nine other collections in the repo, 148 direct blocks and nine lists, four of them
moderation lists with subscribers.

Nobody in it is real. It is stand-in content shaped like the real thing, for building
and looking, not for shipping.

`harness/world.test.js` runs with `npm test`. It checks that the real code still reads
the fixtures the way it reads real answers, which is the only thing that stops them
drifting.

## What it is not

Not a mock of the protocol. It doesn't check OAuth, permissions, rate limits or lexicons,
and a bug that only shows against a real PDS will not show here.

Nothing here ships. `npm run build` uses the root `index.html` and never reads this
directory.

## What changes between syncs

So the tools have something to find:

- **Followers churn.** From the second sync on, a dozen followers have left and three
  have arrived, so the Unfollow tracker has entries. The sweep count is kept in
  localStorage with the archive; clear the site's data to start over.
- **Some follows have gone quiet.** Thirty-six follows outside the cast answer the
  activity check as quiet, never posted, or gone, for Follow cleanup.
- **The account has a history.** The PLC directory's audit log has a first handle on
  bsky.social, a handle of its own, and a move to its own PDS, for the Identity inspector.
