# Dispatch Central — User Setup Guide

This guide walks you through connecting your Dispatch HTTP Manager to a Dispatch Central server so you can share and sync API collections with your team.

---

## What You'll Need

Before you start, get the following from your team admin (the person who deployed the Central server):

- **Central URL** — The server address (e.g., `https://central.yourteam.com`)
- **Passphrase** — A shared secret used for one-time registration

---

## Step 1: Connect Dispatch to Central

1. Open **Dispatch**
2. Go to **Settings**
3. Find the **Dispatch Central** section
4. Enter the **Central URL** provided by your admin
5. Enter the **Passphrase**
6. Choose an **Instance Name** — a friendly label so your team knows who you are (e.g., "Sarah's Laptop", "Dev Machine")
7. Click **Connect**

You'll see a confirmation that your instance is registered. This is a one-time step — Dispatch remembers your connection for future sessions.

> **Note:** The passphrase is only used during this registration step. After connecting, Dispatch uses a unique token behind the scenes. If the admin rotates the passphrase later, your existing connection is unaffected.

---

## Step 2: Publish a Collection

Share one of your local collections with your team by publishing it as a channel.

1. Right-click a collection in the sidebar
2. Select **Publish to Central**
3. Choose a sharing mode:
   - **Readonly** — Only you can push changes. Others can pull but not modify.
   - **Readwrite** — Anyone subscribed can push changes.
4. Click **Publish**

You'll receive a **Channel ID** — a unique identifier for your shared collection. Copy it and share it with your teammates via Slack, email, or however your team communicates.

> **Tip:** You can change the sharing mode later from the channel settings if you change your mind.

---

## Step 3: Join a Shared Channel

When a teammate shares a Channel ID with you:

1. Click **Join Channel** (in the sidebar or from the menu)
2. Paste the **Channel ID**
3. Click **Subscribe**

Dispatch will pull the full collection from Central and add it to your sidebar. You're now synced.

---

## Step 4: Pulling Updates

When teammates push changes to a shared channel, you'll see an **updates available** indicator on the collection.

1. Click the collection with the update badge
2. Click **Pull** (or right-click → **Pull from Central**)
3. Review the change summary — it shows how many requests were changed or deleted
4. Click **Pull Now** to apply the changes

Your local collection is now up to date.

> **Tip:** Dispatch checks for updates when you open the app and periodically while it's running. You don't need to manually check.

---

## Step 5: Pushing Your Changes

When you modify requests in a synced collection, Dispatch tracks your changes locally. To share them with the team:

1. Look for the **local changes** indicator on the collection
2. Click **Push** (or right-click → **Push to Central**)
3. Review what will be pushed — added, modified, and deleted requests
4. Click **Push** to send your changes

Your teammates will see the updates next time they pull.

> **Note:** On **readonly** channels, only the owner (the person who published) can push. On **readwrite** channels, anyone subscribed can push.

---

## Understanding Sync Status

Each synced collection shows a status badge:

| Badge | Meaning |
|-------|---------|
| **Synced** (green) | Your local copy matches the server. Nothing to do. |
| **Local Changes** (orange) | You've made changes that haven't been pushed yet. |
| **Updates Available** (blue) | The server has changes you haven't pulled yet. |

---

## Frequently Asked Questions

### Can I work offline?

Yes. Dispatch is local-first — all your data lives on your machine. Syncing only happens when you explicitly push or pull. If you're offline, you can keep working normally and sync when you're back online.

### What happens if two people edit the same request?

The last push wins. If you and a teammate both modify the same request and push, whoever pushes second overwrites the first person's changes for that specific request. Other requests are unaffected.

To minimize conflicts on active projects, use **pull before push** as a habit — pull the latest changes, then push yours.

### Can I stop syncing a collection?

Yes. Right-click the collection and select **Unsubscribe** (if you're a subscriber) or **Unpublish** (if you're the owner). Your local copy of the collection is kept — it just becomes a regular local collection again.

### What if the channel is deleted?

If the channel owner or an admin deletes a channel, you'll see an error next time you try to sync. Dispatch will offer to convert it to a local-only collection so you don't lose your data.

### Can I sync the same collection to multiple Central servers?

Not currently. Each collection can be linked to one Central channel at a time.

### How do I change a channel from readonly to readwrite?

Only the channel owner can do this:

1. Right-click the synced collection
2. Go to **Channel Settings**
3. Toggle the mode to **Readwrite**

All subscribers can now push changes.

### I lost my connection / got a new machine — what do I do?

Re-register using the same Central URL and passphrase (ask your admin if you don't have it). You'll get a new instance token. Then re-subscribe to your channels using their Channel IDs — ask your teammates for the IDs if needed.

Your old instance token becomes inactive but doesn't affect anyone else.

---

## For Team Admins

If you're the person deploying Dispatch Central for your team, see the [Installation Guide](INSTALLATION.md) for server setup, and the [README](README.md) for an overview of the system.

To manage instances, channels, and view activity, access the **Admin Dashboard** at `https://your-central-url/admin`.
