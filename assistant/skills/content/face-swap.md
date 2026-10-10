---
name: face-swap
description: Putting someone's face on the person in a post's picture or video, or in any picture or video of the conversation (a face swap).
---
1. Only with the consent of the person whose face it is: the user's own face, or someone who agreed (a
   model, a team member). Never a public figure or anyone to pass off as real. If it isn't clear, ask.
2. The face: a picture in the conversation where the face is clear, lit and facing the camera (the user
   attaches it, or it comes from the gallery with use_assets). One face per picture; the largest is used.
3. The target: for a post, call swap_face with face and draft (and slide): the swapped picture or video
   takes that slide's place by itself, and undo_draft goes back. Otherwise pass target, the number of the
   picture or video. Only the largest face in it changes; every: true changes them all (a group photo).
4. A video works the same, frame by frame, its sound kept (a minute or so; 60 seconds of video at most).
   To make that person also say something else, swap first, then dub_video the swapped video, so the
   lips are redrawn on the new face.
5. Say in one sentence it is on its way; when it is ready, say so and offer another face picture if it
   doesn't look like them (a sharper, front-facing one helps most).
