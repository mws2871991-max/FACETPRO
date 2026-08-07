# Fixtures

Recorded output from the real system, kept so tests can run against what the
model actually returns rather than against boxes someone made up to pass.

## `no-door-bay.detections.json`

What `/api/detect` returned for a photograph of a real house on 7 August 2026,
run against the live service.

A two-storey detached home, curved bay, brick below and tile hanging above,
photographed mid-build during a window replacement. Twelve elements: a roof,
two wall surfaces, **six windows**, fascia, soffit and guttering.

**No front door is in shot**, which is why it is here. The front door is the
scale reference — a UK front door is 1.98 m, and that is what turns
percentages of an image into metres. Without one there is no way to size a
window, and the code used to conclude from that that there was no way to
*count* them either: it discarded six windows it had plainly detected and
priced the house-type prior of eleven instead, while drawing six labels on the
homeowner's own photograph. On this house that was £10,050–£18,272 against
£18,438–£33,523.

No synthetic fixture found that, because every synthetic fixture had a door in
it. This one is kept so the counted path is covered by something real.

### The photograph itself is deliberately not here

This repository is public and that is somebody's identifiable home. Publishing
it would need the homeowner's permission, which is the same rule the gallery in
`assets/work/` has to satisfy before any real job goes on the marketing page.

Nothing was lost by leaving it out. The geometry is the whole of the test
value: box positions, sizes, types and confidences, with no image, no address
and no personal data of any kind. If the image is ever needed again it can be
re-run through `/api/detect` to produce a comparable file.

### Re-recording it

```
curl -s -X POST $SITE/api/detect \
  -H 'Content-Type: application/json' \
  -d "{\"image\":\"$(base64 -i photo.jpg)\",\"mimeType\":\"image/jpeg\"}" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync(0));
             console.log(JSON.stringify(d.detections.filter(x=>x.type!=="analysis"),null,2))'
```

Expect the counts to move a little between runs — the model is sampled, and
`temperature` is deprecated on it. That is why detection is cached against a
hash of the image bytes in `server.js`, and why this file is a recording rather
than something regenerated on every test run.
