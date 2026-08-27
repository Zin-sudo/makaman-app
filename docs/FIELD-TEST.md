# Makaman Job Tickets — Field Test

**Three days. Two or three technicians. Real wells, real clients, real money.**

The purpose is not to find out whether the app works — 40 automated suites already say it
does, on a laptop, against a fake. The purpose is to find out what a laptop cannot know: a
phone in the sun with 4% battery and no signal, a client who wants to sign now, a job that
starts on one man's phone and ends on another's.

Every job in this test is a **real job that must also exist on paper**. The paper copy is
the control. If the app and the paper disagree about money, the paper is right and the app
has a defect — that is the whole reason for running both.

---

## 0. Before anyone leaves the office

Nothing below is optional. A field test that starts with one of these unchecked measures
the wrong thing.

| # | Check | Who | Done |
|---|---|---|---|
| 0.1 | Seeded Admin password rotated — it appeared in a chat transcript, so treat it as public. Do it **in the app**: Account → Settings → Password | Admin | ☐ |
| 0.2 | ~~Supabase leaked-password protection~~ — nothing to switch on. It is a paid feature on this plan, so the check is built into the app and runs on every password set here. No action | — | ☑ |
| 0.3 | A real account for each tester — right name, right role, status **active**, and a password **they** chose in Settings → Password, not one you handed them | Admin | ☐ |
| 0.4 | Ops Manager and Observer accounts working on the office side | Admin | ☐ |
| 0.5 | Database snapshot taken, with the time written down | Admin | ☐ |
| 0.6 | Price list checked for the **specific client** each crew will visit — open it in the app and read three prices against the client's own sheet | Ops | ☐ |
| 0.7 | Each phone: open the site **with signal**, sign in once, install to home screen ("Add to Home Screen" / "Install app") | Technician | ☐ |
| 0.8 | Build stamp on the login screen reads **`field-test.1 · 27 Aug 2026`**. If it says anything else, the phone is running an older build — hard-refresh with signal and check again | Technician | ☐ |
| 0.9 | Airplane mode on, close the app fully, reopen it. It must open and show your jobs. If it shows a blank page, 0.7 did not finish — redo it with signal | Technician | ☐ |
| 0.10 | Ticket-number series claimed by the right person | Ops | ☐ |

**0.8 and 0.9 are the two that get skipped and shouldn't be.** 0.8 is the only way to know
which code a phone is actually running. 0.9 is the only proof the app will open at a well
with no signal — and it is the failure that ends a test day, because a technician who
cannot open the app logs the job on paper and the test is over for that crew.

---

## 1. The three days

### Day 1 — near base, supervised

One real job per technician, within phone signal, with somebody experienced beside them.
The point is to find the things that stop work entirely, while help is still walking
distance away.

Each technician must, on day 1:
1. Log one job start to finish and close it.
2. Capture coordinates at the wellhead and confirm they appear on the printed sheet.
3. Preview both A4 sheets and read them in sunlight. Can the client read it? Can you?
4. Force-quit the app mid-log (swipe it away), reopen it, and confirm nothing was lost.

Stop at the end of day 1 and read the incident log before day 2. If anything blocking
appeared, day 2 does not start.

### Day 2 — real wells, no supervision

Normal work. In addition, between the crews, these must each happen at least once:

| # | Scenario | Why it is in the list |
|---|---|---|
| 2.1 | A whole job logged in **airplane mode**, start to close, synced only on return | This is the ordinary case at a Libyan well, not the exception |
| 2.2 | Two technicians take a ticket number while **both offline**, then both sync | The one collision the database cannot prevent while offline |
| 2.3 | The office edits a ticket while the technician is offline on the same ticket | Whoever reaches the server last must not silently win |
| 2.4 | A **handover** mid-job — tools and ticket pass to another technician | Two people answerable for one job log |
| 2.5 | A job with **more than 24 charged lines** | The workbook has 24 rows; the overflow must still balance |
| 2.6 | A client signs and stamps the Service Ticket and the Job Log on paper | Feeds 3.x below |

