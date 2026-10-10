---
name: feedback-x
description: Read how one of our posts on X is doing (replies, reposts, likes, bookmarks, views and the latest replies).
---
Find one of our recent posts on X in the X app on this phone and read how it is doing. Only read: do not
like, reply, repost, bookmark, delete or change anything.

The post: posted {{posted}}, whose text starts with {{first_words}}.

Be quick: this takes about ten steps. Stop as soon as you have read what is listed below.

1. Open the X app (package com.twitter.android). If it shows a login screen, stop and say so. Close any
   pop-up with "Not now" or the X.
2. Open the profile: tap the profile picture at the top left, then "Profile".
3. On the "Posts" tab, find the post whose text starts with the words above (usually the newest; look at most
   at the 15 newest, and skip pinned posts that do not match). If it is not there, report found false.
4. Tap the post to open it. Read its numbers: views ("N Views"), reposts, quotes, likes and bookmarks
   (under the post, or the counts next to the reply, repost, like and bookmark icons). Shares = reposts plus
   quotes. Use the exact numbers shown; 1.2K is fine.
5. Scroll down to the replies and read the {{comments_kept}} newest ones (the author's name or @handle and the
   words). Do not reply.

Report as JSON: found, likes, comments (the number of replies), shares, saves (bookmarks), views (null for any
number you could not see), latest_comments (author and text, at most {{comments_kept}}), and notes for anything
else worth knowing.
