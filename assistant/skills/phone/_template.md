---
name: example
description: One line saying what this phone skill does (files starting with "_" are ignored).
---
A phone skill is the goal handed to the phone's own agent (backend/phone.py), so write it to that agent:
step by step, naming what it sees on screen ("the blue + button at the bottom right"), and what to do when
something gets in the way (a pop-up, a login screen). Keep it under about 5000 characters: the goal is capped
at 8000, and a long caption goes in too.

Which skill is used:
- post_on_phone, and FlowAI's scheduled posts when their time comes (backend/publisher.py):
  post-<platform>-<placement> (post-instagram-feed, post-instagram-reel, post-instagram-story),
  else post-<platform> (post-x). A platform without one isn't posted (FlowAI's run fails, so a person
  takes over)
- post_feedback: feedback-<platform>
- phone_task: any skill, when the assistant passes its name

These are replaced with the draft's details before the goal is sent:
- {{count}}: how many files were put on the phone (0 for a text-only post)
- {{media}}: the same in words, e.g. "3 pictures" or "1 video"
- {{kind}}: picture or video
- {{placement}}: feed, reel, story or post
- {{caption}}: the caption as numbered lines, each in quotes, to type one by one (the phone types plain
  ASCII only and no line breaks, so emoji are already gone)
- {{first_words}}: the caption's first words, in quotes, to recognise the post by
- {{posted}}, {{comments_kept}}: feedback only: when it went up, and how many comments to read

The phone agent reports its result in its own words, so end with what it should say: whether the post went
up, or exactly which screen stopped it. The screenshot it ends on is kept as proof (shown to the user and on
FlowAI's record), so a posting skill should say to stop on a screen that shows the post is up.
