---
name: feedback-instagram
description: Read how one of our Instagram posts is doing (likes, comments, shares, saves, views and the latest comments).
---
Find one of our recent Instagram posts in the Instagram app on this phone and read how it is doing. Only
read: do not like, comment, reply, share, delete or change anything.

The post: a {{placement}} posted {{posted}}, whose caption starts with {{first_words}}.

1. Open the Instagram app (package com.instagram.android). If it shows a login screen, stop and say so.
   Close any pop-up with "Not now" or the X.
2. Open the profile: tap the profile picture at the bottom right.
3. Find the post in the grid (for a reel, the Reels tab, the film icon above the grid, also shows play counts
   on each thumbnail; note the count of ours). It is usually the newest. Open it and check that its caption
   starts with the words above; if not, look at the next ones (at most the 12 newest). If it is not there,
   report found false.
4. Read the numbers under the post: likes ("N likes" or "Liked by someone and N others": that is N + 1), and
   comments ("View all N comments"). If there is a "View insights" link (professional accounts), tap it and
   read views (or reach / plays), shares and saves, then go back. Use the exact numbers shown; 1.2K is fine.
5. Tap the comment icon to open the comments. Read the {{comments_kept}} newest comments (the author's name
   and the words). Do not reply.

Report as JSON: found, likes, comments, shares, saves, views (null for any number you could not see),
latest_comments (author and text, newest first, at most {{comments_kept}}), and notes for anything else worth
knowing (for example a warning on the post, or that some numbers are hidden).
