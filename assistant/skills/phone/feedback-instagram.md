---
name: feedback-instagram
description: Read how one of our Instagram posts is doing (likes, comments, shares, saves, views and the latest comments).
---
Find one of our recent Instagram posts in the Instagram app on this phone and read how it is doing. Only
read: do not like, comment, reply, share, delete or change anything.

The post: a {{placement}} posted {{posted}}, whose caption starts with {{first_words}}.

Be quick: this takes about ten steps. Stop as soon as you have read what is listed below. Instagram's bottom
bar, left to right: Home, Reels, Messages (paper plane), Search, your profile picture (far right). If the screen
already shows the post (the account's name over its caption's first words), read it right there: skip to step 4.

If the post is a story (the line above says "a story"): open the Instagram app, close any pop-up, and tap
your own profile picture at the top left of the home feed. If it has no coloured ring, the story is gone
(stories last 24 hours): report found false with a note saying so. Otherwise it opens your story: read the
viewers count at the bottom left ("Seen by N", or the eye icon with N, or "Activity" with N) as views, and
the number of hearts in that activity as likes if it shows one. Story replies are private messages: report
comments null. Then report and stop; skip the steps below.

1. Open the Instagram app (package com.instagram.android). If it shows a login screen, stop and say so.
   Close any pop-up with "Not now" or the X.
2. Open the profile: tap the profile picture at the bottom right.
3. Find the post in the grid (for a reel, the Reels tab, the film icon above the grid, also shows play counts
   on each thumbnail; note the count of ours). It is usually the newest. Open it and check that its caption
   starts with the words above; if not, look at the next ones (at most the 12 newest). If it is not there,
   report found false.
4. Read the numbers under the post: likes ("N likes" or "Liked by someone and N others": that is N + 1), and
   comments ("View all N comments"). On a reel they sit under the icons on the right (heart: likes, speech
   bubble: comments, paper plane: shares); an icon with no number under it means 0. If there is a "View insights" link (professional accounts), tap it and
   read views (or reach / plays), shares and saves, then go back. Use the exact numbers shown; 1.2K is fine.
5. Tap the comment icon to open the comments. Read the {{comments_kept}} newest comments (the author's name
   and the words). Do not reply.

Report as JSON: found, likes, comments, shares, saves, views (null for any number you could not see),
latest_comments (author and text, newest first, at most {{comments_kept}}), and notes for anything else worth
knowing (for example a warning on the post, or that some numbers are hidden).
