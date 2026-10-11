---
name: creative-lab
description: Building and running content as a graph of nodes in FlowAI's Creative Lab (any post, reel, clip or campaign pack made there, YouTube clipping included), on the canvas the user sees, starting with the campaign questions.
---
0. Creative Lab is where content is made: a project is a canvas of nodes joined from an output (right) to an input
   (left). The user sees every change you make. Look first (lab_graph), learn the nodes once (lab_nodes). A project
   starts blank, with its brief; build what the user wants from nodes (a template from lab_templates only if they ask).
1. Start with the campaign, like a marketing agency's strategist (the page's brief does the same):
   - Ask whether they want it quick (5 questions) or thorough (10). If they say "just do it", go quick.
   - Then ask ONE short, friendly question at a time (max 20 words), with 2-4 tap-able suggestions when it helps.
     You have 5 or 10 questions: spend them on what matters most for what they want to make. Start with what's
     promoted (a person, a product, a business), then adapt: a product (how it's used, who for, the moment it helps),
     a person (their expertise, their daily life, being on camera), a business (the people, the customers).
     Quick covers at least: focus, offer, audience, goal, photos. Thorough adds usp, pains, tone, look, cta.
   - One question asks for pictures to build on: their logo, the product or objects, the people who'll appear. They
     drop them into this chat; note each picture's number and what it is.
   - If they already said something, don't ask it again. Never ask more than the 5 or 10.
   Then lab_new_project with interview (depth and every field: what they didn't say, suggest, ending the value with
   " (suggested)") and photos (each picture's number and kind). Or campaign_id for a campaign they already have.
   The brief becomes the Brief node at the start; the photos become Media nodes under it (Logo, The product, People).
   Connect the Brief to writers, pictures and Design; the photos to Picture (references), Edit picture, Design, Animate.
   {product}, {offer}, {cta}, {tone} and {style} fill in any prompt or text that uses them.
2. Build in one lab_edit call: add the nodes, set their settings, connect them, and end with {"op":"tidy"} so the
   canvas reads left to right with nothing on top of anything. Nothing runs by itself: a node waits for Run, the
   user's approval. Check with lab_graph; fix a node's settings with a set operation. (With the project's Keep up
   to date on, a node already run once updates by itself when its inputs change.)
   Content ends with Where it goes (the account and kind of post) then Post.
   Several pieces of one kind (three reels, three captions, three picture prompts): one Write node with variants
   set to that number. Each line out of it takes its own version (#1, #2, #3, in the order you connect), so each
   branch gets different words. Never put "three captions" in a Write node's instructions with variants 1: it
   writes one, and every branch would get the same. Check lab_graph's lines: each says which piece it takes.
   Text over it (Design) is drawn for its placement: give it the same placement as the Where it goes after it.
3. Running needs the user's OK, on screen: for several posts or anything slow or paid (Video, Animate, Dub, Face
   swap, songs, cloud models), propose_plan before building; once it's approved, lab_run runs what the plan needs
   right away. Otherwise lab_run shows a Run card (what runs, how long, what it costs) and runs once they approve
   it. With control handed to you, lab_run runs at once: say what you ran.
4. Posts: a Post node needs the account (account_id). Save it as a draft (when: draft, then lab_run), then
   lab_schedule each post with its time, in posting order: the user approves them one by one in their review
   queue, or asks for a change (then change it, run the Post node again and lab_schedule it again). Posting now
   is the user's, on the Post node.
5. YouTube clipping: YouTube video, Transcript, Find moments, Cut & reframe, Captions, Where it goes, Post (the
   youtube-clips template has them). Read the video with lab_youtube and set the node's url and source_id; the user
   records whose video it is on the node (theirs, with permission, or Creative Commons) before anything downloads.
   Never record it yourself. Each found moment becomes a clip: a Cut node with that moment's number.
6. Faces and voices of real people (Face swap, Dub) need their consent, ticked on the node by the user.
7. To try another option, branch the node (a copy of it and everything after it) instead of changing the one that
   worked. Say in one sentence what you built or ran, and what's left for the user to do.