### Day 3 — the office side

Field work continues, and the office closes the loop on everything logged so far:

| # | Scenario |
|---|---|
| 3.1 | Ops reviews and **approves** a ticket |
| 3.2 | The technician who did the job sends back photos of the **signed Service Ticket** and the **signed Job Log** |
| 3.3 | The awaiting-paperwork list clears as they arrive |
| 3.4 | Ops **reopens** an approved ticket, reason recorded |
| 3.5 | Ops raises a ticket for a customer with **no price list**, entering item, description, qty, UoM and unit cost by hand |
| 3.6 | The Observer opens a ticket and sees stages but **not** the edit trail |
| 3.7 | A month's report is exported and the per-ticket ZIP opens with all four sheets |

---

## 2. What to write down

One line per incident, on paper or in a message — six fields, no more, or nothing gets
written down at all:

```
TICKET   __________   TIME __:__   WHO ______________
DID      what you tapped
EXPECTED what you thought would happen
GOT      what happened instead
SIGNAL   full / weak / none
```

Take a screenshot whenever the screen is wrong. A screenshot with a ticket number and a
clock beats a paragraph written that evening.

**Also record what went right**, once per job: ticket number, minutes from arrival to
closed, and whether it was faster or slower than doing it on paper. A test that only
collects complaints cannot answer the question the go/no-go actually asks.

At the end of each day, each technician sends their incident lines and their job times.
The office reconciles **every** ticket logged that day against its paper copy, line by
line, and records any money difference — currency, amount, and which is right.

---

## 3. Go / no-go, decided now

These criteria are fixed **before** the data arrives. Deciding what counts as a failure
after seeing the failures is how a bad build ships.

### Blocking — one occurrence is a no-go

1. **Data loss.** A logged job, a charged line, or a job-log entry that existed on a phone
   and did not arrive at the office.
2. **Wrong money on an approved ticket.** Any difference between the app and the signed
   paper copy that is not a typing mistake by the person logging.
3. **A ticket number used twice** on two tickets that both went to a client.
4. **A crew boundary crossed.** Someone opening, editing, or attaching to a job that is
   not theirs and that their role does not entitle them to.
5. **A signed document attached to the wrong ticket.**
6. **The app will not open, or will not log, without signal.**

### Count-based — the threshold, not the incident, decides

| Measure | Go | No-go |
|---|---|---|
| Sync attempts needing a manual retry | ≤ 1 per technician-day | more |
| Crashes or blank screens | ≤ 1 per technician-day | more |
| Jobs slower on the app than on paper | ≤ 1 in 4 | more |
| Battery: a full working day on one charge | yes | no |

### Non-blocking — logged, not counted

Wording, spacing, colour, button placement, anything cosmetic. These go straight to the
Tier 6 design pass and must not hold up a go decision. Write them down anyway; the design
pass is far better informed by three days of real use than by a mockup.

### The bar for GO

- Every technician completed **at least three full jobs** end to end, **including one
  entirely offline**.
- **Zero** blocking incidents.
- Every count-based measure inside its Go column.
- The office reconciled **every** ticket against paper with **no money difference**.

Anything short of all four is a no-go, which means a fix list and a shorter second test —
not a rewrite, and not shipping anyway.

---

## 4. If something goes wrong at a well

The app is the second record during this test, never the only one. Paper is always being
kept in parallel, so nothing below loses a job:

- **App will not open:** work on paper, note the time, tell the office. Do not reinstall —
  the state on that phone is evidence.
- **A ticket disappeared:** stop, screenshot the list, note the ticket number, tell the
  office immediately. Do not log it again; a second copy makes the cause unfindable.
- **Sync will not finish:** keep working. It queues. Note the time it started failing.
- **Wrong price shown:** use the client's own sheet for the paper copy, and record both
  numbers.

Never delete the app, clear its data, or sign out to "fix" something during the test. That
throws away everything that would explain it.
