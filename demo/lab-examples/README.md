# Creative Lab examples

The pictures, clips and words on every Creative Lab template card (frontend/public/showcase/lab/,
frontend/src/showcase/lab-examples.ts) were made by running the templates themselves in FlowAI, for
the showcase's demo brands, on the GPU pod's models, with Kimi K3 writing. Only the content nodes run:
never Where it goes or Post. To make them again (after a model changes, or with Higgsfield connected):

```sh
# The source photos the templates are handed (the showcase's own), into the api container
docker compose exec -T api mkdir -p /tmp/showcase-src
for f in dew-serum friday-stems clay-throw clay-glaze clay-shelf the-pour cold-brew; do
  docker cp frontend/public/showcase/$f.webp content-generator-api-1:/tmp/showcase-src/$f.webp; done
for f in make collect status; do docker cp demo/lab-examples/$f.php content-generator-api-1:/tmp/showcase-$f.php; done

# 1. Make: one project per template for showcase@flowai.local (ONLY=key,key to make some)
docker compose exec -T api php artisan tinker --execute 'require "/tmp/showcase-make.php";'
docker compose exec -T api php artisan tinker --execute 'require "/tmp/showcase-status.php";'   # until done
# 2. Then the ones made from another's video (the dub, the face swap)
docker compose exec -T -e PHASE=2 api php artisan tinker --execute 'require "/tmp/showcase-make.php";'
# 3. Collect the results for the web, and write the examples
docker compose exec -T api php artisan tinker --execute 'require "/tmp/showcase-collect.php";'
docker cp content-generator-api-1:/tmp/lab-out/. frontend/public/showcase/lab/
mv frontend/public/showcase/lab/manifest.json demo/lab-examples/manifest.json
python3 demo/lab-examples/gen-lab-examples.py demo/lab-examples/manifest.json frontend/src/showcase/lab-examples.ts
```

The files in frontend/public/showcase/lab/ are the examples: they're committed with the project and
shipped in the build, so nothing is made again at runtime. manifest.json (each file's size, colour
and length, and the words the nodes wrote) stays here: to change a note, edit gen-lab-examples.py and
run step 3's last line only, without the pod.

Look at every result before it goes in: a picture model can letter words onto a picture, a dub can
miss. The notes in gen-lab-examples.py say how each one was made; keep them true.
