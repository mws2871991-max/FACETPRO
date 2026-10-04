# Live detections

One file per real `/api/detect` reading that taught us something. The habit
(dev, 4 Oct): **when a live detection reveals a fault, save it here** — the
cheapest protection against the next fault is a growing library of real
detections, not more rules. Three of 4 Oct's faults were in houses nobody had
recorded.

Each file:

```json
{ "source": "which photo, which build, which date",
  "why": "what it caught or what is tricky about it",
  "aspectRatio": 0.75,
  "expected": { "frontWindowCount": 4, "frontBayCount": 2 },
  "detections": [ ... exactly as /api/detect returned them ... ] }
```

`test/live-detections.test.js` runs every file here (and the older fixtures it
lists) through `glazing` and checks `expected`. `aspectRatio` is the uploaded photo's width ÷ height. It matters: with two
front doors in shot the code only knows which door is ours from it, and
number 14 counts 5 without it and 4 with it, as the live site does.
Save the reading as it came
back — do not tidy it — and write the expected count from looking at the
photograph, not from what the code currently says.

To capture one: upload the photo on the live site with the browser console's
network tab open, copy the `/api/detect` response's `detections` array.
